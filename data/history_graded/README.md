# Graded historical props (research only; the app does not read this folder)

- `props_2024.csv`, `props_2025.csv`: one row per player prop, graded against nflverse results (main line = DraftKings, FanDuel fallback; DNP rows marked, not scored). Built by `research/history_2024/graded.py` (`--season 2024|2025`) from the raw archives in `data/history_2024/` and `data/history_2025/`.
- 2024 covers rushing yards and receiving yards only (all 2024 games, 1 snapshot ~3 h before kickoff). 2025 covers rushing, receiving, passing yards and receptions.
- Raw 2024 payloads: `data/history_2024/odds/<game_id>.json` (10 bookmakers), `events/`, `schedule.json`. Fetched once with `research/history_2024/fetch.py` (spends credits; do not rerun).
- Analyses: `research/three_season/` (all rules, 2024-2026), `research/discover_2024/` (2024-only discovery graded on 2025-26). Reports are in the Claude project docs.
