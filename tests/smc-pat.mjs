// pat1h (src/smc_pat.js) unit check on synthetic 1h series: a clear double bottom confirms long, a clear head and shoulders confirms
// short, a breakout close short of 0.10 ATR confirms nothing, a breakout bar that has not closed yet is ignored, and later bars never
// change a confirmed read. Run: node tests/smc-pat.mjs   (after build.py)
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {userAgent: 'node'}, addEventListener() {}});
vm.runInContext(fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8'), ctx);
const X = c => vm.runInContext(c, ctx), H = 3600e3, T0 = Date.UTC(2026, 10, 1);
// bars along a piecewise-linear close path through [bar, close] waypoints; each bar opens at the last close, wicks 0.2 beyond its body
const gen = (W, last) => { const C = []; for (let w = 1; w < W.length; w++) for (let i = W[w - 1][0]; i < W[w][0]; i++) C.push(W[w - 1][1] + (W[w][1] - W[w - 1][1]) * (i - W[w - 1][0]) / (W[w][0] - W[w - 1][0]));
  C.push(W[W.length - 1][1]); if (last != null) C.push(last);
  return C.map((c, i) => { const o = i ? C[i - 1] : c; return [T0 + i * H, o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c, 1000, 500]; }); };
const det = B => { ctx.__B = B; return JSON.parse(X('JSON.stringify(smPatDetect(__B, __B.length - 1))')); };
const atrJ = B => { ctx.__B = B; return X('smATR(__B, __B.length - 1)'); };

// double bottom: 30-point decline, lows 99.8 / 100.0 sixteen bars apart, neckline = the 106.2 high between them
const DB = [[0, 130], [50, 100], [58, 106], [66, 100.2], [72, 105.5]];
const dbNeck = 106.2, dbOk = gen(DB, dbNeck + 0.5), a1 = atrJ(dbOk);
const p1 = det(dbOk);
assert.ok(p1 && p1.type === 'DOUBLE_BOTTOM' && p1.dir === 'L', 'double bottom must confirm long: ' + JSON.stringify(p1));
assert.ok(Math.abs(p1.bnd - dbNeck) < 1e-9 && p1.t === dbOk[dbOk.length - 1][0] + H, 'boundary = neckline, confirm time = breakout bar close');
console.log(`PASS: double bottom confirms long (boundary ${p1.bnd}, close ${(0.5 / a1).toFixed(2)} ATR beyond)`);
// the same breakout bar closing only 0.05 ATR beyond the neckline: not confirmed
const dbWeak = gen(DB, dbNeck + 0.05 * a1);
assert.strictEqual(det(dbWeak), null, 'a close < 0.10 ATR beyond the boundary must not confirm');
console.log('PASS: close 0.05 ATR beyond the neckline confirms nothing');

// head and shoulders: shoulders 100.2 / 100.4, head 104.2, sloped neckline through the 94.8 / 95.1 troughs
const HS = [[0, 70], [30, 100], [36, 95], [44, 104], [52, 95.3], [60, 100.2], [66, 96.5]];
const neckAt = i => 94.8 + (i - 36) * (95.1 - 94.8) / (52 - 36), hs = gen(HS, neckAt(67) - 0.8), p2 = det(hs);
assert.ok(p2 && p2.type === 'HNS' && p2.dir === 'S', 'head and shoulders must confirm short: ' + JSON.stringify(p2));
assert.ok(Math.abs(p2.bnd - neckAt(67)) < 1e-9, 'boundary = the sloped neckline at the breakout bar');
console.log(`PASS: head and shoulders confirms short (neckline ${p2.bnd.toFixed(3)} at the breakout bar)`);

// no look-ahead: 20 later bars (a full reversal) leave the confirmed read unchanged
const more = dbOk.concat(gen([[0, dbNeck + 0.5], [20, 90]]).slice(1).map((b, i) => [dbOk[dbOk.length - 1][0] + (i + 1) * H, ...b.slice(1)]));
ctx.__B = more; assert.deepStrictEqual(JSON.parse(X(`JSON.stringify(smPatDetect(__B, ${dbOk.length - 1}))`)), p1, 'later bars changed the read of a closed bar');
console.log('PASS: later bars do not change a confirmed read');
// ...and through the live hook: pat1h 1 keeps a long setup only once the breakout bar has CLOSED (it is the forming bar before that)
const tB = dbOk[dbOk.length - 1][0], keep = tNow => { ctx.__tNow = tNow; return X(`(() => { SM.cfg.pat1h = 1; S.h1.set('PATUSDT', {t: __tNow, bars: __B}); const r = smPatCands('PATUSDT', '15m', [], 1, __tNow, [{dir: 'L'}, {dir: 'S'}]).map(c => c.dir).join(','); SM.cfg.pat1h = 0; return r; })()`); };
ctx.__B = dbOk;
assert.strictEqual(keep(tB + 59 * 60e3), '', 'a breakout bar that has not closed must be ignored');
assert.strictEqual(keep(tB + H), 'L', 'once closed, the long setup stands and the short does not');
assert.strictEqual(keep(tB + H + 25 * H), '', 'the filter window is 24 h');
console.log('PASS: unclosed breakout bar ignored; filter keeps only same-direction setups for 24 h');
assert.deepStrictEqual(JSON.parse(X('JSON.stringify({sm: SM_DEF.cfg.pat1h, sb: smWith(SB, () => SM.cfg.pat1h), se: smWith(SE, () => SM.cfg.pat1h)})')), {sm: 0, sb: 0, se: 0});
console.log('PASS: pat1h is 0 on SMC Trader, SMC Big and SMC BTC/ETH');
