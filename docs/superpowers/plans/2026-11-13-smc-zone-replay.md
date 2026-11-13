# SMC zone replay + self-tuned zone choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SMC Trader score every candidate FVG/OB, label past zones right/wrong, tune its zone choice behind the Reviewer's evidence gate, and replay 30 past trades for current rules vs option B.

**Architecture:** New pure functions in `src/smc.js` (zones, score, label). Reviewer side in `src/review.js` (backfill, tune, wire into `smLearn` / `smRules`). Offline `tools/smc-replay.mjs` drives `bot/core.js` in a Node vm with `CLOCK_OVR` + `SM_OVR`.

**Tech Stack:** browser JS built by `build.py`; Node vm tests; Aster REST klines.

**Spec:** `docs/superpowers/specs/2026-11-13-smc-zone-replay-design.md`

## Global Constraints
- Edit `src/` only; build with `PYTHONUTF8=1 py build.py`; commit source + `index.html` + `bot/core.js` together.
- Paper only; trading stays paused (`SM.on` untouched). Option-B rules not switched on.
- Default zone weights must reproduce today's pick exactly.
- Evidence gate for any tuned change: each side n ≥ 5, avg-R gap ≥ 0.5, winner avg > 0.
- "Right" = touched, then ≥ 1R before a close through the far edge; R from zone-mid entry and the trader's own stop.
- No trade data committed to the repo. Backfill ≤ 5 trades per Reviewer cycle (API load).

## Review Focus
- Leg with one FVG and no OB (or vice versa) → single candidate, no crash, label still computed.
- Zone touched and stopped in the same 15m bar → `wrong` (stop first).
- Old log rows without `q`/`zone` → backfill skips with a reason, no throw.
- Tuned weights that make no zone valid (min zs above every candidate) → fall back to default pick, not "no setup".
- Kline fetch fails mid-backfill → row left unlabelled, retried next cycle.

---

### Task 1: zones + score in the pick
**Files:** `src/smc.js` (`smSetup` ~:96-133, `smContSetup` ~:138-160, pos/log rows), Test `tests/smc-zones.mjs` (vm harness from `tests/smc-sweep.mjs`).
**Produces:** `smZones(B, setup, dir) -> [{kind:'FVG'|'OB', lo, hi, i, zs, body, vr, fresh, pos, dSw, ovl, pd}]`; `SMZ_DEF` (default weights); `smZoneScore(z, W) -> number`; position/log field `zc: {c: [zones], k: chosenIndex}`.
- [ ] Tests: default `W` picks the same zone as before on the smc-sweep setup (compare `zone.lo/hi` with the pre-change pick captured in the test); `W` with OB preference picks the OB when both exist; a tuned `minZs` above every candidate falls back to the default pick; features `zs`, `pos`, `fresh` correct on a hand-built leg.
- [ ] Run → FAIL; implement; run `tests/smc-zones.mjs`, `tests/smc-sweep.mjs`, `tests/smc-regime.mjs` → PASS; commit.

### Task 2: label
**Files:** `src/smc.js`. Test: `tests/smc-zones.mjs`.
**Produces:** `smZoneLabel(bars15After, zone, dir, stop) -> {lab:'right'|'wrong'|'untouched', r:number}`.
- [ ] Tests: path touching then +1R → right; touching then closing through far edge → wrong; touch and stop in the same bar → wrong; never touched → untouched.
- [ ] FAIL → implement → PASS → commit.

### Task 3: Reviewer backfill + tune
**Files:** `src/review.js` (`smLearn` ~:329, `smAudit` ~:679 for the fetch pattern), `src/smc.js` `smRules` ~:607, the Reviewer rule list in `src/lessons.js` only if the rule display needs a line for `zone`.
**Produces:** `smZoneBackfill(max=5)` (async; fills `row.zc` + labels using `api()` klines and `SM_OVR` at `row.t0`); `smZoneTune(rows) -> {W, why:[{k, n1, n2, r1, r2}]} | null`; `RV.smAdj.zone`; `smRules().zone`.
- [ ] Tests: `smZoneTune` with 4 vs 4 rows → null; with 6 fresh-right vs 6 stale-wrong rows → `W` prefers fresh with why n=6/6; sticky like other rules (a newer opposite split needed to undo).
- [ ] FAIL → implement (call backfill from the cloud/browser Reviewer cycle where `smAudit` runs; tune inside `smLearn`) → PASS → commit.

### Task 4: offline replay tool
**Files:** create `tools/smc-replay.mjs`.
- [ ] `node tools/smc-replay.mjs <state.json> <out.json>` writes per trade: actual R; simulated R for `cur` and `B` (B = entry only at 30–60% depth, stop ≥ 2%); candidate zones with labels; chosen-vs-best; and the overall `smZoneTune` result. Prints one summary line per variant (n, wins, avg R) and the sim-vs-actual gap.
- [ ] Run against `C:\Users\fredy\AppData\Local\Temp\claude\ca7a1dddf34ce66f\b3f1b9aa-165e-46de-9047-772f092cea24\scratchpad\state.json`; output to the same scratchpad as `replay.json`. Commit the tool only.

### Task 5: full checks
- [ ] build, `npm test`, `tests/smc-zones.mjs`, `tests/smc-regime.mjs`, `tests/smc-sweep.mjs`, `tests/desk-smoke.mjs`, cloud dry-run → paste pass lines. Do not push.
