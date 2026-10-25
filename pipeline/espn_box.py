"""Player box scores from ESPN for finished games that nflverse hasn't published yet.

nflverse's weekly player stats file (our main source for results) is republished only a few times a day,
so finished games could wait many hours for results. ESPN's game summary has the box score right after
the final whistle. Michael chose ESPN for this on 2026-10-25 (same unofficial endpoints and accepted risks
as pipeline/espn.py: no SLA, may change or be blocked, Disney Terms of Use limit use to personal,
noncommercial use and bar automated access).

Requests: 1 scoreboard call per run while any game is final but not frozen, plus at most 2 summary calls per
finished game (when first seen final, and once more >= REFETCH_HOURS later to pick up late stat fixes).
Kept per game in data/espn_boxscores.json (not an archive: games older than KEEP_DAYS are dropped). The build
uses a game's ESPN box score only until nflverse has that game; nflverse always wins once it arrives.
Any failure is logged and the previous file is kept, so ESPN problems never stop a run.
"""
from __future__ import annotations

import json
from datetime import timedelta

from .common import DATA, http_get, iso, parse_iso, read_json, to_float, utcnow, write_json

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={}"
PATH = DATA / "espn_boxscores.json"
REFETCH_HOURS = 2
KEEP_DAYS = 8
# ESPN team abbreviations that differ from nflverse's
TEAM_FIX = {"LAR": "LA", "WSH": "WAS"}


def _get_json(url):
    body, _, status = http_get(url, timeout=45)
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    return json.loads(body)


def _team(abbr: str) -> str:
    a = (abbr or "").upper()
    return TEAM_FIX.get(a, a)


def _num(v):
    return to_float(str(v).replace(",", "")) if v not in (None, "", "--") else None


def parse_summary(doc: dict) -> dict:
    """{'players': {espn_id: {team, passing_yards, ...}}, 'team_targets': {team: n}} from a summary doc."""
    players, team_targets = {}, {}
    for t in ((doc.get("boxscore") or {}).get("players") or []):
        team = _team((t.get("team") or {}).get("abbreviation"))
        tt = 0.0
        for cat in t.get("statistics") or []:
            keys = cat.get("keys") or []
            for a in cat.get("athletes") or []:
                aid = str((a.get("athlete") or {}).get("id") or "")
                vals = dict(zip(keys, a.get("stats") or []))
                if not aid:
                    continue
                p = players.setdefault(aid, {"team": team, "name": (a.get("athlete") or {}).get("displayName", "")})
                name = cat.get("name")
                if name == "passing":
                    ca = str(vals.get("completions/passingAttempts") or "")
                    if "/" in ca:
                        c, att = ca.split("/", 1)
                        p["completions"], p["attempts"] = _num(c), _num(att)
                    p["passing_yards"] = _num(vals.get("passingYards"))
                elif name == "rushing":
                    p["carries"] = _num(vals.get("rushingAttempts"))
                    p["rushing_yards"] = _num(vals.get("rushingYards"))
                elif name == "receiving":
                    p["receptions"] = _num(vals.get("receptions"))
                    p["receiving_yards"] = _num(vals.get("receivingYards"))
                    p["targets"] = _num(vals.get("receivingTargets"))
                    tt += p["targets"] or 0.0
        team_targets[team] = tt
    return {"players": players, "team_targets": team_targets}


def _match_game(ev: dict, games: list[dict]):
    comp = (ev.get("competitions") or [{}])[0]
    teams = {c.get("homeAway"): _team((c.get("team") or {}).get("abbreviation")) for c in comp.get("competitors") or []}
    for g in games:
        if g.get("home_team") == teams.get("home") and g.get("away_team") == teams.get("away"):
            ko, ed = parse_iso(g.get("kickoff_utc") or ""), parse_iso(ev.get("date") or "")
            if ko and ed and abs((ko - ed).total_seconds()) <= 36 * 3600:
                return g["game_id"]
    return None


