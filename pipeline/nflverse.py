"""Download and index nflverse data (CC-BY 4.0, https://github.com/nflverse/nflverse-data).

Each dataset publishes a timestamp.json; we only re-download when it changes,
and we record that timestamp so the site can cite it.
"""
from __future__ import annotations

import json
from collections import defaultdict

from .common import (CACHE, DATA, NFLVERSE, SEASON, http_get, iso, kickoff_utc, norm_name,
                     read_csv, read_csv_bytes, read_json, to_float, utcnow, write_csv, write_json)

DATASETS = {
    # name: (release tag, file name, gzipped)
    "schedule": ("schedules", "games.csv", False),
    "stats": ("stats_player", f"stats_player_week_{SEASON}.csv", False),
    "snaps": ("snap_counts", f"snap_counts_{SEASON}.csv", False),
    "injuries": ("injuries", f"injuries_{SEASON}.csv", False),
    "depth": ("depth_charts", f"depth_charts_{SEASON}.csv.gz", True),
    "rosters": ("weekly_rosters", f"roster_weekly_{SEASON}.csv", False),
}

LABELS = {
    "schedule": "nflverse schedules",
    "stats": "nflverse weekly player stats",
    "snaps": "nflverse snap counts (from Pro Football Reference)",
    "injuries": "nflverse injury reports (official NFL report)",
    "depth": "nflverse depth charts (from ESPN)",
    "rosters": "nflverse weekly rosters",
}

SOURCES_PATH = DATA / "sources.json"
SCHEDULE_PATH = DATA / "schedule.csv"
SCHEDULE_FIELDS = ["game_id", "season", "game_type", "week", "gameday", "gametime", "kickoff_utc",
                   "away_team", "home_team", "away_score", "home_score", "result", "location", "stadium",
                   "spread_line"]  # spread_line = points the home team is favored by (nflverse)


def remote_timestamp(name: str) -> str | None:
    tag = DATASETS[name][0]
    try:
        body, _, status = http_get(f"{NFLVERSE}/{tag}/timestamp.json", timeout=30)
    except RuntimeError:
        return None
    if status != 200:
        return None
    try:
        return json.loads(body).get("last_updated")
    except (ValueError, AttributeError):
        return None


def load_sources() -> dict:
    return read_json(SOURCES_PATH, {}) or {}


def save_sources(src: dict) -> None:
    write_json(SOURCES_PATH, src)


def download(name: str) -> list[dict]:
    tag, fname, gz = DATASETS[name]
    cache_file = CACHE / fname
    meta = read_json(CACHE / "meta.json", {}) or {}
    ts = remote_timestamp(name)
    if cache_file.exists() and ts and meta.get(name) == ts:
        body = cache_file.read_bytes()
    else:
        body, _, status = http_get(f"{NFLVERSE}/{tag}/{fname}", timeout=180)
        if status != 200:
            raise RuntimeError(f"nflverse {name} download failed: HTTP {status}")
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(body)
        meta[name] = ts
        write_json(CACHE / "meta.json", meta)
    src = load_sources()
    src[name] = {"label": LABELS[name], "last_updated": ts or "unknown", "fetched_utc": iso(utcnow()),
                 "url": f"https://github.com/nflverse/nflverse-data/releases/tag/{tag}"}
    save_sources(src)
    return read_csv_bytes(body, gz=gz)


def refresh_schedule(force: bool = False) -> bool:
    """Refresh the slim season schedule. Returns True if anything changed."""
    src = load_sources()
    ts = remote_timestamp("schedule")
    # A schedule file saved before a column was added (e.g. spread_line) is refreshed once even if nflverse hasn't changed.
    has_all = SCHEDULE_PATH.exists() and all(f in (SCHEDULE_PATH.read_text(encoding="utf-8").split("\n", 1)[0].strip().split(","))
                                             for f in SCHEDULE_FIELDS)
    if not force and has_all and ts and src.get("schedule", {}).get("last_updated") == ts:
        return False
    rows = download("schedule")
    out = []
    for r in rows:
        if r.get("season") != str(SEASON):
            continue
        ko = kickoff_utc(r["gameday"], r["gametime"])
        r = dict(r)
        r["kickoff_utc"] = iso(ko)
        out.append(r)
    out.sort(key=lambda r: (r["kickoff_utc"], r["game_id"]))
    old = read_csv(SCHEDULE_PATH)
    write_csv(SCHEDULE_PATH, out, SCHEDULE_FIELDS)
    slim_old = [{k: o.get(k, "") for k in SCHEDULE_FIELDS} for o in old]
    slim_new = [{k: o.get(k, "") for k in SCHEDULE_FIELDS} for o in out]
    return slim_old != slim_new


