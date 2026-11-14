# SMC playbook for the SMC Trader (from Fred's thesis PDF and the MMXM video lessons, Nov 9 2026)

Sources:
1. Bikesh Maskey, *Smart Money Concepts in the Forex Market — a strategy for individual traders* (Centria UAS bachelor thesis, July 2021, 63 pp).
2. Video lessons Fred uploaded on Nov 9 from an ICT-style market-maker-model (MMXM) course (forex, gold, index futures examples). Watched as frames every 15–20 s plus rough offline transcripts:
   - Failure Swings: Low Resistance Liquidity (~10 min)
   - Breakaway Gaps & the Re-Delivered Re-Balanced PD Array (~13 min)
   - IPDA Market Cycles (~15 min)
   - Orderblocks (~20 min)
   - Internal & External Range Liquidity: the relationship (~19 min)
   - Previous Day Highs & Lows: the easiest draws on liquidity (~12 min)
   - Mitigation Blocks (~6 min)
   - Daily Swing Highs & Lows: turning points (~10 min)
   (One upload was a duplicate of the failure-swings lesson.)

All were written for forex; the concepts below are the ones that carry over to small-cap crypto perps on Aster, mapped to the desk's timeframes (15m/1h entries, 1h/4h higher timeframe).

## What the thesis says (digest)
- **Higher timeframe first.** Bias comes from the higher-timeframe structure (HH/HL = bullish, LH/LL = bearish, equal highs/lows = range). Trade the lower timeframe within it. Lower-timeframe reversals that matter start at higher-timeframe zones.
- **Break of structure** confirms a change: a close beyond the last swing.
- **Imbalances** (FVGs) come from one-sided institutional orders; price tends to react when it returns to them.
- **Supply & demand zones**: the base (last opposite candle / short consolidation) before an *impulsive* move. Strength = how impulsive the move away was. Refine higher-timeframe zones on a lower timeframe for a tighter stop.
- **Patterns**: Drop-Base-Rally / Rally-Base-Drop (reversal), Rally-Base-Rally / Drop-Base-Drop (continuation). Trade the first retest; if price never reaches the zone, no trade.
- **Lower-timeframe confirmation** at 1:4 to 1:6: wait for the lower timeframe to break structure in the trade direction inside the zone.
- **Risk**: stop beyond the zone's far edge, targets at the next opposing zone / swing, RR at least 1:1.5, risk 1–2% per trade.

## What the video lessons say (digest)
- **Failure swings / low- vs high-resistance liquidity**: a failure swing is a high that fails to beat the previous high (or a low that fails to break the previous low). Failure swings on the far side of your trade are low-resistance liquidity: price runs through them, so they are the best targets (better still while in discount for longs / premium for shorts). On your own side, a swing that ran the previous swing and was rejected is high-resistance liquidity: price struggles to get back through; it confirms the turn and protects the stop.
- **Market cycles (IPDA)**: price only consolidates, expands, retraces or reverses. Consolidation is always followed by expansion. After expansion: retracement (return to an OB/FVG = continuation) or reversal (an AMD pattern). Price never goes straight from consolidation to reversal or retracement; when it looks like it does, that's a trap followed by accumulation → manipulation (a run of the range extreme) → distribution.
- **Internal vs external range liquidity**: external = old highs/lows; internal = FVGs. Price only draws to old highs/lows or rebalances an imbalance. When external liquidity is taken, the next draw is an FVG; when an FVG is tagged, the next draw is an old high/low on the other side. Use it top-down (monthly→daily structure, weekly→4h, daily→1h) for bias.
- **Previous day high/low**: the easiest liquidity pools and daily draws: in bullish order flow price seeks buy-side above the previous day's high; in bearish, sell-side below the previous day's low.
- **High-probability order blocks**: form at a key level; the OB candle itself pushes into a short-term liquidity pool (a down-close candle running sell stops when bullish); it supports price toward a draw on liquidity; timeframe pairing daily→1h, 4h→15m, 1h→5m.
- **Mitigation blocks**: failed order blocks of the other side (bullish OBs on the buy side of the curve in a sell model, and the reverse) become where smart money mitigates; pair them with a new PD array (FVG) inside the block's zone.
- **Breakaway gaps / RDRB**: a gap that stays open because the price range around it has been delivered both ways (balanced). The move may never return deep into it; the re-delivered re-balanced area can be used as an entry array on its own.
- **Daily swing highs/lows**: a 3-candle turning point matters when it forms at a key level (discount array for lows, premium for highs) and/or after running another swing, with a draw on liquidity still ahead.

