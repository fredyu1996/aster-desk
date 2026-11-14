/* ================= TRADER: paper-trading agent (simulated $1,000 account, live prices) ================= */
// Trades the reversal signals from the day tracker. No real orders are ever sent: fills are simulated at live
// Aster prices with taker fee, slippage and funding charged, so the results are a fair test of the rules.
const PT_DEF = {v: 1, start: 1000, cash: 1000, pos: {}, log: [], eqs: [], day: null, cool: {}, on: true, paused: null, created: 0,
  cfg: {riskPct: 1, maxPos: 3, maxLev: 10, minScore: 5, dailyLossPct: 3, feePct: 0.04, slipPct: 0.10, holdH: 12, minVol: 300000, maxStopPct: 15, tp1R: 1.5, tpR: 3, stopBuf: 0.5, unlGuard: true, unlDays: 3, unlMinPct: 2, stratRev: 1, revLong: 0, useScreens: 1, stratMom: 1, momMinScore: 6, momRiskPct: 0.75, momMaxPos: 2, momHoldH: 6, momMaxExt: 8}, cands: []};
// Nov 11 (Fred): both traders use a 10× leverage cap (one-time switch for saved accounts)
function ptMigrate(p) { if (p.cfg.lev10 !== 1) { p.cfg.maxLev = 10; p.cfg.lev10 = 1; } return p; }
let PT = (() => {
  const saved = LS.get('awx_pt', null);
  const p = Object.assign(JSON.parse(JSON.stringify(PT_DEF)), saved || {});
  p.cfg = Object.assign({}, PT_DEF.cfg, (saved && saved.cfg) || {});
  if (!p.created) p.created = now();
  if (!Array.isArray(p.cands)) p.cands = [];
  return ptMigrate(p);
})();

