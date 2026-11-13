/* ================= REVIEWER ON THE CHART + RULES IN FORCE ================= */
// Every closed trade, drawn on its own candles with the Reviewer's verdict: numbered ✓ (done right) and ✗ (done wrong)
// tags sit on the chart where each thing happened (entry, best point, partial, exit). Shown on the review wall
// (west wall, replaces the old House Rules poster) and on the Reviewer's "On the chart" tab.
// Also: the rules each trader is using right now, with the Reviewer's changes marked.

const RVK = new Map();                            // candles per closed trade
const RVT = {tags: LS.get('awx_tags', true) !== false}; // show the ✓/✗ tags on trade charts (T at the review wall, or the button on the chart)
function rvTagsToggle() { RVT.tags = !RVT.tags; LS.set('awx_tags', RVT.tags); try { drawReviewWall(); } catch (_) {} try { document.querySelectorAll('canvas[data-rvchart]').forEach(drawRvCanvas); } catch (_) {} const b = document.querySelector('[data-rvtags]'); if (b) { b.classList.toggle('on', RVT.tags); b.textContent = RVT.tags ? '✓/✗ on chart: ON' : '✓/✗ on chart: OFF'; } }
const RVS = {key: null, acct: 'all'};
// marking your own setup on a trade's chart: on/off, the tool in hand, a drag in progress, undo history
const RVP = {on: false, tool: 'entry', drag: null, hist: [], warn: ''};             // panel selection
const RWS = {i: 0, t: 0, key: null};              // wall rotation
const isManual = x => /closed by you/.test(x.exitWhy || '');
const tradeKey = (a, x) => a + '|' + x.s + '|' + x.t1;
const fmtNum = v => String(+(+v).toFixed(2));

/* ---- which trades: both accounts, newest first ---- */
function rvTrades(which = 'all') {
  const A = [];
  if (which !== 'sm') for (const x of PT.log) A.push(['pt', x]);
  if (which !== 'pt' && typeof SM !== 'undefined') for (const x of SM.log) A.push(['sm', x]);
  return A.sort((a, b) => b[1].t1 - a[1].t1);
}
const stratName = (a, x) => a === 'sm' ? 'SMC Trader' : x.strat === 'mom' ? 'Trader · Momentum' : 'Trader · Reversal';

/* ---- candles around a closed trade (fetched once, cached) ---- */
function rvBars(x) {
  const k = x.s + '|' + x.t0 + '|' + x.t1; let e = RVK.get(k);
  if (e && (e.st !== 'err' || now() - e.t < 60e3)) {
    // trades that closed recently: refresh once later so the bars after the exit fill in
    if (e.st === 'ok' && now() - x.t1 < (RV_FU_H + 1) * 3600e3 && now() - e.t > 10 * 60e3) e = null; else return e;
  }
  // from a little before the entry to 24h after the exit (the Reviewer's follow-up window)
  const endT = x.t1 + RV_FU_H * 3600e3, span = Math.max(endT - x.t0, 10 * 60e3);
  const IV = [['15m', 15], ['1h', 60], ['4h', 240]].find(([, m]) => span / (m * 60e3) <= 150) || ['4h', 240];
  const ms = IV[1] * 60e3, pre = 24, start = Math.floor(x.t0 / ms) * ms - pre * ms, end = Math.min(now(), endT);
  e = {st: 'load', t: now(), iv: IV[0], ms, bars: null}; RVK.set(k, e);
  api(`/fapi/v1/klines?symbol=${x.s}&interval=${IV[0]}&startTime=${start}&endTime=${end}&limit=500`)
    .then(a => { e.bars = a.map(b => [+b[0], +b[1], +b[2], +b[3], +b[4]]); e.st = 'ok'; e.t = now(); rvRedraw(); })
    .catch(() => { e.st = 'err'; e.t = now(); });
  return e;
}
function rvRedraw() {
  document.querySelectorAll('canvas[data-rvchart]').forEach(drawRvCanvas);
  try { drawReviewWall(); } catch (_) {}
}

/* ---- what went right / wrong, and where on the chart ---- */
// at: where the tag goes on the chart: 'entry' | 'best' | 'tp1' | 'exit'
function rvExplain(x, acct) {
  // k = a stable key per point, so your agree/disagree marks can be counted across trades
  const G = [], B = [], ok = (t, at, k) => G.push({t, at, k: k || 'other'}), bad = (t, at, k) => B.push({t, at, k: k || 'other'});
  const ex = x.exitWhy || '', held = (x.t1 - x.t0) / 60e3, smc = acct === 'sm', mom = x.strat === 'mom', R = x.R, mx = x.maxR || 0;
  const partial = (x.ex || []).find(e => /took half/.test(e[2] || '')) || (/trailing|breakeven/.test(ex) ? [null, null, 'half'] : null);
  // entry quality
  if (smc && x.q && x.q.items) {
    // judged as SMC: was it a good sweep, a good FVG / order block, the right timeframe, a good entry in the zone?
    const tf = x.tf || '15m', htf = (SM_TF[tf] || SM_TF['15m']).htf;
    for (const i of x.q.items) {
      const at = i.k === 'depth' ? 'entry' : 'entry';
      if (i.ok === 2) ok(i.t, at, 'smc_' + i.k);
      else if (i.ok === 0) bad(i.t, at, 'smc_' + i.k);
      else if ((i.k === 'htf' || i.k === 'depth' || i.k === 'gap' || i.k === 'ob') && R < 0) bad(i.t, at, 'smc_' + i.k);
    }
    if (x.htfBias && ((x.side === 'L' && x.htfBias === 'bear') || (x.side === 'S' && x.htfBias === 'bull'))) bad(`Traded against the ${htf}: ${x.side === 'L' ? 'long' : 'short'} on the ${tf} while the ${htf} was ${x.htfBias === 'bear' ? 'falling' : 'rising'}`, 'entry', 'smc_htf');
    if (fin(x.rr)) ok(`Planned ${x.rr.toFixed(1)}R to the next liquidity pool`, 'entry', 'smc_rr');
    if (mx >= 1) ok(`The zone held: price left it and reached +${mx.toFixed(1)}R`, 'best', 'smc_held');
    else if (mx < 0.3 && R < 0) bad(`The zone failed: price went straight through it (best +${Math.max(0, mx).toFixed(1)}R)`, 'entry', 'smc_failed');
    const so = smOutcome(x);
    if (so.reached) ok('Took the target liquidity', 'exit', 'smc_tgt');
    else if (so.frac != null && mx >= 0.3) bad(`Got ${Math.round(so.frac * 100)}% of the way to the target liquidity, then turned`, 'best', 'smc_tgt');
  } else if (smc) {
    if (fin(x.sc)) { if (x.sc >= 5) ok(`Strong setup: ${x.sc}/6 confluences`, 'entry', 'strong'); else if (R < 0) bad(`Weak setup: only ${x.sc}/6 confluences`, 'entry', 'weak'); else ok(`Entered on ${x.sc}/6 confluences`, 'entry', 'strong'); }
    if (x.zoneKind) { if (x.zoneKind === 'FVG') ok('Entered in a fair value gap (the cleaner zone)', 'entry', 'smc_gap'); else if (R < 0) bad('Order block entry: no gap, a weaker zone', 'entry', 'smc_ob'); }
    if (fin(x.rr)) ok(`Planned ${x.rr.toFixed(1)}R to the next liquidity pool`, 'entry', 'smc_rr');
  } else if (mom) {
    if (fin(x.sc)) { if (x.sc >= 7) ok(`Strong momentum: ${x.sc}/8 signs`, 'entry', 'strong'); else if (R < 0) bad(`Momentum was borderline: ${x.sc}/8 signs`, 'entry', 'weak'); else ok(`Entered on ${x.sc}/8 momentum signs`, 'entry', 'strong'); }
  } else {
    if (fin(x.sc)) { if (x.sc >= 7) ok(`Strong signal: ${x.sc}/8 reversal signs`, 'entry', 'strong'); else if (R < 0 && x.sc <= 5) bad(`Borderline signal: ${x.sc}/8 reversal signs`, 'entry', 'weak'); else ok(`Entered on ${x.sc}/8 reversal signs`, 'entry', 'strong'); }
    const done = x.st ? String(x.st).startsWith('done') : /Reversed/.test(x.why || '');
    if (done) ok('Waited for "Reversed" confirmation', 'entry', 'reversed');
    else if (R < 0) bad('Entered at "Reversal forming", before it was confirmed', 'entry', 'forming');
  }
  // direction (SMC trades with a quality read already said whether the zone held)
  if (!(smc && x.q)) {
    if (mx >= 1) ok(`Direction was right: reached +${mx.toFixed(1)}R`, 'best', 'right');
    else if (mx < 0.3 && R < 0) bad(`Never worked: best was only +${Math.max(0, mx).toFixed(1)}R`, 'entry', 'never');
  }
  // unlocks
  if (x.unlK === 'ahead') { if (x.side === 'S') (R > 0 ? ok : bad)(R > 0 ? 'Shorted into an upcoming unlock: supply pressure helped' : 'Shorted into an upcoming unlock, but it did not pay', 'entry', 'unlock'); else (R > 0 ? ok : bad)(R > 0 ? 'Long with a big unlock ahead worked this time' : 'Bought with a big unlock ahead', 'entry', 'unlock'); }
  if (x.unlK === 'after' && R < 0) bad('Traded right after a big unlock, when bounces are common', 'entry', 'unlock');
  // profit handling
  if (partial) ok('Banked half at the first target, stop to breakeven', 'tp1', 'partial');
  if (mx >= 1 && R < 0.2) bad(`Gave back the profit: was +${mx.toFixed(1)}R, closed ${fmtR(R)}`, 'exit', 'giveback');
  else if (mx >= 1.5 && R >= 0.3 && mx - R > 1) bad(`Gave back ${(mx - R).toFixed(1)}R from the best point`, 'exit', 'giveback');
  // exits
  if (/target/.test(ex)) ok(smc ? 'Full target reached: the liquidity pool was taken' : 'Full target reached', 'exit', 'target');
  if (/trailing/.test(ex) && R > 0.3) ok(`Trailing stop locked in ${fmtR(R)}`, 'exit', 'trail');
  if (/breakeven/.test(ex) && partial) ok('Rest stopped at breakeven: no loss after the partial', 'exit', 'be');
  if (/stop loss/.test(ex)) {
    if (held < 45) bad(`Stopped out after ${Math.max(1, Math.round(held))} min: stop inside the noise, or entry too early`, 'exit', 'quickstop');
    if (x.post && x.post.chk) { if (x.post.hit) bad('After the stop, price went on to +1.5R: right idea, stop too tight', 'exit', 'tight'); else ok('After the stop, price kept going against the trade: the stop did its job', 'exit', 'stopok'); }
    if (R >= -1.15) ok(`Loss held to ${fmtR(R)}, the planned 1R`, 'exit', 'onerisk');
  }
  if (R < -1.3) bad(`Lost ${fmtR(R)}, more than the planned 1R (slippage or a gap through the stop)`, 'exit', 'slip');
  if (/faded|forming against/.test(ex)) { if (R > -0.75) ok(`Cut early when the signals faded: ${fmtR(R)} instead of a full −1R`, 'exit', 'cutearly'); else bad(`Signals faded but the exit still cost ${fmtR(R)}`, 'exit', 'cutearly'); }
  if (/time stop/.test(ex)) { if (Math.abs(R) < 0.3) bad(`Dead money: went nowhere for ${(held / 60).toFixed(0)}h`, 'exit', 'deadmoney'); else (R > 0 ? ok : bad)(`Closed at the time stop, ${fmtR(R)}`, 'exit', 'timestop'); }
  if (/unlock/.test(ex)) ok('Closed before a token unlock', 'exit', 'unlock');
  if (/closed by you/.test(ex)) G.push({t: 'Closed by you (not graded, not used for rule changes)', at: 'exit', k: 'manual'});
  // costs
  const fund = x.funding || 0, cost = (x.fees || 0) + Math.max(0, -fund), gross = Math.abs(x.pnl) + cost;
  if (gross > 0 && cost / gross > 0.35 && Math.abs(R) < 1) bad(`Fees and funding (${fmtMoney(cost)}) ate most of the move`, 'exit', 'costs');
  else if (fund < 0 && -fund > 0.2 * Math.abs(x.pnl)) bad(`Paid ${fmtMoney(-fund)} in funding while holding`, 'exit', 'costs');
  // what happened in the 24 hours after the exit (filled in by the Reviewer's follow-up)
  if (x.fu && x.fu.af) { const v = x.fu.af.v, s2 = x.fu.sim || {}, rp = ['15m', '1h', '4h'].filter(k => fin((s2[k] || {}).R)).map(k => `${k} ${fmtR(s2[k].R)}`).join(' · ');
    ((v === 'early' || v === 'tight' || v === 'left') ? bad : ok)(`24h after the exit: ${x.fu.af.txt}.${rp ? ` Replayed on other charts: ${rp}` : ''}`, 'after', 'after'); }
  const items = [...G.map(o => Object.assign(o, {ok: true})), ...B.map(o => Object.assign(o, {ok: false}))];
  items.forEach((o, i) => { o.n = i + 1; });
  return {items, grade: rvGrade(x), les: rvLessonsFor(x, acct), smc: smc && x.q ? {tf: x.tf || '15m', htf: (SM_TF[x.tf || '15m'] || SM_TF['15m']).htf, bias: x.htfBias, q: x.q} : null};
}
// one-line SMC summary: timeframe, higher timeframe, setup quality
const smcLine = E => E && E.smc ? `${E.smc.tf} setup · ${E.smc.htf} ${E.smc.bias === 'bull' ? 'rising' : E.smc.bias === 'bear' ? 'falling' : 'unclear'} · quality ${E.smc.q.grade} (${E.smc.q.score}/100)${E.smc.q.retro ? ' · graded after the fact from the candles at entry' : ''}` : '';
/* ---- the Reviewer's coaching of the SMC Trader (Reviewer → SMC review tab, and the SMC desk's Coaching tab) ---- */
function smCoachHTML() {
  const C = smCoach(SM.log), A = RV.smAdj || {}, AREA = [['zone', 'ZONES · OB & FVG', 'Did the zone hold? Which kinds held?'], ['liq', 'LIQUIDITY', 'What was swept, and did price reach the target liquidity?'], ['exec', 'EXECUTION', 'Stops, profit taking, exits']];
  const st = C.stats, line = (k, t, c) => `<div class="chk"><span class="i" style="color:${c}">${k}</span><span>${esc(t)}</span></div>`;
  const status = r => r.rule && A[r.rule] ? `<b style="color:#c5f05a">applied</b>` : r.rule ? (r.solid ? (SM.cfg.learn ? '<b style="color:#c5f05a">applies at the next review</b>' : '<span class="dim">learning is off</span>') : '<span class="dim">noted · becomes a rule once enough trades back it</span>') : '<span class="dim">noted</span>';
  const card = ([k, title, sub]) => {
    const g = C.gr[k], sc = C.sc[k], rs = C.recs.filter(r => r.area === k);
    const metric = k === 'zone' ? (st.all.h + st.all.f ? `${st.all.h} held / ${st.all.f} failed · FVG ${st.fvg.h}/${st.fvg.h + st.fvg.f} · OB ${st.ob.h}/${st.ob.h + st.ob.f}` : 'no closed zone tests yet') : k === 'liq' ? (st.avgFr != null ? `avg ${Math.round(st.avgFr * 100)}% of the way to the target · ${st.reached} reached it${st.aft ? ` · ${st.aft} reached it after the exit` : ''}` : 'no targets measured yet') : `${st.tight} stops run in the noise · ${st.gave} gave back profit`;
    return `<div class="card2" style="border-top:3px solid ${GRADE_C[g] || DIM}"><div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">${title}</h3><b style="font:800 28px var(--mono);color:${GRADE_C[g] || DIM}">${g}</b></div>
      <div class="dim" style="font-size:12px;margin:2px 0 8px">${sub}${sc != null ? ` · ${Math.round(sc * 100)}%` : ''}</div><div style="font-size:12px;margin-bottom:6px">${metric}</div>
      ${C.strengths[k].map(t => line('✓', t, UP)).join('')}${rs.map(r => `<div class="chk"><span class="i" style="color:${DN}">✗</span><span>${esc(r.txt)}<br><span style="font-size:11px">${status(r)}</span></span></div>`).join('')}${!C.strengths[k].length && !rs.length ? '<span class="dim" style="font-size:12px">Nothing to say yet: needs 3+ trades with this kind of data.</span>' : ''}</div>`;
  };
  const talk = (RV.memos || []).filter(m => (m.from === 'rev' && m.to === 'smc' && /^Coaching/.test(m.txt)) || (m.from === 'smc' && m.to === 'rev')).slice(0, 4).reverse();
  return `<p class="note">The Reviewer coaches the SMC Trader in SMC terms, from its ${C.n} closed trades (${C.audited} with a full quality read${C.retro ? `, ${C.retro} of them graded after the fact from the candles at entry` : ''}). Grades: share of zones that held, how far price got toward the target liquidity, and trades without execution mistakes. A finding becomes a rule once it has enough trades behind it (5 on each side of a comparison, or 8 for a single count) and learning is on; before that the SMC Trader keeps it as a note.</p>
    <div class="grid3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${AREA.map(card).join('')}</div>
    ${talk.length ? `<div class="card2" style="margin-top:12px"><h3>THE CONVERSATION</h3>${talk.map(m => `<div class="chk"><span class="i" style="color:${m.from === 'rev' ? '#c5f05a' : SMCOL}">${m.from === 'rev' ? 'R' : 'S'}</span><span><span class="dim" style="font-size:11px">${hhmm(m.t)} ${m.from === 'rev' ? 'Reviewer → SMC Trader' : 'SMC Trader → Reviewer'}</span><br>${esc(m.txt)}</span></div>`).join('')}</div>` : ''}`;
}
// which Reviewer rules now in force came from trades like this one
function rvLessonsFor(x, acct) {
  if (acct === 'sm') { const A = RV.smAdj || {}, W = RV.smWhy || {}; return Object.keys(A).filter(k => W[k]).map(k => W[k]); }
  const I = rvItems(ptLessons()), ks = [], ex = x.exitWhy || '';
  if (x.strat === 'mom') ks.push('mom');
  else {
    ks.push('score', 'risk', 'side' + x.side, 'tag:' + x.tag, 'pref:' + x.tag);
    if (!(x.st ? String(x.st).startsWith('done') : /Reversed/.test(x.why || ''))) ks.push('conf');
    if ((x.maxR || 0) >= 1 && x.R < 0.2) ks.push('tp1R');
    if (/target/.test(ex) || x.R > 0.3) ks.push('tpR');
    if (/stop loss/.test(ex)) ks.push('stopBuf');
    if (/time stop/.test(ex)) ks.push('holdH');
  }
  if (x.side === 'L' && x.unlK === 'ahead') ks.push('unl');
  ks.push('vol', 'fund');
  return [...new Set(ks)].filter(k => I[k]).map(k => I[k]);
}

