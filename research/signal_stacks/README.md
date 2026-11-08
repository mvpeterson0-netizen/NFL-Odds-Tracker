# Signal Stacks research (reproducible)
```
python -m research.signal_stacks.dataset      # builds props.csv (one main line per player/game/market) + unmatched.json
python -m research.signal_stacks.spread_study # spread_bands.csv, checkpoints.json
python -m research.signal_stacks.signal_eval  # signal_candidates.json, weather_splits.csv, weather_missing.json
python -m research.signal_stacks.make_seed    # SQL seed for the private signal_research table (do not commit)
```
Flags: `--cache DIR` (downloaded nflverse files) and `--out DIR`. Outputs are not committed.
Main line = the app's `choose_main` (DraftKings, FanDuel fallback, point closest to even money with both prices). 2025 archive snapshot = kickoff-3h. Pushes are refunded; ROI is units over non-push bets at recorded prices; CIs and p-values are game-clustered bootstraps; Benjamini-Hochberg over the whole 126-cell candidate family.
Spread = nflverse schedule `spread_line` (a closing-type number for 2025, a build-time read for 2026), NOT a capture-time quote.
