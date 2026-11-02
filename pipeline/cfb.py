"""College football (Power 4) games, final results and rosters from ESPN, stored in Supabase.

Michael's decisions (2026-11-01): Power 4 = any game with an ACC, Big 12, Big Ten or SEC team, or Notre Dame;
only passing, rushing and receiving yards; ESPN is the main source for results (same unofficial endpoints and
accepted risks as pipeline/espn_box.py: no SLA, may change or be blocked, Disney's terms bar automated access).
The repo is public, so nothing CFB is written to data/ — see pipeline/cfb_store.py.

Per run: 3 scoreboard requests (this week, last week, next week); a box score for each newly final game and once
or twice more later in case of stat corrections; rosters (positions) for teams in this and next week's games, at
most once a week per team. Any failure is logged and the run goes on; ESPN problems never fail a run.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

from .common import http_get, iso, parse_iso, to_float, utcnow
from .cfb_store import Store

BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football"
SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={}"
P4_CONFERENCES = {"1": "ACC", "4": "Big 12", "5": "Big Ten", "8": "SEC"}   # ESPN conference ids (verified 2026-11-01)
NOTRE_DAME_ID = "87"
REFETCH_AFTER = timedelta(hours=2)
FROZEN_AFTER_KICKOFF = timedelta(hours=7)   # a box score fetched this long after kickoff is treated as final
ROSTER_MAX_AGE = timedelta(days=7)


def _get_json(url):
    body, _, status = http_get(url, timeout=45)
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    return json.loads(body)


def p4_label(teams: list[dict]) -> str | None:
    """Conference label when the game involves a Power 4 team or Notre Dame; home team's wins a tie."""
    for t in sorted(teams, key=lambda x: x.get("home") is not True):
        if t.get("conf") in P4_CONFERENCES:
            return P4_CONFERENCES[t["conf"]]
        if t.get("id") == NOTRE_DAME_ID:
            return "Notre Dame"
    return None


def school_name(t: dict, display: str) -> str:
    """'Baylor' from ESPN's team object: its location field, else the display name minus the mascot."""
    loc = (t.get("location") or "").strip()
    if loc:
        return loc
    mascot = (t.get("name") or "").strip()
    if mascot and display.endswith(" " + mascot):
        return display[: -len(mascot) - 1].strip()
    return display


def parse_event(ev: dict) -> dict | None:
    """One cfb_games row from an ESPN scoreboard event, or None if it isn't a Power 4 game."""
    comp = (ev.get("competitions") or [{}])[0]
    teams = []
    for c in comp.get("competitors") or []:
        t = c.get("team") or {}
        name = t.get("displayName") or ""
        teams.append({"id": str(t.get("id") or ""), "name": name, "conf": str(t.get("conferenceId") or ""),
                      "home": c.get("homeAway") == "home", "score": c.get("score"), "abbr": t.get("abbreviation") or "",
                      "short": school_name(t, name)})
    home = next((t for t in teams if t["home"]), None)
    away = next((t for t in teams if not t["home"]), None)
    label = p4_label(teams)
    if not (home and away and label and ev.get("date")):
        return None
    state = (((ev.get("status") or {}).get("type") or {}).get("state")) or "pre"
    completed = bool(((ev.get("status") or {}).get("type") or {}).get("completed"))
    ko = parse_iso(ev["date"])
    if ko is None:
        return None
    wk = (ev.get("week") or {}).get("number")

    def score(t):
        v = to_float(t.get("score"))
        return int(v) if v is not None and state != "pre" else None
    return {"game_id": str(ev["id"]), "week": wk, "kickoff": iso(ko), "home_team": home["name"], "away_team": away["name"],
            "home_id": home["id"], "away_id": away["id"], "conference": label,
            "home_short": home["short"], "away_short": away["short"], "home_abbr": home["abbr"], "away_abbr": away["abbr"],
            "status": "final" if (state == "post" and completed) else ("in" if state == "in" else "scheduled"),
            "home_score": score(home), "away_score": score(away)}


