// nyAm (Nov 28): off on every account (Fred); when switched on, an account skips new entries Mon–Fri 09:30–12:00 New York.
// Run: node tests/smc-nyam.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
const store = {};
const ctx = vm.createContext({console, Date, Math, JSON, Intl, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => null}, window: {}, setTimeout, clearTimeout});
vm.runInContext(CORE, ctx);
const X = c => vm.runInContext(c, ctx);
check(X('SM.cfg.nyAm') === 0, 'SMC Trader: nyAm 0', X('SM.cfg.nyAm'));
check(X('smWith(SB, () => SM.cfg.nyAm)') === 0, 'SMC Big: nyAm 0', X('smWith(SB, () => SM.cfg.nyAm)'));
check(X('smWith(SE, () => SM.cfg.nyAm)') === 0, 'SMC BTC/ETH: nyAm 0', X('smWith(SE, () => SM.cfg.nyAm)'));
check(!X('smWith(SP, () => SM.cfg.nyAm)'), 'SMC Pattern: nyAm off', X('smWith(SP, () => SM.cfg.nyAm)'));
const T = iso => Date.parse(iso);
const cases = [['2026-11-27T14:29:00Z', false, 'Fri 09:29 NY (EST)'], ['2026-11-27T14:30:00Z', true, 'Fri 09:30 NY'], ['2026-11-27T16:59:00Z', true, 'Fri 11:59 NY'],
  ['2026-11-27T17:00:00Z', false, 'Fri 12:00 NY'], ['2026-07-10T13:30:00Z', true, 'Fri 09:30 NY (EDT)'], ['2026-07-10T14:30:00Z', true, 'Fri 10:30 NY (EDT)'], ['2026-11-28T15:00:00Z', false, 'Sat 10:00 NY']];
for (const [t, want, name] of cases) check(X(`smNyAm(${T(t)})`) === want, 'smNyAm ' + name, X(`smNyAm(${T(t)})`));
// switched on (as a test), smTryEnter refuses inside the window on SMC Big; the SMC Trader (still 0) goes on to its other checks
X(`CLOCK_OVR = ${T('2026-11-27T15:00:00Z')}; SB_OV.nyAm = 1;`);
X(`var C1 = {s: 'XUSDT', r: {dir: 'L', stop: 2}, tk: {last: 1}}; var r1 = smWith(SB, () => smTryEnter(C1));`);
check(X('r1') === false && /New York morning/.test(X('C1.skip')), 'SMC Big inside the window: skipped (nyAm)', X('C1.skip'));
X(`var C2 = {s: 'XUSDT', r: {dir: 'L', stop: 2}, tk: {last: 1}}; var r2 = smTryEnter(C2);`);
check(X('r2') === false && !/New York morning/.test(X('C2.skip') || ''), 'SMC Trader inside the window: not skipped by nyAm', X('C2.skip'));
X(`CLOCK_OVR = ${T('2026-11-27T18:00:00Z')}`);
X(`var C3 = {s: 'XUSDT', r: {dir: 'L', stop: 2}, tk: {last: 1}}; var r3 = smWith(SB, () => smTryEnter(C3));`);
check(!/New York morning/.test(X('C3.skip') || ''), 'SMC Big outside the window: not skipped by nyAm', X('C3.skip'));
X('SB_OV.nyAm = 0');
X(`CLOCK_OVR = ${T('2026-11-27T15:00:00Z')}`); X(`var C4 = {s: 'XUSDT', r: {dir: 'L', stop: 2}, tk: {last: 1}}; smWith(SB, () => smTryEnter(C4));`);
check(!/New York morning/.test(X('C4.skip') || ''), 'nyAm 0 (live): SMC Big inside the window is not skipped', X('C4.skip'));
console.log(fails ? `${fails} FAILED` : 'all passed');
if (fails) process.exit(1);
