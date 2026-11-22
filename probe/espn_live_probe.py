"""Throwaway probe: does ESPN return live in-game stats, how often do they change, and are CORS headers open?
Results go to probe/results.json on this branch. No secrets. Delete the branch afterwards."""
import json, time, urllib.request
from datetime import datetime, timezone

SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={}"
ORIGIN = "https://www.sharpstix.com"
out = {"started": datetime.now(timezone.utc).isoformat(), "events": [], "samples": [], "cors": {}, "notes": []}

def get(url, origin=False):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **({"Origin": ORIGIN} if origin else {})})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read()
        hd = {k.lower(): v for k, v in r.headers.items()}
    return json.loads(body), hd, round(time.time() - t0, 2), len(body)

def keep(hd):
    return {k: hd.get(k) for k in ("access-control-allow-origin", "access-control-allow-credentials", "cache-control", "age", "date", "last-modified", "vary", "content-type")}

try:
    sb, hd, dt, n = get(SB, origin=True)
    out["cors"]["scoreboard"] = keep(hd)
    out["scoreboard_bytes"] = n
    for ev in sb.get("events", []):
        st = ev.get("status", {})
        comp = (ev.get("competitions") or [{}])[0]
        out["events"].append({
            "id": ev.get("id"), "name": ev.get("shortName"), "state": st.get("type", {}).get("state"),
            "clock": st.get("displayClock"), "period": st.get("period"),
            "scores": {c.get("homeAway"): c.get("score") for c in comp.get("competitors", [])},
        })
except Exception as ex:
    out["notes"].append(f"scoreboard failed: {type(ex).__name__}: {ex}")
    sb = {}

live = [e for e in out["events"] if e["state"] == "in"]
out["live_count"] = len(live)

def digest(doc):
    """receiving/rushing/passing yards per player id from boxscore.players, plus play count."""
    ys = {}
    for t in (doc.get("boxscore") or {}).get("players") or []:
        for cat in t.get("statistics") or []:
            keys = cat.get("keys") or []
            for a in cat.get("athletes") or []:
                vals = dict(zip(keys, a.get("stats") or []))
                aid = (a.get("athlete") or {}).get("id")
                for k in ("receivingYards", "rushingYards", "passingYards", "receivingTargets"):
                    if k in vals:
                        ys.setdefault(aid, {})[k] = vals[k]
    plays = 0
    drives = doc.get("drives") or {}
    for d in (drives.get("previous") or []) + ([drives["current"]] if drives.get("current") else []):
        plays += len(d.get("plays") or [])
    return ys, plays

if live:
    # first live game: 16 samples every 30 s (8 min); the other live games: 1 sample each
    first = live[0]
    for e in live[1:4]:
        try:
            doc, hd, dt, n = get(SUM.format(e["id"]))
            ys, plays = digest(doc)
            out["samples"].append({"game": e["name"], "once": True, "players_with_stats": len(ys), "plays": plays, "bytes": n, "has_boxscore_players": bool(ys)})
        except Exception as ex:
            out["notes"].append(f"summary {e['name']} failed: {ex}")
    prev = None
    for i in range(16):
        try:
            doc, hd, dt, n = get(SUM.format(first["id"]), origin=(i == 0))
            if i == 0:
                out["cors"]["summary"] = keep(hd)
            ys, plays = digest(doc)
            st = ((doc.get("header") or {}).get("competitions") or [{}])[0].get("status", {})
            changed = [k for k in ys if prev is not None and ys[k] != prev.get(k)]
            out["samples"].append({
                "game": first["name"], "i": i, "utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "resp_date": hd.get("date"), "age": hd.get("age"), "seconds": dt, "bytes": n,
                "clock": st.get("displayClock"), "period": st.get("period"), "state": (st.get("type") or {}).get("state"),
                "players_with_stats": len(ys), "plays": plays, "changed_ids": changed[:6],
            })
            if i == 0:
                out["example_player_stats"] = dict(list(ys.items())[:4])
            prev = ys
        except Exception as ex:
            out["samples"].append({"i": i, "error": f"{type(ex).__name__}: {ex}"})
        if i < 15:
            time.sleep(30)
else:
    out["notes"].append("no live games found")

out["finished"] = datetime.now(timezone.utc).isoformat()
json.dump(out, open("probe/results.json", "w"), indent=1)
print(json.dumps(out, indent=1)[:3000])
