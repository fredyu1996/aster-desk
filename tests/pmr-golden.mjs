// GMS PMR v1.4 golden tests (spec section 10) on hand-built candles. No network.
// 5m bars are written by hand around one bull-flag breakout; 15m and 1h bars are built from them, 1m bars split each 5m bar
// (open → first extreme → second extreme → close), so every timeframe agrees.
import fs from 'node:fs';
import {M1, M5, M15, H1, P, LookAhead, mkSeries, detect1h, findPois, runSetup, netRR, simExit, contract} from '../bot/pmr.mjs';

let fails = 0, passes = 0;
const ok = (c, name, extra = '') => { if (c) passes++; else { fails++; console.log('FAIL', name, extra); } };
const iso = t => new Date(t).toISOString().slice(11, 16);

/* ---------- builders ---------- */
const agg = (B5, ms) => { const o = []; let c = null; for (const b of B5) { const t = Math.floor(b[0] / ms) * ms; if (!c || c[0] !== t) { if (c && c.n === ms / M5) o.push(c.slice(0, 5)); c = [t, b[1], b[2], b[3], b[4]]; c.n = 1; } else { c[2] = Math.max(c[2], b[2]); c[3] = Math.min(c[3], b[3]); c[4] = b[4]; c.n++; } } if (c && c.n === ms / M5) o.push(c.slice(0, 5)); return o; };
const split1m = B5 => B5.flatMap(([t, o, h, l, c]) => { const [p1, p2] = c >= o ? [l, h] : [h, l], pts = [[o, p1], [p1, p1], [p1, p2], [p2, p2], [p2, c]]; return pts.map(([a, b], i) => [t + i * M1, a, Math.max(a, b), Math.min(a, b), b]); });
const T0 = Date.UTC(2026, 0, 10, 12);   // the 1h breakout bar closes at 12:00
// base path: flat at 143 (TR 1.0) until T0-45m, then the 15m impulse (C2) T0-30..T0-15 and C3 T0-15..T0; post = bars from T0
function build(post) {
  const B = [];
  for (let t = T0 - 36 * H1; t < T0 - 45 * 60e3; t += M5) B.push([t, 143, 143.5, 142.5, 143]);
  B.push([T0 - 45 * 60e3, 143, 143.5, 142.5, 143], [T0 - 40 * 60e3, 143, 143.5, 142.5, 143], [T0 - 35 * 60e3, 143, 143.5, 142.5, 143]);   // 15m C1: high 143.5
  B.push([T0 - 30 * 60e3, 143, 144.9, 142.9, 144.8], [T0 - 25 * 60e3, 144.8, 146.3, 144.7, 146.2], [T0 - 20 * 60e3, 146.2, 147.6, 146.1, 147.5]);   // 15m C2 displacement
  B.push([T0 - 15 * 60e3, 147.5, 148.3, 147.5, 148.2], [T0 - 10 * 60e3, 148.2, 148.7, 148.1, 148.6], [T0 - 5 * 60e3, 148.6, 148.65, 148.4, 148.5]);  // 15m C3: low 147.5 → FVG 143.5-147.5
  post.forEach((p, i) => B.push([T0 + i * M5, ...p]));
  let last = B[B.length - 1][4]; for (let t = T0 + post.length * M5; t < T0 + 26 * H1; t += M5) B.push([t, last, last + 0.4, last - 0.4, last]);
  return B;
}
const BASE = [[148.5, 148.6, 148.0, 148.1], [148.1, 148.2, 147.6, 147.7], [147.7, 147.8, 147.2, 147.3],   // touch at 12:15 (low 147.2 <= 147.5)
  [147.3, 147.5, 146.9, 147.4],          // C1 (closes 12:20, high 147.5)
  [147.4, 149.5, 147.3, 149.3],          // C2 (closes 12:25): displacement, close above the 148.7 swing → MSS at 12:25
  [149.3, 149.9, 148.4, 149.7],          // C3 (closes 12:30): low 148.4 > 147.5 → 5m FVG 147.5-148.4, order at 12:30
  [149.7, 149.8, 147.8, 148.0]];         // fills at the midpoint 147.95