def refresh_games(store: Store, log: list[str], now) -> list[dict]:
    """Upsert this week's, last week's and next week's Power 4 games. Returns the games seen this run."""
    cur = _get_json(f"{BASE}/scoreboard?groups=80&limit=300")
    week = (cur.get("week") or {}).get("number")
    events = list(cur.get("events") or [])
    if isinstance(week, int):
        for w in (week - 1, week + 1):
            if w < 1:
                continue
            try:
                events += _get_json(f"{BASE}/scoreboard?groups=80&week={w}&seasontype=2&limit=300").get("events") or []
            except Exception as ex:
                log.append(f"cfb: week {w} scoreboard failed ({type(ex).__name__}: {str(ex)[:60]})")
    games = {}
    for ev in events:
        g = parse_event(ev)
        if g:
            games[g["game_id"]] = g
    rows = list(games.values())
    if not rows:
        return []
    # keep the Odds API event id once it's been matched (the scoreboard doesn't know it)
    have = {r["game_id"]: r.get("odds_event_id") for r in store.select(
        "cfb_games", {"select": "game_id,odds_event_id", "game_id": "in.(" + ",".join(games) + ")"})}
    for r in rows:
        r["odds_event_id"] = have.get(r["game_id"])
        r["updated_at"] = iso(now)
    store.upsert("cfb_games", rows, "game_id")
    return rows


def parse_summary(doc: dict) -> dict:
    """{athlete_id: row} of passing / rushing / receiving yards from an ESPN game summary."""
    out = {}
    for t in ((doc.get("boxscore") or {}).get("players") or []):
        team = (t.get("team") or {}).get("displayName") or ""
        for cat in t.get("statistics") or []:
            keys = cat.get("keys") or []
            name = cat.get("name")
            if name not in ("passing", "rushing", "receiving"):
                continue
            for a in cat.get("athletes") or []:
                ath = a.get("athlete") or {}
                aid = str(ath.get("id") or "")
                nm = (ath.get("displayName") or "").strip()
                if not aid or not nm or nm.lower() == "team":
                    continue
                vals = dict(zip(keys, a.get("stats") or []))
                r = out.setdefault(aid, {"athlete_id": aid, "player_name": nm, "team_name": team})
                num = lambda v: to_float(str(v).replace(",", "")) if v not in (None, "", "--") else None  # noqa: E731
                if name == "passing":
                    ca = str(vals.get("completions/passingAttempts") or "")
                    if "/" in ca:
                        c, att = ca.split("/", 1)
                        r["pass_cmp"], r["pass_att"] = num(c), num(att)
                    r["pass_yds"] = num(vals.get("passingYards"))
                elif name == "rushing":
                    r["rush_att"], r["rush_yds"] = num(vals.get("rushingAttempts")), num(vals.get("rushingYards"))
                else:
                    r["rec"], r["rec_yds"] = num(vals.get("receptions")), num(vals.get("receivingYards"))
    return out


RESULT_COLS = ["pass_cmp", "pass_att", "pass_yds", "rush_att", "rush_yds", "rec", "rec_yds"]


def refresh_results(store: Store, games: list[dict], log: list[str], now, get_json=_get_json) -> int:
    """Download the box score for newly final games; once or twice more later for late stat corrections."""
    final = [g for g in games if g["status"] == "final"]
    if not final:
        return 0
    state = {r["game_id"]: r for r in store.select(
        "cfb_pull_state", {"game_id": "in.(" + ",".join(g["game_id"] for g in final) + ")"})}
    fetched = 0
    for g in final:
        st = state.get(g["game_id"]) or {}
        last = parse_iso(st.get("results_fetched_utc") or "")
        ko = parse_iso(g["kickoff"])
        if last is not None:
            if last >= ko + FROZEN_AFTER_KICKOFF or now - last < REFETCH_AFTER:
                continue
        try:
            players = parse_summary(get_json(SUMMARY.format(g["game_id"])))
        except Exception as ex:
            log.append(f"cfb results: {g['game_id']} failed ({type(ex).__name__}: {str(ex)[:60]})")
            continue
        if not players:
            continue
        rows = []
        for r in players.values():
            row = {"game_id": g["game_id"], "fetched_utc": iso(now)}
            row.update({c: r.get(c) for c in RESULT_COLS})
            row.update({k: r[k] for k in ("athlete_id", "player_name", "team_name")})
            rows.append(row)
        store.upsert("cfb_results", rows, "game_id,athlete_id")
        # pull_state row may not exist yet (lines never posted); keep the other columns as they are
        base = {"game_id": g["game_id"], "empty_checks": st.get("empty_checks") or 0,
                "last_check_utc": st.get("last_check_utc"), "first_ok_utc": st.get("first_ok_utc"),
                "pregame_ok_utc": st.get("pregame_ok_utc")}
        store.upsert("cfb_pull_state", [{**base, "results_fetched_utc": iso(now), "updated_at": iso(now)}], "game_id")
        fetched += 1
    if fetched:
        log.append(f"cfb results: {fetched} game(s) fetched")
    return fetched


