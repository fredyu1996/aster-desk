# Aster Desk

A walkable 3D trading workstation for small-cap perps on Aster DEX, with seven rule-based agents and a **paper** trading account (no real orders).

- **The desk:** `index.html`, served by GitHub Pages. Open it on any computer.
- **The cloud trader:** `.github/workflows/cloud-trader.yml` runs `bot/run.mjs` every ~5 minutes. It uses the desk's own trading code (`bot/core.js`, generated from the desk source) and keeps the shared paper account in a separate **private** repo.
- **Setup:** add the repository secret `DATA_TOKEN` (a fine-grained token with *Contents: read and write* on the private data repo only). The data repo defaults to `fredyu1996/aster-desk-data`; override it with the repository variable `DATA_REPO`.

No trades, balances or keys are stored in this repo.

## Development
Source is in `src/`; `python3 build.py` builds `index.html` and `bot/core.js` (run `npm install` once for three.js). Tests: `node tests/smc-sweep.mjs` and `node tests/desk-smoke.mjs`. Architecture, deploy steps and project history: `CLAUDE.md` and `docs/`.
