"""Throwaway probe (branch probe/books only; never merged). One Odds API event-odds request for one upcoming game
with 10 bookmakers, to see which books return NFL player props and what it costs. Writes probe/result.json only."""
import json, os, urllib.request, urllib.parse, collections
KEY = os.environ["ODDS_API_KEY_20K"]
API = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
BOOKS = ["draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers", "espnbet", "hardrockbet", "ballybet", "fliff"]
MARKETS = ["player_pass_yds", "player_rush_attempts", "player_rush_yds", "player_receptions", "player_reception_yds",
           "player_pass_attempts", "player_pass_completions"]
GAME = ("Baltimore Ravens", "Buffalo Bills")  # 2026_08_BAL_BUF (Sunday)
def get(url, params):
    u = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.loads(r.read()), {k.lower(): v for k, v in r.headers.items()}
out = {}
events, h = get(f"{API}/events", {"apiKey": KEY})
out["events_call"] = {"credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining")}
ev = next(e for e in events if e["away_team"] == GAME[0] and e["home_team"] == GAME[1])
out["event"] = {"id": ev["id"], "commence_time": ev["commence_time"]}
body, h = get(f"{API}/events/{ev['id']}/odds", {"apiKey": KEY, "bookmakers": ",".join(BOOKS), "markets": ",".join(MARKETS),
                                                  "oddsFormat": "american", "dateFormat": "iso"})
out["odds_call"] = {"credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining"),
                    "books_requested": BOOKS, "markets_requested": MARKETS}
books = {}
lines = collections.defaultdict(dict)  # (market, player) -> book -> point
for bk in body.get("bookmakers", []):
    mk = {}
    for m in bk.get("markets", []):
        players = {o.get("description") for o in m.get("outcomes", []) if o.get("description")}
        mk[m["key"]] = {"outcomes": len(m.get("outcomes", [])), "players": len(players)}
        for o in m.get("outcomes", []):
            if o.get("name") == "Over" and o.get("description"):
                lines[(m["key"], o["description"])].setdefault(bk["key"], []).append([o.get("point"), o.get("price")])
    books[bk["key"]] = mk
out["by_book"] = books
out["books_with_no_props"] = [b for b in BOOKS if b not in books]
out["unique_markets_returned"] = sorted({m for b in books.values() for m in b})
# sample: line comparison for players offered by 3+ books
samp = [{"market": k[0], "player": k[1], "over_by_book": v} for k, v in lines.items() if len(v) >= 3]
out["sample_compare"] = sorted(samp, key=lambda x: (x["market"], x["player"]))[:25]
json.dump(out, open("probe/result.json", "w"), indent=1)
print(json.dumps({k: out[k] for k in ("events_call", "odds_call", "books_with_no_props", "unique_markets_returned")}, indent=1))
