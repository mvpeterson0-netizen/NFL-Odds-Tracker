"""Throwaway probe (never merged): can ESPN / CFBD / The Odds API supply college-football
Power 4 games and player passing/rushing/receiving results?  Standard library only.
Writes small JSON files to probe/out/.  Costs 0 Odds API credits (events list only)."""
import json, os, sys, urllib.request, urllib.error, urllib.parse, datetime as dt

OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (probe; stix research)"}
summary = {"started_utc": dt.datetime.utcnow().isoformat() + "Z", "notes": []}


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read()
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:  # noqa
        return 0, {}, str(e).encode()


def save(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, indent=1)


# ---------- ESPN: scoreboard for each P4 conference group + Notre Dame, Oct 24 - Nov 1 ----------
BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
GROUPS = {"ACC": 1, "Big 12": 4, "Big Ten": 5, "SEC": 8, "Independents": 18}
days = [(dt.date(2026, 10, 24) + dt.timedelta(days=i)).strftime("%Y%m%d") for i in range(9)]
events = {}
status_codes = []
for gname, gid in GROUPS.items():
    for d in days:
        code, _, body = get(f"{BASE}/scoreboard?dates={d}&groups={gid}&limit=300")
        status_codes.append((gname, d, code))
        if code != 200:
            continue
        try:
            js = json.loads(body)
        except Exception:
            continue
        for ev in js.get("events", []):
            comp = (ev.get("competitions") or [{}])[0]
            teams = []
            for c in comp.get("competitors", []):
                t = c.get("team", {})
                teams.append({"name": t.get("displayName"), "abbr": t.get("abbreviation"),
                              "home": c.get("homeAway"), "score": c.get("score")})
            e = events.setdefault(ev["id"], {"id": ev["id"], "date": ev.get("date"),
                                             "name": ev.get("name"),
                                             "status": (ev.get("status", {}).get("type", {}) or {}).get("name"),
                                             "teams": teams, "groups_seen": []})
            if gname not in e["groups_seen"]:
                e["groups_seen"].append(gname)
summary["espn_scoreboard_http"] = sorted({c for _, _, c in status_codes})
summary["espn_events_total"] = len(events)
summary["espn_events_final"] = sum(1 for e in events.values() if e["status"] == "STATUS_FINAL")
save("espn_events.json", list(events.values()))

# ---------- ESPN: game summaries for up to 4 final games ----------
finals = [e for e in events.values() if e["status"] == "STATUS_FINAL"]
finals.sort(key=lambda e: e["date"] or "")
sample = finals[:2] + finals[-2:] if len(finals) >= 4 else finals
box_report = []
for e in sample:
    code, _, body = get(f"https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={e['id']}")
    rep = {"id": e["id"], "name": e["name"], "http": code}
    if code == 200:
        try:
            js = json.loads(body)
            players = (js.get("boxscore") or {}).get("players") or []
            cats = {}
            for team in players:
                tname = (team.get("team") or {}).get("displayName")
                for st in team.get("statistics", []):
                    athletes = st.get("athletes", [])
                    cats.setdefault(st.get("name"), []).append({
                        "team": tname, "labels": st.get("labels"), "n_athletes": len(athletes),
                        "first": [{"name": (a.get("athlete") or {}).get("displayName"),
                                   "pos": ((a.get("athlete") or {}).get("position") or {}).get("abbreviation"),
                                   "stats": a.get("stats")} for a in athletes[:3]]})
            rep["categories"] = cats
            rep["has_passing"] = "passing" in cats
            rep["has_rushing"] = "rushing" in cats
            rep["has_receiving"] = "receiving" in cats
        except Exception as ex:  # noqa
            rep["error"] = str(ex)
    box_report.append(rep)
save("espn_box_sample.json", box_report)

# ---------- Odds API: free events list (0 credits expected) ----------
key = os.environ.get("ODDS_API_KEY_20K", "").strip()
if key:
    code, hdr, body = get(f"https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/events?apiKey={key}&dateFormat=iso")
    summary["odds_events_http"] = code
    summary["odds_requests_remaining"] = hdr.get("x-requests-remaining")
    summary["odds_requests_last"] = hdr.get("x-requests-last")
    if code == 200:
        evs = json.loads(body)
        summary["odds_events_count"] = len(evs)
        save("odds_events.json", [{"id": e["id"], "commence": e["commence_time"],
                                   "home": e["home_team"], "away": e["away_team"]} for e in evs])
else:
    summary["notes"].append("ODDS_API_KEY_20K not set; skipped Odds API events list")

# ---------- CFBD (only if key present) ----------
ckey = os.environ.get("CFBD_API_KEY", "").strip()
if ckey:
    h = {"Authorization": f"Bearer {ckey}", "Accept": "application/json"}
    cf = {}
    for wk in (9, 10):
        code, _, body = get(f"https://api.collegefootballdata.com/games?year=2026&week={wk}&seasonType=regular&classification=fbs", h)
        cf[f"games_w{wk}"] = {"http": code, "n": len(json.loads(body)) if code == 200 else None}
        if code == 200:
            g = json.loads(body)
            save(f"cfbd_games_w{wk}.json", [{k: x.get(k) for k in ("id", "startDate", "homeTeam", "awayTeam",
                                                                    "homeConference", "awayConference", "completed",
                                                                    "homePoints", "awayPoints")} for x in g])
        for cat in ("passing", "rushing", "receiving"):
            code, _, body = get(f"https://api.collegefootballdata.com/games/players?year=2026&week={wk}&seasonType=regular&category={cat}", h)
            rep = {"http": code}
            if code == 200:
                js = json.loads(body)
                rep["n_games"] = len(js)
                save(f"cfbd_players_w{wk}_{cat}_sample.json", js[:2])
            else:
                rep["body"] = body[:200].decode("utf8", "replace")
            cf[f"players_w{wk}_{cat}"] = rep
    code, _, body = get("https://api.collegefootballdata.com/info", h)
    cf["info"] = json.loads(body) if code == 200 else {"http": code}
    summary["cfbd"] = cf
else:
    summary["notes"].append("CFBD_API_KEY not set; skipped CFBD")

summary["finished_utc"] = dt.datetime.utcnow().isoformat() + "Z"
save("summary.json", summary)
print(json.dumps(summary, indent=1))
