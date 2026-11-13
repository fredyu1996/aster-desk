# SMC Trader: bar-by-bar replay, zone review, self-tuned zone choice (2026-11-13)

## Intent
Fred picked option B from the Nov 12 self-review: keep the SMC Trader paused and test "enter only 30–60% into
the zone" and "stop ≥ 2%" on the 30 past trades. On top of that he wants the trader to replay those trades,
judge whether its FVG / OB choice was right and how good each zone was, and then adjust its own
FVG / OB selection criteria.

## Today (from code)
- `smSetup` / `smContSetup` pick the newest FVG on the displacement leg, with no minimum size. An OB is used
  only when the leg has no FVG. Zones are never compared with each other.
- Zone quality (`smQuality`: gap/ATR, displacement, OB, depth) is scored after the pick and only gates the trade.
- The Reviewer learns only coarse rules (`fvgOnly`, `minQ`).

## Decisions
- **"Zone right"** (Fred): price touched the zone, then went ≥ 1R before a close through the zone's far edge.
  1R = |entry − stop|, entry = zone midpoint, stop = the trader's own stop for that setup (sweep extreme
  ± stopBuf, widened to the minimum stop %). Wrong = a close through the far edge first. Untouched = never touched.
- **Auto-tuning** (Fred: "佢自己再調"), behind the existing Reviewer evidence gate: each side n ≥ 5,
  average gap ≥ 0.5R, winner's average > 0. Too little evidence → no change.
- Trading stays paused. Fred decides on resuming after the report.
- The option-B rules are tested in replay only; they are not switched on.
- No trade data is committed to the public repo. Labels for past trades are rebuilt inside the desk/cloud
  from Aster klines (the Reviewer already fetches history for `smAudit`).

## Design
1. `smZones(B, setup, dir)`: every FVG on the leg plus the OB. Features per zone:
   - kind
   - zs = height / ATR14
   - disp = body ratio and volume ratio of the gap candle
   - fresh = untouched since it formed
   - pos = order on the leg (0 = nearest the sweep)
   - dSw = distance from the sweep in ATR
   - ovl = FVG overlaps the OB
   - pd = in discount (long) / premium (short) of the leg

   `smZoneScore(z, W)` picks the highest-scoring zone. The default `W` reproduces today's pick exactly
   (FVG over OB, newest first), so nothing changes until tuning moves it.
2. `smZoneLabel(bars, zone, dir, stop)` returns `'right' | 'wrong' | 'untouched'` and the R reached.
3. Every new SMC position/log row stores `zc`: the candidate zones with their features and which one was taken.
   The Reviewer backfills `zc` + labels for older rows from historical klines, a few trades per cycle.
4. `smZoneTune(rows)` turns labelled candidates into `RV.smAdj.zone`: weights / thresholds (minimum zs,
   prefer fresh, prefer first/last on the leg, FVG vs OB, etc.), each with its n and reason.
   It is sticky like the other learned rules and is shown in the Reviewer panel's rule list.
   `smRules().zone` feeds `smZoneScore`.
5. `tools/smc-replay.mjs <state.json> <out.json>` (offline, Node vm + Aster klines), for each of the 30 trades:
   - steps 15m bars from t0 − 12h through the hold time;
   - simulates the current rules vs option B: same exits as the trader (stop, half at tp1R → breakeven, target,
     time stop), stop first when stop and target fall in one bar, fees 0.04% + slippage 0.10% per side;
   - lists every candidate zone at the setup with its label, and whether the chosen zone was the best one;
   - runs `smZoneTune` on those rows and shows what the trader would change.

## Approaches considered
- **Desk-side backfill (picked):** keeps data out of the public repo, and the trader keeps re-tuning as trades accrue.
- **Commit a seed file of labelled zones:** simpler, but it puts trade data in the public repo.
- **One-off offline tuning that Claude applies by hand:** not "the trader adjusts itself".

## Verification
- Unit tests in `tests/smc-zones.mjs`:
  - default weights pick the same zone as before on the smc-sweep case;
  - weights that favour OB pick the OB;
  - the labeller returns right / wrong / untouched on synthetic paths;
  - the tuner makes no change at n < 5 and changes on a clear split.
- The existing suite, the desk smoke test and the cloud dry-run must still pass.
- Replay sanity check: the simulated current-rules result is compared with the actual result per trade, and the gap is reported.
