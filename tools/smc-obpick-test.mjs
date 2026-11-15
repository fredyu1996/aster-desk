// Test of SM.cfg.obPick (good-OB pick, Nov 15) against the live pick. REPORT ONLY: changes no live rule, writes no shared file.
// Runs the backtest engine (bot/backtest.mjs simulate) with the rules in force from a state.json, three variants:
//   base (live pick) · obPick · obPick without the obQ bar · noWeakOB (obPick 2: live pick, but no OB entry where the leg left no FVG) · only1h / only15m (entry timeframe).
//   OBT_ONLY=base,noWeakOB picks variants; OBT_ACCT=small,big picks accounts. Small caps (SMC Trader) and big caps (SMC Big) over the last
//   OBT_DAYS days (default 14), and SMC Big on BTC / ETH over OBT_YEAR_DAYS (default 365; 0 skips).
// Usage (after python3 build.py; needs network to Aster): node tools/smc-obpick-test.mjs <state.json> <out.json>
import fs from 'node:fs';
import {mkCore, simulate, klines, aster, pool, trkHour, row, H1_BARS} from '../bot/backtest.mjs';
import {YEAR_COINS, yearHour, needCoins, RAW} from '../bot/backtest-year.mjs';
const [, , IN, OUT] = process.argv;
if (!IN || !OUT) { console.error('usage: node tools/smc-obpick-test.mjs <state.json> <out.json>'); process.exit(2); }
const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
const H = 3600e3, M5 = 300e3, M15 = 900e3, T0 = Date.now(), log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const V = [['base', ''], ['obPick', 'SM.cfg.obPick = 1; SB_OV.obPick = 1;'], ['obPickNoQ', 'SM.cfg.obPick = 1; SB_OV.obPick = 1; delete RV.smAdj.obQ;'], ['noWeakOB', 'SM.cfg.obPick = 2; SB_OV.obPick = 2;'], ['only1h', 'SM.cfg.tf15 = 0;'], ['only15m', 'SM.cfg.tf1h = 0;'], ['raw', RAW], ['only1hRaw', RAW + ' SM.cfg.tf15 = 0;'], ['only15mRaw', RAW + ' SM.cfg.tf1h = 0;']].filter(v => !process.env.OBT_ONLY || process.env.OBT_ONLY.split(',').includes(v[0]));
const st3 = A => { const R = A.map(x => x.R); return {n: R.length, avgR: R.length ? +(R.reduce((a, b) => a + b, 0) / R.length).toFixed(3) : null, totR: +R.reduce((a, b) => a + b, 0).toFixed(2), win: R.length ? Math.round(R.filter(v => v > 0).length / R.length * 100) : null}; };
const split = T => ({all: st3(T), FVG: st3(T.filter(x => x.zoneKind === 'FVG')), OB: st3(T.filter(x => x.zoneKind !== 'FVG')), OBovl: st3(T.filter(x => x.zone && x.zone.ovl))});
const f = s => s.n ? `n ${s.n} avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R tot ${s.totR}R win ${s.win}%` : 'n 0';
const out = {t: Date.now(), note: 'obPick test — report only, never applied', runs: {}};
const exInfo = await aster('/fapi/v1/exchangeInfo');
const days = +process.env.OBT_DAYS || 14, yDays = process.env.OBT_YEAR_DAYS === '0' ? 0 : +process.env.OBT_YEAR_DAYS || 365;

if (days) {   // small caps + big caps, the same loading as bot/backtest.mjs weekRun
  const END = Math.floor(Date.now() / M5) * M5, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H;
  const uc = await mkCore(st.cfg, exInfo), syms = uc.X('[...S.meta.keys()]'), H1 = {};
  await pool(syms, 4, async s => { H1[s] = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); });
  const U = new Map(), trk = {};
  for (let h = h0 - 24 * H; h <= END; h += H) { const u = trkHour(uc.X, uc.ctx, H1, h, trk); if (h >= h0) U.set(h, u); }
  const coins = [...new Set([...U.values()].flatMap(u => Object.keys(u.trk)))], big = [...new Set([...U.values()].flatMap(u => u.big))], D = {};
  await pool([...new Set([...coins, ...big])], 4, async s => { D[s] = {h1: H1[s], m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; });
  log(`${days} d: ${coins.length} small caps, ${big.length} big caps loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  for (const [acct, isBig] of [['small', false], ['big', true]].filter(a => !process.env.OBT_ACCT || process.env.OBT_ACCT.split(',').includes(a[0]))) for (const [k, setup] of V) {
    const r = await simulate(k, st, exInfo, D, U, steps, setup, new Map(), isBig);
    out.runs[`${acct}-${k}`] = {days, ...split(r.trades), open: r.open, rows: r.trades.map(x => Object.assign(row(x, k), {ovl: x.zone && x.zone.ovl ? 1 : 0}))};
    log(`${acct} ${k.padEnd(9)}: ${f(out.runs[`${acct}-${k}`].all)} · FVG ${f(out.runs[`${acct}-${k}`].FVG)} · OB ${f(out.runs[`${acct}-${k}`].OB)}`);
  }
}
if (yDays) {   // SMC Big on BTC / ETH, the same loading as bot/backtest-year.mjs yearRun
  const END = Math.floor(Date.now() / M5) * M5, W0 = END - yDays * 24 * H, h0 = Math.floor(W0 / H) * H, tSplit = W0 + (END - W0) * 8 / 12, D = {}, H1 = {};
  await pool(YEAR_COINS, 2, async s => { const h1 = await klines(s, '1h', H, h0 - (H1_BARS + 24) * H, END); D[s] = {h1, m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; H1[s] = h1; });
  needCoins(D); log(`year: candles loaded (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  for (const [k, setup] of V) {
    const r = await simulate(k, st, exInfo, D, U, steps, setup, new Map(), true);
    const A = r.trades.filter(x => x.t1 < tSplit), B = r.trades.filter(x => x.t1 >= tSplit);
    out.runs[`year-${k}`] = {days: yDays, ...split(r.trades), a: split(A), b: split(B), open: r.open, rows: r.trades.map(x => Object.assign(row(x, k), {ovl: x.zone && x.zone.ovl ? 1 : 0}))};
    log(`year ${k.padEnd(9)}: ${f(out.runs[`year-${k}`].all)} · first 8 mo ${f(out.runs[`year-${k}`].a.all)} · last 4 mo ${f(out.runs[`year-${k}`].b.all)} · OB ${f(out.runs[`year-${k}`].OB)}`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(out));
log(`saved ${OUT} (${((Date.now() - T0) / 1e3).toFixed(0)} s)`);
