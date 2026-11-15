/* ================= BACKTESTER (agent 7): read-only view of the nightly SMC year backtest on BTC / ETH =================
   Data: BTS.year (sync.js btPull, file smc-backtest-year.json on branch "backtest"). Report only: nothing here touches live state. */
TABS.bt = [['sum', 'Summary & rules'], ['pat', 'Patterns'], ['tr', 'Trades']];
const btN = v => fin(v) ? v.toFixed(2) : '—';
const btR = v => fin(v) ? fmtR(v) : '—';
const btRc = v => `<span class="${cls(v)}">${btR(v)}</span>`;
const btWin = v => fin(v) ? v + '%' : '—';
const btD = t => new Date(t).toISOString().slice(0, 10);
const BT_LABEL = {helpful: ['keeps it (live setting better in both halves)', 'up'], harmful: ['live setting hurts (switch better in both halves)', 'dn'], none: ['no clear effect', 'dim']};
// one stats cell: n · avg R
const btCell = s => s && s.n ? `${s.n} · ${btRc(s.avgR)}` : '<span class="dim">n 0</span>';
function btHead(b) {
  return `<p class="note"><b>Backtest — report only, never changes live rules</b><br>${btD(b.from)} to ${btD(b.to)} (${b.days} days) · ${esc((b.coins || []).join(', '))} · first 8 months = up to ${btD(b.split)}, last 4 months = after it<br>${esc(b.fundingNote || '')}</p>`;
}
function btRunRow(lab, r) {
  const c = s => s && s.n ? `<td>${s.n}</td><td>${btRc(s.avgR)}</td><td>${btWin(s.win)}</td><td>${btR(s.totR)}</td><td>${btN(s.maxDD)}</td>` : '<td colspan="5" class="dim">n 0</td>';
  const cols = [['Whole year', r.all], ['First 8 months', r.a], ['Last 4 months', r.b], ['BTC', (r.coin || {}).BTCUSDT], ['ETH', (r.coin || {}).ETHUSDT]];
  return `<h3>${lab}</h3><table class="t"><thead><tr>${cols.map(([l]) => `<th colspan="5">${l}</th>`).join('')}</tr>
    <tr>${cols.map(() => '<th>n</th><th>avg R</th><th>win %</th><th>total R</th><th>max DD</th>').join('')}</tr></thead>
    <tbody><tr>${cols.map(([, s]) => c(s)).join('')}</tr></tbody></table>`;
}
function btSumHTML(y) {
  const b = y.sum, S0 = (b.snap || {});
  let h = btRunRow('Rules in force (base run)', b.base) + btRunRow('Raw run (all Reviewer rules off)', b.raw);
  h += `<h3>Rule ablation: live setting vs the switch</h3><p class="note">Each row flips one live setting and compares. Δ = switched minus live, so a positive Δ means the switch did better.</p>
    <table class="t"><thead><tr><th style="text-align:left">Rule</th><th>Live (base run) n · avg R</th><th>Switched n · avg R</th><th>Δ avg, first 8 months</th><th>Δ avg, last 4 months</th><th>Δ total R</th><th>Verdict</th></tr></thead><tbody>${(y.abl || []).map(r => {
      const [t, c] = BT_LABEL[r.label] || [esc(r.label || '—'), 'dim'];
      return `<tr><td style="text-align:left;font-family:var(--sans)">${esc(r.lab)}</td><td>${btCell(r.base && r.base.all)}</td><td>${btCell(r.sw && r.sw.all)}</td><td>${btR(r.dA)}</td><td>${btR(r.dB)}</td><td>${btR(r.dTot)}</td><td class="${c}">${t}</td></tr>`; }).join('')}</tbody></table>`;
  if ((y.skipped || []).length) h += `<h3>Skipped</h3><ul class="note">${y.skipped.map(s => `<li><b>${esc(s.lab)}</b>: ${esc(s.why)}</li>`).join('')}</ul>`;
  h += `<p class="note">${esc(b.note || '')}</p><details><summary>Rule snapshot used</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify({cfg: S0.cfg, adj: S0.adj}))}</pre></details>`;
  return h;
}
function btBars(rows) {
  const mx = Math.max(0.01, ...(rows || []).map(r => Math.abs(r.avgR || 0)));
  return (rows || []).map(r => { const w = fin(r.avgR) ? Math.round(Math.abs(r.avgR) / mx * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span class="dim" style="width:60px">${esc(r.m)}</span><span style="flex:1;max-width:260px"><div style="height:10px;width:${w}%;background:${r.avgR < 0 ? DN : UP}"></div></span>${btRc(r.avgR)}<span class="dim">n ${r.n}</span></div>`; }).join('');
}
function btPatTable(list) {
  if (!(list || []).length) return '<div class="empty">None.</div>';
  const th = '<th>First 8 months</th><th>Last 4 months</th>';
  return `<table class="t"><thead><tr><th style="text-align:left">feature = value</th><th colspan="2">this side (n · avg R)</th><th colspan="2">the rest (n · avg R)</th></tr><tr><th></th>${th}${th}</tr></thead><tbody>${list.map(p =>
    `<tr><td style="text-align:left">${esc(p.f)} = ${esc(p.v)}</td><td>${btCell(p.inA)}</td><td>${btCell(p.inB)}</td><td>${btCell(p.outA)}</td><td>${btCell(p.outB)}</td></tr>`).join('')}</tbody></table>`;
}
function btPatHTML(y) {
  const p = y.pat || {}, ex = y.exits || {};
  const exT = rows => `<table class="t"><thead><tr><th style="text-align:left">Exit reason</th><th>n</th><th>avg R</th></tr></thead><tbody>${(rows || []).map(r => `<tr><td style="text-align:left;font-family:var(--sans)">${esc(r.why)}</td><td>${r.n}</td><td>${btRc(r.avgR)}</td></tr>`).join('')}</tbody></table>`;
  return `<h3>From the raw run (all Reviewer rules off)</h3><p class="note">A pattern "held" if its edge had the same sign in the first 8 months and the last 4 months.</p>
    <h3>Held</h3>${btPatTable(p.held)}<h3>Did not hold</h3>${btPatTable(p.notHeld)}
    <h3>Monthly avg R, rules in force</h3>${btBars((y.months || {}).base)}<h3>Monthly avg R, raw run</h3>${btBars((y.months || {}).raw)}
    <h3>Exits, rules in force</h3>${exT(ex.base)}<h3>Exits, raw run</h3>${exT(ex.raw)}`;
}
function btTrHTML(y) {
  return `<table class="t"><thead><tr><th>Run</th><th>Coin</th><th>Side</th><th>UTC date</th><th>tf</th><th>Type</th><th>Zone</th><th>q</th><th>Grade</th><th>Regime</th><th>Hour</th><th>R</th><th>Exit</th></tr></thead><tbody>${(y.trades || []).map(t => { const f = t.f || {};
    return `<tr><td>${esc(t.v)}</td><td>${esc(String(t.s).replace('USDT', ''))}</td><td>${t.side === 'S' ? 'short' : 'long'}</td><td>${btD(t.t0)}</td><td>${esc(t.tf)}</td><td>${esc(t.type)}</td><td>${esc(t.zk)}</td><td>${fin(t.q) ? t.q : '—'}</td><td>${esc(t.g)}</td><td>${esc(t.reg)}</td><td>${esc(f.hour || '—')}</td><td>${btRc(t.R)}</td><td class="dim" style="text-align:left">${esc(t.why || '')}</td></tr>`; }).join('')}</tbody></table>`;
}
function btYearHTML(tab) {
  btPull();
  if (!SY.repo || !SY.token) return '<div class="empty">Connect Sync (Sync panel) to read the backtest results.</div>';
  const y = BTS.year; if (!y || !y.sum) return `<div class="empty">${esc(BTS.err || 'No year backtest has run yet.')}</div>`;
  try { return btHead(y.sum) + (tab === 'pat' ? btPatHTML(y) : tab === 'tr' ? btTrHTML(y) : btSumHTML(y)); }
  catch (e) { return `<div class="empty">Could not show the year backtest: ${esc(e.message)}</div>`; }
}
function drawBtScreens(d) {
  const [A, B] = d.mons, y = BTS.year, b = y && y.sum;
  const ca = screenFrame(A, d.a.color, 'BACKTESTER · BTC/ETH 1Y', b ? btD(b.from).slice(2) + ' → ' + btD(b.to).slice(2) : '');
  const cb = screenFrame(B, d.a.color, 'MONTHLY AVG R · RULES IN FORCE');
  if (!b) { for (const c of [ca, cb]) { c.fillStyle = DIM; c.font = `500 22px ${FS}`; c.fillText('no year run yet', 24, 120); } A.tex.needsUpdate = B.tex.needsUpdate = true; return; }
  [['RULES IN FORCE', b.base.all], ['RAW (RULES OFF)', b.raw.all]].forEach(([l, s], i) => {
    const yy = 100 + i * 120; ca.font = `700 17px ${FS}`; ca.fillStyle = DIM; ca.fillText(l, 24, yy);
    ca.font = `800 26px ${FM}`; ca.fillStyle = !s || !fin(s.avgR) ? DIM : s.avgR >= 0 ? UP : DN;
    ca.fillText(s && s.n ? `n ${s.n} · ${fmtR(s.avgR)} · ${btWin(s.win)} · ${fmtR(s.totR)} tot` : 'n 0', 24, yy + 40);
  });
  ca.font = `700 20px ${FS}`; ca.fillStyle = TXT; ca.fillText(`${((y.pat || {}).held || []).length} patterns held in both halves`, 24, 360);
  const ms = (y.months || {}).base || [], mx = Math.max(0.01, ...ms.map(m => Math.abs(m.avgR || 0))), bw = Math.max(8, Math.min(40, (B.W - 40) / Math.max(1, ms.length) - 4)), mid = B.H / 2 + 20;
  ms.forEach((m, i) => { const h = fin(m.avgR) ? m.avgR / mx * (B.H / 2 - 70) : 0, x = 20 + i * (bw + 4);
    cb.fillStyle = m.avgR < 0 ? DN : UP; cb.fillRect(x, h >= 0 ? mid - h : mid, bw, Math.max(1, Math.abs(h)));
    cb.fillStyle = DIM; cb.font = `500 12px ${FM}`; cb.fillText(String(m.m).slice(2), x, B.H - 14); });
  A.tex.needsUpdate = B.tex.needsUpdate = true;
}
