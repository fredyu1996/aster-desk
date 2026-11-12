// PreToolUse (Bash, only for `git push`): block the push unless
//   1. the committed index.html / bot/core.js match a fresh build of src/ (Pages and the cloud run the built files), and
//   2. `npm test` passes (SMC sweep + one local cloud cycle; no token, never touches the data repo).
// Exit 2 blocks the tool call and shows the reason to Claude.
import { spawnSync } from 'node:child_process';

const winPath = p => process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/') : p;
const root = winPath(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const opts = (extraEnv = {}) => ({ cwd: root, env: { ...process.env, ...extraEnv }, encoding: 'utf8', timeout: 280000 });
const run = (cmd, args, extraEnv) => cmd === 'npm'
  ? spawnSync(['npm', ...args].join(' '), { ...opts(extraEnv), shell: true })   // npm is npm.cmd on Windows: needs a shell
  : spawnSync(cmd, args, opts(extraEnv));
const block = (msg) => { process.stderr.write(msg.slice(-3000)); process.exit(2); };

let b = run(process.platform === 'win32' ? 'py' : 'python3', ['build.py'], { PYTHONUTF8: '1' });
if (b.error) b = run('python', ['build.py'], { PYTHONUTF8: '1' });
if (b.error || b.status !== 0) block(`Push blocked: build.py failed.\n${b.error ? b.error.message : (b.stderr || b.stdout)}`);

const dirty = run('git', ['status', '--porcelain', '--', 'index.html', 'bot/core.js']).stdout.trim();
if (dirty) block(`Push blocked: the built files differ from a fresh build of src/. Commit them first:\n${dirty}`);

const t = run('npm', ['test']);
if (t.error || t.status !== 0) block(`Push blocked: npm test failed.\n${t.error ? t.error.message : (t.stdout + t.stderr)}`);
