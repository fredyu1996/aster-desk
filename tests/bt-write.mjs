// writeOut / mergeTree without a token: a fake gh keeps the old files on branch "backtest", replaces the ones written, and handles a 404 branch.
import assert from 'node:assert/strict';
const {writeOut, mergeTree} = await import('../bot/backtest.mjs');
const old = [{path: 'smc-backtest.json', mode: '100644', type: 'blob', sha: 'A'}, {path: 'smc-backtest-year.json', mode: '100644', type: 'blob', sha: 'OLDY'}, {path: 'dir', mode: '040000', type: 'tree', sha: 'T'}];
const m = mergeTree(old, [{path: 'smc-backtest-year.json', mode: '100644', type: 'blob', sha: 'NEWY'}]);
assert.deepEqual(m.map(e => e.path + ':' + e.sha), ['smc-backtest-year.json:NEWY', 'smc-backtest.json:A']);

const fake = (cur) => { const calls = []; let n = 0; const g = async (p, o = {}) => {
  calls.push([o.method || 'GET', p, o.body]);
  if (p.startsWith('/git/ref/')) return cur ? {object: {sha: 'C0'}} : null;
  if (p === '/git/commits/C0') return {tree: {sha: 'T0'}};
  if (p === '/git/trees/T0') return {tree: old};
  if (p === '/git/blobs') return {sha: 'B' + ++n};
  if (p === '/git/trees') return {sha: 'T1'};
  if (p === '/git/commits') return {sha: 'C1'};
  return {}; }; return {g, calls}; };

let f = fake(true);
assert.equal(await writeOut({'smc-backtest-year.json': {v: 1}}, f.g), 'C1');
const tree = f.calls.find(c => c[1] === '/git/trees' && c[0] === 'POST')[2].tree;
assert.deepEqual(tree.map(e => e.path + ':' + e.sha), ['smc-backtest-year.json:B1', 'smc-backtest.json:A']);
assert.deepEqual(f.calls.find(c => c[1] === '/git/commits' && c[0] === 'POST')[2].parents, []);
assert.ok(f.calls.some(c => c[0] === 'PATCH' && c[2].force));

f = fake(false);   // first run: branch does not exist yet
await writeOut({'smc-backtest-year.json': {v: 1}}, f.g);
assert.deepEqual(f.calls.find(c => c[1] === '/git/trees' && c[0] === 'POST')[2].tree.map(e => e.path), ['smc-backtest-year.json']);
assert.ok(f.calls.some(c => c[0] === 'POST' && c[1] === '/git/refs'));
console.log('bt-write ok');
