// SMC year backtest on BTC / ETH (spec: docs/superpowers/specs/2026-11-14-smc-year-backtester-design.md). REPORT ONLY:
// never changes live rules or the shared account. Runs bot/backtest.mjs simulate() as the SMC Big (SB) account over the last
// year: a base run (rules in force), a raw run (Reviewer rules off, for the pattern finder), one run per rule switch (ablation),
// then entry features per trade and the year-report.mjs statistics.
// The workflow runs it through bot/backtest.mjs main(). Standalone, local only (real Aster candles, no GitHub):
//   STATE_IN=<state.json> BT_OUT=<out.json> [BT_YEAR_DAYS=3] node bot/backtest-year.mjs   (BT_YEAR_DAYS default 365)
import fs from 'node:fs'; import path from 'node:path'; import {fileURLToPath} from 'node:url';
import {mkCore, simulate, klines, aster, pool, row, nClosed, tkAt, PREP} from './backtest.mjs';
import {sumRun, findPatterns, ablation, months, exits, terciles, fitSize} from './year-report.mjs';

export const YEAR_COINS = ['BTCUSDT', 'ETHUSDT'], YEAR_FILE = 'smc-backtest-year.json';
const H = 3600e3, M5 = 300e3, M15 = 900e3;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const RAW = 'RV.smAdj = {}; SM.cfg.minQ = SM_DEF.cfg.minQ;';
const tog = k => `if (RV.smAdj.${k}) delete RV.smAdj.${k}; else RV.smAdj.${k} = true;`;
// one switch per rule, run after PREP (+ the fresh SB account); each flips the live value
export const ABL = [
  {k: 'needHTF', lab: 'HTF must agree (Reviewer needHTF)', sw: tog('needHTF')},
  {k: 'needPOI', lab: 'Only from an HTF zone or swing (Reviewer needPOI)', sw: tog('needPOI')},
  {k: 'needDepth', lab: 'Midpoint / deeper entries (Reviewer needDepth)', sw: tog('needDepth')},
  {k: 'obQ', lab: 'Order blocks need quality + 10 (Reviewer obQ)', sw: tog('obQ')},
  {k: 'poiRule', lab: 'POI needed when the HTF isn\'t trending the trade\'s way (cfg poiRule)', sw: 'SM.cfg.poiRule = SM.cfg.poiRule ? 0 : 1;'},
  {k: 'minQ', lab: 'Quality bar: live vs the default (also lowers the OB bar, minQ + 10)', sw: 'SM.cfg.minQ = SM_DEF.cfg.minQ; delete RV.smAdj.minQ;'},
  {k: 'tp1R', lab: 'Half off at the live tp1R vs the default', sw: 'SM.cfg.tp1R = SM_DEF.cfg.tp1R; delete RV.smAdj.tp1R;'},
  {k: 'invExit', lab: 'Exit when a candle closes through the entry gap (invExit)', sw: 'SB_OV.invExit = SB_OV.invExit ? 0 : 1;'},
  {k: 'minStopPct', lab: 'Minimum stop 0.5% vs 1%', sw: 'SB_OV.minStopPct = SB_OV.minStopPct === 1 ? 0.5 : 1;'},
  {k: 'cont', lab: 'Continuation setups (cfg cont / Reviewer noCont)', sw: 'SM.cfg.cont = SM.cfg.cont && !RV.smAdj.noCont ? 0 : 1; if (SM.cfg.cont) delete RV.smAdj.noCont;'},
  {k: 'regimeGate', lab: 'HTF regime gate (smRegime)', sw: 'SM.cfg.regimeGate = SM.cfg.regimeGate === 0 ? 1 : 0;'},
  {k: 'gmsC', lab: 'GMS supply/demand zones for the POI and room (gmsC, SMC Big on since Nov 15)', sw: 'SB_OV.gmsC = SB_OV.gmsC ? 0 : 1;'},
];

// the universe at hour mark h: only the year coins, no tracker, so smBigList inside simulate sees just these
export function yearHour(H1, h, coins) {
  const tk = {}; for (const s of coins) { const t = H1[s] && tkAt(H1[s], h); if (t) tk[s] = t; }
  return {tk, trk: {}, big: coins.filter(s => s in tk)};
}
// a coin that failed to load would leave a report still labelled BTC / ETH (and no BTC regime): fail the year run instead
export function needCoins(D, coins = YEAR_COINS) {
  const miss = coins.filter(s => !D[s] || !D[s].h1.length || !D[s].m15.length || !D[s].m5.length);
  if (miss.length) throw new Error('year: missing candles for ' + miss.join(','));
}

