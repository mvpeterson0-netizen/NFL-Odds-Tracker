"""One-time back-fill of a past CFB week's graded line (the snapshot 1 hour before kickoff), from The Odds API's
historical endpoints. OFF unless CFB_BACKFILL_WEEKS is set (e.g. "9"); that is set only after Michael says Yes to the
spend. Which markets: CFB_BACKFILL_MARKETS = pass, rush, rec (comma list; empty = all three). Estimate: 10 credits
per market that returns data, plus 1 per events lookup (one lookup per kickoff time, shared by every game then).

Per game: one historical event-odds request for the markets it is still missing. Rows go to cfb_lines as pull_type
'pregame', source 'The Odds API (historical)'. The pull's note records which markets it covered, so a game pulled for
passing only can later be topped up with rushing/receiving without paying for passing again, and a market is never
downloaded twice for a game. Errors retry on later runs, up to MAX_TRIES. Skips push-triggered runs.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

from .common import http_get, iso, parse_iso
from .cfb_store import Store
from .cfb_odds import MARKETS, SPORT, match_event, parse_lines
from .odds import API, BOOKS, EXTRA_BOOKS

HIST = f"{API}/historical/sports/{SPORT}"
SNAP_BEFORE = timedelta(hours=1)
CREDIT_FLOOR = 15000
MAX_GAMES_PER_RUN = 40
MAX_TRIES = 3
SOURCE = "The Odds API (historical)"


def _get(url, params):
    return http_get(url, params, timeout=60)


SHORT = {"pass": "player_pass_yds", "rush": "player_rush_yds", "rec": "player_reception_yds"}
NAMES = {v: k for k, v in SHORT.items()}


def markets_from_env() -> list[str]:
    """CFB_BACKFILL_MARKETS 'pass' / 'pass,rush' ... -> market keys; empty or nothing valid = all three."""
    out = [SHORT[p] for p in os.environ.get("CFB_BACKFILL_MARKETS", "").replace(" ", "").lower().split(",") if p in SHORT]
    return [m for m in MARKETS if m in out] or list(MARKETS)


def note_markets(note: str | None) -> set[str]:
    """Markets a stored pull covered: the 'markets=pass,rush' tag in its note; no tag (live pulls, earlier back-fills) = all three."""
    if note and "markets=" in note:
        tag = note.split("markets=", 1)[1].split(";")[0].split(" ")[0]
        found = {SHORT[p] for p in tag.split(",") if p in SHORT}
        if found:
            return found
    return set(MARKETS)


def weeks_from_env() -> list[int]:
    out = []
    for p in os.environ.get("CFB_BACKFILL_WEEKS", "").replace(" ", "").split(","):
        if p.isdigit():
            out.append(int(p))
    return out


def run(store: Store, key: str, log: list[str], now, get=_get, weeks: list[int] | None = None,
        markets: list[str] | None = None) -> int:
    weeks = weeks_from_env() if weeks is None else weeks
    want = markets_from_env() if markets is None else [m for m in MARKETS if m in markets] or list(MARKETS)
    if not key or not weeks or os.environ.get("GITHUB_EVENT_NAME") == "push":
        return 0
    games = [g for w in weeks for g in store.select("cfb_games", {"week": f"eq.{w}", "status": "eq.final"})]
    if not games:
        return 0
    ids = ",".join(g["game_id"] for g in games)
    pulled = {r["game_id"] for r in store.select("cfb_pull_state", {"game_id": f"in.({ids})"}) if r.get("pregame_ok_utc")}
    covered: dict[str, set[str]] = {}
    for r in store.select("cfb_pulls", {"game_id": f"in.({ids})", "status": "eq.ok", "pull_type": "eq.pregame"}):
        covered.setdefault(r["game_id"], set()).update(note_markets(r.get("note")))
    errs: dict[str, int] = {}
    for r in store.select("cfb_pulls", {"game_id": f"in.({ids})", "status": "eq.error"}):
        if (r.get("note") or "").startswith("historical"):
            errs[r["game_id"]] = errs.get(r["game_id"], 0) + 1

    def missing(g) -> list[str]:
        """Wanted markets this game has no graded line for yet (a live pregame pull or an older back-fill = all three)."""
        if g["game_id"] not in pulled:
            return want
        have = covered.get(g["game_id"]) or set(MARKETS)
        return [m for m in want if m not in have]
    todo = sorted((g for g in games if missing(g) and errs.get(g["game_id"], 0) < MAX_TRIES),
                  key=lambda g: (g["kickoff"], g["game_id"]))[:MAX_GAMES_PER_RUN]
    if not todo:
        return 0
    books = ",".join((BOOKS + EXTRA_BOOKS)[:10])
    remaining, stored = None, 0
    events_by_ko: dict[str, list] = {}   # one events lookup per kickoff time, shared by every game that kicks off then
    for g in todo:
        miss = missing(g)
        cost = 10 * len(miss) + 1        # worst case: every market returns data, plus one events lookup
        if remaining is not None and remaining - cost < CREDIT_FLOOR:
            log.append(f"cfb history: stopped, {remaining} credits left (floor {CREDIT_FLOOR})")
            break
        ko = parse_iso(g["kickoff"])
        date = iso(ko - SNAP_BEFORE)

        def fail(note):
            store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": "pregame", "status": "error",
                                        "attempted_utc": iso(now), "note": ("historical: " + note)[:200]}])
        if g["kickoff"] not in events_by_ko:
            body, h, status = get(f"{HIST}/events", {"apiKey": key, "date": date, "dateFormat": "iso",
                                                      "commenceTimeFrom": iso(ko - timedelta(hours=1)),
                                                      "commenceTimeTo": iso(ko + timedelta(hours=1))})
            rem = h.get("x-requests-remaining", "")
            remaining = int(rem) if rem.isdigit() else remaining
            if status != 200:
                fail(f"events HTTP {status}")
                if status in (401, 403, 429):
                    break
                continue
            events_by_ko[g["kickoff"]] = json.loads(body).get("data") or []
        if remaining is None or remaining - cost < CREDIT_FLOOR:
            log.append("cfb history: stopped (balance unknown or at floor)")
            break
        ev = match_event(g, events_by_ko[g["kickoff"]])
        if ev is None:
            fail(f"not in historical events at {date}")
            continue
        body, h, status = get(f"{HIST}/events/{ev['id']}/odds", {
            "apiKey": key, "date": date, "bookmakers": books, "markets": ",".join(miss),
            "oddsFormat": "american", "dateFormat": "iso"})
        used, rem = h.get("x-requests-last", ""), h.get("x-requests-remaining", "")
        remaining = int(rem) if rem.isdigit() else remaining
        if status != 200:
            fail(f"odds HTTP {status}")
            if status in (401, 403, 429):
                break
            continue
        js = json.loads(body)
        snap = parse_iso(js.get("timestamp", "")) or (ko - SNAP_BEFORE)
        mins = round((ko - snap).total_seconds() / 60)
        rows = parse_lines(js.get("data") or {}, g["game_id"], "pregame", snap, mins)
        for r in rows:
            r["source"] = SOURCE
        if rows:
            store.insert_ignore("cfb_lines", rows, "game_id,pull_type,captured_utc,book,market,player_name,line")
            tag = ",".join(NAMES[m] for m in miss)
            store.insert("cfb_pulls", [{"game_id": g["game_id"], "pull_type": "pregame", "status": "ok",
                                        "attempted_utc": iso(snap), "minutes_before_kickoff": mins, "outcomes": len(rows),
                                        "credits_last": int(used) if used.isdigit() else None,
                                        "credits_remaining": remaining,
                                        "note": f"historical download {iso(now)}; markets={tag}"}])
            st = (store.select("cfb_pull_state", {"game_id": f"eq.{g['game_id']}"}) or [{}])[0]
            store.upsert("cfb_pull_state", [{"game_id": g["game_id"], "empty_checks": st.get("empty_checks") or 0,
                                             "last_check_utc": st.get("last_check_utc"),
                                             "first_ok_utc": st.get("first_ok_utc") or iso(snap),
                                             "pregame_ok_utc": iso(snap), "results_fetched_utc": st.get("results_fetched_utc"),
                                             "updated_at": iso(now)}], "game_id")
            stored += len(rows)
        else:
            fail("no props in snapshot")
    if stored:
        log.append(f"cfb history: {stored} lines stored")
    return stored
