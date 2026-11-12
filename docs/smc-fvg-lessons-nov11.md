# SMC Trader: FVG lessons from 5 videos (Nov 11, 2026)

Fred sent 5 videos: an ICT 2024 Mentorship clip ("You're drawing your FVGs wrong") and 4 GXT model course lessons (Phases of Price, Key Levels, Invalidation, Candle Confirmation). Only the concepts were used; nothing was reproduced. The audio transcripts were poor, so most of this comes from the slides.

## Already in the SMC Trader (checked)
- **FVG drawing (ICT):** the gap runs wick to wick, from candle 1's high/low to candle 3's low/high, not body to body. `smSetup` already does this. CE (consequent encroachment) = the gap's midpoint; the "enter at the midpoint" rule is `needDepth`.
- **Phases of price (GXT):** expansion → retracement → consolidation → reversal. Covered by the `cycle` item and by continuation setups.
- **Key levels (GXT):** relevant swing, protected swing and failure swing ideas are covered (stop beyond the sweep, `smPath`, `smProtected`).
- **Gap filtering (GXT):** take the gap left by the expansion after the higher-timeframe C2 reversal, on the lower timeframe, matched to the room to the draw. Covered by the entry gap being inside the displacement after the sweep, plus `room`, `path`, `draw` and 15m confirmation for 1h setups.

## Added Nov 11
- Quality bonus **`c2`, candle confirmation**: good when the sweep candle (C2) closes back inside in the trade's direction, or (two-stage) when the next candle (C3) closes beyond C2.
- Quality bonus **`open`, intra-candle reversal**: good when the sweep went past the open of the higher-timeframe candle it happened in (1h candle for 15m setups, 4h for 1h setups): the manipulation leg is done.
- **`invExit`** (default on; Settings → "When the entry gap fails"): before the half is taken, exit when a closed candle on the setup's timeframe closes through the far side of the entry zone. In a test this cut a would-be −1R loss to −0.61R.
- **`ceBroke`**: set when a candle body closes past the gap's CE after entry. Recorded for later study only.
- Reviewer: `c2` and `open` are in `SM_FACTOR`, so the SMC review compares trades with and without them.

## Not done, and why
- **PSP / SMT** (divergence against a correlated market): needs a truly correlated pair (ES/NQ, gold/silver). Aster small caps don't move candle for candle with BTC, so a "divergence" would almost always be present and mean nothing.
