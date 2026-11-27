"""Historical game weather from airport station reports (METAR/ASOS via the Iowa Environmental Mesonet), 2016-2025.

Research only; writes data/metar_history/game_weather.csv. Standard library only. Run by the "METAR backfill" workflow
(workflow_dispatch); it needs network access to the IEM and to nflverse, which the session sandbox does not have, so the code
paths that call the network were NOT exercised before this file was written - only the parsing/aggregation logic is unit
tested (tests/test_metar_backfill.py). Expect to check the first run's log.

Why: Open-Meteo's precipitation is model output. A station report is a measurement at an airport near the stadium: hourly
precipitation, present-weather codes (rain/snow/freezing), visibility, wind and gusts. Airports are not stadiums: each
game row carries the station and its distance, and stations farther than FAR_MILES from the stadium are flagged.

Games used: nflverse schedule, seasons 2016-2025, home team in STATION_BY_HOME, roof "outdoors" or "open" (retractable roofs
that were open). Window: kickoff to kickoff + WINDOW_HOURS.
Per-hour precipitation: IEM's p01i is the precipitation in the hour up to the report. Specials inside an hour repeat a running
total, so for each clock hour the LARGEST p01i is used and those hourly values are summed over the window's hours. This is an
approximation; the per-hour values are also written (precip_hrs) so other readings can be tried.
"""
from __future__ import annotations

import csv
import io
import math
import sys
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from pipeline.common import NFLVERSE, http_get  # noqa: E402
from pipeline.weather import STADIUMS  # noqa: E402

OUT = ROOT / "data" / "metar_history" / "game_weather.csv"
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
SEASONS = range(2016, 2026)
WINDOW_HOURS = 3.5
FAR_MILES = 25.0
PAUSE_S = 1.5  # between IEM requests

# nflverse home_team -> IEM station id (FAA-style 3 letters). CANDIDATES chosen as the airport nearest the stadium that I
# believe carries an automated station; the run reports each one's distance from the stadium so wrong picks show up.
# Teams that played mostly in domes or retractable roofs are not listed. OAK: Raiders 2016-2019 (open-air Coliseum).
STATION_BY_HOME = {
    "BUF": "BUF", "PIT": "PIT", "CAR": "CLT", "DEN": "DEN", "JAX": "JAX", "KC": "MKC", "NE": "OWD", "MIA": "OPF",
    "CLE": "BKL", "GB": "GRB", "SF": "SJC", "PHI": "PHL", "SEA": "BFI", "BAL": "BWI", "NYG": "TEB", "NYJ": "TEB",
    "TEN": "BNA", "WAS": "ADW", "CIN": "LUK", "TB": "TPA", "CHI": "MDW", "OAK": "OAK",
}
# nflverse uses OAK through 2019, then LV (domed, not included); LA/LAC play in a domed stadium since 2020 and are not included.
HOME_STADIUM = {  # stadium (pipeline.weather.STADIUMS name) used only to measure the station distance
    "BUF": "Highmark Stadium", "PIT": "Acrisure Stadium", "CAR": "Bank of America Stadium", "DEN": "Empower Field at Mile High",
    "JAX": "EverBank Stadium", "KC": "GEHA Field at Arrowhead Stadium", "NE": "Gillette Stadium", "MIA": "Hard Rock Stadium",
    "CLE": "Huntington Bank Field", "GB": "Lambeau Field", "SF": "Levi's Stadium", "PHI": "Lincoln Financial Field",
    "SEA": "Lumen Field", "BAL": "M&T Bank Stadium", "NYG": "MetLife Stadium", "NYJ": "MetLife Stadium",
    "TEN": "Nissan Stadium", "WAS": "Northwest Stadium", "CIN": "Paycor Stadium", "TB": "Raymond James Stadium",
    "CHI": "Soldier Field",
}  # OAK has no entry (its stadium is not in the app's table): its distance is left blank
ET = ZoneInfo("America/New_York")
FIELDS = ["game_id", "season", "week", "game_type", "home_team", "roof", "station", "station_miles", "far", "kickoff_utc",
          "n_obs", "temp_f_ko", "wind_mph_max", "gust_mph_max", "precip_in", "precip_peak_hr_in", "precip_hrs",
          "precip_obs_frac", "snow_seen", "freezing_seen", "vsby_min_mi", "wxcodes"]


def miles(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(a))