def refresh(games: list[dict], log: list[str], have_stats=None) -> bool:
    """Fetch box scores for newly finished games. Returns True when the stored file changed.

    `have_stats` (optional set of game_ids nflverse already has) skips games nflverse has published.
    """
    now = utcnow()
    doc = read_json(PATH, None) or {"games": {}}
    store = doc.setdefault("games", {})
    before = json.dumps(store, sort_keys=True)
    # drop old games and games nflverse already has
    for gid in list(store):
        ko = parse_iso(store[gid].get("kickoff_utc") or "")
        if (ko and now - ko > timedelta(days=KEEP_DAYS)) or (have_stats and gid in have_stats):
            del store[gid]
    # Is there any game that kicked off recently, isn't frozen, and nflverse doesn't have?
    recent = [g for g in games if g.get("kickoff_utc") and parse_iso(g["kickoff_utc"]) <= now
              and now - parse_iso(g["kickoff_utc"]) <= timedelta(days=4)
              and not (have_stats and g["game_id"] in have_stats)
              and not store.get(g["game_id"], {}).get("frozen")]
    if not recent:
        changed = json.dumps(store, sort_keys=True) != before
        if changed:
            write_json(PATH, doc)
        return changed
    try:
        sb = _get_json(SCOREBOARD_URL)
    except Exception as ex:
        log.append(f"espn box: scoreboard failed ({type(ex).__name__}: {str(ex)[:80]}); kept previous")
        return False
    recent_ids = {g["game_id"] for g in recent}
    fetched = 0
    for ev in sb.get("events") or []:
        t = ((ev.get("status") or {}).get("type") or {})
        if t.get("state") != "post" or not t.get("completed"):
            continue
        gid = _match_game(ev, games)
        if not gid or gid not in recent_ids:
            continue
        cur = store.get(gid) or {}
        if cur.get("fetched") and now - parse_iso(cur["fetched"]) < timedelta(hours=REFETCH_HOURS):
            continue
        try:
            parsed = parse_summary(_get_json(SUMMARY_URL.format(ev["id"])))
        except Exception as ex:
            log.append(f"espn box: {gid} failed ({type(ex).__name__}: {str(ex)[:60]})")
            continue
        if not parsed["players"]:
            continue
        g = next(x for x in games if x["game_id"] == gid)
        store[gid] = {"event": str(ev["id"]), "kickoff_utc": g.get("kickoff_utc", ""), "fetched": iso(now),
                      "frozen": bool(cur.get("fetched")), **parsed}
        fetched += 1
    changed = json.dumps(store, sort_keys=True) != before
    if changed:
        doc["updated_utc"] = iso(now)
        write_json(PATH, doc)
    if fetched:
        log.append(f"espn box: {fetched} game(s) fetched")
    return changed


def load() -> dict:
    return (read_json(PATH, None) or {}).get("games") or {}


STAT_COLS = ["completions", "attempts", "passing_yards", "carries", "rushing_yards",
             "receptions", "receiving_yards", "targets"]


def merge_into(d, log: list[str]) -> set:
    """Add ESPN box-score rows to d.stats for finished games nflverse hasn't published.

    Rows look like nflverse stats rows for the columns the app uses. ESPN players are matched to nflverse ids
    through the nflverse roster's espn_id; unmatched players are skipped. Returns the game_ids filled from ESPN.
    """
    store = load()
    if not store:
        return set()
    espn_to_gsis = {}
    for r in d.roster_rows:
        eid = str(r.get("espn_id") or "").split(".")[0]
        if eid and r.get("gsis_id"):
            espn_to_gsis[eid] = r["gsis_id"]
    filled, skipped = set(), 0
    for gid, gb in store.items():
        g = d.games_by_id.get(gid)
        if not g or gid in d.stats_games or g.get("result", "") == "":
            continue
        tt = gb.get("team_targets") or {}
        n = 0
        for eid, p in (gb.get("players") or {}).items():
            pid = espn_to_gsis.get(eid)
            team = p.get("team", "")
            if not pid or team not in (g["home_team"], g["away_team"]):
                skipped += 1
                continue
            info = d.player_info.get(pid) or {}
            pos = info.get("position", "")
            row = {"game_id": gid, "player_id": pid, "season_type": "REG", "week": g.get("week", ""),
                   "team": team, "opponent_team": g["away_team"] if team == g["home_team"] else g["home_team"],
                   "position": pos, "position_group": pos, "player_display_name": info.get("name") or p.get("name", ""),
                   "_src": "espn", "_fetched": gb.get("fetched", "")}
            for c in STAT_COLS:
                v = p.get(c)
                row[c] = "" if v is None else str(v)
            tgt, team_tgt = p.get("targets"), tt.get(team)
            row["target_share"] = str(tgt / team_tgt) if tgt is not None and team_tgt else ""
            d.stats[(gid, pid)] = row
            n += 1
        if n:
            d.stats_games.add(gid)
            filled.add(gid)
    if filled:
        log.append(f"espn box: results for {len(filled)} game(s) not yet in nflverse"
                   + (f" ({skipped} ESPN players unmatched)" if skipped else ""))
    return filled


def updated_utc() -> str:
    return (read_json(PATH, None) or {}).get("updated_utc") or ""
