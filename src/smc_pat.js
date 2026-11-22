/* ---- 1h chart patterns: SM.cfg.pat1h (Nov 22, TEST SWITCH, 0 live on every account) ----
   Concepts from Fred's GMS PMR v1.4 playbook (docs/pmr-v1.4.md); the geometry follows the research module bot/pmr.mjs.
   Flag, triangle, double top / bottom, head and shoulders on CLOSED 1h bars: bar j counts only once it has closed, against a boundary
   drawn from pivots confirmed BEFORE j (pivot i needs bars i+1..i+3 closed, so i + 3 <= j - 1), confirmed by a close beyond that
   boundary by >= 0.10 ATR1h. ATR = smATR(B, i): true ranges of the 14 bars before i, never bar i itself.
   pat1h 1 = filter: an SMC setup (15m or 1h) only stands if a same-direction pattern confirmed in the last PAT_FILT_H hours.
   pat1h 2 = trigger: the playbook's flow instead of sweep + shift. A pattern confirmed in the last PAT_TRIG_MIN minutes, the 15m leg
   of the breakout (a displacement candle among the 8 15m bars at the confirmation), its OB / FVG within 0.5 ATR1h of the boundary,
   then the existing zone pick, entry, stop and target logic. Built as a 'cont'-type setup (base = the OB candle, no sweep), so the
   Trader's labels read "continuation" for these. tools/smc-pat-test.mjs backtests both. */
const PAT_BRK = 0.10;        // breakout close beyond the boundary, in ATR1h (playbook)
const PAT_PIV = 3;           // 1h pivots: left = right = 3 bars (playbook)
const PAT_WIN = 60;          // pattern pivots come from the last 60 closed 1h bars before the breakout bar
const PAT_MIN_J = 40;        // warm-up: no pattern read before the 41st closed 1h bar
const PAT_DT = {gapMin: 5, gapMax: 40, tol: 0.6, minH: 1.5, prior: 2, priorLook: 24, maxAge: 30, newExt: 0.3};   // double top/bottom: 5–40 bars apart, tops within 0.6 ATR, height >= 1.5 ATR, prior move >= 2 ATR in 24 bars, breakout <= 30 bars after the 2nd top, no new extreme > 0.3 ATR
const PAT_HNS = {span: 60, gap: 3, headOver: 0.3, shTol: 1.5, neckTol: 1.5, prior: 2, priorLook: 24, maxAge: 20};   // H&S: within 60 bars, head >= 0.3 ATR beyond both shoulders, shoulders / troughs within 1.5 ATR, prior move >= 2 ATR, breakout <= 20 bars after the right shoulder
const PAT_TRI = {win: 48, flat: 0.3, minSpan: 8, minW: 0.3, maxAge: 24, tol: 0.1, lineSpan: 0.4, startGap: 0.5};   // triangle: last 2 highs + 2 lows in 48 bars, flat side within 0.3 ATR, span >= 8 bars, still >= 0.3 ATR wide, closes inside the lines (0.1 ATR slack), each line spans >= 40%
const PAT_FLAG = {pole: 3, poleBars: 12, minBars: 4, maxBars: 25, retr: 0.5};   // flag: pole >= 3 ATR within 12 bars, then 4–25 bars of pullback of <= 50% of the pole
const PAT_ORDER = ['HNS', 'INVERSE_HNS', 'DOUBLE_TOP', 'DOUBLE_BOTTOM', 'TRIANGLE', 'BULL_FLAG', 'BEAR_FLAG'];   // one pattern per bar: the first of these that fired
const PAT_FILT_H = 24;       // pat1h 1: pattern confirmed within the last 24 h (the playbook has no filter window; 24 h is the default asked for)
const PAT_TRIG_MIN = 120;    // pat1h 2: the playbook's retest window, 8 15m bars after the confirmation
const PAT_POI = 0.5;         // pat1h 2: OB / FVG to the boundary <= 0.5 ATR1h (playbook)
const PAT_IMP = 8;           // pat1h 2: the breakout impulse among the last 8 closed 15m bars at the confirmation (playbook)
const SM_PATC = new Map();   // sym|bar open time → pattern or null (a closed bar's read never changes)

