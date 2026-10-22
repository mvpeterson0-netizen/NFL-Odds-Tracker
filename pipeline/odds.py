"""Pre-game player prop pulls from The Odds API (https://the-odds-api.com).

One successful pull per game, targeted 2.5-3.5 hours before kickoff. If no run
lands in that window, the next run before kickoff takes it and the real capture
time is recorded. Nothing is ever pulled at or after kickoff.

Quota guard (free plan, 500 credits/month per key): the 5 core markets are always
requested. The 2 optional QB markets are added only when the remaining credits
(summed across all keys) still cover the core markets for every remaining game
this month plus a reserve.

Several API keys can be supplied (ODDS_API_KEY, ODDS_API_KEY_2 ... _6). Each run
checks every key's remaining credits with the free events call, then uses the
first key that has enough for the pull; if a key is rejected or runs dry, the
next key is tried. Keys are never logged; the pull log notes which key number
was used.

Snapshot pulls (line movement; displayed, never graded), per NFL week, Central time:
  mon  - from Monday 8:00 AM, every hour until the books return props
  thu  - Thursday 2:00 PM (retried hourly, up to 3 tries, if nothing comes back)
  sun  - Sunday 8:00 AM (same retry rule)
Each applies to that week's games that have not kicked off. Snapshot pulls only
spend credits that are not needed for the remaining pre-game pulls this month.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .common import (DATA, TEAM_NAME_TO_ABBR, append_csv, http_get, iso, norm_name, parse_iso, read_csv,
                     redact, utcnow, COLLECTION_START_UTC)

API = "https://api.the-odds-api.com/v4"
SPORT = "americanfootball_nfl"
BOOKS = ["draftkings", "fanduel"]  # stored in this order of preference
CORE = ["player_pass_yds", "player_rush_attempts", "player_rush_yds", "player_receptions", "player_reception_yds"]
OPTIONAL = ["player_pass_attempts", "player_pass_completions"]
WINDOW_OPEN = timedelta(hours=3, minutes=30)
WINDOW_CLOSE = timedelta(hours=2, minutes=30)
RESERVE_CREDITS = 15
MAX_ATTEMPTS = 4

CT = ZoneInfo("America/Chicago")
# pull type -> (label, days after the week's Monday, hour, minute) in Central time
SNAPSHOTS = {"mon": ("Mon", 0, 8, 0), "thu": ("Thu", 3, 14, 0), "sun": ("Sun AM", 6, 8, 0)}
SNAP_RETRY = timedelta(hours=1)
SNAP_MAX_TRIES = 3  # for thu/sun; mon keeps trying hourly until it gets props (or the thu pull starts)
# Monday fill-in: books post props gradually, so a Monday pull can come back "thin". If fewer than
# FILL_MIN_COVERAGE of the game's starters (FILL_SLOTS) have a Monday line, pull again every FILL_EVERY
# until coverage is reached or the Thursday 2 PM snapshot takes over.
FILL_SLOTS = ("QB1", "RB1", "WR1", "WR2", "TE1")
FILL_MIN_COVERAGE = 0.75
FILL_EVERY = timedelta(hours=12)
SLOTS_PATH = DATA / "slots.csv"
# Pre-kickoff sweeps: after the ~3 h pre-game pull, check again in these windows (time before kickoff).
# If any starter (FILL_SLOTS) still has no pre-game line, pull the game again. Lines captured at ~3 h
# stay the graded ones; a sweep only adds lines for players who had none.
SWEEP_WINDOWS = [(timedelta(minutes=75), timedelta(minutes=40)), (timedelta(minutes=25), timedelta(minutes=5))]
# Sweeps also cover tracked backups who play a real role: average offensive snap share at or above this (%).
SWEEP_MIN_SNAP = 25.0

CAPTURES_PATH = DATA / "prop_captures.csv"
PULL_LOG_PATH = DATA / "pull_log.csv"
CAPTURE_FIELDS = ["game_id", "event_id", "pull_type", "captured_utc", "kickoff_utc", "minutes_before_kickoff",
                  "in_window", "book", "market", "player_book_name", "gsis_id", "line", "over_price",
                  "under_price", "book_last_update", "source"]
PULL_FIELDS = ["game_id", "event_id", "pull_type", "status", "attempted_utc", "kickoff_utc",
               "minutes_before_kickoff", "in_window", "markets", "outcomes", "credits_last", "credits_remaining",
               "note"]


def ptype(r):
    return r.get("pull_type") or "pregame"


def _pulls_by_game(pull_type="pregame"):
    out = defaultdict(list)
    for r in read_csv(PULL_LOG_PATH):
        if ptype(r) == pull_type:
            out[r["game_id"]].append(r)
    return out


def week_monday(week_games):
    """8:00 AM Central on the Monday on or before the week's first kickoff."""
    first = min(parse_iso(g["kickoff_utc"]) for g in week_games).astimezone(CT)
    d = first.date() - timedelta(days=first.weekday())
    return datetime(d.year, d.month, d.day, 8, 0, tzinfo=CT)


