// Classic indicators vs SMC trades (Nov 20): do EMA / SMA / MACD / RSI trends at entry separate SMC winners from losers?
// REPORT ONLY: changes no live rule, writes no shared file. Base trades = rules in force from a state.json (as tools/smc-fib-test.mjs).
// Every feature is read at the trade's entry t0 from CLOSED 15m / 1h bars only (bar open + length <= t0) and signed with the trade:
// "with" = the indicator points the trade's way. Extra history is loaded for the indicators; simulate still sees the desk's bars.
// GT_PART=week: small caps + big caps over GT_DAYS (21); year: SMC Big settings on BTC / ETH 365 d; live: the state's closed SM / SB trades;
// report: reads the JSON files named in GT_IN (comma list) and prints the tables. GT_END pins the window end (ms). GT_CACHE=<file>
// keeps the loaded candles so a rerun skips the download.
// Usage (after build.py): GT_PART=week GT_END=… node tools/smc-ind-study.mjs <state.json> <out.json>
import fs from 'node:fs';
import {mkCore, simulate, klines, aster, pool, trkHour, H1_BARS, nClosed} from '../bot/backtest.mjs';
import {YEAR_COINS, yearHour, needCoins} from '../bot/backtest-year.mjs';
const [, , IN, OUT] = process.argv, PART = process.env.GT_PART || 'week';
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const H1X = Math.max(H1_BARS + 24, 300), M15X = 300;   // bars before the window: SMA200 on 1h, EMA50 / MACD warm-up on 15m

/* ---------- indicators (each value at index i uses bars <= i only) ---------- */
const ema = (c, p) => { const o = new Array(c.length).fill(NaN), k = 2 / (p + 1); let s = 0, i0 = c.findIndex(Number.isFinite);
  if (i0 < 0 || c.length - i0 < p) return o; for (let i = i0; i < i0 + p; i++) s += c[i]; o[i0 + p - 1] = s / p;
  for (let i = i0 + p; i < c.length; i++) o[i] = c[i] * k + o[i - 1] * (1 - k); return o; };
const sma = (c, p) => { const o = new Array(c.length).fill(NaN); let s = 0; for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= p) s -= c[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
const rsi = (c, p = 14) => { const o = new Array(c.length).fill(NaN); if (c.length <= p) return o; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); } g /= p; l /= p; o[p] = l ? 100 - 100 / (1 + g / l) : 100;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } return o; };
function series(B) {
  const c = B.map(b => b[4]), e12 = ema(c, 12), e26 = ema(c, 26), m = c.map((_, i) => e12[i] - e26[i]), sg = ema(m, 9);
  return {c, e20: ema(c, 20), e50: ema(c, 50), s50: sma(c, 50), s200: sma(c, 200), m, h: m.map((v, i) => v - sg[i]), r: rsi(c)};
}
const SER = new WeakMap(), ser = B => { if (!SER.has(B)) SER.set(B, series(B)); return SER.get(B); };
const sg = v => Number.isFinite(v) && v !== 0 ? (v > 0 ? 'with' : 'against') : null;
const rb = r => !Number.isFinite(r) ? null : r < 30 ? '<30' : r < 50 ? '30-50' : r < 70 ? '50-70' : '>70';
// features of one trade at t0 on one timeframe, signed with the side (rsiB = RSI on the trade's side: 100 - RSI on a short)
function feats(B, len, t0, side, tf) {
  const n = B ? nClosed(B, len, t0) : 0, j = n - 1, d = side === 'L' ? 1 : -1, S = B && ser(B), o = {};
  if (j < 1) return o;
  const {c, e20, e50, s50, s200, m, h, r} = S;
  o[`${tf} px>EMA20`] = sg((c[j] - e20[j]) * d); o[`${tf} px>EMA50`] = sg((c[j] - e50[j]) * d); o[`${tf} EMA20>EMA50`] = sg((e20[j] - e50[j]) * d);
  o[`${tf} EMA50 slope10`] = j >= 10 ? sg((e50[j] - e50[j - 10]) * d) : null;
  o[`${tf} MACD>0`] = sg(m[j] * d); o[`${tf} MACD>signal (hist sign)`] = sg(h[j] * d); o[`${tf} hist rising`] = sg((h[j] - h[j - 1]) * d);
  o[`${tf} RSI with (>50 long)`] = sg((r[j] - 50) * d);
  const b = rb(d > 0 ? r[j] : 100 - r[j]); for (const k of ['<30', '30-50', '50-70', '>70']) o[`${tf} RSI side ${k} vs rest`] = b && (b === k ? 'with' : 'against');
  if (tf === '1h') { o['1h px>SMA50'] = sg((c[j] - s50[j]) * d); o['1h px>SMA200'] = sg((c[j] - s200[j]) * d); }
  return o;
}
const trow = (x, C) => ({s: x.s, side: x.side, t0: x.t0, t1: x.t1, R: +x.R.toFixed(3), f: {...feats(C && C.m15, M15, x.t0, x.side, '15m'), ...feats(C && C.h1, H, x.t0, x.side, '1h')}});
// self-check: closed-bar read only; a long above a rising EMA reads "with", the same bar as a short "against"
{ const B = Array.from({length: 300}, (_, i) => [i * H, 100 + i, 101 + i, 99 + i, 100 + i]), a = feats(B, H, 300 * H, 'L', '1h'), b = feats(B, H, 300 * H, 'S', '1h');
  console.assert(a['1h px>EMA20'] === 'with' && b['1h px>EMA20'] === 'against' && a['1h px>SMA200'] === 'with' && a['1h RSI side >70 vs rest'] === 'with', 'indicator self-check failed');
  B[299][4] = 1; console.assert(feats(B, H, 299 * H, 'L', '1h')['1h px>EMA20'] === 'with', 'look-ahead: a bar not closed by t0 was read'); }