def kickoff_utc(gameday: str, gametime: str):
    """nflverse gameday (YYYY-MM-DD) and gametime (HH:MM, US Eastern) -> aware UTC datetime, or None."""
    try:
        d = datetime.strptime(f"{gameday} {gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
    except (TypeError, ValueError):
        return None
    return d.astimezone(timezone.utc)


def fnum(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(v) else v


def parse_obs(text: str):
    """IEM comma file (format=onlycomma, latlon=yes, missing=M, trace=0.0001) -> list of dicts with a UTC 'time'."""
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            t = datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        out.append({"time": t, "tmpf": fnum(r.get("tmpf")), "sknt": fnum(r.get("sknt")), "gust": fnum(r.get("gust")),
                    "p01i": fnum(r.get("p01i")), "vsby": fnum(r.get("vsby")), "wx": (r.get("wxcodes") or "").strip("M").strip(),
                    "lat": fnum(r.get("lat")), "lon": fnum(r.get("lon"))})
    return sorted(out, key=lambda o: o["time"])


def summarize(obs, ko, hours=WINDOW_HOURS):
    """Aggregate the station reports in [ko, ko+hours] into one row of values (strings), or None if there are no reports."""
    end = ko + timedelta(hours=hours)
    w = [o for o in obs if ko <= o["time"] <= end]
    if not w:
        return None
    per_hour = defaultdict(float)
    for o in w:
        if o["p01i"] is not None:
            h = o["time"].replace(minute=0, second=0, microsecond=0)
            per_hour[h] = max(per_hour[h], o["p01i"])
    hrs = [per_hour[h] for h in sorted(per_hour)]
    codes = set()
    precip_obs = 0
    for o in w:
        toks = o["wx"].split()
        codes.update(toks)
        if any(c.lstrip("+-VC").startswith(("RA", "SN", "DZ", "PL", "GR", "GS", "SG", "FZRA", "FZDZ", "TS", "SH")) for c in toks):
            precip_obs += 1
    k = min(w, key=lambda o: abs((o["time"] - ko).total_seconds()))
    f = lambda v, d=2: "" if v is None else f"{v:.{d}f}"
    mph = lambda kt: None if kt is None else kt * 1.15078
    winds = [mph(o["sknt"]) for o in w if o["sknt"] is not None]
    gusts = [mph(o["gust"]) for o in w if o["gust"] is not None]
    vis = [o["vsby"] for o in w if o["vsby"] is not None]
    return {"n_obs": str(len(w)), "temp_f_ko": f(k["tmpf"], 0) if k["tmpf"] is not None else "",
            "wind_mph_max": f(max(winds), 0) if winds else "", "gust_mph_max": f(max(gusts), 0) if gusts else "",
            "precip_in": f(sum(hrs)) if hrs else "", "precip_peak_hr_in": f(max(hrs)) if hrs else "",
            "precip_hrs": ";".join(f(x) for x in hrs), "precip_obs_frac": f(precip_obs / len(w)),
            "snow_seen": "1" if any(c.lstrip("+-").startswith(("SN", "SG", "PL", "BLSN")) for c in codes) else "0",
            "freezing_seen": "1" if any("FZ" in c for c in codes) else "0",
            "vsby_min_mi": f(min(vis), 1) if vis else "", "wxcodes": " ".join(sorted(codes))}


def fetch_station_season(station: str, season: int):
    """One IEM request: all reports for the station from Aug 1 of the season to Mar 1 after it (UTC)."""
    params = {"station": station, "data": ["tmpf", "sknt", "gust", "p01i", "vsby", "wxcodes"], "latlon": "yes",
              "year1": season, "month1": 8, "day1": 1, "year2": season + 1, "month2": 3, "day2": 1, "tz": "Etc/UTC",
              "format": "onlycomma", "missing": "M", "trace": "0.0001", "direct": "no", "report_type": [3, 4]}
    url = IEM + "?" + urllib.parse.urlencode(params, doseq=True)
    body, _, status = http_get(url, timeout=180, retries=3)
    if status != 200:
        raise RuntimeError(f"IEM HTTP {status} for {station} {season}")
    return parse_obs(body.decode("utf-8", "replace"))


def load_games():
    body, _, status = http_get(f"{NFLVERSE}/schedules/games.csv", timeout=90)
    if status != 200:
        raise RuntimeError(f"nflverse schedule HTTP {status}")
    games = []
    for r in csv.DictReader(io.StringIO(body.decode("utf-8", "replace"))):
        if int(r["season"]) not in SEASONS or r.get("location") == "Neutral":
            continue
        home = r["home_team"]
        if home not in STATION_BY_HOME or r.get("roof") not in ("outdoors", "open"):
            continue
        ko = kickoff_utc(r.get("gameday"), r.get("gametime"))
        if ko is None:
            continue
        games.append({"game_id": r["game_id"], "season": r["season"], "week": r["week"], "game_type": r["game_type"],
                      "home_team": home, "roof": r["roof"], "ko": ko})
    return games


def main() -> int:
    games = load_games()
    print(f"games to cover: {len(games)}")
    by_key = defaultdict(list)
    for g in games:
        by_key[(STATION_BY_HOME[g["home_team"]], int(g["season"]))].append(g)
    rows, failed = [], []
    for (station, season), gl in sorted(by_key.items()):
        try:
            obs = fetch_station_season(station, season)
        except Exception as e:
            failed.append((station, season, str(e)[:120]))
            print(f"FAILED {station} {season}: {str(e)[:120]}")
            time.sleep(PAUSE_S)
            continue
        loc = next(((o["lat"], o["lon"]) for o in obs if o["lat"] is not None and o["lon"] is not None), None)
        print(f"{station} {season}: {len(obs)} reports for {len(gl)} games")
        for g in gl:
            s = summarize(obs, g["ko"])
            st = STADIUMS.get(HOME_STADIUM.get(g["home_team"], ""))
            dist = miles(st[0], st[1], loc[0], loc[1]) if (st and loc) else None
            row = {"game_id": g["game_id"], "season": g["season"], "week": g["week"], "game_type": g["game_type"],
                   "home_team": g["home_team"], "roof": g["roof"], "station": station,
                   "station_miles": "" if dist is None else f"{dist:.1f}", "far": "" if dist is None else ("1" if dist > FAR_MILES else "0"),
                   "kickoff_utc": g["ko"].strftime("%Y-%m-%dT%H:%M:%SZ")}
            row.update(s or {})
            rows.append(row)
        time.sleep(PAUSE_S)
    rows.sort(key=lambda r: r["game_id"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    have = sum(1 for r in rows if r.get("n_obs"))
    print(f"wrote {len(rows)} games ({have} with station reports) to {OUT}; {len(failed)} station-seasons failed")
    if failed:
        print("failures:", failed)
    far = sorted({(r["station"], r["station_miles"]) for r in rows if r["far"] == "1"})
    if far:
        print(f"stations farther than {FAR_MILES:g} miles from the stadium: {far}")
    return 0 if have else 1


if __name__ == "__main__":
    raise SystemExit(main())