/* ---- the chart ---- */
// f = scale (1 for the panel, ~2.2 for the wall)
function drawTradeChart(c, x, acct, X0, Y0, w, h, f, E, plan) {
  c.save(); c.beginPath(); c.rect(X0, Y0, w, h); c.clip();
  c.fillStyle = '#060a14'; c.fillRect(X0, Y0, w, h);
  const e = rvBars(x);
  if (!e.bars || e.bars.length < 4) {
    c.fillStyle = DIM; c.font = `500 ${13 * f}px ${FS}`; c.fillText(e.st === 'err' ? 'Could not load candles for this trade.' : 'Loading candles…', X0 + 12 * f, Y0 + h / 2); c.restore(); return;
  }
  const Bs = e.bars, padR = 104 * f, pw = w - padR - 8 * f, T0 = Bs[0][0], T1 = Bs[Bs.length - 1][0] + e.ms;
  const X = t => X0 + 6 * f + (clamp(t, T0, T1) - T0) / (T1 - T0) * pw;
  const L = x.side === 'L', sg = L ? 1 : -1, d = Math.abs(x.entry - x.stop0) || x.entry * 0.01;
  const tp1R = x.tp1R || (acct === 'sm' ? SM.cfg.tp1R : PT.cfg.tp1R);
  const tgt = acct === 'sm' ? x.target : x.entry + sg * (x.tpR || PT.cfg.tpR) * d;
  const tp1 = x.entry + sg * tp1R * d, best = x.entry + sg * Math.max(0, x.maxR || 0) * d;
  const lv = [x.entry, x.stop0, x.exit, tp1, best].concat(fin(tgt) && Math.abs(tgt - x.entry) < d * 6 ? [tgt] : []).filter(fin);
  if (plan) lv.push(...planLevels(plan));
  let lo = Math.min(...Bs.map(b => b[3]), ...lv), hi = Math.max(...Bs.map(b => b[2]), ...lv); const sp = hi - lo || hi * 0.01; lo -= sp * 0.07; hi += sp * 0.07;
  const Y = v => Y0 + 10 * f + (hi - clamp(v, lo, hi)) / (hi - lo) * (h - 34 * f);
  const xa = X(x.t0), xb = Math.max(X(x.t1), xa + 2);
  // time in the trade
  c.fillStyle = 'rgba(255,209,102,.08)'; c.fillRect(xa, Y0, xb - xa, h - 22 * f);
  { const xe = X(Math.min(x.t1 + RV_FU_H * 3600e3, T1)); c.fillStyle = 'rgba(154,176,255,.05)'; c.fillRect(xb, Y0, xe - xb, h - 22 * f);
    c.strokeStyle = 'rgba(154,176,255,.35)'; c.setLineDash([3 * f, 4 * f]); c.beginPath(); c.moveTo(xb, Y0 + 4 * f); c.lineTo(xb, Y0 + h - 24 * f); c.stroke(); c.setLineDash([]);
    c.fillStyle = 'rgba(154,176,255,.75)'; c.font = `600 ${9.5 * f}px ${FS}`; c.fillText(x.fu ? '24h after the exit' : now() < x.t1 + RV_FU_H * 3600e3 ? 'after the exit (following…)' : 'after the exit', xb + 5 * f, Y0 + 12 * f); }
  // SMC zone it entered from
  if (x.zone && fin(x.zone.lo)) { const zx = Math.max(X0 + 6 * f, xa - 8 * (pw / Bs.length)); c.fillStyle = L ? 'rgba(46,229,157,.15)' : 'rgba(255,92,122,.15)'; c.fillRect(zx, Y(x.zone.hi), xa - zx + 4, Y(x.zone.lo) - Y(x.zone.hi)); c.fillStyle = L ? UP : DN; c.font = `700 ${10 * f}px ${FS}`; c.fillText(x.zone.kind || 'zone', zx + 3 * f, Y(x.zone.hi) - 3 * f); }
  // candles
  const bw = pw / Bs.length;
  for (const b of Bs) {
    const cx = X(b[0] + e.ms / 2), up = b[4] >= b[1];
    c.strokeStyle = c.fillStyle = up ? 'rgba(46,229,157,.85)' : 'rgba(255,92,122,.85)'; c.lineWidth = Math.max(1, f * 0.9);
    c.beginPath(); c.moveTo(cx, Y(b[2])); c.lineTo(cx, Y(b[3])); c.stroke();
    const y1 = Y(Math.max(b[1], b[4])), y2 = Y(Math.min(b[1], b[4])); c.fillRect(cx - bw * 0.32, y1, Math.max(1, bw * 0.64), Math.max(1, y2 - y1));
  }
  // levels, from the entry onwards
  const right = X0 + 6 * f + pw;
  const used = [];
  const lvl = (v, col, label, dash) => {
    if (!fin(v) || v < lo || v > hi) return; const yy = Y(v); let ly = yy;
    for (let k = 0; k < 6 && used.some(u => Math.abs(u - ly) < 12 * f); k++) ly += 12 * f; used.push(ly);
    c.strokeStyle = col; c.lineWidth = 1.3 * f; c.setLineDash((dash || []).map(q => q * f)); c.beginPath(); c.moveTo(xa, yy); c.lineTo(right, yy); c.stroke(); c.setLineDash([]);
    c.fillStyle = col; c.font = `600 ${10.5 * f}px ${FM}`; c.textBaseline = 'middle'; c.fillText(label, right + 5 * f, ly); c.textBaseline = 'alphabetic';
  };
  lvl(x.stop0, DN, 'stop −1R', []);
  lvl(x.entry, '#ffd166', 'entry', [4, 4]);
  lvl(tgt, UP, `target ${acct === 'sm' && fin(x.rr) ? x.rr.toFixed(1) : fmtNum(x.tpR || PT.cfg.tpR)}R`, [7, 5]);
  lvl(tp1, 'rgba(46,229,157,.7)', `half +${fmtNum(tp1R)}R`, [3, 5]);
  if ((x.maxR || 0) > 0.25) lvl(best, '#9ab0ff', `best +${x.maxR.toFixed(1)}R`, [2, 4]);
  // markers: entry ▲/▼, partial ◆, exit ●
  const tri = (px, py, up, col) => { const s = 7 * f; c.fillStyle = col; c.beginPath(); if (up) { c.moveTo(px, py - s); c.lineTo(px - s, py + s * 0.7); c.lineTo(px + s, py + s * 0.7); } else { c.moveTo(px, py + s); c.lineTo(px - s, py - s * 0.7); c.lineTo(px + s, py - s * 0.7); } c.closePath(); c.fill(); c.strokeStyle = '#04070f'; c.lineWidth = 1.5; c.stroke(); };
  tri(xa, Y(x.entry), L, '#ffd166');
  const parts = (x.ex || []).slice(0, -1);
  for (const p of parts) { const px = X(p[0]), py = Y(p[1]), s = 6 * f; c.fillStyle = UP; c.beginPath(); c.moveTo(px, py - s); c.lineTo(px + s, py); c.lineTo(px, py + s); c.lineTo(px - s, py); c.closePath(); c.fill(); }
  c.fillStyle = x.R >= 0 ? UP : DN; c.beginPath(); c.arc(xb, Y(x.exit), 6.5 * f, 0, 7); c.fill(); c.strokeStyle = '#04070f'; c.lineWidth = 1.5; c.stroke();
  // best point (the bar in the trade with the most favourable extreme)
  let tb = x.t0; { let bv = L ? -Infinity : Infinity; for (const b of Bs) if (b[0] + e.ms > x.t0 && b[0] <= x.t1) { const v = L ? b[2] : b[3]; if (L ? v > bv : v < bv) { bv = v; tb = b[0] + e.ms / 2; } } }
  // ✓ / ✗ tags at the spot each verdict refers to (hidden while you read the chart yourself)
  if (E && RVT.tags) {
    const at = {entry: [xa, Y(x.entry), L ? 1 : -1], best: [X(tb), Y(best), L ? -1 : 1], tp1: parts.length ? [X(parts[0][0]), Y(parts[0][1]), L ? -1 : 1] : [(xa + xb) / 2, Y(tp1), L ? -1 : 1], exit: [xb, Y(x.exit), x.R >= 0 === L ? -1 : 1], after: x.fu && x.fu.af ? [X(x.fu.af.tMax), Y(x.fu.af.pMax), L ? -1 : 1] : [xb, Y(x.exit), 1]};
    if (x.fu && x.fu.af) { c.strokeStyle = '#9ab0ff'; c.lineWidth = 2 * f; c.beginPath(); c.arc(X(x.fu.af.tMax), Y(x.fu.af.pMax), 6 * f, 0, 7); c.stroke(); }
    const grp = {}; for (const it of E.items) (grp[it.at] = grp[it.at] || []).push(it);
    c.font = `800 ${11 * f}px ${FS}`; c.textBaseline = 'middle';
    for (const k in grp) {
      const [ax, ay, dir] = at[k] || at.exit, its = grp[k], ph = 17 * f, gap = 3 * f;
      const ws = its.map(it => c.measureText((it.ok ? '✓' : '✗') + it.n).width + 10 * f), tw = ws.reduce((a, b) => a + b + gap, -gap);
      let px = clamp(ax - tw / 2, X0 + 4 * f, right - tw - 2 * f), py = ay + dir * 16 * f - (dir < 0 ? ph : 0);
      py = clamp(py, Y0 + 2 * f, Y0 + h - 22 * f - ph);
      its.forEach((it, i) => {
        c.fillStyle = it.ok ? 'rgba(46,229,157,.92)' : 'rgba(255,92,122,.95)'; rr(c, px, py, ws[i], ph, 5 * f); c.fill();
        c.fillStyle = '#04070f'; c.fillText((it.ok ? '✓' : '✗') + it.n, px + 5 * f, py + ph / 2 + 0.5 * f); px += ws[i] + gap;
      });
    }
    c.textBaseline = 'alphabetic';
  }
  // your own setup, drawn over the chart
  const res = plan ? rvPlanSim(x, acct, plan, Bs, e.ms) : null;
  if (plan) drawPlan(c, plan, x, X, Y, f, X0 + 6 * f, right, Y0, res);
  c.canvas.__map = {X, Y, X0, Y0, f, pw, h, T0, T1, lo, hi, bars: Bs, ms: e.ms, right}; c.canvas.__res = res;
  // time axis
  c.fillStyle = DIM; c.font = `500 ${10 * f}px ${FM}`;
  const tl = t => new Date(t).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
  c.fillText(`${e.iv} candles · in ${tl(x.t0)}`, X0 + 8 * f, Y0 + h - 7 * f);
  c.textAlign = 'right'; c.fillText(`out ${tl(x.t1)} · held ${held(x)}`, right, Y0 + h - 7 * f); c.textAlign = 'left';
  c.restore();
}
function held(x) { const m = (x.t1 - x.t0) / 60e3; return m < 90 ? Math.max(1, Math.round(m)) + ' min' : (m / 60).toFixed(1) + ' h'; }

