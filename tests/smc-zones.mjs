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
// lock (Nov 13, Fred): learned zone weights drive the pick only when SM.cfg.zoneLearn === 1
check(J('SM_DEF.cfg.zoneLearn') === 0 && J(`smcReadTf(SYM, '15m').zone.i`) === PRE.i && J('smRules().zone') === null, 'lock: zoneLearn 0 (default) → tuned weights ignored, default pick', J('smRules().zone'));
X(`SM.cfg.zoneLearn = 1; S.smC.clear();`);
const zOld = J(`smcReadTf(SYM, '15m').zone`);
check(zOld && zOld.i === 79 && !zOld.bg, 'weights that prefer the first gap pick FVG 79, without the stacked-gap flag', zOld);
// the OB preference is checked on the hand-built leg below (this leg has no opposite candle before the shift)
X(`RV.smAdj = {zone: {minZs: 99}}; S.smC.clear();`);
const zMin = J(`smcReadTf(SYM, '15m').zone`);
check(zMin && zMin.i === PRE.i && zMin.kind === 'FVG', 'minZs above every candidate falls back to the default pick, not "no setup"', zMin);
X(`RV.smAdj = {}; SM.cfg.zoneLearn = 0; S.smC.clear();`);
const g0 = J(`smcReadTf(SYM, '15m').grd`);
check(g0 && ['A+', 'A', 'B', 'REJ'].includes(g0.g) && Array.isArray(g0.why), 'smcReadTf attaches a grade with reason codes', g0);

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
check(f17 && near(f17.lo, 0.998) && near(f17.hi, 1.016) && Math.abs(f17.zs - 0.9) < 1e-6 && Math.abs(f18.zs - 0.5) < 1e-6 && Math.abs(ob.zs - 0.9) < 1e-6, 'zs = height / ATR14 (0.9, 0.5, OB 0.9 on its full range)', HZ.map(z => [z.i, z.zs]));
// C1: the OB is the whole candle, wicks included (was low..open for a long, open..high for a short)
check(near(ob.lo, 0.98) && near(ob.hi, 0.998), 'OB full range: candle 16 low..high (0.98–0.998)', ob);
const obS = J(`smZones(HB.map(b => [b[0], 2 - b[1], 2 - b[3], 2 - b[2], 2 - b[4], b[5]]), {j: 15, k: 19, ext: 1.03}, 'S').find(z => z.kind === 'OB')`);
check(obS && near(obS.lo, 1.002) && near(obS.hi, 1.02), 'OB full range on the mirrored short (1.002–1.02)', obS);
// B: course features on the same leg (ATR 0.02, shift candle k = 19: 42% body → no displacement)
check(f17.wOk === 1 && f18.wOk === 1 && ob.wOk === 1, 'wOk: 0.10 ≤ zs ≤ 1.20', HZ.map(z => [z.i, z.wOk]));
check(f17.c2 === 0 && f18.c2 === 1 && ob.c2 == null, 'c2: FVG middle candle within 1 bar of the shift (18 yes, 17 no; n/a on the OB)', HZ.map(z => [z.i, z.c2]));
check(Math.abs(f17.dispR - 1.8) < 1e-6 && Math.abs(f18.dispR - 1.7) < 1e-6 && Math.abs(ob.dispR - 1.8) < 1e-6 && f17.disp === 1 && f18.disp === 1 && ob.disp === 1, 'dispR / disp: middle (OB: departure) candle range / ATR, strong bull body', HZ.map(z => [z.i, z.dispR, z.disp]));
check(ob.obNear === 1 && ob.obConf === 1 && f17.obNear == null && f17.obConf == null, 'obNear (k − i ≤ 8) and obConf (an FVG after it on the leg); n/a on FVGs', HZ.map(z => [z.i, z.obNear, z.obConf]));
check(HZ.every(z => z.mssDisp === 0), 'mssDisp 0: the shift candle has a 42% body', HZ.map(z => z.mssDisp));
// a strong shift candle (19), a thin bar 18 (gap 17 now 2.2 ATR tall)
X(`var HB2 = HB.map(b => b.slice()); HB2[19] = [19 * 900e3, 1.035, 1.09, 1.03, 1.085, 150]; HB2[18] = [18 * 900e3, 1.045, 1.05, 1.042, 1.048, 200];
  var HZ2 = smZones(HB2, {j: 15, k: 19, ext: 0.97}, 'L');`);
