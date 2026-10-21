"""Monday early-week snapshot of FanDuel NFL player props (EXPERIMENTAL).

Michael chose to run this knowing that FanDuel's Terms of Use (Section 6) prohibit
automated access without their written permission, and that it may stop working
at any time. To keep it modest:
  - runs once a week, about 15 game pages x 3 tabs, with pauses between pages
  - no login, no spoofed identity, no CAPTCHA solving or block evasion:
    if FanDuel blocks or challenges the browser, the run logs it and stops.

How it works: a headless browser opens FanDuel's public NFL page and each game's
player-prop tabs, and reads the odds data the page itself loads (JSON responses).
Rows go to data/fd_snapshots.csv (append-only, separate from the Odds API captures,
which stay the official pre-game line). Raw responses are saved to OUT_DIR so they
can be inspected (uploaded as a workflow artifact, not committed).

Usage: python scrapers/fanduel_snapshot.py [--out DIR] [--days 8] [--no-write]
Requires: pip install playwright && playwright install --with-deps chromium
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.common import (DATA, TEAM_NAME_TO_ABBR, append_csv, iso, norm_name, parse_iso,  # noqa: E402
                             read_csv, read_json, to_float, utcnow)

SNAP_PATH = DATA / "fd_snapshots.csv"
LOG_PATH = DATA / "fd_snapshot_log.csv"
SNAP_FIELDS = ["captured_utc", "game_id", "kickoff_utc", "event_id", "market", "player_book_name", "gsis_id",
               "line", "over_price", "under_price", "fd_market_name", "source_url"]
LOG_FIELDS = ["run_utc", "status", "events_found", "games_matched", "pages", "json_responses", "rows", "note"]
BASE = "https://sportsbook.fanduel.com"
NFL_PAGE = f"{BASE}/navigation/nfl"
TABS = ["passing-props", "rushing-props", "receiving-props"]
PAUSE_S = 4

# FanDuel market name (after "<Player> - ") -> Odds API market key used elsewhere in the app
STAT_MAP = [
    (r"^passing (yds|yards)$", "player_pass_yds"),
    (r"^(passing|pass) attempts$", "player_pass_attempts"),
    (r"^(passing|pass) completions$", "player_pass_completions"),
    (r"^rushing (yds|yards)$", "player_rush_yds"),
    (r"^rushing attempts$", "player_rush_attempts"),
    (r"^(total )?receptions$", "player_receptions"),
    (r"^receiving (yds|yards)$", "player_reception_yds"),
]
SKIP = re.compile(r"\b(alt|alternate|milestone|1st|2nd|quarter|half|longest|\d\+)\b", re.I)


def market_key(stat_text: str):
    s = re.sub(r"\s+", " ", stat_text.strip().lower())
    if SKIP.search(s):
        return None
    for pat, key in STAT_MAP:
        if re.match(pat, s):
            return key
    return None


def american(runner: dict):
    """American odds from a runner, trying the field names FanDuel's page data is known to use."""
    wro = runner.get("winRunnerOdds") or {}
    for path in (("americanDisplayOdds", "americanOddsInt"), ("americanDisplayOdds", "americanOdds"),
                 ("americanOdds",)):
        v = wro
        for k in path:
            v = v.get(k) if isinstance(v, dict) else None
        f = to_float(v)
        if f is not None:
            return int(f)
    return None


def walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)


def parse_markets(payload):
    """Yield (player_name, market_key, line, over, under, fd_market_name) from any JSON payload."""
    for d in walk(payload):
        name = d.get("marketName")
        runners = d.get("runners")
        if not isinstance(name, str) or not isinstance(runners, list) or " - " not in name:
            continue
        player, stat = name.rsplit(" - ", 1)
        key = market_key(stat)
        if not key:
            continue
        over = under = None
        line = None
        for r in runners:
            if not isinstance(r, dict):
                continue
            rn = str(r.get("runnerName", "")).strip().lower()
            h = to_float(r.get("handicap"))
            if rn.endswith("over"):
                over, line = american(r), h if h is not None else line
            elif rn.endswith("under"):
                under, line = american(r), h if h is not None else line
        if line is None or (over is None and under is None):
            continue
        yield player.strip(), key, line, over, under, name


def parse_events(payload):
    """Yield (event_id, name, open_date) for NFL-looking events in any JSON payload."""
    for d in walk(payload):
        eid, name, od = d.get("eventId"), d.get("name"), d.get("openDate")
        if eid and isinstance(name, str) and (" @ " in name or " v " in name) and od:
            yield str(eid), name, od


def split_teams(name: str):
    parts = re.split(r"\s+@\s+|\s+v\s+", name)
    if len(parts) != 2:
        return None, None
    return TEAM_NAME_TO_ABBR.get(parts[0].strip()), TEAM_NAME_TO_ABBR.get(parts[1].strip())


