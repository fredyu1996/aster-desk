// Zone study (Nov 15, Fred: "can the OB / FVG pick be coded better?"). REPORT ONLY: changes no live rule, writes no shared file.
// Runs the backtest engine with the rules in force and records, for every setup the SMC reader sees (structure shift found, zone
// list complete: shift bar + 2 closed bars), EVERY candidate zone (each FVG on the leg and the OB) with its features. Each candidate
// is then labelled from the real candles that followed, the same for all of them:
//   lab  = the Reviewer's label (touched, then +1R before a close through the far edge = right; a stop or close-through first = wrong)
//   simR = a plain trade from the zone: limit at the midpoint within H bars of the zone being known (cancelled if a candle closes
//          through the far edge first), stop = the trader's own zone stop, target +2R, time exit H bars after the fill, net of costs.
// GZ_PART=week: small caps (SMC Trader) + big caps (SMC Big) over GZ_DAYS (default 21); GZ_PART=year: SMC Big on BTC / ETH, 365 d.
// Usage (after python3 build.py): GZ_PART=week node tools/smc-zone-study.mjs <state.json> <out.json>
import fs from 'node:fs';
import {mkCore, simulate, klines, aster, pool, trkHour} from '../bot/backtest.mjs';
import {YEAR_COINS, yearHour, needCoins} from '../bot/backtest-year.mjs';
const [, , IN, OUT] = process.argv, PART = process.env.GZ_PART || 'week';
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const HOOK = `globalThis.__ZK = new Set();
const __rt = smcReadTf; smcReadTf = function (s, tf) { const r = __rt(s, tf);
  try { const u = r && r.setup; if (u && u.k > 0 && u.zc && u.zc.c && u.zc.c.length) { const B = smBars(s, tf), n = B.length;
    if (u.k <= n - 3) { const key = s + '|' + tf + '|' + u.dir + '|' + B[u.k][0]; if (!__ZK.has(key)) { __ZK.add(key);
      __log('ZREC ' + JSON.stringify({s, tf, dir: u.dir, type: u.type || 'rev', tk: B[u.k][0], tj: B[u.j][0], ext: u.ext, reg: r.regime ? r.regime.reg : null,
        rok: r.rok ? +r.rok.ok : null, bias: r.bias || null, against: r.against ? 1 : 0, poi: r.poi ? r.poi.ok : null, pick: u.zc.k,
        Z: u.zc.c.map(z => Object.assign({}, z, {ti: B[z.i][0], stop: smZoneStop(z, u.dir, u.ext)}))})); } } } } catch (e) {}
  return r; };`;
