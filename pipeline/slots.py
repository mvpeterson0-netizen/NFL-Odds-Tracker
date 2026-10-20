"""Weekly player slots per team: QB1, RB1-2, WR1-3, TE1-2.

Slots use only information available before kickoff:
  * the latest ESPN depth chart snapshot (via nflverse) taken before kickoff
  * average offensive snap share over the player's last 3 games played for the team
  * players listed Out on that week's injury report, or on a reserve list, are excluded

Score for RB/WR/TE = 0.6 * avg snap % + 0.4 * depth points (rank 1 = 100, rank 2 = 80, ...).
Players with no 2026 snaps for the team are scored 0.6 * depth points.
Players listed Doubtful are ranked after everyone who is not.
QB1 = the highest-ranked QB on the depth chart who is not Out.

Slots for a week are frozen once that team's game kicks off.
"""
from __future__ import annotations

from statistics import mean

from .common import DATA, iso, parse_iso, read_csv, utcnow, write_csv

SLOT_COUNTS = {"QB": 1, "RB": 2, "WR": 3, "TE": 2}
SLOTS_PATH = DATA / "slots.csv"
FIELDS = ["season", "week", "team", "slot", "gsis_id", "player", "score", "depth_rank", "snap_avg",
          "snap_n", "depth_snapshot", "basis", "change_note", "computed_utc", "frozen"]
NO_HISTORY_FACTOR = 0.6
ELIGIBLE_STATUS = {"ACT", "INA"}  # INA = game-day inactive; not known before inactives are announced


def team_schedule(games):
    """team -> list of games (dicts) in kickoff order (regular + postseason)."""
    out = {}
    for g in games:
        if not g.get("kickoff_utc"):
            continue
        for side, opp, ha in (("home_team", "away_team", "home"), ("away_team", "home_team", "away")):
            out.setdefault(g[side], []).append({"game": g, "opp": g[opp], "ha": ha})
    for t in out:
        out[t].sort(key=lambda x: x["game"]["kickoff_utc"])
    return out


def _depth_points(rank):
    if rank is None:
        return 0.0
    return max(0.0, 100.0 - 20.0 * (rank - 1))


def compute_team_week(d, team, entry, prior_entries):
    g = entry["game"]
    week = int(g["week"])
    ko = g["kickoff_utc"]
    snapshot, depth_rows = d.depth_as_of(team, ko)
    prior = prior_entries[-3:]

    # Candidate pool
    cands = {}
    for r in depth_rows:
        gsis = r.get("gsis_id")
        if not gsis:
            continue
        pos = r["pos_abb"]
        rank = int(r["pos_rank"]) if r.get("pos_rank") else None
        c = cands.setdefault(gsis, {"gsis": gsis, "name": r["player_name"], "pos": pos, "rank": rank})
        if rank is not None and (c["rank"] is None or rank < c["rank"]):
            c["rank"] = rank
    for pe in prior:
        gid = pe["game"]["game_id"]
        for gsis, srow in d.snaps_by_game.get(gid, []):
            if srow["team"] != team:
                continue
            pos = srow.get("position", "")
            if pos in SLOT_COUNTS and gsis not in cands:
                info = d.player_info.get(gsis, {})
                cands[gsis] = {"gsis": gsis, "name": info.get("name") or srow["player"], "pos": pos, "rank": None}

    # Eligibility (pre-game information only)
    excluded = {}
    for gsis, c in list(cands.items()):
        c["doubtful"] = False
        inj = d.injuries.get((week, team, gsis))
        c["doubtful"] = bool(inj and inj.get("report_status") == "Doubtful")
        if inj and inj.get("report_status") == "Out":
            excluded[gsis] = f"listed Out on week {week} injury report"
            continue
        rr = d.roster_row(week, gsis)
        if rr is not None:
            if rr.get("team") != team:
                excluded[gsis] = f"on {rr.get('team')} roster, not {team}"
                continue
            if rr.get("status") not in ELIGIBLE_STATUS:
                excluded[gsis] = f"roster status {rr.get('status')} ({rr.get('status_description_abbr','')})"
                continue

    # Scores: snap share over the player's last 3 games played for this team (before this kickoff)
    for gsis, c in cands.items():
        pcts = []
        for pe in reversed(prior_entries):
            gid = pe["game"]["game_id"]
            p = d.snap_pct(gid, gsis)
            srow = d.snaps.get((gid, gsis))
            if p is not None and srow and srow["team"] == team and p > 0:
                pcts.append(p)
                if len(pcts) == 3:
                    break
        c["snap_avg"] = mean(pcts) if pcts else None
        c["snap_n"] = len(pcts)
        dp = _depth_points(c["rank"])
        c["score"] = 0.6 * c["snap_avg"] + 0.4 * dp if c["snap_avg"] is not None else NO_HISTORY_FACTOR * dp

    result = []
    for pos, n in SLOT_COUNTS.items():
        pool = [c for g_, c in cands.items() if c["pos"] == pos and g_ not in excluded]
        if pos == "QB":
            ranked = sorted([c for c in pool if c["rank"] is not None], key=lambda c: (c["doubtful"], c["rank"]))
            if not ranked:
                ranked = sorted(pool, key=lambda c: (c["doubtful"], -(c["snap_avg"] or 0)))
        else:
            ranked = sorted(pool, key=lambda c: (c["doubtful"], -c["score"], -(c["snap_avg"] or 0), c["name"]))
        for i, c in enumerate(ranked[:n]):
            depth_txt = f"depth #{c['rank']}" if c["rank"] is not None else "not on depth chart"
            snap_txt = (f"{c['snap_avg']:.0f}% avg snaps, last {c['snap_n']} gm played" if c["snap_avg"] is not None
                        else "no 2026 snaps for this team")
            result.append({
                "week": week, "team": team, "slot": f"{pos}{i + 1}", "gsis_id": c["gsis"], "player": c["name"],
                "score": f"{c['score']:.1f}", "depth_rank": c["rank"] if c["rank"] is not None else "",
                "snap_avg": f"{c['snap_avg']:.1f}" if c["snap_avg"] is not None else "", "snap_n": c["snap_n"],
                "depth_snapshot": snapshot or "",
                "basis": f"{depth_txt}; {snap_txt}" + ("; Doubtful on injury report" if c["doubtful"] else ""),
            })
    return result, excluded, cands


