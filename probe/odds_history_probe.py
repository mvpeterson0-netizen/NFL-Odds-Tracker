"""One-time probe (Michael's Yes, 2026-10-28): does The Odds API historical endpoint have
DraftKings/FanDuel player props for a 2026 week-1 game, and what does it cost?

Game: 2026_01_NE_SEA, kickoff 2026-09-10T00:20:00Z. Snapshot: 3 h before kickoff.
Spends at most 1 (events) + 70 (7 markets x 1 region) credits. Writes probe/result.json and
probe/raw_odds.json. The API key is never written anywhere.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_nfl"
KEY = os.environ.get("ODDS_API_KEY_20K", "").strip()
DATE = "2026-09-09T21:20:00Z"
MARKETS = ["player_pass_yds", "player_rush_attempts", "player_rush_yds", "player_receptions",
           "player_reception_yds", "player_pass_attempts", "player_pass_completions"]
FLOOR = 1000  # never probe if the key has fewer credits than this


def get(path, params):
    url = f"{API}{path}?" + urllib.parse.urlencode({"apiKey": KEY, **params})
    req = urllib.request.Request(url, headers={"User-Agent": "stix-probe"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def credits(h):
    return {"last": h.get("x-requests-last"), "used": h.get("x-requests-used"),
            "remaining": h.get("x-requests-remaining")}


def main():
    out = {"game": "2026_01_NE_SEA", "date": DATE}
    if not KEY:
        out["status"] = "ODDS_API_KEY_20K secret is empty or missing"
        return out
    st, h, body = get("/events", {"date": DATE, "dateFormat": "iso",
                                  "commenceTimeFrom": "2026-09-09T23:00:00Z",
                                  "commenceTimeTo": "2026-09-10T02:00:00Z"})
    out["events_call"] = {"http": st, "credits": credits(h)}
    if st != 200:
        out["events_call"]["body"] = body[:300].decode("utf-8", "replace")
        out["status"] = "events call failed"
        return out
    ev = json.loads(body)
    out["events_call"]["snapshot"] = ev.get("timestamp")
    out["events_call"]["events"] = [{"id": e["id"], "home": e["home_team"], "away": e["away_team"],
                                     "commence": e["commence_time"]} for e in ev.get("data", [])]
    rem = h.get("x-requests-remaining", "")
    if rem.isdigit() and int(rem) < FLOOR:
        out["status"] = f"stopped: only {rem} credits left"
        return out
    e = next((x for x in ev.get("data", []) if x["home_team"] == "Seattle Seahawks"
              and x["away_team"] == "New England Patriots"), None)
    if e is None:
        out["status"] = "NE @ SEA not in historical events"
        return out
    st, h, body = get(f"/events/{e['id']}/odds", {"date": DATE, "bookmakers": "draftkings,fanduel",
                                                 "markets": ",".join(MARKETS), "oddsFormat": "american",
                                                 "dateFormat": "iso"})
    out["odds_call"] = {"http": st, "credits": credits(h)}
    if st != 200:
        out["odds_call"]["body"] = body[:300].decode("utf-8", "replace")
        out["status"] = "odds call failed"
        return out
    js = json.loads(body)
    with open("probe/raw_odds.json", "w") as f:
        json.dump(js, f, indent=1)
    d = js.get("data") or {}
    summ = {}
    for bk in d.get("bookmakers", []):
        for m in bk.get("markets", []):
            players = {o.get("description") for o in m.get("outcomes", [])}
            summ[f'{bk["key"]} {m["key"]}'] = {"outcomes": len(m.get("outcomes", [])), "players": len(players),
                                              "last_update": m.get("last_update")}
    out["odds_call"].update({"snapshot": js.get("timestamp"), "previous": js.get("previous_timestamp"),
                             "next": js.get("next_timestamp"), "by_book_market": summ})
    out["status"] = "ok"
    return out


if __name__ == "__main__":
    try:
        res = main()
    except Exception as ex:  # record, never print the key
        res = {"status": f"error: {type(ex).__name__}: {str(ex)[:200]}"}
    with open("probe/result.json", "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "odds_call"}, indent=1)[:3000])
    sys.exit(0)