const recs = [];
async function record(tag, D, U, steps, isBig) {
  const before = recs.length;
  const st2 = st;   // rules in force
  const prev = console.log;
  console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('ZREC ')) { const x = JSON.parse(a[0].slice(5)); x.acct = tag; recs.push(x); } else prev(...a); };
  try { await simulate(tag, st2, exInfo, D, U, steps, 'var __log = (x) => console.log(x); ' + HOOK, new Map(), isBig); } finally { console.log = prev; }
  log(`${tag}: ${recs.length - before} setups recorded`);
}
const exInfo = await aster('/fapi/v1/exchangeInfo');
const END = Math.floor(Date.now() / M5) * M5, DATA = {};
if (PART === 'week') {
  const days = +process.env.GZ_DAYS || 21, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H;
  const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]'), H1 = {};
  await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - 96 * H, END); });
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))], big = [...new Set([...U.values()].flatMap(u => u.big))], D = {};
  await pool([...new Set([...coins, ...big])], 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END + 2 * 24 * H), m5: await klines(s, '5m', M5, h0 - H, END)}; });
  log(`${days} d: ${coins.length} small caps, ${big.length} big caps loaded`);
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  Object.assign(DATA, D);
  await record('small', D, U, steps, false);
  await record('big', D, U, steps, true);
  var SPLIT = W0 + (END - W0) / 2;
} else {
  const days = 365, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H, D = {}, H1 = {};
  await pool(YEAR_COINS, 2, async s => { const h1 = await klines(s, '1h', H, h0 - 96 * H, END); D[s] = {h1, m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; H1[s] = h1; });
  needCoins(D); log('year: candles loaded');
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  Object.assign(DATA, D);
  await record('year', D, U, steps, true);
  var SPLIT = W0 + (END - W0) * 8 / 12;
}
// ---- labels ----
const cost = acct => acct === 'small' ? 0.0028 : 0.0012;   // fee 0.04% + slippage (0.10% small / 0.02% SMC Big) per side, both sides
function label(B, z, bull, stop, from, Hb, costF) {
  const e = (z.lo + z.hi) / 2, d = Math.abs(e - stop), out = {lab: 'untouched', r: 0, fill: 0, simR: null};
  if (!(d > 0) || from < 0) return out;
  // Reviewer label
  let t = false, mx = 0;
  for (let m = from; m < Math.min(B.length, from + 2 * Hb); m++) { const b = B[m], first = !t;
    if (first && !(bull ? b[3] <= z.hi : b[2] >= z.lo)) { if (m - from >= Hb) break; continue; } t = true;
    if (bull ? b[3] <= stop || b[4] < z.lo : b[2] >= stop || b[4] > z.hi) { out.lab = mx >= 1 ? 'right' : 'wrong'; out.r = mx >= 1 ? Math.min(mx, 3) : -1; break; }
    if (!first) mx = Math.max(mx, (bull ? b[2] - e : e - b[3]) / d);
    out.lab = mx >= 1 ? 'right' : 'wrong'; out.r = mx >= 1 ? Math.min(mx, 3) : 0;
  }
  // plain trade from the midpoint
  const tgt = bull ? e + 2 * d : e - 2 * d; let fi = -1;
  for (let m = from; m < Math.min(B.length, from + Hb); m++) { const b = B[m];
    if (bull ? b[3] <= e : b[2] >= e) { fi = m; break; }
    if (bull ? b[4] < z.lo : b[4] > z.hi) return out;   // broken before the fill
  }
  if (fi < 0) return out;
  out.fill = 1; const c = costF * e / d;
  for (let m = fi; m < Math.min(B.length, fi + Hb); m++) { const b = B[m];
    if (bull ? b[3] <= stop : b[2] >= stop) { out.simR = -1 - c; return out; }
    if (m > fi && (bull ? b[2] >= tgt : b[3] <= tgt)) { out.simR = 2 - c; return out; }
  }
  const last = B[Math.min(B.length, fi + Hb) - 1][4]; out.simR = (bull ? last - e : e - last) / d - c; return out;
}
const rows = [];
for (const x of recs) {
  const C = DATA[x.s]; if (!C) continue;
  const B = x.tf === '1h' ? C.h1 : C.m15, ms = x.tf === '1h' ? H : M15, Hb = x.tf === '1h' ? 36 : 48, bull = x.dir === 'L';
  const idx = t => { let lo = 0, hi = B.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (B[mid][0] < t) lo = mid + 1; else hi = mid; } return B[lo] && B[lo][0] >= t ? lo : -1; };
  const kI = idx(x.tk); if (kI < 0) continue;
  const fvgs = x.Z.filter(z => z.kind === 'FVG').sort((a, b) => a.ti - b.ti), ob = x.Z.find(z => z.kind === 'OB');
  const L = x.Z.map((z, zi) => {
    const zI = idx(z.ti), from = Math.max(kI + 1, zI + 2);
    const lb = label(B, z, bull, z.stop, from, Hb, cost(x.acct));
    return Object.assign({zi, kind: z.kind, zs: z.zs, body: z.body, vr: z.vr, fresh: z.fresh, pos: z.pos, dSw: z.dSw, ovl: z.ovl, pd: z.pd, wOk: z.wOk, dispR: z.dispR, disp: z.disp, mssDisp: z.mssDisp, c2: z.c2, obNear: z.obNear, obConf: z.obConf, gq: z.gq,
      first: z.kind === 'FVG' ? +(fvgs[0] === z) : null, newest: z.kind === 'FVG' ? +(fvgs[fvgs.length - 1] === z) : null, stopPct: Math.abs((z.lo + z.hi) / 2 - z.stop) / ((z.lo + z.hi) / 2) * 100}, lb);
  });
  // synthetic OB ∩ FVG overlap zone (the A+ entry)
  let ovl = null;
  if (ob) { const o = fvgs.map(f => ({lo: Math.max(f.lo, ob.lo), hi: Math.min(f.hi, ob.hi), f})).filter(o => o.hi > o.lo).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0];
    if (o) { const z = {lo: o.lo, hi: o.hi}, from = Math.max(kI + 1, idx(Math.max(o.f.ti, ob.ti)) + 2); ovl = label(B, z, bull, ob.stop, from, Hb, cost(x.acct)); } }
  rows.push({acct: x.acct, s: x.s, tf: x.tf, dir: x.dir, type: x.type, tk: x.tk, half: x.tk < SPLIT ? 1 : 2, reg: x.reg, rok: x.rok, poi: x.poi, against: x.against, pick: x.pick, Z: L, ovl});
}
fs.writeFileSync(OUT, JSON.stringify({t: Date.now(), part: PART, split: SPLIT, rows}));
log(`saved ${rows.length} setups, ${rows.reduce((a, r) => a + r.Z.length, 0)} zones → ${OUT} (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
