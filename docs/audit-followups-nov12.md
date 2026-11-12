# Aster Desk: audit follow-ups (Nov 12, 2026)

Follows `claude/workstation-audit-nov11.md`. That doc's "still open" note about the unlock publish is resolved here (item 6).

## What was done
Fred: "do all of it except 1" (momentum stays on, unchanged). Deployed in commit d98c1d0; readings in notes-branch commit f03a84b.

### 2 · The Reviewer understands Fred's comments
- **Phrase reader** (`youRead(note, side)` in review.js) now knows the trade's side. New readings:
  - "should have been a short / I would do a short / short instead of long / wrong direction / 應該做空" on a trade that went the other way → **trade the other side** (`flip`).
  - "enter when it visits / reaches / retests / comes back to…", "wait for the retest / pullback", "wrong timing", "entry should be around the stop", 等回調 → **enter later** + edge entry.
  - "1h / 1hr / hourly / trend is dropping (rising)" → against the higher timeframe if it opposes the trade, otherwise "higher timeframe was fine".
  - "better point of interest", "right trend", "classic short setup".
  - It now reads 10 of Fred's 11 written comments (was 3).
- **Thresholds:** a point counts at 2 and a third of the reviews that say anything (grade-only reviews no longer dilute it), or at 3 regardless. SMC tally uses the last 40 reviewed SMC trades.
- **Rules from it:** `flip` → SMC "only when the higher timeframe clearly agrees" (`needHTF`); for the Trader it counts like "skip" (+1 sign). "Enter later" → SMC midpoint rule (`needDepth`).
- **Claude readings (`rd`).** When Fred asks in chat, Claude reads his reviews (comments and pictures) and saves a reading on each review record in `manual-reviews.json` on the notes branch:
  `rd: {a: [...], b: [...], d: [...], txt: "one or two sentences", n: <length of the comment + captions text>, t, by: "Claude"}`.
  - `a` (what he'd have done): same, flip, skip, later, earlier, exitE, hold, wider, tighter, bigger, smaller.
  - `b` (part that was poor): draw, cont, poi, room, htf, ob, gap, sweep, depth.
  - `d` (part that was fine / holds a rule): smc_gap, smc_ob, smc_htf, smc_poi, smc_path, smc_draw, tight, quickstop, forming.
  - The Reviewer uses `rd` instead of the phrase reader while `n` still matches the text (`youReadM`). The form and the review wall show "Claude read this as…".
  - Done for the 11 reviews with text on Nov 12. Tally: other side 3 (KOMA, AKE, LYN), enter later 3 (EVAA, LYN ×2), skip 2.5, same 3.
- **Result in force for the SMC Trader:** quality ≥ 70 (the Reviewer's own rule), higher timeframe must agree, midpoint entries, half at +1.2R. Expect clearly fewer SMC trades.
- Checked and **not** added: a stricter trend filter (no longs under a falling 1h EMA50). All three "should have shorted" trades were under a falling 1h EMA50, but longs in that state made −0.04R over 11 trades and include three trades Fred graded A/B (+2.03R, +1.81R, +1.78R), so the trades don't back it yet.

### 3 · SMC Trader
- Draw on liquidity is no longer scored (or required) on continuation setups.
- `minStopPct` 1.5: a stop closer than 1.5% is moved out to 1.5% (the target must still pay 2R).
- `minDepth` 15: no entry in the outer 15% of the zone (stacked-gap zones and 15m-confirmed 1h setups exempt). A candle that only wicked the edge no longer uses the zone up (`smTapDepth`).
- Both are on SMC → Rules & settings.

### 4 · Reviewer
- Reviews use the last 40 trades of **each** strategy (was 40 mixed).
- **Rules stay until the trades say the opposite** (`rvSticky`, state in `RV.sticky`): overall / one-side rules need 6+ (4+) newer trades averaging ≥ 0; "take first" tags 3+ newer trades of that tag below 0; settings (half, target, stop buffer, hold, volume, funding, unlock window) 12 newer trades without re-triggering; rules that stop their own evidence (skipped tags, "Reversed only") are re-tested after 5 days. Fred's disagreement lifts a rule at once.
- Coaching memos are sent only when a grade or the set of recommendations changes.
- First review under the new window: "Skip Short squeeze setups" (3 trades, −0.72R) is back and will now stay.

### 5 · Tracker
- The day tracker follows the top 5 gainers and losers **among coins with ≥ $300K volume that moved ≥ 8%** (`CFG.trkMinVol`, `CFG.trkMinMove`, GainerLoser → Settings; `trkTop()` in engine.js). The boards still list everything above the $100K filter. Coins already tracked drop out 24 h after they last qualified.

### 6 · Unlock calendar publish
- Cause: scheduled sessions have no `add_repo` tool, and the task skipped the publish step silently when it could not call it. A plain `git clone https://github.com/fredyu1996/aster-desk` and push works there (tested with a one-off run on Nov 12, 00:01 UTC).
- The daily task now clones and pushes directly and ends its message with "Desk repo updated (…)" or "DESK REPO NOT UPDATED: <error>". First real run: Nov 12, 4:32 AM Creston time.

### Not done
- Momentum strategy (Fred's choice).
- Cross-feeding OI / flow into the SMC Trader, opposite-side flag between the traders, storage trimming.

## Later on Nov 11 (Vancouver): mark your own setup on the review chart
Fred: "I want to change and mark the review chart so the Reviewer can see what the setup would look like if I did it." Commit e77287f.
- Reviewer → "On the chart" → **✏️ Mark my own setup on this chart** opens a MY SETUP toolbar:
  - Long / Short.
  - Tools: Entry, Stop, Target, Zone (drag a box), Line (drag), Label (type, then click), Erase.
  - Undo, Clear, Done.
  - After an entry the tool moves on to Stop, then Target.
  - Clicks snap to a candle's open / high / low / close within 7 px.
- Marks are stored as prices and times in `plan` on the review record (`{side, entry: {t, p}, stop, target, zones, lines, labels, res}`, notes branch), so they look the same on the panel and on the review wall. Pink = Fred's marks; the trader's ✓/✗ tags can be hidden with the existing button.
- **Replay (`rvPlanSim`, lessons.js).** From the clicked time:
  - fills when price trades through the entry;
  - stop is checked before the target inside a candle;
  - fees and slippage are included;
  - runs to the end of the chart (24 h after the trade's exit).
  - Shown live: "Your plan: target reached +2.4R vs the SMC Trader made −1.27R". Stored as `plan.res` on save. The form shows the running average of his plans vs the trader on the same trades (`rvPlanStats`).
- **Counts like a comment (`planPoints` in review.js, merged in `youReadM`, so the cloud uses it too).** Measured against the trade:
  - the other side → trade the other side;
  - an entry ≥ 0.25R deeper → enter later + edge entry;
  - with the same entry, a stop ≥ 0.2R further out → wider stop; further in → tighter stop;
  - a target ≥ 30% short of the trade's → exit earlier; ≥ 40% past it → hold longer.

## Nov 12: "SMC trader looks worse since the update"
- **Since the update (00:15 UTC Nov 12 → 20:15 UTC):** 5 SMC trades, 1 win, −2.75R, −$27.
  - Before the update: 25 trades, −0.03R average.
  - With a ~44% win rate, 4 losses in 5 trades happens by chance about 1 time in 4, so this is not evidence by itself.
- **Bug found and fixed (commit 98ac3e6).** The "rules stay until the trades say otherwise" change had only been applied to the Trader's rules. The SMC rules (`smLearn`) still flipped:
  - minQ 70 was lifted at 06:10;
  - minQ came back as 65 at 15:50;
  - needPOI was added at 15:50.
  - The AGT long at 15:45 (quality 61, not at a higher-timeframe zone) got through in that gap and lost −1.06R in 2 minutes.
  - Now `RV.smSticky` keeps an SMC rule until 6+ SMC trades closed since it last had support average ≥ 0, or 5 days pass. Fred's disagreement still lifts a rule at once.
- **Per trade:**
  - AGT cont long +0.59R.
  - IDOL 1h OB long −1.02R: 10% stop, −9% in 10 minutes; the 1h ATR was ~12% of price.
  - AGT rev long −1.06R: q61, a 5m candle with a 9% range, the coin up ~200% on the day.
  - AKE A88 long: cut at −0.22R by the new invalidation exit.
  - KGEN cont short −1.05R: thin coin, spiked 5% in 15 minutes.
  - None of the Nov 11 changes (min stop 1.5%, 15% depth, no draw score on continuation) was involved in a loss; all stops were 3–10%.
- **Checked and dropped:** a cap on zone height in ATR. No past SMC zone was taller than 2.9 ATR (IDOL's 37%-tall 1h OB was 2.8 ATR because the coin was that volatile), so it would not have changed anything.
- **Evidence noted, not acted on:**
  - Taker flow against the trade at entry: −0.41R over 12 trades vs +0.08R over 18 with it.
  - Coins up or down 15–40% on the day: −0.95R over 8 trades.
  - Both are small samples. The SMC Trader ignores Flow / OI by design (Fred, Nov 8: own judgement).
- **Fred's decision (Nov 12, 14:09 Vancouver): wait for more trades** before adding a taker-flow or daily-move filter to the SMC Trader. Re-check both splits once there are ~20 more SMC trades.
