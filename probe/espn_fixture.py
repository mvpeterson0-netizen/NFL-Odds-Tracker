"""Throwaway diagnostic: why no live stats for the Sunday night game (MIN @ SF)."""
import json, urllib.request
SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event="
def get(u):
    r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0", "Origin": "https://www.sharpstix.com"}), timeout=30)
    return json.loads(r.read()), r.headers.get("access-control-allow-origin")
out = {"events": []}
sb, cors = get(SB)
out["cors"] = cors; out["season"] = sb.get("season"); out["week"] = sb.get("week"); out["day"] = sb.get("day")
for ev in sb.get("events", []):
    comp = (ev.get("competitions") or [{}])[0]
    out["events"].append({"id": ev["id"], "date": ev.get("date"), "short": ev.get("shortName"),
        "state": ev.get("status", {}).get("type", {}).get("state"), "clock": ev.get("status", {}).get("displayClock"), "period": ev.get("status", {}).get("period"),
        "teams": [(c.get("homeAway"), (c.get("team") or {}).get("abbreviation")) for c in comp.get("competitors", [])]})
tgt = [e for e in out["events"] if "MIN" in e["short"] or "SF" in e["short"]]
out["target"] = tgt
for e in tgt[:1]:
    doc, _ = get(SUM + e["id"])
    bp = (doc.get("boxscore") or {}).get("players") or []
    out["summary"] = {"keys": list(doc.keys()), "status": (doc.get("header", {}).get("competitions") or [{}])[0].get("status"),
        "box_teams": len(bp), "box_athletes": sum(len(c.get("athletes") or []) for t in bp for c in t.get("statistics") or []),
        "sample": [(t.get("team", {}).get("abbreviation"), [(c.get("name"), len(c.get("athletes") or [])) for c in t.get("statistics") or []]) for t in bp]}
json.dump(out, open("probe/fixture_diag.json", "w"), indent=1)
