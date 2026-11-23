import json, os, sys, urllib.request, urllib.parse
KEY = os.environ["ODDS_API_KEY_20K"]
API = "https://api.the-odds-api.com/v4"
def get(url, **q):
    q["apiKey"] = KEY
    r = urllib.request.urlopen(url + "?" + urllib.parse.urlencode(q), timeout=60)
    h = {k.lower(): v for k, v in r.getheaders()}
    return json.loads(r.read().decode()), h
out = {}
_, h = get(f"{API}/sports")
out["balance_before"] = h.get("x-requests-remaining")
print("balance before", out["balance_before"])
if int(out["balance_before"]) < 12000:
    sys.exit("below floor")
# Week 1 2024, 1 PM ET Sunday kickoffs = 2024-09-08T17:00Z; snapshot kickoff - 3 h
snap = "2024-09-08T14:00:00Z"
ev, h = get(f"{API}/historical/sports/americanfootball_nfl/events", date=snap)
out["events_cost"] = h.get("x-requests-last")
events = ev.get("data", [])
out["snapshot_returned"] = ev.get("timestamp")
out["n_events"] = len(events)
cand = [e for e in events if e["commence_time"] == "2024-09-08T17:00:00Z"]
print("events", len(events), "at 17:00Z", len(cand), "cost", out["events_cost"])
if not cand:
    out["error"] = "no 17:00Z event"; json.dump(out, open("probe2024/result.json", "w"), indent=1); sys.exit(1)
e = next((x for x in cand if x["home_team"] == "Buffalo Bills"), cand[0])
out["game"] = f'{e["away_team"]} @ {e["home_team"]} {e["commence_time"]}'
print(out["game"])
od, h = get(f"{API}/historical/sports/americanfootball_nfl/events/{e['id']}/odds", date=snap, regions="us",
            markets="player_reception_yds,player_rush_yds", bookmakers="draftkings,fanduel", oddsFormat="american")
out["odds_cost"] = h.get("x-requests-last")
out["balance_after"] = h.get("x-requests-remaining")
out["odds_snapshot"] = od.get("timestamp")
summ = {}
rows = []
for b in od.get("data", {}).get("bookmakers", []):
    for m in b["markets"]:
        players = {o.get("description") for o in m["outcomes"]}
        summ[f'{b["key"]}/{m["key"]}'] = {"players": len(players), "outcomes": len(m["outcomes"])}
        for o in m["outcomes"]:
            rows.append([b["key"], m["key"], o.get("description"), o["name"], o.get("point"), o.get("price")])
out["summary"] = summ
out["sample"] = [r for r in rows if r[0] == "draftkings"][:14] + [r for r in rows if r[0] == "fanduel"][:14]
print(json.dumps(out, indent=1))
json.dump(out, open("probe2024/result.json", "w"), indent=1)
json.dump(od, open("probe2024/raw.json", "w"))
