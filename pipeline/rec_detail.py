"""Receiving detail from nflverse play-by-play (CC-BY 4.0) for the late-yardage indicators.

For every regular-season game in the play-by-play file we keep, per player who had a receiving play:
  tot  receiving yards (receiver plays plus lateral plays, so it matches the box score)
  h1   receiving yards in the 1st and 2nd quarters
  lc   his longest single receiving play, in yards
  rc   catches        ry  yards on his own catches (the yards-per-catch numbers use rc and ry)
Saved to data/rec_detail.json, rewritten whenever nflverse republishes the file (checked via its timestamp.json).

Yards-per-catch history before this season (2024 and 2025 regular seasons: catches and yards per player) is saved once to
data/rec_history.json. Both files are derived data only and can be rebuilt from nflverse at any time. Failures are logged
and never stop a run (the previous files are kept).

fields(): what the build attaches to a player's finished game as row["rd"]:
  tot, h1, lc, rc, plus hc / hy = his catches / yards on catches in every game before this one since the start of 2024.
"""
from __future__ import annotations

import csv
import gzip
import io
import json

from .common import DATA, NFLVERSE, SEASON, http_get, iso, read_json, utcnow, write_json

PATH = DATA / "rec_detail.json"
HIST_PATH = DATA / "rec_history.json"
TAG = "pbp"
VERSION = 1
HIST_SEASONS = (2024, 2025)


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _games(rows):
    """rows: play-by-play dicts -> {game_id: {player_id: {"tot","h1","lc","rc","ry"}}}.
    Same play filter as the study this comes from: regular season, no 2-point tries; catches are pass plays that are not
    sacks with a receiver and receiving yards."""
    out: dict = {}
    for r in rows:
        if r.get("season_type") != "REG" or _num(r.get("two_point_attempt")) == 1:
            continue
        gid = r["game_id"]
        qtr = _num(r.get("qtr"))
        plays = []
        pid, y = r.get("receiver_player_id"), _num(r.get("receiving_yards"))
        if pid and y is not None:
            plays.append((pid, y, True))
        lp, ly = r.get("lateral_receiver_player_id"), _num(r.get("lateral_receiving_yards"))
        if lp and ly is not None:
            plays.append((lp, ly, False))
        for p, yds, own in plays:
            e = out.setdefault(gid, {}).setdefault(p, {"tot": 0.0, "h1": 0.0, "lc": None, "rc": 0, "ry": 0.0})
            e["tot"] += yds
            if qtr is not None and qtr <= 2:
                e["h1"] += yds
            e["lc"] = yds if e["lc"] is None else max(e["lc"], yds)
            if own and r.get("play_type") == "pass" and _num(r.get("sack")) != 1:
                e["rc"] += 1
                e["ry"] += yds
    for g in out.values():
        for e in g.values():
            for k in ("tot", "h1", "ry"):
                e[k] = int(e[k]) if float(e[k]).is_integer() else e[k]
            e["lc"] = int(e["lc"]) if e["lc"] is not None and float(e["lc"]).is_integer() else e["lc"]
    return out


def compute(rows) -> dict:
    return _games(rows)


def history_from(games_by_season: dict) -> dict:
    """{player_id: [catches, yards on catches]} added up over the given seasons' games."""
    h: dict = {}
    for games in games_by_season.values():
        for g in games.values():
            for pid, e in g.items():
                c = h.setdefault(pid, [0, 0])
                c[0] += e["rc"]
                c[1] += e["ry"]
    return {p: [int(c), int(y) if float(y).is_integer() else y] for p, (c, y) in h.items()}


def _remote_ts(tag: str):
    body, _, status = http_get(f"{NFLVERSE}/{tag}/timestamp.json", timeout=30)
    if status != 200:
        return None
    try:
        return json.loads(body).get("last_updated")
    except (ValueError, AttributeError):
        return None


def _pbp_rows(season: int):
    body, _, status = http_get(f"{NFLVERSE}/{TAG}/play_by_play_{season}.csv.gz", timeout=240)
    if status != 200:
        return None, status
    return csv.DictReader(io.StringIO(gzip.decompress(body).decode("utf-8"))), status


def refresh_history(log: list) -> bool:
    """Build data/rec_history.json once (2024 and 2025 are finished seasons, so it never needs to change)."""
    old = read_json(HIST_PATH, {}) or {}
    if old.get("v") == VERSION and old.get("players"):
        return False
    by = {}
    for s in HIST_SEASONS:
        rows, status = _pbp_rows(s)
        if rows is None:
            log.append(f"rec history: {s} play-by-play download failed (HTTP {status}); kept previous")
            return False
        by[s] = compute(rows)
    write_json(HIST_PATH, {"v": VERSION, "seasons": list(HIST_SEASONS), "fetched_utc": iso(utcnow()),
                           "url": f"https://github.com/nflverse/nflverse-data/releases/tag/{TAG}",
                           "players": history_from(by)}, compact=True)
    log.append(f"rec history: {len(by)} seasons of catches and yards per player")
    return True


def refresh(log: list) -> bool:
    """Re-download and recompute when nflverse has a newer play-by-play file. Returns True if the file changed."""
    refresh_history(log)
    old = read_json(PATH, {}) or {}
    ts = _remote_ts(TAG)
    if not ts:
        log.append("rec detail: nflverse play-by-play timestamp unavailable; kept previous")
        return False
    if old.get("source_updated") == ts and old.get("v") == VERSION:
        return False
    rows, status = _pbp_rows(SEASON)
    if rows is None:
        log.append(f"rec detail: play-by-play download failed (HTTP {status}); kept previous")
        return False
    games = compute(rows)
    write_json(PATH, {"source_updated": ts, "fetched_utc": iso(utcnow()), "v": VERSION,
                      "url": f"https://github.com/nflverse/nflverse-data/releases/tag/{TAG}", "games": games}, compact=True)
    log.append(f"rec detail: {len(games)} games from nflverse play-by-play ({ts})")
    return True


class RecDetail:
    """Read side for build(): looks up one player-game and his catch history before it."""

    def __init__(self):
        d = read_json(PATH, {}) or {}
        self.games = d.get("games") or {}
        self.hist = (read_json(HIST_PATH, {}) or {}).get("players") or {}
        self.by_player: dict = {}
        for gid, g in self.games.items():
            wk = int(gid.split("_")[1])
            for pid, e in g.items():
                self.by_player.setdefault(pid, []).append((wk, e["rc"], e["ry"]))

    def fields(self, pid: str, gid: str, wk: int):
        g = self.games.get(gid)
        if not g:
            return None  # play-by-play for this game isn't published yet: nothing is guessed
        e = g.get(pid) or {"tot": 0, "h1": 0, "lc": 0, "rc": 0, "ry": 0}
        hc, hy = self.hist.get(pid, [0, 0])
        for w, c, y in self.by_player.get(pid, ()):
            if w < wk:
                hc += c
                hy += y
        return {"tot": e["tot"], "h1": e["h1"], "lc": e["lc"] if e["lc"] is not None else 0, "rc": e["rc"], "hc": hc, "hy": hy}
