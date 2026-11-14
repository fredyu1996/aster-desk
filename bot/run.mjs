// Aster Desk — cloud trader. One run = one trading cycle, scheduled by GitHub Actions every ~5 minutes.
// It loads the SAME engine / tracker / Trader / Reviewer code the desk runs in the browser (bot/core.js, built from the
// desk's source), feeds it fresh Aster data, replays the 1-minute candles since the last run for open positions
// (so stops and targets hit between runs fill at the right level), runs a normal Trader + Reviewer cycle, and saves
// the shared account back to the private data repo — the same file every browser shows.
//
// Env: DATA_REPO (owner/name of the private repo), DATA_TOKEN (fine-grained token, Contents read/write on that repo).
// Local testing: STATE_IN=<file> STATE_OUT=<file> instead of the repo.
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const T0 = Date.now();
const DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO = process.env.DATA_REPO, TOKEN = process.env.DATA_TOKEN, FILE = 'aster-desk-state.json', BR = 'state';
const LOCAL_IN = process.env.STATE_IN, LOCAL_OUT = process.env.STATE_OUT;
const BROWSER_STALE = 5 * 60e3;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- private repo read / write (same layout as the desk's sync: one-commit branch "state") ---------- */
async function gh(p, opt = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, {method: opt.method || 'GET',
    headers: Object.assign({Authorization: 'Bearer ' + TOKEN, Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'aster-desk-cloud'}, opt.body ? {'Content-Type': 'application/json'} : {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined});
  if (opt.ok404 && r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} ${p.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  return opt.raw ? r.text() : r.json();
}
// Fred's own trade reviews (branch "notes", written by any browser): read-only here
let MINE = null;
async function readNotes() {
  if (LOCAL_IN) { MINE = process.env.NOTES_IN && fs.existsSync(process.env.NOTES_IN) ? JSON.parse(fs.readFileSync(process.env.NOTES_IN, 'utf8')) : null; return; }
  try { const r = await gh('/git/ref/heads/notes', {ok404: true}); if (r) MINE = JSON.parse(await gh('/contents/manual-reviews.json?ref=' + r.object.sha, {raw: true})); }
  catch (e) { log('notes not read:', e.message); }
}
async function headSha() { const r = await gh('/git/ref/heads/' + BR, {ok404: true}); return r ? r.object.sha : null; }
async function readState() {
  if (LOCAL_IN) return {head: 'local', b: fs.existsSync(LOCAL_IN) ? JSON.parse(fs.readFileSync(LOCAL_IN, 'utf8')) : null};
  const head = await headSha(); if (!head) return {head: null, b: null};
  return {head, b: JSON.parse(await gh(`/contents/${encodeURIComponent(FILE)}?ref=${head}`, {raw: true}))};
}
async function writeState(b, head, msg) {
  if (LOCAL_OUT) { fs.writeFileSync(LOCAL_OUT, JSON.stringify(b)); return 'local'; }
  const cur = await headSha();
  if (cur !== head) {
    // someone saved while we ran: if a browser took over trading, it wins and this run is dropped
    const other = JSON.parse(await gh(`/contents/${encodeURIComponent(FILE)}?ref=${cur}`, {raw: true}));
    if (other.lock && other.lock.dev !== 'cloud' && Date.now() - other.lock.t < BROWSER_STALE) return null;
  }
  const blob = await gh('/git/blobs', {method: 'POST', body: {content: Buffer.from(JSON.stringify(b)).toString('base64'), encoding: 'base64'}});
  const tree = await gh('/git/trees', {method: 'POST', body: {tree: [{path: FILE, mode: '100644', type: 'blob', sha: blob.sha}]}});
  const commit = await gh('/git/commits', {method: 'POST', body: {message: msg, tree: tree.sha, parents: []}});
  if (cur) await gh('/git/refs/heads/' + BR, {method: 'PATCH', body: {sha: commit.sha, force: true}});
  else await gh('/git/refs', {method: 'POST', body: {ref: 'refs/heads/' + BR, sha: commit.sha}});
  return commit.sha;
}

/* ---------- load the desk's own trading code into a sandbox ---------- */
function loadCore(b) {
  const store = new Map();
  for (const [k, v] of [['awx_pt', b && b.pt], ['awx_rv', b && b.rv], ['awx_sm', b && b.sm], ['awx_sb', b && b.sb], ['awx_trk', b && b.trk], ['awx_cfg', b && b.cfg], ['awx_mine', MINE]]) if (v) store.set(k, JSON.stringify(v));
  const el = {addEventListener() {}, style: {setProperty() {}}, classList: {add() {}, remove() {}}, textContent: '', innerHTML: ''};
  const ctx = vm.createContext({console, fetch, URL, TextEncoder, TextDecoder, Date, Math, JSON, Promise, setTimeout, clearTimeout,
    setInterval: () => 0, navigator: {userAgent: 'node'},
    localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
    document: {querySelector: () => null, getElementById: () => el}, addEventListener() {},
    // UI hooks the trading code calls; the cloud has no screen
    sayFor() {}, renderPanel() {}, syViewer: () => false});
  vm.runInContext(fs.readFileSync(DIR + 'core.js', 'utf8'), ctx, {filename: 'core.js'});
  return {ctx, X: code => vm.runInContext(code, ctx)};
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({length: n}, async () => { while (q.length) { const x = q.shift(); try { await fn(x); } catch (e) { log('  skip', x, e.message); } } })); }

async function main() {
  if (!LOCAL_IN && (!REPO || !TOKEN)) throw new Error('DATA_REPO / DATA_TOKEN not set (add the DATA_TOKEN secret in the repo settings)');
  const {head, b} = await readState();
  await readNotes();
  const prevCloud = (b && b.cloud) || {runs: 0, alerts: []};
  // a browser that is actively trading has the lock: stand by and change nothing
  if (b && b.lock && b.lock.dev !== 'cloud' && Date.now() - b.lock.t < BROWSER_STALE) { log(`standing by: trading is running in a browser (${b.lock.name})`); return; }

  const {ctx, X} = loadCore(b);
  X('syncAggSubs = () => {}; S.started = Date.now() - 3600e3;');
  // the unlock calendar published next to the desk (falls back to the snapshot built into core.js)
  try { ctx.__UNL = JSON.parse(fs.readFileSync(DIR + '../unlocks.json', 'utf8')); X("unlSet(__UNL, 'repo')"); } catch (_) {}
  // OI snapshots from earlier runs (the OI agent needs history; there is no OI-history endpoint)
  ctx.__OI = (b && b.oi) || {};
  X('for (const [s, a] of Object.entries(__OI)) S.oi.set(s, a);');

  await X('(async () => { await loadExInfo(); await loadTickers(); await loadFunding(); })()');
  const coins = X('[...new Set([...h1set(), ...smBigCoins(), ...Object.keys(PT.pos), ...CFG.watch.filter(x => S.meta.has(x))])]');
  log(`markets ${X('S.meta.size')}, eligible ${X('S.eligible.length')}, loading ${coins.length} coins`);
  ctx.__one = async s => { await X('loadOI')(s); await X('loadKl')(s); await X('loadH1')(s); };
  await pool(coins, 4, s => ctx.__one(s));

  // replay 1-minute candles since the last save for each open position, for both paper traders
  let replayed = 0;
  const since = b && b.t ? b.t - 60e3 : Date.now() - 15 * 60e3;
  for (const acct of [{pos: 'PT.pos', mng: 'ptManage', tp1: "q.tp1 ? null : q.entry + dir * (q.tp1R || 1.5) * d", tgt: "q.entry + dir * (q.tpR || 3) * d"},
                      {pos: 'SM.pos', mng: 'smManage', tp1: "q.tp1 ? null : q.entry + dir * SM.cfg.tp1R * d", tgt: "q.target"},
                      {pos: 'SB.pos', mng: '((t, o) => smWith(SB, () => smManage(t, o)))', tp1: "q.tp1 ? null : q.entry + dir * SB.cfg.tp1R * d", tgt: "q.target"}]) {
    for (const s of X(`Object.keys(${acct.pos})`)) {
      try { // an SMC Big fault must not stop the Trader / SMC cycle
      const p = X(`${acct.pos}[${JSON.stringify(s)}]`), from = Math.max(p.t, since);
      if (Date.now() - from < 90e3) continue;
      const iv = Date.now() - from > 990 * 60e3 ? '5m' : '1m', len = iv === '5m' ? 300e3 : 60e3;
      const bars = await X('api')(`/fapi/v1/klines?symbol=${s}&interval=${iv}&startTime=${from}&limit=1000`);
      ctx.__RP = {s, bars: bars.map(x => [+x[0], +x[1], +x[2], +x[3], +x[4]]).filter(x => x[0] + len <= Date.now()), len};
      replayed += X(`(() => {
        const {s, bars, len} = __RP; let n = 0;
        for (const [t0, o, h, l, c] of bars) {
          const p = ${acct.pos}[s]; if (!p) break; n++;
          CLOCK_OVR = t0 + len - 1;
          const L = p.side === 'L', d = Math.abs(p.entry - p.stop0), dir = L ? 1 : -1;
          // walk the candle: open, the adverse extreme, then the favourable one (assume the worst comes first)
          const path = L ? [o, l, h, c] : [o, h, l, c];
          let prev = o;
          for (const x of path) {
            const q = ${acct.pos}[s]; if (!q) break;
            const lv = [q.stop, ${acct.tp1}, ${acct.tgt}].filter(v => v != null && isFinite(v));
            // fill at the exact level a move crossed (or the open, if it gapped past it)
            const pts = lv.filter(v => (v - prev) * (v - x) <= 0 && v !== prev).sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
            for (const v of [...pts, x]) { if (!${acct.pos}[s]) break; PX_OVR = {[s]: v}; ${acct.mng}(CLOCK_OVR, s); }
            prev = x;
          }
        }
        PX_OVR = null; CLOCK_OVR = 0; return n;
      })()`);
      } catch (e) { if (acct.pos !== 'SB.pos') throw e; X('PX_OVR = null; CLOCK_OVR = 0'); log(`SMC Big replay ${s} failed: ${e.message}`); }
    }
  }

  X('RVF.last = Date.now()'); // the Reviewer's 24h follow-ups run below, not inside the tick
  // a normal live cycle, exactly what the desk does every few seconds
  X('computeAll(); periodicChecks(); trkUpdate();');
  // the Trader reads any pending review straight away (the browser waits 20 s so you can watch it happen)
  const cycle = () => X('if (RV.pending) { const r = RV.reviews.find(x => x.id === RV.pending); if (r) r.t -= 60e3; } ptTick();');
  cycle(); if (X('!!RV.pending')) cycle();

  // trades that closed 24h+ ago: follow up what price did next and replay them on 15m / 1h / 4h charts
  const followed = await X('rvFollowTick')(6); if (followed) log(`followed up ${followed} closed trade${followed > 1 ? 's' : ''} (24h after exit)`);
  if (process.env.DEBUG_SMC) for (const [k, r] of X('[...S.smC.entries()]')) log('  SMC', k, r.stage, r.dir || '', r.score + '/6', r.zone ? r.zone.kind : '', r.rr ? r.rr.toFixed(1) + 'R' : '');
  const keep = new Set(['trader', 'rev', 'scout', 'smc']); // tracker, unlock warnings, both traders' trades, reviews
  const fresh = X('S.alerts').filter(a => keep.has(a.agent)).map(a => ({t: a.t, agent: a.agent, s: a.s, text: a.text, dir: a.dir}));
  const oiOut = {}; for (const [s, a] of X('[...S.oi.entries()]')) { const k = a.filter(x => Date.now() - x[0] < 3 * 3600e3); if (k.length) oiOut[s] = k.length > 60 ? k.filter((_, i) => i % Math.ceil(k.length / 60) === 0 || i === k.length - 1) : k; }
  const cfg = Object.assign({}, X('CFG'));
  const sbSafe = c => { try { return X(c); } catch (e) { log('SMC Big: ' + e.message); return null; } };
  const out = {v: 1, t: Date.now(), lock: {dev: 'cloud', name: 'Cloud', t: Date.now()},
    pt: X('PT'), rv: X('RV'), sm: X('SM'), sb: X('SB'), trk: X('S.trk'), cfg, oi: oiOut,
    cloud: {t: Date.now(), runs: (prevCloud.runs || 0) + 1, dur: (Date.now() - T0) / 1000, eq: X('ptEquity()'), smEq: X('smEquity()'), smOpen: X('Object.keys(SM.pos).length'), sbEq: sbSafe('smWith(SB, smEquity)'), sbOpen: sbSafe('Object.keys(SB.pos).length'), replayed, open: X('Object.keys(PT.pos).length'),
      alerts: [...fresh, ...(prevCloud.alerts || [])].slice(0, 60), err: ''}};
  const fm = v => v == null ? 'n/a' : X('fmtMoney')(v);
  const sha = await writeState(out, head, `cloud · Trader ${X('fmtMoney(ptEquity())')} · SMC ${X('fmtMoney(smEquity())')} · SMC Big ${fm(out.cloud.sbEq)}`);
  log(sha ? `saved: Trader ${X('fmtMoney(ptEquity())')} (${out.cloud.open} open), SMC ${X('fmtMoney(smEquity())')} (${out.cloud.smOpen} open), SMC Big ${fm(out.cloud.sbEq)} (${out.cloud.sbOpen ?? 'n/a'} open), ${fresh.length} new events, ${replayed} candles replayed, ${out.cloud.dur.toFixed(1)} s`
          : 'a browser took over trading during this run; nothing saved');
}

main().catch(async e => {
  console.error('RUN FAILED:', e.message);
  // record the failure in the shared file so the desk can show it (best effort)
  try {
    const {head, b} = await readState();
    if (b && !(b.lock && b.lock.dev !== 'cloud' && Date.now() - b.lock.t < BROWSER_STALE)) {
      b.cloud = Object.assign({}, b.cloud, {t: Date.now(), err: e.message.slice(0, 300)});
      await writeState(b, head, 'cloud · run failed');
    }
  } catch (_) {}
  process.exit(1);
});
