# nyAm test switch (Nov 28, 2026): no SMC entries Mon–Fri 09:30–12:00 New York

Backtested as a test switch; off on every account (see Decision below).
- Tool: `tools/smc-nyam-test.mjs`.
- Rules in force come from the state of 2026-11-28.
- `nyAm 0` was checked against base trade for trade: identical in all 6 runs.
- The lead came from the ICT study (`docs/ict-study.md`), using the year backtest to Nov 28 and the live SM / SB logs. The first three rows below overlap that data. The last three were never looked at before.

| Set | Window | base | nyAm 1 | half 1 base → nyAm | half 2 base → nyAm |
|---|---|---|---|---|---|
| BTC/ETH (SMC Big settings) | 365 d to 2026-11-28 | +11.1R n121 | **+15.6R n112** | +13.2 → +15.7 | −2.2 → −0.2 |
| Big caps (SMC Big) | 21 d to 2026-11-28 | −2.3R n64 | **+2.1R n58** | +8.0 → +8.4 | −10.2 → −6.3 |
| Small caps (SMC Trader) | 21 d to 2026-11-28 | −2.2R n20 | −2.8R n17 | −0.6 → −2.3 | −1.5 → −0.5 |
| *Out of sample:* BTC/ETH | 365 d to 2025-11-20 | −29.0R n175 | **−22.9R n164** | −27.4 → −22.6 | −1.6 → −0.3 |
| *Out of sample:* small caps | 21 d to 2026-11-07 | +4.6R n31 | **+5.8R n28** | −1.7 → −1.0 | +6.3 → +6.7 |
| *Out of sample:* big caps | 21 d to 2026-11-07 | −3.7R n43 | −2.6R n42 | −1.7 → −1.7 | −2.0 → −0.9 |

- **NY-morning entries in base:**
  - BTC/ETH 2026: 9 trades, −4.5R.
  - BTC/ETH 2025: 13 trades, −4.7R.
  - Big caps now: 8 trades, −4.4R.
  - Small caps now: 3 trades, +0.6R.
  - Small caps before: 3 trades, −1.1R.
  - Big caps before: 1 trade, −1.2R.
- **Reading:** nyAm 1 is better in 5 of 6 sets and better in both halves in 4, including both out-of-sample BTC/ETH halves. The exception is small caps now, −0.6R, where the 3 NY-morning trades had made money. It removes 1–9% of trades. A modest effect, but consistent.
- **Decision (Fred, Nov 28):**
  - It was switched on for SMC Big + SMC BTC/ETH, then off again about an hour later.
  - Fred: "熄番，因為我想多啲單": he wants more trades, so the Reviewer and the Time Machine get more data on what works and what doesn't.
  - The switch stays in the code, 0 on every account. Test: `tests/smc-nyam.mjs`.
- **An exception for good setups only has no support yet.** In the NY morning, the best setups did worst:
  - q ≥ 90: 5 trades, 0 wins, −5.5R;
  - q 85–90: 7 trades, −2.6R;
  - A / A+: 3 trades, all losses;
  - outside the window, q 85–90 was +0.38R n55.
  - Some trades are counted in two sets (BTC/ETH sit in both the year and the big-cap runs).
- **Side finding:** the same SMC rules on BTC/ETH lost −29.0R n175 in the year before (Nov 2024 → Nov 2025; half 1 −27.4R). The +11.1R of the current year does not repeat there. Caveats:
  - the Reviewer rules were learned from 2026 trades;
  - Aster's books were thinner in 2024–25.
  - Still, SMC BTC/ETH's evidence is weaker than the current year alone suggests.

## Run
```bash
GT_PART=year GT_END=<ms> node tools/smc-nyam-test.mjs <state.json> <out.json>   # BTC/ETH 365 d
GT_PART=week GT_END=<ms> node tools/smc-nyam-test.mjs <state.json> <out.json>   # small + big caps 21 d
```