/* ---- review wall (west wall) ---- */
function drawReviewWall() {
  if (typeof RWALL === 'undefined') return;
  const T = RWALL, c = T.ctx, W = T.W, H = T.H, LIME = '#c5f05a', split = 1990;
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0d1328'; c.fillRect(0, 0, W, 80); c.fillStyle = LIME; c.fillRect(0, 78, W, 3);
  c.textBaseline = 'middle'; c.font = `800 40px ${FS}`; c.fillStyle = LIME; c.fillText('REVIEWER · TRADES ON THE CHART', 28, 40);
  c.fillStyle = '#ffd166'; c.fillText('RULES IN FORCE NOW', split + 26, 40);
  c.fillStyle = 'rgba(197,240,90,.3)'; c.fillRect(split, 90, 2, H - 100);
  // left: rotate through the last trades every 25 s
  const all = rvTrades().filter(([, x]) => !isManual(x)).slice(0, 8);
  if (now() - RWS.t > 25e3 && !RWS.hold) { RWS.t = now(); RWS.i = (RWS.i + 1) % Math.max(1, all.length); } // stays put while you stand at the wall
  RWS.cur = null; RWS.btn = null; RWS.n = all.length;
  if (!all.length) {
    c.font = `800 48px ${FS}`; c.fillStyle = TXT; c.fillText('No closed trades yet', 40, 200);
    c.font = `500 28px ${FS}`; c.fillStyle = DIM; c.fillText('When a trade closes, the Reviewer grades it and marks what went right (✓)', 40, 260); c.fillText('and what went wrong (✗) on its chart, here and on the Reviewer\'s desk (5).', 40, 300);
  } else {
    const [a, x] = all[RWS.i % all.length], E = rvExplain(x, a), g = E.grade;
    c.font = `800 50px ${FS}`; c.fillStyle = TXT; c.fillText(x.b, 30, 132); let cx = 40 + c.measureText(x.b).width;
    c.font = `800 26px ${FS}`; c.fillStyle = x.side === 'L' ? UP : DN; c.fillText(x.side === 'L' ? 'LONG' : 'SHORT', cx, 134); cx += c.measureText('SHORT').width + 22;
    c.fillStyle = a === 'sm' ? SMCOL : '#ffd166'; c.fillText(stratName(a, x).toUpperCase(), cx, 134); cx += c.measureText(stratName(a, x).toUpperCase()).width + 30;
    c.font = `800 40px ${FM}`; c.fillStyle = tone(x.R); c.fillText(fmtR(x.R), cx, 132); cx += c.measureText(fmtR(x.R)).width + 16;
    c.font = `700 28px ${FM}`; c.fillText(fmtMoney(x.pnl, 1), cx, 134);
    c.textAlign = 'right'; c.font = `500 22px ${FS}`; c.fillStyle = DIM; c.fillText(`closed ${ago(x.t1)} ago · trade ${RWS.i % all.length + 1} of ${all.length} · ${RWS.hold ? `[ / ] previous / next · T ✓/✗ ${RVT.tags ? 'off' : 'on'}` : 'changes every 25 s'}`, split - 30, 134); c.textAlign = 'left';
    // grade badge
    c.fillStyle = GRADE_C[g.g] || DIM; rr(c, 30, 166, 64, 64, 12); c.fill(); c.fillStyle = '#04070f'; c.font = `800 46px ${FS}`; c.textAlign = 'center'; c.fillText(g.g, 62, 200); c.textAlign = 'left';
    RWS.cur = [a, x];
    c.font = `600 26px ${FS}`; c.fillStyle = TXT; wrapText(c, (E.smc ? smcLine(E) + ' · ' : '') + 'Reviewer: ' + g.note, 112, 186, split - 640, 30, 2);
    // the button: look at it and press E, or click it
    const bw = 470, bh = 64, bx = split - 30 - bw, by = 166; RWS.btn = {x: bx, y: by, w: bw, h: bh};
    const mine = mineOf(x), hot = RWS.hold;
    c.fillStyle = hot ? MINE_C : 'rgba(255,138,216,.16)'; rr(c, bx, by, bw, bh, 14); c.fill(); c.strokeStyle = MINE_C; c.lineWidth = 3; rr(c, bx, by, bw, bh, 14); c.stroke();
    c.fillStyle = hot ? '#04070f' : MINE_C; c.font = `800 27px ${FS}`; c.textAlign = 'center';
    c.fillText(mine ? '✍  EDIT YOUR REVIEW  (E)' : '✍  REVIEW IT YOURSELF  (E)', bx + bw / 2, by + bh / 2 + 1); c.textAlign = 'left';
    const cy = 248, ch = H - cy - 14, cw = 1150;
    drawTradeChart(c, x, a, 24, cy, cw, ch, 2.1, E, mine && mine.plan);
    // ✓ / ✗ list
    let y = cy + 26; const lx = 24 + cw + 26, lw = split - lx - 22;
    const sect = (title, col, list) => {
      if (!list.length) return; c.font = `800 22px ${FS}`; c.fillStyle = col; c.fillText(title, lx, y); y += 34;
      for (const it of list) {
        if (y > H - 30) return;
        c.fillStyle = it.ok ? UP : DN; rr(c, lx, y - 14, 50, 28, 7); c.fill(); c.fillStyle = '#04070f'; c.font = `800 19px ${FS}`; c.fillText((it.ok ? '✓' : '✗') + it.n, lx + 7, y + 1);
        c.font = `500 21px ${FS}`; c.fillStyle = '#cfd8ee'; const n = wrapText(c, it.t, lx + 62, y + 1, lw - 62, 25, 2); y += 25 * (n || 1) + 12;
      }
      y += 8;
    };
    if (mine) {
      c.font = `800 22px ${FS}`; c.fillStyle = MINE_C; c.fillText(`YOUR REVIEW: ${mine.g || '—'}${mine.ag ? ' · ' + MINE_AG[mine.ag] : ''}${mine.excl ? ' · left out of learning' : ''}`, lx, y); y += 30;
      c.font = `500 20px ${FS}`; c.fillStyle = '#f3d6ea';
      if (mine.note) { c.font = `italic 500 21px ${FS}`; c.fillStyle = '#f3d6ea'; const n = wrapText(c, '“' + mine.note.trim() + '”', lx, y, lw, 25, 3); y += 25 * (n || 1) + 4; }
      if ((mine.imgs || []).length) { c.font = `600 19px ${FS}`; c.fillStyle = '#f3d6ea'; const n = wrapText(c, `📷 ${mine.imgs.length} chart picture${mine.imgs.length > 1 ? 's' : ''}` + (mine.imgs.some(i => i.cap) ? ': ' + mine.imgs.map(i => i.cap).filter(Boolean).join(' · ') : ' (open the review with E to see them)'), lx, y, lw, 23, 2); y += 23 * (n || 1) + 2; }
      const pr = mine.plan && mine.plan.res; if (pr) { c.font = `700 19px ${FS}`; c.fillStyle = MINE_C; const n = wrapText(c, '✏ ' + planResTxt(pr, x, true), lx, y, lw, 23, 2); y += 23 * (n || 1) + 2; }
      const rc = youReadM(mine, x.side, x), rd = youReadTxt(rc); if (rd) { c.font = `700 19px ${FS}`; c.fillStyle = MINE_C; const n = wrapText(c, (rc.rd ? 'Claude read it as: ' : 'Reviewer reads: ') + rd, lx, y, lw, 23, 2); y += 23 * (n || 1) + 2; }
      const txt = [(mine.alt || []).length ? 'Ticked: ' + mine.alt.map(k => MINE_ALT[k]).join(', ') : '', (mine.x || []).length ? 'disagrees with ' + mine.x.join(', ') : ''].filter(Boolean).join(' · ');
      if (txt) { c.font = `500 18px ${FS}`; c.fillStyle = '#c9b3c2'; const n = wrapText(c, txt, lx, y, lw, 22, 2); y += 22 * (n || 1); } y += 16;
    }
    sect('DONE RIGHT', UP, E.items.filter(i => i.ok)); sect('DONE WRONG', DN, E.items.filter(i => !i.ok));
    if (E.les.length && y < H - 70) { c.font = `800 22px ${FS}`; c.fillStyle = LIME; c.fillText('RULE NOW IN FORCE BECAUSE OF TRADES LIKE THIS', lx, y); y += 32; c.font = `600 21px ${FS}`; c.fillStyle = TXT; for (const l of E.les) { if (y > H - 30) break; const n = wrapText(c, '› ' + l, lx, y, lw, 25, 2); y += 25 * (n || 1) + 6; } }
    else if (a === 'sm' && y < H - 40) { c.font = `500 19px ${FS}`; c.fillStyle = DIM; wrapText(c, 'Judged on SMC terms. No SMC rule change from trades like this yet: the SMC review needs 5+ trades on each side of a comparison.', lx, y, lw, 24, 2); }
  }
  // right: rules in force, one column per trader
  const RN = rulesNow(), colW = (W - split - 40) / 2;
  [RN.pt, RN.sm].forEach((K, ci) => {
    const x0 = split + 24 + ci * (colW + 8), cw = colW - 14; let y = 122;
    c.font = `800 30px ${FS}`; c.fillStyle = K.col; c.fillText(K.name.toUpperCase(), x0, y);
    y += 32; c.font = `600 18px ${FS}`; c.fillStyle = K.changed ? LIME : DIM; const sl = wrapText(c, K.st, x0, y, cw, 22, 2) || 1; y += 22 * sl + 12;
    for (const [gname, rows] of K.groups) {
      if (y > H - 40) break;
      c.font = `800 17px ${FS}`; c.fillStyle = DIM; c.fillText(gname.toUpperCase(), x0, y); y += 26;
      for (const r of rows) {
        if (y > H - 26) break;
        c.fillStyle = r.was ? LIME : 'rgba(219,228,251,.55)'; c.beginPath(); c.arc(x0 + 6, y - 6, 4.5, 0, 7); c.fill();
        c.font = `${r.was ? 700 : 500} 19px ${FS}`; c.fillStyle = r.was ? LIME : TXT;
        const n = wrapText(c, r.t + (r.was ? `  (Reviewer · was ${r.was})` : ''), x0 + 18, y, cw - 18, 23, 3); y += 23 * (n || 1) + 6;
      }
      y += 8;
    }
  });
  c.textBaseline = 'alphabetic';
  T.tex.needsUpdate = true;
}

