// Fibonacci confluence switch (SM.cfg.fib, Nov 19): base + fib 1 / 2 / 3, REPORT ONLY (changes no live rule, writes no shared file).
// fib 1 = zone on / within 0.1 ATR of 0.5, 0.618 or 0.79 of the impulse leg; 2 = zone overlaps the 0.618–0.79 band; 3 = pick prefers
// a zone on a level (see the comment above SM_FIB in src/smc.js). Every trade carries zone.fibHit, so each run is also split by level.
// Rules in force come from a state.json. GT_PART=week: small caps + big caps over GT_DAYS (default 21); GT_PART=year: SMC Big on
// BTC / ETH over 365 days. GT_END pins the window end (ms) so runs are comparable; GT_OLD=<dir holding a pre-change backtest.mjs +
// core.js> adds "base-old" on the same candles (fib 0 must reproduce it trade for trade). GT_ONLY=base,fib1 limits the variants.
// Usage (after build.py): GT_PART=week node tools/smc-fib-test.mjs <state.json> <out.json>
import fs from 'node:fs'; import {pathToFileURL} from 'node:url';
import {mkCore, simulate, klines, aster, pool, trkHour, row, H1_BARS, PREP} from '../bot/backtest.mjs';
import {YEAR_COINS, yearHour, needCoins} from '../bot/backtest-year.mjs';
const [, , IN, OUT] = process.argv, PART = process.env.GT_PART || 'week';
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// SB_OV.fib too: SMC Big takes SM.cfg + SB_OV, so SM.cfg.fib alone would not reach it (each simulate runs a fresh core)
const V = [['base', ''], ...[0, 1, 2, 3].map(n => [`fib${n}`, `SM.cfg.fib = ${n}; SB_OV.fib = ${n};`])];
const only = process.env.GT_ONLY ? process.env.GT_ONLY.split(',') : null;
const old = process.env.GT_OLD ? await import(pathToFileURL(process.env.GT_OLD.replace(/[\\/]$/, '') + '/backtest.mjs').href) : null;
const st3 = A => { const R = A.map(x => x.R); return {n: R.length, avgR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null, totR: +R.reduce((a, b) => a + b, 0).toFixed(2), win: R.length ? Math.round(R.filter(v => v > 0).length / R.length * 100) : null}; };
const f = s => s.n ? `n ${String(s.n).padStart(3)} avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R tot ${String(s.totR).padStart(6)}R` : 'n   0';
const fh = x => x.zone && typeof x.zone.fibHit === 'string' ? x.zone.fibHit : null;
const byFib = T => ({none: st3(T.filter(x => fh(x) === '')), any: st3(T.filter(x => fh(x))), ...Object.fromEntries(['0.5', '0.618', '0.79'].map(l => [l, st3(T.filter(x => (fh(x) || '').split(',').includes(l)))])), untagged: st3(T.filter(x => fh(x) === null))});
const out = {t: Date.now(), part: PART, note: 'Fibonacci confluence test (SM.cfg.fib) — report only, never applied', runs: {}, cfg: {}};
const exInfo = await aster('/fapi/v1/exchangeInfo');
const END = +process.env.GT_END || Math.floor(Date.now() / M5) * M5;
// the cfg each account really trades with under each variant (SMC Big = SM.cfg + SB_OV, rebuilt by smWith)
async function cfgCheck() {
  const {ctx, X} = await mkCore(st.cfg, exInfo); ctx.__ST = {cfg: (st.sm && st.sm.cfg) || {}, adj: (st.rv && st.rv.smAdj) || {}};
  const pick = 'c => ({fib: c.fib, gmsA: c.gmsA, gmsB: c.gmsB, gmsC: c.gmsC, gmsD: c.gmsD, obPick: c.obPick, regimeGate: c.regimeGate})';
  for (const [k, setup] of V) { X(PREP); X(setup); out.cfg[k] = JSON.parse(X(`JSON.stringify({small: (${pick})(SM.cfg), big: smWith(SB, () => (${pick})(SM.cfg))})`)); log(`cfg ${k}: ${JSON.stringify(out.cfg[k])}`); }
}
async function runAll(tag, D, U, steps, isBig, split) {
  const runs = [...V, ...(old ? [['base-old', '']] : [])];
  for (const [k, setup] of runs) {
    if (only && !only.includes(k)) continue;
    const r = await (k === 'base-old' ? old.simulate : simulate)(k, st, exInfo, D, U, steps, setup, new Map(), isBig);
    const A = r.trades.filter(x => x.t1 < split), B = r.trades.filter(x => x.t1 >= split);
    out.runs[`${tag}-${k}`] = {all: st3(r.trades), a: st3(A), b: st3(B), byFib: byFib(r.trades), open: r.open, rows: r.trades.map(x => Object.assign(row(x, k), {fibHit: fh(x)}))};
    log(`${tag.padEnd(5)} ${k.padEnd(8)}: ${f(st3(r.trades))} | half 1 ${f(st3(A))} | half 2 ${f(st3(B))}`);
    fs.writeFileSync(OUT, JSON.stringify(out));
  }
  const b = out.runs[`${tag}-base`], o = out.runs[`${tag}-base-old`];
  if (b && o) { const key = x => [x.s, x.side, x.t0, x.t1, x.R].join('|'), same = b.rows.length === o.rows.length && b.rows.every((x, i) => key(x) === key(o.rows[i]));
    out.runs[`${tag}-base`].sameAsOld = same; log(`${tag}: fib 0 base vs pre-change base, trade for trade: ${same ? 'IDENTICAL' : 'DIFFERENT'}`); fs.writeFileSync(OUT, JSON.stringify(out)); }
}
await cfgCheck();
if (PART === 'week') {
  const days = +process.env.GT_DAYS || 21, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H;
  const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]'), H1 = {};
  await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); });
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))], big = [...new Set([...U.values()].flatMap(u => u.big))], D = {};
  await pool([...new Set([...coins, ...big])], 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
  log(`${days} d to ${new Date(END).toISOString()}: ${coins.length} small caps, ${big.length} big caps loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s), ${H1_BARS} 1h bars`);
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  Object.assign(out, {days, end: END});
  await runAll('small', D, U, steps, false, W0 + (END - W0) / 2);
  await runAll('big', D, U, steps, true, W0 + (END - W0) / 2);
} else {
  const days = 365, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H, D = {}, H1 = {};
  await pool(YEAR_COINS, 2, async s => { const h1 = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); D[s] = {h1, m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; H1[s] = h1; });
  needCoins(D); log(`year to ${new Date(END).toISOString()}: candles loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s), ${H1_BARS} 1h bars`);
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  Object.assign(out, {days, end: END});
  await runAll('year', D, U, steps, true, W0 + (END - W0) * 8 / 12);
}
log(`saved ${OUT} (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