const HZ2 = J('HZ2'), g17 = HZ2.find(z => z.i === 17), g18 = HZ2.find(z => z.i === 18);
check(HZ2.every(z => z.mssDisp === 1), 'mssDisp 1: 83% body, 3 ATR range, bullish', HZ2.map(z => z.mssDisp));
check(g17 && g17.wOk === 0 && Math.abs(g17.zs - 2.2) < 1e-6, 'wOk 0: a 2.2-ATR gap', g17);
check(g18 && g18.disp === 0 && Math.abs(g18.dispR - 0.4) < 1e-6, 'disp 0: a 0.4-ATR middle candle', g18);
check(J('HZ[smZonePick(HZ, {c2: -1000})].i') === 17 && J('HZ[smZonePick(HZ, {obNear: 1000})].kind') === 'OB', 'smZoneScore weighs the new keys (c2, obNear)', null);
check(['wOk', 'c2', 'disp', 'obNear', 'obConf', 'mssDisp'].every(k => J('SMZ_DEF.' + k) === 0), 'SMZ_DEF: new keys at 0 (default pick unchanged)', J('SMZ_DEF'));
// C2: grades. smGrade(B, r, rok, rr) on the chosen zone r.zc.c[r.zc.k]
const gr = (hb, Z, k, extra = '', rok = '{ok: true}', rr = 3) => J(`smGrade(${hb}, Object.assign({dir: 'L', j: 15, k: 19, ext: 0.97, swept: {px: 0.99}, zc: {c: ${Z}, k: ${k}}}, {${extra}}), ${rok}, ${rr})`);
const gB = gr('HB', 'HZ', 1);
check(gB.g === 'B' && JSON.stringify(gB.why) === '["mss_disp","fvg_c2"]', 'grade B: FVG 17 (not on the shift candle), weak shift', gB);
const gR = gr('HB', 'HZ', 0);
check(gR.g === 'REJ' && JSON.stringify(gR.why) === '["mss_disp","stale"]', 'grade REJ: chosen FVG 18 already touched (stale)', gR);
X(`var HB3 = HB.map(b => b.slice()); HB3[19] = [19 * 900e3, 1.035, 1.09, 1.03, 1.085, 150]; HB3[21] = [21 * 900e3, 1.075, 1.08, 1.035, 1.04, 100]; var HZ3 = smZones(HB3, {j: 15, k: 19, ext: 0.97}, 'L');`);
const i18 = J('HZ3.findIndex(z => z.i === 18)'), gA = gr('HB3', 'HZ3', i18);
check(gA.g === 'A' && gA.why.length === 0, 'grade A: fresh FVG 18 on the shift, strong shift, OB 0.022 away (> 0.5 ATR)', gA);
X(`var HZ4 = JSON.parse(JSON.stringify(HZ3)); HZ4.find(z => z.kind === 'OB').hi = 1.012;`);
check(gr('HB3', 'HZ4', i18).g === 'A+', 'grade A+: a fresh, near, confirmed OB within 0.5 ATR of the FVG', gr('HB3', 'HZ4', i18));
X(`HZ4.find(z => z.kind === 'OB').fresh = 0;`);
check(gr('HB3', 'HZ4', i18).g === 'A', 'A+ needs the OB fresh', gr('HB3', 'HZ4', i18));
const gH = gr('HB3', 'HZ3', i18, '', '{ok: false}'), gRR = gr('HB3', 'HZ3', i18, '', '{ok: true}', 1.5);
check(gH.g === 'REJ' && gH.why[0] === 'htf' && gRR.g === 'REJ' && JSON.stringify(gRR.why) === '["rr"]', 'grade REJ: higher timeframe against / planned RR < 2', [gH, gRR]);
const gC = gr('HB3', 'HZ3', i18, "type: 'cont', swept: null");
check(gC.g === 'A' && JSON.stringify(gC.why) === '["cont"]', 'continuation: code cont instead of sweep, graded on the rest', gC);
const gN = gr('HB3', JSON.stringify(J('HZ3').filter(z => z.kind === 'OB')), 0);
check(gN.g === 'B' && gN.why.includes('fvg_none'), 'OB with no FVG on the leg: fvg_none → B', gN);
check(ob.pos === 0 && f17.pos === 1 && f18.pos === 2, 'pos: 0 = nearest the sweep', HZ.map(z => [z.i, z.pos]));
check(f17.fresh === 1 && f18.fresh === 0 && ob.fresh === 1, 'fresh: FVG 18 was touched by bar 21, the others not', HZ.map(z => [z.i, z.fresh]));
check(J('HZ[smZonePick(HZ)].i') === 18, 'default pick on the hand leg: the newest FVG', J('smZonePick(HZ)'));
check(J('HZ[smZonePick(HZ, {fresh: 1000})].i') === 17, 'prefer fresh: the untouched FVG', J('smZonePick(HZ, {fresh: 1000})'));
check(J('HZ[smZonePick(HZ, {fvg: -100})].kind') === 'OB', 'prefer OB: the OB', null);
check(J('smZoneScore(HZ[0], SMZ_DEF)') > J('smZoneScore(HZ[2], SMZ_DEF)'), 'smZoneScore: FVG beats OB by default', null);
const one = J(`smZones(HB.slice(0, 18).concat([[17 * 900e3 + 1, 0.985, 0.99, 0.984, 0.989, 100], [18 * 900e3, 0.989, 0.995, 0.986, 0.99, 100]]), {j: 15, k: 18, ext: 0.97}, 'L')`);
check(one.length === 1 && one[0].kind === 'OB' && J(`smZonePick(${JSON.stringify(one)})`) === 0, 'leg with only an OB: single candidate, no crash', one);
check(one[0].obConf === 0 && one[0].obNear === 1 && one[0].disp === 1, 'OB alone on its leg: obConf 0, obNear 1, disp from its departure candle (17)', one[0]);

