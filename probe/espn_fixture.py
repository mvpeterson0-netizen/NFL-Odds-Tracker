"""Save one raw scoreboard and one raw game summary (live or final) as test fixtures. Throwaway."""
import json, urllib.request
SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={}"
def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read())
sb = get(SB)
json.dump(sb, open("probe/fixture_scoreboard.json", "w"))
evs = sb.get("events", [])
pick = next((e for e in evs if e["status"]["type"]["state"] == "in"), None) or next((e for e in evs if e["status"]["type"]["state"] == "post"), evs[0])
json.dump(get(SUM.format(pick["id"])), open("probe/fixture_summary_live.json", "w"))
post = next((e for e in evs if e["status"]["type"]["state"] == "post"), None)
if post:
    json.dump(get(SUM.format(post["id"])), open("probe/fixture_summary_post.json", "w"))
print("saved", pick["shortName"], post and post["shortName"])
