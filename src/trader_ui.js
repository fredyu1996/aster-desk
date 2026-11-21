/* ================= EAST WALL: SMC Big + SMC BTC/ETH open positions (the Trader's until Nov 20; its engine still manages its own) ================= */
// equity curve of the account in SM: call inside smWith(SB / SE, ...)
function drawEq(c, x, y, w, h, fs = 12) {
  const pts = SM.eqs.concat([[now(), smEquity()]]);
  c.save(); c.translate(x, y);
  if (pts.length < 2) { c.fillStyle = DIM; c.font = `500 ${fs + 2}px ${FS}`; c.textAlign = 'center'; c.fillText('equity curve starts with the first trades', w / 2, h / 2); c.restore(); c.textAlign = 'left'; return; }
  let lo = Math.min(SM.start, ...pts.map(p => p[1])), hi = Math.max(SM.start, ...pts.map(p => p[1])); const sp = (hi - lo) || 10; lo -= sp * 0.1; hi += sp * 0.1;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1, pad = 56;
  const X = t => 6 + (t - t0) / ((t1 - t0) || 1) * (w - pad - 10), Y = v => 8 + (hi - v) / (hi - lo) * (h - 24);
  c.strokeStyle = 'rgba(124,137,168,.35)'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(6, Y(SM.start)); c.lineTo(w - pad, Y(SM.start)); c.stroke(); c.setLineDash([]);
  const last = pts[pts.length - 1][1]; c.strokeStyle = last >= SM.start ? UP : DN; c.lineWidth = 2; c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke();
  c.fillStyle = DIM; c.font = `500 ${fs}px ${FM}`; c.textBaseline = 'middle';
  c.fillText('$' + Math.round(hi), w - pad + 4, 12); c.fillText('$' + Math.round(lo), w - pad + 4, h - 14); c.fillText('$' + SM.start, w - pad + 4, Y(SM.start));
  c.restore(); c.textAlign = 'left';
}
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
// one account's half of the east wall; runs inside smWith(acct, ...) so SM, smEquity and smBars read that account
function drawAcctPos(c, title, col, x0, w, H) {
  const eq = smEquity(), pnl = eq - SM.start, P = Object.entries(SM.pos).sort((a, b) => a[1].t - b[1].t), pTxt = `${fmtMoney(pnl, 1)} (${fmtPct(pnl / SM.start * 100, 2)})`;
  c.fillStyle = '#0d1328'; c.fillRect(x0, 0, w, 84); c.fillStyle = col; c.fillRect(x0, 82, w, 3);
  c.textBaseline = 'middle'; c.font = `800 40px ${FS}`; c.fillStyle = col; c.fillText(title, x0 + 30, 42);
  c.textAlign = 'right'; c.font = `600 22px ${FM}`; c.fillStyle = DIM; c.fillText(`${P.length}/${SM.cfg.maxPos} open · ${SM.log.length} closed · ${SM.on ? 'ON' : 'OFF'}`, x0 + w - 30, 24);
  c.font = `700 28px ${FM}`; c.fillStyle = tone(pnl); c.fillText(pTxt, x0 + w - 30, 58); const pw = c.measureText(pTxt).width;
  c.fillStyle = TXT; c.fillText(`Equity ${fmtMoney(eq)}`, x0 + w - 60 - pw, 58);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const top = 100, bh = H - top - 16, shown = P.slice(0, 2), n = shown.length, posH = n ? bh - 130 : 0;
  if (!n) {
    c.font = `800 44px ${FS}`; c.fillStyle = TXT; c.fillText('Flat — no open positions', x0 + 30, top + 50);
    c.font = `500 24px ${FS}`; c.fillStyle = DIM; wrapText(c, `Waiting for a sweep → structure shift → pullback into the FVG or order block, quality ${smRules().minQ}/100 or better.`, x0 + 30, top + 92, w - 60, 28, 1);
  }
  const colW = w / (n || 1), infoW = n === 1 ? 560 : 330;
  shown.forEach(([s, p], i) => {
    const x = x0 + i * colW, px = ptPx(s), u = px ? smUpnl(p, px) + p.realized : null, r = px ? smR(p, px) : null, L = p.side === 'L', tf = p.tf || '15m', ix = x + 26;
    if (i) { c.fillStyle = col; c.globalAlpha = 0.25; c.fillRect(x, top, 2, posH); c.globalAlpha = 1; }
    c.font = `800 44px ${FS}`; c.fillStyle = TXT; c.fillText(p.b, ix, top + 44);
    const nw = c.measureText(p.b).width; c.font = `800 22px ${FS}`; c.fillStyle = L ? UP : DN; c.fillText(`${L ? 'LONG' : 'SHORT'} · ${tf} ${p.zoneKind || ''}`, ix + nw + 14, top + 42);
    c.font = `800 36px ${FM}`; c.fillStyle = tone(u); c.fillText(fmtMoney(u, 1), ix, top + 92);
    c.font = `700 26px ${FM}`; c.fillText(r == null ? '—' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`, ix, top + 128);
    const rows = [['Entry', fmtPx(p.entry)], ['Now', fmtPx(px)], [p.trail ? 'Trail stop' : p.be ? 'Stop (BE)' : 'Stop', fmtPx(p.stop)], ['Target', fmtPx(p.target)], ['Held', ago(p.t)]];
    c.font = `500 21px ${FM}`;
    rows.forEach(([k, v], j) => { const y = top + 166 + j * 28; c.fillStyle = DIM; c.fillText(k, ix, y); c.fillStyle = /top/.test(k) ? DN : k === 'Target' ? UP : TXT; c.textAlign = 'right'; c.fillText(v, x + infoW - 16, y); c.textAlign = 'left'; });
    c.font = `500 18px ${FS}`; c.fillStyle = '#aab6d4'; wrapText(c, (p.tp1 ? 'Half banked · ' : '') + (p.why || ''), ix, top + 166 + 5 * 28 + 4, infoW - 40, 22, 1);
    const B = smBars(s, tf), rrT = Math.abs(p.target - p.entry) / (Math.abs(p.entry - p.stop0) || 1);
    drawPosChart(c, s, p, x + infoW, top + 6, colW - infoW - 20, posH - 12, {bars: B && B.length ? B : null, target: p.target, tLab: `${rrT.toFixed(1)}R`, zone: p.zone, foot: `${tf} · zone shaded`});
  });
  if (P.length > 2) { c.font = `700 22px ${FS}`; c.fillStyle = WARN; c.textAlign = 'right'; c.fillText(`+${P.length - 2} more open — see the SMC desk`, x0 + w - 30, top + posH + 4); c.textAlign = 'left'; }
  drawEq(c, x0 + 30, top + (n ? posH + 10 : 120), w - 60, n ? bh - posH - 10 : bh - 120, n ? 18 : 22);
  return {title, shown: n, open: P.length};
}
function drawWall() {
  if (typeof WALL === 'undefined') return;
  const T = WALL, c = T.ctx, W = T.W, H = T.H, half = W / 2;
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  // T.drawn is read by tests/desk-smoke.mjs; colours = SBCOL / SECOL, literal because smc_ui.js loads after ui.js's first drawWall() call
  T.drawn = [smWith(SB, () => drawAcctPos(c, 'SMC BIG · OPEN POSITIONS', '#6ee7ff', 0, half, H)), smWith(SE, () => drawAcctPos(c, 'SMC BTC/ETH · OPEN POSITIONS', '#b69cff', half, half, H))];
  c.fillStyle = 'rgba(207,224,255,.35)'; c.fillRect(half - 1, 0, 3, H);
  T.tex.needsUpdate = true;
}
