/* ================= TRADER: screens + panel ================= */
TABS.trader = [['acct', 'Account'], ['log', 'Trade log'], ['rules', 'Rules & settings']];
function drawEq(c, x, y, w, h, fs = 12) {
  const pts = PT.eqs.concat([[now(), ptEquity()]]);
  c.save(); c.translate(x, y);
  if (pts.length < 2) { c.fillStyle = DIM; c.font = `500 ${fs + 2}px ${FS}`; c.textAlign = 'center'; c.fillText('equity curve starts with the first trades', w / 2, h / 2); c.restore(); c.textAlign = 'left'; return; }
  let lo = Math.min(PT.start, ...pts.map(p => p[1])), hi = Math.max(PT.start, ...pts.map(p => p[1])); const sp = (hi - lo) || 10; lo -= sp * 0.1; hi += sp * 0.1;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1, pad = 56;
  const X = t => 6 + (t - t0) / ((t1 - t0) || 1) * (w - pad - 10), Y = v => 8 + (hi - v) / (hi - lo) * (h - 24);
  c.strokeStyle = 'rgba(124,137,168,.35)'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(6, Y(PT.start)); c.lineTo(w - pad, Y(PT.start)); c.stroke(); c.setLineDash([]);
  const last = pts[pts.length - 1][1]; c.strokeStyle = last >= PT.start ? UP : DN; c.lineWidth = 2; c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke();
  c.fillStyle = DIM; c.font = `500 ${fs}px ${FM}`; c.textBaseline = 'middle';
  c.fillText('$' + Math.round(hi), w - pad + 4, 12); c.fillText('$' + Math.round(lo), w - pad + 4, h - 14); c.fillText('$' + PT.start, w - pad + 4, Y(PT.start));
  c.restore(); c.textAlign = 'left';
}
function drawTraderScreens(d) {
  const [A, B] = d.mons, st = ptStats(), col = d.a.color;
  let c = screenFrame(A, col, 'PAPER ACCOUNT · $' + PT.start.toLocaleString(), PT.on ? (PT.paused ? 'PAUSED TODAY' : 'TRADING ON') : 'TRADING OFF');
  c.font = `800 52px ${FS}`; c.fillStyle = TXT; c.fillText(fmtMoney(st.eq), 16, 96);
  c.font = `700 22px ${FM}`; c.fillStyle = tone(st.pnl); c.fillText(`${fmtMoney(st.pnl, 1)}  ${fmtPct(st.pnlPct, 2)}`, 16, 138);
  c.fillStyle = DIM; c.font = `500 17px ${FM}`; c.fillText(`today ${fmtMoney(st.today, 1)} · ${st.n} trades · win ${st.win == null ? '—' : st.win.toFixed(0) + '%'} · avg ${st.avgR == null ? '—' : st.avgR.toFixed(2) + 'R'}`, 16, 170);
  const P = Object.entries(PT.pos);
  c.font = `600 14px ${FM}`; c.fillStyle = DIM; c.fillText('OPEN POSITIONS', 16, 206);
  if (!P.length) { c.font = `500 18px ${FS}`; c.fillText(RV.pending ? 'Reading the Reviewer\'s latest review…' : `Flat — waiting for a ${ptRules('S', '').minScore}/8 reversal signal`, 16, 240); }
  P.slice(0, 4).forEach(([s, p], i) => {
    const px = ptPx(s), u = px ? ptUpnl(p, px) + p.realized : 0, y = 240 + i * 46;
    c.font = `800 22px ${FS}`; c.fillStyle = TXT; c.fillText(p.b, 16, y);
    c.font = `800 18px ${FS}`; c.fillStyle = p.side === 'L' ? UP : DN; c.fillText((p.side === 'L' ? 'LONG' : 'SHORT') + (p.strat === 'mom' ? ' M' : ''), 190, y);
    c.font = `700 20px ${FM}`; c.fillStyle = tone(u); c.textAlign = 'right'; c.fillText(fmtMoney(u, 1), 560, y);
    c.fillStyle = DIM; c.fillText(px ? (ptR(p, px) >= 0 ? '+' : '') + ptR(p, px).toFixed(2) + 'R' : '—', 784, y); c.textAlign = 'left';
  });
  A.tex.needsUpdate = true;
  c = screenFrame(B, col, 'EQUITY CURVE · LAST TRADES');
  drawEq(c, 0, 52, B.W, 190, 14);
  PT.log.slice(0, 4).forEach((x, i) => {
    const y = 272 + i * 42;
    c.font = `700 19px ${FS}`; c.fillStyle = TXT; c.fillText(x.b, 16, y);
    c.font = `700 16px ${FS}`; c.fillStyle = x.side === 'L' ? UP : DN; c.fillText(x.side === 'L' ? 'LONG' : 'SHORT', 150, y);
    c.font = `700 18px ${FM}`; c.fillStyle = tone(x.pnl); c.textAlign = 'right'; c.fillText(`${fmtMoney(x.pnl, 1)}  ${x.R >= 0 ? '+' : ''}${x.R.toFixed(2)}R`, 784, y); c.textAlign = 'left';
  });
  if (!PT.log.length) { c.fillStyle = DIM; c.font = `500 18px ${FS}`; c.fillText('No closed trades yet.', 16, 290); }
  B.tex.needsUpdate = true;
}
function traderHTML(tab) {
  const st = ptStats(), k = (l, v, cl = '') => `<div class="kpi"><span>${l}</span><b class="${cl}">${v}</b></div>`;
  const status = `<div class="card2" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-left:4px solid ${PT.on ? (PT.paused ? WARN : UP) : DIM}">
    <span class="tag" style="color:#ffd166">PAPER ACCOUNT — simulated fills, no real orders</span>
    <b style="color:${PT.on ? (PT.paused ? WARN : UP) : DIM}">${PT.on ? (PT.paused ? 'Paused for today (daily loss limit)' : 'Trading is ON') : 'Trading is OFF'}</b>
    <span class="dim" style="font-size:12px">started ${new Date(PT.created).toLocaleDateString()} with $${PT.start.toLocaleString()} · fees ${PT.cfg.feePct}% + slippage ${PT.cfg.slipPct}% per side, funding charged</span>
    <span style="margin-left:auto;display:flex;gap:8px"><button class="btn sm" data-pt="toggle">${PT.on ? 'Turn trading off' : 'Turn trading on'}</button></span></div>`;
  if (tab === 'log') {
    if (!PT.log.length) return status + '<div class="empty">No closed trades yet. Each closed trade shows here with its entry reason, exit reason, fees and result in R (multiples of the amount risked).</div>';
    return status + `<table class="t"><thead><tr><th>Opened</th><th>Coin</th><th>Side</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th><th>R</th><th>Best R</th><th>Fees+funding</th><th>Held</th><th style="text-align:left">Why in → why out</th></tr></thead><tbody>${PT.log.map(x => `<tr data-sym="${x.s}"><td class="dim">${new Date(x.t0).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</td><td class="sym">${esc(x.b)}</td><td class="${x.side === 'L' ? 'up' : 'dn'}">${x.side === 'L' ? 'LONG' : 'SHORT'}${x.strat === 'mom' ? '<br><span class="tag" style="color:#7fe3b8">momentum</span>' : ''}</td><td>${fmtPx(x.entry)}</td><td>${fmtPx(x.exit)}</td><td>${fmtMoney(x.notional)}</td><td class="${cls(x.pnl)}">${fmtMoney(x.pnl, 1)}</td><td class="${cls(x.R)}">${x.R >= 0 ? '+' : ''}${x.R.toFixed(2)}</td><td class="dim">${x.maxR.toFixed(1)}</td><td class="dim">${fmtMoney(x.fees - x.funding)}</td><td class="dim">${ago(now() - (x.t1 - x.t0))}</td><td style="text-align:left;white-space:normal;min-width:260px;font-family:var(--sans);font-size:12px">${x.g && x.g.g !== '—' ? `<b style="color:${GRADE_C[x.g.g]}">${x.g.g}</b> ` : ''}${esc(x.why)}<br><span class="dim">→ ${esc(x.exitWhy)}</span>${x.les && x.les.length ? `<br><span style="color:#c5f05a">lessons: ${esc(x.les.join(', '))}</span>` : ''}${x.unl ? `<br><span style="color:${x.unlK === 'none' ? DIM : WARN}">🔓 at entry: ${esc(x.unl)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  if (tab === 'rules') {
    const f = (key, label, step, min, max) => `<label>${label}<input type="number" data-ptcfg="${key}" step="${step}" min="${min}" max="${max}" value="${PT.cfg[key]}"></label>`;
    return status + `<div style="margin-bottom:14px">${rulesCardHTML('pt')}</div><div class="grid2"><div class="card2"><h3>HOW THE TRADER TRADES · TWO STRATEGIES</h3>
      <div class="chk"><span class="i" style="color:${PT.cfg.stratRev ? UP : DIM}">R</span><span><b>Reversal${PT.cfg.stratRev ? '' : ' (off)'}</b>: fade a top-5 mover once its move is ending (steps 1–6 below). ${PT.cfg.revLong ? 'Both sides: short gainers, buy losers.' : '<b>Shorts gainers only</b>; buying losers is switched off.'}</span></div>
      <div class="chk"><span class="i" style="color:${PT.cfg.stratMom ? UP : DIM}">M</span><span><b>Momentum${PT.cfg.stratMom ? '' : ' (off)'}</b>: trade <b>with</b> a top-10 mover while its move is still being driven, meaning ${PT.cfg.momMinScore}/8 momentum signs (fresh high/low, a sloping EMA, money flow, taker pressure, expanding volume, no funding crowding, OI building, RSI strong but not exhausted). Skips moves already more than ${PT.cfg.momMaxExt}% from the 15m EMA, and coins already showing reversal signs. Risk ${PT.cfg.momRiskPct}% per trade, at most ${PT.cfg.momMaxPos} momentum positions. Stop beyond the last 2-hour swing or the EMA. Same partial, trailing stop and target as reversals. Exits when momentum fades or reversal signs form, or after ${PT.cfg.momHoldH} h.</span></div>
      <div class="dim" style="font-size:11px;letter-spacing:.08em;margin:10px 0 2px">REVERSAL RULES</div>
      <div class="chk"><span class="i up">1</span><span><b>Waits for a reversal signal from GainerLoser's day tracker</b>: a tracked top-5 coin at "Reversal forming" or "Reversed" with at least ${PT.cfg.minScore}/8 signs. Gainers are <b>shorted</b> (fading the top)${PT.cfg.revLong ? '; losers are <b>bought</b> (catching the bottom)' : '. Losers are <b>not</b> bought (reversal longs are off)'}.</span></div>
      <div class="chk"><span class="i up">2</span><span><b>Stop</b> ${PT.cfg.stopBuf}% beyond the swing it's reversing from (the 6-hour high or low, else the 3-hour). Skips the trade if that stop is more than ${PT.cfg.maxStopPct}% away; minimum 2%.</span></div>
      <div class="chk"><span class="i up">3</span><span><b>Size</b> so a stop-out loses ${PT.cfg.riskPct}% of equity, capped at ${PT.cfg.maxLev}× total leverage and ${PT.cfg.maxPos} positions at once. Coins need ${fmtUsd(PT.cfg.minVol)}+ daily volume.</span></div>
      <div class="chk"><span class="i up">4</span><span><b>Takes half at +${PT.cfg.tp1R}R</b> and moves the stop to entry, then trails it with the 15m EMA20. <b>Closes all at +${PT.cfg.tpR}R.</b></span></div>
      <div class="chk"><span class="i up">5</span><span><b>Gets out early</b> if the reversal signs fade (the coin goes back to "still rising/falling" after 30 min), or after ${PT.cfg.holdH} hours.</span></div>
      <div class="chk"><span class="i up">6</span><span><b>Stops for the day</b> after losing ${PT.cfg.dailyLossPct}% of the day's starting equity. Waits 2 hours before re-trading the same coin.</span></div>
      <div class="chk"><span class="i" style="color:${PT.cfg.unlGuard ? WARN : DIM}">7</span><span><b>Watches token unlocks</b>${PT.cfg.unlGuard ? '' : ' (off)'}: no longs within ${PT.cfg.unlDays} days before an unlock of ≥${PT.cfg.unlMinPct}% of circulating supply, and longs are closed 12 h before one. Shorts on gainers with an unlock coming within 7 days get priority. No fresh shorts in the 24 h after a big unlock, when bounces are common. The calendar is on the GainerLoser desk.</span></div>
      <div class="chk"><span class="i" style="color:#c5f05a">8</span><span><b>Learns from the Reviewer.</b> Every ${RV.every} closed trades the Reviewer grades the results and can tighten or relax these rules. The Trader reads each review, accepts or adjusts it, and only then trades again. Your numbers on the right are the baseline; the Reviewer never raises risk above them.</span></div>
      <p class="note" style="margin-top:10px">Market orders only: every fill pays the ${PT.cfg.feePct}% taker fee plus ${PT.cfg.slipPct}% slippage each way, and funding is paid or received at each settlement. Prices come live from Aster. With sync on, the cloud trades every ~5 min even when your computers are off, or this computer trades every 5 s if you take over.</p></div>
      <div class="card2"><h3>SETTINGS</h3><div class="set" style="grid-template-columns:1fr 1fr">
      ${f('riskPct', 'Risk per trade (% of equity)', 0.25, 0.25, 5)}${f('maxPos', 'Max open positions', 1, 1, 10)}
      ${f('maxLev', 'Max total leverage (×)', 0.5, 0.5, 10)}${f('minScore', 'Min reversal signs (of 8)', 1, 3, 8)}
      ${f('dailyLossPct', 'Daily loss limit (%)', 0.5, 0.5, 20)}${f('holdH', 'Max hold (hours)', 1, 1, 72)}
      ${f('maxStopPct', 'Skip if stop farther than (%)', 1, 3, 40)}${f('minVol', 'Min 24h volume (USD)', 50000, 0, 1e8)}
      ${f('tp1R', 'Take half at (R)', 0.1, 0.5, 5)}${f('tpR', 'Full target (R)', 0.5, 1, 10)}
      ${f('stopBuf', 'Stop buffer beyond swing (%)', 0.1, 0, 5)}${f('feePct', 'Taker fee per side (%)', 0.005, 0, 1)}
      ${f('slipPct', 'Slippage per side (%)', 0.05, 0, 2)}
      <label>Reversal trades<select data-ptcfg="stratRev"><option value="1" ${PT.cfg.stratRev ? 'selected' : ''}>On</option><option value="0" ${PT.cfg.stratRev ? '' : 'selected'}>Off</option></select></label>
      <label>Reversal longs (buy losers)<select data-ptcfg="revLong"><option value="0" ${PT.cfg.revLong ? '' : 'selected'}>Off: short gainers only</option><option value="1" ${PT.cfg.revLong ? 'selected' : ''}>On</option></select></label>
      <label>Use the Reviewer's screens<select data-ptcfg="useScreens"><option value="1" ${PT.cfg.useScreens ? 'selected' : ''}>On: skip coins that fail them</option><option value="0" ${PT.cfg.useScreens ? '' : 'selected'}>Off</option></select></label>
      <label>Momentum trades<select data-ptcfg="stratMom"><option value="1" ${PT.cfg.stratMom ? 'selected' : ''}>On</option><option value="0" ${PT.cfg.stratMom ? '' : 'selected'}>Off</option></select></label>
      ${f('momMinScore', 'Momentum: min signs (of 8)', 1, 4, 8)}${f('momRiskPct', 'Momentum: risk per trade (%)', 0.25, 0.25, 5)}
      ${f('momMaxPos', 'Momentum: max positions', 1, 0, 5)}${f('momHoldH', 'Momentum: max hold (hours)', 1, 1, 48)}
      ${f('momMaxExt', 'Momentum: skip if > % from EMA', 1, 2, 30)}
      <label>Token unlock guard<select data-ptcfg="unlGuard"><option value="1" ${PT.cfg.unlGuard ? 'selected' : ''}>On</option><option value="0" ${PT.cfg.unlGuard ? '' : 'selected'}>Off</option></select></label>
      ${f('unlDays', 'No longs within N days before an unlock', 1, 0, 14)}${f('unlMinPct', 'Unlock counts if ≥ % of circulating', 0.5, 0.5, 50)}</div>
      <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn sm ghost" data-pt="reset">${PT._arm ? 'Click again to reset to $1,000' : 'Reset account to $1,000'}</button><span class="dim" style="font-size:12px">Resetting clears positions, history and the equity curve.</span></div></div></div>`;
  }
  // account
  const P = Object.entries(PT.pos);
  const scan = PT.lastScan && PT.lastScan.cands && PT.lastScan.cands.length ? PT.lastScan.cands.map(x => `<div class="chk" style="padding:3px 0"><span class="i ${x.took ? 'up' : 'dim'}">${x.took ? '✓' : '·'}</span><span><b>${esc(x.b)}</b> <span class="dim">${x.strat === 'mom' ? (x.side === 'G' ? 'momentum → long' : 'momentum → short') : (x.side === 'G' ? 'reversal: gainer → short' : 'reversal: loser → long')} · ${esc(x.state)} ${x.score}/8</span></span><span class="d">${x.took ? 'entered' : esc(x.skip)}</span></div>`).join('') : '<span class="dim" style="font-size:12px">No reversal setups ("Reversal forming" / "Reversed") and no strong-momentum coins right now.</span>';
  return status + `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${k('Equity', fmtMoney(st.eq))}${k('Total P&L', `${fmtMoney(st.pnl, 1)} (${fmtPct(st.pnlPct, 2)})`, cls(st.pnl))}${k('Today', fmtMoney(st.today, 1), cls(st.today))}${k('Open', `${st.open} / ${PT.cfg.maxPos}`)}${k('Closed trades', st.n)}${k('Win rate', st.win == null ? '—' : st.win.toFixed(0) + '%')}${k('Avg result', st.avgR == null ? '—' : (st.avgR >= 0 ? '+' : '') + st.avgR.toFixed(2) + 'R', cls(st.avgR))}${k('Max drawdown', fmtPct(st.dd, 1), st.dd < 0 ? 'dn' : '')}</div>
  <div class="grid2"><div class="card2"><h3>EQUITY CURVE (DASHED = $${PT.start.toLocaleString()} START)</h3><canvas class="ptchart" style="width:100%;height:220px;display:block;border-radius:10px;background:#060a14;border:1px solid var(--line)"></canvas></div>
  <div class="card2"><h3>LAST SCAN — REVERSAL CANDIDATES</h3>${scan}</div></div>
  ${rvLessonsCard()}
  <div class="card2" style="margin-top:14px"><h3>OPEN POSITIONS</h3>${P.length ? `<table class="t"><thead><tr><th>Coin</th><th>Side</th><th>Entry</th><th>Now</th><th>Stop</th><th>Size</th><th>P&amp;L</th><th>R now</th><th>Held</th><th style="text-align:left">Why</th><th></th></tr></thead><tbody>${P.map(([s, p]) => { const px = ptPx(s), u = px ? ptUpnl(p, px) + p.realized : null; return `<tr data-sym="${s}"><td class="sym">${esc(p.b)}${p.tp1 ? ' <span class="tag up">half banked</span>' : ''}</td><td class="${p.side === 'L' ? 'up' : 'dn'}">${p.side === 'L' ? 'LONG' : 'SHORT'}${p.strat === 'mom' ? '<br><span class="tag" style="color:#7fe3b8">momentum</span>' : ''}</td><td>${fmtPx(p.entry)}</td><td>${fmtPx(px)}</td><td>${fmtPx(p.stop)}${p.be ? ' <span class="dim">(BE+)</span>' : ''}</td><td>${fmtMoney(p.qty * (px || p.entry))}</td><td class="${cls(u)}">${fmtMoney(u, 1)}</td><td class="${cls(px ? ptR(p, px) : 0)}">${px ? (ptR(p, px) >= 0 ? '+' : '') + ptR(p, px).toFixed(2) : '—'}</td><td class="dim">${ago(p.t)}</td><td style="text-align:left;white-space:normal;min-width:220px;font-family:var(--sans);font-size:12px">${esc(p.why)}</td><td><button class="btn sm ghost" data-pt-close="${s}">Close</button></td></tr>`; }).join('')}</tbody></table>` : `<div class="empty" style="padding:16px">Flat. The trader enters only when a tracked top-5 coin reaches a ${ptRules('S', '').minScore}/8 reversal signal.</div>`}</div>
  <p class="note" style="margin-top:10px">This is a simulation to test the rules before any real money: past paper results don't guarantee live results, where fills on thin small caps can be worse.</p>`;
}
document.getElementById('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-pt]'), c = e.target.closest('[data-pt-close]');
  if (c) { e.stopPropagation(); if (syBlock()) return; ptClose(c.dataset.ptClose, 1, 'closed by you'); renderPanel(); return; }
  if (!b) return; e.stopPropagation();
  if (syBlock()) return;
  if (b.dataset.pt === 'toggle') { PT.on = !PT.on; ptSave(); sayFor('trader', PT.on ? 'Trading back on — watching for reversal signals.' : 'Trading off. Open positions are still managed.'); }
  if (b.dataset.pt === 'reset') { if (PT._arm) { PT._arm = false; ptReset(); sayFor('trader', 'Fresh $1,000 paper account.'); } else { PT._arm = true; setTimeout(() => { PT._arm = false; }, 6000); } }
  renderPanel();
}, true);
document.getElementById('panel').addEventListener('change', e => {
  const i = e.target.closest('[data-ptcfg]'); if (!i) return;
  if (syBlock()) { i.value = PT.cfg[i.dataset.ptcfg]; return; }
  const v = +i.value; if (fin(v)) { PT.cfg[i.dataset.ptcfg] = v; ptSave(); }
});