/* ---------- report ---------- */
const st3 = A => { const R = A.map(x => x.R); return {n: R.length, avg: R.length ? R.reduce((a, b) => a + b, 0) / R.length : NaN, tot: R.reduce((a, b) => a + b, 0), win: R.length ? R.filter(v => v > 0).length / R.length * 100 : NaN}; };
const fs3 = s => s.n ? `${String(s.n).padStart(3)} ${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)} ${String(Math.round(s.win)).padStart(3)}%` : '  0    –    –';
const GAP = 0.15, NMIN = 8;
function cells(rows, k, split, lab = r => r.f[k]) {
  const W = rows.filter(r => lab(r) === 'with'), A = rows.filter(r => lab(r) === 'against'), h1 = r => r.t1 < split;
  return {w: st3(W), a: st3(A), w1: st3(W.filter(h1)), a1: st3(A.filter(h1)), w2: st3(W.filter(r => !h1(r))), a2: st3(A.filter(r => !h1(r)))};
}
// gapOk = the gap / same-sign part alone (any n with both cells filled), reported to show how often noise clears it
const gapOk = c => [c.w1, c.a1, c.w2, c.a2].every(s => s.n > 0) && Math.abs(c.w1.avg - c.a1.avg) >= GAP && Math.abs(c.w2.avg - c.a2.avg) >= GAP && Math.sign(c.w1.avg - c.a1.avg) === Math.sign(c.w2.avg - c.a2.avg);
const pass = c => [c.w1, c.a1, c.w2, c.a2].every(s => s.n >= NMIN) && Math.abs(c.w1.avg - c.a1.avg) >= GAP && Math.abs(c.w2.avg - c.a2.avg) >= GAP && Math.sign(c.w1.avg - c.a1.avg) === Math.sign(c.w2.avg - c.a2.avg);
function report(files) {
  const DS = files.flatMap(p => Object.values(JSON.parse(fs.readFileSync(p, 'utf8')).sets)), L = [];
  const keys = [...new Set(DS.flatMap(d => d.rows.flatMap(r => Object.keys(r.f))))];
  const sib = {small: ['live-sm'], big: ['year', 'live-sb'], year: ['big', 'live-sb']};   // same settings: SMC Trader / SMC Big
  let tested = 0, expected = 0, gapN = 0, gapE = 0; const held = [];
  for (const d of DS) {
    const R = d.rows.filter(r => Number.isFinite(r.R)), b = st3(R), split = d.split;
    L.push(`\n## ${d.name}: ${d.desc}\nbase n ${b.n} avgR ${b.avg.toFixed(2)} tot ${b.tot.toFixed(1)}R win ${Math.round(b.win)}% | half split at ${new Date(split).toISOString().slice(0, 16)} (by exit time t1)`);
    L.push(`feature                         | with: n avgR win | against: n avgR win | gap | H1 with  | H1 against | gap1 | H2 with  | H2 against | gap2 | verdict`);
    for (const k of keys) {
      const c = cells(R, k, split); if (!c.w.n && !c.a.n) continue;
      const g = (p, q) => p.n && q.n ? ((p.avg - q.avg >= 0 ? '+' : '') + (p.avg - q.avg).toFixed(2)).padStart(5) : '    –';
      let v = '';
      if (!d.live) { tested++;
        // chance: shuffle the with/against labels over the trades (same counts), how often does the rule pass on noise?
        const lab = R.map(r => r.f[k]); let hits = 0, gh = 0; const NP = 400;
        for (let p = 0; p < NP; p++) { const z = lab.slice(); for (let i = z.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [z[i], z[j]] = [z[j], z[i]]; }
          const m = new Map(R.map((r, i) => [r, z[i]])); const pc = cells(R, k, split, r => m.get(r)); if (pass(pc)) hits++; if (gapOk(pc)) gh++; }
        expected += hits / NP; gapE += gh / NP; if (gapOk(c)) gapN++;
        if (pass(c)) { const s = Math.sign(c.w.avg - c.a.avg), contra = (sib[d.name] || []).filter(o => o !== d.name).map(o => DS.find(x => x.name === o)).filter(Boolean).map(o => [o.name, cells(o.rows, k, o.split)])
            .filter(([, oc]) => oc.w.n >= NMIN && oc.a.n >= NMIN && Math.sign(oc.w.avg - oc.a.avg) === -s && Math.abs(oc.w.avg - oc.a.avg) >= GAP).map(([n]) => n);
          v = contra.length ? `passes here, contradicted by ${contra}` : 'HOLDS'; if (!contra.length) held.push([d, k, s > 0 ? 'with' : 'against', c]); }
        else v = [c.w1, c.a1, c.w2, c.a2].some(s => s.n < NMIN) ? 'n<8' : 'no';
      }
      L.push(`${k.padEnd(31)} | ${fs3(c.w)} | ${fs3(c.a)} | ${g(c.w, c.a)} | ${fs3(c.w1)} | ${fs3(c.a1)} | ${g(c.w1, c.a1)} | ${fs3(c.w2)} | ${fs3(c.a2)} | ${g(c.w2, c.a2)} | ${v}`);
    }
  }
  L.push(`\n## Multiple testing\nsplits tested (backtest datasets): ${tested}; expected to pass the rule by chance (label-shuffle, 400 perms each): ${expected.toFixed(1)}
gap + same sign alone (n rule dropped): ${gapN} of ${tested} pass; ${gapE.toFixed(1)} expected by chance`);
  L.push(`\n## Filters that hold: net effect if applied (keep only the better side)`);
  if (!held.length) L.push('none');
  for (const [d, k, keep, c] of held) { const all = st3(d.rows), k1 = keep === 'with' ? c.w1 : c.a1, k2 = keep === 'with' ? c.w2 : c.a2, kk = keep === 'with' ? c.w : c.a;
    const h1 = st3(d.rows.filter(r => r.t1 < d.split)), h2 = st3(d.rows.filter(r => r.t1 >= d.split));
    L.push(`${d.name} | ${k} keep ${keep}: kept ${kk.n}/${all.n} trades, ${kk.tot.toFixed(1)}R vs base ${all.tot.toFixed(1)}R | half 1 ${k1.tot.toFixed(1)} vs ${h1.tot.toFixed(1)} | half 2 ${k2.tot.toFixed(1)} vs ${h2.tot.toFixed(1)}`); }
  return L.join('\n');
}
if (PART === 'report') { const txt = report(process.env.GT_IN.split(',')); console.log(txt); if (OUT) fs.writeFileSync(OUT, txt); process.exit(0); }

