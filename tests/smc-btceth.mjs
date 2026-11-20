// SMC BTC/ETH (SE): the third SMC account, SMC Big's settings on SE_COINS only, run by the same smWith swap as SB.
// Checks the coin list, that SE.cfg is SB's cfg, that an SE tick leaves SM / SB untouched, fault containment, and that SE reviews never reach learning.
// Run: node tests/smc-btceth.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
function desk() {
  const store = {};
  const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
  vm.runInContext(CORE, ctx);
  const X = c => vm.runInContext(c, ctx);
  X('CLOCK_OVR = 1794000000000; SM.created = SB.created = SE.created = 1;');
  return {X, store};
}
// the smc-bigcap fixture (a 15m short setup that SMC Big's settings take), given to BIGUSDT and BTCUSDT; SWEEPUSDT is the tracked small cap
const FIX = `
var T = now(), SYM = 'SWEEPUSDT', rows = [];
for (let i = 0; i < 66; i++) { const c = 1.15 - (1.15 - 0.985) * i / 65, w = 0.004 * (i % 2 ? 1 : 0.6); rows.push([c + 0.002, c + w + 0.003, c - w, c, 30000]); }
rows.push(
 [.985,.99,.975,.978,30000],[.978,.982,.962,.965,30000],[.965,.968,.955,.958,30000],[.958,.962,.950,.953,30000],
 [.953,.970,.955,.968,30000],[.968,.985,.965,.982,30000],[.982,.995,.978,.990,30000],[.990,1.002,.985,.996,30000],
 [.996,.998,.980,.983,30000],[.983,.990,.970,.972,30000],[.972,.978,.960,.963,30000],[.963,.968,.952,.956,30000],
 [.956,.960,.940,.957,45000],
 [.957,.975,.955,.972,95000],[.972,.990,.970,.988,110000],[.988,1.005,.984,1.003,120000],[1.003,1.020,1.000,1.018,100000],
 [1.018,1.03,1.002,1.025,60000],[1.025,1.035,1.015,1.02,50000]);
const lows = [1.012,1.010,1.008,1.006,1.005,1.004,1.003,1.003,1.002,1.002];
lows.forEach((l, i) => rows.push([l + 0.006, l + 0.012 - i * 0.0005, l, l + 0.004, 30000]));
rows.push([1.003, 1.004, 0.995, 0.997, 30000]);
const kb = rows.map((r, i) => [T - (rows.length - i) * 900e3, 2 - r[0], 2 - r[2], 2 - r[1], 2 - r[3], r[4], r[4] * 0.45]);
const hb = []; let hp = 1.6; for (let i = 0; i < 72; i++) { const o = hp; hp = hp * (i % 5 === 4 ? 1.025 : 0.988); hb.push([T - (72 - i) * 3600e3, o, Math.max(o, hp) * 1.003, Math.min(o, hp) * 0.997, hp, 1e5, 5e4]); }
for (const [s, qv] of [[SYM, 2e6], ['BIGUSDT', 5e8], ['BTCUSDT', 9e8]]) {
  S.meta.set(s, {base: s.replace('USDT', '')}); S.kl.set(s, {t: T, bars: kb}); S.h1.set(s, {t: T, bars: hb});
  S.tk.set(s, {last: 1.003, pct: 12, qv}); S.fund.set(s, {r: 0});
}
S.trk[SYM] = {side: 'G', t0: T - 3600e3, px0: 1, rank: 2};
warm = true; S.started = T - 3600e3;
SM.on = true; SM.cfg.minQ = 0;
`;
const snap = (X, A) => X(`JSON.stringify(Object.assign({}, ${A}, {eqs: null, lastScan: ${A}.lastScan && Object.assign({}, ${A}.lastScan, {t: null})}))`);