// Reviewer state (the Reviewer agent lives in review.js)
const RV_DEF = {v: 1, on: true, auto: true, every: 3, reviews: [], active: null, pending: null, lastT: 0, seq: 0};
let RV = (() => { const s = LS.get('awx_rv', null); return Object.assign(JSON.parse(JSON.stringify(RV_DEF)), s || {}); })();
function rvSave() { LS.set('awx_rv', RV); }
function fmtMoney(v, sign) { if (!fin(v)) return '—'; const a = Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); return (v < 0 ? '-' : sign && v > 0 ? '+' : '') + '$' + a; }
function ptSave() { LS.set('awx_pt', PT); }
function ptReset() { const cfg = PT.cfg; PT = JSON.parse(JSON.stringify(PT_DEF)); PT.cfg = cfg; PT.created = now(); ptSave(); RV.lastT = now(); rvSave(); }
let PX_OVR = null; // the cloud bot feeds replayed candle prices through this
function ptPx(s) { if (PX_OVR && s in PX_OVR) return PX_OVR[s]; const t = S.tk.get(s); return t && fin(t.last) ? t.last : null; }
function ptUpnl(p, px) { return (p.side === 'L' ? 1 : -1) * (px - p.entry) * p.qty; }
function ptEquity() { let e = PT.cash; for (const s in PT.pos) { const px = ptPx(s); if (px) e += ptUpnl(PT.pos[s], px); } return e; }
function ptExposure() { let n = 0; for (const s in PT.pos) n += PT.pos[s].qty * (ptPx(s) || PT.pos[s].entry); return n; }
// buy fills above the price, sell fills below it
function ptFill(px, side, opening) { const sl = PT.cfg.slipPct / 100, buy = (side === 'L') === opening; return px * (buy ? 1 + sl : 1 - sl); }
// The rules the Trader uses right now: your settings, plus whatever the Reviewer changed and the Trader accepted.
function ptLessons() { return (RV.on && RV.active) ? RV.active : null; }
// strat 'rev' = reversal (fade the move), 'mom' = momentum (trade with it). Most Reviewer lessons are learned from and applied to reversal trades; momentum has its own.
function ptRules(side, tag, A = ptLessons(), strat = 'rev') {
  const c = PT.cfg, mom = strat === 'mom';
  const r = {strat, minScore: mom ? c.momMinScore : c.minScore, riskPct: mom ? c.momRiskPct : c.riskPct, minVol: c.minVol, holdH: mom ? c.momHoldH : c.holdH, tp1R: c.tp1R, tpR: c.tpR, stopBuf: c.stopBuf, unlDays: c.unlDays, needConf: false, fundGuard: false, avoid: false, prefer: false, les: []};
  if (!A) return r;
  if (mom) {
    const m = A.mom || {score: 0, mul: 1};
    if (m.score) { r.minScore = Math.min(8, r.minScore + m.score); r.les.push(`momentum needs ${r.minScore}/8`); }
    if (m.mul && m.mul !== 1) { r.riskPct *= m.mul; r.les.push(`momentum risk ${r.riskPct.toFixed(2)}%`); }
    if (A.volMul && A.volMul !== 1) { r.minVol = c.minVol * A.volMul; r.les.push(`min volume ${fmtUsd(r.minVol)}`); }
    if (A.unlDays && A.unlDays > c.unlDays) { r.unlDays = A.unlDays; r.les.push(`no longs within ${A.unlDays}d of a big unlock`); }
    if (A.fundGuard) { r.fundGuard = true; r.les.push('avoids paying funding'); }
    return r;
  }
  const sd = (A.side && A.side[side]) || {score: 0, mul: 1}, nm = side === 'L' ? 'longs' : 'shorts';
  r.minScore = Math.min(8, c.minScore + (A.score || 0) + (sd.score || 0));
  if (r.minScore !== c.minScore) r.les.push(`needs ${r.minScore}/8 signs`);
  r.riskPct = c.riskPct * (A.riskMul || 1) * (sd.mul || 1);
  if (Math.abs(r.riskPct - c.riskPct) > 1e-9) r.les.push(`risk ${r.riskPct.toFixed(2)}%${sd.mul !== 1 ? ' (' + nm + ' at reduced size)' : ''}`);
  if (A.volMul && A.volMul !== 1) { r.minVol = c.minVol * A.volMul; r.les.push(`min volume ${fmtUsd(r.minVol)}`); }
  if (A.holdH) { r.holdH = A.holdH; r.les.push(`max hold ${A.holdH}h`); }
  if (A.tp1R) { r.tp1R = A.tp1R; r.les.push(`half off at +${A.tp1R}R`); }
  if (A.tpR) { r.tpR = A.tpR; r.les.push(`target +${A.tpR}R`); }
  if (A.stopBuf) { r.stopBuf = A.stopBuf; r.les.push(`stop buffer ${A.stopBuf}%`); }
  if (A.needConf) { r.needConf = true; r.les.push('waits for "Reversed"'); }
  if (A.unlDays && A.unlDays > c.unlDays) { r.unlDays = A.unlDays; r.les.push(`no longs within ${A.unlDays}d of a big unlock`); }
  if (A.fundGuard) { r.fundGuard = true; r.les.push('avoids paying funding'); }
  if (tag && (A.avoid || []).includes(tag)) r.avoid = true;
  if (tag && (A.prefer || []).includes(tag)) { r.prefer = true; r.les.push(`preferred setup "${tag}"`); }
  return r;
}
// Why a candidate would be skipped under a given set of lessons (null = it qualifies). Used for live entries and for the Trader's what-if check.
function ptGate(trkSide, key, score, tag, s, A = ptLessons()) {
  if (trkSide === 'L' && !PT.cfg.revLong) return 'reversal longs are off: only shorting gainers';
  const R = ptRules(trkSide === 'G' ? 'S' : 'L', tag, A);
  if (R.avoid) return `Reviewer: skip "${tag}" setups`;
  if (score < R.minScore) return `only ${score}/8 signs (needs ${R.minScore})`;
  if (R.needConf && !String(key).startsWith('done')) return 'Reviewer: wait for "Reversed"';
  if (R.fundGuard && s) { const fr = f4(s); if (fin(fr) && (trkSide === 'G' ? fr <= -5e-4 : fr >= 5e-4)) return 'Reviewer: funding is against this side'; }
  if (PT.cfg.unlGuard && s) {
    const u = unlCtx(s);
    // buying ahead of fresh supply: new tokens tend to be sold into the days before the unlock
    if (trkSide === 'L' && u.phase === 'ahead' && u.big && u.days <= R.unlDays) return `token unlock ${unlWhen(u)} (${unlSizeTxt(u.e)}): no longs into new supply`;
    // right after a big unlock the selling is often done and bounces are common: don't open fresh shorts for 24 h
    if (trkSide === 'G' && u.phase === 'after' && u.big && u.hours <= 24) return `unlock was ${unlWhen(u)}: post-unlock bounces are common, no fresh shorts for 24 h`;
  }
  return null;
}
// Momentum candidate check (null = qualifies). trkSide 'G' = up on the day → LONG with the move; 'L' → SHORT.
function ptGateMom(trkSide, mo, tr, tag, s, A = ptLessons()) {
  const R = ptRules(trkSide === 'G' ? 'L' : 'S', tag, A, 'mom');
  if (mo.score < R.minScore) return `only ${mo.score}/8 momentum signs (needs ${R.minScore})`;
  if (tr && tr.state && tr.state.code >= 2) return 'reversal signs already forming against the move';
  if (fin(mo.ext) && Math.abs(mo.ext) * 100 > PT.cfg.momMaxExt) return `too stretched: ${fmtPct(mo.ext * 100)} from the 15m EMA (max ${PT.cfg.momMaxExt}%)`;
  if (R.fundGuard && s) { const fr = f4(s); if (fin(fr) && (trkSide === 'G' ? fr >= 5e-4 : fr <= -5e-4)) return 'Reviewer: funding is against this side'; }
  if (PT.cfg.unlGuard && s) {
    const u = unlCtx(s);
    if (trkSide === 'G' && u.phase === 'ahead' && u.big && u.days <= R.unlDays) return `token unlock ${unlWhen(u)} (${unlSizeTxt(u.e)}): no longs into new supply`;
    if (trkSide === 'L' && u.phase === 'after' && u.big && u.hours <= 24) return `unlock was ${unlWhen(u)}: no fresh shorts for 24 h`;
  }
  return null;
}
function ptR(p, px) { const d = Math.abs(p.entry - p.stop0); return d ? (p.side === 'L' ? px - p.entry : p.entry - px) / d : 0; }

