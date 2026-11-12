/* ================= SYNC: one shared account across computers, stored in a private GitHub repo ================= */
// The file lives on a branch called "state" that always has exactly one commit (overwritten on each save),
// so the repo never fills up with history. One computer "trades" (runs the Trader + Reviewer and saves every
// 90 s); every other computer is a live viewer that reloads the shared copy and can take over with one click
// — or automatically if the trading computer has been silent for 5 minutes (closed lid, browser quit).
const SY = Object.assign({repo: '', token: '', path: 'aster-desk-state.json', on: false, dev: '', name: ''}, LS.get('awx_sync', {}));
if (!SY.dev) SY.dev = Math.random().toString(36).slice(2, 10);
if (!SY.name) SY.name = /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows PC' : /Linux/.test(navigator.userAgent) ? 'Linux PC' : 'Computer';
function sySave() { LS.set('awx_sync', SY); }
sySave();
const SY_BRANCH = 'state', SY_PUSH = 90e3, SY_POLL = 20e3;
// a browser that stops saving for 5 min is gone; the cloud runs every ~5-15 min (GitHub schedules can lag), so give it 30
const syStale = L => !L || now() - L.t > (L.dev === 'cloud' ? 30 : 5) * 60e3;
const SYS = {draft: {}, role: 'off', head: null, lastPull: 0, lastPush: 0, lastCheck: 0, err: '', lock: null, busy: false, remoteT: 0, extra: {}, cloudSeen: 0};
const syViewer = () => SY.on && SYS.role === 'viewer';
const syTrading = () => !SY.on || SYS.role === 'leader' || SYS.role === 'off';

