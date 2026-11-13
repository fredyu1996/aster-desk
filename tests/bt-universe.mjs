// SMC backtest look-ahead check (bot/backtest.mjs): the tracker rebuilt at hour h uses only 1h bars closed by h and picks the
// top 5 per side by the desk's thresholds (volume ≥ $300K, move ≥ 8%); the strategy's view at T holds no bar that closes after T.
// Run: node tests/bt-universe.mjs   (after python3 build.py; no network)
import {mkCore, trkHour, viewAt} from '../bot/backtest.mjs';
const H = 3600e3, M5 = 300e3, h = Math.floor(Date.UTC(2026, 10, 10, 12) / H) * H;
// coin → [24h move to h, 24h quote volume, move inside the bar that opens at h (closes after h)]
const C = {AAAUSDT: [30, 1e6, 0], BBBUSDT: [25, 1e6, 0], CCCUSDT: [20, 1e6, 0], DDDUSDT: [15, 1e6, 0], EEEUSDT: [12, 1e6, 0], FFFUSDT: [10, 1e6, 0],
  THINUSDT: [50, 2e5, 0], SMALLUSDT: [5, 1e6, 0], LATEUSDT: [5, 1e6, 100], DOWNUSDT: [-20, 1e6, 0], BTCUSDT: [40, 1e9, 0]};
const H1 = {};
for (const [s, [mv, qv, late]] of Object.entries(C)) {
  H1[s] = [];
  for (let t = h - 30 * H; t <= h; t += H) { const o = t < h - H ? 1 : t === h - H ? 1 : 1 + mv / 100, c = t < h - H ? 1 : t === h - H ? 1 + mv / 100 : o * (1 + late / 100);
    H1[s].push([t, o, Math.max(o, c), Math.min(o, c), c, qv / 24, qv / 48]); }
}
const ex = {symbols: Object.keys(C).map(s => ({symbol: s, status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT', baseAsset: s.replace('USDT', ''), underlyingSubType: s === 'BTCUSDT' ? ['Top'] : []}))};
const {X, ctx} = await mkCore({trkMinVol: 300000, trkMinMove: 8, minVol: 100000, smallCapOnly: true, includeStocks: false, watch: []}, ex);
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };
const trk = {}, u = trkHour(X, ctx, H1, h, trk), G = Object.keys(u.trk).filter(s => u.trk[s].side === 'G'), L = Object.keys(u.trk).filter(s => u.trk[s].side === 'L');
console.log('at h: gainers', G.join(','), '· losers', L.join(','));
if (G.join() !== 'AAAUSDT,BBBUSDT,CCCUSDT,DDDUSDT,EEEUSDT') fail('top-5 gainers should be AAA..EEE (FFF 6th, THIN under $300K, SMALL < 8%, BTC a top coin, LATE moves after h)');
if (L.join() !== 'DOWNUSDT') fail('DOWN should be the only loser');
if (Math.abs(u.tk.LATEUSDT.pct - 5) > 1e-9) fail('LATE 24h move at h must come from closed bars only (5%), got ' + u.tk.LATEUSDT.pct);
// an hour later the LATE bar has closed: now it is the top gainer, and the rest stay tracked (24 h after leaving the top 5)
const u2 = trkHour(X, ctx, H1, h + H, trk);
if (!(u2.trk.LATEUSDT && u2.trk.LATEUSDT.rank === 1)) fail('LATE should lead the gainers once its bar has closed');
if (!u2.trk.EEEUSDT) fail('a coin that leaves the top 5 stays tracked for 24 h');
// strategy view at T: closed 15m / 1h bars + a forming bar built from 5m bars closed by T
const T = h + 37 * 60e3 - 37 * 60e3 % M5, m5 = [], m15 = [];
for (let t = h - 10 * H; t < h + 2 * H; t += M5) m5.push([t, 1, 1.01, 0.99, 1, 10, 5]);
for (let t = h - 10 * H; t < h + 2 * H; t += 900e3) m15.push([t, 1, 1.01, 0.99, 1, 30, 15]);
const v = viewAt({m5, m15, h1: H1.AAAUSDT}, T);
const closedK = v.k.slice(0, -1), closedH = v.h.slice(0, -1);
if (closedK.some(b => b[0] + 900e3 > T) || closedH.some(b => b[0] + H > T)) fail('view holds a bar that closes after T');
if (v.k.at(-1)[0] !== Math.floor(T / 900e3) * 900e3 || v.h.at(-1)[0] !== Math.floor(T / H) * H) fail('forming bars must start at the current 15m / 1h period');
if (v.h.at(-1)[5] !== m5.filter(b => b[0] >= Math.floor(T / H) * H && b[0] + M5 <= T).length * 10) fail('forming 1h bar must sum only the 5m bars closed by T');
console.log('PASS: tracker picks top 5 per side from closed 1h bars only; the view at T holds no future bar');
