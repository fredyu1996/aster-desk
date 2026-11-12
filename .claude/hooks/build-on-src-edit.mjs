// PostToolUse (Edit|Write): rebuild index.html + bot/core.js whenever a file under src/ (or unlocks.json) changes,
// so the built files never lag the source. A failed build exits 2, which feeds the error back to Claude.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let raw = '';
for await (const c of process.stdin) raw += c;
let input = {};
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

// Git Bash may hand us /c/Users/... while tool paths are C:\Users\...; normalise both.
const winPath = p => process.platform === 'win32' ? p.replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/') : p;
const root = path.resolve(winPath(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const file = (input.tool_input && input.tool_input.file_path) || (input.tool_response && input.tool_response.filePath) || '';
if (!file) process.exit(0);
const rel = path.relative(root.toLowerCase(), path.resolve(root, winPath(file)).toLowerCase()).split(path.sep).join('/');
if (!(rel.startsWith('src/') || rel === 'unlocks.json')) process.exit(0);

const env = { ...process.env, PYTHONUTF8: '1' };
const tryRun = (cmd) => spawnSync(cmd, ['build.py'], { cwd: root, env, encoding: 'utf8' });
// Windows: `py` launcher (python3 there is the Microsoft Store stub). Elsewhere: python3.
let r = tryRun(process.platform === 'win32' ? 'py' : 'python3');
if (r.error) r = tryRun('python');
if (r.error || r.status !== 0) {
  process.stderr.write(`build.py failed after editing ${rel}:\n${r.error ? r.error.message : (r.stderr || r.stdout)}`);
  process.exit(2);
}
console.log(JSON.stringify({ suppressOutput: true, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Rebuilt after ${rel}: ${r.stdout.trim().replace(/\r?\n/g, '; ')}` } }));
