/* ================= BACKTESTER (agent 7): read-only view of the nightly SMC year backtest on BTC / ETH =================
   Data: BTS.year (sync.js btPull, file smc-backtest-year.json on branch "backtest"). Report only: nothing here touches live state. */
TABS.bt = [['sum', 'Summary & rules'], ['pat', 'Patterns'], ['tr', 'Trades'], ['notes', 'Strategy notes']];
/* Strategy notes (Nov 15, Fred: "the Backtester writes down the strategies and the key points, then backtests them").
   Results of the one-off studies run from Claude Code (tools/*.mjs). Aggregates only, never trade data. Newest first. */
const BT_NOTES = [
  {d: '2026-11-15', t: 'Fade strong gainers only after a big last hour (timing study)', st: 'testing',
   idea: 'Fred\'s idea: the Trader\'s losing momentum longs came late (coin tracked for many hours, a big move in the last hour), so use those two as the trigger to trade the other way.',
   pts: ['Move in the last hour is the one that holds. Short a "strong momentum ↑" gainer when it rose ≥ 2.5% in the last hour: backtest 30 d small caps +0.20R n103 (halves +0.20 / +0.20; ≥ 5%: +0.27R n54), live reversed +0.49R n33. Under 2.5%: backtest −0.04R n60, live +0.04R n32.',
         'Hours in the tracker does not hold: live, late entries were worse (≥ 12 h: −0.48R n19), but in the backtest fading works at every age (0–2 h +0.11R, ≥ 12 h +0.07R) and early momentum longs still lose (< 2 h and a small last hour: −0.22R n10).',
         'So momentum longs on gainers do not work early either (backtest 0–2 h −0.39R n37): the fix is to stop them, not to time them.',
         'Losers: no clean signal. Fading a loser in its first 2 h tracked was +0.16R n46 (both halves) in the backtest but live has only 4 such trades: lead only.',
         'Momentum read rebuilt from candles (funding / OI unknown); simple exits (stop = same distance, +2R, 6 h); 30-day window.']},
  {d: '2026-11-15', t: 'Fade strong gainers (the Trader\'s momentum longs, reversed)', st: 'testing',
   idea: 'When the Trader\'s momentum read says "strong momentum ↑" on a tracked gainer, short it instead: same price, the same stop distance on the other side, target +2R, 6 h time exit.',
   pts: ['Live: 65 momentum longs, −0.30R each as taken; replayed with plain stop / +2R / 12 h rules −0.53R, reversed +0.27R (first half 0.00, second half +0.53).',
         'Backtest, small caps 21 d, momentum read rebuilt from candles (funding / OI unknown), score ≥ 6: momentum long −0.24R n108; fade +0.14R n108 (halves +0.14 / +0.16). Score ≥ 5: fade +0.07R n309 (+0.01 / +0.18).',
         'Lead, not a rule: the fade did better when price was ≥ 2% above the 15m EMA20 (backtest +0.26R n82, both halves; live +0.38R n35) than within 2% (backtest −0.23R n26; live +0.14R n30).',
         'Not for losers: the Trader\'s momentum shorts are about flat (−0.02R n221) and fading them loses (−0.14R).',
         'Open: one 21-day window; the backtest exits are simpler than the Trader\'s (no fade exit, no half off).']},
  {d: '2026-11-15', t: 'Reverse every losing trade?', st: 'rejected',
   idea: 'For each losing trade, would the opposite trade have won? Then: does reversing every trade work?',
   pts: ['Losers alone flatter it: the reverse won on 59% of the Trader\'s losers and 48% of the SMC Trader\'s. But it also turns almost every winner into a loss, and you only know which was which afterwards.',
         'Every trade reversed (same price, mirrored stop, same R target, 12 h): Trader −0.01R n235 (as taken in the same replay −0.16R), SMC Trader −0.20R n45 (same as taken), SMC Big n5.',
         'SMC backtests reversed: small caps (current rules) −0.18R n26, big caps −0.58R n38, BTC/ETH year −0.54R n90. The SMC strategy is not better backwards.',
         'Only the Trader\'s momentum longs reverse well (note above).']},
  {d: '2026-11-15', t: 'GMS v1.3 switches A/B/C/D', st: 'adopted',
   idea: 'Concepts from the GMS playbook: A 4h+1h aligned structure, B clean sweep / closed-bar shift with displacement, C supply/demand from a quiet base, D displacement FVG only.',
   pts: ['SMC Trader: B+D on (21 d small caps +0.3R n26 vs −9.9R n56, both halves better). SMC Big: C on (BTC/ETH year +28.0R n91 vs +13.8R n66).',
         'A hurt everywhere (too few trades). C hurt small caps (−14.6R n71).']},
  {d: '2026-11-15', t: 'Zone pick: FVG vs OB (zone study)', st: 'kept',
   idea: 'Label every candidate FVG / OB of every setup from the candles that followed, not only the traded zone.',
   pts: ['Small caps: only displacement FVGs hold up (+0.00R n303 vs −0.13R n1,081, both halves). OB never beats FVG; "good" OBs and the OB∩FVG overlap (A+) are not better.',
         'The live pick (newest FVG, else OB) stays; D does the displacement part.']},
  {d: '2026-11-15', t: '1h entries (4h filter) instead of 15m', st: 'rejected',
   pts: ['Almost never trades: BTC/ETH year n2 (n15 with every Reviewer rule off, −0.21R); small caps 14 d n1.']},
];
const BT_ST = {testing: ['testing', 'warn'], adopted: ['adopted', 'up'], kept: ['kept as is', 'dim'], rejected: ['not adopted', 'dn']};
function btNotesHTML() {
  return '<div class="dim" style="margin:4px 0 10px">Strategy ideas the Backtester has tested, newest first. Report only: a note never changes a live rule; Fred decides.</div>' +
    BT_NOTES.map(n => { const [l, c] = BT_ST[n.st] || [n.st, 'dim'];
      return `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px"><div><b>${esc(n.t)}</b> <span class="${c}">· ${esc(l)}</span> <span class="dim">· ${esc(n.d)}</span></div>
        ${n.idea ? `<div style="margin:4px 0">${esc(n.idea)}</div>` : ''}<ul style="margin:4px 0 0 18px;padding:0">${n.pts.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`; }).join('');
}
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
  if (tab === 'notes') return btNotesHTML();
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
