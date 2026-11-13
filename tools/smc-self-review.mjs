// SMC Trader self-review: replay the HTF regime (smRegime) at entry time for every closed SMC trade.
// Usage: node tools/smc-self-review.mjs <state.json> <out.json>   (after python build.py; needs network to Aster)
import fs from 'node:fs'; import vm from 'node:vm';
const [, , inF, outF] = process.argv;
if (!inF || !outF) { console.error('usage: node tools/smc-self-review.mjs <state.json> <out.json>'); process.exit(2); }
const ctx = vm.createContext({console, Date, Math, JSON, localStorage: {getItem: () => null, setItem() {}}, document: {querySelector: () => null, getElementById: () => ({addEventListener() {}})}, sayFor() {}, renderPanel() {}, syViewer: () => false, setTimeout, setInterval: () => 0, fetch, URL, navigator: {}, TextEncoder});
vm.runInContext(fs.readFileSync(new URL('../bot/core.js', import.meta.url), 'utf8'), ctx);
const X = c => vm.runInContext(c, ctx);
const st = JSON.parse(fs.readFileSync(inF, 'utf8').replace(/^﻿/, ''));
const log = (st.sm && st.sm.log) || [];
const kl = async (s, iv, end, limit) => {
  const r = await fetch(`https://fapi.asterdex.com/fapi/v1/klines?symbol=${s}&interval=${iv}&endTime=${end}&limit=${limit}`);
  if (!r.ok) throw new Error(`${s} ${iv} HTTP ${r.status}`);
  return (await r.json()).map(b => [b[0], +b[1], +b[2], +b[3], +b[4], +b[5]]);
};
const out = [];
for (const t of log) {
  const s = t.s || (t.b ? t.b + 'USDT' : null), side = t.side || (t.qty < 0 ? 'S' : null);
  const row = {s, side, tf: t.tf, type: t.type, zoneKind: t.zoneKind, q: t.q ? t.q.score : null, grade: t.q ? t.q.grade : null, dz: t.q ? t.q.dz : null,
    stopPct: t.entry && t.stop0 ? Math.abs(t.entry - t.stop0) / t.entry * 100 : null, rr: t.rr, maxR: t.maxR, R: t.R, exitWhy: t.exitWhy, htfBias: t.htfBias, t0: t.t0};
  try {
    const h1 = (await kl(s, '1h', t.t0, 120)).filter(b => b[0] + 3600e3 <= t.t0);
    const B = t.tf === '1h' ? X(`smAgg(${JSON.stringify(h1)}, 4)`).filter(b => b[0] + 4 * 3600e3 <= t.t0) : h1;
    const g = X(`(() => { const B = ${JSON.stringify(B)}, g = smRegime(B); return {g, ok: smRegimeOk(g.reg, ${JSON.stringify(side)}, ${t.entry}, g)}; })()`);
    Object.assign(row, {regime: g.g.reg, rok: g.ok.ok, play: g.ok.play, rwhy: g.ok.why});
  } catch (e) { row.err = String(e.message || e); }
  out.push(row);
}
fs.writeFileSync(outF, JSON.stringify(out, null, 1));
console.log(`${out.length} trades → ${outF}; errors ${out.filter(r => r.err).length}`);
