/* ================= COIN CHECK: enter any coin, every agent reports ================= */
const CHECKA = {id: 'check', key: 'C', name: 'Coin check', role: 'Every agent reports', color: '#6aa8ff', blurb: 'Type any coin: reversal read, unlocks, open interest and money flow'};
const CHK = {sym: null, at: 0, trades: null, recent: LS.get('awx_recent', []), spoke: null};
TABS.check = [['r', 'Full report']];

function resolveSym(q) {
  q = String(q || '').trim().toUpperCase().replace(/[\s\/\-_]/g, '');
  if (!q) return {s: null, sug: []};
  for (const c of [q, q + 'USDT', q.replace(/USDT$/, '') + 'USDT']) if (S.meta.has(c)) return {s: c, sug: []};
  const bare = q.replace(/USDT$/, '');
  const sug = [...S.meta.keys()].filter(s => base(s).startsWith(bare) || base(s).includes(bare)).slice(0, 8);
  return {s: null, sug};
}
async function loadRecentTrades(s) {
  try {
    const a = await api('/fapi/v1/aggTrades?symbol=' + s + '&limit=1000');
    if (CHK.sym !== s) return;
    let buy = 0, sell = 0; const big = [];
    for (const x of a) {
      const usd = +x.p * +x.q; if (x.m) sell += usd; else buy += usd;
      if (usd >= CFG.whaleUsd) big.push({t: +x.T, side: x.m ? 'SELL' : 'BUY', usd, px: +x.p});
    }
    big.sort((p, q) => q.t - p.t);
    CHK.trades = {s, n: a.length, from: a.length ? +a[0].T : now(), to: a.length ? +a[a.length - 1].T : now(), buy, sell, big, maxUsd: a.reduce((m, x) => Math.max(m, x.p * x.q), 0), t: now()};
  } catch (e) { if (CHK.sym === s) CHK.trades = {s, err: e.message}; }
}
function checkCoin(s) {
  if (!S.meta.has(s)) return false;
  CHK.sym = s; CHK.at = now(); CHK.trades = null; CHK.spoke = null;
  CHK.recent = [s, ...CHK.recent.filter(x => x !== s)].slice(0, 8); LS.set('awx_recent', CHK.recent);
  setFocus(s, true); recomputeUniverse();
  // fetch this coin's data right away instead of waiting in the queue
  const t = now(); nextRun.set('oi:' + s, t + 30e3); nextRun.set('kl:' + s, t + 60e3);
  const fresh = () => { if (CHK.sym === s && PS.open === 'check') renderPanel(); };
  loadOI(s).then(fresh, () => nextRun.set('oi:' + s, 0)); loadKl(s).then(fresh, () => nextRun.set('kl:' + s, 0));
  loadRecentTrades(s).then(fresh); loadH1(s).then(fresh, () => {});
  sayFor('scout', `Checking ${base(s)}. Everyone, report in.`);
  return true;
}
// Each agent's findings for one coin
function agentReports(s) {
  const m = metrics(s), meta = S.meta.get(s) || {};
  const pend = '<span class="dim">loading…</span>';
  const R = {};
  // ---- GainerLoser
  {
    const all = [...S.eligible].sort((a, b) => S.tk.get(b).pct - S.tk.get(a).pct), i = all.indexOf(s), n = all.length;
    let why = '';
    if (i < 0) why = meta.top ? 'it is one of Aster\'s 17 "Top" coins' : meta.stock ? 'it is a stock perp' : `24h volume ${fmtUsd(m.qv)} is under your ${fmtUsd(CFG.minVol)} minimum`;
    const rank = i < 0 ? `Outside your filter — ${why}. Tracking it anyway.` : m.pct24 >= 0 ? `#${i + 1} of ${n} coins by 24h gain.` : `#${n - i} biggest loser of ${n} coins today.`;
    let mom = '';
    if (fin(m.pct1h) && fin(m.pct4h)) {
      if (m.pct24 > 0 && m.pct1h < -1) mom = 'Up on the day but fading in the last hour.';
      else if (m.pct24 < 0 && m.pct1h > 1) mom = 'Down on the day but bouncing in the last hour.';
      else if (m.pct1h > 0 && m.pct4h > 0) mom = 'Still pushing higher (1h and 4h both green).';
      else if (m.pct1h < 0 && m.pct4h < 0) mom = 'Still sliding (1h and 4h both red).';
      else mom = 'Momentum mixed between 1h and 4h.';
    }
    const rp = fin(m.rangePos) ? Math.round(m.rangePos * 100) : null;
    const tg = S.tagC.get(s) || tagFor(s), tr = S.trC.get(s) || trendRead(s);
    R.scout = {rows: [['Pattern', tg ? `<span class="tag" style="color:${tg.c}">${tg.l}</span>` : '<span class="dim">loading 1h candles…</span>'], ['Trend now', tr.key !== 'wait' ? `<span class="tag" style="color:${tr.state.c}">${tr.state.l}</span> <span class="dim">${tr.score}/8 reversal signs</span>` : '<span class="dim">loading…</span>'], ['Price', fmtPx(m.last)], ['24h', fmtPct(m.pct24), cls(m.pct24)], ['4h / 1h', fin(m.pct1h) ? `${fmtPct(m.pct4h)} / ${fmtPct(m.pct1h)}` : pend], ['24h volume', fmtUsd(m.qv)], ['24h range', `${fmtPx(m.low)} – ${fmtPx(m.high)}`], ['Position in range', rp != null ? rp + '% ' + (rp > 85 ? '(near high)' : rp < 15 ? '(near low)' : '') : '—'], ['Token unlock', (u => u.phase ? `<span style="color:${u.big ? WARN : DIM}">${esc(unlLabel(u))}</span>` : (n => n ? `<span class="dim">next ${new Date(n.t).toISOString().slice(0, 10)} · ${esc(unlSizeTxt(n))}</span>` : '<span class="dim">none on the calendar</span>')(unlAll().find(e => e.s === s && e.t > now())))(unlCtx(s))]],
      take: `${rank} ${mom}${tg ? ' Pattern: ' + tg.l + ' — ' + tg.d : ''}${(u => u.phase && u.big ? ` ${u.phase === 'ahead' ? 'Supply is coming: ' : 'Supply just landed: '}${unlLabel(u)}.` : '')(unlCtx(s))}`, tone: tone(m.pct24)};
  }
  // ---- OpenInterest
  {
    const a = S.oi.get(s), since = a && a.length ? (now() - a[0][0]) / 60e3 : 0, rg = regime(m);
    let take;
    if (!a || !a.length) take = 'Fetching the first open-interest snapshot…';
    else if (rg) take = `${rg.label}: OI ${fmtPct(rg.oi)} while price ${fmtPct(rg.px)} over ${rg.wl}. ${rg.desc}`;
    else take = `Tracking OI for ${Math.max(1, Math.round(since))} min. Aster has no OI history, so changes appear after ~5 min of snapshots (keep the page open).`;
    if (fin(m.oiUsd) && fin(m.qv) && m.qv > 0) take += ` OI is ${(m.oiUsd / m.qv).toFixed(2)}× daily volume${m.oiUsd / m.qv > 1.5 ? ' — a lot of leverage for the turnover' : ''}.`;
    R.ivy = {rows: [['Open interest', fin(m.oiUsd) ? fmtUsd(m.oiUsd) : pend], ['Δ 5m', fmtPct(m.oi5), cls(m.oi5)], ['Δ 15m', fmtPct(m.oi15), cls(m.oi15)], ['Δ 1h', fmtPct(m.oi60), cls(m.oi60)], ['Δ 4h', fmtPct(m.oi240), cls(m.oi240)], ['History', since ? (since < 60 ? Math.round(since) + ' min' : (since / 60).toFixed(1) + ' h') : '—']],
      take, tone: rg ? rg.tone : DIM};
  }
  // ---- Flo
  {
    const tr = CHK.trades && CHK.trades.s === s ? CHK.trades : null;
    let take = '';
    if (fin(m.net1h) && m.vol1h > 0) {
      const sh = m.net1h / m.vol1h * 100;
      take = `Last hour: ${m.net1h >= 0 ? 'buyers' : 'sellers'} net ${fmtUsd(Math.abs(m.net1h))} (${Math.abs(sh).toFixed(0)}% of ${fmtUsd(m.vol1h)} traded). `;
      take += fin(m.net24) ? `24h net ${fmtUsd(m.net24, 1)} — ${Math.sign(m.net24) === Math.sign(m.net1h) ? 'same direction as the day' : 'against the day\'s flow'}. ` : '';
    } else take = 'Loading candles… ';
    if (tr && !tr.err) {
      const mins = Math.max(1, Math.round((tr.to - tr.from) / 60e3));
      take += tr.big.length ? `${tr.big.length} trade${tr.big.length > 1 ? 's' : ''} ≥ ${fmtUsd(CFG.whaleUsd)} in the last ${tr.n} trades (~${mins} min); biggest ${fmtUsd(tr.maxUsd)}.` : `No trade ≥ ${fmtUsd(CFG.whaleUsd)} in the last ${tr.n} trades (~${mins} min); biggest was ${fmtUsd(tr.maxUsd)}.`;
    }
    const liqs = S.liqs.filter(l => l.s === s), wh = S.whales.filter(w => w.s === s);
    if (liqs.length) take += ` ${liqs.length} liquidation${liqs.length > 1 ? 's' : ''} seen this session (${fmtUsd(liqs.reduce((a, l) => a + l.usd, 0))}).`;
    const recentBS = tr && !tr.err && tr.sell > 0 ? tr.buy / tr.sell : null;
    if (fin(m.fund)) take += m.fund >= 0.0005 ? ` Funding ${fmtFund(m.fund)}: longs are paying heavily, so the long side is crowded.` : m.fund <= -0.0005 ? ` Funding ${fmtFund(m.fund)}: shorts are paying, a crowded short and fuel for a squeeze.` : ` Funding ${fmtFund(m.fund)}: no crowding.`;
    if (fin(m.ratio1h)) take += m.ratio1h >= 1.3 ? ` Market buyers ${m.ratio1h.toFixed(2)}× sellers over 1h.` : m.ratio1h <= 0.77 ? ` Market sellers ${(1 / m.ratio1h).toFixed(2)}× buyers over 1h.` : '';
    R.flo = {tag: crowdTag(m), rows: [['Net 15m', fmtUsd(m.net15, 1), cls(m.net15)], ['Net 1h', fin(m.net1h) ? fmtUsd(m.net1h, 1) : pend, cls(m.net1h)], ['Net 4h', fmtUsd(m.net4h, 1), cls(m.net4h)], ['Net 24h', fmtUsd(m.net24, 1), cls(m.net24)], ['Last 1000 trades B/S', recentBS != null ? fmtRatio(recentBS) : tr && tr.err ? 'error' : pend, cls((recentBS || 1) - 1)], ['Whale prints (live)', String(wh.length)], ['Taker B/S 1h / 4h', `${fmtRatio(m.ratio1h)} / ${fmtRatio(m.ratio4h)}`, cls((m.ratio1h || 1) - 1)], ['Funding', fmtFund(m.fund), fin(m.fund) && Math.abs(m.fund) >= 0.0005 ? 'warn' : ''], ['Next funding', fin(m.next) && m.next > now() ? 'in ' + ago(2 * now() - m.next) : '—']],
      take, tone: tone(m.net1h), big: tr && !tr.err ? tr.big.slice(0, 6) : []};
  }
  // ---- Reversal read (the Trader's own score) + would the Trader take it?
  {
    const tr = S.trC.get(s) || trendRead(s), side = sideOf(s), u = unlCtx(s), tg = S.tagC.get(s) || tagFor(s);
    const gate = tr.key === 'wait' ? 'still loading candles' : tr.state.code < 2 ? `trend still ${tr.state.l.toLowerCase()}` : ptGate(side, tr.key, tr.score, tg ? tg.l : '', s);
    const dir = side === 'G' ? 'short' : 'long';
    let t, tn;
    if (tr.key === 'wait') { t = 'Loading 15m candles for the reversal read…'; tn = DIM; }
    else if (tr.state.code >= 2 && !gate) { t = `${tr.state.l} with ${tr.score}/8 signs. The Trader would ${dir} this now if it's a tracked top-5 mover with enough volume.`; tn = side === 'G' ? DN : UP; }
    else if (tr.state.code >= 2) { t = `${tr.state.l} (${tr.score}/8), but the Trader would skip it: ${gate}.`; tn = WARN; }
    else if (tr.state.code === 1) { t = `${tr.state.l}: ${tr.score}/8 signs. Not a reversal yet; 5+ needed.`; tn = WARN; }
    else { t = `${tr.state.l} (${tr.score}/8 reversal signs). No reversal setup; the trend is intact.`; tn = DIM; }
    R.read = {tr, side, u, gate, take: t, tone: tn};
  }
  // ---- Momentum read: would the Trader ride the move?
  {
    const mo = S.moC.get(s) || momRead(s), tr = S.trC.get(s) || trendRead(s), side = mo.side, tg = S.tagC.get(s) || tagFor(s);
    const dir = side === 'G' ? 'long' : 'short', gate = mo.key === 'wait' ? 'loading' : ptGateMom(side, mo, tr, tg ? tg.l : '', s);
    let t, tn;
    if (mo.key === 'wait') { t = 'Loading 15m candles for the momentum read…'; tn = DIM; }
    else if (!PT.cfg.stratMom) { t = `${mo.state.l} (${mo.score}/8). Momentum trading is switched off on the Trader's desk.`; tn = DIM; }
    else if (mo.state.code === 2 && !gate) { t = `${mo.state.l} with ${mo.score}/8 signs. The Trader would ${dir} with the move now if it's a top-10 mover with enough volume.`; tn = side === 'G' ? UP : DN; }
    else if (mo.state.code === 2) { t = `${mo.state.l} (${mo.score}/8), but the Trader would skip it: ${gate}.`; tn = WARN; }
    else if (mo.state.code === 1) { t = `${mo.state.l}: ${mo.score}/8 signs. Not strong enough to chase yet.`; tn = WARN; }
    else { t = `No momentum (${mo.score}/8). Nothing to ride here.`; tn = DIM; }
    R.mom = {mo, side, take: t, tone: tn};
  }
  return {m, R};
}
function shortTake(id, r) { return r.take.split(/(?<=\.)\s/)[0].slice(0, 140); }
function speakAll(s) {
  if (CHK.sym !== s) return;
  const {R} = agentReports(s); let d = 0;
  for (const id of ['scout', 'ivy', 'flo']) { const txt = `${base(s)}: ${shortTake(id, R[id])}`; setTimeout(() => sayFor(id, txt), d); d += 700; }
  setTimeout(() => sayFor('trader', `${base(s)}: ${(R.mom.mo.state.code === 2 ? R.mom.take : R.read.take).slice(0, 140)}`), d);
  CHK.spoke = s;
}
function checkStatic() {
  const opts = [...S.meta.keys()].sort().map(s => `<option value="${base(s)}">`).join('');
  return `<div class="at-top"><input id="kSym" list="kList" placeholder="Type a coin, e.g. IDOL" style="width:220px" autocomplete="off"><datalist id="kList">${opts}</datalist><button class="btn sm" id="kGo">Check</button>
  <span id="kMsg" class="dim" style="font-size:12px"></span>
  <span class="dim" style="font-size:12px;margin-left:auto">Recent:</span><div class="chips">${CHK.recent.map(s => `<span class="chip" data-chk="${s}">${esc(base(s))}</span>`).join('') || '<span class="dim">—</span>'}</div></div>`;
}
function bindCheckStatic() {
  const go = () => {
    const r = resolveSym($('#kSym').value);
    if (r.s) { checkCoin(r.s); $('#kMsg').textContent = ''; $('#kSym').value = ''; $('#pstatic').innerHTML = checkStatic(); bindCheckStatic(); renderPanel(); setTimeout(() => speakAll(r.s), 5000); }
    else $('#kMsg').innerHTML = r.sug.length ? `Not found. Did you mean: ${r.sug.map(s => `<span class="chip" data-chk="${s}">${esc(base(s))}</span>`).join(' ')}` : '<span class="dn">No Aster perp matches that.</span>';
  };
  $('#kGo').onclick = go; $('#kSym').onkeydown = e => { if (e.key === 'Enter') go(); };

}
function checkHTML() {
  const s = CHK.sym;
  if (!s) return '<div class="empty">Type any Aster coin above (e.g. <b>IDOL</b>, <b>ASTER</b>, <b>BTC</b>) and press Enter. Every agent checks it: the reversal read the Trader uses, token unlocks, movers rank, open interest, money flow and positioning.</div>';
  const {m, R} = agentReports(s);
  const card = (id, inner) => { const a = AG[id]; return `<div class="card2" style="border-top:3px solid ${a.color}"><h3 style="color:${a.color};display:flex;justify-content:space-between"><span>${a.name.toUpperCase()} · ${a.role.toUpperCase()}</span><span class="kbd">${a.key}</span></h3>${inner}</div>`; };
  const rows = r => `<table class="t" style="font-size:12.5px;margin-bottom:8px"><tbody>${r.rows.map(([k, v, c]) => `<tr><td class="dim" style="font-family:var(--sans)">${k}</td><td class="${c || ''}">${v}</td></tr>`).join('')}</tbody></table>`;
  const takeBox = r => `<div class="verdict" style="border-left:3px solid ${r.tone};margin-top:0">${esc(r.take)}</div>`;
  const ck = arr => arr.map(r => `<div class="chk"><span class="i" style="color:${r.ok === true ? UP : r.ok === false ? DN : DIM}">${r.ok === true ? '✓' : r.ok === false ? '✗' : '·'}</span><span>${r.label}</span><span class="d">${esc(r.d)}</span></div>`).join('');
  const big = R.flo.big.length ? `<div class="dim" style="font-size:11px;margin:8px 0 4px;letter-spacing:.06em">RECENT LARGE TRADES</div>${R.flo.big.map(b => `<div class="mono" style="font-size:12px;display:flex;gap:10px"><span class="dim">${new Date(b.t).toTimeString().slice(0, 8)}</span><span class="${b.side === 'BUY' ? 'up' : 'dn'}">${b.side}</span><span>${fmtUsd(b.usd)}</span><span class="dim">@ ${fmtPx(b.px)}</span></div>`).join('')}` : '';
  const meta = S.meta.get(s) || {};
  return `<div style="display:flex;align-items:baseline;gap:14px;margin:6px 0 12px;flex-wrap:wrap"><span style="font-size:28px;font-weight:800">${esc(m.b)}</span><span class="mono" style="font-size:21px">${fmtPx(m.last)}</span><span class="mono ${cls(m.pct24)}" style="font-size:16px">${fmtPct(m.pct24)} 24h</span>${star(s)}
    ${meta.top ? '<span class="tag dim">Top coin</span>' : ''}${meta.stock ? '<span class="tag dim">stock perp</span>' : ''}
    <span class="chip" data-track="${s}" style="${S.trk[s] ? 'border-color:var(--up);color:var(--up)' : ''}">${S.trk[s] ? '✓ In day tracker' : '+ Track in day tracker'}</span>
    <span class="dim" style="margin-left:auto;font-size:12px">checked ${ago(CHK.at)} ago · refreshes live · <a href="#" id="kSay" style="color:var(--acc)">ask agents to speak</a></span></div>
  <div class="card2" style="border-top:3px solid ${AG.trader.color};margin-bottom:14px"><h3 style="color:${AG.trader.color}">REVERSAL READ · THE TRADER'S 8 SIGNS ${R.read.tr.key !== 'wait' ? `<span style="float:right;letter-spacing:0;color:${R.read.tr.state.c}">${R.read.tr.state.l} · ${R.read.tr.score}/8</span>` : ''}</h3>
    <div class="verdict" style="border-left:3px solid ${R.read.tone};margin:0 0 12px;font-size:14px"><b style="color:${R.read.tone}">${esc(R.read.take)}</b></div>
    ${R.read.u.phase ? `<div style="font-size:13px;margin:-4px 0 10px;color:${R.read.u.big ? WARN : DIM}">🔓 ${esc(unlLabel(R.read.u))}${R.read.u.e.who ? ' · ' + esc(R.read.u.e.who) : ''}${R.read.u.e.src ? ` · <a href="${esc(R.read.u.e.src)}" target="_blank" rel="noopener" style="color:var(--acc)">source</a>` : ''}</div>` : ''}
    <div class="dim" style="font-size:11px;letter-spacing:.08em;margin-bottom:2px">${R.read.side === 'G' ? 'TOP / REVERSAL-DOWN SIGNS (it is up on the day)' : 'BOTTOM / REVERSAL-UP SIGNS (it is down on the day)'}</div>${ck(R.read.tr.checks) || '<span class="dim">loading…</span>'}</div>
  <div class="card2" style="border-top:3px solid #7fe3b8;margin-bottom:14px"><h3 style="color:#7fe3b8">MOMENTUM READ · TRADE WITH THE MOVE ${R.mom.mo.key !== 'wait' ? `<span style="float:right;letter-spacing:0;color:${R.mom.mo.state.c}">${R.mom.mo.state.l} · ${R.mom.mo.score}/8</span>` : ''}</h3>
    <div class="verdict" style="border-left:3px solid ${R.mom.tone};margin:0 0 12px;font-size:14px"><b style="color:${R.mom.tone}">${esc(R.mom.take)}</b></div>
    ${fin(R.mom.mo.ext) ? `<div class="dim" style="font-size:12px;margin:-4px 0 8px">${fmtPct(R.mom.mo.ext * 100)} from the 15m EMA20 (the Trader skips chasing beyond ${PT.cfg.momMaxExt}%)</div>` : ''}
    ${ck(R.mom.mo.checks) || '<span class="dim">loading…</span>'}</div>
  <div class="grid2" style="grid-template-columns:1fr 1fr">
    ${card('scout', rows(R.scout) + takeBox(R.scout))}
    ${card('ivy', rows(R.ivy) + takeBox(R.ivy))}
    ${card('flo', rows(R.flo) + `<div style="margin:0 0 8px">${R.flo.tag}</div>` + takeBox(R.flo) + big)}
  </div>
  <div class="card2" style="margin-top:14px"><h3>PRICE · 15M CANDLES · OI OVERLAY · NET FLOW BARS</h3><canvas class="chart"></canvas></div>
  <p class="note" style="margin-top:12px">Signals from Aster's public market data, not a recommendation. Entry, stop and size stay your call.</p>`;
}
