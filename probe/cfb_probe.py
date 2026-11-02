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
                teams.append({"id": t.get("id"), "name": t.get("displayName"), "abbr": t.get("abbreviation"),
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

# ---------- ESPN rosters: do they carry positions for the players in those box scores? ----------
roster_report = []
team_ids = {}
for e in sample:
    for t in events[e["id"]]["teams"]:
        team_ids[t["id"]] = t["name"]
bx_by_game = {b["id"]: b for b in box_report}
for tid, tname in list(team_ids.items())[:8]:
    code, _, body = get(f"{BASE}/teams/{tid}/roster")
    rep = {"team": tname, "team_id": tid, "http": code}
    if code == 200:
        try:
            js = json.loads(body)
            pos = {}
            groups = js.get("athletes", [])
            items = []
            for g in groups:
                items.extend(g.get("items", []) if isinstance(g, dict) and "items" in g else [g])
            for a in items:
                pos[a.get("displayName")] = (a.get("position") or {}).get("abbreviation")
            rep["n_roster"] = len(pos)
            rep["positions_present"] = sum(1 for v in pos.values() if v)
            names = []
            for b in box_report:
                for cat, lst in (b.get("categories") or {}).items():
                    for ent in lst:
                        if ent["team"] == tname:
                            for pl in ent["first"]:
                                names.append((cat, pl["name"], pos.get(pl["name"])))
            rep["box_players_positions"] = names
        except Exception as ex:  # noqa
            rep["error"] = str(ex)
    roster_report.append(rep)
save("espn_roster_check.json", roster_report)

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


# ---------- Odds API: props probe on the earliest P4 game that has data (stops after first hit; max ~3 credits) ----------
if key and summary.get("odds_events_count"):
    p4names = {t["name"] for e in events.values() for t in e["teams"]}
    cand = [e for e in json.load(open(os.path.join(OUT, "odds_events.json")))
            if e["home"] in p4names or e["away"] in p4names]
    cand.sort(key=lambda e: e["commence"])
    summary["p4_names_matched_in_odds_events"] = len(cand)
    books = "draftkings,fanduel,betmgm,williamhill_us,fanatics,betrivers,espnbet,hardrockbet,ballybet,fliff"
    mk = "player_pass_yds,player_rush_yds,player_reception_yds"
    tried = []
    for e in cand[:3]:
        code, hdr, body = get(f"https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/events/{e['id']}/odds?apiKey={key}&regions=us&markets={mk}&bookmakers={books}&oddsFormat=american")
        info = {"event": f"{e['away']} @ {e['home']}", "commence": e["commence"], "http": code,
                "credits_last": hdr.get("x-requests-last"), "remaining": hdr.get("x-requests-remaining")}
        if code == 200:
            js = json.loads(body)
            per = {}
            for bk in js.get("bookmakers", []):
                for m in bk.get("markets", []):
                    names = {o.get("description") for o in m.get("outcomes", [])}
                    per.setdefault(m["key"], {})[bk["key"]] = len(names)
            info["players_per_market_per_book"] = per
            if per:
                save("odds_props_sample.json", js)
                tried.append(info)
                break
        tried.append(info)
    summary["props_probe"] = tried

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


# ---------- Cross-check: ESPN box scores vs CFBD player stats for every P4 game of the Oct 31 week ----------
import re, time
def nn(x):
    x = (x or "").lower().replace(".", "").replace("'", "").replace("-", " ")
    x = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", x)
    return " ".join(x.split())
if ckey:
    h2 = {"Authorization": f"Bearer {ckey}", "Accept": "application/json"}
    cfbd = {}
    for cat in ("passing", "rushing", "receiving"):
        code, _, body = get(f"https://api.collegefootballdata.com/games/players?year=2026&week=9&seasonType=regular&category={cat}", h2)
        if code != 200:
            continue
        for g in json.loads(body):
            for tm in g.get("teams", []):
                for c in tm.get("categories", []):
                    for ty in c.get("types", []):
                        for a in ty.get("athletes", []):
                            cfbd.setdefault((tm["team"], c["name"], nn(a["name"])), {})[ty["name"]] = a["stat"]
    cfbd_teams = {k[0] for k in cfbd}
    def cfbd_team(espn_name):
        best = None
        for t in cfbd_teams:
            if espn_name.startswith(t) and (best is None or len(t) > len(best)):
                best = t
        return best
    wk = [e for e in events.values() if "2026-10-31T10:00" <= (e["date"] or "") <= "2026-11-01T12:00" and e["status"] == "STATUS_FINAL"]
    tot = {"games": 0, "compared": 0, "match": 0, "diff": 0, "espn_only": 0, "cfbd_only": 0, "team_unmatched": 0}
    diffs, espn_games_ok = [], 0
    for e in wk:
        code, _, body = get(f"https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={e['id']}")
        time.sleep(0.2)
        if code != 200:
            continue
        espn_games_ok += 1
        js = json.loads(body)
        seen = set()
        for team in (js.get("boxscore") or {}).get("players", []):
            tn = (team.get("team") or {}).get("displayName") or ""
            ct = cfbd_team(tn)
            if not ct:
                tot["team_unmatched"] += 1
                continue
            for st in team.get("statistics", []):
                cat = st.get("name")
                labels = st.get("labels") or []
                if "YDS" not in labels:
                    continue
                yi = labels.index("YDS")
                for a in st.get("athletes", []):
                    nm = nn((a.get("athlete") or {}).get("displayName"))
                    ev_y = (a.get("stats") or [None] * (yi + 1))[yi]
                    key = (ct, cat, nm)
                    seen.add(key)
                    cd = cfbd.get(key)
                    if cd is None:
                        tot["espn_only"] += 1
                        diffs.append({"game": e["name"], "key": key, "espn": ev_y, "cfbd": None})
                        continue
                    tot["compared"] += 1
                    if str(cd.get("YDS")) == str(ev_y):
                        tot["match"] += 1
                    else:
                        tot["diff"] += 1
                        diffs.append({"game": e["name"], "key": key, "espn": ev_y, "cfbd": cd.get("YDS")})
        for key in cfbd:
            pass
    tot["games"] = espn_games_ok
    tot["espn_games_listed"] = len(wk)
    save("crosscheck.json", {"totals": tot, "first_diffs": diffs[:40]})
    summary["crosscheck"] = tot


# ---------- ESPN scoreboard behavior checks (for the real pipeline) ----------
beh = {}
for label, q in (("range_group8", "groups=8&dates=20261031-20261108&limit=300"),
                 ("range_all_p4", "groups=80&dates=20261031-20261108&limit=300"),
                 ("nodate_group8", "groups=8&limit=300"),
                 ("week_param", "groups=8&week=9&seasontype=2&limit=300")):
    code, _, body = get(f"{BASE}/scoreboard?{q}")
    rep = {"http": code}
    if code == 200:
        js = json.loads(body)
        evs = js.get("events", [])
        rep["n_events"] = len(evs)
        rep["days"] = sorted({(e.get("date") or "")[:10] for e in evs})
        rep["top_keys"] = sorted(js.keys())
        rep["scoreboard_week"] = js.get("week")
        if evs:
            e0 = evs[0]
            rep["event_keys"] = sorted(e0.keys())
            rep["event_week"] = e0.get("week")
            comp = (e0.get("competitions") or [{}])[0]
            rep["comp_keys"] = sorted(comp.keys())
            rep["competitor0"] = {k: (v if not isinstance(v, (dict, list)) else "...") for k, v in (comp.get("competitors") or [{}])[0].items()}
            rep["team0_keys"] = sorted(((comp.get("competitors") or [{}])[0].get("team") or {}).keys())
            rep["status"] = e0.get("status")
            rep["conferenceCompetition"] = comp.get("conferenceCompetition")
            rep["neutralSite"] = comp.get("neutralSite")
    beh[label] = rep
save("espn_scoreboard_behavior.json", beh)
summary["scoreboard_behavior"] = {k: (v.get("http"), v.get("n_events"), v.get("days")) for k, v in beh.items()}

summary["finished_utc"] = dt.datetime.utcnow().isoformat() + "Z"
save("summary.json", summary)
print(json.dumps(summary, indent=1))