// ---- coins: 15 eligible big coins, SE reads BTC / ETH only (+ held SE coins); SB still reads its top 10, BTC / ETH included
{
  const {X} = desk();
  X(`for (const s of ['BTCUSDT', 'ETHUSDT', ...Array.from({length: 13}, (_, i) => 'C' + i + 'USDT')]) { S.meta.set(s, {base: s.replace('USDT', '')}); S.tk.set(s, {last: 1, pct: 1, qv: s === 'BTCUSDT' ? 9e9 : s === 'ETHUSDT' ? 8e9 : 1e9}); }`);
  check(X('JSON.stringify(smWith(SE, smCoins))') === '["BTCUSDT","ETHUSDT"]', 'coins: SE reads BTCUSDT + ETHUSDT only', X('JSON.stringify(smWith(SE, smCoins))'));
  const sb = JSON.parse(X('JSON.stringify(smWith(SB, smCoins))'));
  check(sb.length === 10 && sb.includes('BTCUSDT') && sb.includes('ETHUSDT'), 'coins: SB keeps its top 10, BTC / ETH included', sb);
  X(`SE.pos.C5USDT = {side: 'L', qty: 1, entry: 1, stop: 0.9, stop0: 0.9, target: 1.3, t: now(), realized: 0, fees: 0};`);
  check(X('JSON.stringify(smWith(SE, smCoins))') === '["BTCUSDT","ETHUSDT","C5USDT"]', 'coins: a held SE coin stays managed', X('JSON.stringify(smWith(SE, smCoins))'));
  X(`S.meta.delete('ETHUSDT');`);
  check(X('JSON.stringify(seCoins())') === '["BTCUSDT","C5USDT"]', 'coins: a delisted SE coin is skipped', X('JSON.stringify(seCoins())'));
  check(X('smName()') === 'SMC Trader' && X('smWith(SE, smName)') === 'SMC BTC/ETH' && X('smWith(SE, smTag)') === 'SMC BTC/ETH' && X('smWith(SB, smTag)') === 'SMC BIG', 'names: SMC BTC/ETH (alerts too), SB keeps SMC BIG');
}
// ---- cfg: SE.cfg is SB's cfg (SM.cfg + SB_OV), from load on and inside the swap
{
  const {X} = desk();
  check(X('JSON.stringify(SE.cfg) === JSON.stringify(SB.cfg)'), 'cfg: SE.cfg = SB.cfg at load', X('JSON.stringify(SE.cfg)'));
  X('SM.cfg.minQ = 33;');   // a live SM.cfg change reaches both on the next swap
  const a = X('smWith(SE, () => JSON.stringify([SM.cfg, smRules()]))'), b = X('smWith(SB, () => JSON.stringify([SM.cfg, smRules()]))');
  check(a === b && JSON.parse(a)[0].minQ === 33 && JSON.parse(a)[0].minStopPct === 0.5 && JSON.parse(a)[0].fib === 0, 'cfg: inside the swap SE and SB get the same cfg and rules', [a, b]);
  check(X('SE.on') === true && X('SE.start') === 1000 && X('SE !== SB'), 'SE starts on, $1,000, its own object');
  X('var C0 = S.smC;'); X('smWith(SE, () => { S.smC.set("Z", 1); });');
  check(X('S.smC === C0 && S.smCE.get("Z") === 1 && !S.smCB.has("Z") && !C0.has("Z")'), 'cache: SE reads go to S.smCE only');
}
// ---- isolation: an SE tick after SM and SB leaves SM, SB, awx_sm and awx_sb byte-for-byte the same
{
  const A = desk(); A.X(FIX); A.X('smTick(); smWith(SB, smTick);');
  const B = desk(); B.X(FIX); B.X('smTick(); smWith(SB, smTick); smWith(SE, smTick);');
  check(snap(A.X, 'SM') === snap(B.X, 'SM') && A.store.awx_sm === B.store.awx_sm, 'isolation: SM and awx_sm unchanged by the SE tick');
  check(snap(A.X, 'SB') === snap(B.X, 'SB') && A.store.awx_sb === B.store.awx_sb, 'isolation: SB and awx_sb unchanged by the SE tick');
  check(!!B.store.awx_se && !A.store.awx_se, 'isolation: awx_se written by the SE tick only');
  check(B.X('JSON.stringify(Object.keys(SE.pos))') === '["BTCUSDT"]', 'isolation: SE trades BTC (the test bites), never BIGUSDT', B.X('JSON.stringify(SE.lastScan)'));
  check(B.X('SM !== SE && SB !== SE && S.smC !== S.smCE'), 'isolation: globals swapped back');
  B.X('smWith(SE, smReset);');
  check(B.X('Object.keys(SE.pos).length === 0 && SE.cash === 1000') && JSON.parse(B.store.awx_se).cash === 1000 && A.store.awx_sb === B.store.awx_sb && A.store.awx_sm === B.store.awx_sm, 'reset: smWith(SE, smReset) resets and saves SE only');
}
// ---- containment: ptTick runs SE after SB; an SE fault must not stop PT / SM / SB, and an SB fault must not stop SE
{
  const {X} = desk(); X(FIX);
  X('SM.lastScan = SB.lastScan = SE.lastScan = null; seCoins = () => { throw new Error("SE boom"); };');
  let err = null; try { X('ptTick()'); } catch (e) { err = e; }
  check(!err && X('!!(SM.lastScan && SB.lastScan) && SM !== SE && S.smC !== S.smCE'), 'contain: ptTick, SM and SB complete when SE throws', err && err.message);
  const d = desk(); d.X(FIX); d.X('SE.lastScan = null; smBigList = () => { throw new Error("SB boom"); };'); d.X('ptTick()');
  check(d.X('!!SE.lastScan && SE.lastScan.t > 0'), 'contain: SE still ticks when SB throws');
}
// ---- reviews: SE trades are keyed se| and never change what the Reviewer learns
{
  const {X} = desk();
  X(`const mk = (s, i, R) => ({s, b: s.replace('USDT', ''), side: 'L', t0: now() - (60 - i) * 3600e3, t1: now() - (59 - i) * 3600e3 + 1000 * i, entry: 1, exit: 1, qty: 1, notional: 1, pnl: R, R, fees: 0, why: 'x', exitWhy: R > 0 ? 'target' : 'stop loss', stop0: 0.98, maxR: Math.max(R, 0), strat: 'smc', tf: '15m', htfBias: 'bull', q: {score: 70 + i, items: []}});
     SM.log = []; SE.log = []; for (let i = 0; i < 14; i++) { SM.log.push(mk('BTCUSDT', i, i % 3 ? -1 : 1.5)); SE.log.push(mk('BTCUSDT', i, i % 2 ? -1 : 1)); }
     var rev = txt => ({g: 'D', ag: 'disagree', alt: [], x: [], note: txt, imgs: [], t: now()});
     RVM = {}; SM.log.slice(0, 8).forEach(x => { RVM['sm|' + x.s + '|' + x.t1] = rev('should have been a short. poor OB, skip this one'); });`);
  const learn = () => { X('RV.smAdj = {}; RV.smWhy = {}; smLearn();'); return JSON.stringify({adj: X('RV.smAdj'), rules: X('smRules()'), Y: X('youTally(SM.log)'), n: X('rvmLearn().length')}); };
  const base = learn();
  check(X('mineKey(SE.log[0])').startsWith('se|') && X('mineKey(SM.log[0])').startsWith('sm|'), 'reviews: mineKey separates SE from SM trades on the same coin');
  X(`SE.log.forEach(x => { RVM['se|' + x.s + '|' + x.t1] = Object.assign(rev('should have been a short. poor OB, skip, wider stop'), {acct: 'se', alt: ['skip', 'flip']}); });`);
  check(X('SE.log.every(x => mineOf(x))') && learn() === base, 'reviews: 14 SE reviews leave smLearn / smRules / youTally / rvmLearn identical');
}
if (fails) { console.error(fails + ' FAIL'); process.exit(1); }
console.log('PASS: smc-btceth');