// ---- Task 2: labels on synthetic 15m paths. Long zone 1.00–1.02, entry 1.01, stop 0.99 → 1R = 0.02, +1R at 1.03
const lab = bars => J(`smZoneLabel(${JSON.stringify(bars.map((b, i) => [i * 900e3, ...b, 100]))}, {lo: 1.0, hi: 1.02}, 'L', 0.99)`);
const L1 = lab([[1.04, 1.045, 1.03, 1.035], [1.03, 1.035, 1.015, 1.02], [1.02, 1.04, 1.018, 1.035]]);
check(L1.lab === 'right' && Math.abs(L1.r - 1.5) < 1e-6, 'touched, then +1.5R → right (r 1.5)', L1);
const L2 = lab([[1.03, 1.035, 1.015, 1.02], [1.02, 1.025, 1.004, 1.006], [1.006, 1.012, 0.995, 0.997]]);
check(L2.lab === 'wrong' && L2.r === -1, 'touched, then closed through the far edge → wrong', L2);
const L3 = lab([[1.03, 1.035, 0.985, 1.0], [1.0, 1.06, 0.999, 1.05]]);
check(L3.lab === 'wrong', 'touched and stopped in the same bar → wrong (stop first)', L3);
const L4 = lab([[1.04, 1.05, 1.025, 1.03], [1.03, 1.06, 1.026, 1.05]]);
check(L4.lab === 'untouched' && L4.r === 0, 'never touched → untouched', L4);
const L5 = J(`smZoneLabel([[0, 0.97, 0.975, 0.965, 0.97, 1]], {lo: 0.98, hi: 1.0}, 'S', 1.01)`);   // short: touch the zone's low edge, +1R at 0.98
check(L5.lab === 'untouched', 'short zone above price, never reached → untouched', L5);
const st1 = J(`smZoneStop({lo: 1.0, hi: 1.02}, 'L', 0.99)`), st2 = J(`smZoneStop({lo: 1.0, hi: 1.02}, 'L', 1.005)`);
check(Math.abs(st1 - 0.99 * 0.997) < 1e-9 && Math.abs(st2 - 1.01 * 0.985) < 1e-9, 'smZoneStop: sweep − stopBuf, widened to the minimum stop % from the midpoint', [st1, st2]);

