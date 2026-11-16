// GMS v1.3 switches (SM.cfg.gmsA/B/C/D, Nov 15): base + every combination, REPORT ONLY (changes no live rule, writes no shared file).
// Rules in force come from a state.json. GT_PART=week: small caps + big caps over GT_DAYS (default 21); GT_PART=year: SMC Big on
// BTC / ETH over 365 days. Feeds 200 1h bars (BT_H1BARS) so gmsA can read the 4h; without gmsA the desk's 72 are used, as live.
// Usage (after python3 build.py): BT_H1BARS=200 GT_PART=week node tools/smc-gms-test.mjs <state.json> <out.json>
import fs from 'node:fs';
import {mkCore, simulate, klines, aster, pool, trkHour, row, H1_BARS} from '../bot/backtest.mjs';
import {YEAR_COINS, yearHour, needCoins} from '../bot/backtest-year.mjs';
const [, , IN, OUT] = process.argv, PART = process.env.GT_PART || 'week';
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const L4 = ['A', 'B', 'C', 'D'], V = [];
for (let m = 0; m < 16; m++) { const on = L4.filter((_, i) => m & (1 << i)); V.push([on.length ? on.join('') : 'base', on.map(x => `SM.cfg.gms${x} = 1;`).join(' ')]); }
V.sort((a, b) => (a[0] === 'base' ? 0 : a[0].length) - (b[0] === 'base' ? 0 : b[0].length) || a[0].localeCompare(b[0]));
const only = process.env.GT_ONLY ? process.env.GT_ONLY.split(',') : null;
const st3 = A => { const R = A.map(x => x.R); return {n: R.length, avgR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null, totR: +R.reduce((a, b) => a + b, 0).toFixed(2), win: R.length ? Math.round(R.filter(v => v > 0).length / R.length * 100) : null}; };
const f = s => s.n ? `n ${String(s.n).padStart(3)} avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R tot ${String(s.totR).padStart(6)}R` : 'n   0';
const out = {t: Date.now(), part: PART, note: 'GMS switches test — report only, never applied', runs: {}};
const exInfo = await aster('/fapi/v1/exchangeInfo');
const END = Math.floor(Date.now() / M5) * M5;
async function runAll(tag, D, U, steps, isBig, split) {
  for (const [k, setup] of V) {
    if (only && !only.includes(k)) continue;
    const r = await simulate(k, st, exInfo, D, U, steps, setup, new Map(), isBig);
    const A = r.trades.filter(x => x.t1 < split), B = r.trades.filter(x => x.t1 >= split);
    out.runs[`${tag}-${k}`] = {all: st3(r.trades), a: st3(A), b: st3(B), open: r.open, rows: r.trades.map(x => row(x, k))};
    log(`${tag.padEnd(5)} ${k.padEnd(4)}: ${f(st3(r.trades))} | half 1 ${f(st3(A))} | half 2 ${f(st3(B))}`);
    fs.writeFileSync(OUT, JSON.stringify(out));
  }
}
if (PART === 'week') {
  const days = +process.env.GT_DAYS || 21, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H;
  const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]'), H1 = {};
  await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); });
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))], big = [...new Set([...U.values()].flatMap(u => u.big))], D = {};
  await pool([...new Set([...coins, ...big])], 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
  log(`${days} d: ${coins.length} small caps, ${big.length} big caps loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s), ${H1_BARS} 1h bars`);
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  out.days = days;
  await runAll('small', D, U, steps, false, W0 + (END - W0) / 2);
  await runAll('big', D, U, steps, true, W0 + (END - W0) / 2);
} else {
  const days = 365, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H, D = {}, H1 = {};
  await pool(YEAR_COINS, 2, async s => { const h1 = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); D[s] = {h1, m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; H1[s] = h1; });
  needCoins(D); log(`year: candles loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s), ${H1_BARS} 1h bars`);
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  out.days = days;
  await runAll('year', D, U, steps, true, W0 + (END - W0) * 8 / 12);
}
log(`saved ${OUT} (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