function ptClose(s, frac, why) {
  const p = PT.pos[s], px = ptPx(s); if (!p || !px) return;
  const q = frac >= 1 ? p.qty : p.qty * frac, fill = ptFill(px, p.side, false);
  const pnl = (p.side === 'L' ? 1 : -1) * (fill - p.entry) * q, fee = q * fill * PT.cfg.feePct / 100;
  PT.cash += pnl - fee; p.realized += pnl - fee; p.fees += fee; p.qty -= q; p.exits.push({t: now(), px: fill, q, why});
  if (frac >= 1 || p.qty <= p.qty0 * 1e-6) {
    const R = p.risk ? p.realized / p.risk : 0;
    PT.log.unshift({s, b: p.b, side: p.side, t0: p.t, t1: now(), entry: p.entry, exit: fill, qty: p.qty0, notional: p.qty0 * p.entry, pnl: p.realized,
      R, fees: p.fees, funding: p.funding || 0, why: p.why, tag: p.tag, exitWhy: why, stop0: p.stop0, maxR: p.maxR || 0,
      st: p.st || '', sc: p.sc, dist: p.dist, les: p.les || [], rvId: p.rvId || 0, unlK: p.unlK || 'none', unl: p.unl || '', strat: p.strat || 'rev', tp1R: p.tp1R, tpR: p.tpR, cx: p.cx, scr: p.scr || null, ex: (p.exits || []).map(e => [e.t, e.px, e.why])});
    if (PT.log.length > 500) PT.log.pop();
    delete PT.pos[s]; PT.cool[s] = now();
    raise('trader', s, 'close' + now(), `PAPER ${p.side === 'L' ? 'long' : 'short'} ${p.b} closed ${fmtMoney(p.realized, 1)} (${R >= 0 ? '+' : ''}${R.toFixed(2)}R) — ${why}`, p.realized >= 0 ? 1 : -1, 0, true);
  } else {
    raise('trader', s, 'part' + now(), `PAPER ${p.b}: ${why} (${fmtMoney(pnl - fee, 1)} banked), stop moved to entry`, 1, 0);
  }
  ptSave();
}

