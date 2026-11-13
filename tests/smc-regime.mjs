// SMC Trader HTF regime gate: smRegime / smRegimeOk on synthetic bars, plus smTick on a 15m long setup.
// Run: node tests/smc-regime.mjs   (after python3 build.py)
import fs from 'node:fs'; import vm from 'node:vm';
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8'), ctx);
const X = c => vm.runInContext(c, ctx);
let fails = 0;
const check = (ok, name, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got))); if (!ok) fails++; };

// bars through turning points, `n` bars per leg; a wick of 0.2% so every turn is a fractal swing
X(`
var zig = (pts, n = 4, extra = []) => { const c = [pts[0]]; for (let i = 1; i < pts.length; i++) for (let k = 1; k <= n; k++) c.push(pts[i - 1] + (pts[i] - pts[i - 1]) * k / n); c.push(...extra);
  return c.map((v, i) => { const o = i ? c[i - 1] : v; return [i * 3600e3, o, Math.max(o, v) * 1.002, Math.min(o, v) * 0.998, v, 1e5]; }); };
`);
const reg = code => JSON.parse(X(`JSON.stringify(smRegime(${code}))`));
const ok = (r, d, px) => JSON.parse(X(`JSON.stringify(smRegimeOk(${r}, '${d}', ${px}))`));

// ---- Task 1: regime classification
const up = reg('zig([1, 1.1, 1.05, 1.15, 1.10, 1.20, 1.16, 1.19])');
check(up.reg === 'up', 'HH + HL → up', up);
check(ok("'up'", 'L', 1.19).ok === true && ok("'up'", 'L', 1.19).play === 'trend', "up: long ok, play 'trend'", ok("'up'", 'L', 1.19));
check(ok("'up'", 'S', 1.19).ok === false, 'up: short refused', ok("'up'", 'S', 1.19));
const dn = reg('zig([1.2, 1.1, 1.15, 1.05, 1.10, 1.0, 1.04, 1.01])');
check(dn.reg === 'down', 'drop-base-drop (LH + LL) → down', dn);
check(ok("'down'", 'L', 1.01).ok === false && ok("'down'", 'S', 1.01).ok === true, 'down: short only', ok("'down'", 'L', 1.01));
const rg = reg('zig([1.1, 1.2, 1.0, 1.18, 1.02, 1.1])');
check(rg.reg === 'range' && Math.abs(rg.hi - 1.2) < 0.003 && Math.abs(rg.lo - 1.0) < 0.003, 'mixed swings → range 1.0–1.2 (wick to wick)', rg);
const RG = `smRegime(zig([1.1, 1.2, 1.0, 1.18, 1.02, 1.1]))`;
check(!ok(RG, 'L', 1.1).ok && !ok(RG, 'S', 1.1).ok, 'range middle (50%): both sides refused', [ok(RG, 'L', 1.1), ok(RG, 'S', 1.1)]);
check(ok(RG, 'L', 1.04).ok && ok(RG, 'L', 1.04).play === 'range' && !ok(RG, 'S', 1.04).ok, "range 20%: long ok (play 'range'), short refused", [ok(RG, 'L', 1.04), ok(RG, 'S', 1.04)]);
check(ok(RG, 'S', 1.17).ok && !ok(RG, 'L', 1.17).ok, 'range 85%: short ok, long refused', ok(RG, 'S', 1.17));
// a close above the range (that bar is also a new swing high: H2 > H1, L2 > L1 would read as up), latest back inside → fakeout
const fo = reg('zig([1.1, 1.2, 1.0, 1.18, 1.02, 1.15], 4, [1.21, 1.19, 1.15])');
check(fo.reg === 'fakeout_up', 'close above the range then back inside → fakeout_up (beats up)', fo);
check(ok("'fakeout_up'", 'S', 1.15).ok && ok("'fakeout_up'", 'S', 1.15).play === 'fakeout' && !ok("'fakeout_up'", 'L', 1.15).ok, "fakeout_up: short ok (play 'fakeout'), long refused", ok("'fakeout_up'", 'S', 1.15));
const fd = reg('zig([1.1, 1.0, 1.2, 1.02, 1.18, 1.05], 4, [0.99, 1.01, 1.05])');
check(fd.reg === 'fakeout_dn' && ok("'fakeout_dn'", 'L', 1.05).ok, 'close below the range then back inside → fakeout_dn, long ok', fd);
const few = reg('zig([1, 1.1, 1.05], 4).slice(0, 8)');
check(few.reg === null && ok('smRegime(zig([1, 1.1, 1.05], 4).slice(0, 8))', 'L', 1.05).ok === false, '8 bars → null, no trade', few);
check(/regime unclear/.test(ok('null', 'L', 1).why), "null regime → 'regime unclear'", ok('null', 'L', 1));
const eqh = reg('zig([1.0, 1.2, 1.05, 1.2, 1.1, 1.15])');
check(eqh.reg === 'range', 'equal highs (H2 == H1) with higher lows → range, not up', eqh);

