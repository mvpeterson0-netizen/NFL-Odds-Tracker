"""Game script from nflverse play-by-play (CC-BY 4.0): how long each team led or trailed by a big margin.

For every finished game in the play-by-play file we add up the game clock spent with the home team ahead or behind
by 10+ and by 13+ points (score before each play x time until the next play). Saved to data/game_script.json,
rewritten whenever nflverse republishes the file (checked via its timestamp.json). Derived data only: it can be
rebuilt from nflverse at any time. Failures are logged and never stop a run (the previous file is kept).
"""
from __future__ import annotations

import csv
import gzip
import io
import json

from .common import DATA, NFLVERSE, SEASON, http_get, iso, read_json, utcnow, write_json

PATH = DATA / "game_script.json"
TAG = "pbp"
FILE = f"play_by_play_{SEASON}.csv.gz"
MARGINS = (10, 13)


def _remote_ts() -> str | None:
    body, _, status = http_get(f"{NFLVERSE}/{TAG}/timestamp.json", timeout=30)
    if status != 200:
        return None
    try:
        return json.loads(body).get("last_updated")
    except (ValueError, AttributeError):
        return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compute(rows) -> dict:
    """rows: play-by-play dicts. Returns {game_id: {"h": {"l10","t10","l13","t13"}, "min": game minutes counted}}
    with minutes from the home team's point of view (away = mirror: away leading = home trailing)."""
    by_game: dict[str, list] = {}
    for r in rows:
        if r.get("season_type") not in ("REG", "POST", None, ""):
            continue
        by_game.setdefault(r["game_id"], []).append(r)
    out = {}
    for gid, plays in by_game.items():
        plays = [p for p in plays if _num(p.get("game_seconds_remaining")) is not None]
        if len(plays) < 2:
            continue
        secs = {f"{k}{m}": 0.0 for k in ("l", "t") for m in MARGINS}
        total = 0.0
        for a, b in zip(plays, plays[1:]):
            dt = _num(a["game_seconds_remaining"]) - _num(b["game_seconds_remaining"])
            if dt <= 0:  # same clock (penalties, timeouts) or overtime restart of the clock
                continue
            hs, aw = _num(a.get("total_home_score")) or 0, _num(a.get("total_away_score")) or 0
            d = hs - aw
            total += dt
            for m in MARGINS:
                if d >= m:
                    secs[f"l{m}"] += dt
                if d <= -m:
                    secs[f"t{m}"] += dt
        out[gid] = {"h": {k: round(v / 60, 1) for k, v in secs.items()}, "min": round(total / 60, 1)}
    return out


def refresh(log: list) -> bool:
    """Re-download and recompute when nflverse has a newer play-by-play file. Returns True if the file changed."""
    old = read_json(PATH, {}) or {}
    ts = _remote_ts()
    if not ts:
        log.append("game script: nflverse play-by-play timestamp unavailable; kept previous")
        return False
    if old.get("source_updated") == ts:
        return False
    body, _, status = http_get(f"{NFLVERSE}/{TAG}/{FILE}", timeout=240)
    if status != 200:
        log.append(f"game script: play-by-play download failed (HTTP {status}); kept previous")
        return False
    rows = csv.DictReader(io.StringIO(gzip.decompress(body).decode("utf-8")))
    games = compute(rows)
    write_json(PATH, {"source_updated": ts, "fetched_utc": iso(utcnow()), "margins": list(MARGINS),
                      "url": f"https://github.com/nflverse/nflverse-data/releases/tag/{TAG}", "games": games})
    log.append(f"game script: {len(games)} games from nflverse play-by-play ({ts})")
    return True