function ptTryEnter(c) {
  const {s, tk} = c, mom = c.strat === 'mom', tr = mom ? c.mo : c.tr, k = S.kl.get(s); if (!k || k.bars.length < 24) return false;
  const B = k.bars, n = B.length, px = tk.last, side = mom ? (c.side === 'G' ? 'L' : 'S') : (c.side === 'G' ? 'S' : 'L');
  const tg = S.tagC.get(s), R = ptRules(side, tg ? tg.l : '', ptLessons(), mom ? 'mom' : 'rev'), bf = R.stopBuf / 100;
  const hi = a => Math.max(...a.map(b => b[2])), lo = a => Math.min(...a.map(b => b[3]));
  const w6 = B.slice(n - 24), w3 = B.slice(n - 12), w2 = B.slice(n - 8);
  let stop;
  if (mom) {
    // momentum: stop beyond the last 2h swing or the 15m EMA20, whichever gives the move more room
    stop = side === 'L' ? Math.min(lo(w2), tr.ema) * (1 - bf) : Math.max(hi(w2), tr.ema) * (1 + bf);
  } else {
    // reversal: stop just beyond the swing extreme the reversal is turning from (6h, else 3h)
    stop = side === 'S' ? hi(w6) * (1 + bf) : lo(w6) * (1 - bf);
    if (Math.abs(stop - px) / px > PT.cfg.maxStopPct / 100) stop = side === 'S' ? hi(w3) * (1 + bf) : lo(w3) * (1 - bf);
  }
  let dist = Math.abs(stop - px) / px;
  if (dist > PT.cfg.maxStopPct / 100) { c.skip = `stop would be ${(dist * 100).toFixed(0)}% away`; return false; }
  if (dist < 0.02) { stop = side === 'S' ? px * 1.02 : px * 0.98; dist = 0.02; }
  const fill = ptFill(px, side, true);
  if (side === 'S' ? stop <= fill : stop >= fill) return false;
  const eq = ptEquity(), riskUsd = eq * R.riskPct / 100;
  let qty = riskUsd / Math.abs(fill - stop);
  const perPosCap = eq * PT.cfg.maxLev / PT.cfg.maxPos, roomLeft = eq * PT.cfg.maxLev - ptExposure();
  qty = Math.min(qty, perPosCap / fill, Math.max(0, roomLeft) / fill);
  if (qty * fill < 10) { c.skip = 'not enough room under the leverage cap'; return false; }
  const fee = qty * fill * PT.cfg.feePct / 100; PT.cash -= fee;
  const why = `${mom ? 'Momentum' : 'Reversal'} · ${tr.state.l} ${tr.score}/8 — ${tr.checks.filter(x => x.ok).map(x => x.label.split(' (')[0].toLowerCase()).slice(0, 4).join(', ')}`;
  const A = ptLessons();
  const uc = unlCtx(s);
  PT.pos[s] = {cx: entryCtx(s, tr.checks), scr: typeof scrRec === 'function' ? scrRec(c) : null, strat: mom ? 'mom' : 'rev', unlK: uc.phase && uc.big ? uc.phase : 'none', unl: uc.phase ? unlLabel(uc) : '', st: tr.key, sc: tr.score, dist: dist * 100, les: R.les, rvId: A ? A.id || 0 : 0, tp1R: R.tp1R, tpR: R.tpR, hold: R.holdH, side, b: base(s), qty, qty0: qty, entry: fill, stop, stop0: stop, t: now(), risk: qty * Math.abs(fill - stop), realized: -fee, fees: fee,
    funding: 0, why, tag: tg ? tg.l : '', nf: null, be: false, tp1: false, maxR: 0, exits: []};
  raise('trader', s, 'open' + now(), `PAPER ${mom ? 'MOMENTUM ' : ''}${side === 'L' ? 'LONG' : 'SHORT'} ${base(s)} @ ${fmtPx(fill)} · stop ${fmtPx(stop)} (${(dist * 100).toFixed(1)}%) · size ${fmtMoney(qty * fill)} · risk ${fmtMoney(qty * Math.abs(fill - stop))}${R.les.length ? ' · lessons: ' + R.les.join(', ') : ''}`, side === 'L' ? 1 : -1, 0, true);
  ptSave(); return true;
}

