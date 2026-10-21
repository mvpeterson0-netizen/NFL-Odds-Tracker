"""Game weather from Open-Meteo (free, no API key): https://open-meteo.com

For every outdoor or retractable-roof game:
- Forecast: refreshed every few hours from 16 days out until kickoff, then frozen.
  This is the weather picture the market had when lines were set.
- Observed: once the game is old enough for Open-Meteo's historical archive
  (about 5 days delay), the observed values are fetched once and kept.

Values are taken at the stadium: temperature and wind at the kickoff hour, and
precipitation summed over the kickoff hour plus the next 3 hours.
Fixed-dome stadiums are labeled "dome" and not fetched.

A weather failure never fails the run: errors are logged and retried next run.
data/weather.csv is derived data (re-creatable), not part of the prop captures.
"""
from __future__ import annotations

import json
from datetime import timedelta

from .common import DATA, http_get, iso, parse_iso, read_csv, utcnow, write_csv

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
WEATHER_PATH = DATA / "weather.csv"
FIELDS = ["game_id", "stadium", "roof",
          "fc_fetched_utc", "fc_temp_f", "fc_wind_mph", "fc_gust_mph", "fc_precip_in", "fc_precip_prob",
          "obs_fetched_utc", "obs_temp_f", "obs_wind_mph", "obs_gust_mph", "obs_precip_in",
          "note"]
FORECAST_HORIZON = timedelta(days=15)  # Open-Meteo allows end_date up to ~16 days out
FORECAST_REFRESH = timedelta(hours=3)
ARCHIVE_DELAY = timedelta(days=6)
ARCHIVE_RETRY = timedelta(hours=20)
GAME_HOURS = 4  # kickoff hour + next 3 hours

# Stadium name as it appears in the nflverse schedule -> (lat, lon, roof)
# roof: "open" (outdoors), "dome" (fixed roof), "retractable" (open/closed not known in advance)
# Coordinates are approximate stadium locations (good to ~1 km, plenty for weather).
STADIUMS = {
    "AT&T Stadium": (32.7473, -97.0945, "retractable"),
    "Acrisure Stadium": (40.4468, -80.0158, "open"),
    "Allegiant Stadium": (36.0909, -115.1833, "dome"),
    "Bank of America Stadium": (35.2258, -80.8528, "open"),
    "Bernabeu": (40.4531, -3.6883, "retractable"),
    "Caesars Superdome": (29.9511, -90.0812, "dome"),
    "Empower Field at Mile High": (39.7439, -105.0201, "open"),
    "Estadio Banorte": (19.3029, -99.1505, "open"),
    "EverBank Stadium": (30.3239, -81.6373, "open"),
    "FC Bayern Munich Stadium": (48.2188, 11.6247, "open"),
    "Ford Field": (42.3400, -83.0456, "dome"),
    "GEHA Field at Arrowhead Stadium": (39.0489, -94.4839, "open"),
    "Gillette Stadium": (42.0909, -71.2643, "open"),
    "Hard Rock Stadium": (25.9580, -80.2389, "open"),
    "Highmark Stadium": (42.7745, -78.7865, "open"),
    "Huntington Bank Field": (41.5061, -81.6995, "open"),
    "Lambeau Field": (44.5013, -88.0622, "open"),
    "Levi's Stadium": (37.4030, -121.9700, "open"),
    "Lincoln Financial Field": (39.9008, -75.1675, "open"),
    "Lucas Oil Stadium": (39.7601, -86.1639, "retractable"),
    "Lumen Field": (47.5952, -122.3316, "open"),
    "M&T Bank Stadium": (39.2780, -76.6227, "open"),
    "Maracana Stadium": (-22.9122, -43.2302, "open"),
    "Melbourne Cricket Ground": (-37.8200, 144.9834, "open"),
    "Mercedes-Benz Stadium": (33.7554, -84.4008, "retractable"),
    "MetLife Stadium": (40.8135, -74.0745, "open"),
    "Nissan Stadium": (36.1665, -86.7713, "open"),
    "Northwest Stadium": (38.9078, -76.8645, "open"),
    "Paycor Stadium": (39.0955, -84.5161, "open"),
    "Raymond James Stadium": (27.9759, -82.5033, "open"),
    "Reliant Stadium": (29.6847, -95.4107, "retractable"),  # NRG Stadium, Houston
    "SoFi Stadium": (33.9535, -118.3392, "dome"),  # fixed canopy roof
    "Soldier Field": (41.8623, -87.6167, "open"),
    "Stade de France": (48.9245, 2.3602, "open"),
    "State Farm Stadium": (33.5276, -112.2626, "retractable"),
    "Tottenham Hotspur Stadium": (51.6043, -0.0664, "open"),
    "U.S. Bank Stadium": (44.9737, -93.2581, "dome"),
    "Wembley Stadium": (51.5560, -0.2796, "open"),
}


