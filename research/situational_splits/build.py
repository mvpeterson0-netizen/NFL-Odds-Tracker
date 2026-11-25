"""Build unified 2024-2026 rush_yds / rec_yds prop dataset with game-context conditions.

Usage: python3 build.py <repo_root> <out_csv>
"""
import csv, json, sys
from datetime import date
from pathlib import Path

ROOT = Path(sys.argv[1]); OUT = Path(sys.argv[2])
MKTS = ("rush_yds", "rec_yds")

# Home-stadium surface by home team and season. nflverse 'surface' is stale for several stadiums
# (e.g. CAR and TEN listed as grass), so this map is used instead.
TURF_2425 = {"ATL", "CAR", "CIN", "DAL", "DET", "HOU", "IND", "LA", "LAR", "LAC", "MIN", "NE", "NO",
             "NYG", "NYJ", "SEA", "TEN", "BUF"}
TURF_26 = TURF_2425 - {"BUF"}  # Bills' new stadium (2026) is natural grass
PACIFIC = {"SEA", "SF", "LA", "LAR", "LAC", "LV"}


def fl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def surface(season, home, location):
    if location == "Neutral":
        return "grass"  # international / neutral venues are grass
    return "turf" if home in (TURF_26 if season == 2026 else TURF_2425) else "grass"


def kick_window(weekday, gametime):
    h, m = map(int, gametime.split(":"))
    t = h + m / 60
    if t >= 19:
        return "prime"
    if t < 11:
        return "intl_am"
    if weekday == "Sunday":
        return "early" if t < 15 else "late"
    return "day_other"  # Thanksgiving / Saturday / Christmas daytime


games = {}
for season in (2024, 2025):
    for g in json.load(open(ROOT / f"data/history_{season}/schedule.json")):
        if g["game_type"] != "REG":
            continue
        games[g["game_id"]] = dict(season=season, home=g["home_team"], away=g["away_team"], loc=g["location"],
                                   weekday=g["weekday"], gametime=g["gametime"], spread=fl(g["spread_line"]),
                                   total=fl(g["total_line"]), roof=g["roof"], temp=fl(g["temp"]), wind=fl(g["wind"]),
                                   div=g["div_game"] == "1", home_rest=fl(g["home_rest"]), away_rest=fl(g["away_rest"]))

# 2026 schedule: compute rest from previous game date per team
sched26 = [r for r in csv.DictReader(open(ROOT / "data/schedule.csv")) if r["game_type"] == "REG"]
wx26 = {r["game_id"]: r for r in csv.DictReader(open(ROOT / "data/weather.csv"))}
DIVS = {"AFC E": "BUF MIA NE NYJ", "AFC N": "BAL CIN CLE PIT", "AFC S": "HOU IND JAX TEN", "AFC W": "DEN KC LV LAC",
        "NFC E": "DAL NYG PHI WAS", "NFC N": "CHI DET GB MIN", "NFC S": "ATL CAR NO TB", "NFC W": "ARI LA SF SEA"}
div_of = {t: d for d, ts in DIVS.items() for t in ts.split()}
last = {}
for r in sorted(sched26, key=lambda r: r["gameday"]):
    d = date.fromisoformat(r["gameday"])
    rest = {}
    for t in (r["home_team"], r["away_team"]):
        rest[t] = (d - last[t]).days if t in last else None
        last[t] = d
    w = wx26.get(r["game_id"], {})
    roof = {"open": "outdoors", "dome": "dome", "retractable": "closed"}.get(w.get("roof"), w.get("roof"))
    temp = fl(w.get("obs_temp_f")) or fl(w.get("pre_temp_f"))
    wind = fl(w.get("obs_wind_mph")) or fl(w.get("pre_wind_mph"))
    games[r["game_id"]] = dict(season=2026, home=r["home_team"], away=r["away_team"], loc=r["location"],
                               weekday=date.fromisoformat(r["gameday"]).strftime("%A"), gametime=r["gametime"],
                               spread=fl(r["spread_line"]), total=None, roof=roof, temp=temp, wind=wind,
                               div=div_of.get(r["home_team"]) == div_of.get(r["away_team"]),
                               home_rest=rest[r["home_team"]], away_rest=rest[r["away_team"]])

props = []
for season in (2024, 2025):
    for r in csv.DictReader(open(ROOT / f"data/history_graded/props_{season}.csv")):
        if r["market"] not in MKTS or r["result"] not in ("over", "under", "push") or r["gid"] not in games:
            continue
        props.append(dict(season=season, wk=int(r["week"]), gid=r["gid"], pid=r["pid"], name=r["name"], pos=r["pos"],
                          team=r["team"], ha=r["ha"], mkt=r["market"], line=fl(r["line"]), act=fl(r["actual"]),
                          res=r["result"], up=fl(r["under_price"]), op=fl(r["over_price"])))
D = json.load(open(ROOT / "site/data/data.json"))
pinfo = {p["id"]: p for p in D["players"]}
for pid, rows in D["rows"].items():
    p = pinfo.get(pid)
    if not p:
        continue
    for r in rows:
        if not r.get("final") or r["gid"] not in games or r.get("played") is not True:
            continue
        for mk in MKTS:
            m = (r.get("m") or {}).get(mk)
            if not m or m.get("lstat") != "ok" or m.get("line") is None or m.get("act") is None:
                continue
            a, ln = m["act"], m["line"]
            props.append(dict(season=2026, wk=r["wk"], gid=r["gid"], pid=pid, name=p["name"], pos=p["pos"],
                              team=r["team"], ha=r["ha"], mkt=mk, line=ln, act=a,
                              res="over" if a > ln else "under" if a < ln else "push", up=m.get("up"), op=m.get("op")))

# dedupe
seen, uniq = set(), []
for p in props:
    k = (p["pid"], p["gid"], p["mkt"])
    if k not in seen:
        seen.add(k); uniq.append(p)

out = []
for p in uniq:
    g = games[p["gid"]]
    home = p["ha"] == "home"
    team_spread = None if g["spread"] is None else (-g["spread"] if home else g["spread"])  # +ve = underdog
    rest = g["home_rest"] if home else g["away_rest"]
    kw = kick_window(g["weekday"], g["gametime"])
    outdoor = g["roof"] == "outdoors"
    c = {
        "home": home,
        "turf": surface(g["season"], g["home"], g["loc"]) == "turf",
        "dome": g["roof"] in ("dome", "closed"),
        "early": kw == "early",
        "late": kw == "late",
        "prime": kw == "prime",
        "thursday": g["weekday"] == "Thursday" and kw == "prime",
        "monday": g["weekday"] == "Monday",
        "division": g["div"],
        "favorite": None if team_spread is None else team_spread < 0,
        "big_dog": None if team_spread is None else team_spread >= 6.5,
        "short_rest": None if rest is None else rest <= 5,
        "off_bye": None if rest is None else rest >= 13,
        "high_total": None if g["total"] is None else g["total"] >= 47,
        "cold": None if not outdoor or g["temp"] is None else g["temp"] <= 40,
        "windy": None if not outdoor or g["wind"] is None else g["wind"] >= 15,
        "west_early_away": (not home) and p["team"] in PACIFIC and kw == "early",
    }
    row = dict(p, kick=kw, team_spread=team_spread, rest=rest)
    for k, v in c.items():
        row["c_" + k] = "" if v is None else int(bool(v))
    out.append(row)

with open(OUT, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)
print(len(out), "rows")
