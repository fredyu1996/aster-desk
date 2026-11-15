// Year backtest run module (bot/backtest-year.mjs): BTC/ETH-only universe with no tracker, UTC entry features, the ablation
// plan (which switches change the SB account's effective rules), the switches and the raw run. Synthetic fixtures only.
// Run: node tests/bt-year.mjs   (after build.py; no network)
import {yearHour, feats, ablPlan, RAW, ABL, YEAR_COINS} from '../bot/backtest-year.mjs';
import {mkCore, PREP} from '../bot/backtest.mjs';
const H = 3600e3, M15 = 900e3, h = Math.floor(Date.UTC(2026, 10, 10, 12) / H) * H;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); process.exit(1); } };
// coin → 24h move to h; BTC +40% would put it in the small-cap tracker, AAA is not a year coin
const C = {BTCUSDT: 40, ETHUSDT: 2, AAAUSDT: 30}, H1 = {};
for (const [s, mv] of Object.entries(C)) {
  H1[s] = [];
  for (let t = h - 30 * H; t < h; t += H) { const o = 1, c = t === h - H ? 1 + mv / 100 : 1; H1[s].push([t, o, Math.max(o, c), Math.min(o, c), c, 1e9 / 24, 1e9 / 48]); }
}
const ex = {symbols: Object.keys(C).map(s => ({symbol: s, status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT', baseAsset: s.replace('USDT', ''), underlyingSubType: s === 'AAAUSDT' ? [] : ['Top']}))};
// universe: BTC +40% on the day stays tradable, nothing tracked, only YEAR_COINS
const u = yearHour(H1, h, YEAR_COINS);
ok(u.big.join() === 'BTCUSDT,ETHUSDT' && Object.keys(u.trk).length === 0 && !('AAAUSDT' in u.tk), 'BTC +40%: still in the year universe, no tracker');
ok(Math.abs(u.tk.BTCUSDT.pct - 40) < 1e-9, 'tk from closed 1h bars');
// feats under TZ=America/Creston: UTC hour bands + weekday. 15m bars with a constant range of 1% of the close
const d0 = Date.UTC(2026, 10, 13), m15 = [];
for (let t = d0; t < d0 + 16 * H; t += M15) m15.push([t, 100, 100.5, 99.5, 100, 1e6, 5e5]);
const D = {BTCUSDT: {h1: H1.BTCUSDT, m15, m5: []}};
const tr = t0 => ({s: 'BTCUSDT', side: 'L', type: 'rev', tf: '15m', zoneKind: 'OB', entry: 100, stop0: 98.5, rr: 3, q: {score: 70}, grd: {g: 'A'}, regime: 'up', t0});
process.env.TZ = 'America/Creston';
const f13 = feats(tr(Date.UTC(2026, 10, 13, 13, 0)), D, () => 'up'), f1259 = feats(tr(Date.UTC(2026, 10, 13, 12, 59)), D, () => null);
ok(f13.hour === 'NY' && f1259.hour === 'London' && f13.wd === 'Fri' && f13.btc === 'up' && f1259.btc === '?', 'UTC hour band and weekday, btc regime');
ok(Math.abs(f13.atr - 1) < 0.05 && f13.zone === 'OB' && f13.stopBand === '1–2%' && f13.rrBand === '2.5–3.5' && f13.qBand === '65–74', 'ATR% and bands');
ok(f13.mv === null && f13.coin === 'BTCUSDT' && f13.grade === 'A' && f13.regime === 'up' && f13.type === 'rev', 'no 24h ticker at t0 -> mv null; plain fields copied');
// ablation plan: rules in force -> every switch runs; empty state -> minQ and tp1R skipped, no throw
ok(ABL.length === 11, 'ABL has 11 switches');
const P1 = await ablPlan({sm: {cfg: {}}, rv: {smAdj: {needHTF: true, minQ: 70, tp1R: 1.2}}}, ex);
ok(P1.run.length === ABL.length && !P1.skipped.length && P1.snap.cfg.minStopPct === 0.5 && P1.snap.cfg.invExit === 0, 'all switches change the effective rules; snapshot = SB cfg');
const P0 = await ablPlan({}, ex);
ok(P0.skipped.map(s => s.k).sort().join() === 'minQ,tp1R' && P0.skipped.every(s => s.why === 'live value equals the switched value'), 'live = default -> minQ and tp1R listed as skipped');
// each switch hits its rule (as the SB account sees it), RAW clears the Reviewer rules but keeps the regime gate
const sw = k => ABL.find(a => a.k === k).sw;
const eff = async (setup) => { const {X, ctx} = await mkCore(null, ex); ctx.__ST = {cfg: {}, adj: {needHTF: true, minQ: 70}}; X(PREP); X('SB = JSON.parse(JSON.stringify(SB_DEF))'); X(setup); return JSON.parse(X('smWith(SB, () => JSON.stringify({r: smRules(), c: SM.cfg}))')); };
ok((await eff(sw('needHTF'))).r.needHTF === false && (await eff(sw('invExit'))).c.invExit === 1 && (await eff(sw('minStopPct'))).c.minStopPct === 1 && (await eff(sw('regimeGate'))).c.regimeGate === 0, 'switches land on SB');
ok((await eff(sw('minQ'))).r.minQ === 55 && (await eff(sw('cont'))).c.cont === 0 && (await eff(sw('poiRule'))).c.poiRule === 0, 'minQ / cont / poiRule switches');
const raw = await eff(RAW); ok(raw.r.needHTF === false && raw.r.minQ === 55 && raw.c.regimeGate === 1, 'raw run: Reviewer rules off, minQ 55, regime gate on');
console.log('PASS: year backtest checks');
