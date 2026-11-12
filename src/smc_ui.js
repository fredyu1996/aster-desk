/* ================= SMC TRADER: screens + panel + comparison ================= */
TABS.smc = [['acct', 'Account'], ['set', 'Setups now'], ['log', 'Trade log'], ['coach', 'Reviewer\'s coaching'], ['cmp', 'Compare with Trader'], ['rules', 'Rules & settings']];
TABS.trader.push(['cmp', 'Compare with SMC']);
const SMCOL = '#ff8ad8';
function smStats() { return acctStats(SM, smEquity()); }
// both equity curves as % from each account's $1,000 start, on one time axis
function drawCmp(c, x, y, w, h, fs = 12) {
  const A = PT.eqs.concat([[now(), ptEquity()]]), B = SM.eqs.concat([[now(), smEquity()]]);
  const pa = A.map(([t, v]) => [t, (v / PT.start - 1) * 100]), pb = B.map(([t, v]) => [t, (v / SM.start - 1) * 100]);
  c.save(); c.translate(x, y);
  const all = pa.concat(pb);
  if (A.length < 2 && B.length < 2) { c.fillStyle = DIM; c.font = `500 ${fs + 2}px ${FS}`; c.textAlign = 'center'; c.fillText('both curves start with the first trades', w / 2, h / 2); c.restore(); c.textAlign = 'left'; return; }
  let lo = Math.min(0, ...all.map(p => p[1])), hi = Math.max(0, ...all.map(p => p[1])); const sp = (hi - lo) || 1; lo -= sp * 0.12; hi += sp * 0.12;
  const t0 = Math.min(...all.map(p => p[0])), t1 = Math.max(...all.map(p => p[0])), pad = Math.max(60, fs * 5.6);
  const X = t => 6 + (t - t0) / ((t1 - t0) || 1) * (w - pad - 10), Y = v => 8 + (hi - v) / (hi - lo) * (h - 24);
  c.strokeStyle = 'rgba(124,137,168,.35)'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(6, Y(0)); c.lineTo(w - pad, Y(0)); c.stroke(); c.setLineDash([]);
  for (const [pts, col] of [[pa, '#ffd166'], [pb, SMCOL]]) { if (pts.length < 2) continue; c.strokeStyle = col; c.lineWidth = 2.2; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke(); }
  c.fillStyle = DIM; c.font = `500 ${fs}px ${FM}`; c.textBaseline = 'middle';
  c.fillText(fmtPct(hi, 1), w - pad + 4, 12); c.fillText(fmtPct(lo, 1), w - pad + 4, h - 14); c.fillText('0%', w - pad + 4, Y(0));
  c.font = `700 ${fs}px ${FS}`; c.fillStyle = '#ffd166'; c.fillText('— Trader', 10, 12); c.fillStyle = SMCOL; c.fillText('— SMC Trader', 10 + fs * 6.5, 12);
  c.restore(); c.textAlign = 'left';
}
function drawSmcScreens(d) {
  const [A, B] = d.mons, col = d.a.color, st = smStats(), eq = smEquity();
  let c = screenFrame(A, col, 'SMC PAPER ACCOUNT · $' + SM.start.toLocaleString(), SM.on ? (SM.paused ? 'PAUSED TODAY' : 'TRADING ON') : 'TRADING OFF');
  c.font = `800 52px ${FS}`; c.fillStyle = TXT; c.fillText(fmtMoney(eq), 16, 96);
  c.font = `700 22px ${FM}`; c.fillStyle = tone(eq - SM.start); c.fillText(`${fmtMoney(eq - SM.start, 1)}  ${fmtPct(st.ret, 2)}`, 16, 138);
  c.fillStyle = DIM; c.font = `500 17px ${FM}`; c.fillText(`${st.n} trades · win ${st.win == null ? '—' : st.win.toFixed(0) + '%'} · avg ${fmtR(st.avgR)} · max DD ${fmtPct(st.dd, 1)}`, 16, 172);
  const P = Object.entries(SM.pos);
  if (!P.length) {
    const ready = [...S.smC.entries()].filter(([, r]) => r.stage === 'mss' || r.stage === 'inzone').slice(0, 4);
    c.font = `600 18px ${FS}`; c.fillStyle = TXT; c.fillText(ready.length ? 'Waiting for a pullback into the zone:' : 'Flat. Waiting for a sweep + structure shift on a top-5 mover.', 16, 228);
    ready.forEach(([s, r], i) => { c.font = `700 18px ${FM}`; c.fillStyle = r.dir === 'L' ? UP : DN; c.fillText(`${base(s)} ${r.dir === 'L' ? 'long' : 'short'} · ${r.zone ? r.zone.kind + ' ' + fmtPx(r.zone.lo) + '–' + fmtPx(r.zone.hi) : 'no zone'} · ${r.score}/6`, 16, 264 + i * 34); });
  } else P.slice(0, 5).forEach(([s, p], i) => {
    const px = ptPx(s), y = 230 + i * 44, r = px ? smR(p, px) : 0;
    c.font = `800 22px ${FS}`; c.fillStyle = TXT; c.fillText(p.b, 16, y);
    c.font = `800 18px ${FS}`; c.fillStyle = p.side === 'L' ? UP : DN; c.fillText(p.side === 'L' ? 'LONG' : 'SHORT', 170, y);
    c.font = `600 18px ${FM}`; c.fillStyle = DIM; c.fillText(`${p.zoneKind} · target ${p.rr.toFixed(1)}R`, 270, y);
    c.fillStyle = tone(r); c.textAlign = 'right'; c.fillText(fmtR(r), 784, y); c.textAlign = 'left';
  });
  A.tex.needsUpdate = true;
  // second screen: the SMC read on the tracked coins (timeframe, higher timeframe, stage, quality)
  c = screenFrame(B, col, 'SMC READ · TRACKED COINS', '');
  const rank = r => ({inzone: 5, mss: 4, sweep: 3}[r.stage] || 0) * 1000 + (r.against ? -500 : 0) + ((r.q || {}).score || 0);
  const RD = [...S.smC.entries()].filter(([, r]) => ['inzone', 'mss', 'sweep'].includes(r.stage)).sort((x, y) => rank(y[1]) - rank(x[1])).slice(0, 8);
  c.font = `700 15px ${FS}`; c.fillStyle = DIM; [['COIN', 16], ['SETUP', 150], ['TF · HIGHER TF', 330], ['QUALITY', 600]].forEach(([t, x]) => c.fillText(t, x, 74));
  if (!RD.length) { c.font = `600 19px ${FS}`; c.fillStyle = DIM; c.fillText('No sweeps on the tracked coins right now.', 16, 120); }
  RD.forEach(([s, r], i) => {
    const y = 108 + i * 38, stg = {inzone: 'IN ZONE', mss: 'SHIFTED', sweep: 'SWEPT'}[r.stage] || String(r.stage || '').toUpperCase();
    c.font = `800 20px ${FS}`; c.fillStyle = TXT; c.fillText(base(s), 16, y);
    c.font = `700 17px ${FS}`; c.fillStyle = r.dir === 'L' ? UP : r.dir === 'S' ? DN : DIM; c.fillText(`${r.dir === 'L' ? 'long' : r.dir === 'S' ? 'short' : ''} ${stg}`.trim(), 150, y);
    c.font = `600 17px ${FM}`; c.fillStyle = r.against ? DN : DIM; c.fillText(`${r.tf || '15m'} · ${r.htf || '1h'} ${r.bias === 'bull' ? 'rising' : r.bias === 'bear' ? 'falling' : 'unclear'}${r.against ? ' ✗' : ''}`, 330, y);
    if (r.q) { c.font = `800 18px ${FM}`; c.fillStyle = GRADE_C[r.q.grade] || DIM; c.fillText(`${r.q.grade} ${r.q.score}`, 600, y); }
  });
  c.font = `500 14px ${FS}`; c.fillStyle = DIM; c.fillText(`Takes setups with quality ${smRules().minQ}+ and the higher timeframe not against them.`, 16, B.H - 18);
  B.tex.needsUpdate = true;
}
// 15m candles with the SMC drawing: swept level, sweep extreme, structure-shift level, entry zone, stop and target
function drawSmcChart(cv) {
  const s = cv.dataset.smc, r = S.smC.get(s) || smcRead(s), kb = smBars(s, r.tf || '15m'), k = kb ? {bars: kb} : null;
  const rc = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); cv.width = rc.width * dpr; cv.height = rc.height * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr); const W = rc.width, H = rc.height;
  c.fillStyle = '#060a14'; c.fillRect(0, 0, W, H);
  if (!k || k.bars.length < 20) { c.fillStyle = DIM; c.font = `500 12px ${FS}`; c.fillText('loading candles…', 10, H / 2); return; }
  const all = k.bars, off = Math.max(0, all.length - 56), B = all.slice(off), live = (S.tk.get(s) || {}).last || B[B.length - 1][4];
  const lv = [r.stop, r.target, r.setup && r.setup.ext].filter(fin);
  const PZ = r.poi && r.poi.zone, RZ_ = r.room && !r.room.clear ? r.room.zone : null;
  let lo = Math.min(...B.map(b => b[3]), ...lv), hi = Math.max(...B.map(b => b[2]), ...lv); const sp = hi - lo || hi * 0.01; lo -= sp * 0.05; hi += sp * 0.05;
  const pad = 64, bw = (W - pad - 8) / B.length, X = i => 4 + (i - off) * bw + bw / 2, Y = v => 8 + (hi - v) / (hi - lo) * (H - 22);
  const line = (v, col, label, dash) => { if (!fin(v)) return; c.strokeStyle = col; c.setLineDash(dash || []); c.lineWidth = 1.2; c.beginPath(); c.moveTo(4, Y(v)); c.lineTo(W - pad, Y(v)); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.font = `600 10.5px ${FM}`; c.fillText(label, W - pad + 4, Y(v) + 3); };
  const R = r.setup;
  // higher-timeframe zones: the point of interest the sweep came from, and the opposing zone in the way of the target
  const band = (z, col, lab) => { if (!z || z.hi < lo || z.lo > hi) return; const t0 = z.t || all[off][0]; let i0 = all.findIndex(b => b[0] >= t0); i0 = i0 < 0 ? off : Math.max(i0, off); const x0 = X(i0) - bw / 2; c.fillStyle = col; c.fillRect(x0, Y(Math.min(hi, z.hi)), W - pad - x0, Y(Math.max(lo, z.lo)) - Y(Math.min(hi, z.hi))); c.fillStyle = '#cdb7ff'; c.font = `700 10px ${FS}`; c.fillText(lab, x0 + 4, Y(Math.max(lo, z.lo)) - 3); };
  if (PZ) band(PZ, 'rgba(155,120,255,.13)', `${r.htf} ${PZ.side === 'D' ? 'demand' : 'supply'}${PZ.fresh ? ' (fresh)' : ''}`);
  if (RZ_) band(RZ_, 'rgba(255,181,71,.10)', `${r.htf} ${r.dir === 'L' ? 'supply' : 'demand'} in the way`);
  if (R && R.zone) { const x0 = X(Math.max(R.zone.i, off)) - bw / 2; c.fillStyle = r.dir === 'L' ? 'rgba(46,229,157,.16)' : 'rgba(255,92,122,.16)'; c.fillRect(x0, Y(R.zone.hi), W - pad - x0, Y(R.zone.lo) - Y(R.zone.hi)); c.fillStyle = r.dir === 'L' ? UP : DN; c.font = `700 10.5px ${FS}`; c.fillText(R.zone.kind, x0 + 4, Y(R.zone.hi) - 3); }
  B.forEach((b, i) => { const ix = i + off, up = b[4] >= b[1]; c.strokeStyle = c.fillStyle = up ? '#2ee59d' : '#ff5c7a'; c.beginPath(); c.moveTo(X(ix), Y(b[2])); c.lineTo(X(ix), Y(b[3])); c.stroke(); const y1 = Y(Math.max(b[1], b[4])), y2 = Y(Math.min(b[1], b[4])); c.fillRect(X(ix) - bw * 0.32, y1, bw * 0.64, Math.max(1, y2 - y1)); });
  if (R) {
    if (R.swept) line(R.swept.px, '#ffb547', 'swept', [4, 3]); else line(R.ext, '#ffb547', 'base', [4, 3]);
    if (R.swept && R.j >= off) { c.fillStyle = '#ffb547'; c.beginPath(); const yy = r.dir === 'L' ? Y(all[R.j][3]) + 8 : Y(all[R.j][2]) - 8; c.arc(X(R.j), yy, 3.5, 0, 7); c.fill(); }
    line(R.lvl.px, '#9ab0ff', R.type === 'cont' ? 'BOS' : R.k > 0 ? 'CHoCH' : 'shift lvl', [2, 3]);
  }
  if (r.PD) { if (fin(r.PD.pdh) && r.PD.pdh <= hi && r.PD.pdh >= lo) line(r.PD.pdh, '#b89cff', r.PD.hTaken ? 'PDH ✓' : 'PDH', [1, 4]); if (fin(r.PD.pdl) && r.PD.pdl <= hi && r.PD.pdl >= lo) line(r.PD.pdl, '#b89cff', r.PD.lTaken ? 'PDL ✓' : 'PDL', [1, 4]); }
  if (r.mit) band(Object.assign({t: null}, r.mit), 'rgba(127,209,255,.10)', 'mitigation block');
  if (r.path && fin(r.path.hr)) line(r.path.hr, '#ff9f43', 'HR ' + (r.dir === 'L' ? 'high' : 'low'), [3, 3]);
  if (r.conf && fin(r.conf.ref) && r.tf === '1h') line(r.conf.ref, '#ffd166', r.conf.ok ? '15m BOS ✓' : '15m BOS?', [2, 2]);
  if (r.stage === 'inzone' || r.stage === 'mss' || r.stage === 'confirm') { line(r.stop, DN, 'stop', [6, 3]); if (r.target) line(r.target, UP, 'target', [6, 3]); }
  line(live, TXT, fmtPx(live));
}
function smcStatus() {
  return `<div class="card2" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-left:4px solid ${SM.on ? (SM.paused ? WARN : UP) : DIM}">
    <span class="tag" style="color:var(--warn);border-color:var(--warn)">PAPER ACCOUNT · simulated fills, no real orders</span>
    <b style="color:${SM.on ? (SM.paused ? WARN : UP) : DIM}">${SM.on ? (SM.paused ? 'Paused today: ' + SM.paused : 'Trading is ON') : 'Trading is OFF'}</b>
    <span class="dim" style="font-size:12px">started ${new Date(SM.created).toLocaleDateString()} with $${SM.start.toLocaleString()} · same fees, slippage, 1% risk and unlock guard as the Trader</span>
    <button class="btn sm" style="margin-left:auto" data-sm="toggle">${SM.on ? 'Turn trading off' : 'Turn trading on'}</button></div>`;
}
function smcHTML(tab) {
  const st = smStats(), eq = smEquity(), k = (l, v, cl = '') => `<div class="kpi"><span>${l}</span><b class="${cl}">${v}</b></div>`;
  if (tab === 'cmp') return compareHTML();
  if (tab === 'coach') return smCoachHTML();
  if (tab === 'set') {
    const rows = Object.keys(S.trk).map(s => [s, S.smC.get(s) || smcRead(s)]).sort((a, b) => (b[1].st ? b[1].st.code : 0) - (a[1].st ? a[1].st.code : 0) || b[1].score - a[1].score);
    let h = `<p class="note">The SMC Trader reads every tracked top-5 gainer and loser on <b>15-minute and 1-hour candles</b>. A 15m setup is only taken if the <b>1h structure isn't against it</b>, and a 1h setup only if the <b>4h structure isn't against it</b> (no longs while the higher timeframe is falling, no shorts while it's rising). Each setup also gets a <b>quality score in SMC terms</b>: the sweep, the liquidity taken, the strength of the break, the FVG or order block, premium/discount, the higher timeframe and how deep into the zone the entry is. Setups under ${smRules().minQ}/100 are skipped.</p><p class="note"><b>Playbook from your SMC thesis (Nov 9):</b> it starts from the higher timeframe. A reversal is only taken from a <b>higher-timeframe point of interest</b> (a fresh 1h/4h demand or supply zone, or a 1h/4h swing that gets swept) unless the higher timeframe is already trending its way. A zone counts when it is the last opposite candle before an <b>impulsive departure</b> (1.5+ ATR within 3 candles, or an imbalance), stays valid until a candle closes through it, and is best on its <b>first retest</b>. 1h setups wait for <b>15m confirmation</b> (a 15m close through the last 15m swing inside the 1h zone, the thesis's 1:4 rule). The target must clear the <b>opposing</b> higher-timeframe zone; if that zone is closer than ${SM.cfg.minRR}R, it skips the trade.</p><p class="note"><b>Low- vs high-resistance liquidity (from the failure-swings lesson, Nov 9).</b> Between the entry and the target it looks at the swings in the way. <b>Failure swings</b> (for a long: highs that failed to beat the previous high; for a short: lows that failed to break the previous low) are low-resistance liquidity: price usually runs through them, so a path full of them is good. A swing that <b>ran the previous swing and was rejected</b> is high-resistance liquidity: price tends to stall there, so the target is put in front of it, and the trade is skipped if that leaves under ${SM.cfg.minRR}R. The sweep it trades from is itself a high-resistance swing on its own side, which is why the stop goes beyond it.</p><p class="note"><b>From the market-maker lessons (Nov 9):</b> <b>draw on liquidity</b> — on the higher timeframe, after an old low is taken or a bullish FVG is tagged price draws up to old highs, and the reverse; trades with the draw score higher. <b>Previous day high/low</b> are the easiest pools: they're added as targets, and sweeping one counts as strong liquidity. <b>Market cycle</b>: a reversal should follow an expansion or sweep the edge of a tight range (accumulation → manipulation → distribution); a turn straight out of consolidation is often a trap. <b>Mitigation block</b>: an entry zone inside a failed higher-timeframe zone of the other side is a bonus. <b>Breakaway gaps</b>: when the move leaves stacked gaps the newest may only be tested at its edge, so the "wait for the midpoint" rule doesn't apply. A higher-timeframe swing run in discount (long) or premium (short) counts as a key level, like a fresh zone.</p><p class="note"><b>Two kinds of setup.</b> <b>Reversal</b>: liquidity sweep → change of character → first pullback into the FVG or order block. <b>Continuation</b> (${SM.cfg.cont ? 'on' : 'off'}; rally-base-rally / drop-base-drop): only when the higher timeframe and the entry timeframe already trend the same way; price pauses in a base, breaks structure again with an impulsive move (1.5+ ATR), and it buys/sells the first pullback into the base or the gap the move left. Stop beyond the base.</p><p class="note">On each timeframe it waits for <b>liquidity to be swept</b> (a wick through a prior swing that closes back inside), then a <b>market structure shift</b> (a close through the last opposite swing). It marks the <b>fair value gap</b> or <b>order block</b> that move left behind, and enters on the <b>first pullback into it</b>. The stop goes beyond the sweep, and the target is the next liquidity pool, at least ${SM.cfg.minRR}R away. It also scores the setup on discount/premium, the higher-timeframe structure and volume.</p>`;
    if (!rows.length) return smcStatus() + h + '<div class="empty">No tracked movers yet.</div>';
    for (const [s, r] of rows) {
      const st2 = r.st || SMST.none, m = mget(s);
      h += `<div class="card2" style="margin-bottom:12px;border-left:4px solid ${st2.c}"><div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap"><span style="font-size:19px;font-weight:800">${esc(base(s))}</span><span class="mono ${cls(m.pct24)}">${fmtPct(m.pct24)} 24h</span>
        ${r.dir ? `<span class="tag" style="color:${r.dir === 'L' ? UP : DN}">${r.dir === 'L' ? 'bullish setup' : 'bearish setup'}</span>` : ''}${r.tf ? `<span class="tag">${r.tf} chart · ${r.htf} ${r.bias ? (r.bias === 'bull' ? 'rising' : 'falling') : 'unclear'}${r.against ? ' <b style="color:' + DN + '">· against</b>' : ''}</span>` : ''}${r.setup && r.setup.type === 'cont' ? `<span class="tag" style="color:#7fd1ff">continuation · ${r.dir === 'L' ? 'rally-base-rally' : 'drop-base-drop'}</span>` : ''}${r.poi ? `<span class="tag" style="color:${r.poi.ok === 2 ? '#b89cff' : r.poi.ok === 1 ? '#cfc2ff' : DIM}">${r.poi.ok === 2 ? `at a fresh ${r.htf} ${r.dir === 'L' ? 'demand' : 'supply'}` : r.poi.ok === 1 ? `at ${r.htf} ${r.poi.zone ? 'zone (tested)' : 'liquidity'}` : `no ${r.htf} zone`}</span>` : ''}${r.room && !r.room.clear ? `<span class="tag" style="color:${r.room.blocked ? DN : WARN}">${r.htf} ${r.dir === 'L' ? 'supply' : 'demand'} ${r.room.rr.toFixed(1)}R away${r.room.blocked ? ': no room' : ': target capped'}</span>` : ''}${r.draw && r.draw.draw ? `<span class="tag" style="color:${r.draw.draw === (r.dir === 'L' ? 'up' : 'down') ? UP : DN}" title="${esc(r.draw.ev)}">${r.htf} draw ${r.draw.draw}</span>` : ''}${r.pdSwept ? `<span class="tag" style="color:#b89cff">swept previous day ${r.dir === 'L' ? 'low' : 'high'}</span>` : r.pdTarget ? `<span class="tag" style="color:#b89cff">target: previous day ${r.dir === 'L' ? 'high' : 'low'}</span>` : ''}${r.mit ? `<span class="tag" style="color:#b89cff">mitigation block</span>` : ''}${r.cyc && r.cyc.amd ? `<span class="tag" style="color:#7fd1ff">AMD</span>` : ''}${r.path ? `<span class="tag" style="color:${r.path.blocked ? DN : r.path.capped ? WARN : r.path.fs >= 2 ? UP : DIM}">${r.path.blocked ? `high-resistance ${r.dir === 'L' ? 'high' : 'low'} ${r.path.rr.toFixed(1)}R away: no path` : r.path.capped ? `target before a high-resistance ${r.dir === 'L' ? 'high' : 'low'}` : r.path.fs >= 2 ? `low-resistance path · ${r.path.fs} failure swings` : `${r.path.fs} failure swing${r.path.fs === 1 ? '' : 's'} on the path`}</span>` : ''}${r.stage === 'confirm' && r.conf ? `<span class="tag" style="color:#ffd166">${esc(r.conf.why || '')}</span>` : ''}${r.q ? `<span class="tag" style="color:${GRADE_C[r.q.grade]}" title="${esc(r.q.items.map(i => (i.ok === 2 ? '✓ ' : i.ok === 1 ? '· ' : '✗ ') + i.t).join('\n'))}">quality ${r.q.grade} · ${r.q.score}/100</span>` : ''}<span style="margin-left:auto;font-weight:800;color:${st2.c}">${st2.l}</span>${r.checks.length ? `<span class="mono dim">${r.score}/6</span>` : ''}</div>
        <div class="grid2" style="grid-template-columns:1.2fr 1fr;gap:14px;margin-top:8px"><canvas data-smc="${s}" style="width:100%;height:210px;display:block;border-radius:8px;border:1px solid var(--line)"></canvas>
        <div>${r.checks.map(x => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${x.ok === true ? UP : x.ok === false ? DN : DIM}">${x.ok === true ? '✓' : x.ok === false ? '✗' : '·'}</span><span style="font-size:12px">${x.label}</span><span class="d">${esc(x.d)}</span></div>`).join('') || '<span class="dim" style="font-size:12px">No sweep of a swing high or low in the last 8 hours.</span>'}
        ${r.stage === 'inzone' || r.stage === 'mss' ? `<div class="mono" style="font-size:12px;margin-top:8px">stop ${fmtPx(r.stop)} (${(r.dist * 100).toFixed(1)}%) · target ${r.target ? fmtPx(r.target) + ' (' + r.rr.toFixed(1) + 'R)' : 'none ≥ ' + SM.cfg.minRR + 'R'}</div>` : ''}</div></div></div>`;
    }
    return smcStatus() + h;
  }
  if (tab === 'log') {
    const L = SM.log;
    if (!L.length) return smcStatus() + '<div class="empty">No closed SMC trades yet.</div>';
    return smcStatus() + `<table class="t"><thead><tr><th>Opened</th><th>Coin</th><th>Side</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Planned</th><th>Grade</th><th style="text-align:left">Setup → exit</th></tr></thead><tbody>${L.slice(0, 200).map(x => { const g = rvGrade(x); return `<tr data-sym="${x.s}"><td class="dim">${new Date(x.t0).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</td><td class="sym">${esc(x.b)}</td><td class="${x.side === 'L' ? 'up' : 'dn'}">${x.side === 'L' ? 'LONG' : 'SHORT'}</td><td>${fmtPx(x.entry)}</td><td>${fmtPx(x.exit)}</td><td class="${cls(x.pnl)}">${fmtMoney(x.pnl, 1)}</td><td class="${cls(x.R)}">${fmtR(x.R)}</td><td class="dim">${x.rr ? x.rr.toFixed(1) + 'R' : '—'}</td><td><b style="color:${GRADE_C[g.g]}">${g.g}</b></td><td style="text-align:left;white-space:normal;min-width:280px;font-family:var(--sans);font-size:12px">${esc(x.why)}<br><span class="dim">→ ${esc(x.exitWhy)}</span></td></tr>`; }).join('')}</tbody></table>`;
  }
  if (tab === 'rules') {
    const f = (key, label, step, min, max) => `<label>${label}<input type="number" data-smcfg="${key}" step="${step}" min="${min}" max="${max}" value="${SM.cfg[key]}"></label>`;
    return smcStatus() + `<div style="margin-bottom:14px">${rulesCardHTML('sm')}</div><div class="grid2"><div class="card2"><h3>HOW THE SMC TRADER TRADES</h3>
      <div class="chk"><span class="i up">1</span><span><b>Same coins as the Trader</b>: the tracked top-5 gainers and losers. Either direction, whichever setup the chart shows.</span></div>
      <div class="chk"><span class="i up">2</span><span><b>Liquidity sweep</b>: a 15m wick takes out a prior swing low (sell-side stops) or swing high (buy-side stops) and closes back inside, within the last 8 hours.</span></div>
      <div class="chk"><span class="i up">3</span><span><b>Market structure shift</b>: after the sweep, a candle closes through the last opposite swing (CHoCH).</span></div>
      <div class="chk"><span class="i up">4</span><span><b>Entry zone</b>: the newest fair value gap in that move, or the order block if there's no gap. It enters on the <b>first</b> pullback into the zone, and drops the setup if price closes through it.</span></div>
      <div class="chk"><span class="i up">5</span><span><b>Confluence ≥ ${SM.cfg.minScore}/6</b>: sweep ✓, shift ✓, FVG rather than OB, entry in discount (longs) or premium (shorts), 1h structure aligned, displacement on volume.</span></div>
      <div class="chk"><span class="i up">6</span><span><b>Stop</b> ${SM.cfg.stopBuf}% beyond the sweep extreme. <b>Target</b>: the nearest liquidity pool (an untaken swing or the 24h high/low) at least ${SM.cfg.minRR}R away, capped at ${SM.cfg.maxRR}R. Skips the trade if no pool is far enough, or if the stop is under 0.6% (fees) or over ${SM.cfg.maxStopPct}% away.</span></div>
      <div class="chk"><span class="i up">7</span><span><b>Management</b>: half off at +${SM.cfg.tp1R}R, stop to breakeven, then the stop trails behind each new confirmed 15m swing. Full exit at the target or after ${SM.cfg.holdH} h.</span></div>
      <div class="chk"><span class="i up">8</span><span><b>Same guardrails as the Trader</b>: ${SM.cfg.riskPct}% risk per trade, ${SM.cfg.maxLev}× leverage cap, ${SM.cfg.maxPos} positions, ${SM.cfg.dailyLossPct}% daily loss limit, ${fmtUsd(SM.cfg.minVol)} minimum volume, and the token unlock guard. No Reviewer: its rules stay fixed so the comparison is clean.</span></div></div>
      <div class="card2"><h3>SETTINGS</h3><div class="set" style="grid-template-columns:1fr 1fr">
      ${f('riskPct', 'Risk per trade (% of equity)', 0.25, 0.25, 5)}${f('maxPos', 'Max open positions', 1, 1, 10)}
      ${f('minScore', 'Min confluences (of 6)', 1, 2, 6)}${f('minRR', 'Min reward : risk to target', 0.5, 1, 6)}
      ${f('maxRR', 'Cap target at (R)', 0.5, 2, 10)}${f('tp1R', 'Take half at (R)', 0.1, 0.5, 5)}
      ${f('stopBuf', 'Stop buffer beyond sweep (%)', 0.1, 0, 3)}${f('holdH', 'Max hold, 15m setups (hours)', 1, 1, 72)}${f('holdH1h', 'Max hold, 1h setups (hours)', 1, 4, 120)}${f('minQ', 'Min setup quality (0–100)', 5, 0, 95)}
      <label>15m setups (1h must not be against)<select data-smcfg="tf15"><option value="1" ${SM.cfg.tf15 ? 'selected' : ''}>On</option><option value="0" ${SM.cfg.tf15 ? '' : 'selected'}>Off</option></select></label>
      <label>1h setups (4h must not be against)<select data-smcfg="tf1h"><option value="1" ${SM.cfg.tf1h ? 'selected' : ''}>On</option><option value="0" ${SM.cfg.tf1h ? '' : 'selected'}>Off</option></select></label>
      <label>Continuation setups (with the trend)<select data-smcfg="cont"><option value="1" ${SM.cfg.cont ? 'selected' : ''}>On: rally-base-rally / drop-base-drop when the higher timeframe agrees</option><option value="0" ${SM.cfg.cont ? '' : 'selected'}>Off: reversals only</option></select></label>
      <label>When the entry gap fails<select data-smcfg="invExit"><option value="1" ${SM.cfg.invExit ? 'selected' : ''}>Exit when a candle closes through it</option><option value="0" ${SM.cfg.invExit ? '' : 'selected'}>Hold to the stop</option></select></label>
      <label>Previous day high/low<select data-smcfg="pdLiq"><option value="1" ${SM.cfg.pdLiq ? 'selected' : ''}>Use as liquidity targets and sweeps</option><option value="0" ${SM.cfg.pdLiq ? '' : 'selected'}>Ignore</option></select></label>
      <label>Path to the target<select data-smcfg="pathCheck"><option value="1" ${SM.cfg.pathCheck ? 'selected' : ''}>Target in front of high-resistance swings; skip if under ${SM.cfg.minRR}R</option><option value="0" ${SM.cfg.pathCheck ? '' : 'selected'}>Ignore</option></select></label>
      <label>Higher-timeframe zone (POI)<select data-smcfg="poiRule"><option value="1" ${SM.cfg.poiRule ? 'selected' : ''}>Needed when the higher timeframe isn't trending my way</option><option value="0" ${SM.cfg.poiRule ? '' : 'selected'}>Score it only</option></select></label>
      <label>1h setups: 15m confirmation<select data-smcfg="ltfConfirm"><option value="1" ${SM.cfg.ltfConfirm ? 'selected' : ''}>Wait for a 15m structure shift in the zone</option><option value="0" ${SM.cfg.ltfConfirm ? '' : 'selected'}>Enter on the first touch</option></select></label>
      <label>Room to the target<select data-smcfg="roomCheck"><option value="1" ${SM.cfg.roomCheck ? 'selected' : ''}>Cap at the opposing zone; skip if under ${SM.cfg.minRR}R</option><option value="0" ${SM.cfg.roomCheck ? '' : 'selected'}>Ignore opposing zones</option></select></label>
      <label>Learn from the SMC review<select data-smcfg="learn"><option value="1" ${SM.cfg.learn ? 'selected' : ''}>On: apply the Reviewer's SMC rules</option><option value="0" ${SM.cfg.learn ? '' : 'selected'}>Off</option></select></label>
      ${f('dailyLossPct', 'Daily loss limit (%)', 0.5, 0.5, 20)}${f('minVol', 'Min 24h volume (USD)', 50000, 0, 1e8)}
      ${f('minStopPct', 'Stop never closer than (%)', 0.1, 0, 5)}${f('minDepth', 'Enter at least this far into the zone (%)', 5, 0, 50)}${f('maxStopPct', 'Skip if stop farther than (%)', 1, 3, 40)}${f('maxLev', 'Max total leverage (×)', 0.5, 0.5, 10)}
      <label>Use the Reviewer's screens<select data-smcfg="useScreens"><option value="0" ${SM.cfg.useScreens ? '' : 'selected'}>Off: own SMC judgement</option><option value="1" ${SM.cfg.useScreens ? 'selected' : ''}>On: skip coins that fail them</option></select></label></div>
      <p class="note" style="margin-top:10px">Keep risk, fees and slippage equal to the Trader's for a fair comparison.</p>
      <div style="margin-top:12px"><button class="btn sm ghost" data-sm="reset">${SM._arm ? 'Click again to reset to $1,000' : 'Reset SMC account to $1,000'}</button></div></div></div>`;
  }
  // account
  const P = Object.entries(SM.pos);
  const scan = SM.lastScan && SM.lastScan.cands && SM.lastScan.cands.length ? SM.lastScan.cands.map(x => `<div class="chk" style="padding:3px 0"><span class="i ${x.took ? 'up' : 'dim'}">${x.took ? '✓' : '·'}</span><span><b>${esc(x.b)}</b> <span class="dim">${x.side === 'L' ? 'long' : 'short'} · ${x.tf ? x.tf + ' · ' : ''}${x.zone} · ${x.score}/6${x.q ? ' · quality ' + x.q : ''}${x.rr ? ' · ' + x.rr.toFixed(1) + 'R' : ''}</span></span><span class="d">${x.took ? 'entered' : esc(x.skip)}</span></div>`).join('') : '<span class="dim" style="font-size:12px">No tracked mover is pulling back into a fresh zone right now. See "Setups now".</span>';
  return smcStatus() + `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${k('Equity', fmtMoney(eq))}${k('Total P&L', `${fmtMoney(eq - SM.start, 1)} (${fmtPct(st.ret, 2)})`, cls(eq - SM.start))}${k('Today', fmtMoney(SM.day ? eq - SM.day.eq0 : 0, 1), cls(SM.day ? eq - SM.day.eq0 : 0))}${k('Open', `${P.length} / ${SM.cfg.maxPos}`)}${k('Closed trades', st.n)}${k('Win rate', st.win == null ? '—' : st.win.toFixed(0) + '%')}${k('Avg result', fmtR(st.avgR), cls(st.avgR))}${k('Max drawdown', fmtPct(st.dd, 1), st.dd < 0 ? 'dn' : '')}</div>
  <div class="card2" style="margin-top:14px"><h3>OPEN POSITIONS</h3>${P.length ? `<table class="t"><thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>Now</th><th>Stop</th><th>Target</th><th>P&amp;L</th><th>R</th><th style="text-align:left">Setup</th><th></th></tr></thead><tbody>${P.map(([s, p]) => { const px = ptPx(s), u = px ? smUpnl(p, px) + p.realized : 0, r = px ? smR(p, px) : 0; return `<tr data-sym="${s}"><td class="sym">${esc(p.b)}</td><td class="${p.side === 'L' ? 'up' : 'dn'}">${p.side === 'L' ? 'LONG' : 'SHORT'}</td><td>${fmtPx(p.entry)}</td><td>${fmtPx(px)}</td><td>${fmtPx(p.stop)}${p.trail ? ' <span class="dim">trail</span>' : p.be ? ' <span class="dim">BE</span>' : ''}</td><td>${fmtPx(p.target)}</td><td class="${cls(u)}">${fmtMoney(u, 1)}</td><td class="${cls(r)}">${fmtR(r)}</td><td style="text-align:left;white-space:normal;min-width:240px;font-family:var(--sans);font-size:12px">${esc(p.why)}</td><td><span class="chip" data-sm-close="${s}">close</span></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty" style="padding:14px">Flat.</div>'}</div>
  <div class="grid2" style="margin-top:14px"><div class="card2"><h3>LAST SCAN · ${SM.lastScan ? ago(SM.lastScan.t) + ' ago' : '—'}</h3>${scan}</div>
  <div class="card2"><h3>EQUITY · TRADER vs SMC</h3><canvas class="cmpchart" style="width:100%;height:190px;display:block"></canvas></div></div>`;
}
function compareHTML() {
  const a = acctStats(PT, ptEquity()), b = acctStats(SM, smEquity()), v = compareVerdict(a, b);
  const row = (label, fa, fb, better, hint) => { const x = fa(a), y = fb(b), w = better(a, b); return `<tr><td style="text-align:left;font-family:var(--sans)">${label}${hint ? `<br><span class="dim" style="font-size:11px">${hint}</span>` : ''}</td><td style="${w === 1 ? 'color:#ffd166;font-weight:800' : ''}">${x}</td><td style="${w === 2 ? `color:${SMCOL};font-weight:800` : ''}">${y}</td></tr>`; };
  const cmp = (f, lowerBetter) => (a, b) => { const x = f(a), y = f(b); if (!fin(x) || !fin(y) || x === y || a.n < 3 || b.n < 3) return 0; return (lowerBetter ? x < y : x > y) ? 1 : 2; };
  return `<p class="note">Both traders started with $1,000, trade the same top-5 movers, and use the same 1% risk, fees, slippage and unlock guard. Only the entry and exit logic differs. Stability is about the <b>shape</b> of the curve, not just the return: how deep the drops are, how much results swing from trade to trade, and how long each account spends below its high.</p>
  <div class="card2" style="margin-bottom:14px;border-left:4px solid ${v.who === 'Trader' ? '#ffd166' : v.who ? SMCOL : DIM}"><b>${esc(v.t)}</b></div>
  <div class="grid2"><div class="card2"><h3>EQUITY, % FROM $1,000</h3><canvas class="cmpchart" style="width:100%;height:260px;display:block"></canvas></div>
  <div class="card2"><h3>STABILITY SCORECARD</h3><table class="t"><thead><tr><th style="text-align:left">Measure</th><th style="color:#ffd166">Trader</th><th style="color:${SMCOL}">SMC Trader</th></tr></thead><tbody>
    ${row('Return', x => fmtPct(x.ret, 2), x => fmtPct(x.ret, 2), cmp(x => x.ret))}
    ${row('Max drawdown', x => fmtPct(x.dd, 1), x => fmtPct(x.dd, 1), cmp(x => -x.dd, true), 'smaller is steadier')}
    ${row('Return ÷ drawdown', x => fin(x.retDD) ? x.retDD.toFixed(2) : '—', x => fin(x.retDD) ? x.retDD.toFixed(2) : '—', cmp(x => x.retDD))}
    ${row('Closed trades', x => x.n, x => x.n, () => 0)}
    ${row('Win rate', x => x.win == null ? '—' : x.win.toFixed(0) + '%', x => x.win == null ? '—' : x.win.toFixed(0) + '%', cmp(x => x.win))}
    ${row('Average R per trade', x => fmtR(x.avgR), x => fmtR(x.avgR), cmp(x => x.avgR))}
    ${row('Spread of results (R std. dev.)', x => fin(x.sdR) ? x.sdR.toFixed(2) + 'R' : '—', x => fin(x.sdR) ? x.sdR.toFixed(2) + 'R' : '—', cmp(x => x.sdR, true), 'lower = more predictable')}
    ${row('Consistency (avg R ÷ spread)', x => fin(x.cons) ? x.cons.toFixed(2) : '—', x => fin(x.cons) ? x.cons.toFixed(2) : '—', cmp(x => x.cons))}
    ${row('Profit factor', x => x.pf == null ? '—' : x.pf === Infinity ? '∞' : x.pf.toFixed(2), x => x.pf == null ? '—' : x.pf === Infinity ? '∞' : x.pf.toFixed(2), cmp(x => x.pf === Infinity ? 99 : x.pf))}
    ${row('Worst trade', x => fmtR(x.worst), x => fmtR(x.worst), cmp(x => x.worst))}
    ${row('Longest losing streak', x => x.n ? x.streak : '—', x => x.n ? x.streak : '—', cmp(x => x.streak, true))}
    ${row('Time spent below the high', x => x.underPct.toFixed(0) + '%', x => x.underPct.toFixed(0) + '%', cmp(x => x.underPct, true))}
    ${row('Longest stretch below the high', x => x.longestH.toFixed(1) + ' h', x => x.longestH.toFixed(1) + ' h', cmp(x => x.longestH, true))}
  </tbody></table><p class="note" style="margin-top:8px">The better value is highlighted once each side has 3+ trades. The verdict waits for 15 each. Note: the Trader's rules are tuned by the Reviewer, while the SMC Trader's stay fixed.</p></div></div>`;
}
document.getElementById('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-sm]'), c = e.target.closest('[data-sm-close]');
  if (!b && !c) return; e.stopPropagation();
  if (syBlock()) return;
  if (c) { smClose(c.dataset.smClose, 1, 'closed by you'); smSave(); renderPanel(); return; }
  if (b.dataset.sm === 'toggle') { SM.on = !SM.on; sayFor('smc', SM.on ? 'SMC trading on. Waiting for sweeps and structure shifts.' : 'SMC trading off. Open positions are still managed.'); }
  if (b.dataset.sm === 'reset') { if (SM._arm) { SM._arm = false; smReset(); sayFor('smc', 'SMC account reset to $1,000.'); } else { SM._arm = true; setTimeout(() => { SM._arm = false; }, 6000); } }
  smSave(); renderPanel();
}, true);
document.getElementById('panel').addEventListener('change', e => {
  const i = e.target.closest('[data-smcfg]'); if (!i) return;
  if (syBlock()) { i.value = SM.cfg[i.dataset.smcfg]; return; }
  const v = +i.value; if (fin(v)) { SM.cfg[i.dataset.smcfg] = v; smSave(); }
});

/* ---- back (south) wall: the SMC Trader's open positions, each on its own setup's chart ---- */
function drawSmWall() {
  if (typeof SWALL === 'undefined') return;
  const T = SWALL, c = T.ctx, W = T.W, H = T.H, st = smStats(), eq = smEquity(), pnl = eq - SM.start;
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1a0f22'; c.fillRect(0, 0, W, 84); c.fillStyle = SMCOL; c.fillRect(0, 82, W, 3);
  c.textBaseline = 'middle'; c.font = `800 44px ${FS}`; c.fillStyle = SMCOL; c.fillText('SMC TRADER · OPEN POSITIONS', 30, 42);
  const tw = c.measureText('SMC TRADER · OPEN POSITIONS').width; c.font = `700 22px ${FS}`; const tagW = c.measureText('PAPER ACCOUNT').width + 28;
  c.fillStyle = SMCOL; rr(c, 60 + tw, 24, tagW, 38, 19); c.fill(); c.fillStyle = '#04070f'; c.fillText('PAPER ACCOUNT', 74 + tw, 44);
  c.textAlign = 'right'; c.font = `700 32px ${FM}`;
  c.fillStyle = TXT; c.fillText(`Equity ${fmtMoney(eq)}`, W - 1060, 44);
  c.fillStyle = tone(pnl); c.fillText(`${fmtMoney(pnl, 1)} (${fmtPct(pnl / SM.start * 100, 2)})`, W - 600, 44);
  const nOpen = Object.keys(SM.pos).length;
  c.fillStyle = DIM; c.font = `600 26px ${FM}`; c.fillText(`${nOpen}/${SM.cfg.maxPos} open · ${SM.log.length} closed · ${SM.on ? 'ON' : 'OFF'}  ${clock()}`, W - 30, 44);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const P = Object.entries(SM.pos).sort((a, b) => a[1].t - b[1].t), top = 100, bh = H - top - 16;
  if (!P.length) {
    c.font = `800 52px ${FS}`; c.fillStyle = TXT; c.fillText('Flat — no open SMC positions', 40, top + 70);
    const best = [...S.smC.entries()].map(([s, r]) => Object.assign({s}, r)).filter(r => r.dir && !r.against && ['inzone', 'mss', 'sweep'].includes(r.stage)).sort((a, b) => ((b.q || {}).score || 0) - ((a.q || {}).score || 0))[0];
    c.font = `500 26px ${FS}`; c.fillStyle = DIM;
    wrapText(c, `Waiting for a sweep → structure shift → first pullback into the FVG or order block, on the 15m (1h not against it) or the 1h (4h not against it), quality ${smRules().minQ}/100 or better.` + (best ? ` Closest now: ${base(best.s || '')} ${best.tf} — ${(SMST[best.stage] || {}).l || best.stage}${best.q ? ', quality ' + best.q.grade : ''}.` : ''), 40, top + 118, 1480, 32, 3);
    c.font = `700 22px ${FS}`; c.fillStyle = DIM; c.fillText('EQUITY · SMC vs TRADER (% from $1,000)', 40, top + 236);
    drawCmp(c, 40, top + 252, 1480, bh - 262, 22);
    c.font = `700 26px ${FM}`; c.fillStyle = DIM; c.fillText('LAST SMC TRADES', 1640, top + 40);
    SM.log.slice(0, 7).forEach((x, i) => {
      const y = top + 90 + i * 58; c.font = `800 32px ${FS}`; c.fillStyle = TXT; c.fillText(x.b, 1640, y);
      c.font = `700 24px ${FS}`; c.fillStyle = x.side === 'L' ? UP : DN; c.fillText((x.side === 'L' ? 'LONG' : 'SHORT') + (x.tf ? ' ' + x.tf : ''), 1880, y);
      c.font = `700 30px ${FM}`; c.fillStyle = tone(x.pnl); c.textAlign = 'right'; c.fillText(`${fmtMoney(x.pnl, 1)}   ${x.R >= 0 ? '+' : ''}${x.R.toFixed(2)}R`, W - 40, y); c.textAlign = 'left';
      c.font = `500 20px ${FS}`; c.fillStyle = DIM; c.fillText(String(x.exitWhy).slice(0, 44), 2090, y);
    });
    if (!SM.log.length) { c.font = `500 28px ${FS}`; c.fillStyle = DIM; c.fillText('No closed trades yet.', 1640, top + 90); }
    T.tex.needsUpdate = true; return;
  }
  const shown = P.slice(0, 3), n = shown.length, colW = W / n, infoW = n === 1 ? 900 : n === 2 ? 640 : 470, sc = n === 3 ? 1 : 1.15;
  shown.forEach(([s, p], i) => {
    const x0 = i * colW, px = ptPx(s), u = px ? smUpnl(p, px) + p.realized : null, r = px ? smR(p, px) : null, L = p.side === 'L', tf = p.tf || '15m';
    if (i) { c.fillStyle = 'rgba(255,138,216,.25)'; c.fillRect(x0, top, 2, bh); }
    const ix = x0 + 26;
    c.font = `800 ${Math.round(56 * sc)}px ${FS}`; c.fillStyle = TXT; c.fillText(p.b, ix, top + 58);
    const nw = c.measureText(p.b).width; c.font = `800 ${Math.round(26 * sc)}px ${FS}`; c.fillStyle = L ? UP : DN; c.fillText(`${L ? 'LONG' : 'SHORT'} · ${tf} ${p.type === 'cont' ? (L ? 'RBR ' : 'DBD ') : ''}${p.zoneKind || ''}`, ix + nw + 18, top + 56);
    c.font = `800 ${Math.round(46 * sc)}px ${FM}`; c.fillStyle = tone(u); c.fillText(fmtMoney(u, 1), ix, top + 124);
    c.font = `700 ${Math.round(30 * sc)}px ${FM}`; c.fillText(r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`, ix, top + 166);
    if (p.q) { const gx = ix + Math.round(170 * sc); c.fillStyle = GRADE_C[p.q.grade] || DIM; c.font = `800 ${Math.round(26 * sc)}px ${FS}`; c.fillText(`quality ${p.q.grade} · ${p.q.score}`, gx, top + 166); }
    const htf = (SM_TF[tf] || SM_TF['15m']).htf;
    const rows = [['Entry', fmtPx(p.entry)], ['Now', fmtPx(px)], [p.trail ? 'Trail stop' : p.be ? 'Stop (BE)' : 'Stop', fmtPx(p.stop)], ['Target', fmtPx(p.target)], ['Held', ago(p.t)], [htf + ' at entry', p.htfBias === 'bull' ? 'rising' : p.htfBias === 'bear' ? 'falling' : 'unclear']];
    c.font = `500 ${Math.round(24 * sc)}px ${FM}`;
    rows.forEach(([k, v], j) => { const y = top + 214 + j * Math.round(34 * sc); c.fillStyle = DIM; c.fillText(k, ix, y); c.fillStyle = /top/.test(k) ? DN : k === 'Target' ? UP : TXT; c.textAlign = 'right'; c.fillText(v, x0 + infoW - 16, y); c.textAlign = 'left'; });
    c.font = `500 ${Math.round(19 * sc)}px ${FS}`; c.fillStyle = '#d9c2d2';
    wrapText(c, (p.tp1 ? 'Half banked · ' : '') + p.why, ix, top + 214 + 6 * Math.round(34 * sc) + 8, infoW - 40, Math.round(25 * sc), 3);
    const B = smBars(s, tf), rrT = Math.abs(p.target - p.entry) / (Math.abs(p.entry - p.stop0) || 1);
    drawPosChart(c, s, p, x0 + infoW, top + 6, colW - infoW - 20, bh - 12, {bars: B && B.length ? B : null, target: p.target, tLab: `${rrT.toFixed(1)}R`, zone: p.zone, foot: `${tf} · last ${tf === '1h' ? '36h' : '9h'} · zone shaded`});
  });
  if (P.length > 3) { c.font = `700 26px ${FS}`; c.fillStyle = WARN; c.textAlign = 'right'; c.fillText(`+${P.length - 3} more open — see the SMC desk`, W - 30, H - 24); c.textAlign = 'left'; }
  T.tex.needsUpdate = true;
}

