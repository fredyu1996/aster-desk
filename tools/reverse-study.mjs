// Reverse study (Nov 15, Fred: "for the losing trades, would the opposite trade have won? note it, then backtest it"). REPORT ONLY.
// For every closed trade in a state.json (Trader `pt`, SMC Trader `sm`, SMC Big `sb`) or a backtest rows file, replays on real
// 5m candles from the entry time, with the same simple rules for all three versions:
//   orig   = the trade as taken: stop at the initial stop (risk d), target at rr × d, time exit after 12 h;
//   mirror = the opposite side at the same price and time: stop d away the other way, target rr × d;
//   swap   = the opposite side with the original target as its stop and the original stop as its target (R:R 1/rr).
// All net of costs (fee 0.04% + slippage 0.10% per side for small caps, 0.02% slippage for SMC Big / BTC-ETH).
// Usage: node tools/reverse-study.mjs <state.json | rows.json> <out.json>   (rows.json: {rows: [{acct, s, side, t0, entry, stop0, rr, ...}]})
import fs from 'node:fs';
const [, , IN, OUT] = process.argv;
const J = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const M5 = 300e3, HOLD = 144;   // 12 h of 5m bars
const trades = [];
if (J.rows) trades.push(...J.rows);
else for (const [acct, k] of [['trader', 'pt'], ['smc', 'sm'], ['big', 'sb']]) for (const t of (J[k] && J[k].log) || []) trades.push(Object.assign({acct}, t));
const kl = async (s, start) => {
  for (let a = 0; a < 3; a++) { try { const r = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${s}&interval=5m&startTime=${start}&limit=${HOLD + 2}`); if (r.ok) return (await r.json()).map(b => [b[0], +b[1], +b[2], +b[3], +b[4]]); } catch (e) {} await new Promise(r => setTimeout(r, 800)); }
  return null;
};
function sim(B, i0, long, e, stop, tgt, cost) {
  const d = Math.abs(e - stop); if (!(d > 0)) return null;
  for (let m = i0; m < Math.min(B.length, i0 + HOLD); m++) { const b = B[m];
    if (long ? b[3] <= stop : b[2] >= stop) return {R: -1 - cost * e / d, why: 'stop', bars: m - i0};   // stop first when a bar hits both
    if (long ? b[2] >= tgt : b[3] <= tgt) return {R: Math.abs(tgt - e) / d - cost * e / d, why: 'target', bars: m - i0};
  }
  const last = B[Math.min(B.length, i0 + HOLD) - 1][4];
  return {R: (long ? last - e : e - last) / d - cost * e / d, why: 'time', bars: HOLD};
}
const out = [], todo = trades.filter(t => t.entry > 0 && t.stop0 > 0 && t.t0 && t.s);
let k = 0;
async function work() {
  while (k < todo.length) { const t = todo[k++];
    const B = await kl(t.s, Math.floor(t.t0 / M5) * M5); if (!B || !B.length) { out.push({acct: t.acct, s: t.s, err: 'no candles'}); continue; }
    const i0 = B.findIndex(b => b[0] + M5 > t.t0), long = t.side === 'L', e = t.entry, d = Math.abs(e - t.stop0);
    const rr = t.rr > 0 ? t.rr : (t.acct === 'trader' ? 2 : 2), cost = /big|year/.test(t.acct) ? 0.0012 : 0.0028;
    // the bar the trade was entered on: only the part after the entry counts, so start on the next bar for the stop/target checks
    const s0 = Math.max(0, i0 + 1);
    const orig = sim(B, s0, long, e, long ? e - d : e + d, long ? e + rr * d : e - rr * d, cost);
    const mirror = sim(B, s0, !long, e, long ? e + d : e - d, long ? e - rr * d : e + rr * d, cost);
    const swap = sim(B, s0, !long, e, long ? e + rr * d : e - rr * d, long ? e - d : e + d, cost);
    out.push({acct: t.acct, s: t.s, b: t.b, side: t.side, t0: t.t0, R: t.R, rr, stopPct: d / e * 100, orig, mirror, swap,
      f: {st: t.st, tag: t.tag, sc: t.sc, type: t.type || (t.strat === 'smc' ? 'rev' : null), tf: t.tf, regime: t.regime, play: t.play, zoneKind: t.zoneKind, htfBias: t.htfBias,
          q: t.q && t.q.score, grade: t.grd && t.grd.g, dist: t.dist, unlK: t.unlK, exitWhy: t.exitWhy, day: t.day, flow: t.cx && t.cx.flow, mv: t.cx && t.cx.mv, ext: t.cx && t.cx.ext, rsi: t.cx && t.cx.rsi, fund: t.cx && t.cx.fund, volX: t.cx && t.cx.volX}});
  }
}
await Promise.all([work(), work(), work(), work()]);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${out.length} trades replayed (${out.filter(x => x.err).length} without candles) → ${OUT}`);