function b64enc(str) { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com/repos/' + SY.repo + path, {method: opt.method || 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: Object.assign({Authorization: 'Bearer ' + SY.token, Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}, opt.body ? {'Content-Type': 'application/json'} : {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined});
  if (opt.ok404 && r.status === 404) return null;
  if (!r.ok) { let m = ''; try { m = (await r.json()).message || ''; } catch (_) {} const e = new Error(`GitHub ${r.status}${m ? ': ' + m : ''}`); e.status = r.status; throw e; }
  return opt.raw ? r.text() : r.json();
}
async function syHead() { const r = await gh('/git/ref/heads/' + SY_BRANCH, {ok404: true}); return r ? r.object.sha : null; }
async function syRead(head) { const txt = await gh('/contents/' + encodeURIComponent(SY.path) + '?ref=' + head, {raw: true}); return JSON.parse(txt); }
function syBundle() {
  const cfg = Object.assign({}, CFG); delete cfg.sound; delete cfg.notify; // per-computer
  return Object.assign({}, SYS.extra, {v: 1, t: now(), lock: SYS.handBack ? {dev: 'cloud', name: 'Cloud', t: now()} : {dev: SY.dev, name: SY.name, t: now()}, pt: PT, rv: RV, sm: SM, trk: S.trk, cfg});
}
function syApply(b) {
  if (!b) return;
  if (b.pt) { PT = Object.assign(JSON.parse(JSON.stringify(PT_DEF)), b.pt); PT.cfg = Object.assign({}, PT_DEF.cfg, b.pt.cfg || {}); if (!Array.isArray(PT.cands)) PT.cands = []; if (typeof ptMigrate === 'function') ptMigrate(PT); ptSave(); }
  if (b.rv) { RV = Object.assign(JSON.parse(JSON.stringify(RV_DEF)), b.rv); rvSave(); }
  if (b.sm) { SM = Object.assign(JSON.parse(JSON.stringify(SM_DEF)), b.sm); SM.cfg = Object.assign({}, SM_DEF.cfg, b.sm.cfg || {}); if (typeof smMigrate === 'function') smMigrate(SM); smSave(); }
  if (b.trk) { S.trk = b.trk; trkSave(); }
  if (b.cfg) { const keep = {sound: CFG.sound, notify: CFG.notify}; Object.assign(CFG, b.cfg, keep); saveCfg(); }
  SYS.remoteT = b.t || 0; SYS.lock = b.lock || null;
  SYS.extra = {}; for (const k of ['oi', 'cloud']) if (b[k]) SYS.extra[k] = b[k]; // the cloud bot's data rides along when a browser saves
  const C = b.cloud;
  if (C && C.t) {
    // show what the cloud did since we last looked in the alert feed
    const fresh = (C.alerts || []).filter(a => a.t > SYS.cloudSeen).slice(0, SYS.cloudSeen ? 30 : 5).reverse();
    for (const a of fresh) { const x = Object.assign({}, a, {text: '☁ ' + a.text}); S.alerts.unshift(x); try { onAlert(x); } catch (_) {} }
    SYS.cloudSeen = Math.max(SYS.cloudSeen, ...(C.alerts || []).map(a => a.t), C.t);
  }
  try { recomputeUniverse(); } catch (_) {}
}
async function syPush() {
  // optimistic check: if someone else saved since we last looked, don't overwrite them
  const cur = await syHead();
  if (cur && SYS.head && cur !== SYS.head) {
    const b = await syRead(cur); SYS.head = cur;
    if (b.lock && b.lock.dev !== SY.dev && !syStale(b.lock)) { syApply(b); syRole('viewer', `Trading moved to ${b.lock.name}.`); return; }
  }
  const blob = await gh('/git/blobs', {method: 'POST', body: {content: b64enc(JSON.stringify(syBundle())), encoding: 'base64'}});
  const tree = await gh('/git/trees', {method: 'POST', body: {tree: [{path: SY.path, mode: '100644', type: 'blob', sha: blob.sha}]}});
  const commit = await gh('/git/commits', {method: 'POST', body: {message: `${SY.name} · equity ${fmtMoney(ptEquity())}`, tree: tree.sha, parents: []}});
  if (cur) await gh('/git/refs/heads/' + SY_BRANCH, {method: 'PATCH', body: {sha: commit.sha, force: true}});
  else await gh('/git/refs', {method: 'POST', body: {ref: 'refs/heads/' + SY_BRANCH, sha: commit.sha}});
  SYS.head = commit.sha; SYS.lastPush = now(); SYS.lock = SYS.handBack ? {dev: 'cloud', name: 'Cloud', t: now()} : {dev: SY.dev, name: SY.name, t: now()};
  if (SYS.handBack) { SYS.handBack = false; syRole('viewer', 'Trading handed back to the cloud. It picks up on its next run (every ~5 min).'); }
}
function syRole(r, say) {
  const was = SYS.role; SYS.role = r;
  if (say && was !== r) { sayFor('trader', say); raise('trader', 'SYNC', 'role' + now(), say, 0, 0); }
  syChip(); if (PS.open) renderPanel();
}
// connect / reconnect: decide whether this computer trades or watches
async function syConnect(mode) {
  if (!SY.repo || !SY.token) return;
  for (let i = 0; SYS.busy && i < 60; i++) await new Promise(r => setTimeout(r, 250)); // let a save/reload in flight finish first
  SYS.busy = true; SYS.err = ''; SYS.role = 'connecting'; syChip();
  try {
    const head = await syHead(); SYS.head = head; SYS.lastPull = now();
    if (!head || mode === 'upload') { await syPush(); syRole('leader', head ? `Shared copy replaced with this ${SY.name}'s account. Trading here.` : `Shared account created from this ${SY.name}. Trading here.`); }
    else {
      const b = await syRead(head), L = b.lock;
      if (mode === 'take' || !L || L.dev === SY.dev || syStale(L)) {
        if (!L || L.dev !== SY.dev) syApply(b); // adopt the shared account (this computer's own last save needs no reload)
        await syPush(); syRole('leader', mode === 'take' ? `Took over trading on this ${SY.name}.` : L && L.dev !== SY.dev ? `${L.name} went quiet ${ago(L.t)} ago, so trading continues here on ${SY.name}.` : `Trading here on ${SY.name}.`);
      } else { syApply(b); syRole('viewer', `Viewing the shared account. Trading runs on ${L.name}.`); }
    }
  } catch (e) { SYS.err = e.message; SYS.role = 'error'; syChip(); }
  SYS.busy = false; if (PS.open) renderPanel();
}
// called every few seconds from the main loop
async function syTick() {
  if (!SY.on || SYS.busy) return;
  const t = now();
  if (SYS.role === 'off' || SYS.role === 'error') { if (t - SYS.lastCheck > 60e3) { SYS.lastCheck = t; syConnect(); } return; }
  SYS.busy = true;
  try {
    if (SYS.role === 'leader' && t - SYS.lastPush >= SY_PUSH) { await syPush(); SYS.err = ''; }
    else if (SYS.role === 'viewer' && t - SYS.lastPull >= SY_POLL) {
      SYS.lastPull = t; const head = await syHead();
      if (head && head !== SYS.head) { const b = await syRead(head); SYS.head = head; syApply(b); if (PS.open === 'trader' || PS.open === 'rev' || PS.open === 'smc') renderPanel(); }
      if (syStale(SYS.lock)) { SYS.busy = false; await syConnect(); return; } // trader went quiet → take over
      SYS.err = '';
    }
  } catch (e) { SYS.err = e.message; }
  SYS.busy = false; syChip(); try { notesTick(); } catch (_) {}
}
// a viewer shouldn't change the account locally (the next reload would wipe it) — say so instead
function syBlock() { if (!syViewer()) return false; sayFor('trader', `This computer is only viewing. Take over trading here first (trading runs on ${SYS.lock ? SYS.lock.name : 'another computer'}).`); return true; }
function syChip() {
  const el = document.getElementById('sSync'); if (!el) return;
  const R = SYS.role, c = !SY.on ? DIM : R === 'leader' ? UP : R === 'viewer' ? '#4dd2ff' : R === 'error' ? DN : WARN;
  const txt = !SY.on ? 'SYNC OFF' : R === 'leader' ? (SYS.err ? 'SYNC RETRYING' : 'SYNCED · TRADING HERE') : R === 'viewer' ? (SYS.lock && SYS.lock.dev === 'cloud' ? 'VIEWING · CLOUD TRADES' : `VIEWING · ${(SYS.lock ? SYS.lock.name : '?').toUpperCase().slice(0, 12)}`) : R === 'error' ? 'SYNC ERROR' : 'CONNECTING…';
  el.title = R === 'viewer' ? `Trading runs on ${SYS.lock ? SYS.lock.name : '?'} — click to take over` : 'Sync across computers';
  // watchdog: the cloud normally saves every ~5 min; say so loudly if it has gone quiet
  const quiet = SY.on && R === 'viewer' && SYS.lock && SYS.lock.dev === 'cloud' && now() - SYS.lock.t > 20 * 60e3;
  if (quiet) {
    el.title = 'The cloud trader has not saved for ' + ago(SYS.lock.t) + '. Check the Actions tab and the cron-job.org timer (an expired token is the usual cause). After 30 min this computer takes over trading while it stays open.';
    el.innerHTML = `<i style="background:${WARN};box-shadow:0 0 8px ${WARN}"></i>${esc('CLOUD QUIET · ' + ago(SYS.lock.t))}`;
    if (!SYS.quietSaid || now() - SYS.quietSaid > 30 * 60e3) { SYS.quietSaid = now(); raise('trader', 'ACCOUNT', 'cloudquiet' + now(), `Watchdog: the cloud trader hasn't run for ${ago(SYS.lock.t)}. Check GitHub Actions and the cron-job.org timer; an expired timer token is the usual cause.`, -1, 0, true); }
    return;
  }
  el.innerHTML = `<i style="background:${c};box-shadow:0 0 8px ${c}"></i>${esc(txt)}`;
}
function syBanner() {
  return `<div class="card2" style="margin-bottom:12px;border-left:4px solid #4dd2ff;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><b style="color:#4dd2ff">Viewing the shared account</b><span class="dim" style="font-size:12px">Trading runs on ${esc(SYS.lock ? SYS.lock.name : 'another computer')} (last save ${SYS.lock ? ago(SYS.lock.t) : '?'} ago). Refreshes every 20 s.</span><button class="btn sm" style="margin-left:auto" data-sync="take">Take over trading here</button></div>`;
}