// ---- Task 3: tuner behind the evidence gate (each side n ≥ 5, gap ≥ 0.5R, winner > 0), sticky in smLearn, backfill
X(`var zrow = (fresh, lab, r, t) => ({s: 'ZUSDT', b: 'Z', side: 'L', t0: t - 3600e3, t1: t, entry: 1, exit: 1, stop0: 0.98, R: 0, maxR: 0, rr: 2, tf: '15m', type: 'rev', exitWhy: 'x', strat: 'smc',
  zc: {done: 1, k: 0, c: [{kind: 'FVG', lo: 1, hi: 1.01, i: 5, zs: 0.5, fresh, pos: 0, pd: 1, ovl: 0, lab, r}]}});
var zrows = (nf, ns, fl, sl, t = 1e12) => [...Array(nf)].map((_, i) => zrow(1, fl, fl === 'right' ? 1.5 : -1, t + i)).concat([...Array(ns)].map((_, i) => zrow(0, sl, sl === 'right' ? 1.5 : -1, t + 100 + i)));`);
check(J(`smZoneTune(zrows(4, 4, 'right', 'wrong'))`) === null, 'tuner: 4 vs 4 → null (too few)', J(`smZoneTune(zrows(4, 4, 'right', 'wrong'))`));
const tu = J(`smZoneTune(zrows(6, 6, 'right', 'wrong'))`);
check(tu && tu.W && tu.W.fresh > 0 && tu.why.length === 1 && tu.why[0].k === 'fresh' && tu.why[0].n1 === 6 && tu.why[0].n2 === 6, 'tuner: 6 fresh-right vs 6 stale-wrong → prefers fresh, why n 6/6', tu);
check(J(`smZoneTune(zrows(6, 6, 'right', 'right'))`) === null, 'tuner: no gap between the sides → null', null);
X(`var zc2 = A => A.map(x => { x.zc.c[0].c2 = x.zc.c[0].fresh; return x; });`);
check(J(`smZoneTune(zc2(zrows(4, 4, 'right', 'wrong')))`) === null, 'tuner gate on a new feature: c2 4 vs 4 → null', null);
const tc = J(`smZoneTune(zc2(zrows(6, 6, 'right', 'wrong')))`);
check(tc && tc.W.c2 > 0 && tc.why.some(w => w.k === 'c2' && w.n1 === 6), 'tuner: c2 split 6 vs 6 → c2 weight', tc);
check(J(`smZoneTune(zrows(6, 6, 'right', 'wrong')).why.every(w => w.k === 'fresh')`) === true, 'tuner: zones without the new fields are left out of those splits', null);
check(J(`HZ[smZonePick(HZ, smZoneTune(zrows(6, 6, 'right', 'wrong')).W)].i`) === 17, 'tuned weights steer the pick on the hand leg (fresh FVG 17)', null);
X(`RV.smAdj = {}; RV.smSticky = {}; SM.log = zrows(6, 6, 'right', 'wrong'); smLearn();`);
check(J('RV.smAdj.zone && RV.smAdj.zone.fresh') > 0 && /fresh/.test(J('RV.smWhy.zone') || ''), 'smLearn: RV.smAdj.zone set from the split, with its reason', J('[RV.smAdj, RV.smWhy.zone]'));
check(J('smRules().zone') === null, 'locked: the tuner still learns, but smRules().zone stays null while zoneLearn is 0', J('smRules().zone'));
X('SM.cfg.zoneLearn = 1;');
check(J('smRules().zone && smRules().zone.fresh') > 0, 'unlocked (zoneLearn 1): smRules().zone feeds the pick', J('smRules().zone'));
X('SM.cfg.zoneLearn = 0;');
X(`SM.log = zrows(2, 2, 'wrong', 'right'); smLearn();`);
check(J('RV.smAdj.zone && RV.smAdj.zone.fresh') > 0, 'sticky: thin opposite evidence (2 vs 2) keeps the zone rule', J('RV.smAdj'));
X(`SM.log = zrows(6, 6, 'wrong', 'right', now() + 1e6); smLearn();`);
check(J('RV.smAdj.zone && RV.smAdj.zone.fresh') < 0, 'a newer opposite split (6 vs 6) turns it around', J('RV.smAdj.zone'));
// backfill: a row without a zone is skipped with a reason; a failed kline fetch leaves the row unlabelled for a retry
X(`RV.smAdj = {}; var apiOk = api; api = async () => { throw new Error('down'); };
  SM.log = [{s: 'OLDUSDT', side: 'L', t0: now() - 5 * 864e5, t1: now() - 4 * 864e5, entry: 1, R: 0, strat: 'smc'}, Object.assign(zrow(1, null, null, now() - 4 * 864e5), {sweep: 0.97, zone: {lo: 1, hi: 1.01, kind: 'FVG'}})];
  delete SM.log[1].zc.done; delete SM.log[1].zc.c[0].lab; var bfN = null; smZoneBackfill(5).then(n => { bfN = n; });`);
await new Promise(r => setTimeout(r, 50));
check(J('bfN') === 0 && /no zone/.test(J('SM.log[0].zcSkip') || '') && !J('SM.log[0].zc'), 'backfill: row without zone/sweep → skipped with a reason, no throw', J('SM.log[0]'));
check(J('SM.log[1].zcErr') > 0 && !J('SM.log[1].zc.done'), 'backfill: kline fetch fails → left unlabelled, retried later', J('SM.log[1]'));
X(`api = async () => [...Array(40)].map((_, i) => [now() - 4 * 864e5 + i * 900e3, '1.03', i === 2 ? '1.05' : '1.035', i === 1 ? '1.005' : '1.025', '1.03', '0', '0', '100']); SM.log[1].zcErr = 0; bfN = null; smZoneBackfill(5).then(n => { bfN = n; });`);
await new Promise(r => setTimeout(r, 50));
check(J('bfN') === 1 && J('SM.log[1].zc.done') === 1 && J('SM.log[1].zc.c[0].lab') === 'right', 'backfill: labels the candidates once candles arrive', J('SM.log[1].zc'));
X('api = apiOk;');

if (fails) { console.error(`FAIL: ${fails} check(s)`); process.exit(1); }
console.log('PASS: smc-zones');
