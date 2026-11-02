"""One-time back-fill of EARLIER weeks' Power 4 games and final results (ESPN) into Supabase. Costs no Odds API credits.

The live collector (pipeline/cfb.py) only keeps last week, this week and next week. This fills in the weeks before
that so the whole season's results are there. OFF unless CFB_SEASON_WEEKS is set (e.g. "1-9" or "1,2,5-7"); the
workflow's `cfb_season_weeks` input sets it for one run. Skips push-triggered runs.

Per run: one ESPN scoreboard request for each requested week that has no games stored yet, then box scores for up to
MAX_BOX_PER_RUN final games that have no results yet (oldest first). Re-run until the log says nothing is left.
Stored the same way as the live collector (cfb_games upsert, cfb.refresh_results), so nothing else changes.
"""
from __future__ import annotations

import os

from . import cfb
from .common import iso
from .cfb_store import Store

MAX_BOX_PER_RUN = 40


def weeks_from_env() -> list[int]:
    """'1-9,11' -> [1..9, 11]. Anything that isn't a number or a range is ignored."""
    out: list[int] = []
    for part in os.environ.get("CFB_SEASON_WEEKS", "").replace(" ", "").split(","):
        if part.isdigit():
            out.append(int(part))
        elif "-" in part:
            a, _, b = part.partition("-")
            if a.isdigit() and b.isdigit() and 0 < int(a) <= int(b) <= 30:
                out.extend(range(int(a), int(b) + 1))
    return sorted(set(out))


def run(store: Store, log: list[str], now, get_json=cfb._get_json, weeks: list[int] | None = None,
        max_box: int = MAX_BOX_PER_RUN) -> int:
    """Returns the number of box scores fetched this run."""
    weeks = weeks_from_env() if weeks is None else weeks
    if not weeks or os.environ.get("GITHUB_EVENT_NAME") == "push":
        return 0
    added = 0
    for w in weeks:
        if store.select("cfb_games", {"week": f"eq.{w}", "select": "game_id"}):
            continue                                    # this week's games are already stored
        try:
            events = get_json(f"{cfb.BASE}/scoreboard?groups=80&week={w}&seasontype=2&limit=300").get("events") or []
        except Exception as ex:
            log.append(f"cfb season: week {w} scoreboard failed ({type(ex).__name__}: {str(ex)[:60]})")
            continue
        rows = {}
        for e in events:
            g = cfb.parse_event(e)
            if g and g.get("week") == w:                # only the week asked for (ESPN can mix in other weeks)
                g["updated_at"] = iso(now)
                rows[g["game_id"]] = g
        if rows:
            store.upsert("cfb_games", list(rows.values()), "game_id")
            added += len(rows)
    if added:
        log.append(f"cfb season: {added} game(s) stored for week(s) {','.join(map(str, weeks))}")
    # final games in those weeks that have no downloaded box score yet, oldest first
    final: list[dict] = []
    for w in weeks:
        final += store.select("cfb_games", {"week": f"eq.{w}", "status": "eq.final"})
    if not final:
        return 0
    ids = ",".join(g["game_id"] for g in final)
    done = {r["game_id"] for r in store.select("cfb_pull_state", {"game_id": f"in.({ids})"}) if r.get("results_fetched_utc")}
    todo = sorted((g for g in final if g["game_id"] not in done), key=lambda g: (g["kickoff"], g["game_id"]))
    if not todo:
        log.append("cfb season: all results for these weeks are stored")
        return 0
    batch = todo[:max_box]
    fetched = cfb.refresh_results(store, batch, log, now, get_json)
    left = len(todo) - fetched
    log.append(f"cfb season: {fetched} box score(s) fetched, about {max(left, 0)} still to go")
    return fetched