def snapshot_anchor(week_games, t):
    _label, days, hh, mm = SNAPSHOTS[t]
    mon = week_monday(week_games)
    d = (mon + timedelta(days=days)).date()
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=CT)


def starter_coverage(pull_type):
    """{game_id: (starters with at least one line of this pull type, starters)} for FILL_SLOTS players."""
    starters = defaultdict(set)  # (week, team) -> gsis ids
    for r in read_csv(SLOTS_PATH):
        if r.get("slot") in FILL_SLOTS and r.get("gsis_id"):
            starters[(str(int(r["week"])), r["team"])].add(r["gsis_id"])
    have = defaultdict(set)
    for c in read_csv(CAPTURES_PATH):
        if ptype(c) == pull_type and c.get("gsis_id"):
            have[c["game_id"]].add(c["gsis_id"])
    out = {}
    from .nflverse import schedule  # local import keeps module load light
    for g in schedule():
        ids = starters.get((g["week"], g["home_team"]), set()) | starters.get((g["week"], g["away_team"]), set())
        if ids:
            out[g["game_id"]] = (len(ids & have.get(g["game_id"], set())), len(ids))
    return out


def _sweep_player(r):
    if r.get("slot") in FILL_SLOTS:
        return True
    try:
        return float(r.get("snap_avg") or "") >= SWEEP_MIN_SNAP
    except ValueError:
        return False


def missing_starters(pull_type="pregame", include_backups=True):
    """{game_id: [names of starters (and, if include_backups, tracked backups averaging >= SWEEP_MIN_SNAP%
    of snaps) with no line of this pull type]} for games that have such players."""
    starters = defaultdict(set)
    names = {}
    for r in read_csv(SLOTS_PATH):
        if r.get("gsis_id") and (r.get("slot") in FILL_SLOTS or (include_backups and _sweep_player(r))):
            starters[(str(int(r["week"])), r["team"])].add(r["gsis_id"])
            names[r["gsis_id"]] = r.get("player", r["gsis_id"])
    have = defaultdict(set)
    for c in read_csv(CAPTURES_PATH):
        if ptype(c) == pull_type and c.get("gsis_id"):
            have[c["game_id"]].add(c["gsis_id"])
    from .nflverse import schedule
    out = {}
    for g in schedule():
        ids = starters.get((g["week"], g["home_team"]), set()) | starters.get((g["week"], g["away_team"]), set())
        if ids:
            out[g["game_id"]] = sorted(names.get(i, i) for i in ids - have.get(g["game_id"], set()))
    return out


def plan_sweeps(games, now=None):
    """Return [(game, note)] for games that had a pre-game pull but still miss a starter's line, inside a sweep window."""
    now = now or utcnow()
    pulls = _pulls_by_game()
    miss = None
    due = []
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko is None or ko <= now or ko < COLLECTION_START_UTC:
            continue
        rows = pulls.get(g["game_id"], [])
        if not _has_ok(rows):
            continue  # the normal pre-game pull handles this game
        for start, end in SWEEP_WINDOWS:
            if not (ko - start <= now <= ko - end):
                continue
            # one attempt per window
            if any((p := parse_iso(r.get("attempted_utc", ""))) and ko - start <= p <= ko - end for r in rows):
                continue
            if miss is None:
                miss = missing_starters("pregame")
            names = miss.get(g["game_id"], [])
            if names:
                due.append((g, f"sweep {int(start.total_seconds() // 60)}-{int(end.total_seconds() // 60)} min: "
                               f"{len(names)} player(s) had no line: {', '.join(names)}"))
    return due