/* ================= POSITION WALL (east wall) ================= */
function wrapText(c, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(' '); let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(n === maxLines - 1 ? line + '…' : line, x, y + n * lh); n++; line = w; if (n >= maxLines) return n; }
    else line = t;
  }
  if (line && n < maxLines) { c.fillText(line, x, y + n * lh); n++; }
  return n;
}
// o (optional, SMC wall): {bars, target, tLab, foot, zone, col}
function drawPosChart(c, s, p, x, y, w, h, o = {}) {
  const k = o.bars ? {bars: o.bars} : S.kl.get(s), live = ptPx(s);
  c.fillStyle = '#060a14'; c.fillRect(x, y, w, h); c.strokeStyle = 'rgba(124,137,168,.25)'; c.strokeRect(x + .5, y + .5, w - 1, h - 1);
  if (!k || k.bars.length < 4) { c.fillStyle = DIM; c.font = `500 26px ${FS}`; c.fillText('loading chart…', x + 20, y + h / 2); return; }
  const B = k.bars.slice(-36), n = B.length, R = Math.abs(p.entry - p.stop0), dir = p.side === 'L' ? 1 : -1;
  const t1R = p.tp1R || 1.5, tp1 = p.entry + dir * t1R * R, tp2 = fin(o.target) ? o.target : p.entry + dir * (p.tpR || 3) * R, tR = o.tLab || (p.tpR || 3);
  const vals = [...B.map(b => b[2]), ...B.map(b => b[3]), p.entry, p.stop, tp2, live || p.entry];
  // (zone is drawn only where it fits the price range)
  let lo = Math.min(...vals), hi = Math.max(...vals); const sp = (hi - lo) || hi * 0.01; lo -= sp * 0.04; hi += sp * 0.04;
  const padR = 150, pw = w - padR - 10, bw = pw / n;
  const Y = v => y + 12 + (hi - v) / (hi - lo) * (h - 24), X = i => x + 8 + i * bw + bw / 2;
  // entry time marker
  const iv = n > 1 ? B[n - 1][0] - B[n - 2][0] : 15 * 60e3, t0 = B[0][0], tEnd = B[n - 1][0] + iv;
  if (p.t >= t0) { const ex = x + 8 + (p.t - t0) / (tEnd - t0) * pw; c.fillStyle = 'rgba(255,209,102,.07)'; c.fillRect(ex, y + 1, x + 8 + pw - ex, h - 2); c.strokeStyle = 'rgba(255,209,102,.6)'; c.setLineDash([6, 6]); c.beginPath(); c.moveTo(ex, y + 4); c.lineTo(ex, y + h - 4); c.stroke(); c.setLineDash([]); }
  // SMC entry zone (FVG / order block)
  if (o.zone && fin(o.zone.lo) && fin(o.zone.hi)) { const zl = Math.max(lo, o.zone.lo), zh = Math.min(hi, o.zone.hi); if (zh > zl) { c.fillStyle = 'rgba(255,138,216,.13)'; c.fillRect(x + 8, Y(zh), pw, Y(zl) - Y(zh)); c.fillStyle = 'rgba(255,138,216,.85)'; c.font = `700 20px ${FS}`; c.fillText(o.zone.kind || 'zone', x + 16, Y(zh) + 22); } }
  // candles
  for (let i = 0; i < n; i++) {
    const [, o, hh, l, cl] = B[i], cc = i === n - 1 && fin(live) ? live : cl, up = cc >= o;
    c.strokeStyle = c.fillStyle = up ? UP : DN; c.lineWidth = 2;
    c.beginPath(); c.moveTo(X(i), Y(hh)); c.lineTo(X(i), Y(l)); c.stroke();
    c.fillRect(X(i) - bw * 0.32, Y(Math.max(o, cc)), Math.max(2, bw * 0.64), Math.max(2, Math.abs(Y(o) - Y(cc))));
  }
  // levels
  const lvl = (v, col, label, dash) => {
    const yy = Y(v); c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash(dash || []); c.beginPath(); c.moveTo(x + 8, yy); c.lineTo(x + 8 + pw, yy); c.stroke(); c.setLineDash([]);
    c.fillStyle = col; c.font = `700 22px ${FM}`; c.textBaseline = 'middle'; c.fillText(`${label} ${fmtPx(v)}`, x + pw + 16, yy); c.textBaseline = 'alphabetic';
  };
  if (!p.tp1) lvl(tp1, 'rgba(46,229,157,.75)', t1R + 'R', [10, 8]);
  lvl(tp2, UP, typeof tR === 'number' ? tR + 'R' : tR, [10, 8]);
  lvl(p.entry, '#ffd166', 'IN', [4, 6]);
  lvl(p.stop, DN, p.be ? 'STOP·BE' : 'STOP');
  if (fin(live)) { const yy = Y(live); c.fillStyle = TXT; c.beginPath(); c.arc(X(n - 1) + bw * 0.6, yy, 7, 0, 7); c.fill(); }
  c.fillStyle = DIM; c.font = `500 20px ${FM}`; c.fillText(o.foot || '15m · last 9h', x + 16, y + h - 14);
}
function drawWall() {
  if (typeof WALL === 'undefined') return;
  const T = WALL, c = T.ctx, W = T.W, H = T.H, st = ptStats();
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0d1328'; c.fillRect(0, 0, W, 84); c.fillStyle = '#ffd166'; c.fillRect(0, 82, W, 3);
  c.textBaseline = 'middle'; c.font = `800 44px ${FS}`; c.fillStyle = '#ffd166'; c.fillText('TRADER · OPEN POSITIONS', 30, 42);
  c.font = `700 22px ${FS}`; c.fillStyle = '#04070f'; const tagW = c.measureText('PAPER ACCOUNT').width + 28;
  c.fillStyle = '#ffd166'; rr(c, 650, 24, tagW, 38, 19); c.fill(); c.fillStyle = '#04070f'; c.fillText('PAPER ACCOUNT', 664, 44);
  c.textAlign = 'right'; c.font = `700 32px ${FM}`;
  c.fillStyle = TXT; c.fillText(`Equity ${fmtMoney(st.eq)}`, W - 1060, 44);
  c.fillStyle = tone(st.pnl); c.fillText(`${fmtMoney(st.pnl, 1)} (${fmtPct(st.pnlPct, 2)})`, W - 600, 44);
  c.fillStyle = DIM; c.font = `600 26px ${FM}`; c.fillText(`${st.open}/${PT.cfg.maxPos} open · ${st.n} closed · ${PT.on ? (PT.paused ? 'PAUSED' : 'ON') : 'OFF'}  ${clock()}`, W - 30, 44);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const P = Object.entries(PT.pos).sort((a, b) => a[1].t - b[1].t), top = 100, bh = H - top - 16;
  if (!P.length) {
    c.font = `800 52px ${FS}`; c.fillStyle = TXT; c.fillText('Flat — no open positions', 40, top + 70);
    c.font = `500 28px ${FS}`; c.fillStyle = DIM; c.fillText(`Waiting for a tracked top-5 coin to reach ${ptRules('S', '').minScore}/8 reversal signs.`, 40, top + 120);
    drawEq(c, 40, top + 150, 1500, bh - 160, 22);
    c.font = `700 26px ${FM}`; c.fillStyle = DIM; c.fillText('LAST TRADES', 1640, top + 40);
    PT.log.slice(0, 7).forEach((x, i) => {
      const y = top + 90 + i * 58; c.font = `800 32px ${FS}`; c.fillStyle = TXT; c.fillText(x.b, 1640, y);
      c.font = `700 26px ${FS}`; c.fillStyle = x.side === 'L' ? UP : DN; c.fillText(x.side === 'L' ? 'LONG' : 'SHORT', 1900, y);
      c.font = `700 30px ${FM}`; c.fillStyle = tone(x.pnl); c.textAlign = 'right'; c.fillText(`${fmtMoney(x.pnl, 1)}   ${x.R >= 0 ? '+' : ''}${x.R.toFixed(2)}R`, W - 40, y); c.textAlign = 'left';
      c.font = `500 20px ${FS}`; c.fillStyle = DIM; c.fillText(String(x.exitWhy).slice(0, 60), 2080, y);
    });
    if (!PT.log.length) { c.font = `500 28px ${FS}`; c.fillStyle = DIM; c.fillText('No closed trades yet.', 1640, top + 90); }
    T.tex.needsUpdate = true; return;
  }
  const shown = P.slice(0, 3), n = shown.length, colW = W / n, infoW = n === 1 ? 900 : n === 2 ? 640 : 470, sc = n === 3 ? 1 : 1.15;
  shown.forEach(([s, p], i) => {
    const x0 = i * colW, px = ptPx(s), u = px ? ptUpnl(p, px) + p.realized : null, r = px ? ptR(p, px) : null, L = p.side === 'L';
    if (i) { c.fillStyle = 'rgba(255,209,102,.25)'; c.fillRect(x0, top, 2, bh); }
    const ix = x0 + 26;
    c.font = `800 ${Math.round(56 * sc)}px ${FS}`; c.fillStyle = TXT; c.fillText(p.b, ix, top + 58);
    const nw = c.measureText(p.b).width; c.font = `800 ${Math.round(26 * sc)}px ${FS}`; c.fillStyle = L ? UP : DN; c.fillText((L ? 'LONG' : 'SHORT') + (p.strat === 'mom' ? ' · MOMENTUM' : ' · REVERSAL'), ix + nw + 18, top + 56);
    c.font = `800 ${Math.round(46 * sc)}px ${FM}`; c.fillStyle = tone(u); c.fillText(fmtMoney(u, 1), ix, top + 124);
    c.font = `700 ${Math.round(30 * sc)}px ${FM}`; c.fillText(r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`, ix, top + 166);
    const rows = [['Entry', fmtPx(p.entry)], ['Now', fmtPx(px)], [p.be ? (p.tp1 ? 'Trail stop' : 'Stop (BE)') : 'Stop', fmtPx(p.stop)], ['Size', fmtMoney(p.qty * (px || p.entry))], ['Held', ago(p.t)]];
    c.font = `500 ${Math.round(24 * sc)}px ${FM}`;
    rows.forEach(([k, v], j) => { const y = top + 214 + j * Math.round(34 * sc); c.fillStyle = DIM; c.fillText(k, ix, y); c.fillStyle = k.includes('top') ? DN : TXT; c.textAlign = 'right'; c.fillText(v, x0 + infoW - 16, y); c.textAlign = 'left'; });
    c.font = `500 ${Math.round(19 * sc)}px ${FS}`; c.fillStyle = '#aab6d4';
    wrapText(c, (p.tp1 ? 'Half banked · ' : '') + p.why, ix, top + 214 + 5 * Math.round(34 * sc) + 8, infoW - 40, Math.round(25 * sc), 3);
    drawPosChart(c, s, p, x0 + infoW, top + 6, colW - infoW - 20, bh - 12);
  });
  if (P.length > 3) { c.font = `700 26px ${FS}`; c.fillStyle = WARN; c.textAlign = 'right'; c.fillText(`+${P.length - 3} more open — see the Trader's panel`, W - 30, H - 24); c.textAlign = 'left'; }
  T.tex.needsUpdate = true;
}