/* ---- north wall, left of the movers board: the return race, Trader vs SMC Trader ---- */
function drawRace() {
  if (typeof RACE === 'undefined') return;
  const T = RACE, c = T.ctx, W = T.W, H = T.H, a = acctStats(PT, ptEquity()), b = smStats(), ea = ptEquity(), eb = smEquity();
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0a1226'; c.fillRect(0, 0, W, 62);
  c.textBaseline = 'middle'; c.font = `800 34px ${FS}`; c.fillStyle = '#cfe0ff'; c.fillText('RETURN RACE', 24, 32);
  c.font = `600 22px ${FM}`; c.fillStyle = DIM; c.textAlign = 'right'; c.fillText(`paper · from $1,000 each   ${clock()}`, W - 24, 32); c.textAlign = 'left';
  // the two scores
  const lead = a.ret === b.ret ? null : a.ret > b.ret ? 'a' : 'b';
  [[a, ea, 'TRADER', '#ffd166', 'a', 24], [b, eb, 'SMC TRADER', SMCOL, 'b', W / 2 + 12]].forEach(([s, eq, name, col, k, x]) => {
    const w = W / 2 - 36;
    c.fillStyle = 'rgba(255,255,255,.03)'; rr(c, x, 80, w, 196, 14); c.fill();
    c.fillStyle = col; c.fillRect(x, 80, 6, 196);
    c.font = `800 26px ${FS}`; c.fillStyle = col; c.fillText(name, x + 24, 112);
    if (lead === k) { c.font = `800 18px ${FS}`; const lw = c.measureText('LEADING').width + 22; c.fillStyle = col; rr(c, x + w - lw - 16, 96, lw, 32, 16); c.fill(); c.fillStyle = '#04070f'; c.fillText('LEADING', x + w - lw - 5, 113); }
    c.font = `800 72px ${FM}`; c.fillStyle = tone(s.ret); c.fillText(fmtPct(s.ret, 2), x + 22, 176);
    c.font = `700 26px ${FM}`; c.fillStyle = TXT; c.fillText(fmtMoney(eq), x + 24, 232);
    c.fillStyle = tone(eq - 1000); c.fillText(fmtMoney(eq - (k === 'a' ? PT.start : SM.start), 1), x + 24 + c.measureText(fmtMoney(eq)).width + 24, 232);
    c.font = `500 20px ${FM}`; c.fillStyle = DIM; c.fillText(`${s.n} trades · ${Object.keys((k === 'a' ? PT : SM).pos).length} open`, x + 24, 262);
  });
  // both equity curves
  c.textBaseline = 'alphabetic';
  drawCmp(c, 24, 296, W - 48, 250, 20);
  // the stats side by side
  const rows = [['Win rate', s => s.win == null ? '—' : s.win.toFixed(0) + '%', 1], ['Avg R per trade', s => fmtR(s.avgR), 1], ['Max drawdown', s => fmtPct(s.dd, 1), 1], ['Return ÷ drawdown', s => s.retDD == null ? '—' : s.retDD.toFixed(2), 1], ['Worst losing streak', s => s.streak + '', -1], ['Profit factor', s => s.pf == null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2), 1]];
  const y0 = 588, rh = 34;
  c.font = `700 18px ${FS}`; c.fillStyle = DIM; c.fillText('', 24, y0 - 8); c.textAlign = 'right'; c.fillStyle = '#ffd166'; c.fillText('TRADER', W - 300, y0 - 10); c.fillStyle = SMCOL; c.fillText('SMC', W - 40, y0 - 10); c.textAlign = 'left';
  rows.forEach(([k, f], i) => {
    const y = y0 + 22 + i * rh; if (i % 2 === 0) { c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(24, y - 24, W - 48, rh); }
    c.font = `500 22px ${FS}`; c.fillStyle = DIM; c.fillText(k, 36, y);
    c.font = `700 22px ${FM}`; c.textAlign = 'right'; c.fillStyle = TXT; c.fillText(f(a), W - 300, y); c.fillText(f(b), W - 40, y); c.textAlign = 'left';
  });
  const v = compareVerdict(a, b);
  c.font = `600 20px ${FS}`; c.fillStyle = v.who === 'Trader' ? '#ffd166' : v.who ? SMCOL : '#aab6d4';
  wrapText(c, v.t, 24, y0 + 22 + rows.length * rh + 18, W - 48, 26, 2);
  T.tex.needsUpdate = true;
}
