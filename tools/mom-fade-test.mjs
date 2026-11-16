// Momentum-fade backtest (Nov 15, Fred: test the "do the opposite" idea from the reverse study). REPORT ONLY.
// Rebuilds the Trader's momentum read (momRead, src/track.js) on the small caps the tracker followed over MF_DAYS (default 21), from
// candles only: funding and OI have no history here, so those two checks are unknown (as live while OI history builds), and a
// "strong" read needs MF_MIN of the known checks (default 6). One signal per coin per 6 h. Each signal is replayed on 5m candles:
//   mom  = the Trader's momentum trade (long a strong gainer / short a strong loser): stop beyond the last 2h swing or the 15m EMA20
//          + 0.5% (2–15% away), target +2R, time exit after 6 h;
//   fade = the opposite side at the same price: stop the same distance the other way, target +2R, 6 h;
//   fade12 = the same with a 12 h time exit.   All net of 0.28% round-trip costs.
// Rows also carry trkH (hours since the coin entered the tracker) and mv1h (move over the last hour, %, signed) for the timing study (Nov 15).
// Usage (after python3 build.py): node tools/mom-fade-test.mjs <state.json> <out.json>
import fs from 'node:fs';
import {mkCore, simulate, klines, aster, pool, trkHour} from '../bot/backtest.mjs';
const [, , IN, OUT] = process.argv;
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const days = +process.env.MF_DAYS || 21, MIN = +process.env.MF_MIN || 6;
const exInfo = await aster('/fapi/v1/exchangeInfo');
const END = Math.floor(Date.now() / M5) * M5, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H;
const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]'), H1 = {};
await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - 96 * H, END); });
const U = new Map(), trk = {};
for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))], D = {};
await pool(coins, 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END + 12 * H)}; });
log(`${days} d: ${coins.length} small caps loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
const HOOK = `SM.on = false; globalThis.__l5 = {}; globalThis.__l6 = {};
const __st = smTick; smTick = function () { const r = __st.apply(this, arguments);
  try { for (const s of Object.keys(S.trk || {})) { const m = momRead(s); if (!m || !m.checks || !m.checks.length) continue;
    if (m.score < ${MIN - 1}) continue; const k = S.kl.get(s), B = k.bars, n = B.length, t = CLOCK_OVR || now();
    const f5 = !(__l5[s] && t - __l5[s] < 6 * 3600e3), f6 = m.score >= ${MIN} && !(__l6[s] && t - __l6[s] < 6 * 3600e3);
    if (!f5 && !f6) continue; if (f5) __l5[s] = t; if (f6) __l6[s] = t;
    const w2 = B.slice(n - 8);
    __log('MREC ' + JSON.stringify({s, side: m.side, t, live: m.live, ema: m.ema, ext: m.ext, score: m.score, known: m.known, lo2: Math.min(...w2.map(b => b[3])), hi2: Math.max(...w2.map(b => b[2])),
      ok: m.checks.map(c => c.ok === true ? 1 : c.ok === false ? 0 : null), mv: (S.tk.get(s) || {}).pct, f5: +f5, f6: +f6,
      trkH: S.trk[s] && S.trk[s].t0 ? (t - S.trk[s].t0) / 3600e3 : null, mv1h: B[n - 5] ? (m.live / B[n - 5][4] - 1) * 100 : null})); } } catch (e) {}
  return r; };`;
const recs = [], prev = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('MREC ')) recs.push(JSON.parse(a[0].slice(5))); else prev(...a); };
try { await simulate('momfade', st, exInfo, D, U, steps, 'var __log = (x) => console.log(x); ' + HOOK, new Map(), false); } finally { console.log = prev; }
log(`${recs.length} momentum signals recorded`);
const COST = 0.0028;
function sim(B, i0, long, e, stop, tgt, hold) {
  const d = Math.abs(e - stop); if (!(d > 0) || i0 < 0) return null;
  for (let m = i0; m < Math.min(B.length, i0 + hold); m++) { const b = B[m];
    if (long ? b[3] <= stop : b[2] >= stop) return -1 - COST * e / d;
    if (long ? b[2] >= tgt : b[3] <= tgt) return Math.abs(tgt - e) / d - COST * e / d;
  }
  const j = Math.min(B.length, i0 + hold) - 1; if (j < i0) return null; const last = B[j][4];
  return (long ? last - e : e - last) / d - COST * e / d;
}
const rows = [];
for (const x of recs) {
  const B = D[x.s].m5, i0 = B.findIndex(b => b[0] >= x.t); if (i0 < 0) continue;
  const momLong = x.side === 'G', e = x.live * (momLong ? 1.001 : 0.999);   // 0.10% slippage on the entry
  let stop = momLong ? Math.min(x.lo2, x.ema) * 0.995 : Math.max(x.hi2, x.ema) * 1.005, dist = Math.abs(stop - e) / e;
  if (dist > 0.15) continue; if (dist < 0.02) { stop = momLong ? e * 0.98 : e * 1.02; dist = 0.02; }
  const d = Math.abs(e - stop);
  const mom = sim(B, i0, momLong, e, stop, momLong ? e + 2 * d : e - 2 * d, 72);
  const fade = sim(B, i0, !momLong, e, momLong ? e + d : e - d, momLong ? e - 2 * d : e + 2 * d, 72);
  const fade12 = sim(B, i0, !momLong, e, momLong ? e + d : e - d, momLong ? e - 2 * d : e + 2 * d, 144);
  rows.push({trkH: x.trkH, mv1h: x.mv1h, f5: x.f5, f6: x.f6, s: x.s, side: x.side, t: x.t, score: x.score, known: x.known, ext: x.ext, mv: x.mv, ok: x.ok, stopPct: dist * 100, mom, fade, fade12, half: x.t < W0 + (END - W0) / 2 ? 1 : 2});
}
fs.writeFileSync(OUT, JSON.stringify({t: Date.now(), days, min: MIN, rows}));
const f = (A, k) => { const v = A.map(r => r[k]).filter(z => z != null); return v.length ? `n ${String(v.length).padStart(4)} avg ${(v.reduce((a, b) => a + b, 0) / v.length >= 0 ? '+' : '')}${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}R tot ${v.reduce((a, b) => a + b, 0).toFixed(1)}R win ${Math.round(v.filter(z => z > 0).length / v.length * 100)}%` : 'n 0'; };
for (const side of ['G', 'L']) for (const thr of [MIN - 1, MIN]) {
  const A = rows.filter(r => r.side === side && (thr === MIN ? r.f6 : r.f5));
  log(`${side === 'G' ? 'strong gainers (mom long / fade short)' : 'strong losers (mom short / fade long)'} score ≥ ${thr}:`);
  for (const k of ['mom', 'fade', 'fade12']) log(`   ${k.padEnd(6)} all ${f(A, k)} | half 1 ${f(A.filter(r => r.half === 1), k)} | half 2 ${f(A.filter(r => r.half === 2), k)}`);
}
log(`saved ${OUT}`);
