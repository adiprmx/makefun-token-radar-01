# makefun-token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/adiprmx/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/adiprmx/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. It reads the sealed DefiLlama snapshot (`/input/snapshot.json`), ranks every pre-token protocol the snapshot can honestly rank by an implied launch value, and hands in a static dashboard a reader can sort, filter and open per protocol.

## The model (radar-2)

`implied = round(tvl_usd x category multiple x growth x maturity x breadth)`

- **Category multiple**: the median market-cap-per-TVL-dollar of the live protocols in the same category (at least 3 of them), else the global median across all live protocols; clamped to [0.05, 1.5]. Recomputed from the snapshot on every run — the market itself prices each category, and no category value or protocol name is hard-coded.
- **Growth**: `1 + clamp(change_7d, -60, 120) / 100 x 0.6`.
- **Maturity**: `0.6 + min(age_days, 1095) / 1095 x 0.4` (unknown age: 365 days).
- **Breadth**: `1 + 0.02 x min(chains - 1, 5)`.

## The board

198 rows: the 40 watchlist protocols plus 158 other rankable pre-token protocols the snapshot holds, above or below the $50M floor. Wrapped, staked and bridged products of tokens that already trade are set aside (144 of them), as are the 24 live-token protocols, shown with their market caps instead of a model value. Every row carries an 8-step farm plan with costs and times, derived from the protocol's category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. The dashboard is a static page with no network: open `dashboard/index.html` beside `data.js` in any browser.

## Files

- `main.ts` — the entry program
- `lib/model.ts` — the radar-2 model, the board, the farm plans
- `dashboard/` — the page (`index.html`, `app.css`, `app.js`)
- `screenshots/` — the board, a detail view and a filtered view
- `vendor/makefun-board.ts` — make.fun's dossier library, unchanged
- `LICENSE` — MIT

---

Entered on [make.fun](https://make.fun/?ref=1c6jcmp6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
