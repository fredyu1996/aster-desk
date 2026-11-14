/* ================= SCREEN DRAWING ================= */
const FS = 'Inter, sans-serif', FM = 'JetBrains Mono, monospace';
function clock() { return new Date().toTimeString().slice(0, 8); }
function screenFrame(T, color, title, sub) {
  const c = T.ctx, W = T.W, H = T.H;
  c.fillStyle = '#060a14'; c.fillRect(0, 0, W, H);
  c.fillStyle = color; c.fillRect(0, 0, W, 46);
  c.fillStyle = '#04060c'; c.font = `800 23px ${FS}`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(title, 16, 24);
  c.textAlign = 'right'; c.font = `600 17px ${FM}`; c.fillText(sub || clock(), W - 14, 24); c.textAlign = 'left';
  c.fillStyle = 'rgba(255,255,255,.025)'; for (let y = 48; y < H; y += 4) c.fillRect(0, y, W, 1);
  return c;
}
// cols: [{h, x, a:'l'|'r', f:m=>[text,color]}]
function drawTable(T, cols, rows, y0 = 64, rh = 34, fsz = 19) {
  const c = T.ctx;
  c.font = `600 14px ${FM}`; c.fillStyle = DIM; c.textBaseline = 'middle';
  for (const k of cols) { c.textAlign = k.a === 'r' ? 'right' : 'left'; c.fillText(k.h, k.x, y0 + 8); }
  let y = y0 + 8 + rh;
  for (let i = 0; i < rows.length; i++) {
    if (y > T.H - 10) break;
    if (i % 2) { c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(0, y - rh / 2, T.W, rh); }
    for (const k of cols) {
      const [t, col, bold] = k.f(rows[i]); c.fillStyle = col || TXT; c.textAlign = k.a === 'r' ? 'right' : 'left';
      c.font = `${bold ? 800 : 600} ${fsz}px ${bold ? FS : FM}`; c.fillText(t, k.x, y);
    }
    y += rh;
  }
  if (!rows.length) { c.textAlign = 'center'; c.fillStyle = DIM; c.font = `500 20px ${FS}`; c.fillText('collecting data…', T.W / 2, T.H / 2 + 20); }
  c.textAlign = 'left';
}
const col_sym = x => ({h: 'COIN', x: 16, f: m => [m.b, TXT, 1]});
function drawScreens(d) {
  const a = d.a, [A, B, C] = d.mons;
  if (a.id === 'trader') return drawTraderScreens(d);
  if (a.id === 'rev') return drawReviewerScreens(d);
  if (a.id === 'smc') { try { return drawSmcScreens(d); } catch (_) { return; } } // may be called before the SMC code has loaded
  if (a.id === 'scout') {
    drawUnlockScreen(B, a.color);
    for (const [T, list, ttl] of [[A, S.gainers, 'TOP 5 GAINERS · PATTERN · TREND'], [C || B, S.losers, 'TOP 5 LOSERS · PATTERN · TREND']]) {
      const c = screenFrame(T, a.color, ttl);
      if (!list.length) { c.fillStyle = DIM; c.font = `500 20px ${FS}`; c.fillText('collecting data…', 300, 220); }
      list.slice(0, 5).forEach((s, i) => {
        const m = mget(s), tg = S.tagC.get(s), tr = S.trC.get(s), e = S.trk[s], y = 86 + i * 70;
        if (i % 2) { c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(0, y - 26, T.W, 70); }
        c.font = `800 26px ${FS}`; c.fillStyle = TXT; c.fillText(m.b.slice(0, 10), 16, y);
        c.font = `700 24px ${FM}`; c.fillStyle = tone(m.pct24); c.textAlign = 'right'; c.fillText(fmtPct(m.pct24), 330, y); c.textAlign = 'left';
        c.font = `800 17px ${FS}`; c.fillStyle = tg ? tg.c : DIM; c.fillText(tg ? tg.s : 'tagging…', 350, y);
        c.fillStyle = tr ? tr.state.c : DIM; c.textAlign = 'right'; c.fillText(tr ? tr.state.s : '…', 784, y);
        c.font = `500 15px ${FM}`; c.fillStyle = DIM;
        const mo = S.moC.get(s); if (tr && tr.known) { c.fillStyle = mo && mo.state.code === 2 ? mo.state.c : DIM; let ft = ''; try { const F = typeof fitList === 'function' ? fitList(s) : []; if (F.length) ft = ' · fit ' + F.map(([st, f]) => FIT_AB[st] + f.hit.length + '/' + f.of).join(' '); } catch (_) {} c.fillText(`rev ${tr.score}/8 · mom ${mo ? mo.score : 0}/8${ft}`, 784, y + 25); }
        c.textAlign = 'left'; if (e && fin(e.px0)) c.fillText(`since ${hhmm(e.t0)}: ${fmtPct((m.last / e.px0 - 1) * 100)}`, 16, y + 25);
        const u = unlCtx(s); if (u.phase && u.big) { c.font = `700 15px ${FS}`; c.fillStyle = u.phase === 'ahead' ? WARN : DIM; c.fillText(`UNLOCK ${unlWhen(u).toUpperCase()}`, 350, y + 25); }
      });
    }
  } else if (a.id === 'ivy') {
    const w = 'oi' + CFG.oiWindow;
    const have = S.universe.map(mget).filter(m => fin(m[w]));
    const up = [...have].sort((x, y) => y[w] - x[w]).filter(m => m[w] > 0), dn = [...have].sort((x, y) => x[w] - y[w]).filter(m => m[w] < 0);
    const hist = oiHistoryMins();
    for (const [T, list, ttl] of [[A, up, `OI SPIKES · Δ${CFG.oiWindow}M`], [B, dn, `OI DROPS · Δ${CFG.oiWindow}M`]]) {
      screenFrame(T, a.color, ttl, hist < CFG.oiWindow ? `warming ${Math.floor(hist)}/${CFG.oiWindow}m` : null);
      drawTable(T, [col_sym(), {h: 'OI $', x: 300, a: 'r', f: m => [fmtUsd(m.oiUsd), TXT]}, {h: 'Δ' + CFG.oiWindow + 'M', x: 450, a: 'r', f: m => [fmtPct(m[w]), tone(m[w])]}, {h: 'PRICE', x: 590, a: 'r', f: m => [fmtPct(m['oipx' + CFG.oiWindow]), tone(m['oipx' + CFG.oiWindow])]}, {h: 'Δ1H', x: 784, a: 'r', f: m => [fmtPct(m.oi60), tone(m.oi60)]}], list.slice(0, 11));
    }
  } else if (a.id === 'flo') {
    const have = S.universe.map(mget).filter(m => fin(m.net1h));
    const inn = [...have].sort((x, y) => y.net1h - x.net1h).filter(m => m.net1h > 0), out = [...have].sort((x, y) => x.net1h - y.net1h).filter(m => m.net1h < 0);
    for (const [T, list, ttl] of [[A, inn, 'MONEY IN · NET TAKER FLOW 1H'], [B, out, 'MONEY OUT · NET TAKER FLOW 1H']]) {
      screenFrame(T, a.color, ttl);
      drawTable(T, [col_sym(), {h: 'NET 1H', x: 320, a: 'r', f: m => [fmtUsd(m.net1h, 1), tone(m.net1h)]}, {h: 'B/S 1H', x: 450, a: 'r', f: m => [fmtRatio(m.ratio1h), tone((m.ratio1h || 1) - 1)]}, {h: 'FUNDING', x: 640, a: 'r', f: m => [fmtFund(m.fund), fin(m.fund) && Math.abs(m.fund) >= 0.0005 ? WARN : TXT]}, {h: '24H', x: 784, a: 'r', f: m => [fmtPct(m.pct24), tone(m.pct24)]}], list.slice(0, 11));
    }
  }
  d.mons.forEach(T => T.tex.needsUpdate = true);
}
function drawUnlockScreen(T, col) {
  const t = now(), L = unlAll().filter(e => e.t >= t - 864e5 && e.t - t <= 14 * 864e5);
  const c = screenFrame(T, col, 'TOKEN UNLOCKS · NEXT 14 DAYS', UNL.updated ? 'updated ' + UNL.updated.slice(5, 10) : '');
  if (!L.length) { c.font = `500 20px ${FS}`; c.fillStyle = DIM; c.fillText('No unlocks on the calendar for the next 14 days.', 16, 120); T.tex.needsUpdate = true; return; }
  const hot = new Set([...S.gainers.slice(0, 10), ...S.losers.slice(0, 10), ...Object.keys(S.trk), ...Object.keys(PT.pos), ...CFG.watch]);
  L.slice(0, 9).forEach((e, i) => {
    const y = 86 + i * 44, onA = S.meta.has(e.s), big = unlBig(e), d = (e.t - t) / 864e5;
    if (hot.has(e.s)) { c.fillStyle = 'rgba(255,201,77,.08)'; c.fillRect(0, y - 28, T.W, 42); }
    c.font = `600 18px ${FM}`; c.fillStyle = DIM; c.fillText(new Date(e.t).toISOString().slice(5, 10), 16, y);
    c.font = `800 22px ${FS}`; c.fillStyle = onA ? TXT : DIM; c.fillText(e.b.slice(0, 9), 100, y);
    c.font = `700 18px ${FM}`; c.fillStyle = d < 0 ? DIM : d <= 3 ? WARN : TXT; c.fillText(d < 0 ? 'today/passed' : 'in ' + (d < 1 ? Math.round(d * 24) + 'h' : d.toFixed(1) + 'd'), 250, y);
    c.font = `700 18px ${FS}`; c.fillStyle = big ? DN : DIM; c.fillText(unlSizeTxt(e).replace(' of circulating', ' circ'), 420, y);
    c.font = `500 14px ${FS}`; c.fillStyle = DIM; c.textAlign = 'right'; c.fillText(hot.has(e.s) ? 'ON YOUR RADAR' : onA ? 'on Aster' : 'not on Aster', T.W - 14, y); c.textAlign = 'left';
  });
  T.tex.needsUpdate = true;
}
// candles (15m) + OI line
function drawChart(c, x, y, w, h, s, fs = 13) {
  const k = S.kl.get(s); const pad = {l: 10, r: 70, t: 12, b: 22};
  c.save(); c.translate(x, y);
  if (!k || k.bars.length < 2) { c.fillStyle = DIM; c.font = `500 ${fs + 2}px ${FS}`; c.textAlign = 'center'; c.fillText('loading candles…', w / 2, h / 2); c.restore(); c.textAlign = 'left'; return; }
  const B = k.bars, n = B.length, live = (S.tk.get(s) || {}).last;
  let lo = Infinity, hi = -Infinity; for (const b of B) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); }
  if (fin(live)) { lo = Math.min(lo, live); hi = Math.max(hi, live); }
  const span = hi - lo || hi * 0.01 || 1; lo -= span * 0.05; hi += span * 0.05;
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b, bw = pw / n;
  const Y = v => pad.t + (hi - v) / (hi - lo) * ph, X = i => pad.l + i * bw + bw / 2;
  c.strokeStyle = 'rgba(124,137,168,.15)'; c.lineWidth = 1; c.font = `500 ${fs - 1}px ${FM}`; c.fillStyle = DIM; c.textAlign = 'left'; c.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4, yy = Y(v); c.beginPath(); c.moveTo(pad.l, yy); c.lineTo(pad.l + pw, yy); c.stroke(); c.fillText(fmtPx(v), pad.l + pw + 6, yy); }
  // flow bars (net taker per bar) at the bottom
  let mx = 1; for (const b of B) mx = Math.max(mx, Math.abs(2 * b[6] - b[5]));
  for (let i = 0; i < n; i++) { const net = 2 * B[i][6] - B[i][5], bh = Math.abs(net) / mx * ph * 0.18; c.fillStyle = net >= 0 ? 'rgba(46,229,157,.22)' : 'rgba(255,92,122,.22)'; c.fillRect(X(i) - bw * 0.35, pad.t + ph - bh, bw * 0.7, bh); }
  for (let i = 0; i < n; i++) {
    const [, o, hh, l, cl] = B[i], cc = i === n - 1 && fin(live) ? live : cl, up = cc >= o;
    c.strokeStyle = c.fillStyle = up ? UP : DN;
    c.beginPath(); c.moveTo(X(i), Y(hh)); c.lineTo(X(i), Y(l)); c.stroke();
    const top = Y(Math.max(o, cc)), bh = Math.max(1, Math.abs(Y(o) - Y(cc))); c.fillRect(X(i) - bw * 0.32, top, Math.max(1, bw * 0.64), bh);
  }
  // OI overlay
  const a = S.oi.get(s), t0 = B[0][0], t1 = B[n - 1][0] + 15 * 60e3;
  if (a && a.length > 1) {
    const pts = a.filter(p => p[0] >= t0);
    if (pts.length > 1) {
      let ol = Infinity, oh = -Infinity; for (const p of pts) { ol = Math.min(ol, p[1]); oh = Math.max(oh, p[1]); }
      const os = (oh - ol) || oh * 0.01 || 1; ol -= os * 0.1; oh += os * 0.1;
      c.strokeStyle = '#b48cff'; c.lineWidth = 2.2; c.beginPath();
      pts.forEach((p, i) => { const xx = pad.l + (p[0] - t0) / (t1 - t0) * pw, yy = pad.t + (oh - p[1]) / (oh - ol) * ph; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); });
      c.stroke(); c.fillStyle = '#b48cff'; c.font = `700 ${fs - 1}px ${FS}`; c.fillText('— OI', pad.l + 4, pad.t + 10);
    }
  }
  c.fillStyle = DIM; c.font = `500 ${fs - 2}px ${FM}`; c.textAlign = 'left'; c.fillText('15m · 24h', pad.l + 4, h - 8);
  c.textAlign = 'right'; c.fillText('bars = net taker flow', pad.l + pw, h - 8);
  c.restore(); c.textAlign = 'left';
}
function drawBoard() {
  const T = BOARD, c = T.ctx, W = T.W, H = T.H;
  c.fillStyle = '#04070f'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#0a1226'; c.fillRect(0, 0, W, 62);
  c.textBaseline = 'middle'; c.font = `800 34px ${FS}`; c.fillStyle = '#cfe0ff'; c.fillText('ASTER PERPS · DAILY MOVERS', 24, 32);
  c.font = `600 22px ${FM}`; c.fillStyle = DIM; c.textAlign = 'right';
  c.fillText(`${S.eligible.length} coins · ${CFG.smallCapOnly ? 'small caps' : 'all caps'} · vol ≥ ${fmtUsd(CFG.minVol)}   ${clock()}`, W - 24, 32); c.textAlign = 'left';
  const colW = W / 3;
  const cols = [[S.gainers, 'TOP GAINERS', UP, 0], [null, 'LATEST AGENT CALLS', '#6aa8ff', 1], [S.losers, 'TOP LOSERS', DN, 2]];
  for (const [list, ttl, color, i] of cols) {
    const x0 = i * colW + 24, xr = (i + 1) * colW - 24;
    c.fillStyle = color; c.font = `800 26px ${FS}`; c.fillText(ttl, x0, 92);
    c.fillStyle = color; c.fillRect(x0, 110, xr - x0, 3);
    if (list) {
      c.font = `600 15px ${FM}`; c.fillStyle = DIM; c.textAlign = 'right';
      c.fillText('24H', x0 + 300, 132); c.fillText('TREND', xr, 132); c.textAlign = 'left'; c.fillText('PATTERN', x0 + 322, 132);
      list.slice(0, 10).map(mget).forEach((m, j) => {
        const y = 168 + j * 46; if (j % 2) { c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(x0 - 8, y - 23, xr - x0 + 16, 46); }
        c.font = `800 26px ${FS}`; c.fillStyle = TXT; c.fillText(m.b.slice(0, 12), x0, y);
        c.font = `700 25px ${FM}`; c.textAlign = 'right';
        c.fillStyle = tone(m.pct24); c.fillText(fmtPct(m.pct24), x0 + 300, y);
        const tg = S.tagC.get(m.s), tr = S.trC.get(m.s);
        c.font = `800 19px ${FS}`; c.fillStyle = tr ? tr.state.c : DIM; c.fillText(tr ? tr.state.s : '…', xr, y);
        c.textAlign = 'left'; c.fillStyle = tg ? tg.c : DIM; c.fillText(tg ? tg.s : '…', x0 + 322, y);
      });
    } else {
      S.alerts.slice(0, 10).forEach((al, j) => {
        const y = 150 + j * 47, ag = AG[al.agent];
        c.fillStyle = ag.color; c.beginPath(); c.arc(x0 + 8, y, 7, 0, 7); c.fill();
        c.font = `600 18px ${FM}`; c.fillStyle = DIM; c.fillText(hhmm(al.t), x0 + 24, y);
        c.font = `600 20px ${FS}`; c.fillStyle = al.dir > 0 ? '#bdf5dc' : al.dir < 0 ? '#ffc4cf' : TXT;
        let t = al.text; while (c.measureText(t).width > xr - x0 - 90 && t.length > 4) t = t.slice(0, -2);
        c.fillText(t === al.text ? t : t + '…', x0 + 88, y);
      });
      if (!S.alerts.length) { c.font = `500 22px ${FS}`; c.fillStyle = DIM; c.fillText('Agents are watching. Alerts land here.', x0, 160); }
    }
  }
  T.tex.needsUpdate = true;
}
function drawTicker() {
  const T = TICKER, c = T.ctx; c.fillStyle = '#060a16'; c.fillRect(0, 0, T.W, T.H);
  const items = [...S.gainers.slice(0, 12), ...S.losers.slice(0, 12)].map(mget);
  if (!items.length) { T.tex.needsUpdate = true; return; }
  c.textBaseline = 'middle'; let x = 20, i = 0;
  while (x < T.W) { const m = items[i++ % items.length]; c.font = `800 38px ${FS}`; c.fillStyle = TXT; c.fillText(m.b, x, 40); x += c.measureText(m.b).width + 12; c.font = `700 36px ${FM}`; c.fillStyle = tone(m.pct24); const t = fmtPct(m.pct24) + '   ·   '; c.fillText(t, x, 40); x += c.measureText(t).width; }
  T.tex.needsUpdate = true;
}

