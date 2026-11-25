# Situational splits study (2026-11-24)

Pooled and per-player tests of rushing and receiving yards props by game situation (home/away, turf, dome, kickoff slot, prime time, division, favorite/underdog, rest, bye, game total, cold, wind), 2024 + 2025 + 2026 wk 1-11.

- `build.py <repo_root> <out_csv>`: builds the unified prop table (DraftKings main line, FanDuel fallback; pushes kept so ROI refunds them). Surface is set by home stadium (nflverse's field is stale); neutral-site games count as grass here, but GR1 leaves them out.
- `analyze.py`: pooled tests, the per-player scan (Fisher's exact test, Benjamini-Hochberg q-values), the 2024-25 to 2026 holdout and a label-shuffling baseline. Run from the folder holding `props.csv`.
- `frozen_player_signals_2026-11-24.csv`: the 63 player splits with p < 0.05 that became the **Player signals** page (`#/search/players`). Frozen on 2026-11-24; never edited afterwards.

Findings: no player split survived the false-discovery check (q < 0.25: 0), and a shuffle test gives about as many p < 0.01 results as the real data. Pooled: GR1 (grass rushing Under) and SP6 (6.5+ point underdog receiving Under) became Indicators tiles.