/* ---- rules each trader is using right now ---- */
// was = your baseline setting when the Reviewer changed the rule (empty = unchanged)
function rulesNow() {
  const c = PT.cfg, A = ptLessons(), RS = ptRules('S', '', A), RL = ptRules('L', '', A), M = ptRules('L', '', A, 'mom');
  const r = (t, was) => ({t, was: was || ''}), pc = v => fmtNum(v) + '%';
  const rev = [], mom = [], acct = [];
  if (c.stratRev) {
    const lg = !!c.revLong;
    rev.push(r(`${lg ? 'Fade top-5 movers: short gainers, buy losers' : 'Short top-5 gainers only (buying losers is off)'}, at ${RS.needConf ? '"Reversed" only' : '"Reversal forming" or "Reversed"'}`, RS.needConf ? 'forming or reversed' : ''));
    rev.push(r(!lg || RS.minScore === RL.minScore ? `Needs ${RS.minScore}/8 reversal signs` : `Shorts need ${RS.minScore}/8 signs, longs ${RL.minScore}/8`, RS.minScore !== c.minScore || (lg && RL.minScore !== c.minScore) ? c.minScore + '/8' : ''));
    rev.push(r(!lg || Math.abs(RS.riskPct - RL.riskPct) < 1e-9 ? `Risk ${pc(RS.riskPct)} of equity per trade` : `Risk ${pc(RS.riskPct)} on shorts, ${pc(RL.riskPct)} on longs`, Math.abs(RS.riskPct - c.riskPct) > 1e-9 || (lg && Math.abs(RL.riskPct - c.riskPct) > 1e-9) ? pc(c.riskPct) : ''));
    rev.push(r(`Stop ${pc(RS.stopBuf)} beyond the 6h swing; skip if over ${c.maxStopPct}% away`, RS.stopBuf !== c.stopBuf ? pc(c.stopBuf) : ''));
    rev.push(r(`Half off at +${fmtNum(RS.tp1R)}R, then breakeven and an EMA20 trail`, RS.tp1R !== c.tp1R ? `+${c.tp1R}R` : ''));
    rev.push(r(`Full target +${fmtNum(RS.tpR)}R`, RS.tpR !== c.tpR ? `+${c.tpR}R` : ''));
    rev.push(r(`Out after ${RS.holdH}h, or once the signs fade`, RS.holdH !== c.holdH ? c.holdH + 'h' : ''));
    if (A && A.avoid && A.avoid.length) rev.push(r(`Skips "${A.avoid.join('", "')}" setups`, 'allowed'));
    if (A && A.prefer && A.prefer.length) rev.push(r(`Takes "${A.prefer.join('", "')}" setups first`, 'no priority'));
  }
  if (c.stratMom) {
    mom.push(r('Trade with strong top-10 movers: long gainers, short losers'));
    mom.push(r(`Needs ${M.minScore}/8 momentum signs`, M.minScore !== c.momMinScore ? c.momMinScore + '/8' : ''));
    mom.push(r(`Risk ${pc(M.riskPct)} per trade, at most ${c.momMaxPos} at once`, Math.abs(M.riskPct - c.momRiskPct) > 1e-9 ? pc(c.momRiskPct) : ''));
    mom.push(r(`Skips moves over ${c.momMaxExt}% from the 15m EMA20, or with reversal signs forming`));
    mom.push(r(`Stop beyond the 2h swing or EMA20; out when momentum fades, a reversal forms, or after ${M.holdH}h`));
  }
  acct.push(r(`Max ${c.maxPos} positions, ${c.maxLev}× leverage; stops for the day at −${c.dailyLossPct}%`));
  acct.push(r(`Coins with ${fmtUsd(RS.minVol)}+ daily volume; waits 2h before re-trading a coin`, RS.minVol !== c.minVol ? fmtUsd(c.minVol) : ''));
  acct.push(c.unlGuard ? r(`No longs within ${RL.unlDays} days before a big unlock (≥${c.unlMinPct}% of supply); longs closed 12h before; no new shorts 24h after`, RL.unlDays !== c.unlDays ? c.unlDays + ' days' : '') : r('Token unlock guard: off'));
  if (RS.fundGuard) acct.push(r('Skips entries that would pay ≥0.05%/4h funding', 'not checked'));
  const scrRow = (st, on) => { const F = ((RV.prof || {}).F || []).filter(f => f.st === st); return !on ? r(`Reviewer's screens: off`) : F.length ? r(`${CRIT_STRAT[st]}: skips coins that fail the Reviewer's screens (${F.map(f => f.txt).join('; ')}); best fits first; 1 in 5 that fail is traded as a test`, 'no screens') : r(`${CRIT_STRAT[st]}: will use the Reviewer's screens once any are published (none yet)`); };
  if (c.stratRev) acct.push(scrRow('rev', c.useScreens)); if (c.stratMom) acct.push(scrRow('mom', c.useScreens));
  acct.push(r(`Fees ${c.feePct}% + slippage ${c.slipPct}% per side; funding charged`));
  const changed = [...rev, ...mom, ...acct].some(x => x.was);
  const st = !RV.on ? 'Reviewer adjustments are OFF: your settings only' : RV.pending ? `Reading review #${RV.pending} before the next entry` : A ? (changed ? `Includes the Reviewer's changes (review #${A.id || '?'}), highlighted` : `Review #${A.id || '?'} read: no changes, your settings`) : 'No Reviewer changes yet: your settings';
  const pt = {name: 'Trader', col: '#ffd166', st, changed, groups: [['Reversal' + (c.stratRev ? '' : ' · off'), rev], ['Momentum' + (c.stratMom ? '' : ' · off'), mom], ['Every trade', acct]].filter(g => g[1].length || / off/.test(g[0]))};
  const s = SM.cfg, SR = smRules(), J = (SM.cfg.learn && RV.smAdj) || {};
  const smScr = s.useScreens && ((RV.prof || {}).F || []).some(f => f.st === 'smc');
  const smCh = smScr || Object.keys(J).length > 0;
  const tfs = [s.tf15 && SR.noTf !== '15m' ? '15m (only if the 1h isn\'t against it)' : '', s.tf1h && SR.noTf !== '1h' ? '1h (only if the 4h isn\'t against it)' : ''].filter(Boolean);
  const sm = {name: 'SMC Trader', col: SMCOL, st: !SM.on ? 'Trading is OFF' : `Own SMC judgement${Object.keys(J).length ? ', with the Reviewer\'s SMC review applied (highlighted)' : s.learn ? '; the Reviewer\'s SMC review applies once it has enough trades' : '; SMC review learning is off'}${smScr ? ', plus the Reviewer\'s coin screens' : ''}`, changed: smCh, groups: [
    ['Timeframes', [r(tfs.length ? 'Looks for setups on ' + tfs.join(' and ') : 'No timeframe switched on', J.noTf ? 'both' : ''), r('No longs while the higher timeframe is falling, no shorts while it is rising'), r(SR.needHTF ? 'Only trades when the higher timeframe agrees (not just "not against")' : 'Trades when the higher timeframe agrees or is unclear', J.needHTF ? 'unclear allowed' : ''), r(SR.needPOI ? 'Every sweep must be at a higher-timeframe zone or swing (point of interest)' : s.poiRule ? 'If the higher timeframe isn\'t trending its way, the sweep must be at a higher-timeframe zone or swing' : 'Higher-timeframe zones are scored, not required', J.needPOI ? (s.poiRule ? 'only when HTF unclear' : 'scored only') : ''), r(s.ltfConfirm ? '1h setups wait for a 15m structure shift inside the 1h zone' : '1h setups enter on the first touch of the zone')]],
    ['Liquidity (market-maker lessons)', [r(SR.needDraw ? 'Reversals only with the higher-timeframe draw on liquidity (internal vs external range); not applied to continuation setups' : 'Scores the higher-timeframe draw on liquidity on reversal setups (not on continuation setups); not required', J.needDraw ? 'scored only' : ''), r(s.pdLiq ? 'Previous day high/low used as targets; sweeping one counts as strong liquidity' : 'Previous day high/low ignored'), r('Bonuses: mitigation block under the entry, AMD or expansion before a reversal; stacked gaps exempt the midpoint rule')]],
    ['Setups', [r('Reversal: liquidity sweep → change of character → first pullback into the FVG or order block'), r(s.cont && !SR.noCont ? 'Continuation: when both timeframes trend the same way, a base, an impulsive break of structure (1.5+ ATR), then the first pullback into the base or its gap' : 'Continuation setups off', J.noCont ? 'on' : '')]],
    ['Setup quality (SMC)', [r('Liquidity sweep, then a structure shift (CHoCH)'), r('FVG drawn wick to wick (candle 1 extreme to candle 3 extreme); its midpoint is the consequent encroachment (CE)'), r('Bonuses: the sweep candle (C2) closed back inside in the trade\'s direction or the next candle (C3) confirmed; the sweep went past the higher-timeframe candle\'s open (manipulation leg)'), r(SR.fvgOnly ? 'Enters only in a fair value gap (no order blocks)' : 'Enters on the first pullback into the fair value gap, else the order block', J.fvgOnly ? 'FVG or OB' : ''), r(`Needs ${s.minScore}/6 confluences and setup quality ${SR.minQ}/100 or better`, J.minQ ? s.minQ + '/100' : ''), SR.needDepth ? r('Waits for price to reach the zone\'s midpoint or deeper', s.minDepth ? s.minDepth + '% into the zone' : 'zone edge') : r(s.minDepth ? `Not at the very edge: enters once price is at least ${s.minDepth}% into the zone (a wick that only touched the edge doesn\'t use the zone up)` : 'Enters anywhere inside the zone')]],
    ['Risk & exits', [r(`Stop ${pc(SR.stopBuf)} beyond the sweep, never closer than ${pc(s.minStopPct || 0.6)} (moved out to that distance if the sweep is closer); skip if over ${s.maxStopPct}% away`, J.stopBuf ? pc(s.stopBuf) : ''), r(`Target: the next liquidity pool at least ${fmtNum(s.minRR)}R away, capped at ${fmtNum(s.maxRR)}R${s.pathCheck ? '; placed in front of any high-resistance swing (one that ran the previous swing and was rejected); failure swings in the way count in its favour' : ''}${s.roomCheck ? '; brought in to an opposing higher-timeframe zone, and no trade if that leaves under ' + fmtNum(s.minRR) + 'R' : ''}`), r(`Half off at +${fmtNum(SR.tp1R)}R, breakeven, then trail behind new swings on the setup's timeframe`, J.tp1R ? `+${s.tp1R}R` : ''), r(`Out at the target or after ${s.holdH}h (15m setups) / ${s.holdH1h}h (1h setups)`), r(s.invExit ? 'Out early if a candle on the setup\'s timeframe closes through the far side of the entry gap (the idea is invalid), before the half is taken' : 'Holds to the stop even if the entry gap fails')]],
    ['Every trade', [r(`Risk ${pc(s.riskPct * SR.riskMul)} per trade; max ${s.maxPos} positions, ${s.maxLev}× leverage; stops for the day at −${s.dailyLossPct}%`, J.riskMul ? pc(s.riskPct) : ''), r(`Coins with ${fmtUsd(s.minVol)}+ daily volume; token unlock guard ${s.unlGuard ? 'on' : 'off'}`), r(`Fees ${s.feePct}% + slippage ${s.slipPct}% per side; funding charged`), s.useScreens ? scrRow('smc', 1) : r('Picks coins by its SMC read only, without the Reviewer\'s coin screens')]]]};
  return {pt, sm};
}
function rulesCardHTML(which) {
  const K = rulesNow()[which];
  return `<div class="card2" style="border-left:4px solid ${K.col}"><h3 style="color:${K.col}">${esc(K.name.toUpperCase())} · RULES IN FORCE NOW</h3>
    <div style="font-size:12px;margin:-2px 0 8px;color:${K.changed ? '#c5f05a' : 'var(--dim)'}">${esc(K.st)}</div>
    ${K.groups.map(([g, rows]) => `<div class="dim" style="font-size:11px;letter-spacing:.08em;margin:8px 0 2px">${esc(g.toUpperCase())}</div>${rows.map(r => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${r.was ? '#c5f05a' : 'var(--dim)'}">${r.was ? 'R' : '•'}</span><span${r.was ? ' style="color:#c5f05a"' : ''}>${esc(r.t)}${r.was ? ` <span style="font-size:11px;opacity:.85">(changed by the Reviewer · your setting: ${esc(r.was)})</span>` : ''}</span></div>`).join('')}`).join('')}</div>`;
}
function rulesBothHTML() {
  return `<p class="note">What each trader is doing <b>right now</b>. Rules marked <b style="color:#c5f05a">R</b> were changed by the Reviewer from your settings. The SMC Trader is reviewed on SMC terms (quality of the sweep, FVG/order block, timeframe, entry depth) in the <b>SMC review</b> tab; its marked rules come from there.</p><div class="grid2">${rulesCardHTML('pt')}${rulesCardHTML('sm')}</div>`;
}

/* ---- Reviewer panel: "On the chart" tab ---- */
function rvChartHTML() {
  const L = rvTrades(RVS.acct);
  const filt = `<div style="display:flex;gap:6px;margin-bottom:10px">${[['all', 'Both traders'], ['pt', 'Trader'], ['sm', 'SMC Trader']].map(([k, l]) => `<span class="chip ${RVS.acct === k ? 'on' : ''}" data-rvacct="${k}">${l}</span>`).join('')}</div>`;
  const mineN = Object.keys(RVM).length, agreeN = Object.values(RVM).filter(r => r.ag === 'agree').length;
  const filt2 = filt + (mineN ? `<div class="dim" style="font-size:12px;margin:-4px 0 10px">You've reviewed ${mineN} trade${mineN === 1 ? '' : 's'}; you agreed with the Reviewer on ${agreeN}.</div>` : '');
  if (!L.length) return filt + '<div class="empty">No closed trades yet. When a trade closes, it shows up here on its own chart, with what the trader did right (✓) and wrong (✗) marked where it happened.</div>';
  let sel = L.find(([a, x]) => tradeKey(a, x) === RVS.key); if (!sel) { sel = L[0]; RVS.key = tradeKey(...sel); }
  const [a, x] = sel, E = rvExplain(x, a), g = E.grade;
  const list = L.slice(0, 60).map(([a2, y]) => { const gg = rvGrade(y), k = tradeKey(a2, y); return `<div class="rvpick${k === RVS.key ? ' on' : ''}" data-rvpick="${esc(k)}" style="display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:7px;cursor:pointer;${k === RVS.key ? 'background:rgba(197,240,90,.12);' : ''}"><b style="color:${GRADE_C[gg.g]};width:14px">${gg.g}</b><b style="min-width:60px">${esc(y.b)}</b><span class="${y.side === 'L' ? 'up' : 'dn'}" style="font-size:11px">${y.side === 'L' ? 'LONG' : 'SHORT'}</span><span style="font-size:11px;color:${a2 === 'sm' ? SMCOL : '#ffd166'}">${a2 === 'sm' ? 'SMC' : y.strat === 'mom' ? 'MOM' : 'REV'}</span>${RVM[k] ? `<span title="Your grade" style="font-size:10px;font-weight:800;color:#04070f;background:${MINE_C};border-radius:4px;padding:0 4px">you ${esc(RVM[k].g || '✓')}</span>` : ''}<span class="mono ${cls(y.R)}" style="margin-left:auto">${fmtR(y.R)}</span><span class="dim" style="font-size:11px;width:44px;text-align:right">${ago(y.t1)}</span></div>`; }).join('');
  const item = it => `<div class="chk" style="padding:4px 0"><span class="i" style="background:${it.ok ? UP : DN};color:#04070f;border-radius:5px;padding:0 5px;font-weight:800;min-width:30px;text-align:center">${it.ok ? '✓' : '✗'}${it.n}</span><span>${esc(it.t)}</span></div>`;
  const G = E.items.filter(i => i.ok), B = E.items.filter(i => !i.ok);
  return filt2 + `<div class="grid2" style="grid-template-columns:260px 1fr;gap:14px">
    <div class="card2" style="padding:8px;max-height:640px;overflow:auto">${list}</div>
    <div><div class="card2" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <span style="background:${GRADE_C[g.g]};color:#04070f;font-weight:800;font-size:26px;border-radius:9px;width:44px;height:44px;display:flex;align-items:center;justify-content:center">${g.g}</span>
      <div><div style="font-size:19px;font-weight:800">${esc(x.b)} <span class="${x.side === 'L' ? 'up' : 'dn'}" style="font-size:13px">${x.side === 'L' ? 'LONG' : 'SHORT'}</span> <span style="font-size:13px;color:${a === 'sm' ? SMCOL : '#ffd166'}">${esc(stratName(a, x))}</span> <span class="mono ${cls(x.R)}">${fmtR(x.R)} · ${fmtMoney(x.pnl, 1)}</span></div>
      ${E.smc ? `<div style="font-size:12px;margin-top:2px;color:${SMCOL}">${esc(smcLine(E))}</div>` : ''}<div style="font-size:13px;margin-top:2px">${esc(g.note)}</div></div>
      <span class="dim" style="margin-left:auto;font-size:12px">${new Date(x.t0).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})} → ${new Date(x.t1).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · held ${held(x)}</span></div>
    ${planBarHTML(a, x)}<canvas data-rvchart="${esc(RVS.key)}" style="width:100%;height:${RVP.on ? 440 : 360}px;touch-action:none;${RVP.on ? 'cursor:crosshair;' : ''}display:block;border-radius:8px;border:1px solid var(--line);margin-top:10px"></canvas>
    <div style="display:flex;gap:10px;align-items:center;margin-top:4px"><span class="dim" style="font-size:11px">▲/▼ entry · ◆ half taken · ● exit · shaded = time in the trade · numbered tags match the lists below · <span style="color:${MINE_C}">pink = your marks</span></span><span class="chip ${RVT.tags ? 'on' : ''}" data-rvtags="1" style="margin-left:auto;font-size:11px" title="Hide the Reviewer's ✓/✗ tags so you can read the chart yourself (T at the review wall)">${RVT.tags ? '✓/✗ on chart: ON' : '✓/✗ on chart: OFF'}</span></div>
    <div class="grid2" style="margin-top:10px"><div class="card2"><h3 style="color:${UP}">DONE RIGHT</h3>${G.map(item).join('') || '<span class="dim" style="font-size:13px">Nothing stood out.</span>'}</div>
    <div class="card2"><h3 style="color:${DN}">DONE WRONG</h3>${B.map(item).join('') || '<span class="dim" style="font-size:13px">Nothing. A clean trade by the rules.</span>'}</div></div>
    <div class="card2" style="margin-top:12px;border-left:4px solid #c5f05a"><h3 style="color:#c5f05a">WHAT THE REVIEWER CHANGED</h3>${E.les.length ? E.les.map(l => `<div class="chk"><span class="i" style="color:#c5f05a">›</span><span>${esc(l)}</span></div>`).join('') + '<div class="dim" style="font-size:12px;margin-top:4px">These rules are in force now, partly because of trades like this one.</div>' : `<span class="dim" style="font-size:13px">No rule change from trades like this yet. The Reviewer needs a minimum sample before it changes anything (${a === 'sm' ? '5 SMC trades on each side of a comparison' : '3 trades for a setup, 4 for a side, 6 overall'}).</span>`}
    <div class="dim" style="font-size:12px;margin-top:6px">Entry reason: ${esc(x.why || '—')}<br>Exit: ${esc(x.exitWhy || '—')}</div></div>
    ${mineFormHTML(a, x, E)}</div></div>`;
}
function drawRvCanvas(cv) {
  const k = cv.dataset.rvchart, hit = rvTrades().find(([a, x]) => tradeKey(a, x) === k); if (!hit) return;
  const r = cv.getBoundingClientRect(); if (!r.width) return;
  const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = r.width * dpr; cv.height = r.height * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const mine = MD.key === k && MD.d ? MD.d : RVM[k], P = mine && mine.plan ? planWithDrag(mine.plan) : (RVP.drag && MD.key === k ? planWithDrag({}) : null);
  drawTradeChart(c, hit[1], hit[0], 0, 0, r.width, r.height, 1, rvExplain(hit[1], hit[0]), P);
  const st = document.getElementById('planRes'); if (st && MD.key === k) st.innerHTML = planStatusHTML(cv.__res, hit[1], MD.d && MD.d.plan);
}
/* ---- your own setup on the chart ----
   plan = {side, entry: {t, p}, stop, target, zones: [{t0, t1, lo, hi}], lines: [{t0, p0, t1, p1}], labels: [{t, p, txt}], res}
   Prices and times, not pixels, so the marks land in the same place on the panel, the wall and any screen size.
   The Reviewer replays your entry / stop / target on the trade's candles (worst case first inside a candle, fees and
   slippage included) and compares your levels with the trader's (planPoints in review.js); those count like a comment. */
const PLAN_C = '#ff8ad8';
const planHas = P => !!(P && ((P.entry && fin(P.entry.p)) || fin(P.stop) || fin(P.target) || (P.zones || []).length || (P.lines || []).length || (P.labels || []).length));
function planLevels(P) {
  const v = [P.entry && P.entry.p, P.stop, P.target];
  for (const z of P.zones || []) v.push(z.lo, z.hi); for (const l of P.lines || []) v.push(l.p0, l.p1); for (const l of P.labels || []) v.push(l.p);
  return v.filter(fin);
}
function planWithDrag(P) {
  const d = RVP.drag; if (!d || !d.b) return P;
  const Q = Object.assign({}, P, {zones: [...(P.zones || [])], lines: [...(P.lines || [])]});
  if (d.tool === 'zone') Q.zones.push({t0: Math.min(d.a.t, d.b.t), t1: Math.max(d.a.t, d.b.t), lo: Math.min(d.a.p, d.b.p), hi: Math.max(d.a.p, d.b.p)});
  else Q.lines.push({t0: d.a.t, p0: d.a.p, t1: d.b.t, p1: d.b.p});
  return Q;
}
function rvPlanSim(x, acct, P, Bs, ms) {
  if (!P || !P.entry || !fin(P.entry.p)) return null;
  if (!fin(P.stop)) return {need: 'stop'};
  const L = (P.side || x.side) === 'L', sg = L ? 1 : -1, en = P.entry.p, st = P.stop, tg = fin(P.target) ? P.target : null, d = Math.abs(en - st);
  if (!d || (L ? st >= en : st <= en)) return {bad: `Your stop has to be ${L ? 'below' : 'above'} your entry for a ${L ? 'long' : 'short'}.`};
  if (tg != null && (L ? tg <= en : tg >= en)) return {bad: `Your target has to be ${L ? 'above' : 'below'} your entry for a ${L ? 'long' : 'short'}.`};
  const cf = acct === 'sm' ? SM.cfg : PT.cfg, cost = 2 * ((cf.feePct || 0.04) + (cf.slipPct || 0.1)) / 100 * en / d, rr = tg != null ? Math.abs(tg - en) / d : null;
  let i = Bs.findIndex(b => b[0] + ms > P.entry.t), tF = null, mx = 0; if (i < 0) return {st: 'nofill', rr};
  for (; i < Bs.length; i++) {
    const b = Bs[i];
    if (tF == null) { if (b[3] <= en && b[2] >= en) tF = Math.max(b[0], P.entry.t); else continue; }
    if (L ? b[3] <= st : b[2] >= st) return {st: 'stop', R: -1 - cost, tF, tX: b[0] + ms / 2, pX: st, rr, mx};     // stop first: worst case inside a candle
    mx = Math.max(mx, ((L ? b[2] : b[3]) - en) * sg / d);
    if (tg != null && (L ? b[2] >= tg : b[3] <= tg)) return {st: 'target', R: rr - cost, tF, tX: b[0] + ms / 2, pX: tg, rr, mx};
  }
  if (tF == null) return {st: 'nofill', rr};
  const last = Bs[Bs.length - 1];
  return {st: 'open', R: (last[4] - en) * sg / d - cost, tF, tX: last[0] + ms, pX: last[4], rr, mx};
}
function planResTxt(r, x, short) {
  if (!r) return '';
  const bot = `${x.strat === 'smc' ? 'the SMC Trader' : 'the Trader'} made ${fmtR(x.R)}`;
  if (r.st === 'nofill') return `Your plan: price never reached your entry, so no trade${short ? '' : ` (${bot})`}.`;
  const how = r.st === 'target' ? 'target reached' : r.st === 'stop' ? 'stopped out' : 'still open at the end of the chart';
  return `Your plan: ${how}, ${fmtR(r.R)}${r.rr ? ` (target ${r.rr.toFixed(1)}R)` : ''} vs ${bot}.`;
}
function planStatusHTML(r, x, P) {
  if (!RVP.on && !planHas(P)) return '';
  if (RVP.warn) return `<span style="color:#ffd166">${esc(RVP.warn)}</span>`;
  if (!P || !P.entry) return `<span class="dim">${RVP.on ? 'Start with your entry: pick Long or Short, then click where you would have got in.' : ''}</span>`;
  if (r && r.need) return '<span class="dim">Now click your stop. Then your target.</span>';
  if (r && r.bad) return `<span style="color:#ffd166">${esc(r.bad)}</span>`;
  if (!r) return '';
  const col = r.st === 'nofill' ? DIM : r.R >= 0 ? UP : DN;
  return `<span style="color:${col};font-weight:700">${esc(planResTxt(r, x))}</span>${!fin(P.target) && r.st !== 'nofill' ? ' <span class="dim">Add a target to see where you would have taken profit.</span>' : ''}`;
}
function drawPlan(c, P, x, X, Y, f, xL, xR, Y0, r) {
  c.save(); c.lineWidth = 1.6 * f; c.font = `700 ${10 * f}px ${FS}`; c.textBaseline = 'middle';
  const pill = (txt, px, py, col) => { const w = c.measureText(txt).width + 10 * f; px = clamp(px, xL, xR - w); c.fillStyle = 'rgba(4,7,15,.88)'; rr(c, px, py - 8 * f, w, 16 * f, 4 * f); c.fill(); c.strokeStyle = col || PLAN_C; c.lineWidth = 1 * f; rr(c, px, py - 8 * f, w, 16 * f, 4 * f); c.stroke(); c.fillStyle = col || PLAN_C; c.fillText(txt, px + 5 * f, py + 0.5 * f); };
  for (const z of P.zones || []) {
    const x0 = X(z.t0), x1 = Math.max(X(z.t1), x0 + 3), y0 = Y(z.hi), y1 = Y(z.lo);
    c.fillStyle = 'rgba(255,138,216,.16)'; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.strokeStyle = PLAN_C; c.lineWidth = 1.2 * f; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  for (const l of P.lines || []) { c.strokeStyle = PLAN_C; c.lineWidth = 2 * f; c.beginPath(); c.moveTo(X(l.t0), Y(l.p0)); c.lineTo(X(l.t1), Y(l.p1)); c.stroke(); }
  const L = (P.side || x.side) === 'L', ex = P.entry ? X(P.entry.t) : xL, en = P.entry && P.entry.p;
  const lvl = (v, col, txt, dash) => { if (!fin(v)) return; const y = Y(v); c.strokeStyle = col; c.lineWidth = 1.6 * f; c.setLineDash(dash.map(q => q * f)); c.beginPath(); c.moveTo(ex, y); c.lineTo(xR, y); c.stroke(); c.setLineDash([]); pill(txt, ex + 8 * f, y - 10 * f, col); };
  const dd = fin(en) && fin(P.stop) ? Math.abs(en - P.stop) : null;
  lvl(P.stop, '#ff5c9d', 'my stop', [5, 3]);
  lvl(P.target, '#ffc2ec', `my target${dd && fin(en) ? ' ' + (Math.abs(P.target - en) / dd).toFixed(1) + 'R' : ''}`, [7, 4]);
  if (fin(en)) {
    lvl(en, PLAN_C, `my ${L ? 'long' : 'short'}`, [2, 3]);
    const y = Y(en), s = 8 * f; c.fillStyle = PLAN_C; c.beginPath();
    if (L) { c.moveTo(ex, y - s); c.lineTo(ex - s, y + s * 0.7); c.lineTo(ex + s, y + s * 0.7); } else { c.moveTo(ex, y + s); c.lineTo(ex - s, y - s * 0.7); c.lineTo(ex + s, y - s * 0.7); }
    c.closePath(); c.fill(); c.strokeStyle = '#04070f'; c.lineWidth = 1.5; c.stroke();
  }
  for (const l of P.labels || []) { c.fillStyle = PLAN_C; c.beginPath(); c.arc(X(l.t), Y(l.p), 3 * f, 0, 7); c.fill(); pill(l.txt, X(l.t) + 6 * f, Y(l.p), PLAN_C); }
  if (r && !r.bad && !r.need) {
    if (r.tF) { c.strokeStyle = PLAN_C; c.lineWidth = 2 * f; c.beginPath(); c.arc(X(r.tF), Y(en), 6 * f, 0, 7); c.stroke(); }
    if (r.tX) { const px = X(r.tX), py = Y(r.pX), s = 5 * f; c.strokeStyle = r.R >= 0 ? UP : DN; c.lineWidth = 2.5 * f; c.beginPath(); c.moveTo(px - s, py - s); c.lineTo(px + s, py + s); c.moveTo(px + s, py - s); c.lineTo(px - s, py + s); c.stroke(); }
    c.font = `800 ${11 * f}px ${FS}`;
    pill(r.st === 'nofill' ? 'YOUR PLAN: not filled' : `YOUR PLAN: ${r.st === 'target' ? 'target' : r.st === 'stop' ? 'stopped' : 'open'} ${fmtR(r.R)}`, xL + 4 * f, Y0 + 26 * f, r.st === 'nofill' ? DIM : r.R >= 0 ? UP : DN);
  }
  c.restore();
}
// the toolbar above the chart
function planBarHTML(a, x) {
  const k = tradeKey(a, x), d = MD.key === k ? MD.d : RVM[k], P = d && d.plan;
  if (!RVP.on) return `<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap"><button class="btn sm" data-plan="on" style="background:${PLAN_C};color:#04070f;border-color:${PLAN_C}">✏️ ${planHas(P) ? 'Edit my setup on this chart' : 'Mark my own setup on this chart'}</button><span class="dim" style="font-size:12px">Draw where you would have entered, your stop, target and zones. The Reviewer replays it on these candles and compares it with the trade.</span><span id="planRes" style="font-size:12px;flex-basis:100%">${planHas(P) && P.res ? `<span style="color:${PLAN_C}">${esc(planResTxt(P.res, x))}</span>` : ''}</span></div>`;
  const side = (P && P.side) || x.side, tool = RVP.tool;
  const chip = (attr, v, lab, on, tip) => `<span class="chip ${on ? 'on' : ''}" ${attr}="${v}" title="${esc(tip || '')}" style="${on ? `background:${PLAN_C};color:#04070f;border-color:${PLAN_C}` : ''}">${lab}</span>`;
  const T = [['entry', 'Entry', 'Click where you would have got in (time and price)'], ['stop', 'Stop', 'Click your stop price'], ['target', 'Target', 'Click your target price'], ['zone', 'Zone', 'Drag a box over your zone: OB, FVG, POI'], ['line', 'Line', 'Drag to draw a line: trendline, level, structure'], ['text', 'Label', 'Type a label below, then click where it goes'], ['erase', 'Erase', 'Click one of your marks to remove it']];
  const hint = {entry: 'Click where you would have entered. Your candles snap to highs, lows, opens and closes.', stop: 'Click your stop price.', target: 'Click your target price.', zone: 'Drag a box over your zone (order block, FVG, point of interest).', line: 'Drag to draw a line.', text: 'Type the label, then click on the chart where it goes.', erase: 'Click one of your pink marks to remove it.'}[tool];
  return `<div class="card2" style="margin-top:10px;border-left:4px solid ${PLAN_C};padding:10px 12px">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="color:${PLAN_C};font-size:13px;margin-right:4px">MY SETUP</b>
      ${chip('data-plan-side', 'L', '▲ Long', side === 'L', 'Your trade would have been a long')}${chip('data-plan-side', 'S', '▼ Short', side === 'S', 'Your trade would have been a short')}
      <span style="width:10px"></span>${T.map(([v, l, tip]) => chip('data-plan-tool', v, l, tool === v, tip)).join('')}
      ${tool === 'text' ? `<input id="planTxt" maxlength="40" placeholder="e.g. BUOB · swept PDL · 1h LH" style="background:#0b1224;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px;font:12px var(--sans);width:190px" value="${esc(RVP.txt || '')}">` : ''}
      <span style="margin-left:auto"></span><button class="btn ghost sm" data-plan="undo" ${RVP.hist.length ? '' : 'disabled'}>Undo</button><button class="btn ghost sm" data-plan="clear">Clear</button><button class="btn sm" data-plan="off">Done</button></div>
    <div class="dim" style="font-size:12px;margin-top:6px">${hint} The trader's own ✓/✗ tags can be hidden with the button under the chart. Press <b>Save my review</b> below to keep your marks.</div>
    <div id="planRes" style="font-size:13px;margin-top:6px">${planStatusHTML(null, x, P)}</div></div>`;
}
const planDraft = () => { if (!MD.d) return null; if (!MD.d.plan) MD.d.plan = {side: MD.x ? MD.x.side : 'L', zones: [], lines: [], labels: []}; return MD.d.plan; };
function planPush() { RVP.hist.push(JSON.stringify(MD.d.plan || null)); if (RVP.hist.length > 40) RVP.hist.shift(); }
function planChanged() {
  MD.msg = 'Marks changed. Press "Save my review" to keep them.'; RVP.warn = '';
  document.querySelectorAll('canvas[data-rvchart]').forEach(drawRvCanvas);
  const r = document.getElementById('mineRead'); if (r && MD.d) r.innerHTML = mineReadHTML(MD.d, MD.x && MD.x.side, MD.x);
  const m = document.getElementById('mineMsg'); if (m) m.textContent = MD.msg;
}
// canvas pixel → time and price (snapped to the nearest candle open/high/low/close within 7 px)
function planPt(cv, e, snap) {
  const m = cv.__map; if (!m) return null; const b = cv.getBoundingClientRect();
  const px = clamp(e.clientX - b.left, m.X0 + 6 * m.f, m.X0 + 6 * m.f + m.pw), py = e.clientY - b.top;
  const t = m.T0 + (px - m.X0 - 6 * m.f) / m.pw * (m.T1 - m.T0);
  let p = m.hi - (py - m.Y0 - 10 * m.f) / (m.h - 34 * m.f) * (m.hi - m.lo);
  if (snap !== false) { const bar = m.bars.find(q => q[0] <= t && t < q[0] + m.ms); if (bar) { let best = 7; for (const v of bar.slice(1, 5)) { const dy = Math.abs(m.Y(v) - py); if (dy < best) { best = dy; p = v; } } } }
  return {t, p, px, py};
}
function planErase(cv, pt) {
  const m = cv.__map, P = MD.d && MD.d.plan; if (!m || !P) return false;
  const near = (a, b) => Math.abs(a - b) < 8, ex = P.entry ? m.X(P.entry.t) : 0;
  const segD = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1, u = clamp(((pt.px - x1) * dx + (pt.py - y1) * dy) / L2, 0, 1); return Math.hypot(pt.px - x1 - u * dx, pt.py - y1 - u * dy); };
  const li = (P.labels || []).findIndex(l => Math.hypot(m.X(l.t) - pt.px, m.Y(l.p) - pt.py) < 14 || (pt.px >= m.X(l.t) && pt.px <= m.X(l.t) + 120 && near(m.Y(l.p), pt.py)));
  if (li >= 0) { P.labels.splice(li, 1); return true; }
  const ln = (P.lines || []).findIndex(l => segD(m.X(l.t0), m.Y(l.p0), m.X(l.t1), m.Y(l.p1)) < 7); if (ln >= 0) { P.lines.splice(ln, 1); return true; }
  for (const k of ['target', 'stop']) if (fin(P[k]) && pt.px >= ex - 8 && near(m.Y(P[k]), pt.py)) { delete P[k]; return true; }
  if (P.entry && pt.px >= ex - 8 && near(m.Y(P.entry.p), pt.py)) { delete P.entry; return true; }
  const z = (P.zones || []).findIndex(z => pt.px >= m.X(z.t0) - 4 && pt.px <= m.X(z.t1) + 4 && pt.py >= m.Y(z.hi) - 4 && pt.py <= m.Y(z.lo) + 4); if (z >= 0) { P.zones.splice(z, 1); return true; }
  return false;
}
const planCanvas = e => { const cv = e.target && e.target.closest && e.target.closest('canvas[data-rvchart]'); return cv && RVP.on && MD.d && cv.dataset.rvchart === MD.key ? cv : null; };
document.getElementById('panel').addEventListener('pointerdown', e => {
  const cv = planCanvas(e); if (!cv) return; const pt = planPt(cv, e, RVP.tool !== 'erase'); if (!pt) return;
  e.preventDefault(); e.stopPropagation();
  const P = planDraft(), tool = RVP.tool;
  if (tool === 'zone' || tool === 'line') { RVP.drag = {tool, a: pt, b: null, cv}; try { cv.setPointerCapture(e.pointerId); } catch (_) {} return; }
  if (tool === 'erase') { planPush(); if (!planErase(cv, pt)) { RVP.hist.pop(); return; } planChanged(); return; }
  if (tool === 'text') { const inp = document.getElementById('planTxt'), txt = String((inp && inp.value) || RVP.txt || '').trim(); if (!txt) { RVP.warn = 'Type the label first, then click where it goes.'; const st = document.getElementById('planRes'); if (st) st.innerHTML = planStatusHTML(null, MD.x, P); return; } planPush(); (P.labels = P.labels || []).push({t: pt.t, p: pt.p, txt}); RVP.txt = ''; if (inp) inp.value = ''; planChanged(); return; }
  planPush();
  if (tool === 'entry') { P.entry = {t: pt.t, p: pt.p}; RVP.tool = fin(P.stop) ? (fin(P.target) ? 'entry' : 'target') : 'stop'; }
  else if (tool === 'stop') { P.stop = pt.p; if (!fin(P.target)) RVP.tool = 'target'; }
  else if (tool === 'target') P.target = pt.p;
  planChanged(); if (RVP.tool !== tool) renderPanel();
}, true);
document.getElementById('panel').addEventListener('pointermove', e => {
  const d = RVP.drag; if (!d) return; const pt = planPt(d.cv, e); if (!pt) return; d.b = pt; drawRvCanvas(d.cv);
}, true);
document.getElementById('panel').addEventListener('pointerup', e => {
  const d = RVP.drag; if (!d) return; RVP.drag = null; const pt = planPt(d.cv, e) || d.b;
  if (pt && Math.hypot(pt.px - d.a.px, pt.py - d.a.py) > 6) {
    const P = planDraft(); planPush();
    if (d.tool === 'zone') (P.zones = P.zones || []).push({t0: Math.min(d.a.t, pt.t), t1: Math.max(d.a.t, pt.t), lo: Math.min(d.a.p, pt.p), hi: Math.max(d.a.p, pt.p)});
    else (P.lines = P.lines || []).push({t0: d.a.t, p0: d.a.p, t1: pt.t, p1: pt.p});
  }
  planChanged();
}, true);
document.getElementById('panel').addEventListener('input', e => { if (e.target.id === 'planTxt') { RVP.txt = e.target.value; RVP.warn = ''; } }, true);
document.getElementById('panel').addEventListener('click', e => {
  const el = e.target.closest('[data-plan],[data-plan-tool],[data-plan-side]'); if (!el) return; e.stopPropagation();
  if (el.dataset.planTool) { RVP.tool = el.dataset.planTool; RVP.warn = ''; }
  else if (el.dataset.planSide) { const P = planDraft(); if (P) { planPush(); P.side = el.dataset.planSide; planChanged(); } }
  else if (el.dataset.plan === 'on') { RVP.on = true; RVP.tool = MD.d && MD.d.plan && MD.d.plan.entry ? 'zone' : 'entry'; }
  else if (el.dataset.plan === 'off') { RVP.on = false; RVP.drag = null; RVP.warn = ''; }
  else if (el.dataset.plan === 'undo' && RVP.hist.length && MD.d) { MD.d.plan = JSON.parse(RVP.hist.pop()); planChanged(); }
  else if (el.dataset.plan === 'clear' && MD.d && MD.d.plan) { planPush(); MD.d.plan = null; planChanged(); }
  renderPanel();
}, true);
// how your marked plans did, against the trader on the same trades
function rvPlanStats(acct) {
  const L = rvTrades(acct).map(([, x]) => [x, mineOf(x)]).filter(([, m]) => m && m.plan && m.plan.res && fin(m.plan.res.R));
  const nf = rvTrades(acct).filter(([, x]) => { const m = mineOf(x); return m && m.plan && m.plan.res && m.plan.res.st === 'nofill'; }).length;
  if (!L.length && !nf) return null;
  return {n: L.length, nf, you: rvMean(L.map(([, m]) => m.plan.res.R)), bot: rvMean(L.map(([x]) => x.R))};
}
document.getElementById('panel').addEventListener('click', e => {
  if (e.target.closest('[data-rvtags]')) { e.stopPropagation(); rvTagsToggle(); return; }
  const p = e.target.closest('[data-rvpick]'), f = e.target.closest('[data-rvacct]'); if (!p && !f) return; e.stopPropagation();
  if (p) RVS.key = p.dataset.rvpick; if (f) { RVS.acct = f.dataset.rvacct; RVS.key = null; }
  renderPanel();
}, true);

/* ---- Reviewer panel: "Timeframes" tab: 24h follow-ups of closed trades, replayed on 15m / 1h / 4h ---- */
const RV_FU_V = {early: ['Closed too early', DN], tight: ['Stop too tight', DN], saved: ['Early exit saved money', UP], right: ['Exit was right', UP], left: ['Left money on the table', WARN], fine: ['Good exit', UP]};
/* ---- SMC review: the SMC Trader judged on SMC terms, not on the Trader's criteria ---- */
function rvSmcHTML() {
  return `<h3 style="margin:4px 0 8px">COACHING THE SMC TRADER</h3>${smCoachHTML()}<h3 style="margin:18px 0 8px">FACTOR STUDY</h3>${rvSmcStudyHTML()}`;
}
function rvSmcStudyHTML() {
  const L = SM.log, St = smStudy(L), A = RV.smAdj || {}, W = RV.smWhy || {}, Y = youTally(L), s = SM.cfg;
  const cell = a => a && a.n ? `<td>${a.n}</td><td class="${cls(a.avgR)}">${fmtR(a.avgR)}</td>` : '<td class="dim">0</td><td class="dim">—</td>';
  const fac = Object.entries(St.F).map(([k, f]) => `<tr><td style="text-align:left;font-family:var(--sans)">${esc(SM_FACTOR[k])}</td>${cell(f.good)}${cell(f.rest)}${cell(f.poor)}</tr>`).join('');
  const tfRows = ['15m', '1h'].map(t => { const a = St.tf[t]; return `<tr><td style="text-align:left;font-family:var(--sans)">${t} setups <span class="dim">(filter: ${SM_TF[t].htf})</span></td>${cell(a)}<td>${a && a.n ? a.win.toFixed(0) + '%' : '—'}</td></tr>`; }).join('');
  const htf = ['agrees', 'unclear', 'against'].map(k => `<tr><td style="text-align:left;font-family:var(--sans)">Higher timeframe ${k}</td>${cell(St.htf[k])}<td>${St.htf[k] ? St.htf[k].win.toFixed(0) + '%' : '—'}</td></tr>`).join('');
  const gr = ['A', 'B', 'C', 'D', 'F'].map(g => `<tr><td style="text-align:left;font-family:var(--sans)"><b style="color:${GRADE_C[g]}">${g}</b> setups</td>${cell(St.grade[g])}<td>${St.grade[g] ? St.grade[g].win.toFixed(0) + '%' : '—'}</td></tr>`).join('');
  const typ = ['rev', 'cont'].map(k => `<tr><td style="text-align:left;font-family:var(--sans)">${k === 'rev' ? 'Reversal setups' : 'Continuation setups'}</td>${cell(St.type[k])}<td>${St.type[k] ? St.type[k].win.toFixed(0) + '%' : '—'}</td></tr>`).join('');
  const kind = ['FVG', 'OB'].map(k => `<tr><td style="text-align:left;font-family:var(--sans)">${k === 'FVG' ? 'Fair value gap' : 'Order block'} entries</td>${cell(St.kind[k])}<td>${St.kind[k] ? St.kind[k].win.toFixed(0) + '%' : '—'}</td></tr>`).join('');
  const adj = Object.keys(A).length ? Object.keys(A).map(k => `<div class="chk"><span class="i" style="color:#c5f05a">R</span><span><b>${esc({needHTF: 'Only with the higher timeframe', needPOI: 'Only from a higher-timeframe zone or swing', needDraw: 'Only with the higher-timeframe draw', noCont: 'Continuation setups paused', fvgOnly: 'FVGs only', minQ: `Quality ${A.minQ}/100 or better`, noTf: `${A.noTf} setups paused`, needDepth: 'Enter at the zone\'s midpoint or deeper', stopBuf: `Stop ${A.stopBuf}% beyond the sweep`, tp1R: `Half at +${A.tp1R}R`, riskMul: `Size ×${A.riskMul}`, zone: 'Zone choice tuned from labelled zones'}[k] || k)}</b><br><span class="dim" style="font-size:12px">${esc(W[k] || '')}</span></span></div>`).join('') : `<span class="dim" style="font-size:13px">No changes yet. A rule changes when 5+ trades on each side of a comparison differ by 0.5R or more, or when your comments say the same thing on 2+ trades.</span>`;
  const wt = n => (Math.round(n * 2) / 2).toString().replace('.5', '½').replace(/^0½/, '½');
  const you = Y.n ? Object.entries(Y.alt).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip" style="cursor:default">${esc(MINE_ALT[k] || k)} · ${wt(n)}</span>`).join(' ') : '';
  const poor = Object.entries(Y.bad).map(([k, n]) => `<span class="chip" style="cursor:default">${esc(YOU_B_TXT[k] || k)} · ${wt(n)}</span>`).join(' ');
  const dis = Object.entries(Y.dis).filter(([k]) => k.startsWith('smc_')).map(([k, n]) => `<span class="chip" style="cursor:default">${esc(SM_FACTOR[k.slice(4)] || k.slice(4))} · ${wt(n)}</span>`).join(' ');
  return `<p class="note">The SMC Trader isn't judged on the Trader's reversal signs. Every SMC setup gets a <b>quality score in SMC terms</b> when it is taken: was the sweep clean, was real liquidity (equal highs/lows) taken, how strong was the structure break, is the FVG a good FVG (size and the displacement candle behind it) or the order block a good OB (did it take the liquidity), is the entry in discount for a long / premium for a short, does the <b>higher timeframe</b> agree, and how deep into the zone was the entry. <b>Timeframe rule:</b> a 15m setup is never taken against a falling/rising 1h, and a 1h setup never against the 4h.</p>
  <div class="grid2">
    <div class="card2"><h3>WHICH SMC FACTORS PAY</h3><p class="dim" style="font-size:12px;margin:0 0 6px">${St.n} graded SMC trades (trades closed by you or left out are skipped). Average result when the factor was good, fair or weak.</p>
      ${fac ? `<table class="t"><thead><tr><th style="text-align:left">Factor</th><th>Good</th><th>Avg</th><th>Not good</th><th>Avg</th><th>Weak</th><th>Avg</th></tr></thead><tbody>${fac}</tbody></table>` : '<span class="dim">No graded SMC trades yet. Trades opened from now on carry a quality read.</span>'}</div>
    <div class="card2"><h3>TIMEFRAME · HIGHER TIMEFRAME · QUALITY</h3><table class="t"><thead><tr><th style="text-align:left">Group</th><th>Trades</th><th>Avg</th><th>Win</th></tr></thead><tbody>${typ}${tfRows}${htf}${gr}${kind}</tbody></table></div>
  </div>
  <div class="grid2" style="margin-top:12px">
    <div class="card2" style="border-left:4px solid #c5f05a"><h3 style="color:#c5f05a">WHAT THE SMC REVIEW CHANGED</h3>${adj}${W.youHold ? `<div class="chk"><span class="i" style="color:${MINE_C}">✍</span><span>${esc(W.youHold)}</span></div>` : ''}
      <div class="dim" style="font-size:12px;margin-top:8px">Learning is <b>${s.learn ? 'on' : 'off'}</b> (SMC desk → Rules &amp; settings). ${s.learn ? '' : 'Changes are shown but not applied.'}</div></div>
    <div class="card2" style="border-left:4px solid ${MINE_C}"><h3 style="color:${MINE_C}">YOUR SMC REVIEWS</h3>${Y.n ? `<div style="font-size:13px;margin-bottom:6px">${Y.n} SMC trade${Y.n > 1 ? 's' : ''} reviewed by you, ${Y.nc} with a comment the Reviewer could read. Counts: comment 1, tick ½; 2 makes a rule.</div>${you ? `<div class="dim" style="font-size:12px;margin:6px 0 4px">What you'd have done</div>${you}` : ''}${poor ? `<div class="dim" style="font-size:12px;margin:8px 0 4px">What you said was poor</div>${poor}` : ''}${dis ? `<div class="dim" style="font-size:12px;margin:8px 0 4px">SMC points you said were fine</div>${dis}` : ''}` : '<span class="dim" style="font-size:13px">None yet. Open an SMC trade in "On the chart" (or press E at the review wall) and review it: what you\'d have done, and which SMC points you disagree with.</span>'}</div>
  </div>`;
}
function rvTfHTML() {
  const blocks = [['pt', 'Trader', '#ffd166', PT.log], ['sm', 'SMC Trader', SMCOL, SM.log]].map(([a, name, col, L]) => {
    const st = rvTfStudy(L), cols = [['act', 'What it did'], ['15m', '15m, no early exits'], ['1h', '1h chart'], ['4h', '4h chart']];
    const best = ['act', '15m', '1h', '4h'].filter(k => st.all[k].n).sort((p, q) => st.all[q].avg - st.all[p].avg)[0];
    const row = (lab, g) => `<tr><td style="text-align:left;font-family:var(--sans)">${lab}</td>${cols.map(([k]) => { const v = g[k]; return `<td class="${cls(v.avg)}"${k === best && g === st.all ? ' style="font-weight:800;text-decoration:underline"' : ''}>${v.n ? `${fmtR(v.avg)}<br><span class="dim" style="font-size:11px">${v.n} trade${v.n === 1 ? '' : 's'} · ${v.win.toFixed(0)}% win</span>` : '<span class="dim">n/a</span>'}</td>`; }).join('')}</tr>`;
    const lost = L.filter(x => x.fu && x.R <= 0).slice(0, 30);
    const vd = Object.entries(st.vd).sort((p, q) => q[1] - p[1]).map(([k, n]) => `<span class="tag" style="color:${RV_FU_V[k][1]}">${RV_FU_V[k][0]}: ${n}</span>`).join(' ');
    return `<div class="card2" style="margin-bottom:14px;border-left:4px solid ${col}"><h3 style="color:${col}">${name.toUpperCase()} · ${st.n} TRADE${st.n === 1 ? '' : 'S'} FOLLOWED${st.pending ? ` · ${st.pending} BEING FOLLOWED NOW` : ''}</h3>
      <div style="font-size:14px;margin:4px 0 10px;color:${st.rec.k === 'wait' ? 'var(--dim)' : st.rec.k === 'stay' ? UP : '#c5f05a'}"><b>Reviewer's verdict:</b> ${esc(st.rec.txt)}</div>
      ${st.n ? `<table class="t"><thead><tr><th style="text-align:left">Average per trade</th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${row('All followed trades', st.all)}${st.lost.act.n ? row('Losing trades only', st.lost) : ''}</tbody></table>
      ${vd ? `<div style="margin:10px 0 4px;font-size:12px">After the losing exits: ${vd}</div>` : ''}
      ${lost.length ? `<table class="t" style="margin-top:8px"><thead><tr><th>Closed</th><th>Coin</th><th>Exit</th><th>R</th><th style="text-align:left">Next 24h</th><th>15m*</th><th>1h</th><th>4h</th></tr></thead><tbody>${lost.map(x => { const sm = x.fu.sim || {}, c2 = k => { const v = sm[k] || {}; return fin(v.R) ? `<td class="${cls(v.R)}" title="${esc(v.why || '')}">${fmtR(v.R)}</td>` : `<td class="dim" title="${esc(v.na || '')}">n/a</td>`; }, V = RV_FU_V[x.fu.af.v]; return `<tr data-sym="${x.s}"><td class="dim">${new Date(x.t1).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</td><td class="sym">${esc(x.b)} <span class="${x.side === 'L' ? 'up' : 'dn'}" style="font-size:11px">${x.side === 'L' ? 'L' : 'S'}</span>${x.strat === 'mom' ? ' <span class="dim" style="font-size:10px">MOM</span>' : ''}</td><td class="dim" style="font-family:var(--sans);font-size:11px;text-align:left">${esc(rvExitKind(x))}</td><td class="${cls(x.R)}">${fmtR(x.R)}</td><td style="text-align:left;white-space:normal;min-width:240px;font-family:var(--sans);font-size:12px"><b style="color:${V[1]}">${V[0]}.</b> ${esc(x.fu.af.txt.replace(/^[^:]*: /, '').replace(/^./, m => m.toUpperCase()))}</td>${c2('15m')}${c2('1h')}${c2('4h')}</tr>`; }).join('')}</tbody></table>` : ''}` : `<div class="dim" style="font-size:13px">No trade has finished its 24-hour follow-up yet${st.pending ? ` (${st.pending} closed in the last 24 h: the first results arrive 24 h after each exit)` : ''}.</div>`}</div>`;
  }).join('');
  return `<p class="note">The Reviewer keeps watching every trade for <b>24 hours after it closes</b> (from the browser that's trading, or the cloud), to answer one question: <b>would a slower chart have managed it better?</b> It replays the same entry three ways and compares them with what the trader actually did:<br>
  <b>15m, no early exits</b>: the same stop, but no "signals faded" exit and no time stop. Half off at the first target, then a 15m EMA20 trail, until the stop, the target, or 24 h after the real exit.<br>
  <b>1h chart</b>: the stop beyond the last 12 h swing on 1h candles (never tighter than the real one), and a 1h EMA20 trail.<br>
  <b>4h chart</b>: the stop beyond the last 24 h swing on 4h candles, and a 4h EMA20 trail.<br>
  Every version risks the same 1% (a wider stop means a smaller position) and pays the same fees. If a slower chart would put the stop more than 30% away, that replay is marked n/a: on thin small caps that's often the answer in itself. Winners are followed too: a slower chart that saves losers but gives back winners isn't better. The verdict waits for ${RV_TF_MIN} followed trades.</p>${blocks}
  <p class="note">* 15m = the same stop and chart the trader used, held without the early exits. Hover a result to see how that replay ended.</p>`;
}

/* ---- Reviewer panel: "Criteria" tab: which level of each reading led to better trades ---- */
const RVC = {st: 'rev'};
const AG_NAME = {scout: 'GainerLoser', ivy: 'OpenInterest', flo: 'Flow'};
function rvCritHTML() {
  const st = RVC.st, T = critTrades(st), prof = RV.prof || rvProfile(), F = (prof.F || []).filter(f => f.st === st);
  const chips = `<div style="display:flex;gap:6px;margin-bottom:10px">${['rev', 'mom', 'smc'].map(k => `<span class="chip ${st === k ? 'on' : ''}" data-rvcrit="${k}">${CRIT_STRAT[k]} · ${critTrades(k).length}</span>`).join('')}</div>`;
  const intro = `<p class="note">When a trade opens, the coin's readings are saved with it: move size, volume, rank, time in the top 5, distance from the extreme, open interest, flow, taker pressure, funding, RSI, and each entry sign. Readings are turned to the direction of the coin's move, so a gainer and a loser can be compared ("flow with the trend"). For each reading the Reviewer tests several cut-off levels and keeps the one that best separates good trades from bad ones. Testing many readings at many levels always turns up some gaps by luck, so a level is only <b>published to the screening agents</b> when: at least ${CRIT_MIN} trades have that reading (${CRIT_SIDE}+ on each side of the cut-off); the gap is at least ${CRIT_EDGE}R per trade; it passes a significance test (confidence t ≥ ${CRIT_T}); the same gap shows up separately in the older and the newer half of the trades; and the better side actually makes money. On random test data that lets a chance pattern through roughly once in 10–30 checks, and a real gap of about 0.8R per trade usually needs 40–80 trades to be confirmed. Trades from before today have no readings saved, so the count starts now.</p>`;
  const pub = `<div class="card2" style="margin-bottom:12px;border-left:4px solid #c5f05a"><h3 style="color:#c5f05a">PUBLISHED TO THE SCREENING AGENTS · ${esc(CRIT_STRAT[st].toUpperCase())}</h3>${F.length ? F.map(f => `<div class="chk"><span class="i" style="color:#c5f05a">›</span><span><b>${esc(f.txt)}</b> <span class="dim" style="font-size:12px">· ${esc(f.ev)} · used by ${AG_NAME[f.ag]}</span></span></div>`).join('') : `<span class="dim" style="font-size:13px">${T.length < CRIT_MIN ? `Nothing yet: ${T.length} of ${CRIT_MIN} trades with readings so far.` : 'No reading separates good and bad trades clearly enough yet. The agents keep screening as before.'}</span>`}</div>`;
  if (!T.length) return chips + intro + pub;
  const rows = CRIT.map(c => {
    const sp = critSplit(T, c), b = sp.best, on = F.find(f => f.k === c.k);
    const bk = sp.bk.map(x => `<span class="tag" style="color:${tone(x.avgR)}" title="${x.n} trades, ${x.win.toFixed(0)}% win">${x.lo === -Infinity ? 'under ' + critFmt(c, x.hi) : x.hi === Infinity ? critFmt(c, x.lo) + '+' : critFmt(c, x.lo) + '–' + critFmt(c, x.hi)}: ${fmtR(x.avgR)} (${x.n})</span>`).join(' ');
    return `<tr${on ? ' style="background:rgba(197,240,90,.07)"' : ''}><td style="text-align:left;font-family:var(--sans)">${esc(c.lab)}${on ? ' <b style="color:#c5f05a">· published</b>' : ''}</td><td class="dim" style="font-family:var(--sans);font-size:11px">${AG_NAME[c.ag]}</td><td>${sp.n}</td>
      <td>${b ? critFmt(c, b.t) : '<span class="dim">—</span>'}</td><td class="${b ? cls(b.a.avgR) : 'dim'}">${b ? `${fmtR(b.a.avgR)} <span class="dim">(${b.a.n})</span>` : '—'}</td><td class="${b ? cls(b.b.avgR) : 'dim'}">${b ? `${fmtR(b.b.avgR)} <span class="dim">(${b.b.n})</span>` : '—'}</td><td class="${b && Math.abs(b.ts) >= CRIT_T ? 'up' : 'dim'}">${b ? Math.abs(b.ts).toFixed(1) : '—'}</td>
      <td style="text-align:left;white-space:normal;min-width:260px">${bk || '<span class="dim">—</span>'}</td></tr>`;
  }).join('');
  const sg = (CRIT_SIGNS[st] || []).map((lab, i) => { const r = critSign(T, i), on = F.find(f => f.sg === i); return `<tr${on ? ' style="background:rgba(197,240,90,.07)"' : ''}><td style="text-align:left;font-family:var(--sans)">${esc(lab)}${on ? ' <b style="color:#c5f05a">· published</b>' : ''}</td><td class="${cls(r.a.avgR)}">${r.a.n ? `${fmtR(r.a.avgR)} <span class="dim">(${r.a.n})</span>` : '—'}</td><td class="${cls(r.b.avgR)}">${r.b.n ? `${fmtR(r.b.avgR)} <span class="dim">(${r.b.n})</span>` : '—'}</td><td class="${cls(r.d)}">${fin(r.d) ? fmtR(r.d) : '—'}</td><td class="${Math.abs(r.ts) >= CRIT_T ? 'up' : 'dim'}">${r.ts ? Math.abs(r.ts).toFixed(1) : '—'}</td></tr>`; }).join('');
  return chips + intro + pub + `<div class="card2"><h3>EVERY READING · BEST CUT-OFF SO FAR</h3><table class="t"><thead><tr><th style="text-align:left">Reading</th><th>Agent</th><th>Trades</th><th>Best cut-off</th><th>At or above</th><th>Below</th><th>Confidence (t)</th><th style="text-align:left">By level · avg R (trades)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="card2" style="margin-top:12px"><h3>ENTRY SIGNS · PRESENT vs ABSENT</h3><table class="t"><thead><tr><th style="text-align:left">Sign</th><th>Present</th><th>Absent</th><th>Difference</th><th>Confidence (t)</th></tr></thead><tbody>${sg}</tbody></table></div>`;
}
document.getElementById('panel').addEventListener('click', e => { const c = e.target.closest('[data-rvcrit]'); if (!c) return; e.stopPropagation(); RVC.st = c.dataset.rvcrit; renderPanel(); }, true);

/* ---- what the screening agents show ---- */
function fitList(s) { return ['rev', 'mom', 'smc'].filter(st => !(st === 'rev' && sideOf(s) === 'L' && !PT.cfg.revLong)).map(st => [st, profFit(s, st)]).filter(([, f]) => f); }
const FIT_AB = {rev: 'R', mom: 'M', smc: 'S'};
C.fit = {h: 'Reviewer fit', v: m => { const L = fitList(m.s); return L.length ? Math.max(...L.map(([, f]) => f.hit.length / f.of)) : null; },
  f: m => { const L = fitList(m.s); return td(L.length ? L.map(([st, f]) => `<span class="tag" style="color:${f.hit.length === f.of ? '#c5f05a' : f.hit.length ? TXT : DIM}" title="${esc(CRIT_STRAT[st])}: meets ${f.hit.map(x => x.txt).join('; ') || 'none'}${f.miss.length ? ' · misses ' + f.miss.map(x => x.txt).join('; ') : ''}">${FIT_AB[st]} ${f.hit.length}/${f.of}</span>`).join(' ') : '<span class="dim">—</span>'); }};
function critAgentCard(id) {
  const prof = RV.prof || {F: [], n: {}}, F = (prof.F || []).filter(f => f.ag === id), n = prof.n || {};
  const what = {scout: 'which movers to focus on', ivy: 'which open-interest readings matter', flo: 'which flow, taker and funding readings matter'}[id];
  return `<div class="card2" style="margin-bottom:12px;border-left:4px solid #c5f05a;padding:10px 14px"><b style="color:#c5f05a;font-size:12px;letter-spacing:.06em">REVIEWER'S SCREENING CRITERIA</b> <span class="dim" style="font-size:12px">· learned from closed trades: ${what}</span>
    ${F.length ? F.map(f => `<div class="chk" style="padding:3px 0"><span class="i" style="color:#c5f05a">›</span><span><b>${esc(f.txt)}</b> <span class="dim" style="font-size:12px">for ${esc(CRIT_STRAT[f.st].toLowerCase())} · ${esc(f.ev)}</span></span></div>`).join('')
      : `<div class="dim" style="font-size:12px;margin-top:4px">No clear level yet. Each strategy needs ${CRIT_MIN} trades with readings (reversal ${n.rev || 0}, momentum ${n.mom || 0}, SMC ${n.smc || 0}). Until then, screen as usual.</div>`}
    ${(RV.memos || []).filter(m => m.to === id || m.from === id).slice(0, 4).map(m => `<div style="font-size:12px;margin-top:4px"><span class="dim">${ago(m.t)} ago · ${AGN[m.from]} → ${AGN[m.to]}:</span> ${esc(m.txt)}</div>`).join('')}
    ${id === 'scout' && (prof.F || []).length ? '<div class="dim" style="font-size:12px;margin-top:4px">The "Reviewer fit" column shows how many of these criteria each coin meets right now (R = reversal, M = momentum, S = SMC). Hover it for details.</div>' : ''}</div>`;
}


/* ---- Reviewer panel: "Screening talk" tab: the Reviewer, the screening agents and the traders, in their own words ---- */
const AG_COL = {rev: '#c5f05a', scout: '#4dd2ff', ivy: '#b48cff', flo: '#2ee59d', trader: '#ffd166', smc: SMCOL};
function rvTalkHTML() {
  const F = (RV.prof || {}).F || [], M = RV.memos || [];
  const use = st => scrUse(st) ? '<span class="up">on</span>' : '<span class="dim">off</span>';
  const inUse = ['rev', 'mom', 'smc'].map(st => { const L = F.filter(f => f.st === st); return `<div class="card2"><h3 style="color:${st === 'smc' ? SMCOL : '#ffd166'}">${esc(CRIT_STRAT[st].toUpperCase())} · SCREENS ${use(st)}</h3>${L.length ? L.map(f => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${AG_COL[f.ag]}">${esc(AGN[f.ag][0])}</span><span>${esc(f.txt)} <span class="dim" style="font-size:11px">· ${esc(AGN[f.ag])} screens it · ${esc(f.ev)}</span></span></div>`).join('') : '<span class="dim" style="font-size:12px">No screen published yet.</span>'}</div>`; }).join('');
  // did the screens help? trades that passed every screen vs screen tests (failed one, traded anyway)
  const T = [...PT.log, ...SM.log].filter(x => x.scr && !rvManual(x)), pass = T.filter(x => !x.scr.test), test = T.filter(x => x.scr.test), A = rvAgg(pass), B = rvAgg(test);
  const val = T.length ? `<div class="card2" style="margin-top:12px"><h3>ARE THE SCREENS WORKING?</h3><table class="t"><thead><tr><th style="text-align:left">Trades</th><th>Count</th><th>Win</th><th>Avg</th></tr></thead><tbody>
    <tr><td style="text-align:left;font-family:var(--sans)">Passed every screen</td><td>${A.n}</td><td>${A.n ? A.win.toFixed(0) + '%' : '—'}</td><td class="${cls(A.avgR)}">${fmtR(A.avgR)}</td></tr>
    <tr><td style="text-align:left;font-family:var(--sans)">Screen tests (failed a screen, traded anyway)</td><td>${B.n}</td><td>${B.n ? B.win.toFixed(0) + '%' : '—'}</td><td class="${cls(B.avgR)}">${fmtR(B.avgR)}</td></tr></tbody></table>
    <p class="note" style="margin-top:6px">If the screen tests keep doing as well as the trades that passed, the screens aren't helping, and the Reviewer's next profile will drop them.</p></div>` : '';
  const thread = M.length ? M.slice(0, 60).reverse().map(m => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)"><span class="dim mono" style="font-size:11px;min-width:54px">${ago(m.t)} ago</span><span style="min-width:190px;font-size:12px"><b style="color:${AG_COL[m.from]}">${esc(AGN[m.from])}</b> <span class="dim">→</span> <b style="color:${AG_COL[m.to]}">${esc(AGN[m.to])}</b></span><span style="font-size:13px">${esc(m.txt)}</span></div>`).join('')
    : `<div class="dim" style="font-size:13px;padding:6px 0">No messages yet. The first ones come when the Reviewer publishes a screening criterion: that needs ${CRIT_MIN} trades with readings for a strategy (reversal ${critTrades('rev').length}, momentum ${critTrades('mom').length}, SMC ${critTrades('smc').length} so far).</div>`;
  return `<p class="note">How the agents work together on screening:<br>
  <b>1. Reviewer → screening agents.</b> When the Reviewer confirms a level that separates good trades from bad (see "Criteria"), it sends it to the agent that owns that reading. Move size, volume, rank, timing and RSI go to <b>GainerLoser</b>; open interest goes to <b>OpenInterest</b>; flow, taker pressure and funding go to <b>Flow</b>.<br>
  <b>2. Screening agents.</b> Each agent applies it as a screen and marks every coin ✓ or ✗ (the "Reviewer fit" column on GainerLoser, the cards on each desk), then reports back how many current movers pass.<br>
  <b>3. Traders.</b> The Trader and the SMC Trader skip setups that fail a screen for their strategy and take the best fits first. 1 in 5 failing setups is still traded as a <b>screen test</b>, so the Reviewer keeps measuring whether the screen still matters. When the evidence fades, the Reviewer lifts the screen and everyone is told.<br>
  Each trader has an on/off switch for this under Rules &amp; settings.</p>
  <div class="grid2" style="grid-template-columns:repeat(3,1fr)">${inUse}</div>${val}
  <div class="card2" style="margin-top:12px"><h3>CONVERSATION · OLDEST FIRST</h3>${thread}</div>`;
}


/* ---- your own review of a trade (button on the review wall, form on the Reviewer's "On the chart" tab) ---- */
const MINE_C = '#ff8ad8';
const MINE_AG = {agree: 'agree with the Reviewer', partly: 'partly agree', disagree: 'disagree with the Reviewer'};
const MINE_ALT = {same: 'same trade', flip: 'other side', skip: 'skip it', later: 'enter later', earlier: 'enter earlier', exitE: 'exit earlier', hold: 'hold longer', wider: 'wider stop', tighter: 'tighter stop', bigger: 'bigger size', smaller: 'smaller size'};
const MD = {key: null, d: null, msg: ''};           // the form being filled in (kept across panel refreshes)
function mineDraft(k) { if (MD.key !== k) { const r = RVM[k]; MD.key = k; MD.d = r ? JSON.parse(JSON.stringify(r)) : {g: '', ag: '', alt: [], x: [], note: '', excl: false, imgs: [], plan: null}; RVP.hist = []; MD.d.imgs = MD.d.imgs || []; MD.msg = ''; } return MD.d; }
// chart pictures on a review: shrunk to ≤1600 px JPEG (~150-400 KB) so they sync quickly
async function mineImgPrep(file) {
  const url = URL.createObjectURL(file), im = new Image();
  try { await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('not a picture')); im.src = url; }); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const sc = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.fillStyle = '#04070f'; c.fillRect(0, 0, w, h); c.drawImage(im, 0, 0, w, h);
  let q = 0.88, data = cv.toDataURL('image/jpeg', q); while (data.length > 550e3 && q > 0.5) { q -= 0.1; data = cv.toDataURL('image/jpeg', q); }
  return {p: 'img/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.jpg', w, h, cap: '', data};
}
function mineImgsHTML(d) {
  const L = d.imgs || [];
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">${L.map((im, i) => `<div style="width:210px"><div style="position:relative"><img data-mimg="${esc(im.p)}"${im.data ? ` src="${im.data}"` : ''} data-mimg-open="${i}" alt="loading…" style="width:210px;height:126px;object-fit:cover;border-radius:7px;border:1px solid var(--line);cursor:zoom-in;background:#0b1224;display:block;color:var(--dim);font-size:11px"><span data-mimg-del="${i}" title="Remove this picture" style="position:absolute;top:5px;right:5px;background:rgba(4,7,15,.85);color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px">×</span></div><textarea data-mimg-cap="${i}" rows="2" placeholder="What this picture shows, e.g. 4h OB here · swept PDL first · 1h still falling" style="width:100%;margin-top:4px;background:#0b1224;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:5px 7px;font:12px var(--sans);resize:vertical">${esc(im.cap || '')}</textarea></div>`).join('')}
    ${L.length < 4 ? `<label class="btn ghost sm" style="cursor:pointer;align-self:center">📷 Add picture<input type="file" id="mineImg" accept="image/*" multiple style="display:none"></label>` : ''}</div>
    <div class="dim" style="font-size:11px;margin-top:4px">Up to 4 per review: screenshots of your chart, your own markup. You can also paste a screenshot (Ctrl+V / ⌘V) into the comment box. Click a picture to see it full size.</div>`;
}
function mineImgsRefresh() {
  const box = document.getElementById('mineImgs'); if (box && MD.d) box.innerHTML = mineImgsHTML(MD.d);
  const r = document.getElementById('mineRead'); if (r && MD.d) r.innerHTML = mineReadHTML(MD.d, MD.x && MD.x.side, MD.x);
  const m = document.getElementById('mineMsg'); if (m) m.textContent = MD.msg || '';
  imgFill();
}
async function mineAddImgs(files) {
  const d = MD.d; if (!d) return; d.imgs = d.imgs || []; MD.msg = '';
  for (const f of files) {
    if (!/^image\//.test(f.type || '')) continue;
    if (d.imgs.length >= 4) { MD.msg = 'Up to 4 pictures per review.'; break; }
    try { d.imgs.push(await mineImgPrep(f)); MD.msg = 'Picture added. Press "Save my review" to keep it.'; } catch (e) { MD.msg = 'Could not read that picture: ' + e.message; }
  }
  mineImgsRefresh();
}
function mineImgView(src, cap) {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,4,10,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out;padding:24px';
  o.innerHTML = `<img src="${src}" style="max-width:96vw;max-height:86vh;border-radius:8px;box-shadow:0 0 40px rgba(0,0,0,.6)">${cap ? `<div style="color:#f3d6ea;font:15px var(--sans);margin-top:12px;max-width:90vw;text-align:center">${esc(cap)}</div>` : ''}<div style="color:#8a94b0;font:12px var(--sans);margin-top:8px">click or Esc to close</div>`;
  const k = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); close(); } };
  const close = () => { o.remove(); removeEventListener('keydown', k, true); };
  o.onclick = close; addEventListener('keydown', k, true); document.body.appendChild(o);
}
// what the Reviewer took from your comment, shown live under the box
function mineReadHTML(m, side, x) {
  const note = mineText(m), pp = planPoints(m && m.plan, x), ppTxt = youReadTxt({any: true, a: pp.a, b: pp.b, d: pp.d});
  const fromChart = ppTxt ? `<br><span style="color:${MINE_C}">From your marks on the chart:</span> <b>${esc(ppTxt)}</b> <span class="dim">(counts like a comment)</span>` : '';
  if (!String(note || '').trim()) return (ppTxt ? '' : '<span class="dim">Write what you saw (in the comment or under a picture), or mark your own setup on the chart; the Reviewer will show here what it takes from it.</span>') + fromChart;
  const c = youReadM(m, side);
  if (c.rd) return `<span style="color:${MINE_C}">Claude read this review (comment${(m.imgs || []).length ? ' and pictures' : ''}) and told the Reviewer:</span> <b>${esc(youReadTxt(c) || 'nothing to change')}</b>${c.rd.txt ? `<br><span class="dim">${esc(c.rd.txt)}</span>` : ''}` + fromChart;
  const stale = m && m.rd ? ' <span class="dim">(Claude\'s earlier reading no longer applies because the text changed.)</span>' : '';
  return (c.any ? `<span style="color:${MINE_C}">The Reviewer reads this as:</span> <b>${esc(youReadTxt(c))}</b>` : '<span style="color:#ffd166">Nothing the Reviewer can act on yet.</span> <span class="dim">It understands phrases like "entered too early", "wait for the retest", "enter when it comes back to the OB", "should have been a short", "1h is dropping", "stop too tight / wicked out", "closed too early", "take profit earlier", "smaller size", "weak OB", "small FVG", "good FVG", "should not have traded" (also 太早入, 等回調, 應該做空, 止蝕太近, 逆勢, 走得太早…). Your note is still saved; for anything longer, ask Claude in the chat to read your reviews (it reads the pictures too).</span>') + stale + fromChart;
}
function mineFormHTML(a, x, E) {
  const k = tradeKey(a, x), d = mineDraft(k), saved = RVM[k];
  MD.x = x; MD.acct = a; setTimeout(imgFill, 0);
  const chip = (attr, v, lab, on, col) => `<span class="chip ${on ? 'on' : ''}" ${attr}="${v}" style="${on ? `background:${col || MINE_C};color:#04070f;border-color:${col || MINE_C}` : ''}">${lab}</span>`;
  return `<div class="card2" id="mineForm" style="margin-top:12px;border-left:4px solid ${MINE_C}"><h3 style="color:${MINE_C}">YOUR REVIEW${saved ? ` <span class="dim" style="font-size:11px;font-weight:500">saved ${ago(saved.t)} ago${saved.by ? ' on ' + esc(saved.by) : ''}</span>` : ''}</h3>
    <div style="display:grid;grid-template-columns:150px 1fr;gap:10px 12px;align-items:center;font-size:13px">
      <span style="color:${MINE_C};font-weight:700">Your comments<br><span class="dim" style="font-weight:400;font-size:11px">the Reviewer reads these first</span></span><div><textarea id="mineNote" rows="3" placeholder="In your own words (English or 中文): e.g. entered too early, should wait for the midpoint · stop too tight, wicked out · against the 4h · weak OB · good FVG · should have held" style="width:100%;background:#0b1224;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px;font:13px var(--sans);resize:vertical">${esc(d.note || '')}</textarea><div id="mineRead" style="font-size:12px;margin-top:4px">${mineReadHTML(d, x.side, x)}</div></div>
      <span style="color:${MINE_C};font-weight:700">Chart pictures<br><span class="dim" style="font-weight:400;font-size:11px">explain your read; the Reviewer reads the captions too</span></span><div id="mineImgs">${mineImgsHTML(d)}</div>
      <span class="dim">Your grade</span><div style="display:flex;gap:6px;flex-wrap:wrap">${['A', 'B', 'C', 'D', 'F'].map(gr => chip('data-mine-g', gr, gr, d.g === gr, GRADE_C[gr])).join('')}<span class="dim" style="font-size:11px;align-self:center">Reviewer said ${E.grade.g}</span></div>
      <span class="dim">The Reviewer's verdict</span><div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries({agree: 'Agree', partly: 'Partly', disagree: 'Disagree'}).map(([v, l]) => chip('data-mine-ag', v, l, d.ag === v)).join('')}</div>
      <span class="dim">Points you disagree with <span style="font-size:11px">(½ weight)</span></span><div style="display:flex;gap:6px;flex-wrap:wrap">${E.items.map(it => chip('data-mine-x', it.n, (it.ok ? '✓' : '✗') + it.n, d.x.includes(it.n), it.ok ? UP : DN)).join('') || '<span class="dim">—</span>'}</div>
      <span class="dim">What you'd have done <span style="font-size:11px">(½ weight)</span></span><div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(MINE_ALT).map(([v, l]) => chip('data-mine-alt', v, l, d.alt.includes(v))).join('')}</div>
      <span></span><label style="display:flex;gap:8px;align-items:center;font-size:12px;cursor:pointer"><input type="checkbox" id="mineExcl" ${d.excl ? 'checked' : ''}> Leave this trade out of the Reviewer's learning (bad data, a fluke, or not a real setup)</label>
    </div>
    ${(() => { const st = rvPlanStats(a); return st ? `<p class="note" style="margin-top:8px;color:${PLAN_C}">Your marked setups on ${a === 'sm' ? 'SMC' : 'Trader'} trades: ${st.n} filled, averaging ${fmtR(st.you)} vs ${fmtR(st.bot)} for the trader on the same trades${st.nf ? `; ${st.nf} never reached your entry` : ''}.</p>` : ''; })()}
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><button class="btn" data-mine="save" style="background:${MINE_C};color:#04070f;border-color:${MINE_C}">Save my review</button>${saved ? '<button class="btn ghost sm" data-mine="del">Delete</button>' : ''}<span style="font-size:12px" id="mineMsg">${esc(MD.msg)}</span></div>
    <p class="note" style="margin-top:8px">${SY.on ? 'Saved to your shared account, so it shows on every computer and on the review wall.' : 'Saved in this browser only (Sync is off).'} </p>
    <p class="note" style="margin-top:4px"><b>How your review counts:</b> your <b>comments come first</b>. A point the Reviewer reads in a comment counts 1; a chip you tick without saying it in the comment counts ½. When the same point reaches 2 and at least a third of your ${a === 'sm' ? 'SMC' : 'Trader'} reviews that say anything (or 3, whatever the share), the Reviewer applies it at its next review. If you ask Claude in the chat to read your reviews, its reading of the comment and pictures is used instead of the phrase reader. Your marks on the chart count like a comment: another side → "trade the other side"; an entry deeper than the trade\'s → "enter later"; a stop further out or in → "wider" / "tighter stop"; a nearer or further target → "exit earlier" / "hold longer". ${a === 'sm' ? 'For the SMC Trader: "too early / wait for the retest / enter when it comes back to…" → enter at the zone\'s midpoint; "should have been a short (long)" → only when the higher timeframe clearly agrees; "against the 1h/4h" → only with the higher timeframe; "weak OB" → FVGs only; "small FVG" or "weak sweep" or "skip" → higher quality bar; "stop too tight" → wider stop; "take profit earlier" → half at +1.2R; "smaller size" → ×0.75. Saying a part was good ("good FVG", "good OB", "HTF was fine") holds the rule built on it.' : '"too early / wait for confirmation" → only at "Reversed"; "should not have traded" → one more sign; "take profit earlier" → half at +1.2R; "closed too early / should have held" → longer hold; "stop too tight / wicked out" → wider stop; "smaller size" → ×0.75. Saying a point was fine ("stop was fine", "forming was fine") holds the rule built on it.'} Trades you mark "leave out" are ignored.</p></div>`;
}
document.getElementById('panel').addEventListener('input', e => {
  if (!MD.d) return;
  if (e.target.id === 'mineNote') { MD.d.note = e.target.value; const r = document.getElementById('mineRead'); if (r) r.innerHTML = mineReadHTML(MD.d, MD.x && MD.x.side, MD.x); }
  if (e.target.dataset && e.target.dataset.mimgCap != null) { const im = (MD.d.imgs || [])[+e.target.dataset.mimgCap]; if (im) im.cap = e.target.value; const r = document.getElementById('mineRead'); if (r) r.innerHTML = mineReadHTML(MD.d, MD.x && MD.x.side, MD.x); }
  if (e.target.id === 'mineExcl') MD.d.excl = e.target.checked;
}, true);
document.getElementById('panel').addEventListener('change', e => {
  if (e.target.id === 'mineImg' && MD.d) { const f = [...(e.target.files || [])]; e.target.value = ''; mineAddImgs(f); }
}, true);
document.getElementById('panel').addEventListener('paste', e => {
  if (!MD.d || !e.target.closest || !e.target.closest('#mineForm')) return;
  const f = [...((e.clipboardData && e.clipboardData.files) || [])].filter(x => /^image\//.test(x.type));
  if (f.length) { e.preventDefault(); mineAddImgs(f); }
}, true);
document.getElementById('panel').addEventListener('click', async e => {
  const pi = e.target.closest('[data-mimg-open],[data-mimg-del]');
  if (pi && MD.d) {
    e.stopPropagation(); const i = +(pi.dataset.mimgOpen ?? pi.dataset.mimgDel), im = MD.d.imgs[i]; if (!im) return;
    if (pi.dataset.mimgDel != null) { MD.d.imgs.splice(i, 1); MD.msg = 'Picture removed. Press "Save my review" to keep the change.'; mineImgsRefresh(); }
    else { const src = im.data || IMGC.get(im.p); if (src) mineImgView(src, im.cap); }
    return;
  }
  const el = e.target.closest('[data-mine-g],[data-mine-ag],[data-mine-x],[data-mine-alt],[data-mine]'); if (!el || !MD.d) return;
  e.stopPropagation(); const d = MD.d;
  const tog = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
  if (el.dataset.mineG) d.g = d.g === el.dataset.mineG ? '' : el.dataset.mineG;
  else if (el.dataset.mineAg) d.ag = d.ag === el.dataset.mineAg ? '' : el.dataset.mineAg;
  else if (el.dataset.mineX) tog(d.x, +el.dataset.mineX);
  else if (el.dataset.mineAlt) tog(d.alt, el.dataset.mineAlt);
  else if (el.dataset.mine === 'save' || el.dataset.mine === 'del') {
    const k = MD.key, del = el.dataset.mine === 'del';
    if (!del && !d.g && !d.ag && !d.note && !d.alt.length && !d.x.length && !d.excl && !(d.imgs || []).length && !planHas(d.plan)) { MD.msg = 'Pick a grade, write a note or mark your setup first.'; renderPanel(); return; }
    // remember WHICH points you disagreed with (by key, not number), so the Reviewer can count them across trades
    let xk = [], ik = [];
    try { const tr = rvTrades().find(([a, x]) => tradeKey(a, x) === k); if (tr) { const E = rvExplain(tr[1], tr[0]); ik = [...new Set(E.items.map(i => i.k))]; xk = [...new Set(d.x.map(n => (E.items.find(i => i.n === n) || {}).k).filter(Boolean))]; } } catch (_) {}
    let plan = planHas(d.plan) ? JSON.parse(JSON.stringify(d.plan)) : null;
    if (plan) try { const tr = rvTrades().find(([a, x]) => tradeKey(a, x) === k), e = tr && rvBars(tr[1]); const r = e && e.bars ? rvPlanSim(tr[1], tr[0], plan, e.bars, e.ms) : null; plan.res = r && !r.bad ? {st: r.st, R: fin(r.R) ? +r.R.toFixed(2) : null, rr: fin(r.rr) ? +r.rr.toFixed(2) : null, tF: r.tF || null, at: now()} : null; } catch (_) {}
    const rec = del ? null : Object.assign({}, d, {imgs: (d.imgs || []).map(({data, ...r}) => r), plan, xk, ik, t: now(), by: SY.name || ''});
    const add = del ? [] : (d.imgs || []).filter(i => i.data).map(i => ({p: i.p, data: i.data}));
    MD.msg = 'Saving…'; renderPanel();
    try {
      const where = await notesSave(k, rec, add);
      if (!del) for (const im of d.imgs || []) delete im.data; // uploaded: shown from the saved copy from now on
      if (del) { MD.key = null; mineDraft(k); }
      MD.msg = del ? 'Deleted.' : where === 'shared' ? 'Saved to your shared account ✓' : 'Saved in this browser ✓';
      try { drawReviewWall(); } catch (_) {}
    } catch (err) { MD.msg = 'Not saved: ' + err.message; }
    renderPanel(); return;
  }
  renderPanel();
}, true);
// open the form for the trade on the review wall
function openMineFromWall() {
  if (!RWS.cur) return;
  RVS.key = tradeKey(...RWS.cur); RVS.acct = 'all';
  if (PS.open) closePanel();
  openPanel('rev'); PS.tab.rev = 'chart'; setTabs(); renderPanel();
  setTimeout(() => { const f = document.getElementById('mineForm'); if (f) f.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 150);
}
// where you are looking on the review wall (canvas pixels), or null
function wallPoint(ndcX = 0, ndcY = 0) {
  if (typeof RWALL === 'undefined') return null;
  const o = camera.position, dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(o).normalize(), px = -RX + 0.15;
  if (dir.x > -0.05) return null; const t = (px - o.x) / dir.x; if (t <= 0 || t > 16) return null;
  const y = o.y + dir.y * t, z = o.z + dir.z * t, u = (RWALL_Z + RWALL_W / 2 - z) / RWALL_W, v = (2.3 + RWALL_H / 2 - y) / RWALL_H;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return {x: u * RWALL.W, y: v * RWALL.H};
}
const atWall = () => started && !PS.open && P.x < -RX + 10.5 && Math.abs(P.z - RWALL_Z) < RWALL_W / 2 + 1.5 && !!wallPoint();
function wallStep(dir) { if (!RWS.n) return; RWS.i = (RWS.i + dir + RWS.n) % RWS.n; RWS.t = now(); try { drawReviewWall(); } catch (_) {} }