def schedule() -> list[dict]:
    return read_csv(SCHEDULE_PATH)


def changed_datasets(names=("stats", "snaps", "injuries", "depth", "rosters")) -> list[str]:
    src = load_sources()
    changed = []
    for n in names:
        ts = remote_timestamp(n)
        if ts is None:
            continue  # cannot tell; try again next run
        if src.get(n, {}).get("last_updated") != ts:
            changed.append(n)
    return changed


class Data:
    """All nflverse inputs needed to build the site, indexed for lookups."""

    def __init__(self):
        self.games = schedule()
        self.games_by_id = {g["game_id"]: g for g in self.games}
        self.stats_rows = download("stats")
        self.snap_rows = download("snaps")
        self.injury_rows = download("injuries")
        depth_rows = download("depth")
        self.roster_rows = download("rosters")

        # Rosters: (week, gsis) -> row; pfr -> gsis; espn -> gsis
        self.roster = {}
        self.pfr_to_gsis = {}
        self.name_team_to_gsis = defaultdict(set)
        self.player_info = {}
        for r in self.roster_rows:
            g = r.get("gsis_id")
            if not g:
                continue
            w = int(r["week"]) if r.get("week") else 0
            self.roster[(w, g)] = r
            if r.get("pfr_id"):
                self.pfr_to_gsis[r["pfr_id"]] = g
            self.name_team_to_gsis[(norm_name(r["full_name"]), r["team"])].add(g)
            prev = self.player_info.get(g)
            if prev is None or w >= prev["_w"]:
                self.player_info[g] = {"_w": w, "name": r.get("full_name", ""), "team": r.get("team", ""),
                                       "position": r.get("position", "")}
        self.roster_weeks = sorted({w for (w, _) in self.roster})

        # Stats: (game_id, gsis) -> row; games with any stats
        self.stats = {}
        self.stats_games = set()
        for r in self.stats_rows:
            if r.get("season_type") not in ("REG", "POST"):
                continue
            self.stats[(r["game_id"], r["player_id"])] = r
            self.stats_games.add(r["game_id"])
            if r["player_id"] not in self.player_info:
                self.player_info[r["player_id"]] = {"_w": 0, "name": r.get("player_display_name", ""),
                                                    "team": r.get("team", ""), "position": r.get("position", "")}

        # Snaps: (game_id, gsis) -> row; games with snap data
        self.snaps = {}
        self.snaps_by_game = defaultdict(list)
        self.snap_games = set()
        self.unmapped_snaps = 0
        for r in self.snap_rows:
            self.snap_games.add(r["game_id"])
            g = self.pfr_to_gsis.get(r.get("pfr_player_id", ""))
            if not g:
                cands = self.name_team_to_gsis.get((norm_name(r["player"]), r["team"]), set())
                g = next(iter(cands)) if len(cands) == 1 else None
            if not g:
                self.unmapped_snaps += 1
                continue
            self.snaps[(r["game_id"], g)] = r
            self.snaps_by_game[r["game_id"]].append((g, r))

        # Injuries: (week, team, gsis) -> row
        self.injuries = {}
        for r in self.injury_rows:
            if r.get("gsis_id") and r.get("week"):
                self.injuries[(int(r["week"]), r["team"], r["gsis_id"])] = r

        # Depth charts: team -> sorted snapshot list; (team, dt) -> offensive skill rows
        self.depth = defaultdict(list)
        snaps_by_team = defaultdict(set)
        for r in depth_rows:
            if r.get("pos_abb") not in ("QB", "RB", "WR", "TE"):
                continue
            self.depth[(r["team"], r["dt"])].append(r)
            snaps_by_team[r["team"]].add(r["dt"])
        self.depth_snapshots = {t: sorted(v) for t, v in snaps_by_team.items()}

    # --- lookups -------------------------------------------------------
    def roster_row(self, week: int, gsis: str):
        r = self.roster.get((week, gsis))
        if r:
            return r
        for w in reversed(self.roster_weeks):
            if w <= week and (w, gsis) in self.roster:
                return self.roster[(w, gsis)]
        return None

    def depth_as_of(self, team: str, before_iso: str):
        snaps = self.depth_snapshots.get(team, [])
        chosen = None
        for dt in snaps:
            if dt < before_iso:
                chosen = dt
            else:
                break
        if chosen is None:
            return None, []
        return chosen, self.depth[(team, chosen)]

    def snap_pct(self, game_id: str, gsis: str):
        r = self.snaps.get((game_id, gsis))
        if not r:
            return None
        v = to_float(r.get("offense_pct"))
        return None if v is None else v * 100.0