/* ================= HUD ================= */
function sayFor(agentId, text) {
  const d = desks.find(x => x.a.id === agentId); if (!d) return;
  drawBubble(d.bub, text, d.a.color); d.bub.sp.visible = true; d.bub.until = now() + 9000; d.pulse = 1;
}
let audioCtx = null;
function beep(dir) {
  if (!CFG.sound || !audioCtx) return;
  try { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = dir > 0 ? 880 : dir < 0 ? 440 : 660; g.gain.setValueAtTime(0.06, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25); o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.26); } catch (_) {}
}
onAlert = a => { sayFor(a.agent, a.text); renderFeed(); beep(a.dir); if (a.big) { beep(a.dir); if (CFG.notify) try { if (Notification.permission === 'granted') new Notification('Aster Desk · reversal watch', {body: a.text}); } catch (_) {} } };
let feedSeen = 0;
function renderFeed() {
  const seen = feedSeen; feedSeen = S.alerts.length ? S.alerts[0].t : feedSeen;
  $('#feedL').innerHTML = S.alerts.slice(0, 6).map(a => { const g = AG[a.agent]; return `<div class="al${a.t > seen ? ' nw' : ''}" style="--c:${g.color}" data-sym="${a.s}"><span class="t">${hhmm(a.t)}</span><span><span class="a">${g.name}</span> · ${esc(a.text)}</span></div>`; }).join('');
  $('#feedN').textContent = S.alerts.length ? S.alerts.length + ' today' : '';
}
$('#chkBtn').addEventListener('click', () => { if (started) openPanel('check'); });
$('#feedL').addEventListener('click', e => { const el = e.target.closest('[data-sym]'); if (el && S.meta.has(el.dataset.sym)) openCheck(el.dataset.sym); });
function topbar() {
  const rest = $('#dRest'), w = $('#dWs');
  rest.className = S.restOk === true ? 'ok' : S.restOk === false ? 'bad' : 'mid';
  w.className = S.wsOk && now() - S.wsLast < 10e3 ? 'ok' : S.wsOk ? 'mid' : 'bad';
  $('#sMk').textContent = `${S.meta.size} mkts · ${S.eligible.length} in filter · ${S.reqs} calls`;
  const h = oiHistoryMins(); $('#sOi').textContent = 'OI history ' + (h < 60 ? Math.floor(h) + 'm' : (h / 60).toFixed(1) + 'h');
  $('#clock').textContent = clock();
}

