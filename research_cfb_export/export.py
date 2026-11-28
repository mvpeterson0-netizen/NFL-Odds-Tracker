"""One-time CFB research export (CFB side). Read-only.

Reads the CFB tables from Supabase (server key, SELECT only) and downloads free public data that the signal study
needs: ESPN game summaries (box score, play-by-play, venue, pre-game spread), ESPN team schedules, ESPN athlete
career stats, and Open-Meteo observed weather. No Odds API calls, no writes anywhere.

Everything is packed into one tar.gz and encrypted with a public key whose private half never leaves the research
session, so the uploaded artifact is unreadable to anyone else (the repo is public). The log prints counts only.
Standard library only.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hewbbugkbycdkazlwspq.supabase.co").rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
UA = "nfl-odds-tracker/1.0 (+github actions)"  # Supabase refuses secret keys from browser-like agents
ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={}"
ATHLETE = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/{}/stats"
SEASON = 2026
stats = {}


def get(url, headers=None, tries=3, timeout=45):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            last = e.code
            if e.code in (400, 401, 403, 404):
                return e.code, b""
        except Exception as e:  # network trouble
            last = type(e).__name__
        time.sleep(1.5 * (i + 1))
    return last, b""


def save(path, obj_bytes):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with gzip.open(full + ".gz", "wb") as f:
        f.write(obj_bytes)


def supa(table):
    out, off = [], 0
    h = {"apikey": KEY}
    if not KEY.startswith("sb_"):
        h["Authorization"] = f"Bearer {KEY}"
    while True:
        q = urllib.parse.urlencode({"select": "*", "limit": 1000, "offset": off})
        st, body = get(f"{SUPABASE_URL}/rest/v1/{table}?{q}", h)
        if st != 200:
            raise SystemExit(f"supabase {table}: HTTP {st}")
        rows = json.loads(body)
        out += rows
        if len(rows) < 1000:
            return out
        off += 1000


def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"[^a-z ]+", " ", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    os.makedirs(OUT, exist_ok=True)
    # 1. Supabase (read only)
    tables = {}
    for t in ["cfb_games", "cfb_lines", "cfb_results", "cfb_players", "cfb_pulls", "cfb_pull_state"]:
        tables[t] = supa(t)
        save(f"supabase/{t}.json", json.dumps(tables[t]).encode())
        stats[t] = len(tables[t])

    # 2. ESPN scoreboards (FBS, regular season + postseason weeks so far)
    for w in range(0, 17):
        st, body = get(f"{ESPN}/scoreboard?groups=80&week={w}&seasontype=2&limit=400&dates={SEASON}")
        if st == 200 and body:
            save(f"espn/scoreboard/week_{w:02d}.json", body)
            stats["scoreboards"] = stats.get("scoreboards", 0) + 1

    # 3. team schedules for every team in a stored Power 4 game -> full game lists (incl. non-P4 opponents' games)
    team_ids = sorted({str(g.get(k)) for g in tables["cfb_games"] for k in ("home_id", "away_id") if g.get(k)})
    game_ids = {str(g["game_id"]) for g in tables["cfb_games"]}

    def sched(tid):
        st, body = get(f"{ESPN}/teams/{tid}/schedule?season={SEASON}")
        if st == 200 and body:
            save(f"espn/schedule/{tid}.json", body)
            try:
                return [str(e["id"]) for e in json.loads(body).get("events", [])
                        if (((e.get("competitions") or [{}])[0].get("status") or {}).get("type") or {}).get("completed")]
            except Exception:
                return []
        return []

    with ThreadPoolExecutor(6) as ex:
        for ids in ex.map(sched, team_ids):
            game_ids.update(ids)
    stats["teams"] = len(team_ids)

    # 4. game summaries (box score, plays, venue, pick center)
    def summ(gid):
        st, body = get(SUMMARY.format(gid))
        if st == 200 and body:
            save(f"espn/summary/{gid}.json", body)
            return body
        return None

    bodies = {}
    with ThreadPoolExecutor(6) as ex:
        for gid, body in zip(sorted(game_ids), ex.map(summ, sorted(game_ids))):
            if body:
                bodies[gid] = body
    stats["summaries"] = len(bodies)
    stats["summary_missing"] = len(game_ids) - len(bodies)

    # 5. athlete career stats for players who have a posted line (matched by name inside their game's box score)
    line_names = {(str(l["game_id"]), norm(l["player_name"])) for l in tables["cfb_lines"]}
    line_games = {g for g, _ in line_names}
    athletes, venues = set(), {}
    for gid, body in bodies.items():
        try:
            doc = json.loads(body)
        except Exception:
            continue
        v = ((doc.get("gameInfo") or {}).get("venue") or {})
        addr = v.get("address") or {}
        if gid in line_games and addr.get("city"):
            venues[gid] = (addr.get("city"), addr.get("state") or "", (doc.get("header") or {}).get("competitions", [{}])[0].get("date"))
        if gid not in line_games:
            continue
        for t in ((doc.get("boxscore") or {}).get("players") or []):
            for cat in t.get("statistics") or []:
                for a in cat.get("athletes") or []:
                    ath = a.get("athlete") or {}
                    if ath.get("id") and (gid, norm(ath.get("displayName"))) in line_names:
                        athletes.add(str(ath["id"]))

    def ath(aid):
        st, body = get(ATHLETE.format(aid))
        if st == 200 and body:
            save(f"espn/athlete/{aid}.json", body)
            return 1
        return 0

    with ThreadPoolExecutor(6) as ex:
        stats["athletes"] = sum(ex.map(ath, sorted(athletes)))
    stats["athletes_wanted"] = len(athletes)

    # 6. observed weather at each lined game's venue (Open-Meteo, free): geocode city once, hourly series that day
    geo = {}
    for city, state, _ in set(venues.values()):
        if (city, state) in geo:
            continue
        q = urllib.parse.urlencode({"name": city, "count": 10, "language": "en", "format": "json", "countryCode": "US"})
        st, body = get(f"https://geocoding-api.open-meteo.com/v1/search?{q}")
        geo[(city, state)] = json.loads(body) if st == 200 and body else None
        time.sleep(0.15)
    save("weather/geocode.json", json.dumps([[k[0], k[1], v] for k, v in geo.items()]).encode())
    wx = {}
    for gid, (city, state, date) in venues.items():
        g = geo.get((city, state)) or {}
        res = g.get("results") or []
        pick = next((r for r in res if state and (r.get("admin1_code") == state or state.lower() in (r.get("admin1") or "").lower())), res[0] if res else None)
        if not pick or not date:
            continue
        day = date[:10]
        q = urllib.parse.urlencode({"latitude": pick["latitude"], "longitude": pick["longitude"], "start_date": day,
                                    "end_date": day, "hourly": "temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation",
                                    "wind_speed_unit": "mph", "temperature_unit": "fahrenheit", "timezone": "UTC"})
        st, body = get(f"https://archive-api.open-meteo.com/v1/archive?{q}")
        if st != 200 or not body:
            st, body = get(f"https://api.open-meteo.com/v1/forecast?{q}")
        if st == 200 and body:
            wx[gid] = {"lat": pick["latitude"], "lon": pick["longitude"], "place": pick.get("name"), "admin1": pick.get("admin1"),
                       "data": json.loads(body)}
        time.sleep(0.12)
    save("weather/games.json", json.dumps(wx).encode())
    stats["weather_games"] = len(wx)
    stats["venues"] = len(venues)
    with open(os.path.join(OUT, "counts.json"), "w") as f:
        json.dump(stats, f)
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
