// SMC Big (SB) reviews are for Fred only: they must never change what the Reviewer learns for the SMC Trader.
// Same SM reviews R, then R + many SB reviews ("should have been a short", "poor OB", skip): smLearn() output and smRules() must be identical.
// Run: node tests/smc-big-review.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
const store = {};
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(CORE, ctx);
const X = c => vm.runInContext(c, ctx);
X('CLOCK_OVR = 1794000000000;');
X(`
const mk = (s, i, side, R) => ({s, b: s.replace('USDT', ''), side, t0: now() - (60 - i) * 3600e3, t1: now() - (59 - i) * 3600e3 + 1000 * i, entry: 1, exit: 1, qty: 1, notional: 1, pnl: R, R, fees: 0, why: 'x', exitWhy: R > 0 ? 'target' : 'stop loss', stop0: 0.98, maxR: Math.max(R, 0), strat: 'smc', tf: '15m', htfBias: 'bull', q: {score: 70 + i, items: []}});
SM.log = []; SB.log = [];
for (let i = 0; i < 14; i++) SM.log.push(mk('AAAUSDT', i, 'L', i % 3 ? -1 : 1.5));
for (let i = 0; i < 14; i++) SB.log.push(mk('AAAUSDT', i, 'L', i % 2 ? -1 : 1));   // same coin, similar times: SB trades look like SM trades
const rev = (txt) => ({g: 'D', ag: 'disagree', alt: [], x: [], note: txt, imgs: [], t: now()});
RVM = {};
SM.log.slice(0, 8).forEach(x => { RVM['sm|' + x.s + '|' + x.t1] = rev('should have been a short. poor OB, skip this one, entered too early'); });
`);
const learn = () => { X('RV.smAdj = {}; RV.smWhy = {}; smLearn();'); return JSON.stringify({adj: X('RV.smAdj'), why: X('RV.smWhy'), rules: X('smRules()'), Y: X('youTally(SM.log)'), nY: X('rvmLearn().length')}); };
const base = learn(); console.log("baseline adj:", JSON.stringify(JSON.parse(base).adj), "reviews read:", JSON.parse(base).Y.n);
check(X('mineOf(SM.log[0])') !== null && X('Object.keys(RVM).every(k => k.startsWith("sm|"))'), 'SM reviews keyed sm|');
check(X('mineKey(SB.log[0])').startsWith('sb|') && X('mineKey(SM.log[0])').startsWith('sm|'), 'mineKey separates SB from SM trades even for the same coin');
check(X('youTally(SM.log).n') > 0 || /flip/.test(base), 'baseline: SM reviews are read (non-vacuous)', X('youTally(SM.log)'));
X(`SB.log.forEach(x => { RVM['sb|' + x.s + '|' + x.t1] = Object.assign(rev('should have been a short. poor OB, skip, wider stop, enter later'), {acct: 'sb', alt: ['skip', 'flip'], excl: false}); });`);
check(X('SB.log.every(x => mineOf(x) && mineKey(x).startsWith("sb|"))') && X('SM.log.slice(8).every(x => !mineOf(x))'), 'SB reviews attach to SB trades only');
const withSB = learn();
check(withSB === base, 'smLearn / smRules / youTally / re-learn counter identical with 14 SB reviews added');
// an SB review also must not count as an "excluded" SM trade or change grading
X(`RVM['sb|' + SB.log[0].s + '|' + SB.log[0].t1].excl = true;`);
check(X('SM.log.every(x => !rvManual(x))'), 'SB "leave out" does not exclude any SM trade');
check(learn() === base, 'still identical after an SB leave-out');
console.log(fails ? `\n${fails} FAILED` : '\nall smc-big-review checks passed'); process.exit(fails ? 1 : 0);