/* ================= PANELS ================= */
const PS = {open: null, tab: {}, sort: {}};
const TABS = {
  scout: [['t', 'Day tracker'], ['g', 'Top gainers'], ['l', 'Top losers'], ['u', 'Unlock calendar'], ['w', 'Watchlist'], ['set', 'Settings']],
  ivy: [['up', 'OI spikes'], ['dn', 'OI drops'], ['all', 'All coins']],
  flo: [['in', 'Money in'], ['out', 'Money out'], ['lp', 'Buy pressure'], ['sp', 'Sell pressure'], ['fd', 'Funding extremes'], ['wh', 'Whale trades'], ['lq', 'Liquidations']],
};
const star = s => `<span class="star ${CFG.watch.includes(s) ? 'on' : ''}" data-star="${s}">★</span>`;
const td = (v, c = '') => `<td class="${c}">${v}</td>`;
const C = {
  star: {h: '', f: m => star(m.s)},
  coin: {h: 'Coin', v: m => m.b, f: m => `<td class="sym">${esc(m.b)}${S.meta.get(m.s) && S.meta.get(m.s).stock ? ' <span class="tag dim">stock</span>' : ''}</td>`},
  price: {h: 'Price', v: m => m.last, f: m => td(fmtPx(m.last))},
  p24: {h: '24h', v: m => m.pct24, f: m => td(fmtPct(m.pct24), cls(m.pct24))},
  p1: {h: '1h', v: m => m.pct1h, f: m => td(fmtPct(m.pct1h), cls(m.pct1h))},
  p4: {h: '4h', v: m => m.pct4h, f: m => td(fmtPct(m.pct4h), cls(m.pct4h))},
  vol: {h: 'Vol 24h', v: m => m.qv, f: m => td(fmtUsd(m.qv))},
  oiu: {h: 'OI $', v: m => m.oiUsd, f: m => td(fmtUsd(m.oiUsd))},
  oi5: {h: 'OI Δ5m', v: m => m.oi5, f: m => td(fmtPct(m.oi5), cls(m.oi5))},
  oi15: {h: 'OI Δ15m', v: m => m.oi15, f: m => td(fmtPct(m.oi15), cls(m.oi15))},
  oi60: {h: 'OI Δ1h', v: m => m.oi60, f: m => td(fmtPct(m.oi60), cls(m.oi60))},
  oi240: {h: 'OI Δ4h', v: m => m.oi240, f: m => td(fmtPct(m.oi240), cls(m.oi240))},
  reg: {h: 'Read', f: m => { const r = regime(m); return td(r ? `<span class="tag" style="color:${r.tone}">${r.label}</span>` : '<span class="dim">…</span>'); }},
  n15: {h: 'Net 15m', v: m => m.net15, f: m => td(fmtUsd(m.net15, 1), cls(m.net15))},
  n1: {h: 'Net 1h', v: m => m.net1h, f: m => td(fmtUsd(m.net1h, 1), cls(m.net1h))},
  n4: {h: 'Net 4h', v: m => m.net4h, f: m => td(fmtUsd(m.net4h, 1), cls(m.net4h))},
  n24: {h: 'Net 24h', v: m => m.net24, f: m => td(fmtUsd(m.net24, 1), cls(m.net24))},
  v1: {h: 'Vol 1h', v: m => m.vol1h, f: m => td(fmtUsd(m.vol1h))},
  r1: {h: 'Taker B/S 1h', v: m => m.ratio1h, f: m => td(fmtRatio(m.ratio1h), cls((m.ratio1h || 1) - 1))},
  r4: {h: 'B/S 4h', v: m => m.ratio4h, f: m => td(fmtRatio(m.ratio4h), cls((m.ratio4h || 1) - 1))},
  fund: {h: 'Funding', v: m => m.fund, f: m => td(fmtFund(m.fund), fin(m.fund) && Math.abs(m.fund) >= 0.0005 ? 'warn' : '')},
  nxt: {h: 'Next funding', v: m => m.next, f: m => td(fin(m.next) && m.next > now() ? ago(2 * now() - m.next).replace(/^/, 'in ') : '—', 'dim')},
  crowd: {h: 'Positioning', f: m => td(crowdTag(m))},
  tag: {h: 'Pattern', f: m => { const t = S.tagC.get(m.s); return td(t ? `<span class="tag" style="color:${t.c}" title="${esc(t.d)}">${t.l}</span>` : '<span class="dim">—</span>'); }},
  trend: {h: 'Trend now', v: m => { const r = S.trC.get(m.s); return r ? r.state.code * 10 + r.score : null; }, f: m => { const r = S.trC.get(m.s); return td(r && r.key !== 'wait' ? `<span class="tag" style="color:${r.state.c}">${r.state.l}</span> <span class="dim">${r.score}/8</span>` : '<span class="dim">—</span>'); }},
  mom: {h: 'Momentum', v: m => { const r = S.moC.get(m.s); return r ? r.state.code * 10 + r.score : null; }, f: m => { const r = S.moC.get(m.s); return td(r && r.key !== 'wait' ? `<span class="tag" style="color:${r.state.c}">${r.state.l}</span> <span class="dim">${r.score}/8</span>` : '<span class="dim">—</span>'); }},
  unl: {h: 'Unlock', v: m => { const u = unlCtx(m.s); return u.phase === 'ahead' ? -u.days : null; }, f: m => { const u = unlCtx(m.s); return td(u.phase ? `<span class="tag" style="color:${u.big ? (u.phase === 'ahead' ? WARN : DIM) : DIM}" title="${esc(unlLabel(u))}">${u.phase === 'ahead' ? '🔓 ' : ''}${unlWhen(u)}</span>` : '<span class="dim">—</span>'); }},
};
function crowdTag(m) {
  const t = (txt, c) => `<span class="tag" style="color:${c}">${txt}</span>`;
  if (fin(m.fund) && m.fund >= 0.0005) return t('Longs crowded', WARN);
  if (fin(m.fund) && m.fund <= -0.0005) return t('Shorts crowded', '#4dd2ff');
  if (fin(m.ratio1h) && m.ratio1h >= 1.3) return t('Buyers aggressive', UP);
  if (fin(m.ratio1h) && m.ratio1h <= 0.77) return t('Sellers aggressive', DN);
  return fin(m.ratio1h) ? t('Balanced', DIM) : '<span class="dim">…</span>';
}
function table(id, cols, rows, defSort) {
  const st = PS.sort[id] || defSort || {};
  if (st.k && C[st.k] && C[st.k].v) { const v = C[st.k].v; rows = [...rows].sort((a, b) => { const x = v(a), y = v(b); if (!fin(x)) return 1; if (!fin(y)) return -1; return st.d * (y - x); }); }
  if (!rows.length) return '<div class="empty">Collecting data — agents fill this in within a minute or two.</div>';
  return `<table class="t"><thead><tr>${cols.map(k => `<th data-sort="${k}" data-tid="${id}" class="${st.k === k ? 's' : ''}">${C[k].h}${st.k === k ? (st.d > 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${rows.map(m => `<tr data-sym="${m.s}">${cols.map(k => { const r = C[k].f(m); return r.startsWith('<td') ? r : `<td>${r}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
function filterNote() {
  return `Filter: USDT perps with 24h volume ≥ <b>${fmtUsd(CFG.minVol)}</b>${CFG.smallCapOnly ? ', excluding Aster\'s 17 "Top" coins (BTC, ETH, SOL…)' : ''}${CFG.includeStocks ? '' : ', stock perps hidden'} — <b>${S.eligible.length}</b> coins. Change it in GainerLoser → Settings. Click any row for a full coin check.`;
}
function renderPanel() {
  const id = PS.open; if (!id) return;
  if (typeof RVP !== 'undefined' && RVP.drag) return;                       // don't rebuild the chart in the middle of a drag
  const ae = document.activeElement; if (ae && $('#pbody').contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return; // don't wipe a field being edited
  const tab = PS.tab[id], body = $('#pbody'), sc = body.scrollTop;
  const um = () => S.universe.map(mget);
  let h = '';
  if (id === 'scout') {
    if (tab === 't') h += trackerHTML(); else if (tab === 'u') h += unlocksHTML(); else if (tab === 'set') h += settingsHTML(); else {
    h += `<p class="note">${filterNote()} Pattern, reversal and momentum are read for the top 10 on each side.</p>`;
    const list = tab === 'g' ? S.gainers : tab === 'l' ? S.losers : CFG.watch.filter(s => S.meta.has(s));
    h += table('scout' + tab, ['star', 'coin', 'price', 'p24', 'p1', 'p4', 'tag', 'trend', 'mom', 'fit', 'unl', 'vol', 'oi60', 'n1', 'fund'], list.map(mget)); }
    if (tab === 'w' && !CFG.watch.length) h += '<div class="empty">Star coins (★) anywhere to add them here.</div>';
  } else if (id === 'ivy') {
    const hm = oiHistoryMins();
    h += `<p class="note">Aster has no open-interest history API, so <b>the OpenInterest agent records a snapshot of every coin's OI every 30s–2min</b> while this page is open and keeps 26h of it in this browser. History so far: <b>${hm < 60 ? Math.floor(hm) + ' min' : (hm / 60).toFixed(1) + ' h'}</b>${hm < 60 ? ' — Δ1h and Δ4h columns fill in as it grows' : ''}. Alerts fire when OI moves ≥ <b>${CFG.oiAlertPct}%</b> in <b>${CFG.oiWindow} min</b>. "Read" pairs the OI change with the price change.</p>`;
    const w = 'oi' + CFG.oiWindow, rows = um().filter(m => fin(m.oi));
    if (tab === 'up') h += table('ivyup', ['star', 'coin', 'price', 'oiu', 'oi5', 'oi15', 'oi60', 'oi240', 'p1', 'reg'], rows.filter(m => m[w] > 0), {k: w, d: 1});
    else if (tab === 'dn') h += table('ivydn', ['star', 'coin', 'price', 'oiu', 'oi5', 'oi15', 'oi60', 'oi240', 'p1', 'reg'], rows.filter(m => m[w] < 0), {k: w, d: -1});
    else h += table('ivyall', ['star', 'coin', 'price', 'p24', 'oiu', 'oi5', 'oi15', 'oi60', 'oi240', 'reg'], rows, {k: 'oiu', d: 1});
  } else if (id === 'flo') {
    if (tab === 'in' || tab === 'out') {
      h += `<p class="note"><b>Net flow</b> = market-buy volume − market-sell volume (taker side), from 15-minute candles. Positive = buyers lifting offers (money flowing in); negative = sellers hitting bids. Alerts fire when one 15m candle shows ≥ <b>${fmtUsd(CFG.flowAlertUsd)}</b> net and ≥30% of its volume.</p>`;
      const rows = um().filter(m => fin(m.net1h));
      h += tab === 'in' ? table('floin', ['star', 'coin', 'price', 'p24', 'n15', 'n1', 'n4', 'n24', 'r1', 'v1'], rows.filter(m => m.net1h > 0), {k: 'n1', d: 1})
                        : table('floout', ['star', 'coin', 'price', 'p24', 'n15', 'n1', 'n4', 'n24', 'r1', 'v1'], rows.filter(m => m.net1h < 0), {k: 'n1', d: -1});
    } else if (tab === 'wh') {
      h += `<p class="note">Single market orders ≥ <b>${fmtUsd(CFG.whaleUsd)}</b> on the ~40 coins in focus (top movers, watchlist, focus coin), streamed live. Change the threshold in GainerLoser → Settings.</p>`;
      h += S.whales.length ? `<table class="t"><thead><tr><th>Time</th><th>Coin</th><th>Side</th><th>Size</th><th>Price</th><th>24h</th></tr></thead><tbody>${S.whales.slice(0, 120).map(w => { const m = mget(w.s); return `<tr data-sym="${w.s}"><td class="dim">${new Date(w.t).toTimeString().slice(0, 8)}</td><td class="sym">${esc(base(w.s))}</td><td class="${w.side === 'BUY' ? 'up' : 'dn'}">${w.side}</td><td>${fmtUsd(w.usd)}</td><td>${fmtPx(w.px)}</td><td class="${cls(m.pct24)}">${fmtPct(m.pct24)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No whale prints yet in this session.</div>';
    } else if (tab === 'lq') {
      h += `<p class="note">Forced liquidations across all Aster markets, streamed live. Long liquidations = forced selling; short liquidations = forced buying.</p>`;
      h += S.liqs.length ? `<table class="t"><thead><tr><th>Time</th><th>Coin</th><th>Liquidated</th><th>Size</th><th>Price</th></tr></thead><tbody>${S.liqs.slice(0, 120).map(l => `<tr data-sym="${l.s}"><td class="dim">${new Date(l.t).toTimeString().slice(0, 8)}</td><td class="sym">${esc(base(l.s))}</td><td class="${l.side === 'LONG' ? 'dn' : 'up'}">${l.side === 'LONG' ? 'Longs' : 'Shorts'}</td><td>${fmtUsd(l.usd)}</td><td>${fmtPx(l.px)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No liquidations seen yet in this session.</div>';
    } else {
      h += `<p class="note">Aster doesn't publish an account long/short ratio. Flow reads positioning from two things it does publish: <b>taker buy/sell ratio</b> (who is hitting the market — above 1× means market buyers dominate) and <b>funding</b> (positive = longs pay shorts, so longs are the crowded side). Funding beyond ±0.05% per interval is highlighted.</p>`;
      const rows = um().filter(m => fin(m.ratio1h) && m.vol1h > 5e3);
      if (tab === 'lp') h += table('sagelp', ['star', 'coin', 'price', 'p24', 'p1', 'r1', 'r4', 'fund', 'nxt', 'crowd'], rows.filter(m => m.ratio1h > 1), {k: 'r1', d: 1});
      else if (tab === 'sp') h += table('sagesp', ['star', 'coin', 'price', 'p24', 'p1', 'r1', 'r4', 'fund', 'nxt', 'crowd'], rows.filter(m => m.ratio1h < 1), {k: 'r1', d: -1});
      else { const fr = S.eligible.map(mget).filter(m => fin(m.fund) && Math.abs(m.fund) >= 0.0003); h += table('sagefd', ['star', 'coin', 'price', 'p24', 'fund', 'nxt', 'r1', 'crowd'], fr, {k: 'fund', d: 1}); }
    }
  } else if (id === 'check') {
    h += checkHTML();
  } else if (id === 'trader') {
    h += tab === 'cmp' ? compareHTML() : traderHTML(tab);
  } else if (id === 'smc') {
    h += smcHTML(tab);
  } else if (id === 'rev') {
    h += reviewerHTML(tab);
  } else if (id === 'sync') {
    h += syncHTML();
  }
  if ((id === 'ivy' || id === 'flo' || (id === 'scout' && ['g', 'l', 'w'].includes(tab))) && typeof critAgentCard === 'function') { try { h = critAgentCard(id) + h; } catch (e) { console.warn('criteria card', e.message); } }
  if ((id === 'trader' || id === 'rev' || id === 'smc') && syViewer()) h = syBanner() + h;
  body.innerHTML = h; body.scrollTop = sc;
  if (id === 'scout' && tab === 'set') bindSettings();
  body.querySelectorAll('canvas[data-spark]').forEach(drawSpark);
  body.querySelectorAll('canvas[data-smc]').forEach(cv => smWith(id === 'smc' && SMV === 'sb' ? SB : SM, () => drawSmcChart(cv)));
  body.querySelectorAll('canvas[data-rvchart]').forEach(cv => { try { drawRvCanvas(cv); } catch (e) { console.warn('rvchart', e.message); } });
  body.querySelectorAll('canvas.cmpchart').forEach(cv => { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); cv.width = r.width * dpr; cv.height = r.height * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); drawCmp(c, 0, 0, r.width, r.height, 11); });
  body.querySelectorAll('canvas.ptchart').forEach(cv => { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); cv.width = r.width * dpr; cv.height = r.height * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); drawEq(c, 0, 0, r.width, r.height, 11); });
  const cv = body.querySelector('canvas.chart');
  if (cv && S.focus) { const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); cv.width = r.width * dpr; cv.height = r.height * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); c.fillStyle = '#060a14'; c.fillRect(0, 0, r.width, r.height); drawChart(c, 0, 0, r.width, r.height, S.focus, 13); }
}
function settingsHTML() {
  return `<p class="note">Filters and alert thresholds for every desk. Changes apply right away and sync to your other computers. The day tracker (and so both traders) follows the <b>top 5 gainers and losers among coins with at least ${fmtUsd(CFG.trkMinVol)} of 24h volume that moved ${CFG.trkMinMove}% or more</b>; the boards still list every coin above the first volume filter.</p><div class="card2"><h3>FILTERS & ALERTS</h3><div class="set">
  <label>Min 24h volume (USD)<input type="number" id="cMin" step="50000" min="0" value="${CFG.minVol}"></label>
  <label>Track movers with 24h volume ≥ (USD)<input type="number" id="cTv" step="50000" min="0" value="${CFG.trkMinVol}"></label>
  <label>Track movers that moved at least (%)<input type="number" id="cTm" step="1" min="0" value="${CFG.trkMinMove}"></label>
  <label>OI alert: move ≥ %<input type="number" id="cOiP" step="1" min="1" value="${CFG.oiAlertPct}"></label>
  <label>OI alert window<select id="cOiW">${[5, 15, 60].map(w => `<option value="${w}" ${CFG.oiWindow === w ? 'selected' : ''}>${w} min</option>`).join('')}</select></label>
  <label>Whale print ≥ (USD)<input type="number" id="cWh" step="10000" min="5000" value="${CFG.whaleUsd}"></label>
  <label>Flow alert: net 15m ≥ (USD)<input type="number" id="cFl" step="25000" min="10000" value="${CFG.flowAlertUsd}"></label>
  <label class="cb"><input type="checkbox" id="cSm" ${CFG.smallCapOnly ? 'checked' : ''}>Small caps only (hide Top 17)</label>
  <label class="cb"><input type="checkbox" id="cSt" ${CFG.includeStocks ? 'checked' : ''}>Include stock perps</label>
  <label class="cb"><input type="checkbox" id="cSnd" ${CFG.sound ? 'checked' : ''}>Alert sound</label>
  <label class="cb"><input type="checkbox" id="cNt" ${CFG.notify ? 'checked' : ''}>Desktop notification on reversals</label>
  </div></div>`;
}
function bindSettings() {
  const num = (id, k) => $(id).onchange = e => { const v = +e.target.value; if (fin(v)) { CFG[k] = v; saveCfg(); recomputeUniverse(); renderPanel(); } };
  num('#cMin', 'minVol'); num('#cTv', 'trkMinVol'); num('#cTm', 'trkMinMove'); num('#cOiP', 'oiAlertPct'); num('#cWh', 'whaleUsd'); num('#cFl', 'flowAlertUsd');
  $('#cOiW').onchange = e => { CFG.oiWindow = +e.target.value; saveCfg(); renderPanel(); };
  $('#cSm').onchange = e => { CFG.smallCapOnly = e.target.checked; saveCfg(); recomputeUniverse(); renderPanel(); };
  $('#cSt').onchange = e => { CFG.includeStocks = e.target.checked; saveCfg(); recomputeUniverse(); renderPanel(); };
  $('#cNt').onchange = async e => { CFG.notify = e.target.checked; saveCfg(); if (CFG.notify) { try { const p = await Notification.requestPermission(); if (p !== 'granted') { e.target.checked = CFG.notify = false; saveCfg(); $('#cNt').parentElement.title = 'Your browser blocked notifications for this page'; } } catch (_) { e.target.checked = CFG.notify = false; saveCfg(); } } };
  $('#cSnd').onchange = e => { CFG.sound = e.target.checked; saveCfg(); if (CFG.sound && !audioCtx) try { audioCtx = new AudioContext(); } catch (_) {} };
}
function setTabs() {
  const id = PS.open;
  $('#pTabs').innerHTML = (id === 'smc' ? smcTabs() : TABS[id]).map(([k, l]) => `<div class="tab ${PS.tab[id] === k ? 'on' : ''}" data-tab="${k}">${l}</div>`).join('')
    + `<div class="navs" style="margin-left:14px">${AGENTS.map(a => `<div class="nav ${a.id === id ? 'on' : ''}" style="--nc:${a.color}" data-nav="${a.id}" title="${a.name}">${a.key}</div>`).join('')}<div class="nav ${id === 'check' ? 'on' : ''}" style="--nc:#6aa8ff;width:auto;padding:0 9px" data-nav="check" title="Check any coin (C)">C · Check</div></div>`;
}
function focusCoin(s) { if (setFocus(s, true)) sayFor('scout', `Pulling up ${base(s)}: checking OI, flow, funding and unlocks.`); }
function openCheck(s) { if (!S.meta.has(s)) return; if (PS.open !== 'check') openPanel('check'); checkCoin(s); $('#pstatic').innerHTML = checkStatic(); bindCheckStatic(); renderPanel(); setTimeout(() => speakAll(s), 5000); }
function openPanel(id, sym) {
  try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (_) {}
  if (document.pointerLockElement) document.exitPointerLock();
  if (sym) focusCoin(sym);
  PS.open = id; if (!PS.tab[id]) PS.tab[id] = TABS[id][0][0];
  const a = AG[id] || (id === 'sync' ? SYNCA : CHECKA), p = $('#panel'); p.style.setProperty('--c', a.color);
  $('#pAv').textContent = a.name[0]; $('#pTtl').innerHTML = `${a.name}<small>${a.role} — ${a.blurb}</small>`;
  setTabs();
  $('#pstatic').innerHTML = id === 'check' ? checkStatic() : '';
  if (id === 'check') bindCheckStatic();
  $('#pbody').scrollTop = 0; p.classList.add('open'); if (id === 'check') try { $('#kSym').focus(); } catch (_) {} $('#hint').style.display = 'none'; $('#feed').style.display = 'none'; $('#chkBtn').style.display = 'none';
  renderPanel();
}
function closePanel() { PS.open = null; $('#panel').classList.remove('open'); $('#feed').style.display = ''; $('#chkBtn').style.display = ''; $('#hint').style.display = started && !document.pointerLockElement ? 'block' : 'none'; }
$('#pX').onclick = closePanel;
$('#panel').addEventListener('click', e => {
  const st = e.target.closest('[data-star]');
  if (st) { const s = st.dataset.star, i = CFG.watch.indexOf(s); if (i >= 0) CFG.watch.splice(i, 1); else CFG.watch.push(s); saveCfg(); recomputeUniverse(); renderPanel(); return; }
  const tb = e.target.closest('[data-tab]'); if (tb) { PS.tab[PS.open] = tb.dataset.tab; setTabs(); $('#pbody').scrollTop = 0; renderPanel(); return; }
  const nv = e.target.closest('[data-nav]'); if (nv) { openPanel(nv.dataset.nav); return; }
  const th = e.target.closest('th[data-sort]');
  if (th) { const id = th.dataset.tid, k = th.dataset.sort; if (!C[k].v) return; const cur = PS.sort[id] || {}; PS.sort[id] = {k, d: cur.k === k ? -cur.d : 1}; renderPanel(); return; }
  const ch = e.target.closest('.chip[data-sym]'); if (ch) { openCheck(ch.dataset.sym); return; }
  const tf = e.target.closest('[data-tf]'); if (tf) { PS.trkF = tf.dataset.tf; renderPanel(); return; }
  const ut = e.target.closest('[data-track]'); if (ut) { const s = ut.dataset.track; trackManual(s, !S.trk[s]); renderPanel(); return; }
  const kc = e.target.closest('[data-chk]'); if (kc) { openCheck(kc.dataset.chk); return; }
  const ua = e.target.closest('[data-unl-add]'); if (ua) { unlAddFromForm(); return; }
  const ud = e.target.closest('[data-unl-del]'); if (ud) { CFG.unl.splice(+ud.dataset.unlDel, 1); saveCfg(); renderPanel(); return; }
  const uf = e.target.closest('[data-uf]'); if (uf) { PS.unlF = uf.dataset.uf; renderPanel(); return; }
  if (e.target.id === 'kSay') { e.preventDefault(); if (CHK.sym) speakAll(CHK.sym); return; }
  const tr = e.target.closest('tr[data-sym]'); if (tr && S.meta.has(tr.dataset.sym)) openCheck(tr.dataset.sym);
});

/* ================= INPUT ================= */
let started = false, dragging = false;
function lockPointer() { if (PS.open || !started) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
canvas.addEventListener('click', e => {
  // clicking the "review it yourself" button on the review wall (crosshair when looking around, else the mouse)
  try {
    if (started && !PS.open && typeof RWS !== 'undefined' && RWS.hold && RWS.btn) {
      const r = canvas.getBoundingClientRect(), lk = !!document.pointerLockElement;
      const q = wallPoint(lk ? 0 : ((e.clientX - r.left) / r.width) * 2 - 1, lk ? 0 : -((e.clientY - r.top) / r.height) * 2 + 1), b = RWS.btn;
      if (q && q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) { openMineFromWall(); return; }
    }
  } catch (_) {}
  lockPointer();
});
canvas.addEventListener('mousedown', () => { if (!document.pointerLockElement) dragging = true; });
addEventListener('mouseup', () => dragging = false);
let lockAt = 0;
addEventListener('mousemove', e => {
  if (PS.open) return;
  if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250 || performance.now() - lockAt < 120) return; // Chrome lock-jump quirk
  if (document.pointerLockElement === canvas || dragging) {
    const k = document.pointerLockElement ? 0.0022 : 0.004;
    P.yaw -= e.movementX * k; P.pitch = clamp(P.pitch - e.movementY * k, -1.35, 1.35);
  }
});
document.addEventListener('pointerlockchange', () => { lockAt = performance.now(); $('#hint').style.display = started && !document.pointerLockElement && !PS.open ? 'block' : 'none'; });
addEventListener('keydown', e => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape') { if (PS.open) closePanel(); return; }
  if (!started) return;
  const a = AGENTS.find(x => x.key === e.key);
  if (a) { const d = desks.find(x => x.a.id === a.id); teleportTo(d); openPanel(a.id); e.preventDefault(); return; }
  if (e.key === 'c' || e.key === 'C') { openPanel('check'); e.preventDefault(); return; }
  if (e.key === 'b' || e.key === 'B') { if (PS.open) closePanel(); P.x = SWALL_X; P.z = RZ - 6.2; P.yaw = Math.PI; P.pitch = 0.06; e.preventDefault(); return; } // SMC wall (back)
  if (e.key === 'v' || e.key === 'V') { if (PS.open) closePanel(); P.x = -RX + 6.5; P.z = RWALL_Z; P.yaw = Math.PI / 2; P.pitch = 0.04; e.preventDefault(); return; } // review wall
  if ((e.key === 'e' || e.key === 'E') && !PS.open && target) { openPanel(target.a.id); return; }
  if (!PS.open && typeof RWS !== 'undefined' && RWS.hold) { // standing at the review wall
    if (e.key === 'e' || e.key === 'E') { openMineFromWall(); return; }
    if (e.key === '[' || e.key === ']') { wallStep(e.key === ']' ? 1 : -1); e.preventDefault(); return; }
    if (e.key === 't' || e.key === 'T') { rvTagsToggle(); e.preventDefault(); return; }
  }
  if (PS.open) return;
  keys[e.code] = true;
  if (e.code === 'Tab') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

/* ================= MAIN LOOP ================= */
let target = null, last = performance.now(), deskIdx = 0, acc = {board: 0, desk: 0, ticker: 99, hud: 0, panel: 0};
const tmpV = new THREE.Vector3(), fwdV = new THREE.Vector3();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  // movement
  const mv = !PS.open && started;
  const f = mv ? ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0) : 0;
  const r = mv ? ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) : 0;
  const sp = keys.ShiftLeft || keys.ShiftRight ? 6 : 3.2;
  let tx = (-Math.sin(P.yaw) * f + Math.cos(P.yaw) * r), tz = (-Math.cos(P.yaw) * f - Math.sin(P.yaw) * r);
  const L = Math.hypot(tx, tz) || 1; tx = tx / L * sp * (f || r ? 1 : 0); tz = tz / L * sp * (f || r ? 1 : 0);
  const k = 1 - Math.exp(-10 * dt); P.vx += (tx - P.vx) * k; P.vz += (tz - P.vz) * k;
  [P.x, P.z] = collide(P.x + P.vx * dt, P.z + P.vz * dt);
  const spd = Math.hypot(P.vx, P.vz); P.bob += spd * dt * 2.2;
  camera.position.set(P.x, 1.66 + Math.sin(P.bob * 2.6) * 0.025 * Math.min(1, spd / 3), P.z);
  camera.rotation.set(P.pitch, P.yaw, 0);
  // interaction target
  camera.getWorldDirection(fwdV); target = null; let best = 0.8;
  for (const d of desks) {
    tmpV.copy(d.hit).sub(camera.position); const dist = tmpV.length(); if (dist > 4.6) continue;
    const dot = tmpV.normalize().dot(fwdV); if (dot > best) { best = dot; target = d; }
  }
  const pr = $('#prompt');
  let wallNow = false; try { wallNow = !target && typeof atWall === 'function' && atWall(); } catch (_) {}
  if (typeof RWS !== 'undefined' && RWS.hold !== wallNow) { RWS.hold = wallNow; try { drawReviewWall(); } catch (_) {} }
  if (target && !PS.open && started) { pr.style.display = 'block'; pr.innerHTML = `<span class="kbd">E</span> Talk to <span class="who" style="color:${target.a.color}">${target.a.name}</span> · ${target.a.role}`; }
  else if (wallNow && RWS.cur) { pr.style.display = 'block'; pr.innerHTML = `<span class="kbd">E</span> Review <span class="who" style="color:#ff8ad8">${esc(RWS.cur[1].b)}</span> yourself · <span class="kbd">[</span> <span class="kbd">]</span> previous / next trade`; }
  else pr.style.display = 'none';
  // agents
  const ts = t / 1000;
  for (const d of desks) {
    const i = AGENTS.indexOf(d.a);
    d.ag.arms[0].rotation.x = -0.62 + Math.sin(ts * 9 + i) * 0.05; d.ag.arms[1].rotation.x = -0.62 + Math.sin(ts * 9 + i + 1.7) * 0.05;
    tmpV.set(P.x, 0, P.z); const lp = tmpV.clone(); d.ag.g.worldToLocal(lp);
    const near = Math.hypot(lp.x, lp.z) < 4.2;
    let want = near ? Math.atan2(-lp.x, -lp.z) : Math.sin(ts * 0.4 + i * 2) * 0.25;
    want = clamp(want, -1.2, 1.2); d.look += (want - d.look) * Math.min(1, dt * 4); d.ag.head.rotation.y = d.look;
    d.ag.head.position.y = 1.33 + Math.sin(ts * 1.6 + i) * 0.008;
    d.pulse = Math.max(0, d.pulse - dt * 0.6);
    const s = 1 + d.pulse * 1.6 + Math.sin(ts * 3 + i) * 0.08; d.orb.scale.setScalar(s);
    d.ring.material.opacity = 0.28 + d.pulse * 0.6 + (d === target ? 0.35 : 0);
    if (d.bub.sp.visible && now() > d.bub.until) d.bub.sp.visible = false;
  }
  if (Math.random() < 0.5) for (let n = 0; n < 4; n++) { const l = LEDS[(Math.random() * LEDS.length) | 0]; l.visible = now() - S.lastReq < 1500 ? Math.random() < 0.6 : Math.random() < 0.85; }
  TICKER.tex.offset.x = (TICKER.tex.offset.x + dt * 0.018) % 1;
  // periodic redraws
  acc.board += dt; acc.desk += dt; acc.ticker += dt; acc.hud += dt; acc.panel += dt;
  if (acc.board > 2) { acc.board = 0; drawBoard(); drawWall(); try { drawSmWall(); drawRace(); } catch (e) { console.warn('smc wall', e.message); } try { drawReviewWall(); } catch (e) { console.warn('review wall', e.message); } }
  if (acc.desk > 0.3) { acc.desk = 0; const d = desks[deskIdx++ % desks.length]; try { drawScreens(d); } catch (e) { console.warn('screen', d.a.id, e.message); } }
  if (acc.ticker > 15) { acc.ticker = 0; drawTicker(); }
  if (acc.hud > 1) { acc.hud = 0; topbar(); }
  if (acc.panel > 2 && PS.open) { acc.panel = 0; renderPanel(); }
  renderer.render(scene, camera);
}

