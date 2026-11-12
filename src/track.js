/* ================= PATTERN TAGS + DAY TRACKER (trend / reversal watch) ================= */
const TAGS = {
  breakout: {l: 'Fresh breakout',   s: 'BREAKOUT',       c: '#2ee59d', d: 'Volume woke up (≥2.5× the previous day) and buyers lead. Fading it early fights real demand — wait for the flow to flip.'},
  run:      {l: 'Momentum run',     s: 'RUN',            c: '#7fe3b8', d: 'Steady climb without a big volume burst behind it.'},
  bounce:   {l: 'Crash bounce',     s: 'BOUNCE',         c: '#4dd2ff', d: 'Rebounding after a 25%+ crash in the last 3 days. These bounces often stall below the old high.'},
  squeeze:  {l: 'Short squeeze',    s: 'SQUEEZE',        c: '#b48cff', d: 'Price rising while shorts pay funding. Squeezes are fast and usually end once funding normalises.'},
  hot:      {l: 'Overheated',       s: 'OVERHEATED',     c: '#ffc94d', d: 'Longs crowded (high funding) or blow-off signs (big upper wick, net selling into the rise). Prime reversal-down candidate once structure breaks.'},
  crowdS:   {l: 'Shorts crowded',   s: 'SHORTS CROWDED', c: '#4dd2ff', d: 'Shorts paying funding while price falls — fuel for a sharp reversal up.'},
  trapped:  {l: 'Trapped longs',    s: 'TRAPPED LONGS',  c: '#ffc94d', d: 'Longs paying funding to hold a falling coin. Their liquidations can push it lower before a real bottom.'},
  postpump: {l: 'Fading after pump',s: 'POST-PUMP',      c: '#ff9db0', d: 'Giving back an earlier 30%+ pump on dying volume.'},
  capit:    {l: 'Capitulation',     s: 'CAPITULATION',   c: '#b48cff', d: 'Heavy selling on a volume spike near the lows. Flushes like this often mark bottoms once the selling dries up.'},
  bleed:    {l: 'Thin bleed',       s: 'THIN BLEED',     c: '#7c89a8', d: 'Illiquid drift lower with little flow. Reversals are unreliable here and slippage is high.'},
  down:     {l: 'Downtrend',        s: 'DOWNTREND',      c: '#ff5c7a', d: 'Orderly selling without an extreme in funding or volume.'},
};
const STATES = {
  wait:   {code: -1, l: 'Loading',            s: '…',             c: DIM},
  up:     {code: 0,  l: 'Still rising',       s: '↑ RISING',      c: UP},
  dn:     {code: 0,  l: 'Still falling',      s: '↓ FALLING',     c: DN},
  stallG: {code: 1,  l: 'Losing steam',       s: '~ STALLING',    c: WARN},
  stallL: {code: 1,  l: 'Losing steam',       s: '~ STALLING',    c: WARN},
  revG:   {code: 2,  l: 'Reversal forming ↓', s: '↓ REV FORMING', c: '#ff8a3d'},
  revL:   {code: 2,  l: 'Reversal forming ↑', s: '↑ REV FORMING', c: '#4dd2ff'},
  doneG:  {code: 3,  l: 'Reversed down',      s: '↓ REVERSED',    c: DN},
  doneL:  {code: 3,  l: 'Reversed up',        s: '↑ REVERSED',    c: UP},
};
S.trk = LS.get('awx_trk', {});
function trkSave() { LS.set('awx_trk', S.trk); }
// funding normalised to "per 4 hours" so 1h / 4h / 8h coins compare
function f4(s) { const r = (S.fund.get(s) || {}).r; return fin(r) ? r * 4 / (S.fint.get(s) || 8) : null; }
function sideOf(s) {
  const e = S.trk[s]; if (e) return e.side;
  if (S.gainers.includes(s)) return 'G'; if (S.losers.includes(s)) return 'L';
  return ((S.tk.get(s) || {}).pct || 0) >= 0 ? 'G' : 'L';
}
function rsiTail(cl, n = 14) {
  if (cl.length < n + 2) return [];
  let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; if (d > 0) g += d; else l -= d; } g /= n; l /= n;
  const out = []; for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); }
  return out.slice(-8);
}
function emaArr(a, p) { const k = 2 / (p + 1); let e = a.slice(0, p).reduce((x, y) => x + y, 0) / Math.min(p, a.length); return a.map((v, i) => (i >= p ? (e = v * k + e * (1 - k)) : e)); }
// 1h-candle context (72h): volume vs previous day, net flow, earlier crash / pump, wicks, RSI
function h1Stats(s) {
  const h = S.h1.get(s); if (!h || h.bars.length < 30) return null;
  const B = h.bars, n = B.length, live = (S.tk.get(s) || {}).last || B[n - 1][4];
  const d24 = B.slice(-24), p24 = B.slice(-48, -24), sum = (a, i) => a.reduce((x, b) => x + b[i], 0);
  const vol24 = sum(d24, 5), volP = sum(p24, 5) || 1, net24 = 2 * sum(d24, 6) - vol24;
  const hi24 = Math.max(...d24.map(b => b[2])), lo24 = Math.min(...d24.map(b => b[3]));
  const W = B.slice(0, Math.max(1, n - 12)); let rmax = -Infinity, rmin = Infinity, dd = 0, ddLow = null, ru = 0;
  for (const b of W) { rmax = Math.max(rmax, b[2]); const d = b[3] / rmax - 1; if (d < dd) { dd = d; ddLow = b[3]; } rmin = Math.min(rmin, b[3]); const u = b[2] / rmin - 1; if (u > ru) ru = u; }
  let upW = 0, loW = 0; for (const b of d24) { upW = Math.max(upW, (b[2] - Math.max(b[1], b[4])) / b[4]); loW = Math.max(loW, (Math.min(b[1], b[4]) - b[3]) / b[4]); }
  const cl = B.map(b => b[4]); cl[n - 1] = live;
  return {live, vol24, volX: vol24 / volP, net24, netShare: net24 / (vol24 || 1), hi24, lo24, fromHi: live / hi24 - 1, fromLo: live / lo24 - 1,
    rangePos: (live - lo24) / ((hi24 - lo24) || 1), dd, ddUp: ddLow ? live / ddLow - 1 : 0, ru, upW, loW, rsi: rsiTail(cl)};
}
function tagFor(s) {
  const h = h1Stats(s); if (!h) return null;
  const side = sideOf(s), fr = f4(s); let k;
  if (side === 'G') {
    if ((fin(fr) && fr >= 0.0008) || (h.upW >= 0.15 && h.fromHi <= -0.15 && h.net24 < 0)) k = 'hot';
    else if (fin(fr) && fr <= -0.0003) k = 'squeeze';
    else if (h.dd <= -0.25 && h.ddUp >= 0.2) k = 'bounce';
    else if (h.volX >= 2.5 && h.net24 > 0 && h.fromHi > -0.12) k = 'breakout';
    else k = 'run';
  } else {
    if (fin(fr) && fr <= -0.0003) k = 'crowdS';
    else if (fin(fr) && fr >= 0.0003) k = 'trapped';
    else if (h.ru >= 0.3 && h.volX <= 0.6) k = 'postpump';
    else if (h.volX >= 2.5 && h.net24 < 0 && h.rangePos < 0.2) k = 'capit';
    else if (h.vol24 < 250e3 && Math.abs(h.netShare) < 0.15) k = 'bleed';
    else k = 'down';
  }
  return Object.assign({k}, TAGS[k], {h});
}
// 8 reversal checks on 15m structure, flow, funding, OI and 1h RSI → trend state
function trendRead(s) {
  const k = S.kl.get(s), side = sideOf(s);
  if (!k || k.bars.length < 24) return {state: STATES.wait, key: 'wait', side, checks: [], score: 0, known: 0};
  const B = k.bars, n = B.length, live = (S.tk.get(s) || {}).last || B[n - 1][4];
  const hiOf = a => Math.max(...a.map(b => b[2])), loOf = a => Math.min(...a.map(b => b[3]));
  const c3 = B.slice(n - 4), prev = B.slice(n - 12, n - 4), w6 = B.slice(n - 24);
  const pk = w6.reduce((bi, b, i) => (b[2] > w6[bi][2] ? i : bi), 0), tr = w6.reduce((bi, b, i) => (b[3] < w6[bi][3] ? i : bi), 0);
  const LH = hiOf(c3) < hiOf(prev) * 0.99 && pk < w6.length - 4;
  const HL = loOf(c3) > loOf(prev) * 1.01 && tr < w6.length - 4;
  const cl = B.map(b => b[4]); cl[n - 1] = live; const E = emaArr(cl, 20), above = live > E[n - 1];
  const net = a => a.reduce((x, b) => x + 2 * b[6] - b[5], 0), n1 = net(c3), nPrev = net(B.slice(n - 16, n - 4));
  const q = c3.reduce((x, b) => x + b[5], 0), tb = c3.reduce((x, b) => x + b[6], 0), bs = q - tb > 0 ? tb / (q - tb) : null;
  let upW = 0, loW = 0; for (const b of B.slice(n - 12)) { upW = Math.max(upW, (b[2] - Math.max(b[1], b[4])) / b[4]); loW = Math.max(loW, (Math.min(b[1], b[4]) - b[3]) / b[4]); }
  const fr = f4(s), rg = regime(mget(s)), hs = h1Stats(s), R = hs ? hs.rsi : [];
  const rNow = R.length ? R[R.length - 1] : null, rMax = R.length ? Math.max(...R) : null, rMin = R.length ? Math.min(...R) : null;
  const fromHi = live / hiOf(B) - 1, fromLo = live / loOf(B) - 1;
  const P = (ok, label, d) => ({ok, label, d});
  const checks = side === 'G' ? [
    P(LH, 'Lower high on 15m', `last 1h high ${fmtPx(hiOf(c3))} vs ${fmtPx(hiOf(prev))}`),
    P(!above, 'Below 15m EMA20', `EMA ${fmtPx(E[n - 1])}`),
    P(n1 < 0, 'Net flow negative last 1h', `${fmtUsd(n1, 1)} (prior 3h ${fmtUsd(nPrev, 1)})`),
    P(fin(bs) ? bs < 0.9 : null, 'Sellers more aggressive (B/S < 0.9)', fmtRatio(bs)),
    P(upW >= 0.05, 'Rejection wick ≥ 5% (last 3h)', (upW * 100).toFixed(1) + '% upper wick'),
    P(fin(fr) ? fr >= 0.0005 : null, 'Longs crowded (funding ≥ 0.05%/4h)', fin(fr) ? fmtFund(fr) + '/4h' : '—'),
    P(rg ? ['updn', 'dnup', 'dndn'].includes(rg.k) : null, 'OI not backing the rally', rg ? rg.label : 'building OI history'),
    P(fin(rMax) ? rMax >= 70 && rNow <= rMax - 8 : null, 'RSI 1h rolling over from > 70', fin(rNow) ? `${rNow.toFixed(0)} (peak ${rMax.toFixed(0)})` : '—'),
  ] : [
    P(HL, 'Higher low on 15m', `last 1h low ${fmtPx(loOf(c3))} vs ${fmtPx(loOf(prev))}`),
    P(above, 'Back above 15m EMA20', `EMA ${fmtPx(E[n - 1])}`),
    P(n1 > 0, 'Net flow positive last 1h', `${fmtUsd(n1, 1)} (prior 3h ${fmtUsd(nPrev, 1)})`),
    P(fin(bs) ? bs > 1.1 : null, 'Buyers more aggressive (B/S > 1.1)', fmtRatio(bs)),
    P(loW >= 0.05, 'Lows rejected: wick ≥ 5% (last 3h)', (loW * 100).toFixed(1) + '% lower wick'),
    P(fin(fr) ? fr <= -0.0003 : null, 'Shorts crowded (funding ≤ −0.03%/4h)', fin(fr) ? fmtFund(fr) + '/4h' : '—'),
    P(rg ? ['updn', 'upup', 'dndn'].includes(rg.k) : null, 'OI shows covering or a flush', rg ? rg.label : 'building OI history'),
    P(fin(rMin) ? rMin <= 30 && rNow >= rMin + 8 : null, 'RSI 1h turning up from < 30', fin(rNow) ? `${rNow.toFixed(0)} (low ${rMin.toFixed(0)})` : '—'),
  ];
  const score = checks.filter(c => c.ok === true).length, known = checks.filter(c => c.ok !== null).length;
  let key;
  if (side === 'G') key = score >= 5 && fromHi <= -0.08 && !above ? 'doneG' : score >= 5 ? 'revG' : score >= 3 ? 'stallG' : 'up';
  else key = score >= 5 && fromLo >= 0.08 && above ? 'doneL' : score >= 5 ? 'revL' : score >= 3 ? 'stallL' : 'dn';
  return {state: STATES[key], key, side, checks, score, known, fromHi, fromLo, live, ema: E[n - 1]};
}
function trackManual(s, on) {
  if (!S.meta.has(s)) return;
  if (!on) { delete S.trk[s]; trkSave(); recomputeUniverse(); return; }
  const tk = S.tk.get(s) || {};
  S.trk[s] = {side: (tk.pct || 0) >= 0 ? 'G' : 'L', t0: now(), px0: tk.last, pct0: tk.pct, lastTop: now(), snaps: [], ev: [], st: null, tag: null, manual: true};
  trkSave(); recomputeUniverse(); nextRun.set('h1:' + s, 0); nextRun.set('kl:' + s, 0); nextRun.set('oi:' + s, 0);
}
// runs every ~15s: adds new top-5 entrants, re-tags, reads trend, logs state changes, raises alerts
/* ---- MOMENTUM READ: is the move still being driven (trade WITH it) — the mirror image of the reversal read ---- */
S.moC = new Map(); const MO_PREV = new Map();
const MSTATES = {
  wait: {code: -1, l: 'Loading', s: '…', c: DIM},
  none: {code: 0, l: 'No momentum', s: '— NONE', c: DIM},
  buildG: {code: 1, l: 'Momentum building ↑', s: '↑ BUILDING', c: '#7fe3b8'}, buildL: {code: 1, l: 'Momentum building ↓', s: '↓ BUILDING', c: '#ff9db0'},
  strongG: {code: 2, l: 'Strong momentum ↑', s: '↑ STRONG', c: UP}, strongL: {code: 2, l: 'Strong momentum ↓', s: '↓ STRONG', c: DN},
};
function momRead(s) {
  const k = S.kl.get(s), side = sideOf(s);
  if (!k || k.bars.length < 24) return {state: MSTATES.wait, key: 'wait', side, checks: [], score: 0, known: 0, ext: null};
  const B = k.bars, n = B.length, live = (S.tk.get(s) || {}).last || B[n - 1][4];
  const hiOf = a => Math.max(...a.map(b => b[2])), loOf = a => Math.min(...a.map(b => b[3]));
  const c3 = B.slice(n - 4), prev = B.slice(n - 12, n - 4);
  const cl = B.map(b => b[4]); cl[n - 1] = live; const E = emaArr(cl, 20), e = E[n - 1], eSlope = E[n - 1] / E[n - 5] - 1;
  const net = a => a.reduce((x, b) => x + 2 * b[6] - b[5], 0), n1 = net(c3);
  const q = c3.reduce((x, b) => x + b[5], 0), tb = c3.reduce((x, b) => x + b[6], 0), bs = q - tb > 0 ? tb / (q - tb) : null;
  const vPrev = B.slice(n - 16, n - 4).reduce((x, b) => x + b[5], 0) / 3, vx = vPrev > 0 ? q / vPrev : null;
  const fr = f4(s), rg = regime(mget(s)), hs = h1Stats(s), R = hs ? hs.rsi : [];
  const rNow = R.length ? R[R.length - 1] : null, rPrev = R.length > 1 ? R[R.length - 2] : null;
  const fromHi = live / hiOf(B) - 1, fromLo = live / loOf(B) - 1, ext = live / e - 1;
  const P = (ok, label, d) => ({ok, label, d});
  const checks = side === 'G' ? [
    P(hiOf(c3) > hiOf(prev) * 1.005 && fromHi > -0.03, 'Fresh high on 15m (within 3% of the 24h high)', `last 1h high ${fmtPx(hiOf(c3))} vs ${fmtPx(hiOf(prev))} · ${fmtPct(fromHi * 100)} from high`),
    P(live > e && eSlope > 0, 'Above a rising 15m EMA20', `EMA ${fmtPx(e)} · slope ${fmtPct(eSlope * 100, 2)}/h`),
    P(n1 > 0, 'Net flow positive last 1h', fmtUsd(n1, 1)),
    P(fin(bs) ? bs > 1.1 : null, 'Buyers more aggressive (B/S > 1.1)', fmtRatio(bs)),
    P(fin(vx) ? vx >= 1.3 : null, 'Volume expanding (last 1h ≥ 1.3× prior hours)', fin(vx) ? vx.toFixed(2) + '×' : '—'),
    P(fin(fr) ? fr < 0.0005 : null, 'Longs not crowded (funding < 0.05%/4h)', fin(fr) ? fmtFund(fr) + '/4h' : '—'),
    P(rg ? rg.k === 'upup' : null, 'OI rising with price (new longs)', rg ? rg.label : 'building OI history'),
    P(fin(rNow) ? rNow >= 55 && rNow <= 82 && rNow >= rPrev - 1 : null, 'RSI 1h strong, not exhausted (55–82)', fin(rNow) ? rNow.toFixed(0) : '—'),
  ] : [
    P(loOf(c3) < loOf(prev) * 0.995 && fromLo < 0.03, 'Fresh low on 15m (within 3% of the 24h low)', `last 1h low ${fmtPx(loOf(c3))} vs ${fmtPx(loOf(prev))} · ${fmtPct(fromLo * 100)} from low`),
    P(live < e && eSlope < 0, 'Below a falling 15m EMA20', `EMA ${fmtPx(e)} · slope ${fmtPct(eSlope * 100, 2)}/h`),
    P(n1 < 0, 'Net flow negative last 1h', fmtUsd(n1, 1)),
    P(fin(bs) ? bs < 0.9 : null, 'Sellers more aggressive (B/S < 0.9)', fmtRatio(bs)),
    P(fin(vx) ? vx >= 1.3 : null, 'Volume expanding (last 1h ≥ 1.3× prior hours)', fin(vx) ? vx.toFixed(2) + '×' : '—'),
    P(fin(fr) ? fr > -0.0003 : null, 'Shorts not crowded (funding > −0.03%/4h)', fin(fr) ? fmtFund(fr) + '/4h' : '—'),
    P(rg ? rg.k === 'dnup' : null, 'OI rising as price falls (new shorts)', rg ? rg.label : 'building OI history'),
    P(fin(rNow) ? rNow >= 18 && rNow <= 45 && rNow <= rPrev + 1 : null, 'RSI 1h weak, not washed out (18–45)', fin(rNow) ? rNow.toFixed(0) : '—'),
  ];
  const score = checks.filter(c => c.ok === true).length, known = checks.filter(c => c.ok !== null).length;
  const key = score >= 6 ? (side === 'G' ? 'strongG' : 'strongL') : score >= 4 ? (side === 'G' ? 'buildG' : 'buildL') : 'none';
  return {state: MSTATES[key], key, side, checks, score, known, ext, ema: e, live, fromHi, fromLo};
}
function trkUpdate() {
  const t = now(), g5 = trkTop('G'), l5 = trkTop('L');
  for (const [list, side] of [[g5, 'G'], [l5, 'L']]) list.forEach((s, i) => {
    const tk = S.tk.get(s); if (!tk) return;
    let e = S.trk[s];
    if (!e || (e.side !== side && !e.manual)) {
      e = S.trk[s] = {side, t0: t, px0: tk.last, pct0: tk.pct, lastTop: t, snaps: [], ev: [], st: null, tag: null};
      if (warm) raise('scout', s, 'trk' + side, `${base(s)} joins the top-5 ${side === 'G' ? 'gainers' : 'losers'} (${fmtPct(tk.pct)}) — tracking its trend today`, side === 'G' ? 1 : -1, 6 * 3600e3);
    }
    e.lastTop = t; e.rank = i + 1; e.bestRank = Math.min(e.bestRank || 9, i + 1);
  });
  for (const s of h1set()) {
    S.tagC.set(s, tagFor(s)); S.trC.set(s, trendRead(s));
    const mo = momRead(s); S.moC.set(s, mo);
    const was = MO_PREV.get(s); MO_PREV.set(s, mo.state.code);
    if (warm && mo.state.code === 2 && was != null && was < 2 && (S.trk[s] || S.gainers.slice(0, 10).includes(s) || S.losers.slice(0, 10).includes(s)))
      raise('scout', s, 'mo' + mo.key, `${base(s)}: ${mo.state.l} (${mo.score}/8 momentum signs): ${mo.checks.filter(c => c.ok).map(c => c.label.split(' (')[0].toLowerCase()).slice(0, 3).join(', ')}`, mo.side === 'G' ? 1 : -1, 60 * 60e3);
  }
  for (const s of Object.keys(S.trk)) {
    const e = S.trk[s];
    if (!g5.includes(s) && !l5.includes(s)) e.rank = null;
    if (t - e.lastTop > 24 * 3600e3 && !e.manual) { delete S.trk[s]; continue; }
    const tg = S.tagC.get(s) || tagFor(s), r = S.trC.get(s) || trendRead(s), tk = S.tk.get(s);
    if (!tk || r.key === 'wait') continue;
    if (tg) { if (e.tag && e.tag !== tg.k) e.ev.push({t, k: 'tag', from: e.tag, to: tg.k}); e.tag = tg.k; }
    const px = tk.last; e.hi = Math.max(e.hi || px, px); e.lo = Math.min(e.lo || px, px);
    if (e.st !== r.key) {
      if (e.st) {
        const why = r.checks.filter(c => c.ok).map(c => c.label);
        e.ev.push({t, k: 'st', from: e.st, to: r.key, why, px});
        const c = r.state.code, rev = c >= 2, gs = e.side === 'G';
        const txt = c >= 1 ? `${base(s)} (${gs ? 'gainer' : 'loser'}): ${r.state.l} — ${r.score}/8 signs${why.length ? ': ' + why.slice(0, 3).join(', ').toLowerCase() : ''}`
                           : `${base(s)}: back to ${r.state.l.toLowerCase()} (${gs ? 'uptrend' : 'downtrend'} resumed)`;
        raise('scout', s, 'st' + r.key, txt, c >= 2 ? (gs ? -1 : 1) : c === 0 ? (gs ? 1 : -1) : 0, 30 * 60e3, rev);
      }
      e.st = r.key;
    }
    const L = e.snaps[e.snaps.length - 1];
    if (!L || t - L[0] >= 5 * 60e3) { e.snaps.push([t, px, r.score, r.state.code]); if (e.snaps.length > 300) e.snaps.shift(); }
    if (e.ev.length > 40) e.ev.splice(0, e.ev.length - 40);
  }
  trkSave();
}