def _fetch(url, lat, lon, start, end, forecast):
    hourly = "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m"
    if forecast:
        hourly += ",precipitation_probability"
    params = {"latitude": lat, "longitude": lon, "hourly": hourly, "timezone": "GMT",
              "temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "inch",
              "start_date": start.strftime("%Y-%m-%d"), "end_date": end.strftime("%Y-%m-%d")}
    body, _, status = http_get(url, params, timeout=30, retries=2)
    if status != 200:
        raise RuntimeError(f"Open-Meteo HTTP {status}: {body[:150]!r}")
    h = json.loads(body).get("hourly") or {}
    times = h.get("time") or []
    return {t: {k: (h.get(k) or [None] * len(times))[i] for k in h if k != "time"} for i, t in enumerate(times)}


def _window(series, ko):
    """Values at kickoff hour and summed precipitation over the game window, or None if incomplete."""
    start = ko.replace(minute=0, second=0, microsecond=0)
    hours = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(GAME_HOURS)]
    rows = [series.get(t) for t in hours]
    if any(r is None for r in rows):
        return None
    k = rows[0]
    if k.get("temperature_2m") is None or k.get("wind_speed_10m") is None:
        return None
    precip = [r.get("precipitation") for r in rows]
    probs = [r.get("precipitation_probability") for r in rows if r.get("precipitation_probability") is not None]
    f = lambda v, d=0: "" if v is None else str(round(v, d)) if d else str(int(round(v)))
    return {"temp_f": f(k["temperature_2m"]), "wind_mph": f(k["wind_speed_10m"]),
            "gust_mph": f(k.get("wind_gusts_10m")),
            "precip_in": "" if any(p is None for p in precip) else f(sum(precip), 2),
            "precip_prob": f(max(probs)) if probs else ""}


def refresh(games, log) -> bool:
    """Update data/weather.csv. Returns True if anything changed. Never raises."""
    try:
        return _refresh(games, log)
    except Exception as e:  # weather must never break the run
        log.append(f"weather: skipped ({type(e).__name__}: {str(e)[:120]})")
        return False


def _refresh(games, log) -> bool:
    now = utcnow()
    old = {r["game_id"]: r for r in read_csv(WEATHER_PATH)}
    rows = {gid: dict(r) for gid, r in old.items()}
    fc_due, obs_due = {}, {}
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko is None:
            continue
        gid, stadium = g["game_id"], g.get("stadium", "")
        r = rows.setdefault(gid, {"game_id": gid})
        r["stadium"] = stadium
        info = STADIUMS.get(stadium)
        if info is None:
            r["roof"], r["note"] = "", "stadium not in weather table"
            continue
        lat, lon, roof = info
        r["roof"], r["note"] = roof, ""
        if roof == "dome":
            continue
        if now < ko <= now + FORECAST_HORIZON:
            last = parse_iso(r.get("fc_fetched_utc", ""))
            if last is None or now - last >= FORECAST_REFRESH:
                fc_due.setdefault(stadium, []).append((g, ko))
        elif ko + timedelta(hours=GAME_HOURS) + ARCHIVE_DELAY <= now and not r.get("obs_temp_f"):
            last = parse_iso(r.get("obs_fetched_utc", ""))
            if last is None or now - last >= ARCHIVE_RETRY:
                obs_due.setdefault(stadium, []).append((g, ko))

    calls = errors = 0
    dead = False
    for kind, due, url in (("fc", fc_due, FORECAST_URL), ("obs", obs_due, ARCHIVE_URL)):
        for stadium, items in due.items():
            if dead:
                break
            lat, lon, _ = STADIUMS[stadium]
            start = min(ko for _, ko in items)
            end = max(ko for _, ko in items) + timedelta(hours=GAME_HOURS)
            if kind == "fc":
                end = min(end, now + FORECAST_HORIZON)
            try:
                series = _fetch(url, lat, lon, start, end, forecast=(kind == "fc"))
                calls += 1
            except Exception as e:
                errors += 1
                log.append(f"weather: {kind} {stadium} failed ({str(e)[:100]})")
                if errors >= 2 and calls == 0:
                    log.append("weather: Open-Meteo unreachable; will retry next run")
                    dead = True
                continue
            for g, ko in items:
                r = rows[g["game_id"]]
                r[f"{kind}_fetched_utc"] = iso(now)
                w = _window(series, ko)
                if w is None:
                    continue  # not available yet; retried later
                for k, v in w.items():
                    if kind == "obs" and k == "precip_prob":
                        continue
                    r[f"{kind}_{k}"] = v

    out = [rows[k] for k in sorted(rows)]
    changed = [{f: r.get(f, "") for f in FIELDS} for r in out] != \
              [{f: old.get(r["game_id"], {}).get(f, "") for f in FIELDS} for r in out]
    if changed or not WEATHER_PATH.exists():
        write_csv(WEATHER_PATH, out, FIELDS)
    if calls or errors:
        log.append(f"weather: {calls} Open-Meteo calls" + (f", {errors} failed" if errors else ""))
    return changed


def load():
    return {r["game_id"]: r for r in read_csv(WEATHER_PATH)}
