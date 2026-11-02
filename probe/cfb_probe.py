"""One-time probe: does The Odds API have historical CFB passing-yards props? Standard library only.
Spends at most ~11 credits: 1 historical events call + 1 historical event-odds call (player_pass_yds only).
Writes probe/cfb_probe_result.json. Never prints or stores the API key."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

KEY = os.environ.get("ODDS_API_KEY_20K", "")
BASE = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_ncaaf"
OUT = {"steps": []}
# Well-known Power 4 / Notre Dame schools, used only to pick which listed game to spend the one odds call on.
P4_HINTS = ["ohio state", "michigan", "georgia", "alabama", "texas", "oregon", "penn state", "lsu", "notre dame",
            "clemson", "tennessee", "ole miss", "oklahoma", "usc", "iowa", "wisconsin", "florida", "auburn",
            "washington", "kansas state", "utah", "tcu", "baylor", "virginia tech", "nebraska", "illinois"]


def get(path, params):
    q = urllib.parse.urlencode(dict(params, apiKey=KEY))
    req = urllib.request.Request(f"{BASE}{path}?{q}", headers={"User-Agent": "stix-probe"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()[:300]


def credits(h):
    h = {k.lower(): v for k, v in h.items()}
    return h.get("x-requests-last"), h.get("x-requests-remaining")


def save():
    with open("probe/cfb_probe_result.json", "w") as f:
        json.dump(OUT, f, indent=1)


if not KEY:
    OUT["error"] = "no key in environment"
    save()
    raise SystemExit(0)

# Saturday 2026-10-24, noon Eastern kickoffs = 16:00 UTC; ask for the games listed at 15:00 UTC.
status, h, body = get("/events", {"date": "2026-10-24T15:00:00Z", "dateFormat": "iso",
                                  "commenceTimeFrom": "2026-10-24T15:30:00Z", "commenceTimeTo": "2026-10-24T16:30:00Z"})
last, rem = credits(h)
OUT["steps"].append({"call": "historical events", "http": status, "credits_last": last, "credits_remaining": rem})
if status != 200:
    OUT["steps"][-1]["body"] = body
    save()
    raise SystemExit(0)
doc = json.loads(body)
events = doc.get("data") or []
OUT["events_snapshot"] = doc.get("timestamp")
OUT["events_listed"] = [{"home": e.get("home_team"), "away": e.get("away_team"), "commence": e.get("commence_time")}
                        for e in events]
if not events:
    OUT["note"] = "no events listed in the noon-ET window"
    save()
    raise SystemExit(0)


def p4(e):
    s = f"{e.get('home_team','')} {e.get('away_team','')}".lower()
    return any(x in s for x in P4_HINTS)


pick = next((e for e in events if p4(e)), events[0])
OUT["picked"] = {"home": pick.get("home_team"), "away": pick.get("away_team"), "commence": pick.get("commence_time"),
                 "matched_p4_hint": p4(pick)}
ko = datetime.fromisoformat(pick["commence_time"].replace("Z", "+00:00"))
snap_req = (ko - timedelta(hours=1)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
status, h, body = get(f"/events/{pick['id']}/odds", {"date": snap_req, "bookmakers": "draftkings,fanduel",
                                                      "markets": "player_pass_yds", "oddsFormat": "american",
                                                      "dateFormat": "iso"})
last, rem = credits(h)
step = {"call": "historical event odds (player_pass_yds)", "http": status, "credits_last": last,
        "credits_remaining": rem, "requested_snapshot": snap_req}
OUT["steps"].append(step)
if status != 200:
    step["body"] = body
    save()
    raise SystemExit(0)
doc = json.loads(body)
step["snapshot_returned"] = doc.get("timestamp")
ev = doc.get("data") or {}
books = {}
for bk in ev.get("bookmakers") or []:
    for m in bk.get("markets") or []:
        players = {}
        for o in m.get("outcomes") or []:
            players.setdefault(o.get("description"), {})[(o.get("name") or "").lower()] = (o.get("point"), o.get("price"))
        books[f"{bk.get('key')}:{m.get('key')}"] = {"players": len(players), "sample": dict(list(players.items())[:3])}
step["books_markets"] = books
save()