// ---- Task 1: smTick on a 15m long setup (smc-sweep's SWEEPUSDT, not mirrored) under a 1h drop-base-drop
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
const kb = rows.map((r, i) => [T - (rows.length - i) * 900e3, r[0], r[1], r[2], r[3], r[4], r[4] * 0.45]);
S.meta.set(SYM, {base: 'SWEEP'}); S.kl.set(SYM, {t: T, bars: kb});
var hDown = [], hUp = []; let hp = 1.6, hq = 0.5;
for (let i = 0; i < 72; i++) { const o = hp; hp = hp * (i % 5 === 4 ? 1.025 : 0.988); hDown.push([T - (72 - i) * 3600e3, o, Math.max(o, hp) * 1.003, Math.min(o, hp) * 0.997, hp, 1e5, 5e4]); }
for (let i = 0; i < 72; i++) { const o = hq; hq = hq * (i % 5 === 4 ? 0.975 : 1.012); hUp.push([T - (72 - i) * 3600e3, o, Math.max(o, hq) * 1.003, Math.min(o, hq) * 0.997, hq, 1e5, 5e4]); }
S.h1.set(SYM, {t: T, bars: hDown});
S.tk.set(SYM, {last: 0.997, pct: -12, qv: 2e6});
S.trk[SYM] = {side: 'L', t0: T - 3600e3, px0: 1, rank: 2};
S.fund.set(SYM, {r: 0}); warm = true; S.started = T - 3600e3;
SM.on = true; SM.cfg.minQ = 0;
`);
const r15 = () => JSON.parse(X(`JSON.stringify((r => ({stage: r.stage, dir: r.dir, reg: r.regime && r.regime.reg, rok: r.rok}))(smcReadTf(SYM, '15m')))`));
const a = r15();
check(a.dir === 'L' && a.reg === 'down' && a.rok && a.rok.ok === false, '15m long setup read under a falling 1h: regime down, not ok', a);
X('S.smC.clear(); smTick();');
const scan = JSON.parse(X('JSON.stringify(SM.lastScan)'));
check(X('Object.keys(SM.pos).length') === 0, '1h drop-base-drop: no SMC long opened', X('JSON.stringify(SM.pos)'));
check(scan.cands.some(c => c.side === 'L' && /regime/.test(c.skip)), 'skip reason mentions the regime', scan);
// a forming 1h bar (t + 1h > now) that would flip the regime is ignored
X(`S.h1.set(SYM, {t: T, bars: hDown.concat([[T, hp, 2.5, hp, 2.4, 1e5, 5e4]])}); S.smC.clear();`);
check(r15().reg === 'down', 'forming 1h bar excluded from the regime', r15());
// control: same 15m long under a rising 1h is taken, and records regime + play
X(`S.h1.set(SYM, {t: T, bars: hUp}); S.smC.clear(); SM.cool = {}; smTick();`);
const pos = JSON.parse(X(`JSON.stringify(Object.values(SM.pos).map(p => ({side: p.side, regime: p.regime, play: p.play})))`));
check(pos.length === 1 && pos[0].side === 'L' && pos[0].regime === 'up' && pos[0].play === 'trend', 'rising 1h: long taken with regime up / play trend', pos);
// the close path copies regime + play to the log row
X(`smClose(SYM, 1, 'test close');`);
const row = JSON.parse(X('JSON.stringify(SM.log[0])'));
check(row.regime === 'up' && row.play === 'trend', 'log row carries regime + play', {regime: row.regime, play: row.play});

// ---- Task 2: the Nov 12 pause (one-time), exits still run
const mg = JSON.parse(X(`JSON.stringify((() => { const p = smMigrate({cfg: {ownJudge: 1, lev10: 1}, on: true}); const a = {on: p.on, f: p.cfg.pause1113}; p.on = true; smMigrate(p); return Object.assign(a, {again: p.on}); })())`));
check(mg.on === false && mg.f === 1 && mg.again === true, 'smMigrate pauses once (pause1113), a later resume sticks', mg);
const rs = JSON.parse(X(`JSON.stringify((() => { const p = smMigrate({cfg: {ownJudge: 1, lev10: 1, pause1113: 1}, on: false}); const a = {on: p.on, f: p.cfg.resume1113}; p.on = false; smMigrate(p); return Object.assign(a, {again: p.on}); })())`));
check(rs.on === true && rs.f === 1 && rs.again === false, 'resume1113 turns a paused account back on once; a later turn-off sticks', rs);
X(`SM.on = true; S.smC.clear(); SM.cool = {}; smTick(); SM.on = false;`);
check(X('Object.keys(SM.pos).length') === 1, 'position open before the pause test', X('Object.keys(SM.pos)'));
X(`S.smC.clear(); SM.cool = {}; S.tk.set(SYM, Object.assign({}, S.tk.get(SYM), {last: SM.pos[SYM].stop * 0.99})); smTick();`);
check(X('Object.keys(SM.pos).length') === 0 && /stop loss/.test(X('SM.log[0].exitWhy')), 'trading off: open position still stopped out', X('SM.log[0].exitWhy'));

// ---- Task 3: the Reviewer groups SMC trades by play, stop distance and planned RR
const st = JSON.parse(X(`JSON.stringify(smStudy([
  {s: 'AUSDT', t0: 1, R: 1, play: 'trend', regime: 'up', entry: 1, stop0: 0.99, rr: 2.2, q: {items: [], grade: 'B'}},
  {s: 'BUSDT', t0: 2, R: -1, play: 'trend', regime: 'down', entry: 1, stop0: 1.03, rr: 3, q: {items: [], grade: 'B'}},
  {s: 'CUSDT', t0: 3, R: 2, play: 'range', regime: 'range', entry: 1, stop0: 0.95, rr: 4, q: {items: [], grade: 'C'}},
  {s: 'DUSDT', t0: 4, R: 0, play: 'range', regime: 'range', entry: 2, stop0: 1.94, rr: 3.5, q: {items: [], grade: 'C'}},
  {s: 'EUSDT', t0: 5, R: -0.5, entry: 1, stop0: 0.985, rr: 2.6, q: {items: [], grade: 'D'}},
  {s: 'FUSDT', t0: 6, R: 0.5, q: {items: [], grade: 'D'}}]))`));
const g = (k, b) => st[k] && st[k][b] ? [st[k][b].n, +st[k][b].avgR.toFixed(2)] : null, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(eq(g('play', 'trend'), [2, 0]) && eq(g('play', 'range'), [2, 1]) && eq(g('play', '?'), [2, 0]), 'smStudy play groups {trend, range, ?} with n and avg R', st.play);
check(eq(g('stopPct', '<2%'), [2, 0.25]) && eq(g('stopPct', '2–4%'), [2, -0.5]) && eq(g('stopPct', '>4%'), [1, 2]), "smStudy stop distance buckets ('<2%', '2–4%', '>4%')", st.stopPct);
check(eq(g('rr', '<2.5'), [1, 1]) && eq(g('rr', '2.5–3.5'), [3, -0.5]) && eq(g('rr', '>3.5'), [1, 2]), "smStudy planned RR buckets ('<2.5', '2.5–3.5', '>3.5')", st.rr);
check(!/null|NaN/.test(JSON.stringify([st.play, st.stopPct, st.rr, st.regime])), 'no NaN in the new groups (old rows without regime → ?)', st.regime);

// ---- Nov 13: Fred's "poor OB" comments raise the bar for order blocks (obMinQ) instead of FVG-only
const ob = JSON.parse(X(`JSON.stringify((() => {
  const keep = {log: SM.log, learn: SM.cfg.learn, adj: RV.smAdj, sticky: RV.smSticky, why: RV.smWhy, rvm: RVM};
  SM.log = [1, 2, 3].map(i => ({s: 'OB' + i + 'USDT', strat: 'smc', side: 'L', t0: i * 1e6, t1: i * 1e6 + 5e5, R: -1, entry: 1, stop0: 0.97, zoneKind: 'OB', q: {items: [], grade: 'C'}}));
  RVM = {}; for (const x of SM.log) RVM[mineKey(x)] = {note: 'Poor OB', rd: {a: [], b: ['ob'], d: [], txt: 'Poor OB.', n: 7, t: 1, by: 'Claude'}};
  RV.smAdj = {fvgOnly: true}; RV.smSticky = {fvgOnly: {last: Date.now(), why: 'Your comments: the order block was poor on 4 trades'}}; RV.smWhy = {};
  SM.cfg.learn = 1; smLearn();
  const out = {adj: RV.smAdj, rules: smRules()};
  Object.assign(SM, {log: keep.log}); SM.cfg.learn = keep.learn; RV.smAdj = keep.adj; RV.smSticky = keep.sticky; RV.smWhy = keep.why; RVM = keep.rvm;
  return out; })())`));
check(ob.adj.obQ === true && !ob.adj.fvgOnly && ob.rules.obMinQ === Math.min(90, ob.rules.minQ + 10) && ob.rules.fvgOnly === false, '"poor OB" ×3 → order blocks need minQ + 10, kept FVG-only from comments dropped', ob);

if (fails) { console.error(`FAIL: ${fails} check(s) failed`); process.exit(1); }
console.log('PASS: SMC regime checks');