function mkData(post) {
  const B5 = build(post), D = {S1: mkSeries(agg(B5, H1), H1, P.piv1h), S15: mkSeries(agg(B5, M15), M15, P.piv15), S5: mkSeries(B5, M5, P.piv5)}, m1 = split1m(B5);
  return {D, getM1: async (a, b) => m1.filter(x => x[0] >= a && x[0] < b), m1};
}
function mkEv(D, over = {}) {
  const j = D.S1.n(T0) - 1;
  return Object.freeze(Object.assign({pattern_id: 'TEST|BULL_FLAG|L', sym: 'TEST', type: 'BULL_FLAG', sub: null, dir: 'L', confirmed_at: T0, bar: j,
    boundary: {i1: j - 5, t1: 0, p1: 145, slope: 0}, boundary_at_t: 145, atr1h: 2, height: 15, target_pre: 160, inval: 140, piv: [], bias4h: 'up', group: 'TREND', also: []}, over));
}
const codes = R => R.log.map(l => l.code);

/* ---------- 1h pattern anchor ---------- */
{ // bull flag on 1h bars: pole 100 → 145 (pivot high), flag drifting to ~134, then the breakout bar
  const B = [], t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 45; i++) B.push([t0 + i * H1, 100, 105, 95, 100]);
  for (let i = 0; i < 8; i++) { const o = 100 + 5 * i; B.push([t0 + B.length * H1, o, o + 6, o - 1, o + 5]); }
  B.push([t0 + B.length * H1, 140, 145, 139, 141]);
  for (let i = 0; i < 8; i++) { const c = 138 - 0.5 * i; B.push([t0 + B.length * H1, c + 0.5, c + 2, c - 3, c]); }
  const jT = t0 + B.length * H1, mk = (h, c) => mkSeries([...B, [jT, 135, h, 134, c]], H1, P.piv1h), Tc = jT + H1;
  const w = detect1h(mk(150, 140), Tc, 'TEST');
  ok(!w.ev && w.waits.some(x => x.reason === 'WICK_ONLY'), '1H only wick crosses boundary → WAIT, no anchor', JSON.stringify(w.waits));
  const S = mk(152, 150), e = detect1h(S, Tc, 'TEST');
  ok(e.ev && e.ev.type === 'BULL_FLAG' && e.ev.dir === 'L' && e.ev.confirmed_at === Tc, 'closed 1h breakout → BULL_FLAG confirmed at the bar close', JSON.stringify(e.ev && e.ev.type));
  ok(!detect1h(S, Tc - 30 * 60e3, 'TEST').ev, '1H close not yet complete → WAIT, no premature anchor');
  ok(e.ev && Object.isFrozen(e.ev) && Object.isFrozen(e.ev.boundary), 'pattern event and boundary are frozen (immutable)');
  const sm = detect1h(mk(147, 145.1), Tc, 'TEST');
  ok(!sm.ev && sm.waits.some(x => x.reason === 'BREAKOUT_TOO_SMALL'), 'close beyond boundary by < 0.10 ATR → BREAKOUT_TOO_SMALL');
}

/* ---------- view guard ---------- */
{ const {D} = mkData(BASE), V = D.S5.view(T0);
  let threw = false; try { V.b(V.n); } catch (e) { threw = e instanceof LookAhead; }
  ok(threw, 'View throws LookAhead when a bar not yet closed is read');
}

