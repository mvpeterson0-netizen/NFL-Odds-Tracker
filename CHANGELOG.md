# Changelog

- 2026-10-20 · V1.0 · Baseline: pipeline, site, scheduled workflow (tag `V1.0`).
- 2026-10-20 · PR: game selector row · Board shows a row of the selected week's games; click one to show only that game's players. UI only.
- 2026-10-20 · PR: opponent defense rank · New "Opp D rank" column on the Board and player pages: how the opponent ranks (1 = fewest allowed) in that stat against that position, using only games before each game; current-season rank on hover. Computed from nflverse stats.
- 2026-10-20 · PR: game weather · Temperature, wind and precipitation for every game from Open-Meteo (free, no key): forecast until kickoff, observed values about 6 days after; domes labeled. New derived file data/weather.csv. A weather outage never fails the run.
- 2026-10-20 · PR: weather fix · Keep forecast requests inside Open-Meteo's 16-day range (one stadium's request was rejected).
- 2026-10-20 · PR: API key rotation · Supports up to 6 Odds API keys (ODDS_API_KEY, ODDS_API_KEY_2..6); each pull uses the first key with enough credits and falls back to the next if one is rejected. Pull log notes the key number, never the key.
- 2026-10-20 · PR: scheduled snapshot pulls · Extra Odds API pulls for line movement: Monday 8 AM CT (hourly until props are posted), Thursday 2 PM, Sunday 8 AM. Shown with a yellow Mon/Thu/Sun AM chip until the graded pre-game line (~3 h before kickoff) arrives, then as movement (Mon → Thu → Sun AM → Pre). Never graded; only uses credits not needed for pre-game pulls.
- 2026-10-20 · PR: merged game cells · Board shows each game once, in one cell spanning all of that game's rows; thicker line between games, thin line between players. UI only.
- 2026-10-20 · PR: pinned game info · Board table scrolls in its own box; column headers and the current game's info stay pinned while scrolling. UI only.
- 2026-10-20 · PR: weather labels + Guide tab · One-glance weather label per game (Nice, Rainy, Snowy, Windy, Freezing, Cold, Hot, combined with &; Dome). Triggers listed on a new Guide tab, generated from the same thresholds the labels use. UI only.
- 2026-10-20 · PR: chart projection + weather emojis · Player chart shows the pre-game line value, or the latest Mon/Thu/Sun AM snapshot (dashed, labeled) until it arrives, plus actual values; y-axis gridlines now sit on exact round numbers; page re-checks for new data every 5 min. Weather labels get emojis (☀️ 🌧️ ❄️ 💨); the "(roof?)" label is removed.
- 2026-10-20 · PR: Stix branding + headshots · App renamed Stix with the new logo (header, browser tab icon, iPhone home-screen icon). Player headshots on the Board and player pages (nflverse headshot links, served from NFL's image CDN). UI + one build field.
