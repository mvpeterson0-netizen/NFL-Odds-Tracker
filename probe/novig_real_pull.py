"""Throwaway (branch probe/novig-data only; never merged). One REAL pull for one upcoming NFL game through the new Novig
code path (odds.NFL_EXTRA_BOOKS request list, odds._main_line_rows, odds.narrow_novig), so the feature can be screenshotted
with real data and the cost of the full 10-book request can be observed. Writes probe/novig_real_rows.csv and
probe/novig_real_result.json only."""
import csv, json, os, collections
from pipeline import odds
from pipeline.common import http_get, iso, utcnow, parse_iso

KEY = os.environ["ODDS_API_KEY_20K"]
GAME_ID, HOME, AWAY = "2026_11_IND_HOU", "Houston Texans", "Indianapolis Colts"
FLOOR = 5000
out = {"run_utc": iso(utcnow()), "books_requested": odds.BOOKS + odds.NFL_EXTRA_BOOKS}
events, h = odds.fetch_events(KEY)
out["events_call"] = {"credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining")}
e = next(x for x in events if x["home_team"] == HOME and x["away_team"] == AWAY)
rem = h.get("x-requests-remaining", "")
if rem.isdigit() and int(rem) < FLOOR:
    out["stop"] = f"balance {rem} below floor {FLOOR}"
else:
    markets = odds.CORE + odds.OPTIONAL
    params = {"apiKey": KEY, "bookmakers": ",".join(odds.BOOKS + odds.NFL_EXTRA_BOOKS), "markets": ",".join(markets),
              "oddsFormat": "american", "dateFormat": "iso"}
    body, h, status = http_get(f"{odds.API}/sports/{odds.SPORT}/events/{e['id']}/odds", params)
    out["odds_call"] = {"status": status, "credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining"),
                        "markets_requested": markets}
    if status == 200:
        event = json.loads(body)
        ko, captured = parse_iso(e["commence_time"]), utcnow()
        mins = round((ko - captured).total_seconds() / 60)
        raw = odds._main_line_rows(event, GAME_ID, "track", captured, ko, mins, "n/a", {})
        rows = odds.narrow_novig(raw)
        out["rows_before_narrowing_by_book"] = dict(collections.Counter(r["book"] for r in raw))
        out["rows_after_narrowing_by_book"] = dict(collections.Counter(r["book"] for r in rows))
        out["books_returned"] = sorted({r["book"] for r in raw})
        with open("probe/novig_real_rows.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=odds.CAPTURE_FIELDS)
            w.writeheader()
            w.writerows(rows)
json.dump(out, open("probe/novig_real_result.json", "w"), indent=1)
print(json.dumps(out, indent=1))