def parse_roster(doc: dict, team_id: str, team_name: str) -> list[dict]:
    items = []
    for g in doc.get("athletes") or []:
        items.extend(g.get("items") or [] if isinstance(g, dict) and "items" in g else [g])
    out = []
    for a in items:
        aid = str(a.get("id") or "")
        if aid:
            out.append({"athlete_id": aid, "name": a.get("displayName") or "", "team_id": team_id, "team_name": team_name,
                        "pos": (a.get("position") or {}).get("abbreviation")})
    return out


def refresh_rosters(store: Store, games: list[dict], log: list[str], now, get_json=_get_json, max_teams: int = 80) -> int:
    """Positions for players on teams in this/next week's games; each team at most once a week.
    ESPN lists only 100 players per team, so some players will have no position."""
    teams = {}
    for g in games:
        if g["status"] != "final":
            teams[g["home_id"]], teams[g["away_id"]] = g["home_team"], g["away_team"]
    if not teams:
        return 0
    st = {r["team_id"]: parse_iso(r.get("updated_at") or "") for r in store.select(
        "cfb_roster_state", {"team_id": "in.(" + ",".join(teams) + ")"})}
    todo = [t for t in teams if not st.get(t) or now - st[t] >= ROSTER_MAX_AGE][:max_teams]
    done = 0
    for tid in todo:
        try:
            rows = parse_roster(get_json(f"{BASE}/teams/{tid}/roster"), tid, teams[tid])
        except Exception as ex:
            log.append(f"cfb roster: {tid} failed ({type(ex).__name__}: {str(ex)[:60]})")
            continue
        if rows:
            for r in rows:
                r["updated_at"] = iso(now)
            store.upsert("cfb_players", rows, "athlete_id")
            store.upsert("cfb_roster_state", [{"team_id": tid, "updated_at": iso(now)}], "team_id")
            done += 1
    if done:
        log.append(f"cfb roster: {done} team(s) refreshed")
    return done


def run(keys: list[str], log: list[str], store: Store | None = None, now=None) -> bool:
    """One CFB pass: games, lines, results, rosters, optional back-fill. Needs SUPABASE_SERVICE_KEY; skips without it.
    Each part is independent: a failure in one is logged and the rest still run. Never raises."""
    from . import cfb_history, cfb_odds, cfb_season, cfb_store
    store = store or cfb_store.from_env()
    if store is None:
        return False
    now = now or utcnow()
    try:
        games = refresh_games(store, log, now)
    except Exception as ex:
        log.append(f"cfb: skipped ({type(ex).__name__}: {str(ex)[:80]})")
        return False
    parts = [("odds", lambda: cfb_odds.run(store, keys, games, log, now)),
             ("results", lambda: refresh_results(store, games, log, now)),
             ("rosters", lambda: refresh_rosters(store, games, log, now)),
             ("season", lambda: cfb_season.run(store, log, now)),
             ("history", lambda: cfb_history.run(store, os.environ.get("ODDS_API_KEY_20K", "").strip(), log, now))]
    for name, fn in parts:
        try:
            fn()
        except Exception as ex:
            log.append(f"cfb {name}: skipped ({type(ex).__name__}: {str(ex)[:80]})")
    return True