function syCloudCard() {
  const C = SYS.extra.cloud; if (!SY.on) return '';
  if (!C) return `<div class="card2" style="margin-bottom:12px"><h3>CLOUD TRADER</h3><span class="dim" style="font-size:13px">Not running yet. Once the GitHub Actions job is set up it trades every ~5 minutes, even with every computer off, and this computer becomes a window onto it.</span></div>`;
  const ok = !C.err, last = (C.alerts || []).slice(0, 6);
  return `<div class="card2" style="margin-bottom:12px;border-left:4px solid ${ok ? UP : DN}"><h3>CLOUD TRADER <span style="float:right;letter-spacing:0;color:${ok ? UP : DN}">${C.skipped ? 'standing by: ' + esc(C.skipped) : ok ? 'last run ' + ago(C.t) + ' ago' : 'last run failed ' + ago(C.t) + ' ago'}</span></h3>
  <div class="dim" style="font-size:12px;margin-bottom:6px">${C.runs || 0} runs · ${C.dur ? C.dur.toFixed(0) + ' s each' : ''} · equity ${fmtMoney(C.eq || 0)} at last run${C.replayed ? ` · replayed ${C.replayed} one-minute candles for open positions` : ''}</div>
  ${C.err ? `<div style="color:${DN};font-size:12px;margin-bottom:6px">${esc(C.err)}</div>` : ''}
  ${last.map(a => `<div class="chk" style="padding:3px 0"><span class="i" style="color:${a.dir > 0 ? UP : a.dir < 0 ? DN : DIM}">●</span><span style="font-size:12.5px">${esc(a.text)} <span class="dim">· ${ago(a.t)} ago</span></span></div>`).join('') || '<span class="dim" style="font-size:12px">No trades or alerts yet.</span>'}</div>`;
}
/* ---- sync panel ---- */
TABS.sync = [['s', 'Sync across computers']];
const SYNCA = {name: 'Sync', role: 'Shared account', blurb: 'Same trades, Reviewer lessons and tracker on every computer', color: '#4dd2ff'};
function syncHTML() {
  const R = SYS.role, st = !SY.on ? ['Off. This computer keeps its own separate account.', DIM] : R === 'leader' ? [`Trading on this computer (${SY.name}). Saved to GitHub every 90 s, last ${SYS.lastPush ? ago(SYS.lastPush) + ' ago' : 'pending'}.`, UP] : R === 'viewer' ? [`Viewing. Trading runs on ${SYS.lock ? SYS.lock.name : '?'}, last saved ${SYS.lock ? ago(SYS.lock.t) : '?'} ago.`, '#4dd2ff'] : R === 'error' ? ['Can\'t reach the repo: ' + SYS.err, DN] : ['Connecting…', WARN];
  return `<div class="card2" style="margin-bottom:12px;border-left:4px solid ${st[1]};display:flex;gap:12px;align-items:center;flex-wrap:wrap"><b style="color:${st[1]}">${esc(st[0])}</b>${SY.on && SYS.err && R !== 'error' ? `<span style="color:${WARN};font-size:12px">${esc(SYS.err)}</span>` : ''}
    <span style="margin-left:auto;display:flex;gap:8px">${R === 'viewer' ? '<button class="btn sm" data-sync="take">Take over trading here</button>' : ''}${R === 'leader' && SYS.extra.cloud ? '<button class="btn sm" data-sync="cloud">Hand trading back to the cloud</button>' : ''}${SY.on ? '<button class="btn sm ghost" data-sync="now">Sync now</button><button class="btn sm ghost" data-sync="off">Turn sync off</button>' : ''}</span></div>
  ${syCloudCard()}
  <div class="grid2"><div class="card2"><h3>CONNECT THIS COMPUTER</h3><div class="set" style="grid-template-columns:1fr">
    <label>Private data repo (owner/name)<input id="syRepo" placeholder="fredyu1996/aster-desk-data" value="${esc(SYS.draft.repo != null ? SYS.draft.repo : SY.repo)}"></label>
    <label>GitHub access token (stays in this browser only)<input id="syTok" type="password" value="${esc(SYS.draft.tok || '')}" placeholder="${SY.token ? '•••••••• saved. Leave blank to keep' : 'github_pat_…'}" autocomplete="off"></label>
    <label>Name for this computer<input id="syName" value="${esc(SYS.draft.name != null ? SYS.draft.name : SY.name)}"></label></div>
    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-sync="connect">${SY.on ? 'Save & reconnect' : 'Connect'}</button>
    ${SY.on ? `<button class="btn sm ghost" data-sync="upload">${SYS._arm ? 'Click again: overwrite the shared copy' : "Replace the shared copy with this computer's data"}</button>` : ''}</div>
    ${SYS.err ? `<div style="margin-top:10px;color:${DN};font-size:13px;font-weight:600">${esc(SYS.err)}</div>` : ''}
    <p class="note" style="margin-top:10px">If the repo already has a shared account, connecting <b>loads it here</b>, replacing this computer's separate paper account. The first computer you connect creates the shared copy.</p></div>
  <div class="card2"><h3>HOW IT WORKS</h3>
    <div class="chk"><span class="i up">1</span><span>Your <b>paper account, trade log, Reviewer lessons, day tracker, watchlist and settings</b> are saved as one file in your private repo (branch <b>state</b>). Open-interest history isn't synced; each computer rebuilds it in about an hour.</span></div>
    <div class="chk"><span class="i up">2</span><span><b>The cloud trades</b> every ~5 minutes with GitHub Actions, using the same rules as this desk, even with every computer off. It replays the 1-minute candles between runs, so stops and targets fill at the right price.</span></div>
    <div class="chk"><span class="i up">3</span><span>Computers are <b>windows onto the same account</b>, refreshing every 20 s. "Take over trading here" makes this computer trade every 5 s while it's open, and the cloud stands by. "Hand trading back to the cloud" undoes it, and so does closing the page (after 5 min).</span></div>
    <div class="chk"><span class="i up">4</span><span>The token is kept only in this browser's storage, never in the page or the repo. Create it on GitHub: <b>Settings → Developer settings → Fine-grained tokens</b>. Give it access to <b>only the data repo</b>, with <b>Contents: Read and write</b>.</span></div>
    <p class="note" style="margin-top:8px">If the cloud stops running for 30 minutes, an open computer takes over trading automatically.</p></div></div>`;
}
document.getElementById('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-sync]'); if (!b) return; e.stopPropagation();
  const a = b.dataset.sync;
  try { document.activeElement.blur(); } catch (_) {}
  if (a === 'connect') {
    const D = SYS.draft, rv = D.repo != null ? D.repo : ($('#syRepo') || {}).value, tv = D.tok || ($('#syTok') || {}).value, nv = D.name != null ? D.name : ($('#syName') || {}).value;
    const repo = (rv || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), tok = (tv || '').trim(), name = (nv || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { SYS.err = 'Repo should look like owner/name'; SYS.role = 'error'; renderPanel(); return; }
    if (tok) SY.token = tok; if (name) SY.name = name.slice(0, 24); SY.repo = repo;
    if (!SY.token) { SYS.err = 'Paste a token first'; SYS.role = 'error'; renderPanel(); return; }
    SY.on = true; sySave(); SYS.head = null; SYS.err = ''; SYS.draft = {}; syConnect();
  }
  if (a === 'take') syConnect('take');
  if (a === 'cloud') { SYS.handBack = true; SYS.lastPush = 0; syTick(); }
  if (a === 'now') { SYS.lastPush = 0; SYS.lastPull = 0; syTick(); }
  if (a === 'off') { SY.on = false; sySave(); SYS.role = 'off'; syChip(); sayFor('trader', 'Sync off. This computer now keeps its own copy.'); }
  if (a === 'upload') { if (SYS._arm) { SYS._arm = false; syConnect('upload'); } else { SYS._arm = true; setTimeout(() => { SYS._arm = false; }, 6000); } }
  renderPanel();
}, true);
document.getElementById('sSync').addEventListener('click', () => { if (typeof started !== 'undefined' && started) openPanel('sync'); else openPanel('sync'); });
syChip();
if (SY.on) setTimeout(() => syConnect(), 1500);

