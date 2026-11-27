"""Game weather from Open-Meteo (free, no API key): https://open-meteo.com

For every outdoor or retractable-roof game:
- Forecast: refreshed every few hours from 16 days out until kickoff, then frozen.
  This is the weather picture the market had when lines were set.
- Pre-kickoff reading (Michael 2026-11-24): one more forecast read about 20 minutes before kickoff, stored once in the
  pre_* columns and never changed afterwards. The WX1 indicator and its alert use only this reading.
- Observed: once the game is old enough for Open-Meteo's historical archive
  (about 5 days delay), the observed values are fetched once and kept.

Values are taken at the stadium: temperature and wind at the kickoff hour, and
precipitation summed over the kickoff hour plus the next 3 hours.

Hourly detail (added 2026-11-27, Michael): each reading also keeps the individual hourly values around the game, so rain
rate and rain-vs-snow can be studied later: {fc,pre,obs}_precip_hrs (inches, 6 hourly values from the hour before the
kickoff hour to 4 hours after it, ";"-separated, blank where unavailable), {fc,pre,obs}_snow_in (snowfall water-equivalent
inches summed over the same 4-hour window as precip_in) and {fc,pre,obs}_wcode_hrs (WMO weather codes for the same 6
hours). The hour labels are Open-Meteo's own; whether a label covers the hour ending or starting at that time is not
verified here, which is why one hour either side of the window is kept. The existing columns are unchanged.
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
          "note",
          "pre_fetched_utc", "pre_temp_f", "pre_wind_mph", "pre_gust_mph", "pre_precip_in",
          "fc_precip_hrs", "fc_snow_in", "fc_wcode_hrs", "obs_precip_hrs", "obs_snow_in", "obs_wcode_hrs",
          "pre_precip_hrs", "pre_snow_in", "pre_wcode_hrs"]
FORECAST_HORIZON = timedelta(days=15)  # Open-Meteo allows end_date up to ~16 days out
FORECAST_REFRESH = timedelta(hours=3)
# Pre-kickoff reading window: the first run 22 to 3 minutes before kickoff takes it (the workflow runs about every 5 minutes, so
# that is usually 17 to 22 minutes out; the reading's own time is stored in pre_fetched_utc). If every run in the window fails
# or is skipped, the game simply has no pre-kickoff reading and WX1 does not fire for it.
PRE_FROM, PRE_TO = timedelta(minutes=22), timedelta(minutes=3)
ARCHIVE_DELAY = timedelta(days=6)
ARCHIVE_RETRY = timedelta(hours=20)
FILL_MAX_STADIUMS = 10  # one-time hourly-detail fill for already-observed games: at most this many stadiums (calls) per run
GAME_HOURS = 4  # kickoff hour + next 3 hours
DETAIL_BEFORE, DETAIL_AFTER = 1, 4  # hourly detail kept from 1 hour before the kickoff hour to 4 hours after it

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


BASE_HOURLY = "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m"
EXTRA_HOURLY = ",snowfall,weather_code"


def _fetch(url, lat, lon, start, end, forecast):
    """Hourly series keyed by time. Asks for snowfall and weather codes too; if Open-Meteo rejects those (HTTP 400), the
    original variables are fetched alone so temperature, wind and precipitation keep working."""
    def get(hourly):
        if forecast:
            hourly += ",precipitation_probability"
        params = {"latitude": lat, "longitude": lon, "hourly": hourly, "timezone": "GMT",
                  "temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "inch",
                  "start_date": start.strftime("%Y-%m-%d"), "end_date": end.strftime("%Y-%m-%d")}
        body, _, status = http_get(url, params, timeout=30, retries=2)
        if status != 200:
            raise RuntimeError(f"Open-Meteo HTTP {status}: {body[:150]!r}")
        return body
    try:
        body = get(BASE_HOURLY + EXTRA_HOURLY)
    except RuntimeError as e:
        if "HTTP 400" not in str(e):
            raise
        body = get(BASE_HOURLY)
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
    detail = [series.get((start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M")) or {}
              for i in range(-DETAIL_BEFORE, DETAIL_AFTER + 1)]
    snow = [r.get("snowfall") for r in rows]
    return {"temp_f": f(k["temperature_2m"]), "wind_mph": f(k["wind_speed_10m"]),
            "gust_mph": f(k.get("wind_gusts_10m")),
            "precip_in": "" if any(p is None for p in precip) else f(sum(precip), 2),
            "precip_prob": f(max(probs)) if probs else "",
            "precip_hrs": ";".join(f(r.get("precipitation"), 2) for r in detail),
            "snow_in": "" if any(x is None for x in snow) else f(sum(snow), 2),
            "wcode_hrs": ";".join(f(r.get("weather_code")) for r in detail)}


def pre_due(ko, now, row) -> bool:
    """True when this game still needs its pre-kickoff reading and now is inside the 22-to-3-minutes-before window."""
    return not row.get("pre_wind_mph") and ko - PRE_FROM <= now < ko - PRE_TO


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
    fc_due, obs_due, pre_due_by, fill_due = {}, {}, {}, {}
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
        if pre_due(ko, now, r):
            pre_due_by.setdefault(stadium, []).append((g, ko))
        if now < ko <= now + FORECAST_HORIZON:
            last = parse_iso(r.get("fc_fetched_utc", ""))
            if last is None or now - last >= FORECAST_REFRESH:
                fc_due.setdefault(stadium, []).append((g, ko))
        elif ko + timedelta(hours=GAME_HOURS) + ARCHIVE_DELAY <= now and not r.get("obs_temp_f"):
            last = parse_iso(r.get("obs_fetched_utc", ""))
            if last is None or now - last >= ARCHIVE_RETRY:
                obs_due.setdefault(stadium, []).append((g, ko))
        elif ko + timedelta(hours=GAME_HOURS) + ARCHIVE_DELAY <= now and not r.get("obs_precip_hrs"):
            # observed before hourly detail existed (2026-11-27): fill only the three new columns, once
            fill_due.setdefault(stadium, []).append((g, ko))

    calls = errors = filled = 0
    dead = False
    for kind, due, url in (("pre", pre_due_by, FORECAST_URL), ("fc", fc_due, FORECAST_URL), ("obs", obs_due, ARCHIVE_URL),
                           ("fill", fill_due, ARCHIVE_URL)):
        for stadium, items in (list(due.items())[:FILL_MAX_STADIUMS] if kind == "fill" else due.items()):
            if dead:
                break
            lat, lon, _ = STADIUMS[stadium]
            start = min(ko for _, ko in items) - timedelta(hours=DETAIL_BEFORE + 1)
            end = max(ko for _, ko in items) + timedelta(hours=DETAIL_AFTER + 1)
            if kind in ("fc", "pre"):
                end = min(end, now + FORECAST_HORIZON)
            try:
                series = _fetch(url, lat, lon, start, end, forecast=(kind != "obs"))
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
                if kind == "fill":
                    # never touches the stored observed values, fetched time or note: only the three hourly-detail columns
                    w = _window(series, ko)
                    r["obs_precip_hrs"] = w["precip_hrs"] if w else "na"  # "na" = the archive had no complete window; not retried
                    if w:
                        r["obs_snow_in"], r["obs_wcode_hrs"] = w["snow_in"], w["wcode_hrs"]
                    filled += 1
                    continue
                r[f"{kind}_fetched_utc"] = iso(now)
                w = _window(series, ko)
                if w is None:
                    continue  # not available yet; retried later
                for k, v in w.items():
                    if kind in ("obs", "pre") and k == "precip_prob":
                        continue
                    r[f"{kind}_{k}"] = v

    out = [rows[k] for k in sorted(rows)]
    changed = [{f: r.get(f, "") for f in FIELDS} for r in out] != \
              [{f: old.get(r["game_id"], {}).get(f, "") for f in FIELDS} for r in out]
    if changed or not WEATHER_PATH.exists():
        write_csv(WEATHER_PATH, out, FIELDS)
    if calls or errors:
        log.append(f"weather: {calls} Open-Meteo calls" + (f", {errors} failed" if errors else "")
                   + (f", hourly detail filled for {filled} observed games" if filled else ""))
    return changed


def load():
    return {r["game_id"]: r for r in read_csv(WEATHER_PATH)}
