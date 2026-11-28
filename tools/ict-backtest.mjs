// ICT New York-morning reversal (bot/ict.mjs, Fred's patch) on Aster 1m bars. REPORT ONLY.
// Per symbol: tick size from exchangeInfo, pointValue 1 (P&L per 1 unit), minRange = the patch's MNQ ratio (10 pts / ~20,000 = 0.05%)
// of the median price, costs as proportional feeRate (fee 0.04% + half spread) plus adverse slippage ticks on stop / time exits.
// Aster trades 24/7, so there are no venue closures; a missing minute makes that day INCOMPLETE (as the patch says).
// Run: node tools/ict-backtest.mjs   env: ICT_COINS (BTCUSDT,ETHUSDT; any Aster perp, comma-separated), ICT_FROM / ICT_TO (YYYY-MM-DD),
//      ICT_NEWS 0 (do not skip news days), ICT_CACHE (/tmp/ict-cache), ICT_OUT (/tmp/ict-backtest.json)
import fs from 'node:fs';
import {aster, klines} from '../bot/backtest.mjs';
import {backtestIct, MIN} from '../bot/ict.mjs';
import {sessions} from './ict-calendar.mjs';

const COINS = (process.env.ICT_COINS || 'BTCUSDT,ETHUSDT').split(','), FROM = process.env.ICT_FROM || '2025-11-20', TO = process.env.ICT_TO || '2026-11-25';
const CACHE = process.env.ICT_CACHE || '/tmp/ict-cache', OUT = process.env.ICT_OUT || '/tmp/ict-backtest.json', NEWS = process.env.ICT_NEWS !== '0';
const STOCK_SPREAD = 0.02, CRYPTO_SPREAD = +(process.env.ICT_SPREAD || 0.01), FEE = 0.04, SLIP = {stock: 0.05, crypto: +(process.env.ICT_SLIP || 0.02)};   // % per side; small caps: ICT_SLIP=0.1 ICT_SPREAD=0.02 (desk small-cap costs)
fs.mkdirSync(CACHE, {recursive: true});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const cal = sessions(FROM, TO, {news: NEWS});
const t0 = Date.parse(FROM + 'T00:00:00Z') - 864e5, t1 = Date.parse(TO + 'T23:59:00Z') + 864e5;
const split = Date.parse(FROM + 'T00:00:00Z') + (Date.parse(TO + 'T00:00:00Z') - Date.parse(FROM + 'T00:00:00Z')) * 2 / 3;
const ex = await aster('/fapi/v1/exchangeInfo');
const st = a => { if (!a.length) return {n: 0}; let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x.R; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return {n: a.length, win: Math.round(100 * a.filter(x => x.R > 0).length / a.length), avgR: +(eq / a.length).toFixed(3), totR: +eq.toFixed(2), maxDD: +dd.toFixed(2)}; };
const res = [];
for (const s of COINS) {
  const info = ex.symbols.find(x => x.symbol === s); if (!info) { log(s, 'not listed'); continue; }
  const tick = +info.filters.find(f => f.filterType === 'PRICE_FILTER').tickSize, stock = info.symbolType === 1 || (info.underlyingSubType || []).includes('STOCK');
  const f = `${CACHE}/${s}-1m-${t0}-${t1}.json`;
  let K = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  if (!K) { K = await klines(s, '1m', MIN, t0, t1); fs.writeFileSync(f, JSON.stringify(K)); }
  const bars = K.map(b => ({t: b[0] + MIN, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5]}));
  const closes = bars.map(b => b.c).sort((a, b) => a - b), med = closes[closes.length >> 1];
  const minRange = Math.max(tick, Math.round(0.0005 * med / tick) * tick), slipT = Math.max(1, Math.round((stock ? SLIP.stock : SLIP.crypto) / 100 * med / tick));
  const instrument = {symbol: s, tickSize: tick, pointValue: 1, minRange}, costs = {roundTrip: 0, feeRate: (FEE + (stock ? STOCK_SPREAD : CRYPTO_SPREAD)) / 100, stopSlippageTicks: slipT, timeSlippageTicks: slipT};
  // minutes missing inside the study's windows (each makes that day INCOMPLETE)
  log(s, `1m bars ${bars.length} · first ${new Date(bars[0].t).toISOString().slice(0, 10)} · tick ${tick} · median ${med} · minRange ${minRange} · slip ${slipT} ticks`);
  const rep = backtestIct({bars, sessions: cal, closures: [], instrument, costs});
  const days = rep.days, trades = rep.trades.map(x => Object.assign({}, x));
  const why = {}; for (const d of days) { const k = d.status + (d.reason ? ':' + d.reason : ''); why[k] = (why[k] || 0) + 1; }
  res.push({s, stock, instrument, costs, why, trades, all: st(trades), a: st(trades.filter(x => x.t0 < split)), b: st(trades.filter(x => x.t0 >= split)),
    long: st(trades.filter(x => x.side === 'long')), short: st(trades.filter(x => x.side === 'short')),
    exits: Object.fromEntries(['Target', 'Stop', 'Time exit'].map(w => [w, st(trades.filter(x => x.why === w))])), ambiguous: trades.filter(x => x.ambiguous).length,
    days: days.map(d => ({date: d.date, status: d.status, reason: d.reason || null, dir: d.context && d.context.direction, entry: d.plan && d.plan.entry, R: d.trade && +d.trade.R.toFixed(3)}))});
}
const allT = res.flatMap(r => r.trades.map(x => Object.assign({sym: r.s}, x))).sort((a, b) => a.t0 - b.t0);
const sum = {from: FROM, to: TO, split: new Date(split).toISOString().slice(0, 10), news: NEWS, sessions: cal.length, all: st(allT), a: st(allT.filter(x => x.t0 < split)), b: st(allT.filter(x => x.t0 >= split))};
fs.writeFileSync(OUT, JSON.stringify({sum, coins: res}, null, 1));
const fm = x => x && x.n ? `n ${x.n} · win ${x.win}% · avg ${x.avgR >= 0 ? '+' : ''}${x.avgR}R · total ${x.totR >= 0 ? '+' : ''}${x.totR}R · maxDD ${x.maxDD}R` : 'n 0';
console.log(`\nICT NY AM reversal on Aster ${FROM} → ${TO} · ${cal.length} sessions · news days ${NEWS ? 'skipped' : 'kept'} · halves split ${sum.split}`);
for (const r of res) {
  console.log(`\n${r.s}${r.stock ? ' (stock perp)' : ''}  ALL ${fm(r.all)}\n  half 1 ${fm(r.a)}\n  half 2 ${fm(r.b)}\n  long ${fm(r.long)}\n  short ${fm(r.short)}`);
  for (const [w, x] of Object.entries(r.exits)) console.log('  exit', w.padEnd(9), fm(x));
  console.log('  ambiguous fills', r.ambiguous, '· days', JSON.stringify(r.why));
}
console.log(`\nALL COINS ${fm(sum.all)}\n  half 1 ${fm(sum.a)}\n  half 2 ${fm(sum.b)}\nwritten ${OUT}`);