def describe_change(prev_row, new_row, excluded, cands, current_by_gsis):
    p = prev_row["gsis_id"]
    if p in excluded:
        return f"{prev_row['player']} {excluded[p]}"
    if p not in cands:
        return f"{prev_row['player']} not on {new_row['team']} depth chart or recent snap list"
    now_slot = current_by_gsis.get(p)
    pc = cands[p]
    nc = cands.get(new_row["gsis_id"], {})

    def fmt(c):
        d = f"depth #{c['rank']}" if c.get("rank") is not None else "no depth rank"
        s = f"{c['snap_avg']:.0f}% snaps" if c.get("snap_avg") is not None else "no recent snaps"
        return f"{d}, {s}"

    moved = f"moved to {now_slot}" if now_slot else "dropped out of slots"
    return f"{prev_row['player']} {moved} ({fmt(pc)}); {new_row['player']} ({fmt(nc)})"


def update_slots(d) -> list[dict]:
    existing = read_csv(SLOTS_PATH)
    frozen = {}
    for r in existing:
        if r.get("frozen") == "1":
            frozen.setdefault((int(r["week"]), r["team"]), []).append(r)
    now = utcnow()
    ts = team_schedule(d.games)
    out = []
    for team, entries in ts.items():
        prev_rows = None
        for i, e in enumerate(entries):
            g = e["game"]
            week = int(g["week"])
            ko = parse_iso(g["kickoff_utc"])
            started = ko is not None and ko <= now
            # only compute through the team's next unplayed game
            if not started and i > 0 and parse_iso(entries[i - 1]["game"]["kickoff_utc"]) > now:
                break
            key = (week, team)
            if key in frozen:
                rows = frozen[key]
            else:
                rows, excluded, cands = compute_team_week(d, team, e, entries[:i])
                cur = {r["gsis_id"]: r["slot"] for r in rows}
                prev_by_slot = {r["slot"]: r for r in (prev_rows or [])}
                for r in rows:
                    pr = prev_by_slot.get(r["slot"])
                    if pr and pr["gsis_id"] != r["gsis_id"]:
                        r["change_note"] = describe_change(pr, r, excluded, cands, cur)
                    else:
                        r["change_note"] = ""
                    r["season"] = g["season"]
                    r["computed_utc"] = iso(now)
                    r["frozen"] = "1" if started else "0"
            out.extend(rows)
            prev_rows = rows
            if not started:
                break
    out.sort(key=lambda r: (int(r["week"]), r["team"], r["slot"]))
    write_csv(SLOTS_PATH, out, FIELDS)
    return out
