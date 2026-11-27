// Time Machine (src/tm.js, record only): odds from bootstrapped 5m bars, seeded; the live queue writes pos.tm / the closed
// trade's tm; TM.off (backtests) never queues. Run: node tests/tm.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const CORE = fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8');
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
const store = {};
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})},
  sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(CORE, ctx);
const X = c => vm.runInContext(c, ctx);

// 30 days of 5m bars: seeded random walk, flat or drifting up (arrays like Aster klines: [open time, o, h, l, c])
const T0 = Date.UTC(2026, 9, 1), M5 = 300e3;
function walk(days, drift = 0) {
  let a = 3, x = 100; const rnd = () => (a = (a * 16807) % 2147483647) / 2147483647, out = [];
  for (let i = 0; i < days * 288; i++) { const o = x; x *= 1 + drift + (rnd() - 0.5) * 0.004; out.push([T0 + i * M5, o, Math.max(o, x) * 1.0005, Math.min(o, x) * 0.9995, x]); }
  return out;
}
const at = K => K[K.length - 1][0] + M5;
ctx.__K = walk(30); ctx.__t = at(ctx.__K);
const a = X('tmRun({t: __t, side: "L", entry: 100, stop: 99, target: 101}, __K, {n: 3000})'), b = X('tmRun({t: __t, side: "L", entry: 100, stop: 99, target: 101}, __K, {n: 3000})');
check(JSON.stringify(a) === JSON.stringify(b), 'seeded: the same plan and bars give the same result');
check(a && a.be === 0.5 && Math.abs(a.share - 0.5) < 0.08, 'flat walk at 1R ≈ coin flip', a);
check(a && Math.abs(a.pT + a.pS + a.pN - 1) < 0.01, 'odds add up to 1', a);
ctx.__U = walk(30, 0.0002); ctx.__u = at(ctx.__U);
const L = X('tmRun({t: __u, side: "L", entry: 100, stop: 99, target: 101}, __U, {n: 2000})'), S = X('tmRun({t: __u, side: "S", entry: 100, stop: 101, target: 99}, __U, {n: 2000})');
check(L && L.tag === 'favour' && S && S.tag === 'against', 'up-drift: long favours the target, short goes against it', [L && L.tag, S && S.tag]);
check(X('tmRun({t: __K[288 * 10][0], side: "L", entry: 100, stop: 99, target: 101}, __K)') === null, 'fewer than 20 days before the entry → null');
check(X('tmTxt(null)') === '' && /時光機/.test(X('tmTxt(' + JSON.stringify(a) + ')')), 'tmTxt');

// live queue: a position gets tm; a position closed before the read gets it on its log entry; TM.off never queues
const W = walk(30), t = at(W);
ctx.__bars = W.map(r => r.map(String));   // Aster sends strings
X(`api = async p => { const m = /startTime=(\\d+)/.exec(p), s = +m[1]; return __bars.filter(b => +b[0] >= s).slice(0, 1500); };`);
X(`var A = {pos: {XUSDT: {side: 'L', entry: 100, stop0: 99, stop: 99, target: 101, t: ${t}}, YUSDT: {side: 'S', entry: 100, stop0: 101, stop: 101, target: 99, t: ${t}}}, log: []};`);
X('tmAsk(A, "XUSDT"); tmAsk(A, "YUSDT"); A.log.unshift({s: "YUSDT", t0: A.pos.YUSDT.t}); delete A.pos.YUSDT;');
check(X('A.pos.XUSDT.tm') === null && X('TM.q.length') === 2, 'tmAsk marks the position as asked and queues it');
const n = await X('tmFlush()');
check(n === 2, 'tmFlush works the whole queue', n);
check(X('A.pos.XUSDT.tm && A.pos.XUSDT.tm.days') >= 20, 'open position got its read', X('A.pos.XUSDT.tm'));
check(X('A.log[0].tm && A.log[0].tm.n') === 5000, 'closed-before-read trade got it on its log entry', X('A.log[0].tm'));
X('A.pos.ZUSDT = {side: "L", entry: 1, stop0: 0.9, stop: 0.9, target: 1.2, t: 1}; TM.off = true; tmAsk(A, "ZUSDT");');
check(X('A.pos.ZUSDT.tm === undefined && TM.q.length === 0'), 'TM.off (backtests): nothing queued');

console.log(fails ? `FAIL: tm (${fails})` : 'PASS: tm');
process.exit(fails ? 1 : 0);