def match_game(games, away, home, open_dt):
    for g in games:
        ko = parse_iso(g.get("kickoff_utc", ""))
        if ko and {g["away_team"], g["home_team"]} == {away, home} and abs((ko - open_dt).total_seconds()) <= 8 * 3600:
            return g
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".fd_raw")
    ap.add_argument("--days", type=int, default=8)
    ap.add_argument("--no-write", action="store_true", help="discovery run: save raw data only")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    now = utcnow()
    log = {"run_utc": iso(now), "status": "ok", "events_found": 0, "games_matched": 0, "pages": 0,
           "json_responses": 0, "rows": 0, "note": ""}
    games = [g for g in read_csv(DATA / "schedule.csv")
             if (ko := parse_iso(g.get("kickoff_utc", ""))) and now < ko <= now + timedelta(days=a.days)]
    name_index = read_json(DATA / "name_index.json", {}) or {}
    rows = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed", file=sys.stderr)
        return 2

    captured = []  # (page_url, response_url, json)

    def on_response(resp):
        try:
            if "json" not in (resp.headers.get("content-type") or ""):
                return
            if "fanduel" not in resp.url:
                return
            captured.append((cur["url"], resp.url.split("?")[0], resp.json()))
        except Exception:
            pass

    cur = {"url": ""}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.on("response", on_response)

            def visit(url):
                cur["url"] = url
                r = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                try:
                    page.wait_for_load_state("networkidle", timeout=20000)
                except Exception:
                    pass
                log["pages"] += 1
                status = r.status if r else 0
                title = page.title()
                (out / f"page_{log['pages']:03d}.txt").write_text(
                    f"{url}\nstatus={status}\ntitle={title}\n\n{page.inner_text('body')[:20000]}", encoding="utf-8")
                if status in (401, 403, 429) or re.search(r"access denied|captcha|verify you are human|blocked",
                                                          title, re.I):
                    raise RuntimeError(f"blocked or challenged at {url} (HTTP {status}, title {title!r})")
                time.sleep(PAUSE_S)

            visit(NFL_PAGE)
            # Event links from the page itself
            hrefs = page.eval_on_selector_all("a[href*='/football/nfl/']", "els => els.map(e => e.getAttribute('href'))")
            links = {}
            for h in hrefs or []:
                m = re.search(r"/football/nfl/([^/?#]+?)-(\d{6,})(?:[/?#]|$)", h or "")
                if m:
                    links[m.group(2)] = BASE + h.split("?")[0]
            events = {}
            for _u, _ru, js in captured:
                for eid, name, od in parse_events(js):
                    events[eid] = (name, od)
            log["events_found"] = len(events)
            targets = []
            for eid, (name, od) in events.items():
                away, home = split_teams(name)
                odt = parse_iso(od)
                if not (away and home and odt and eid in links):
                    continue
                g = match_game(games, away, home, odt)
                if g:
                    targets.append((eid, g, links[eid]))
            log["games_matched"] = len(targets)

            for eid, g, url in targets:
                start = len(captured)
                for tab in TABS:
                    visit(f"{url}?tab={tab}")
                idx = {**name_index.get(g["away_team"], {}), **name_index.get(g["home_team"], {})}
                seen = set()
                for page_url, _ru, js in captured[start:]:
                    for player, key, line, op, up, mname in parse_markets(js):
                        k = (player, key)
                        if k in seen:
                            continue
                        seen.add(k)
                        rows.append({"captured_utc": iso(utcnow()), "game_id": g["game_id"],
                                     "kickoff_utc": g["kickoff_utc"], "event_id": eid, "market": key,
                                     "player_book_name": player, "gsis_id": idx.get(norm_name(player), ""),
                                     "line": line, "over_price": "" if op is None else op,
                                     "under_price": "" if up is None else up, "fd_market_name": mname,
                                     "source_url": page_url})
            browser.close()
    except Exception as e:
        log["status"] = "error"
        log["note"] = f"{type(e).__name__}: {str(e)[:300]}"
    finally:
        log["json_responses"] = len(captured)
        for i, (pu, ru, js) in enumerate(captured):
            (out / f"resp_{i:03d}.json").write_text(json.dumps({"page": pu, "url": ru, "json": js})[:5_000_000],
                                                   encoding="utf-8")
        log["rows"] = len(rows)
        if log["status"] == "ok" and not rows:
            log["status"] = "no_rows"
            log["note"] = log["note"] or "no player-prop markets parsed; inspect raw responses in the run's artifact"
        if not a.no_write:
            if rows:
                append_csv(SNAP_PATH, rows, SNAP_FIELDS)
            append_csv(LOG_PATH, [log], LOG_FIELDS)
        (out / "summary.json").write_text(json.dumps({"log": log, "sample_rows": rows[:20]}, indent=1))
        print(json.dumps(log))
    return 0  # never fail the workflow; status is in the log


if __name__ == "__main__":
    sys.exit(main())
