// SMC zone candidates, scoring, labels and the zone tuner (Nov 13 plan: smc-zone-replay).
// Run: node tests/smc-zones.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8'), ctx);
const X = c => vm.runInContext(c, ctx), J = c => { try { return JSON.parse(X(`JSON.stringify(${c})`) ?? "null"); } catch (e) { return {err: String(e)}; } };
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- Task 1: the smc-sweep setup (mirrored short); the pick before the change was the newest of 3 FVGs
const src = fs.readFileSync(new URL('./smc-sweep.mjs', import.meta.url), 'utf8'), a0 = src.indexOf('var T = now()');
X(src.slice(a0, src.indexOf('`);', a0)));
X('RV.smAdj = {}; SM.cfg.learn = 1;');
const PRE = {lo: 1, hi: 1.01, kind: 'FVG', i: 81, bg: true};   // captured from the pre-change build
const z0 = J(`smcReadTf(SYM, '15m').zone`);
check(z0 && near(z0.lo, PRE.lo) && near(z0.hi, PRE.hi) && z0.kind === PRE.kind && z0.i === PRE.i && z0.bg === PRE.bg, 'default weights: same zone as before the change (newest FVG, stacked-gap flag kept)', z0);
const zc = J(`smcReadTf(SYM, '15m').setup.zc`);
check(zc && zc.c.length === 3 && zc.c.every(z => z.kind === 'FVG') && zc.c[zc.k].i === PRE.i, 'setup carries zc: all 3 FVGs of the leg (no OB on this leg) and the chosen index', zc);
X(`RV.smAdj = {zone: {pos: -1}}; S.smC.clear();`);
const zOld = J(`smcReadTf(SYM, '15m').zone`);
check(zOld && zOld.i === 79 && !zOld.bg, 'weights that prefer the first gap pick FVG 79, without the stacked-gap flag', zOld);
// the OB preference is checked on the hand-built leg below (this leg has no opposite candle before the shift)
X(`RV.smAdj = {zone: {minZs: 99}}; S.smC.clear();`);
const zMin = J(`smcReadTf(SYM, '15m').zone`);
check(zMin && zMin.i === PRE.i && zMin.kind === 'FVG', 'minZs above every candidate falls back to the default pick, not "no setup"', zMin);
X(`RV.smAdj = {}; S.smC.clear();`);

// ---- Task 1: features on a hand-built bull leg
// ATR 0.02 before the sweep; j=15 sweep to 0.97; 16 = down candle (OB); FVG at 17 (0.998–1.016) and 18 (1.02–1.03); 21 dips to 1.025 (touches FVG 18 only)
X(`
var HB = []; for (let i = 0; i < 15; i++) HB.push([i * 900e3, 1.0, 1.01, 0.99, 1.0, 100]);
[[1.0, 1.005, 0.97, 0.995, 100], [0.995, 0.998, 0.98, 0.985, 100], [0.985, 1.02, 0.984, 1.018, 300], [1.018, 1.05, 1.016, 1.048, 200],
 [1.06, 1.09, 1.03, 1.085, 150], [1.085, 1.09, 1.04, 1.075, 100], [1.075, 1.08, 1.025, 1.04, 100], [1.04, 1.05, 1.03, 1.045, 100]]
  .forEach((b, i) => HB.push([(15 + i) * 900e3, ...b]));
var HZ = smZones(HB, {j: 15, k: 19, ext: 0.97}, 'L');
`);
const HZ = J('HZ'), f17 = HZ.find(z => z.i === 17), f18 = HZ.find(z => z.i === 18), ob = HZ.find(z => z.kind === 'OB');
check(HZ.length === 3 && f17 && f18 && ob && ob.i === 16, 'hand leg: 2 FVGs + the OB', HZ);
check(f17 && near(f17.lo, 0.998) && near(f17.hi, 1.016) && Math.abs(f17.zs - 0.9) < 1e-6 && Math.abs(f18.zs - 0.5) < 1e-6 && Math.abs(ob.zs - 0.75) < 1e-6, 'zs = height / ATR14 (0.9, 0.5, 0.75)', HZ.map(z => [z.i, z.zs]));
check(ob.pos === 0 && f17.pos === 1 && f18.pos === 2, 'pos: 0 = nearest the sweep', HZ.map(z => [z.i, z.pos]));
check(f17.fresh === 1 && f18.fresh === 0 && ob.fresh === 1, 'fresh: FVG 18 was touched by bar 21, the others not', HZ.map(z => [z.i, z.fresh]));
check(J('HZ[smZonePick(HZ)].i') === 18, 'default pick on the hand leg: the newest FVG', J('smZonePick(HZ)'));
check(J('HZ[smZonePick(HZ, {fresh: 1000})].i') === 17, 'prefer fresh: the untouched FVG', J('smZonePick(HZ, {fresh: 1000})'));
check(J('HZ[smZonePick(HZ, {fvg: -100})].kind') === 'OB', 'prefer OB: the OB', null);
check(J('smZoneScore(HZ[0], SMZ_DEF)') > J('smZoneScore(HZ[2], SMZ_DEF)'), 'smZoneScore: FVG beats OB by default', null);
const one = J(`smZones(HB.slice(0, 18).concat([[17 * 900e3 + 1, 0.985, 0.99, 0.984, 0.989, 100], [18 * 900e3, 0.989, 0.995, 0.986, 0.99, 100]]), {j: 15, k: 18, ext: 0.97}, 'L')`);
check(one.length === 1 && one[0].kind === 'OB' && J(`smZonePick(${JSON.stringify(one)})`) === 0, 'leg with only an OB: single candidate, no crash', one);

if (fails) { console.error(`FAIL: ${fails} check(s)`); process.exit(1); }
console.log('PASS: smc-zones');