def plan_snapshots(games, now=None):
    """Return [(game, pull_type)] snapshot pulls due now."""
    now = now or utcnow()
    by_week = defaultdict(list)
    for g in games:
        if parse_iso(g.get("kickoff_utc", "")) and g.get("week"):
            by_week[g["week"]].append(g)
    logs = {t: _pulls_by_game(t) for t in SNAPSHOTS}
    cov = None  # loaded only if a Monday pull needs checking
    due = []
    for wk, wg in by_week.items():
        anchors = {t: snapshot_anchor(wg, t) for t in SNAPSHOTS}
        for g in wg:
            ko = parse_iso(g["kickoff_utc"])
            if ko <= now or ko < COLLECTION_START_UTC:
                continue
            for t in SNAPSHOTS:
                if now < anchors[t]:
                    continue
                if t == "mon" and now >= anchors["thu"]:
                    continue  # the Thursday pull takes over
                if t == "thu" and now >= anchors["sun"] and ko > anchors["sun"]:
                    continue  # Sunday pull takes over for Sunday/Monday games
                rows = logs[t].get(g["game_id"], [])
                if _has_ok(rows):
                    if t != "mon":
                        continue
                    # Monday fill-in for thin games
                    if cov is None:
                        cov = starter_coverage("mon")
                    have, total = cov.get(g["game_id"], (0, 0))
                    if total == 0 or have / total >= FILL_MIN_COVERAGE:
                        continue
                    last = max((parse_iso(r.get("attempted_utc", "")) for r in rows), default=None)
                    if last and now - last < FILL_EVERY:
                        continue
                    due.append((g, t))
                    continue
                tries = [r for r in rows if r["status"] in ("empty", "error")]
                if tries:
                    last = parse_iso(tries[-1].get("attempted_utc", ""))
                    if last and now - last < SNAP_RETRY:
                        continue
                    if t != "mon" and len(tries) >= SNAP_MAX_TRIES:
                        continue
                due.append((g, t))
    return due


def _has_ok(rows):
    return any(r["status"] == "ok" for r in rows)


def plan(games, now=None):
    """Return (due_games, newly_missed_games)."""
    now = now or utcnow()
    pulls = _pulls_by_game()
    due, missed = [], []
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko is None or ko < COLLECTION_START_UTC:
            continue
        rows = pulls.get(g["game_id"], [])
        if _has_ok(rows):
            continue
        if ko <= now:
            if not any(r["status"] in ("missed", "no_props") for r in rows):
                missed.append(g)
            continue
        if ko - now <= WINDOW_OPEN:
            attempts = sum(1 for r in rows if r["status"] in ("empty", "error", "late", "quota"))
            if attempts < MAX_ATTEMPTS:
                due.append(g)
    return due, missed


def _headers_credits(h):
    return h.get("x-requests-last", ""), h.get("x-requests-remaining", "")


def fetch_events(key):
    body, h, status = http_get(f"{API}/sports/{SPORT}/events", {"apiKey": key, "dateFormat": "iso"})
    if status != 200:
        raise RuntimeError(f"Odds API events HTTP {status}: {body[:200]!r}")
    return json.loads(body), h


def match_event(game, events):
    ko = parse_iso(game["kickoff_utc"])
    for e in events:
        home = TEAM_NAME_TO_ABBR.get(e.get("home_team", ""))
        away = TEAM_NAME_TO_ABBR.get(e.get("away_team", ""))
        ct = parse_iso(e.get("commence_time", ""))
        if ct is None or abs((ct - ko).total_seconds()) > 6 * 3600:
            continue
        if {home, away} == {game["home_team"], game["away_team"]}:
            return e
    return None


def _main_line_rows(event, game_id, pull_type, captured, ko, mins, in_window, name_index):
    """Flatten bookmaker outcomes into one row per (book, market, player, line)."""
    rows = []
    for bk in event.get("bookmakers", []):
        for m in bk.get("markets", []):
            grouped = defaultdict(dict)
            for o in m.get("outcomes", []):
                player = o.get("description", "")
                point = o.get("point")
                side = (o.get("name") or "").lower()
                if not player or point is None or side not in ("over", "under"):
                    continue
                grouped[(player, point)][side] = o.get("price")
            for (player, point), sides in grouped.items():
                rows.append({
                    "game_id": game_id, "event_id": event.get("id", ""), "pull_type": pull_type,
                    "captured_utc": iso(captured), "kickoff_utc": iso(ko), "minutes_before_kickoff": mins,
                    "in_window": in_window, "book": bk.get("key", ""), "market": m.get("key", ""),
                    "player_book_name": player, "gsis_id": name_index.get(norm_name(player), ""),
                    "line": point, "over_price": sides.get("over", ""), "under_price": sides.get("under", ""),
                    "book_last_update": m.get("last_update", ""), "source": "The Odds API",
                })
    return rows


