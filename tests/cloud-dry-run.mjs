// One cloud-trader cycle against local state files instead of the data repo.
// Uses real Aster prices; needs no token and never touches GitHub (STATE_IN switches run.mjs to local mode).
// Fails if the cycle exits non-zero or writes no state with both paper accounts.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-dry-'));
const IN = path.join(dir, 'in.json'), OUT = path.join(dir, 'out.json');
fs.writeFileSync(IN, '{}');

const env = { ...process.env, STATE_IN: IN, STATE_OUT: OUT };
delete env.DATA_REPO; delete env.DATA_TOKEN;   // belt and braces: never reach the real repo from a test
const fail = (m) => { console.error('FAIL:', m); process.exit(1); };
const run = () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bot', 'run.mjs')], { env, encoding: 'utf8', timeout: 180000 });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.error) fail(r.error.message);
  if (r.status !== 0) fail(`run.mjs exited ${r.status}`);
  if (!fs.existsSync(OUT)) fail('no state written');
};
run();
const st = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const missing = ['pt', 'sm', 'sb'].filter(k => !st[k]);
if (missing.length) fail('state missing ' + missing.join(', '));
if (!(st.sb.on === true && st.sb.start === 1000 && st.sb.cfg.minStopPct === 0.5)) fail('sb state wrong: ' + JSON.stringify({ on: st.sb.on, start: st.sb.start, minStopPct: st.sb.cfg && st.sb.cfg.minStopPct }));
if (typeof st.cloud.sbEq !== 'number') fail('cloud.sbEq is not a number');
const smKeys = ['start', 'cash', 'pos', 'log', 'on', 'cfg'];
if (!smKeys.every(k => k in st.sm) || st.sm.start !== 1000 || st.sm.cfg.minStopPct !== 1.5) fail('sm shape changed: ' + Object.keys(st.sm).join(','));
fs.copyFileSync(OUT, IN); run();   // second run fed the first run's state back in
const st2 = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (!st.sb.created || st2.sb.created !== st.sb.created) fail('sb.created not kept across runs');
console.log(`PASS: cloud cycle ran locally, state ${Math.round(fs.statSync(OUT).size / 1024)} KB with keys ${Object.keys(st).join(', ')}`);
fs.rmSync(dir, { recursive: true, force: true });
