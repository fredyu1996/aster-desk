/* ================= TRADER: position wall (its panel and desk were removed Nov 20, option A; the engine still manages its open positions) ================= */
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
  if (P.length > 3) { c.font = `700 26px ${FS}`; c.fillStyle = WARN; c.textAlign = 'right'; c.fillText(`+${P.length - 3} more open`, W - 30, H - 24); c.textAlign = 'left'; }
  T.tex.needsUpdate = true;
}