/* ---------- 15m causal POI ---------- */
{ const {D} = mkData(BASE), ev = mkEv(D), r = findPois(D.S15, ev, T0);
  ok(r.best && r.best.type === 'FVG' && r.best.lo === 143.5 && r.best.hi === 147.5 && r.best.known_at === T0, 'causal 15m FVG found at t0 (143.5-147.5, known at t0)', JSON.stringify(r.best));
  ok(r.cands.every(c => c.known_at <= T0), 'no candidate known after t0 at t0');
}
{ // 15m candidate formed AFTER t0: its C3 closes 12:15, so at t0 it does not exist and later it is known at 12:15 (never backdated)
  const B5 = build([[148.5, 148.6, 148.4, 148.5], [148.5, 148.6, 148.4, 148.55], [148.55, 148.7, 148.5, 148.6]]);
  // move the impulse one 15m bar later: C2 = 11:45-12:00, C3 = 12:00-12:15
  const k = B5.findIndex(b => b[0] === T0 - 30 * 60e3);
  B5.splice(k, 3, [T0 - 30 * 60e3, 143, 143.5, 142.5, 143], [T0 - 25 * 60e3, 143, 143.5, 142.5, 143], [T0 - 20 * 60e3, 143, 143.5, 142.5, 143]);
  const k2 = B5.findIndex(b => b[0] === T0 - 15 * 60e3);
  B5.splice(k2, 3, [T0 - 15 * 60e3, 143, 144.9, 142.9, 144.8], [T0 - 10 * 60e3, 144.8, 146.3, 144.7, 146.2], [T0 - 5 * 60e3, 146.2, 147.6, 146.1, 147.5]);
  const k3 = B5.findIndex(b => b[0] === T0);
  B5.splice(k3, 3, [T0, 147.5, 148.3, 147.5, 148.2], [T0 + 5 * 60e3, 148.2, 148.7, 148.1, 148.6], [T0 + 10 * 60e3, 148.6, 148.65, 148.4, 148.5]);
  const S15 = mkSeries(agg(B5, M15), M15, P.piv15), ev = mkEv({S1: mkSeries(agg(B5, H1), H1, P.piv1h)});
  const at0 = findPois(S15, ev, T0), at1 = findPois(S15, ev, T0 + M15);
  ok(!at0.best && !at0.cands.some(c => c.known_at > T0), '15m FVG whose C3 is not closed at t0 is not a candidate at t0');
  ok(at1.best && at1.best.known_at === T0 + M15 && at1.best.known_at > T0, 'continuation FVG gets its own known_at (12:15), never backdated to t0', JSON.stringify(at1.best && iso(at1.best.known_at)));
}
{ // not causal: the same impulse 6 hours before t0
  const B5 = build(BASE.slice(0, 1)), k = B5.findIndex(b => b[0] === T0 - 30 * 60e3);
  const imp = B5.splice(k - 3, 9).map(b => b.slice()); for (let i = 0; i < 9; i++) B5.splice(k - 3 + i, 0, [T0 - 45 * 60e3 + i * M5, 143, 143.5, 142.5, 143]);
  const at = B5.findIndex(b => b[0] === T0 - 6 * H1 - 45 * 60e3); imp.forEach((b, i) => { b[0] = T0 - 6 * H1 - 45 * 60e3 + i * M5; B5[at + i] = b; });
  // the rest of the old path after the impulse sits at 148.5 → keep it there until t0 so the zone stays untouched
  for (let x = at + 9; B5[x][0] < T0; x++) B5[x] = [B5[x][0], 148.5, 148.7, 148.3, 148.5];
  const S15 = mkSeries(agg(B5, M15), M15, P.piv15), ev = mkEv({S1: mkSeries(agg(B5, H1), H1, P.piv1h)}), r = findPois(S15, ev, T0);
  ok(!r.best && r.cands.some(c => c.status === 'SKIP_POI_NOT_CAUSAL'), '15m zone not caused by the breakout impulse → SKIP_POI (not causal)', JSON.stringify(r.cands.map(c => c.status)));
}
{ // mitigated before the 1h close: a 5m bar at 11:55 dips into the 15m FVG
  // rebuild cleanly: flat → C1 (11:00-11:15) → C2 (11:15-11:30) → C3 (11:30-11:45) → 11:45-12:00 dips to 146.0 → post
  const B8 = [];
  for (let t = T0 - 36 * H1; t < T0 - H1; t += M5) B8.push([t, 143, 143.5, 142.5, 143]);
  B8.push([T0 - 60 * 60e3, 143, 143.5, 142.5, 143], [T0 - 55 * 60e3, 143, 143.5, 142.5, 143], [T0 - 50 * 60e3, 143, 143.5, 142.5, 143]);
  B8.push([T0 - 45 * 60e3, 143, 144.9, 142.9, 144.8], [T0 - 40 * 60e3, 144.8, 146.3, 144.7, 146.2], [T0 - 35 * 60e3, 146.2, 147.6, 146.1, 147.5]);
  B8.push([T0 - 30 * 60e3, 147.5, 148.3, 147.5, 148.2], [T0 - 25 * 60e3, 148.2, 148.7, 148.1, 148.6], [T0 - 20 * 60e3, 148.6, 148.65, 148.4, 148.5]);
  B8.push([T0 - 15 * 60e3, 148.5, 148.6, 146.0, 148.4], [T0 - 10 * 60e3, 148.4, 148.6, 148.3, 148.5], [T0 - 5 * 60e3, 148.5, 148.6, 148.4, 148.5]);
  for (let t = T0; t < T0 + 3 * H1; t += M5) B8.push([t, 148.5, 148.6, 148.4, 148.5]);
  const S15 = mkSeries(agg(B8, M15), M15, P.piv15), ev = mkEv({S1: mkSeries(agg(B8, H1), H1, P.piv1h)}), r = findPois(S15, ev, T0);
  ok(!r.best && r.cands.some(c => c.type === 'FVG' && c.status === 'SKIP_USED_ZONE'), '15m FVG already mitigated before the 1h close → SKIP_USED_ZONE', JSON.stringify(r.cands.map(c => c.type + ':' + c.status)));
}

