// SMC Big (SB): the second SMC account on the top-10 volume perps, run by swapping the SM global (smWith).
// Checks the coin list, the per-account overrides, restore on throw, and that the small-cap SM is unchanged by an SB tick.
// Run: node tests/smc-bigcap.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
// a fresh desk core in a vm, with a recording localStorage and a fixed clock
function desk() {
  const store = {};
  const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
  vm.runInContext(CORE, ctx);
  const X = c => vm.runInContext(c, ctx);
  X('CLOCK_OVR = 1794000000000; SM.created = SB.created = 1;');   // created is stamped at load, before the clock is fixed
  return {X, store};
}
// the smc-sweep fixture: a 15m short setup on SWEEPUSDT (tracked) with a falling 1h; BIGUSDT (not tracked) gets the same bars
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
for (const [s, qv] of [[SYM, 2e6], ['BIGUSDT', 5e8]]) {
  S.meta.set(s, {base: s.replace('USDT', '')}); S.kl.set(s, {t: T, bars: kb}); S.h1.set(s, {t: T, bars: hb});
  S.tk.set(s, {last: 1.003, pct: 12, qv}); S.fund.set(s, {r: 0});
}
S.trk[SYM] = {side: 'G', t0: T - 3600e3, px0: 1, rank: 2};
warm = true; S.started = T - 3600e3;
SM.on = true; SM.cfg.minQ = 0;
`;
// BIGUSDT is a 'top' coin that the OI/Flow universe skips (smallCapOnly)
const TOP = `CFG.smallCapOnly = true; S.meta.get('BIGUSDT').top = true;`;
const snapSM = X => X(`JSON.stringify(Object.assign({}, SM, {eqs: null, lastScan: SM.lastScan && Object.assign({}, SM.lastScan, {t: null})}))`);

// ---- bigList: top n by quote volume, no stocks, no tracker coins
{
  const {X} = desk();
  X(`for (let i = 0; i < 15; i++) { const s = 'C' + i + 'USDT'; S.meta.set(s, {base: 'C' + i, stock: i === 3 || i === 7}); S.tk.set(s, {last: 1, pct: 1, qv: (i + 1) * 1e6}); }
     S.trk = {C14USDT: {side: 'G'}, C5USDT: {side: 'L'}};`);
  const L = JSON.parse(X('JSON.stringify(smBigList())'));
  const qv = L.map(s => +s.slice(1, -4));
  check(L.length === 10, 'bigList: 10 coins', L);
  check(qv.every((v, i) => !i || v < qv[i - 1]), 'bigList: sorted by qv desc', L);
  check(!L.some(s => ['C3USDT', 'C7USDT', 'C14USDT', 'C5USDT'].includes(s)), 'bigList: no stock, no tracker coin', L);
  X(`for (let i = 5; i < 15; i++) S.meta.delete('C' + i + 'USDT');`);
  check(X('smBigList().length') === 4, 'bigList: 4 eligible → 4', X('JSON.stringify(smBigList())'));
}
// ---- overrides: SB_OV inside the swap, small-cap values outside
{
  const {X} = desk();
  const out = X('smRules().stopBuf');
  const inn = JSON.parse(X('JSON.stringify(smWith(SB, () => ({min: SM.cfg.minStopPct, slip: SM.cfg.slipPct, buf: smRules().stopBuf, name: smName()})))'));
  check(inn.min === 0.5, 'overrides: minStopPct 0.5 in SB', inn);
  check(inn.slip === 0.02, 'overrides: slipPct 0.02 in SB', inn);
  check(Math.abs(inn.buf - 0.25 * out) < 1e-12, 'overrides: stopBuf × 0.25 in SB', [inn.buf, out]);
  check(inn.name === 'SMC Big' && X('smName()') === 'SMC Trader', 'overrides: smName', inn.name);
  check(X('SM.cfg.minStopPct') === 1.5, 'overrides: SM minStopPct 1.5 outside', X('SM.cfg.minStopPct'));
  check(X('SB.on') === true && X('SB.start') === 1000, 'SB starts on, $1,000', X('JSON.stringify([SB.on, SB.start])'));
}
// ---- restore: a throw inside smWith still swaps back
{
  const {X} = desk();
  X('var C0 = S.smC;');
  let threw = false; try { X(`smWith(SB, () => { throw Error('x'); })`); } catch (e) { threw = e.message === 'x'; }
  check(threw, 'restore: the error propagates');
  check(X('SM.cfg.minStopPct') === 1.5 && X('SM !== SB') && X('S.smC === C0'), 'restore: SM and S.smC are back', X('SM.cfg.minStopPct'));
}
// ---- isolation: an SB tick in the same cycle leaves SM state and awx_sm byte-for-byte the same
{
  const A = desk(); A.X(FIX); A.X('smTick();');
  const B = desk(); B.X(FIX); B.X('smTick(); smWith(SB, smTick);');
  check(A.X('Object.keys(SM.pos).length') === 1, 'isolation: the fixture opens one SM trade', A.X('JSON.stringify(SM.lastScan)'));
  check(snapSM(A.X) === snapSM(B.X), 'isolation: SM unchanged by the SB tick');
  check(A.store.awx_sm === B.store.awx_sm, 'isolation: awx_sm unchanged by the SB tick');
  check(!!B.store.awx_sb && !A.store.awx_sb, 'isolation: awx_sb written by the SB tick only');
  check(B.X('JSON.stringify(Object.keys(SB.pos))') === '["BIGUSDT"]', 'isolation: SB trades the big coin only', B.X('JSON.stringify(SB.lastScan)'));
}
// ---- tight stop: the same bars give SM a stop pushed out to its 1.5% minimum, while SB takes the setup with a 0.5–1.5% stop
{
  const {X} = desk(); X(FIX);
  // TIGHTUSDT: the fixture's bars squeezed 5× toward the last price, so the sweep stop sits ~1% away (ratios such as R stay the same)
  X(`{ const k = 0.2, c0 = 1.003, sq = B => B.map(b => [b[0], ...b.slice(1, 5).map(p => c0 + (p - c0) * k), b[5], b[6]]);
     S.meta.set('TIGHTUSDT', {base: 'TIGHT'}); S.kl.set('TIGHTUSDT', {t: T, bars: sq(kb)}); S.h1.set('TIGHTUSDT', {t: T, bars: sq(hb)});
     S.tk.set('TIGHTUSDT', {last: c0, pct: 3, qv: 9e8}); S.fund.set('TIGHTUSDT', {r: 0}); }`);
  const dSM = X(`smcRead('TIGHTUSDT').dist`), dSB = X(`smWith(SB, () => smcRead('TIGHTUSDT').dist)`);
  check(dSM >= 0.015 - 1e-9, 'tight stop: SM stop pushed out to ≥ 1.5%', dSM);   // widened to exactly 1.5%, less float noise
  check(dSB >= 0.005 && dSB < 0.015, 'tight stop: SB stop 0.5–1.5%', dSB);
  X('smWith(SB, smTick);');
  check(X(`!!SB.pos.TIGHTUSDT && SB.pos.TIGHTUSDT.dist < 1.5`), 'tight stop: SB opens it', X('JSON.stringify(SB.lastScan)'));
}
// ---- reset: smWith(SB, smReset) resets SB only; SB.cfg is filled from load on
{
  const {X, store} = desk();
  check(X('SB.cfg.tp1R === SM.cfg.tp1R && SB.cfg.minStopPct === 0.5 && SB.cfg.useScreens === 0'), 'load: SB.cfg = SM.cfg + SB_OV before any swap', X('JSON.stringify(SB.cfg)'));
  X(FIX); X('smTick(); smWith(SB, smTick);');
  const sm0 = store.awx_sm;
  check(X('Object.keys(SB.pos).length') > 0, 'reset: SB holds a trade before the reset');
  X('smWith(SB, smReset);');
  check(store.awx_sm === sm0, 'reset: awx_sm unchanged');
  check(X('Object.keys(SB.pos).length === 0 && SB.cash === 1000 && Object.keys(SM.pos).length === 1'), 'reset: SB reset, SM kept', X('JSON.stringify([Object.keys(SB.pos), SB.cash])'));
  check(JSON.parse(store.awx_sb).cash === 1000 && !Object.keys(JSON.parse(store.awx_sb).pos).length, 'reset: awx_sb saved reset');
}
// ---- cache: an SB read of a coin also in S.trk doesn't replace the small-cap read
{
  const POS = `SB.pos[SYM] = {side: 'S', b: 'SWEEP', qty: 1, qty0: 1, entry: 1.003, stop: 1.5, stop0: 1.5, target: 0.5, t: T, risk: 0.5, realized: 0, fees: 0, exits: [], tf: '15m', holdH: 12, be: false, tp1: false, maxR: 0};`;
  const A = desk(); A.X(FIX); A.X(POS); A.X('smTick();');
  const B = desk(); B.X(FIX); B.X(POS); B.X('smTick(); smWith(SB, smTick);');
  const a = A.X('JSON.stringify(S.smC.get(SYM))'), b = B.X('JSON.stringify(S.smC.get(SYM))');
  check(a === b, 'cache: small-cap S.smC read unchanged');
  check(B.X('JSON.stringify(S.smCB.get(SYM))') !== b, 'cache: the SB read differs (so the test bites)');
}
// ---- universe: S.universe (OI/Flow boards) is unchanged by SB; only pickJob's kl/oi loop also covers SB coins
{
  const {X} = desk(); X(FIX); X(TOP);
  X('recomputeUniverse();');
  const withSB = X('JSON.stringify(S.universe)'), prio = X('JSON.stringify([...S.prio].sort())');
  const big = JSON.parse(X('JSON.stringify(smBigCoins())'));
  check(!X('S.universe.includes("BIGUSDT")'), 'universe: a big cap (top, smallCapOnly) is not on the OI/Flow universe');
  X('smBigCoins = () => []; recomputeUniverse();');
  check(withSB === X('JSON.stringify(S.universe)'), 'universe: S.universe identical with and without SB');
  check(prio === X('JSON.stringify([...S.prio].sort())'), 'universe: S.prio identical with and without SB');
  check(big.length > 0 && big.every(s => typeof s === 'string'), 'universe: smBigCoins() is a list of symbols', big);
  // pickJob schedules kl jobs for SB coins that are not in S.universe
  const d = desk(); d.X(FIX); d.X(TOP); d.X('recomputeUniverse(); G.exinfo = G.tickers = G.funding = Infinity;');
  const only = JSON.parse(d.X('JSON.stringify(smBigCoins().filter(s => !S.universe.includes(s)))'));
  const seen = new Set();
  for (let i = 0; i < 100; i++) { const j = d.X('pickJob()'); if (!j) break; if (j.k === 'kl') seen.add(j.s); d.X(`nextRun.set(${JSON.stringify(j.key)}, Infinity)`); }
  check(only.length > 0 && only.every(s => seen.has(s)), 'pickJob: kl jobs scheduled for SB-only coins', [only, [...seen]]);
}
// ---- containment: an SB-only fault must not stop PT/SM (ptTick completes, SM ticks, SM restored)
{
  const {X} = desk(); X(FIX);
  X('SM.lastScan = null; smBigList = () => { throw new Error("SB boom"); };');
  let err = null; try { X('ptTick()'); } catch (e) { err = e; }
  check(!err, 'contain: ptTick completes when the SB path throws', err && err.message);
  check(X('SM.lastScan && SM.lastScan.t > 0'), 'contain: SM still ticked', X('JSON.stringify(SM.lastScan)'));
  check(X('SM !== SB && S.smC !== S.smCB'), 'contain: SM and S.smC restored');
}
if (fails) { console.error(fails + ' FAIL'); process.exit(1); }
console.log('PASS: smc-bigcap');