// every ~5 s: manage open positions (stops, partials, trailing, funding, exits), then look for new entries
// Manage open positions at the current price. With `only`, the cloud bot replays one coin's past candles:
// just stop / partial / target / time checks (funding, EMA trail and signal-fade need live data).
function ptManage(t, only) {
  for (const s of only ? [only] : Object.keys(PT.pos)) {
    const p = PT.pos[s]; if (!p) continue; const px = ptPx(s); if (!px) continue;
    const L = p.side === 'L';
    // funding at each settlement: longs pay a positive rate, shorts receive it
    const f = only ? null : S.fund.get(s);
    if (f && fin(f.r)) {
      if (p.nf && t >= p.nf) { const pay = -(L ? 1 : -1) * p.qty * px * f.r; PT.cash += pay; p.realized += pay; p.funding += pay; }
      if (!p.nf || t >= p.nf) p.nf = fin(f.next) && f.next > t ? f.next : t + (S.fint.get(s) || 8) * 3600e3;
    }
    if (L ? px <= p.stop : px >= p.stop) { ptClose(s, 1, p.be ? (p.tp1 ? 'trailing stop hit' : 'stopped at breakeven') : 'stop loss hit'); continue; }
    const r = ptR(p, px); p.maxR = Math.max(p.maxR, r);
    const t1R = p.tp1R || 1.5, tR = p.tpR || 3, hold = p.hold || PT.cfg.holdH;
    if (!p.tp1 && r >= t1R) { p.tp1 = true; ptClose(s, 0.5, `took half at +${t1R}R`); if (!PT.pos[s]) continue; p.stop = p.entry; p.be = true; }
    if (r >= tR) { ptClose(s, 1, `target +${tR}R reached`); continue; }
    if (only) { if (t - p.t > hold * 3600e3) ptClose(s, 1, `time stop (${hold}h)`); continue; }
    if (L && PT.cfg.unlGuard) { const u = unlCtx(s, t); if (u.phase === 'ahead' && u.big && u.hours <= 12) { ptClose(s, 1, `closed ahead of the ${u.e.b} token unlock (${unlWhen(u)}, ${unlSizeTxt(u.e)})`); continue; } }
    const tr = S.trC.get(s);
    if (p.tp1 && tr && fin(tr.ema)) { const ts = L ? tr.ema * 0.995 : tr.ema * 1.005; if (L ? ts > p.stop : ts < p.stop) p.stop = ts; }
    if (p.strat === 'mom') {
      const mo = S.moC.get(s);
      if (t - p.t > 30 * 60e3 && tr && tr.key !== 'wait' && tr.state.code >= 2) { ptClose(s, 1, 'reversal signs forming against the move'); continue; }
      if (t - p.t > 30 * 60e3 && mo && mo.key !== 'wait' && mo.state.code === 0) { ptClose(s, 1, 'momentum faded'); continue; }
    } else if (tr && tr.key !== 'wait' && tr.state.code === 0 && t - p.t > 30 * 60e3) { ptClose(s, 1, 'reversal signals faded, trend resumed'); continue; }
    if (t - p.t > hold * 3600e3) { ptClose(s, 1, `time stop (${hold}h)`); continue; }
  }
}