def run(keys, games, name_index_for_game, log):
    """Execute due pulls. Returns True if any data/log rows were written."""
    if isinstance(keys, str):
        keys = [keys]
    keys = [k for k in (keys or []) if k]
    if not keys:
        log.append("odds: ODDS_API_KEY not set; skipped")
        return False
    now = utcnow()
    due, missed = plan(games, now)
    wrote = False
    for g in missed:
        append_csv(PULL_LOG_PATH, [{
            "game_id": g["game_id"], "pull_type": "pregame", "status": "missed", "attempted_utc": iso(now),
            "kickoff_utc": g["kickoff_utc"], "note": "no successful pull before kickoff",
        }], PULL_FIELDS)
        log.append(f"odds: {g['game_id']} kicked off with no pre-game line (logged as missed)")
        wrote = True
    snaps = plan_snapshots(games, now)
    try:
        sweeps = plan_sweeps(games, now)
    except Exception as ex:  # a sweep problem must never block the main pre-game pull
        sweeps = []
        log.append(f"odds: sweep check skipped ({type(ex).__name__}: {str(ex)[:80]})")
    if not due and not snaps and not sweeps:
        return wrote

    # Check every key (the events call is free). Keep the events list from the first key that works.
    events, left = None, {}
    for i, k in enumerate(keys, 1):
        try:
            ev, h = fetch_events(k)
        except RuntimeError as ex:
            log.append(f"odds: key #{i} events call failed ({str(ex)[:80]})")
            continue
        _l, rem = _headers_credits(h)
        left[i] = int(rem) if rem.isdigit() else None
        if events is None:
            events = ev
    if events is None:
        raise RuntimeError("Odds API events call failed with every key")
    log.append("odds: credits left " + ", ".join(f"key #{i}={v if v is not None else '?'}" for i, v in left.items()))

    def total_left():
        known = [v for v in left.values() if v is not None]
        return sum(known) if known else None

    def pick(cost, skip=()):
        for i, v in left.items():
            if i not in skip and (v is None or v >= cost):
                return i
        return None

    remaining_n = total_left()
    pulls = _pulls_by_game()

    sweep_note = {g["game_id"]: note for g, note in sweeps}
    due_ids = {g["game_id"] for g in due}
    jobs = [(g, "pregame") for g in sorted(due, key=lambda x: x["kickoff_utc"])] + \
           [(g, "pregame") for g, _n in sorted(sweeps, key=lambda x: x[0]["kickoff_utc"]) if g["game_id"] not in due_ids] + \
           sorted(snaps, key=lambda x: x[0]["kickoff_utc"])
    for g, pt in jobs:
        ko = parse_iso(g["kickoff_utc"])
        now = utcnow()
        if ko <= now:
            continue
        e = match_event(g, events)
        base = {"game_id": g["game_id"], "pull_type": pt, "attempted_utc": iso(now),
                "kickoff_utc": g["kickoff_utc"]}
        if e is None:
            append_csv(PULL_LOG_PATH, [{**base, "status": "error", "note": "event not found in Odds API events list"}],
                       PULL_FIELDS)
            log.append(f"odds: {g['game_id']} not found in events list")
            wrote = True
            continue

        # Quota guard
        markets = list(CORE)
        is_sweep = pt == "pregame" and g["game_id"] in sweep_note and g["game_id"] not in due_ids
        if pt != "pregame" or is_sweep:
            # Snapshots only use credits the remaining pre-game pulls this month don't need.
            if remaining_n is not None:
                month = ko.strftime("%Y-%m")
                later = [x for x in games if x.get("kickoff_utc", "")[:7] == month
                         and parse_iso(x["kickoff_utc"]) > now and not _has_ok(pulls.get(x["game_id"], []))]
                spare = remaining_n - (len(CORE) * len(later) + RESERVE_CREDITS)
                if spare >= len(CORE) + len(OPTIONAL):
                    markets += OPTIONAL
                elif spare < len(CORE):
                    log.append(f"odds: {g['game_id']} {'sweep' if is_sweep else pt + ' snapshot'} skipped to protect pre-game pulls "
                               f"({remaining_n} credits left)")
                    continue
            else:
                markets += OPTIONAL
        elif remaining_n is not None:
            month = ko.strftime("%Y-%m")
            later = [x for x in games if x["game_id"] != g["game_id"] and x.get("kickoff_utc", "")[:7] == month
                     and parse_iso(x["kickoff_utc"]) > now and not _has_ok(pulls.get(x["game_id"], []))]
            need_core = len(CORE) * len(later) + RESERVE_CREDITS
            if remaining_n - (len(CORE) + len(OPTIONAL)) >= need_core:
                markets += OPTIONAL
            elif remaining_n < len(CORE):
                append_csv(PULL_LOG_PATH, [{**base, "event_id": e["id"], "status": "quota",
                                            "credits_remaining": remaining_n,
                                            "note": "not enough API credits left this month"}], PULL_FIELDS)
                log.append(f"odds: {g['game_id']} skipped, quota ({remaining_n} left)")
                wrote = True
                continue

        tried = []
        while True:
            ki = pick(len(markets), skip=tried)
            if ki is None and len(markets) > len(CORE):
                ki = pick(len(CORE), skip=tried)
                if ki is not None:
                    markets = list(CORE)  # this key can only afford the core markets
            if ki is None:
                break
            tried.append(ki)
            params = {"apiKey": keys[ki - 1], "bookmakers": ",".join(BOOKS), "markets": ",".join(markets),
                      "oddsFormat": "american", "dateFormat": "iso"}
            body, h, status = http_get(f"{API}/sports/{SPORT}/events/{e['id']}/odds", params)
            _last, rem = _headers_credits(h)
            if rem.isdigit():
                left[ki] = int(rem)
            if status in (401, 429):  # key rejected or out of credits: try the next one
                left[ki] = 0
                log.append(f"odds: key #{ki} rejected (HTTP {status}); trying next key")
                continue
            break
        if not tried:
            append_csv(PULL_LOG_PATH, [{**base, "event_id": e["id"], "status": "quota",
                                        "credits_remaining": total_left() or 0,
                                        "note": "no API key has enough credits left"}], PULL_FIELDS)
            log.append(f"odds: {g['game_id']} skipped, no key has credits")
            wrote = True
            continue
        captured = utcnow()
        last, remaining = _headers_credits(h)
        remaining_n = total_left()
        remaining = "" if remaining_n is None else str(remaining_n)
        mins = round((ko - captured).total_seconds() / 60)
        in_window = ("yes" if WINDOW_CLOSE <= (ko - captured) <= WINDOW_OPEN else "no") if pt == "pregame" else "n/a"
        row = {**base, "event_id": e["id"], "markets": " ".join(markets), "credits_last": last,
               "credits_remaining": remaining, "minutes_before_kickoff": mins, "in_window": in_window,
               "attempted_utc": iso(captured)}
        keynote = f"key #{tried[-1]}" + (f" ({left[tried[-1]]} left on it)" if left.get(tried[-1]) is not None else "")
        if status != 200:
            append_csv(PULL_LOG_PATH, [{**row, "status": "error",
                                        "note": f"HTTP {status}: {body[:150].decode('utf-8', 'replace')}; {keynote}"}],
                       PULL_FIELDS)
            log.append(f"odds: {g['game_id']} HTTP {status}")
            wrote = True
            continue
        if captured >= ko:
            append_csv(PULL_LOG_PATH, [{**row, "status": "late", "note": "response arrived after kickoff; discarded"}],
                       PULL_FIELDS)
            wrote = True
            continue
        event = json.loads(body)
        caps = _main_line_rows(event, g["game_id"], pt, captured, ko, mins, in_window,
                               name_index_for_game(g))
        if not caps:
            append_csv(PULL_LOG_PATH, [{**row, "status": "empty", "outcomes": 0,
                                        "note": ("no player prop outcomes returned" + (
                                            "; " + sweep_note[g["game_id"]] if pt == "pregame" and g["game_id"] in sweep_note
                                            and g["game_id"] not in due_ids else ""))}], PULL_FIELDS)
            log.append(f"odds: {g['game_id']} {pt} returned no props (cost {last})")
            wrote = True
            continue
        append_csv(CAPTURES_PATH, caps, CAPTURE_FIELDS)
        books = sorted({c["book"] for c in caps})
        unmatched = sorted({c["player_book_name"] for c in caps if not c["gsis_id"]})
        note = f"books: {','.join(books)}; {keynote}"
        if pt == "pregame" and g["game_id"] in sweep_note and g["game_id"] not in due_ids:
            note = sweep_note[g["game_id"]] + "; " + note
        if unmatched:
            note += f"; unmatched names: {', '.join(unmatched)}"
        append_csv(PULL_LOG_PATH, [{**row, "status": "ok", "outcomes": len(caps), "note": note}], PULL_FIELDS)
        if pt == "pregame":
            pulls[g["game_id"]].append({"status": "ok"})
        log.append(f"odds: {g['game_id']} {pt} captured {len(caps)} lines {mins} min before kickoff "
                   f"(cost {last}, remaining {remaining})")
        wrote = True
    return wrote