/* ---------- data ---------- */
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const out = {t: Date.now(), part: PART, note: 'indicator study — report only, never applied', sets: {}};
const save = () => fs.writeFileSync(OUT, JSON.stringify(out));
const exInfo = await aster('/fapi/v1/exchangeInfo');
const END = +process.env.GT_END || Math.floor(Date.now() / M5) * M5, CACHE = process.env.GT_CACHE;
const cached = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : null;
if (cached && cached.end !== END) throw new Error(`cache ${CACHE} is for another GT_END`);
async function runBase(name, desc, D, U, steps, isBig, split) {
  const r = await simulate('base', st, exInfo, D, U, steps, '', new Map(), isBig);
  out.sets[name] = {name, desc, split, end: END, open: r.open, rows: r.trades.map(x => trow(x, D[x.s]))}; save();
  const s = st3(r.trades); log(`${name}: n ${s.n} avg ${s.avg.toFixed(2)}R tot ${s.tot.toFixed(1)}R (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
}
if (PART === 'week') {
  const days = +process.env.GT_DAYS || 21, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H, uc = await mkCore(st.cfg, exInfo);
  let H1 = {}, D = {};
  if (cached) ({H1, D} = cached);
  else { await pool(uc.X('[...S.meta.keys()]'), 4, async s => { H1[s] = await klines(s, '1h', H, h0 - H1X * H, END); }); }
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  if (!cached) { const all = [...new Set([...U.values()].flatMap(u => [...Object.keys(u.trk), ...u.big]))];
    await pool(all, 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - M15X * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
    if (CACHE) fs.writeFileSync(CACHE, JSON.stringify({end: END, H1, D})); }
  log(`${days} d to ${new Date(END).toISOString()}: ${Object.keys(D).length} coins with candles (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const steps = [], split = W0 + (END - W0) / 2; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  const acct = (process.env.GT_ACCT || 'small,big').split(',');
  if (acct.includes('small')) await runBase('small', `SMC Trader rules in force (gmsB/D, fib 1), small caps ${days} d`, D, U, steps, false, split);
  if (acct.includes('big')) await runBase('big', `SMC Big rules in force (SB_OV: gmsC), big caps top 10 ${days} d`, D, U, steps, true, split);
} else if (PART === 'year') {
  const days = 365, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H; let D = {}, H1 = {};
  if (cached) ({D} = cached);
  else { await pool(YEAR_COINS, 2, async s => { D[s] = {h1: await klines(s, '1h', H, h0 - H1X * H, END), m15: await klines(s, '15m', M15, h0 - M15X * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
    if (CACHE) fs.writeFileSync(CACHE, JSON.stringify({end: END, D})); }
  needCoins(D); for (const s of YEAR_COINS) H1[s] = D[s].h1;
  log(`year to ${new Date(END).toISOString()}: candles ready (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  await runBase('year', 'SMC Big settings (= SMC BTC/ETH account) on BTC + ETH 365 d', D, U, steps, true, W0 + (END - W0) * 8 / 12);   // 8/12 split as the year tools
} else if (PART === 'live') {
  const fin = v => typeof v === 'number' && isFinite(v);
  for (const [k, name] of [['sm', 'live-sm'], ['sb', 'live-sb']]) {
    const T = ((st[k] && st[k].log) || []).filter(x => x.s && x.t0 && x.side && fin(x.R) && !/closed by you/.test(x.exitWhy || '')), D = {};
    await pool([...new Set(T.map(x => x.s))], 4, async s => { const t = T.filter(x => x.s === s).map(x => x.t0), a = Math.min(...t), b = Math.max(...t) + 1;
      D[s] = {h1: await klines(s, '1h', H, a - H1X * H, b), m15: await klines(s, '15m', M15, a - M15X * M15, b)}; });
    const t1s = T.map(x => x.t1).sort((a, b) => a - b);
    out.sets[name] = {name, live: true, desc: `live closed ${k.toUpperCase()} trades (all rule eras; side table, not used to pass a rule)`, split: t1s[Math.floor(t1s.length / 2)], rows: T.map(x => trow(x, D[x.s]))};
    log(`${name}: ${T.length} trades`); save();
  }
}
log(`saved ${OUT} (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