/* ---------- 5m entry, orders, fills ---------- */
{ const {D, getM1} = mkData(BASE), ev = mkEv(D), R = await runSetup(ev, D, getM1);
  const o = R.order || {};
  ok(R.status === 'FILLED', 'base scenario fills', R.status + ' ' + codes(R).join(','));
  ok(o.first_retest_at === T0 + 15 * 60e3, 'first retest at 12:15 (first 5m touch after t0)', iso(o.first_retest_at));
  ok(o.mss_confirmed_at === T0 + 25 * 60e3 && o.fvg && o.fvg.c3_closed_at === T0 + 30 * 60e3 && o.active_after === T0 + 30 * 60e3,
    'MSS at 12:25, FVG C3 at 12:30 → order detected at 12:30, never backdated to the MSS', `mss ${iso(o.mss_confirmed_at)} c3 ${o.fvg && iso(o.fvg.c3_closed_at)} active ${iso(o.active_after)}`);
  ok(Math.abs(o.entry - 147.95) < 1e-9 && o.fvg.lo === 147.5 && o.fvg.hi === 148.4, 'entry = 5m FVG midpoint 147.95', String(o.entry));
  ok(o.stop < 143.5 && o.stop > 143, 'stop beyond the 15m POI far edge (143.5) plus 0.15 ATR5', String(o.stop));
  ok(o.fill_at >= o.active_after && o.fill_at < o.expires, 'fill at or after active_after', `${iso(o.fill_at)} ≥ ${iso(o.active_after)}`);
  const c = contract(R);
  ok(c.strategy === 'GMS_PMR_1H_v1.4' && c.direction === 'LONG' && c.parent_fvg_bounds && c.entry_fvg_bounds && c.action === 'PAPER_ORDER_RESEARCH_ONLY', 'JSON contract filled');
  ok(o.research_label_only === true && ['A', 'A_PLUS_CANDIDATE'].includes(o.grade), 'grade is a research label only');
  // hold LTF_CONFIRMED while the FVG's C3 is still open
  const Rh = await runSetup(ev, D, getM1, T0 + 25 * 60e3);
  ok(Rh.status === 'LTF_CONFIRMED' && !Rh.order, '5m FVG C3 not closed → hold LTF_CONFIRMED, no order', Rh.status);
}
{ const post = BASE.slice(0, 4).concat([[147.4, 147.9, 147.0, 147.6]]); for (let i = 0; i < 20; i++) post.push([147.6, 147.9, 147.1, 147.5]);
  const {D, getM1} = mkData(post), R = await runSetup(mkEv(D), D, getM1);
  ok(R.status === 'NO_LTF_CONFIRMATION' && R.end_at === T0 + 15 * 60e3 + 50 * 60e3, 'POI touched, no 5m MSS → expire after 45 min', R.status + ' ' + iso(R.end_at));
}
{ const post = []; for (let i = 0; i < 40; i++) post.push([148.2, 148.6, 147.8, 148.2]);
  const {D, getM1} = mkData(post), R = await runSetup(mkEv(D), D, getM1);
  ok(R.status === 'EXPIRED_NO_TOUCH' && R.end_at === T0 + 125 * 60e3, 'no retest within 120 min → EXPIRED_NO_TOUCH', R.status + ' ' + iso(R.end_at));
}
{ const post = BASE.slice(0, 6); for (let i = 0; i < 20; i++) post.push([149.7, 150.0, 148.1, 149.6]);
  const {D, getM1} = mkData(post), R = await runSetup(mkEv(D), D, getM1);
  ok(R.status === 'EXPIRED_NO_FILL' && !R.order.fill_at, 'price that traded through the entry only BEFORE the signal (C2) never fills → EXPIRED_NO_FILL', R.status);
}
{ const post = [[148.5, 148.6, 148.4, 148.5], [148.5, 150.6, 148.45, 150.5], [150.5, 150.7, 149.0, 149.1], [149.1, 149.2, 148.0, 148.1], [148.1, 148.2, 147.2, 147.3]];
  for (let i = 0; i < 20; i++) post.push([147.5, 147.9, 147.1, 147.5]);
  const {D, getM1} = mkData(post), R = await runSetup(mkEv(D), D, getM1);
  ok(codes(R).includes('REJECT_AS_ENTRY_FVG') && !(R.order && R.order.fvg && R.order.fvg.c3_closed_at <= R.order.first_retest_at), '5m FVG formed before the POI touch → REJECT_AS_ENTRY_FVG', codes(R).join(','));
}
{ const {D, getM1} = mkData(BASE), R = await runSetup(mkEv(D, {target_pre: 152}), D, getM1);
  ok(R.status === 'SKIP_RR', 'net R:R below 2 → SKIP_RR (no order)', R.status);
  const r = netRR('L', 100, 99.6, 101);
  ok(Math.abs(r.gross - 2.5) < 1e-9 && r.net < 2 && r.net > 1.6, 'gross 2.5 but net < 2 after fees / spread / slippage → SKIP_RR', `gross ${r.gross} net ${r.net.toFixed(2)}`);
}
{ // same minute touches stop and target → stop first; the fill minute never takes the target
  const m1 = [[0, 100, 100.2, 99.9, 100], [60e3, 100, 103, 98, 100], [120e3, 100, 100, 100, 100]];
  const x = simExit(m1, 0, 'L', 100, 99, 102, 0);
  ok(x.why === 'STOP' && x.px === 99, 'same 1m bar touches stop and target → stop first', JSON.stringify(x));
  const y = simExit([[0, 100, 103, 99.5, 102.5], [60e3, 102.5, 102.6, 102.4, 102.5], [120e3, 102.5, 102.6, 102.4, 102.5]], 0, 'L', 100, 99, 102, 0, 0.05);
  ok(y.why !== 'TARGET' || y.t > 60e3, 'target is not taken inside the fill minute', JSON.stringify(y));
}
{ // the grade never drives a decision: the only reads of .grade are the label and the JSON contract
  const src = fs.readFileSync(new URL('../bot/pmr.mjs', import.meta.url), 'utf8');
  const reads = src.split('\n').filter(l => /\.grade\b/.test(l));
  ok(reads.length === 1 && /grade: o\.grade/.test(reads[0]), 'A+ tag is a research label only (no decision reads it)', reads.join(' | '));
}

console.log(`pmr golden: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