## What changed in the SMC Trader (smc.js, Nov 9)
- **Higher-timeframe zones** (`smZonesB`): on the 1h (for 15m setups) and 4h (for 1h setups): last opposite candle before a departure of 1.5+ ATR within 3 candles or an imbalance. Dead once a candle closes through it; "fresh" until retested. Also keeps the HTF range midpoint.
- **POI** (`smPOI`, factor `poi`): 2 = the sweep went into a fresh HTF zone, or ran an HTF swing in discount (long) / premium (short) (daily-swing lesson); 1 = an already-tested HTF zone or an HTF swing elsewhere; 0 = neither. **Rule (`poiRule`, default on):** if the higher timeframe isn't trending the trade's way, a POI is required. Reviewer rule `needPOI`.
- **Departure strength** (factor `dep`).
- **Room** (`smRoom`, factor `room`, `roomCheck` default on): an opposing HTF zone before the target caps the target at its near edge; under minRR (2R) → no trade.
- **15m confirmation for 1h setups** (`smConfirm15`, `ltfConfirm` default on).
- **Continuation setups** (`smContSetup`, `cont` default on): rally-base-rally / drop-base-drop with the higher timeframe. Reviewer rule `noCont`.
- **Path to the target** (`smPath`, factor `path`, `pathCheck` default on): failure swings vs high-resistance swings between entry and target; target moved in front of a high-resistance swing, or no trade if under 2R.
- **Protected stop for continuation** (`smProtected`, factor `prot`).
- **Draw on liquidity** (`smDraw`, factor `draw`): on the HTF bars, whichever happened last sets the draw: sell-side taken or a bullish HTF FVG tagged → draw up; buy-side taken or a bearish FVG tagged → draw down. Scored, not required; Reviewer rule `needDraw`. (Since Nov 11: not scored or required on continuation setups.)
- **Previous day high/low** (`smPrevDay`, factor `pday`, `pdLiq` default on): untaken PDH (long) / PDL (short) join the target pools; sweeping them or targeting them scores 2 (bonus item). Drawn on the SMC chart.
- **Mitigation block** (`smMitigation`, factor `mit`): entry zone overlapping a broken HTF zone of the other side → bonus.
- **Market cycle** (`smCycle`, factor `cycle`, reversal setups only): 2 if the sweep took the edge of a tight range (AMD) or came after an expansion; 1 otherwise.
- **Breakaway gaps** (`zone.bg`, info only): 2+ gaps in the impulse → "wait for the midpoint" doesn't apply.
- Quality score: bonus items (`pday`, `mit`, `bg`) only count when present and good.
- Reviewer: SMC review factors include `dep`, `poi`, `room`, `conf`, `trend`, `path`, `prot`, `draw`, `pday`, `mit`, `cycle`, `bg`. Fred's comments map to these (e.g. "not at a HTF zone" → POI flag; "against the draw" → draw flag; "don't trade continuation" → pause continuation; "good FVG / good zone / with the draw" hold the matching rule).
- Live checks (Nov 9–10 UTC): POI 2 on 6 of 28 coins; AI and HANA blocked by an opposing zone; 5 setups with a clean failure-swing path, SKYAI blocked by a high-resistance swing; HTF draw up on 7 and down on 7 of 14 setups; one mitigation block (SI long), one expansion→reversal (AKE), UAI continuation short targeting the previous day's low.

## Reviewer coaching of the SMC Trader (added Nov 9, Fred: "review how the SMC trader is doing in terms of OB position, FVG quality, liquidity and give feedback on how to improve")
- **After-the-fact audit** (`smAudit`, review.js): SMC trades opened before the quality read existed are re-read with the candles that existed at entry: 96 × 15m and 96 × 1h candles closed before the entry, plus the 15m candle that was still forming, rebuilt from 1-minute candles up to the entry. The SMC reader runs on them through a candle override (`SM_OVR` in smc.js, restricted to the trade's direction), and the setup is accepted if its zone overlaps the trade's logged zone. Stored as `x.q` with `retro: 1` (`x.qa = {ok|miss}`). Runs inside `rvFollowTick` (browser every 2 min, cloud each cycle).
- **Coaching** (`smCoach`, `smOutcome`): three areas, graded A–F (≥75/60/45/30%):
  - *Zones (OB & FVG)*: share of zone tests that held (+1R before failing) vs failed (−0.8R or worse without reaching +0.5R); FVG vs order-block hold rates; healthy vs thin gaps, displacement vs none, order blocks that ran liquidity, deep vs edge entries.
  - *Liquidity*: sweeps of equal highs/lows or the previous day's level vs a single swing; at a higher-timeframe POI vs not; with vs against the draw; how far price got toward the target liquidity (max R ÷ planned R); how many reached it; how many reached it after the exit.
  - *Execution*: stops run within 45 min or run and then the idea worked (24h follow-up 'tight'); profit given back (+1R, closed under +0.2R).
  - Each finding names the setting it would change (`tp1R`, `stopBuf`, `minQ`, `fvgOnly`, `needDepth`, `needPOI`, `needDraw`). It becomes a rule in `smLearn` once "solid" (5+ trades on each side of a comparison, or 8+ for a single count) and learning is on; before that it's a note.
- **Conversation** (`smCoachTalk`): when grades or findings change, the Reviewer memos the SMC Trader (grades + the top 2 things to work on) and the SMC Trader answers per finding. Stored in `RV.memos` and `RV.smCoach`.
- **Where**: Reviewer → SMC review tab, SMC desk → "Reviewer's coaching" tab, and each SMC trade's chart.

## Not done (possible next steps)
- Refining the stop to the 15m low inside the 1h zone (tighter stop, bigger RR; risk of quick stop-outs on small caps).
- Using the re-delivered re-balanced area as an entry array on its own (needs 5m candles to see the balanced part of a 15m candle).
- Session timing ideas from the course (NY session, Asian session models) aren't used: crypto trades 24/7 and the course's sessions are forex-specific.

## SMC Big (Nov 13)
The SMC Big account `SB` runs the same strategy on the top 10 coins by volume, with `SB_OV` on top of the live SMC cfg: min stop 0.5%, slippage 0.02%, stop buffer x0.25, tight 0.4%, screens off. Big caps move about 1/5 as much as small caps, so the stop floor, buffer and costs shrink to match. The quality score is ATR-relative, so it needs no scaling.