const band = (v, cuts, labs) => { for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return labs[i]; return labs[cuts.length]; };
const fin = v => typeof v === 'number' && isFinite(v);
// ATR(14) as % of the last close, simple mean of the true ranges of the last 14 bars closed by t
function atrPct(B, len, t) {
  const n = B ? nClosed(B, len, t) : 0; if (n < 15) return null;
  let s = 0; for (let i = n - 14; i < n; i++) s += Math.max(B[i][2] - B[i][3], Math.abs(B[i][2] - B[i - 1][4]), Math.abs(B[i][3] - B[i - 1][4]));
  return s / 14 / B[n - 1][4] * 100;
}
// entry features of one SM.log trade (Row.f); hour band and weekday in UTC whatever the process TZ
export function feats(x, D, btcReg) {
  const t = x.t0, d = new Date(t), C = D[x.s] || {}, hr = d.getUTCHours(), stopPct = Math.abs(x.entry - x.stop0) / x.entry * 100;
  const tk = C.h1 ? tkAt(C.h1, Math.floor(t / H) * H) : null;
  return {coin: x.s, side: x.side, type: x.type || 'rev', tf: x.tf, zone: x.zoneKind === 'FVG' ? 'FVG' : 'OB',
    qBand: x.q && fin(x.q.score) ? band(x.q.score, [65, 75], ['<65', '65–74', '75+']) : '?',
    grade: (x.grd && x.grd.g) || '?', regime: x.regime || '?',
    hour: band(hr, [8, 13, 21], ['Asia', 'London', 'NY', 'late']), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()],
    atr: x.tf === '1h' ? atrPct(C.h1, H, t) : atrPct(C.m15, M15, t), mv: tk ? Math.abs(tk.pct) : null,
    rrBand: !fin(x.rr) ? '?' : x.rr < 2.5 ? '<2.5' : x.rr <= 3.5 ? '2.5–3.5' : '>3.5',
    stopBand: !fin(stopPct) ? '?' : band(stopPct, [1, 2], ['<1%', '1–2%', '≥2%']), btc: btcReg(t) || '?'};
}

// which ABL switches change the SB account's effective rules tonight, and the rules snapshot (one core)
export async function ablPlan(st, exInfo) {
  const {ctx, X} = await mkCore(st.cfg, exInfo);
  ctx.__ST = {cfg: (st.sm && st.sm.cfg) || {}, adj: (st.rv && st.rv.smAdj) || {}};
  const reset = () => X(`${PREP}\nSB = JSON.parse(JSON.stringify(SB_DEF));`), eff = () => X('smWith(SB, () => JSON.stringify([smRules(), SM.cfg]))');
  reset();
  const ov = X('JSON.stringify(SB_OV)'), e0 = eff(), snap = JSON.parse(X('smWith(SB, () => JSON.stringify({cfg: SM.cfg, adj: RV.smAdj}))'));
  const run = [], skipped = [];
  for (const a of ABL) {
    X(a.sw); const changed = eff() !== e0;
    reset(); X(`Object.assign(SB_OV, ${ov})`);   // PREP does not reset SB_OV
    if (changed) run.push(a); else skipped.push({k: a.k, lab: a.lab, why: 'live value equals the switched value'});
  }
  return {run, skipped, snap};
}

const fmt = s => s.n ? `n ${s.n} avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R win ${s.win}% tot ${s.totR}R maxDD ${s.maxDD}R` : 'n 0';