function smPatPiv(B, j) {   // pivots confirmed before bar j, in the pattern window
  const hi = [], lo = [], R = PAT_PIV;
  for (let i = Math.max(R, j - PAT_WIN); i + R <= j - 1; i++) {
    let h = true, l = true;
    for (let k = i - R; k <= i + R && (h || l); k++) { if (k === i) continue;
      if (k < i) { if (B[k][2] >= B[i][2]) h = false; if (B[k][3] <= B[i][3]) l = false; } else { if (B[k][2] > B[i][2]) h = false; if (B[k][3] < B[i][3]) l = false; } }
    if (h) hi.push({i, p: B[i][2]}); if (l) lo.push({i, p: B[i][3]});
  }
  return {hi, lo};
}
// the pattern bar j (closed) breaks out of, or null. Reads only B[0..j].
function smPatDetect(B, j) {
  const atr = i => i >= 15 ? smATR(B, i) : null, a1 = atr(j); if (j < PAT_MIN_J || !(a1 > 0)) return null;
  const C = i => B[i][4], Hh = i => B[i][2], Ll = i => B[i][3], found = [];
  const ext = (a, b, s) => { let m = s > 0 ? -Infinity : Infinity, ix = -1; for (let x = a; x <= b; x++) { const v = s > 0 ? Hh(x) : Ll(x); if (s > 0 ? v > m : v < m) { m = v; ix = x; } } return [m, ix]; };   // s>0 max high, s<0 min low
  const at = (L, i) => L.p1 + (i - L.i1) * L.sl, line = (i1, p1, i2, p2) => ({i1, p1, sl: i2 === i1 ? 0 : (p2 - p1) / (i2 - i1)});
  const brk = (type, dir, L) => { const s = dir === 'L' ? 1 : -1, bnd = at(L, j); if (s * (C(j) - bnd) >= PAT_BRK * a1) found.push({type, dir, bnd}); };
  const intact = (from, to, L, s) => { for (let x = from; x <= to; x++) if (s * (C(x) - at(L, x)) > 0) return false; return true; };
  const {hi, lo} = smPatPiv(B, j);
  for (const [type, dir, ps, s] of [['HNS', 'S', hi, 1], ['INVERSE_HNS', 'L', lo, -1]]) {
    const q = PAT_HNS; if (ps.length < 3) continue;
    const [A, Hd, Cc] = ps.slice(-3), a = atr(Cc.i); if (!(a > 0)) continue;
    if (Cc.i - A.i > q.span || Hd.i - A.i < q.gap || Cc.i - Hd.i < q.gap || j - Cc.i > q.maxAge) continue;
    if (s * (Hd.p - A.p) < q.headOver * a || s * (Hd.p - Cc.p) < q.headOver * a || Math.abs(A.p - Cc.p) > q.shTol * a) continue;
    const [t1p, t1] = ext(A.i + 1, Hd.i - 1, -s), [t2p, t2] = ext(Hd.i + 1, Cc.i - 1, -s);
    if (t1 < 0 || t2 < 0 || Math.abs(t2p - t1p) > q.neckTol * a) continue;
    const neck = line(t1, t1p, t2, t2p);   // sloped neckline through the two troughs (peaks)
    if (s * (A.p - at(neck, A.i)) <= 0 || s * (Cc.p - at(neck, Cc.i)) <= 0) continue;
    if (s * (A.p - ext(Math.max(0, A.i - q.priorLook), A.i, -s)[0]) < q.prior * a) continue;
    let ok = true; for (let x = Cc.i + 1; x < j; x++) if (s * ((s > 0 ? Hh(x) : Ll(x)) - Hd.p) > 0) { ok = false; break; }   // no new head since
    if (ok && intact(Cc.i + 1, j - 1, neck, -s)) brk(type, dir, neck);
  }
  for (const [type, dir, ps, s] of [['DOUBLE_TOP', 'S', hi, 1], ['DOUBLE_BOTTOM', 'L', lo, -1]]) {
    const q = PAT_DT; if (ps.length < 2) continue;
    const [A, Bp] = ps.slice(-2), a = atr(Bp.i); if (!(a > 0)) continue;
    if (Bp.i - A.i < q.gapMin || Bp.i - A.i > q.gapMax || j - Bp.i > q.maxAge || Math.abs(A.p - Bp.p) > q.tol * a) continue;
    const [N] = ext(A.i + 1, Bp.i - 1, -s), top = s > 0 ? Math.max(A.p, Bp.p) : Math.min(A.p, Bp.p);
    if (Math.abs(top - N) < q.minH * a || s * (A.p - ext(Math.max(0, A.i - q.priorLook), A.i, -s)[0]) < q.prior * a) continue;
    let ok = true; for (let x = Bp.i + 1; x < j; x++) if (s * ((s > 0 ? Hh(x) : Ll(x)) - top) > q.newExt * a) { ok = false; break; }
    const neck = line(Bp.i, N, Bp.i, N);   // horizontal neckline at the extreme between the two tops (bottoms)
    if (ok && intact(Bp.i + 1, j - 1, neck, -s)) brk(type, dir, neck);
  }
  { const q = PAT_TRI, hs = hi.filter(p => p.i >= j - q.win).slice(-2), ls = lo.filter(p => p.i >= j - q.win).slice(-2);
    if (hs.length === 2 && ls.length === 2) {
      const first = Math.min(hs[0].i, ls[0].i), last = Math.max(hs[1].i, ls[1].i), a = atr(last), span = last - first;
      const spanOk = hs[1].i - hs[0].i >= q.lineSpan * span && ls[1].i - ls[0].i >= q.lineSpan * span && Math.abs(hs[0].i - ls[0].i) <= q.startGap * span;
      if (a > 0 && span >= q.minSpan && spanOk && j - last <= q.maxAge) {
        const U = line(hs[0].i, hs[0].p, hs[1].i, hs[1].p), Lw = line(ls[0].i, ls[0].p, ls[1].i, ls[1].p), dH = hs[1].p - hs[0].p, dL = ls[1].p - ls[0].p;
        const fH = Math.abs(dH) <= q.flat * a, fL = Math.abs(dL) <= q.flat * a;
        const kind = (fH && dL > q.flat * a) || (fL && dH < -q.flat * a) || (dH < -q.flat * a && dL > q.flat * a);   // ascending / descending / symmetrical
        const w0 = at(U, first) - at(Lw, first), wE = at(U, j - 1) - at(Lw, j - 1);
        if (kind && w0 > wE && wE >= q.minW * a) {
          let ok = true; for (let x = first; x < j; x++) if (C(x) > at(U, x) + q.tol * a || C(x) < at(Lw, x) - q.tol * a) { ok = false; break; }
          if (ok) { brk('TRIANGLE', 'L', U); brk('TRIANGLE', 'S', Lw); }   // direction only from the closed breakout bar
        }
      }
    } }
  for (const [dir, ps, s] of [['L', hi, 1], ['S', lo, -1]]) {
    const q = PAT_FLAG;
    for (let x = ps.length - 1; x >= 0; x--) {
      const A = ps[x], i = A.i; if (j - i > q.maxBars) break; if (j - i < q.minBars) continue;
      const a = atr(i); if (!(a > 0)) continue;
      if (s * (ext(i + 1, j - 1, s)[0] - A.p) > 0) continue;   // A is the flag's extreme
      const pole = s * (A.p - ext(Math.max(0, i - q.poleBars), i - 1, -s)[0]); if (pole < q.pole * a) continue;
      if (s * (A.p - ext(i + 1, j - 1, -s)[0]) > q.retr * pole) continue;
      const later = ps.filter(p => p.i > i), A2 = later[later.length - 1], L = A2 ? line(i, A.p, A2.i, A2.p) : line(i, A.p, i, A.p);
      if (!intact(i + 1, j - 1, L, s)) continue;
      brk(dir === 'L' ? 'BULL_FLAG' : 'BEAR_FLAG', dir, L); break;
    }
  }
  if (!found.length) return null;
  const f = found.sort((x, y) => PAT_ORDER.indexOf(x.type) - PAT_ORDER.indexOf(y.type))[0];
  return {type: f.type, dir: f.dir, bnd: f.bnd, t: B[j][0] + 3600e3, atr: a1};   // t = confirm time = the breakout bar's close
}
// patterns confirmed on the closed 1h bars of H1 within ms before tNow (oldest first); H1 must hold closed bars only
function smPatList(s, H1, tNow, ms) {
  if (SM_PATC.size > 50000) SM_PATC.clear();
  const out = [];
  for (let j = H1.length - 1; j >= PAT_MIN_J && H1[j][0] + 3600e3 >= tNow - ms; j--) {
    const key = s + '|' + H1[j][0]; if (!SM_PATC.has(key)) SM_PATC.set(key, smPatDetect(H1, j));
    const p = SM_PATC.get(key); if (p) out.unshift(p);
  }
  return out;
}
// pat1h 2: a 'cont'-type setup from the pattern's breakout leg on the 15m bars B
function smPatSetup(B, p, live) {
  const n = B.length, bull = p.dir === 'L'; let k = -1;
  for (let m = n - 1; m >= 0; m--) if (B[m][0] + 900e3 <= p.t) { k = m; break; }   // the last 15m bar closed at the confirmation
  if (k < 20) return null;
  let d = -1; for (let m = Math.max(1, k - PAT_IMP + 1); m <= k; m++) if (smDispG(B[m], smATR(B, m) || 1e-9, bull)) { d = m; break; }
  if (d < 0) return null;   // no displacement impulse: the playbook skips it
  let j = d - 1; for (let m = d - 1; m >= Math.max(0, d - 4); m--) if (bull ? B[m][4] < B[m][1] : B[m][4] > B[m][1]) { j = m; break; }   // OB = last opposite candle 1–4 bars before the impulse
  let ext = bull ? Infinity : -Infinity; for (let m = j; m <= k; m++) ext = bull ? Math.min(ext, B[m][3]) : Math.max(ext, B[m][2]);
  let leg = bull ? -Infinity : Infinity; for (let m = j + 1; m <= Math.min(k + 2, n - 1); m++) leg = bull ? Math.max(leg, B[m][2]) : Math.min(leg, B[m][3]);
  const r = {dir: p.dir, type: 'cont', pat: p.type, j, k, swept: null, lvl: {px: p.bnd, i: k}, ext, leg, stage: 'mss', zone: null, taps: 0, touch: -1};
  r.fib = smFib(B, r); smZoneSet(r, smZones(B, r, p.dir).filter(z => Math.max(0, z.lo - p.bnd, p.bnd - z.hi) <= PAT_POI * p.atr));
  if (!r.zone) { r.stage = 'nozone'; return r; }
  const zh = r.zone.hi - r.zone.lo, dep = smTapDepth(r.zone);   // same touch / spent / broken read as smContSetup
  for (let m = Math.max(k + 1, r.zone.i + 2); m < n; m++) {
    if (bull ? B[m][4] < r.zone.lo : B[m][4] > r.zone.hi) { r.stage = 'invalid'; return r; }
    if (bull ? B[m][3] <= r.zone.hi : B[m][2] >= r.zone.lo) { if (r.touch < 0) r.touch = m; if (m < n - 1 && (bull ? B[m][3] <= r.zone.hi - dep * zh : B[m][2] >= r.zone.lo + dep * zh)) r.taps++; }
  }
  const inZone = bull ? live <= r.zone.hi * 1.002 && live >= r.zone.lo : live >= r.zone.lo * 0.998 && live <= r.zone.hi;
  r.stage = inZone && !r.taps ? 'inzone' : r.taps ? 'spent' : 'mss';
  return r;
}
// the hook in smcReadTf: pat1h 1 filters the setups, pat1h 2 replaces them (15m only)
function smPatCands(s, tf, B, live, tNow, cands) {
  const H1 = (smBars(s, '1h') || []).filter(b => b[0] + 3600e3 <= tNow);   // closed 1h bars only
  if (SM.cfg.pat1h === 1) { const L = smPatList(s, H1, tNow, PAT_FILT_H * 3600e3); return cands.filter(c => L.some(p => p.dir === c.dir)); }
  if (tf !== '15m') return [];
  const L = smPatList(s, H1, tNow, PAT_TRIG_MIN * 60e3);
  return ['L', 'S'].map(d => L.filter(p => p.dir === d).pop()).filter(Boolean).map(p => smPatSetup(B, p, live)).filter(Boolean);
}