function ptTick() {
  if (!S.tk.size || !warm || syViewer()) return; // a viewing computer mirrors the shared account instead of trading
  const t = now(), today = new Date().toDateString();
  if (!PT.day || PT.day.d !== today) { PT.day = {d: today, eq0: ptEquity()}; PT.paused = null; }
  ptManage(t);
  const eq = ptEquity();
  if (!PT.paused && eq < PT.day.eq0 * (1 - PT.cfg.dailyLossPct / 100)) {
    PT.paused = today;
    raise('trader', 'ACCOUNT', 'dl' + today, `Daily loss limit hit (${fmtMoney(eq - PT.day.eq0, 1)} today) — no new trades until tomorrow`, -1, 0, true);
  }
  PT.lastScan = {t, cands: []};
  const reading = typeof trReadPending === 'function' ? trReadPending() : null;
  if (PT.on && !PT.paused) {
    const cands = [];
    for (const s of PT.cfg.stratRev ? Object.keys(S.trk) : []) {
      const e = S.trk[s], tr = S.trC.get(s), tk = S.tk.get(s);
      if (!tr || tr.key === 'wait' || tr.state.code < 2) continue;
      const tg = S.tagC.get(s), tag = tg ? tg.l : '', R = ptRules(e.side === 'G' ? 'S' : 'L', tag);
      const uc = PT.cfg.unlGuard ? unlCtx(s) : {};
      const c = {s, side: e.side, strat: 'rev', tr, tk, b: base(s), tag, pref: R.prefer || (e.side === 'G' && uc.phase === 'ahead' && uc.big && uc.days <= 7)};
      const gate = ptGate(e.side, tr.key, tr.score, tag, s);
      if (PT.pos[s]) c.skip = 'already in a position';
      else if (PT.cool[s] && t - PT.cool[s] < 2 * 3600e3) c.skip = 'cooling down after a recent trade';
      else if (reading) c.skip = reading;
      else if (gate) c.skip = gate;
      else if (!tk || tk.qv < R.minVol) c.skip = `24h volume under ${fmtUsd(R.minVol)}`;
      if (!c.skip && typeof screenGate === 'function') { const g = screenGate(s, c.strat); if (g && g.skip) c.skip = g.skip; else if (g) c.scr = g; }
      c.fitR = c.scr ? c.scr.fit.hit.length / c.scr.fit.of : 0;
      cands.push(c);
      // remember what came up, so the Trader can check how new rules would have treated recent candidates
      const lc = PT.cands.filter(x => x.s === s).pop();
      if (!lc || t - lc.t > 15 * 60e3 || lc.key !== tr.key) PT.cands.push({t, s, b: base(s), side: e.side, key: tr.key, score: tr.score, tag});
    }
    // momentum: strong moves among the top-10 movers and tracked coins, traded in the direction of the move
    for (const s of PT.cfg.stratMom ? h1set() : []) {
      const mo = S.moC.get(s), tr = S.trC.get(s), tk = S.tk.get(s);
      if (!mo || mo.key === 'wait' || mo.state.code < 2) continue;
      const tg = S.tagC.get(s), tag = tg ? tg.l : '';
      const c = {s, side: mo.side, strat: 'mom', mo, tr, tk, b: base(s), tag, pref: false};
      const gate = ptGateMom(mo.side, mo, tr, tag, s), R = ptRules(mo.side === 'G' ? 'L' : 'S', tag, ptLessons(), 'mom');
      if (PT.pos[s]) c.skip = 'already in a position';
      else if (PT.cool[s] && t - PT.cool[s] < 2 * 3600e3) c.skip = 'cooling down after a recent trade';
      else if (reading) c.skip = reading;
      else if (gate) c.skip = gate;
      else if (!tk || tk.qv < R.minVol) c.skip = `24h volume under ${fmtUsd(R.minVol)}`;
      if (!c.skip && typeof screenGate === 'function') { const g = screenGate(s, c.strat); if (g && g.skip) c.skip = g.skip; else if (g) c.scr = g; }
      c.fitR = c.scr ? c.scr.fit.hit.length / c.scr.fit.of : 0;
      cands.push(c);
      const lc = PT.cands.filter(x => x.s === s && x.strat === 'mom').pop();
      if (!lc || t - lc.t > 15 * 60e3) PT.cands.push({t, s, b: base(s), side: mo.side, strat: 'mom', key: mo.key, score: mo.score, tag, ext: mo.ext, rev: tr ? tr.state.code : 0});
    }
    PT.cands = PT.cands.filter(x => t - x.t < 24 * 3600e3).slice(-400);
    cands.sort((a, b) => (b.pref - a.pref) || (b.fitR - a.fitR) || ((b.mo || b.tr).score - (a.mo || a.tr).score));
    for (const c of cands) {
      if (c.skip) continue;
      if (Object.keys(PT.pos).length >= PT.cfg.maxPos) { c.skip = `max ${PT.cfg.maxPos} positions open`; continue; }
      if (c.strat === 'mom' && Object.values(PT.pos).filter(p => p.strat === 'mom').length >= PT.cfg.momMaxPos) { c.skip = `max ${PT.cfg.momMaxPos} momentum positions open`; continue; }
      if (PT.pos[c.s]) { c.skip = 'already in a position'; continue; }
      if (ptTryEnter(c)) c.took = true;
    }
    PT.lastScan.cands = cands.map(c => ({b: c.b, side: c.side, strat: c.strat, state: (c.mo || c.tr).state.l, score: (c.mo || c.tr).score, took: !!c.took, test: !!(c.took && c.scr && c.scr.test), skip: c.skip || ''}));
  }
  const last = PT.eqs[PT.eqs.length - 1];
  if (!last || t - last[0] >= 5 * 60e3) { PT.eqs.push([t, +ptEquity().toFixed(2)]); if (PT.eqs.length > 3000) PT.eqs.shift(); }
  ptSave();
  if (typeof rvTick === 'function') rvTick();
  if (typeof smTick === 'function') { smTick(); smWith(SB, smTick); } // the SMC paper traders: small caps (SM), then big caps (SB), same data, own accounts
}
function ptStats() {
  const L = PT.log, wins = L.filter(x => x.pnl > 0), eq = ptEquity();
  let peak = PT.start, dd = 0; for (const [, v] of PT.eqs.concat([[0, eq]])) { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); }
  return {eq, pnl: eq - PT.start, pnlPct: (eq / PT.start - 1) * 100, today: PT.day ? eq - PT.day.eq0 : 0, n: L.length, win: L.length ? wins.length / L.length * 100 : null,
    avgR: L.length ? L.reduce((a, x) => a + x.R, 0) / L.length : null, best: L.length ? Math.max(...L.map(x => x.R)) : null, worst: L.length ? Math.min(...L.map(x => x.R)) : null,
    fees: L.reduce((a, x) => a + x.fees, 0) + Object.values(PT.pos).reduce((a, p) => a + p.fees, 0), dd: dd * 100, open: Object.keys(PT.pos).length};
}
