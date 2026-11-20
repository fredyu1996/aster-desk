// SMC Trader unit check: a synthetic sweep → structure shift → FVG pullback short on 15m.
// It must be refused while the 1h is rising (against the higher timeframe) and taken once the 1h is falling.
// Run: node tests/smc-sweep.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8'), ctx);
const X = c => vm.runInContext(c, ctx);
X(`
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
S.meta.set(SYM, {base: 'SWEEP'}); S.kl.set(SYM, {t: T, bars: kb});
const hb = []; let hp = 1.6; for (let i = 0; i < 72; i++) { const o = hp; hp = hp * (i % 5 === 4 ? 1.025 : 0.988); hb.push([T - (72 - i) * 3600e3, o, Math.max(o, hp) * 1.003, Math.min(o, hp) * 0.997, hp, 1e5, 5e4]); }
S.h1.set(SYM, {t: T, bars: hb});
S.tk.set(SYM, {last: 1.003, pct: 12, qv: 2e6});
S.trk[SYM] = {side: 'G', t0: T - 3600e3, px0: 1, rank: 2};
S.fund.set(SYM, {r: 0}); warm = true; S.started = T - 3600e3;
SM.on = true;   // a fresh account starts paused since the Nov 12 migration (pause1113); this test checks entries

`);

const snap = () => X(`JSON.stringify((r => ({tf: r.tf, htf: r.htf, bias: r.bias, against: r.against, stage: r.stage, dir: r.dir, q: r.q && {score: r.q.score, grade: r.q.grade, items: r.q.items.map(i => i.ok + ' ' + i.k + ': ' + i.t)}, other: r.other && {tf: r.other.tf, stage: r.other.stage, dir: r.other.dir}}))(smcRead(SYM)))`);
console.log('1h falling:', snap());
// flip the 1h to rising: the 15m short must be refused
X(`{ const hb2 = []; let hp = 1.0; for (let i = 0; i < 72; i++) { const o = hp; hp = hp * (i % 5 === 4 ? 0.975 : 1.012); hb2.push([T - (72 - i) * 3600e3, o, Math.max(o, hp) * 1.003, Math.min(o, hp) * 0.997, hp, 1e5, 5e4]); } S.h1.set(SYM, {t: T, bars: hb2}); S.smC && S.smC.clear(); }`);
console.log('1h rising:', snap());
// Nov 19 (fib1119): fib 1 live for the SMC Trader only; SMC Big keeps 0 through SB_OV
assert.deepStrictEqual(JSON.parse(X(`JSON.stringify({sm: SM.cfg.fib, sb: smWith(SB, () => SM.cfg.fib)})`)), {sm: 1, sb: 0});
console.log('PASS: fib 1 on the SMC Trader, 0 on SMC Big');
X('SM.cfg.minQ = 0; SM.cfg.gmsB = 0; SM.cfg.gmsD = 0; SM.cfg.fib = 0; smTick();');   // this test is about the 1h filter; its synthetic leg has no displacement candle (GMS B/D are on live since Nov 15) and its zone sits on no fib level (fib 1 live since Nov 19)
console.log('scan (1h rising)', X('JSON.stringify(SM.lastScan)').slice(0, 600));
console.log('open', X('JSON.stringify(Object.keys(SM.pos))'));
if (X('Object.keys(SM.pos).length') !== 0) { console.error('FAIL: took a 15m short while the 1h was rising'); process.exit(1); }
// back to falling 1h: should trade
X(`S.h1.set(SYM, {t: T, bars: hb}); S.smC && S.smC.clear(); SM.cool = {}; smTick();`);
console.log('scan (1h falling)', X('JSON.stringify(SM.lastScan)').slice(0, 600));
console.log('pos', X(`JSON.stringify(Object.values(SM.pos).map(p => ({side: p.side, tf: p.tf, htfBias: p.htfBias, holdH: p.holdH, q: p.q && p.q.score})))`));
// ---- checks
const pos = JSON.parse(X(`JSON.stringify(Object.values(SM.pos).map(p => ({side: p.side, tf: p.tf})))`));
if (pos.length !== 1 || pos[0].side !== 'S') { console.error('FAIL: expected one SMC short after the 1h turned down, got', JSON.stringify(pos)); process.exit(1); }
console.log('PASS: refused against a rising 1h, short taken with a falling 1h');
// fib level math (SM.cfg.fib, Nov 19): leg low 1.0 / high 2.0 -> long levels 1.5 / 1.382 / 1.21, short mirrored 1.5 / 1.618 / 1.79; hit tolerance 0.1 ATR (0.06 here)
const fib = JSON.parse(X(`JSON.stringify((() => { const B = [[0, 1.5, 1.6, 1.4, 1.5], [1, 1.5, 1.6, 1.0, 1.4], [2, 1.4, 2.0, 1.3, 1.9]], L = smFib(B, {dir: 'L', j: 1, k: 2}), Sh = smFib(B, {dir: 'S', j: 1, k: 2});`
  + `return {L: L.lv.map(v => +v.toFixed(6)), S: Sh.lv.map(v => +v.toFixed(6)), hit: smFibHit(L, {lo: 1.37, hi: 1.40}), near: smFibHit(Sh, {lo: 1.66, hi: 1.70}), none: smFibHit(L, {lo: 1.6, hi: 1.7}), ote: smFibOte(L, {lo: 1.3, hi: 1.35}), noOte: smFibOte(L, {lo: 1.45, hi: 1.55})}; })())`));
assert.deepStrictEqual(fib, {L: [1.5, 1.382, 1.21], S: [1.5, 1.618, 1.79], hit: '0.618', near: '0.618', none: '', ote: true, noOte: false});
console.log('PASS: fib levels', JSON.stringify(fib));