// keep what's typed in the connect form (the panel refreshes every few seconds)
document.getElementById('panel').addEventListener('input', e => {
  const t = e.target; if (!t || !t.id) return;
  if (t.id === 'syRepo') SYS.draft.repo = t.value; else if (t.id === 'syTok') SYS.draft.tok = t.value; else if (t.id === 'syName') SYS.draft.name = t.value;
}, true);

/* ---- Fred's own trade reviews: branch "notes", file manual-reviews.json (any computer can write) ---- */
const NOTES_BR = 'notes', NOTES_FILE = 'manual-reviews.json';
async function notesPull() {
  const r = await gh('/git/ref/heads/' + NOTES_BR, {ok404: true}); if (!r) return {head: null, m: {}};
  return {head: r.object.sha, m: JSON.parse(await gh('/contents/' + NOTES_FILE + '?ref=' + r.object.sha, {raw: true}))};
}
// read → change one review → write; if another computer saved in between, GitHub refuses the update and we retry.
// add = chart pictures attached to this review [{p: 'img/….jpg', data: 'data:image/jpeg;base64,…'}]: stored as their own
// files on the notes branch next to manual-reviews.json (the review only keeps their path and caption)
async function notesSave(key, rec, add = []) {
  for (const a of add) { IMGC.set(a.p, a.data); IDB.put(a.p, a.data).catch(() => {}); }
  if (!SY.on) { if (rec) RVM[key] = rec; else delete RVM[key]; LS.set('awx_mine', RVM); return 'local'; }
  const ib = [];
  for (const a of add) { const b = await gh('/git/blobs', {method: 'POST', body: {content: a.data.split(',')[1], encoding: 'base64'}}); ib.push({path: a.p, mode: '100644', type: 'blob', sha: b.sha}); }
  for (let i = 0; i < 4; i++) {
    const {head, m} = await notesPull();
    if (rec) m[key] = rec; else delete m[key];
    const blob = await gh('/git/blobs', {method: 'POST', body: {content: b64enc(JSON.stringify(m)), encoding: 'base64'}});
    const base = head ? (await gh('/git/commits/' + head)).tree.sha : null; // keep the pictures already there
    const tree = await gh('/git/trees', {method: 'POST', body: Object.assign(base ? {base_tree: base} : {}, {tree: [{path: NOTES_FILE, mode: '100644', type: 'blob', sha: blob.sha}, ...ib]})});
    const commit = await gh('/git/commits', {method: 'POST', body: {message: `${SY.name} · review ${key.split('|')[1] || ''}${ib.length ? ` · ${ib.length} picture${ib.length > 1 ? 's' : ''}` : ''}`, tree: tree.sha, parents: head ? [head] : []}});
    try {
      if (head) await gh('/git/refs/heads/' + NOTES_BR, {method: 'PATCH', body: {sha: commit.sha, force: false}});
      else await gh('/git/refs', {method: 'POST', body: {ref: 'refs/heads/' + NOTES_BR, sha: commit.sha}});
      RVM = m; LS.set('awx_mine', RVM); return 'shared';
    } catch (e) { if (e.status !== 422 && e.status !== 409) throw e; }
  }
  throw new Error('another computer kept saving at the same moment; try again');
}
/* ---- chart pictures on your reviews: kept in this browser (IndexedDB) and, with Sync on, on the notes branch ---- */
const IDB = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => { const r = indexedDB.open('awx', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const run = async (mode, f) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('img', mode), q = f(t.objectStore('img')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return {get: k => run('readonly', s => s.get(k)), put: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k))};
})();
const IMGC = new Map(), IMGL = new Map(); // path → data URL; path → loading promise
function imgLoad(path) {
  if (IMGC.has(path)) return Promise.resolve(IMGC.get(path));
  if (IMGL.has(path)) return IMGL.get(path);
  const pr = (async () => {
    let d = null; try { d = await IDB.get(path); } catch (_) {}
    if (!d && SY.on) { const r = await gh('/contents/' + path + '?ref=' + NOTES_BR, {ok404: true}); if (r && r.content) { d = 'data:image/jpeg;base64,' + r.content.replace(/\s/g, ''); IDB.put(path, d).catch(() => {}); } }
    if (d) IMGC.set(path, d);
    return d;
  })().finally(() => IMGL.delete(path));
  IMGL.set(path, pr); return pr;
}
// fill every <img data-mimg="path"> on the page once its picture is here
function imgFill() {
  document.querySelectorAll('img[data-mimg]').forEach(el => {
    const p = el.dataset.mimg; if (el.src && el.src.startsWith('data:')) return;
    if (IMGC.has(p)) el.src = IMGC.get(p); else imgLoad(p).then(d => { if (d) el.src = d; else el.alt = 'picture not found'; }).catch(() => { el.alt = 'could not load'; });
  });
}
function notesTick() {
  if (!SY.on || now() - (SYS.notesT || 0) < 60e3) return; SYS.notesT = now();
  notesPull().then(r => { RVM = r.m || {}; LS.set('awx_mine', RVM); }).catch(() => {});
}
