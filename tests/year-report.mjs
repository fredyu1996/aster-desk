// Year backtest report module (bot/year-report.mjs): stats, drawdown, held / not-held patterns, ablation labels, months, exits, terciles, size guard.
// Run: node tests/year-report.mjs   (pure; no network, no core)
import {stats, sumRun, findPatterns, ablation, months, exits, terciles, fitSize} from '../bot/year-report.mjs';
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };
const ok = (c, m) => { if (!c) fail(m); };
const eq = (a, b) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(x + ' !== ' + y); };
const rep = (n, fn) => Array.from({length: n}, (_, i) => fn(i));
const mk = (t0, R, f = {}) => ({v: 'base', s: 'BTCUSDT', side: f.side || 'L', t0, t1: t0 + 1, R, why: 'x', f});
// stats + drawdown
eq(stats([]), {n: 0, avgR: null, win: null, totR: 0, maxDD: 0});
eq(stats([mk(1, 1), mk(2, -2), mk(3, 0.5), mk(4, -1)]).maxDD, 2.5);
// held pattern: side L better in both halves
const held = [...rep(25, i => mk(i, 0.5, {side: 'L'})), ...rep(25, i => mk(i, -0.2, {side: 'S'})), ...rep(10, i => mk(2000 + i, 0.4, {side: 'L'})), ...rep(10, i => mk(2000 + i, -0.1, {side: 'S'}))];
const P = findPatterns(held, 1000);
ok(P.held.length === 1 && P.held[0].f === 'side' && Math.abs(P.held[0].dA - 0.7) < 1e-9 && P.held[0].inB.n === 10, 'side split held, tested once');
// side-split fixtures: nA per side in half A with R a1/a2; nB per side in half B with R b1/b2
const side = (nA, a1, a2, nB, b1, b2) => [...rep(nA, i => mk(i, a1, {side: 'L'})), ...rep(nA, i => mk(i, a2, {side: 'S'})), ...rep(nB, i => mk(2000 + i, b1, {side: 'L'})), ...rep(nB, i => mk(2000 + i, b2, {side: 'S'}))];
const flipRows = side(25, 0.5, -0.2, 10, -0.1, 0.4), check7Rows = side(25, 0.5, -0.2, 7, 0.4, -0.1), n19Rows = side(19, 0.5, -0.2, 10, 0.4, -0.1), d029Rows = side(25, 0.4, 0.11, 10, 0.4, -0.1);
ok(findPatterns(flipRows, 1000).notHeld.length === 1 && !findPatterns(flipRows, 1000).held.length, 'flip in check half -> did not hold');
ok(findPatterns(check7Rows, 1000).notHeld.length === 1, 'check side n 7 -> did not hold');
ok(!findPatterns(n19Rows, 1000).held.length && !findPatterns(n19Rows, 1000).notHeld.length, 'n 19 per side -> not reported');
ok(!findPatterns(d029Rows, 1000).notHeld.length && !findPatterns(d029Rows, 1000).held.length, 'avg R gap 0.29 -> not reported');
// 11 grades, each stands out in half A (R = 0.3 i^2) and reverses in half B
const elevenFailing = [];
for (let g = 0; g < 11; g++) for (let i = 0; i < 20; i++) { elevenFailing.push(mk(i, 0.3 * g * g, {grade: 'g' + g})); elevenFailing.push(mk(2000 + i, -0.3 * g * g, {grade: 'g' + g})); }
ok(findPatterns(elevenFailing, 1000).notHeld.length === 10, 'did not hold capped at 10');
eq(findPatterns([], 1000), {held: [], notHeld: []});
// ablation labels + sort
const flat = (r, n = 20) => [...rep(n, i => mk(i, r)), ...rep(n, i => mk(2000 + i, r))];
const baseRows = flat(0.5), swWorseBoth = flat(0.2), swTiny = flat(0.45), swBetterOneHalf = [...rep(20, i => mk(i, 0.9)), ...rep(20, i => mk(2000 + i, 0.5))];
const A = ablation(baseRows, [{k: 'x', lab: 'x', rows: swWorseBoth}, {k: 'y', lab: 'y', rows: swBetterOneHalf}, {k: 'z', lab: 'z', rows: swTiny}, {k: 'e', lab: 'e', rows: []}], 1000);
ok(A[0].k === 'x' && A[0].label === 'helpful', 'switch worse by 0.25R in both halves -> live setting helpful, sorted first');
ok(A.find(r => r.k === 'y').label === 'none' && A.find(r => r.k === 'z').label === 'none' && A.find(r => r.k === 'e').label === 'none', 'one-half, < 0.2R, and empty runs -> none');
ok(ablation(baseRows, [{k: 'b', lab: 'b', rows: flat(0.8)}], 1000)[0].label === 'harmful', 'switch better in both halves -> harmful');
// months, exits, terciles, size guard, no NaN
eq(months([mk(Date.UTC(2026, 0, 31, 23), 1), mk(Date.UTC(2026, 1, 1), -1)]).map(m => m.m), ['2026-01', '2026-02']);
eq(exits([{...mk(1, 1), why: 'target 3.2R'}, {...mk(2, 0), why: 'target 2.1R'}])[0], {why: 'target #R', n: 2, avgR: 0.5});
const T = rep(9, i => mk(i, 0, {atr: i})); terciles(T, 'atr', 'atrT'); eq(T.map(r => r.f.atrT).join(), 'low,low,low,mid,mid,mid,high,high,high');
const TN = [mk(1, 0, {atr: null}), mk(2, 0, {atr: 5})]; terciles(TN, 'atr', 'atrT'); eq(TN.map(r => r.f.atrT), ['?', 'low']);
eq(sumRun([mk(1, 1), mk(2000, -1)], 1000).a.n, 1);
const big = fitSize({sum: {}, trades: rep(400, i => ({...mk(i, 0), v: i % 2 ? 'raw' : 'base', pad: 'x'.repeat(3000)}))});
ok(JSON.stringify(big).length <= 900e3 && big.sum.trimmed === true && big.trades.filter(r => r.v === 'raw').length <= 100, 'size guard trims to <= 900 KB');
ok(!/NaN/.test(JSON.stringify([stats([]), sumRun([], 0), ablation([], [], 0)])), 'no NaN on empty input');
console.log('PASS: year report');