/* ================= BOOT ================= */
$('#agentCards').innerHTML = AGENTS.map(a => `<div style="--c:${a.color}"><b>${a.name} <span class="kbd" style="float:right">${a.key}</span></b><span>${a.role}</span><span style="margin-top:4px">${a.blurb}</span></div>`).join('');
$('#enter').onclick = () => {
  started = true; $('#start').style.display = 'none';
  if (CFG.sound && !audioCtx) try { audioCtx = new AudioContext(); } catch (_) {}
  lockPointer();
  setTimeout(() => sayFor('scout', 'Welcome to the floor. Walk up to any desk and press E, or hit 1 to 6.'), 600);
};
// start screen: show whether this computer is on the shared account, with a button to connect it
function startSyncHTML() {
  const el = $('#startSync'); if (!el) return;
  const on = typeof SY !== 'undefined' && SY.on;
  el.innerHTML = on ? `<span style="color:#4dd2ff"><b>Shared account connected</b> on this computer (${esc(SY.repo)}).</span>`
    : `<span><b style="color:var(--warn)">This computer isn't connected to your shared account.</b> It will show its own separate $1,000 paper account until you connect it (one time, with your data token).</span><button class="btn sm" id="startSyncBtn">Connect this computer</button>`;
  const b = $('#startSyncBtn'); if (b) b.onclick = () => { started = true; $('#start').style.display = 'none'; openPanel('sync'); };
}
setTimeout(startSyncHTML, 0);
camera.position.set(P.x, 1.66, P.z);
// Reviewer/SMC code loads after this point: draw what we can now, then redraw every desk once all code is loaded.
const drawAllScreens = () => desks.forEach(d => { try { drawScreens(d); } catch (e) { console.warn('screen', d.a.id, e.message); } });
drawBoard(); drawAllScreens(); drawTicker(); drawWall(); setTimeout(() => { drawAllScreens(); try { drawSmWall(); drawRace(); } catch (e) { console.warn('smc wall', e.message); } try { drawReviewWall(); } catch (e) { console.warn('review wall', e.message); } }, 0);
startEngine();
requestAnimationFrame(frame);
// If nothing arrives, explain why (most often: opened inside a preview window that blocks the internet)
setTimeout(function netCheck() {
  if (S.meta.size && (S.wsOk || S.restOk)) return;
  const where = location.protocol === 'file:' ? 'from a file on your computer' : 'inside <b>' + esc(location.protocol + '//' + (location.host || '')) + '</b>';
  $('#netwarn').innerHTML = `<b>No market data is reaching this page.</b> It's open ${where}. If you clicked it inside the Claude app or another preview, that window blocks internet access. <b>Download the file, then open it in Chrome</b>: drag it onto a Chrome window, or press Ctrl/Cmd + O in Chrome and pick it. ${S.apiErr ? '<br><span style="opacity:.7">Error: ' + esc(S.apiErr) + '</span>' : ''}`;
  $('#netwarn').style.display = 'block';
  $('#netbar').innerHTML = 'No connection to Aster — open this file directly in Chrome (see start screen)';
  $('#netbar').style.display = 'block';
  setTimeout(netCheck, 5000);
}, 8000);
setInterval(() => { if (S.meta.size && (S.wsOk || S.restOk)) { $('#netwarn').style.display = 'none'; $('#netbar').style.display = 'none'; } }, 3000);
(document.fonts && document.fonts.ready || Promise.resolve()).then(() => { fontRedraws.forEach(f => f()); drawBoard(); drawTicker(); drawWall(); try { drawSmWall(); drawRace(); } catch (_) {} try { drawReviewWall(); } catch (_) {} });