export async function yearRun(st, exInfo, {days, deadline}) {
  const T0 = Date.now(), sec = () => ((Date.now() - T0) / 1e3).toFixed(0) + ' s';
  const END = Math.floor(Date.now() / M5) * M5, W0 = END - days * 24 * H, h0 = Math.floor(W0 / H) * H, tSplit = W0 + (END - W0) * 8 / 12;
  const D = {}, H1 = {};
  await pool(YEAR_COINS, 2, async s => { const h1 = await klines(s, '1h', H, h0 - 96 * H, END); D[s] = {h1, m15: await klines(s, '15m', M15, h0 - 100 * M15, END), m5: await klines(s, '5m', M5, h0 - H, END)}; H1[s] = h1; });
  needCoins(D); log(`year: ${Object.keys(D).join(',')} candles loaded, ${days} d (${sec()})`);
  const U = new Map(); for (let h = h0; h <= END; h += H) U.set(h, yearHour(H1, h, YEAR_COINS));
  const steps = []; for (let T = W0 + M5; T <= END; T += M5) steps.push(T);
  const sim = (k, setup) => simulate(k, st, exInfo, D, U, steps, setup, new Map(), true);
  const base = await sim('base', ''); log(`year base: ${base.trades.length} trades (${sec()})`);
  const raw = await sim('raw', RAW); log(`year raw: ${raw.trades.length} trades (${sec()})`);
  const plan = await ablPlan(st, exInfo), runs = [], skipped = [...plan.skipped];
  for (const a of plan.run) {
    if (Date.now() >= deadline) { skipped.push({k: a.k, lab: a.lab, why: 'out of time'}); continue; }
    const r = await sim(a.k, a.sw); runs.push({k: a.k, lab: a.lab, rows: r.trades.map(x => row(x, a.k))}); log(`year ablation ${a.k}: ${r.trades.length} trades (${sec()})`);
  }
  // BTC's 1h regime at t, from its last 71 closed 1h bars (the same read the strategy makes)
  const {ctx, X} = await mkCore(null, exInfo), bh = D.BTCUSDT && D.BTCUSDT.h1;
  const btcReg = t => { if (!bh) return null; const n = nClosed(bh, H, t); ctx.__B = bh.slice(Math.max(0, n - 71), n); return X('(smRegime(__B) || {}).reg || null'); };
  const rows = (r, v) => { const R = r.trades.map(x => Object.assign(row(x, v), {f: feats(x, D, btcReg)})); terciles(R, 'atr', 'atrT'); terciles(R, 'mv', 'mvT'); return R; };
  const baseRows = rows(base, 'base'), rawRows = rows(raw, 'raw');
  const sum = {t: Date.now(), from: W0, to: END, split: tSplit, days, coins: YEAR_COINS, runS: Math.round((Date.now() - T0) / 1e3), snap: plan.snap,
    base: {...sumRun(baseRows, tSplit), open: base.open}, raw: {...sumRun(rawRows, tSplit), open: raw.open},
    note: 'Backtest — report only, never changes live rules. SMC Big settings on BTC / ETH, one $1,000 account, 5m steps; same fills, fees and slippage as the 7-day backtest.',
    fundingNote: 'Funding is not charged (no funding history in the backtest).'};
  return fitSize({v: 1, sum, abl: ablation(baseRows, runs, tSplit), skipped, pat: findPatterns(rawRows, tSplit),
    months: {base: months(baseRows), raw: months(rawRows)}, exits: {base: exits(baseRows), raw: exits(rawRows)}, trades: [...baseRows.slice(-200), ...rawRows.slice(-200)].sort((a, b) => a.t0 - b.t0)});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const IN = process.env.STATE_IN, OUT = process.env.BT_OUT;
  if (!IN || !OUT) { console.error('standalone runs are local only; the workflow runs the year mode via bot/backtest.mjs'); process.exit(1); }
  try {
    const st = JSON.parse(fs.readFileSync(IN, 'utf8').replace(/^﻿/, ''));
    const file = await yearRun(st, await aster('/fapi/v1/exchangeInfo'), {days: +process.env.BT_YEAR_DAYS || 365, deadline: Infinity});
    fs.writeFileSync(OUT, JSON.stringify(file));
    const s = file.sum;
    console.log([`SMC year backtest ${s.days}d ${new Date(s.from).toISOString().slice(0, 16)} → ${new Date(s.to).toISOString().slice(0, 16)} UTC · ${s.coins.join('/')} · ${s.runS} s`,
      `base: ${fmt(s.base.all)} (open at end ${s.base.open}, not counted)`, `raw : ${fmt(s.raw.all)} (open at end ${s.raw.open}, not counted)`,
      ...file.abl.map(a => `ablation ${a.k.padEnd(10)}: ${fmt(a.sw.all)} · Δavg ${a.dAvg == null ? '—' : a.dAvg.toFixed(2) + 'R'} Δtot ${a.dTot}R · ${a.label}`),
      ...file.skipped.map(a => `ablation ${a.k.padEnd(10)}: skipped (${a.why})`)].join('\n'));
    log(`saved ${OUT} (${JSON.stringify(file).length} bytes)`);
  } catch (e) { console.error('YEAR BACKTEST FAILED:', e.stack || e.message); process.exit(1); }
}
