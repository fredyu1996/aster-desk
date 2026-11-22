// SMC Pattern (v1.4) (SP): the fourth SMC account, SMC Trader settings + SP_OV (pat1h 2, closedOnly 1), on the hour's top 10 gainers + top 10 losers.
// Checks SP's cfg, that the other accounts keep every new switch at 0, the coin picker, the hourly list, the 5m feed list, isolation and review keys.
// Run: node tests/smc-sp.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
function desk() {
  const store = {};
  const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
  vm.runInContext(CORE, ctx);
  const X = c => vm.runInContext(c, ctx);
  X('CLOCK_OVR = 1794000000000; SM.created = SB.created = SE.created = SP.created = 1;');
  return {X, store};
}
// 30 synthetic tickers: pct -14..+15, every 3rd one under the $300K floor
const TK = `var TKS = Array.from({length: 30}, (_, i) => ({s: 'C' + i + 'USDT', pct: i - 14, qv: i % 3 === 0 ? 2e5 : 1e6}));
  for (const x of TKS) { S.meta.set(x.s, {base: x.s.replace('USDT', '')}); S.tk.set(x.s, {last: 1, pct: x.pct, qv: x.qv}); }
  S.eligible = TKS.map(x => x.s);`;
// ---- cfg: SP = SMC Trader cfg + SP_OV; SM / SB / SE keep every new switch at 0
{
  const {X} = desk();
  const c = JSON.parse(X('JSON.stringify(SP.cfg)'));
  check(c.pat1h === 2 && c.closedOnly === 1 && c.ltf5m === 0 && c.fib === 0 && c.gmsB === 1 && c.gmsD === 1, 'cfg: SP pat1h 2, closedOnly 1, ltf5m 0, fib 0, gmsB / gmsD 1', c);
  const rest = JSON.parse(X('JSON.stringify(Object.assign({}, SM.cfg, SP_OV))'));
  check(JSON.stringify(c) === JSON.stringify(rest) && c.minStopPct === 1.5 && c.riskPct === 1 && c.maxPos === 3, 'cfg: every other SP setting is the SMC Trader\'s', c);
  check(X('SP.on') === true && X('SP.start') === 1000 && X('SP.sp1122') === 1 && X('SP !== SB && SP !== SE'), 'SP starts on, $1,000, own object, migration flag sp1122 set');
  for (const A of ['SM', 'SB', 'SE']) { const k = JSON.parse(X(`JSON.stringify(${A}.cfg)`)); check(k.pat1h === 0 && k.closedOnly === 0 && k.ltf5m === 0 && k.retestExp === 0, `cfg: ${A} pat1h 0, closedOnly 0, ltf5m 0, retestExp 0`, k); }
  check(X('smWith(SP, () => JSON.stringify(SM.cfg)) === JSON.stringify(SP.cfg) && SM.cfg.pat1h === 0'), 'cfg: inside the swap SM.cfg is SP\'s, swapped back after');
  check(X('smWith(SP, smName)') === 'SMC Pattern (v1.4)' && X('smWith(SP, smKey)') === 'sp' && X('smKey()') === 'sm', 'names: SMC Pattern (v1.4), key sp');
  X('var C0 = S.smC;'); X('smWith(SP, () => { S.smC.set("Z", 1); });');
  check(X('S.smC === C0 && S.smCP.get("Z") === 1 && !S.smCB.has("Z") && !S.smCE.has("Z") && !C0.has("Z")'), 'cache: SP reads go to S.smCP only');
}
// ---- coin picker: top 10 up + top 10 down above the volume floor
{
  const {X} = desk(); X(TK);
  const got = JSON.parse(X('JSON.stringify(spPick(TKS, 3e5))'));
  const above = Array.from({length: 30}, (_, i) => i).filter(i => i % 3).map(i => ({s: 'C' + i + 'USDT', p: i - 14})).sort((a, b) => b.p - a.p);
  const want = [...above.slice(0, 10), ...above.slice(10).reverse().slice(0, 10)].map(x => x.s);
  check(JSON.stringify(got) === JSON.stringify(want) && got.length === 20 && new Set(got).size === 20, 'pick: top 10 gainers + top 10 losers, no duplicates', got);
  check(got.every(s => +s.slice(1, -4) % 3 !== 0), 'pick: nothing under the volume floor');
  check(JSON.parse(X('JSON.stringify(spPick(TKS.slice(0, 6), 0))')).length === 6, 'pick: fewer than 20 coins -> each once');
  // hourly list: kept within the hour, recomputed the next hour; a held coin stays managed
  const first = X('JSON.stringify(spCoins())');
  check(first === JSON.stringify(want) && X('CFG.trkMinVol') === 300000, 'list: spCoins = the pick over CFG.trkMinVol ($300K)', first);
  X(`S.tk.get('C1USDT').pct = 99; CLOCK_OVR += 10 * 60e3;`);
  check(X('JSON.stringify(spCoins())') === first, 'list: unchanged within the hour');
  X(`SP.pos.C0USDT = {side: 'L', qty: 1, entry: 1, stop: 0.9, stop0: 0.9, target: 1.3, t: now(), realized: 0, fees: 0}; CLOCK_OVR += 3600e3;`);
  const next = JSON.parse(X('JSON.stringify(spCoins())'));
  check(next[0] === 'C1USDT' && next.includes('C0USDT'), 'list: recomputed next hour; held SP coin kept', next);
}
// ---- 5m feed: no coins unless an account has ltf5m on; then that account's coins only, capped at 20
{
  const {X} = desk(); X(TK); X(`S.trk.C3USDT = {side: 'G', t0: now(), px0: 1, rank: 1};`);
  check(X('smK5Coins().length') === 0, 'k5: no 5m feed with ltf5m 0 everywhere');
  X('SP_OV.ltf5m = 1; SP.cfg = Object.assign({}, SM.cfg, SP_OV);');
  const k5 = JSON.parse(X('JSON.stringify(smK5Coins())'));
  check(k5.length === 20 && JSON.stringify(k5) === X('JSON.stringify(spCoins())') && !k5.includes("C3USDT"), 'k5: ltf5m on SP -> SP coins only', k5);
}
// ---- isolation: an SP tick leaves SM / SB / SE and their saves alone; ptTick contains an SP fault
{
  const A = desk(); A.X(TK); A.X('warm = true; smTick(); smWith(SB, smTick); smWith(SE, smTick);');
  const B = desk(); B.X(TK); B.X('warm = true; smTick(); smWith(SB, smTick); smWith(SE, smTick); smWith(SP, smTick);');
  for (const [a, k] of [['SM', 'awx_sm'], ['SB', 'awx_sb'], ['SE', 'awx_se']]) check(A.store[k] === B.store[k] && A.X(`JSON.stringify(${a}.pos)`) === B.X(`JSON.stringify(${a}.pos)`), `isolation: ${a} and ${k} unchanged by the SP tick`);
  check(!!B.store.awx_sp && !A.store.awx_sp && B.X('SP.lastScan && SP.lastScan.t > 0'), 'isolation: awx_sp written by the SP tick only');
  check(B.X('SM !== SP && S.smC !== S.smCP'), 'isolation: globals swapped back');
  const {X} = desk(); X(TK); X('warm = true; SM.lastScan = SE.lastScan = null; spCoins = () => { throw new Error("SP boom"); };');
  let err = null; try { X('ptTick()'); } catch (e) { err = e; }
  check(!err && X('!!(SM.lastScan && SE.lastScan) && SM !== SP'), 'contain: ptTick, SM, SB, SE complete when SP throws', err && err.message);
}
// ---- reviews: SP trades are keyed sp| and skipped by rvmLearn
{
  const {X} = desk();
  X(`SP.log = [{s: 'C1USDT', t1: 5, strat: 'smc', R: 1}]; SM.log = [{s: 'C1USDT', t1: 5, strat: 'smc', R: 1}]; RVM = {['sp|C1USDT|5']: {g: 'D'}};`);
  check(X('mineKey(SP.log[0])') === 'sp|C1USDT|5' && X('mineKey(SM.log[0])') === 'sm|C1USDT|5' && X('rvmLearn().length') === 0, 'reviews: mineKey sp|, rvmLearn skips SP');
}
if (fails) { console.error(fails + ' FAIL'); process.exit(1); }
console.log('PASS: smc-sp');