/* ================= DAY TRACKER VIEW ================= */
function trackerHTML() {
  const all = Object.entries(S.trk).map(([s, e]) => ({s, e, m: mget(s), tr: S.trC.get(s) || trendRead(s), tg: S.tagC.get(s) || tagFor(s)}));
  const F = PS.trkF || 'all';
  const cnt = (side, codes) => all.filter(x => x.e.side === side && codes.includes(x.tr.state.code)).length;
  const sum = side => `${cnt(side, [0])} ${side === 'G' ? 'still rising' : 'still falling'} · ${cnt(side, [1])} losing steam · <b style="color:${side === 'G' ? '#ff8a3d' : '#4dd2ff'}">${cnt(side, [2])} reversal forming</b> · ${cnt(side, [3])} reversed`;
  let list = all.filter(x => F === 'all' || (F === 'rev' ? x.tr.state.code >= 2 : x.e.side === F));
  list.sort((a, b) => (b.tr.state.code - a.tr.state.code) || (b.tr.score - a.tr.score) || ((a.e.rank || 9) - (b.e.rank || 9)));
  const chip = (k, l) => `<span class="chip" data-tf="${k}" style="${F === k ? 'border-color:var(--acc);color:#fff' : ''}">${l}</span>`;
  let h = `<p class="note">Every coin that enters the <b>top 5 gainers or losers</b> is tagged and followed for 24 hours. Every ~15 s GainerLoser re-reads its trend with 8 reversal checks (15m structure, EMA, money flow, taker pressure, wicks, funding, OI, 1h RSI) and alerts you when the state changes. Price history fills in from candles even if the page was closed; OI and the event log only record while this page is open.</p>
  <div class="card2" style="margin-bottom:12px;display:flex;gap:18px;flex-wrap:wrap;align-items:center"><div><span class="up" style="font-weight:800">GAINERS</span> · ${sum('G')}</div><div><span class="dn" style="font-weight:800">LOSERS</span> · ${sum('L')}</div>
  <div class="chips" style="margin-left:auto">${chip('all', 'All')}${chip('rev', 'Reversal forming / reversed')}${chip('G', 'Gainers')}${chip('L', 'Losers')}</div></div>`;
  if (!list.length) return h + '<div class="empty">Waiting for the first top-5 movers… (needs 1–2 minutes after opening)</div>';
  for (const {s, e, m, tr, tg} of list) {
    const since = fin(e.px0) ? (m.last / e.px0 - 1) * 100 : null, gs = e.side === 'G';
    const sideLbl = e.manual ? 'TRACKED BY YOU' : e.rank ? `TOP-5 ${gs ? 'GAINER' : 'LOSER'} #${e.rank}` : `WAS TOP-5 ${gs ? 'GAINER' : 'LOSER'} (best #${e.bestRank || '?'})`;
    const ev = (e.ev || []).filter(x => x.k === 'st').slice(-4).reverse().map(x => `<div class="mono" style="font-size:11.5px"><span class="dim">${hhmm(x.t)}</span> <span style="color:${(STATES[x.from] || STATES.wait).c}">${(STATES[x.from] || STATES.wait).l}</span> → <b style="color:${STATES[x.to].c}">${STATES[x.to].l}</b>${x.px ? ` <span class="dim">@ ${fmtPx(x.px)}</span>` : ''}${x.why && x.why.length ? `<span class="dim"> · ${esc(x.why.slice(0, 3).join(', ').toLowerCase())}</span>` : ''}</div>`).join('');
    const ck = tr.checks.map(r => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${r.ok === true ? (gs ? '#ff8a3d' : '#4dd2ff') : r.ok === false ? '#3a4766' : DIM}">${r.ok === true ? '●' : r.ok === false ? '○' : '·'}</span><span style="font-size:12px">${r.label}</span><span class="d">${esc(r.d)}</span></div>`).join('');
    h += `<div class="card2" style="margin-bottom:12px;border-left:4px solid ${tr.state.c}">
      <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap">
        <span style="font-size:20px;font-weight:800">${esc(m.b)}</span><span class="mono">${fmtPx(m.last)}</span><span class="mono ${cls(m.pct24)}">${fmtPct(m.pct24)} 24h</span>
        <span class="tag" style="color:${gs ? UP : DN}">${sideLbl}</span>${tg ? `<span class="tag" style="color:${tg.c}" title="${esc(tg.d)}">${tg.l}</span>` : ''}
        <span style="margin-left:auto;font-weight:800;font-size:15px;color:${tr.state.c}">${tr.state.l}</span><span class="mono dim">${tr.score}/8 reversal signs</span>${(mo => mo && mo.key !== 'wait' ? `<span class="tag" style="color:${mo.state.c}" title="${esc(mo.checks.filter(c => c.ok).map(c => c.label).join(' · '))}">${mo.state.l} · ${mo.score}/8</span>` : '')(S.moC.get(s))}
      </div>
      ${(u => u.phase ? `<div style="font-size:12.5px;margin-top:6px;color:${u.big ? (u.phase === 'ahead' ? WARN : '#c3cde6') : DIM}">🔓 <b>${esc(unlLabel(u))}</b>${u.e.who ? ` · ${esc(u.e.who)}` : ''}${u.phase === 'ahead' && u.big && !gs ? ' · <b>the Trader won\'t buy into it</b>' : ''}${u.phase === 'ahead' && u.big && gs ? ' · supply ahead is a tailwind for a short' : ''}</div>` : '')(unlCtx(s))}
      <div class="mono dim" style="font-size:12px;margin:6px 0 8px">tagged ${hhmm(e.t0)} @ ${fmtPx(e.px0)} (${fmtPct(e.pct0)} then) → now <b class="${cls(since)}">${fmtPct(since)}</b> since tag · ${gs ? `${fmtPct(tr.fromHi * 100)} from 24h high` : `${fmtPct(tr.fromLo * 100)} from 24h low`}${fin(e.hi) ? ` · tracked range ${fmtPx(e.lo)}–${fmtPx(e.hi)}` : ''}</div>
      <div class="grid2" style="grid-template-columns:1.1fr 1fr;gap:14px">
        <div><canvas data-spark="${s}" style="width:100%;height:120px;display:block;border-radius:8px;background:#060a14;border:1px solid var(--line)"></canvas>
          ${tg ? `<div class="dim" style="font-size:12px;margin-top:6px">${esc(tg.d)}</div>` : ''}
          <div style="margin-top:6px">${ev || '<span class="dim" style="font-size:12px">No trend changes logged yet.</span>'}</div></div>
        <div><div class="dim" style="font-size:11px;letter-spacing:.08em;margin-bottom:2px">${gs ? 'TOP / REVERSAL-DOWN SIGNS' : 'BOTTOM / REVERSAL-UP SIGNS'}</div>${ck || '<span class="dim">loading candles…</span>'}
          <div style="margin-top:8px;display:flex;gap:6px"><span class="chip" data-chk="${s}">Full coin check</span>${e.manual ? `<span class="chip" data-track="${s}">Stop tracking</span>` : ''}</div></div>
      </div></div>`;
  }
  return h + '<p class="note">States: <b>Still rising/falling</b> 0–2 signs · <b>Losing steam</b> 3–4 · <b>Reversal forming</b> 5+ · <b>Reversed</b> 5+ and price already 8% off the extreme on the other side of the 15m EMA. Signals, not certainty — your entry, stop and size decide the trade.</p>';
}
function drawSpark(cv) {
  const s = cv.dataset.spark, e = S.trk[s], k = S.kl.get(s); const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = r.width * dpr; cv.height = r.height * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); const W = r.width, H = r.height;
  c.fillStyle = '#060a14'; c.fillRect(0, 0, W, H);
  if (!k || k.bars.length < 2) { c.fillStyle = DIM; c.font = `500 12px ${FS}`; c.fillText('loading…', 10, H / 2); return; }
  const B = k.bars, live = (S.tk.get(s) || {}).last, pts = B.map(b => [b[0] + 15 * 60e3, b[4]]); if (fin(live)) pts[pts.length - 1][1] = live;
  const t0 = pts[0][0] - 15 * 60e3, t1 = now(); let lo = Math.min(...B.map(b => b[3])), hi = Math.max(...B.map(b => b[2])); const sp = (hi - lo) || hi * 0.01; lo -= sp * 0.06; hi += sp * 0.06;
  const X = t => 6 + (t - t0) / (t1 - t0) * (W - 50), Y = v => 8 + (hi - v) / (hi - lo) * (H - 22);
  if (e && e.t0 > t0) { c.fillStyle = 'rgba(106,168,255,.07)'; c.fillRect(X(e.t0), 0, W - 44 - X(e.t0), H); c.strokeStyle = 'rgba(106,168,255,.6)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(e.t0), 0); c.lineTo(X(e.t0), H); c.stroke(); c.setLineDash([]); c.fillStyle = '#6aa8ff'; c.font = `600 10px ${FM}`; c.fillText('tagged ' + hhmm(e.t0), X(e.t0) + 3, H - 4); }
  if (e && fin(e.px0)) { c.strokeStyle = 'rgba(219,228,251,.25)'; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(6, Y(e.px0)); c.lineTo(W - 44, Y(e.px0)); c.stroke(); c.setLineDash([]); }
  const up = pts[pts.length - 1][1] >= pts[0][1]; c.strokeStyle = up ? UP : DN; c.lineWidth = 1.8; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.stroke();
  for (const x of (e && e.ev || [])) if (x.k === 'st' && x.t > t0 && fin(x.px)) { c.fillStyle = STATES[x.to].c; c.beginPath(); c.arc(X(x.t), Y(x.px), 4, 0, 7); c.fill(); }
  c.fillStyle = DIM; c.font = `500 10px ${FM}`; c.fillText(fmtPx(hi), W - 42, 12); c.fillText(fmtPx(lo), W - 42, H - 8); c.fillText('24h · 15m', 8, 12);
}

/* ---- unlock calendar tab ---- */
function unlocksHTML() {
  const t = now(), F = PS.unlF || 'up', all = unlAll();
  const L = F === 'past' ? all.filter(e => e.t < t && t - e.t <= 14 * 864e5).reverse() : all.filter(e => e.t >= t - 864e5 && (F === 'all' || e.t - t <= 30 * 864e5));
  const hot = new Set([...S.gainers.slice(0, 10), ...S.losers.slice(0, 10), ...Object.keys(S.trk), ...Object.keys(PT.pos), ...CFG.watch]);
  const chip = (k, l) => `<span class="chip" data-uf="${k}" style="${F === k ? 'border-color:var(--acc);color:#fff' : ''}">${l}</span>`;
  const confC = {high: UP, med: WARN, low: DIM};
  let h = `<p class="note">Scheduled token unlocks: locked team, investor and ecosystem tokens becoming sellable. Large unlocks often weigh on price in the days <b>before</b> the date, and the selling can be done by the time it arrives. <b>How the agents use it:</b> the Trader won't open a long within ${PT.cfg.unlDays} days before an unlock of ≥${PT.cfg.unlMinPct}% of circulating supply, and closes longs 12 h before one. It prefers shorts on gainers with an unlock coming, and skips fresh shorts in the 24 h after an unlock, when bounces are common. Sizes are a share of <b>circulating</b> supply. Dates come from public trackers and can shift; open the source before trading on one.</p>
  <div class="card2" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span class="dim" style="font-size:12px">Calendar ${UNL.updated ? 'updated ' + new Date(UNL.updated).toLocaleString() : 'not loaded'} · ${esc(UNL.by || '')} · ${UNL.events.length} researched + ${(CFG.unl || []).length} yours</span>
  <div class="chips" style="margin-left:auto">${chip('up', 'Next 30 days')}${chip('past', 'Last 14 days')}${chip('all', 'Everything ahead')}</div></div>`;
  h += L.length ? `<table class="t"><thead><tr><th>Date (UTC)</th><th>When</th><th style="text-align:left">Coin</th><th>Size</th><th style="text-align:left">Type · recipients</th><th>Now 24h</th><th style="text-align:left">Trend now</th><th>Confidence</th><th style="text-align:left">Source / note</th></tr></thead><tbody>${L.map(e => {
    const onA = S.meta.has(e.s), m = onA ? mget(e.s) : null, tr = onA ? S.trC.get(e.s) : null, d = (e.t - t) / 864e5, big = unlBig(e);
    const mi = e.mine ? (CFG.unl || []).findIndex(x => (x.b || '').toUpperCase() === e.b && x.date === e.date) : -1;
    return `<tr ${onA ? `data-sym="${e.s}"` : ''} style="${hot.has(e.s) ? 'background:rgba(255,201,77,.07)' : ''}"><td class="dim">${new Date(e.t).toISOString().slice(0, 10)}</td><td class="${d >= 0 && d <= PT.cfg.unlDays ? 'warn' : 'dim'}">${d >= 0 ? 'in ' + (d < 1 ? Math.round(d * 24) + 'h' : d.toFixed(1) + 'd') : Math.round(-d) + 'd ago'}</td>
      <td class="sym" style="text-align:left">${esc(e.b)} ${onA ? star(e.s) : '<span class="tag dim">not on Aster</span>'}${hot.has(e.s) ? ' <span class="tag" style="color:var(--warn)">on your radar</span>' : ''}</td>
      <td class="${big ? 'dn' : 'dim'}">${esc(unlSizeTxt(e))}${fin(e.tokens) ? `<br><span class="dim" style="font-size:11px">${fmtUsd(e.tokens).replace('$', '')} tokens</span>` : ''}</td>
      <td style="text-align:left;font-family:var(--sans);font-size:12px">${esc(e.kind || '')}${e.who ? ' · ' + esc(e.who) : ''}</td>
      <td class="${m ? cls(m.pct24) : 'dim'}">${m ? fmtPct(m.pct24) : '—'}</td><td style="text-align:left">${tr && tr.key !== 'wait' ? `<span class="tag" style="color:${tr.state.c}">${tr.state.l}</span>` : '<span class="dim">—</span>'}</td>
      <td><span style="color:${confC[e.conf] || DIM}">${esc(e.mine ? 'yours' : e.conf || '?')}</span></td>
      <td style="text-align:left;white-space:normal;min-width:220px;font-family:var(--sans);font-size:11.5px">${e.src ? `<a href="${esc(e.src)}" target="_blank" rel="noopener" style="color:var(--acc)">source</a> ` : ''}<span class="dim">${esc(e.note || '')}</span>${mi >= 0 ? ` <span class="chip" data-unl-del="${mi}">remove</span>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">Nothing on the calendar for this window.</div>';
  h += `<div class="card2" style="margin-top:14px"><h3>ADD AN UNLOCK YOU KNOW ABOUT</h3><div class="set" style="grid-template-columns:repeat(5,1fr)">
    <label>Coin<input id="uB" placeholder="e.g. IDOL"></label><label>Date (UTC)<input id="uD" type="date"></label>
    <label>% of circulating supply<input id="uP" type="number" step="0.1" min="0" placeholder="e.g. 5"></label>
    <label>Type<select id="uK"><option value="cliff">Cliff (one-off)</option><option value="monthly">Monthly tranche</option><option value="linear">Linear</option></select></label>
    <label>Note<input id="uN" placeholder="who / source"></label></div>
    <div style="margin-top:10px"><button class="btn sm" data-unl-add="1">Add to calendar</button> <span id="uMsg" class="dim" style="font-size:12px"></span></div></div>`;
  return h;
}
function unlAddFromForm() {
  const b = ($('#uB').value || '').trim().toUpperCase().replace(/USDT$/, ''), date = $('#uD').value, pct = $('#uP').value, kind = $('#uK').value, note = ($('#uN').value || '').trim();
  if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('#uMsg').textContent = 'Needs a coin and a date.'; return; }
  CFG.unl = CFG.unl || []; CFG.unl.push({b, date, pct: pct === '' ? null : +pct, kind, who: 'Added by you', note, conf: 'yours'}); saveCfg();
  try { document.activeElement.blur(); } catch (_) {}
  sayFor('scout', `${b} unlock on ${date} added. I'll flag it and the Trader will take it into account.`); renderPanel();
}
