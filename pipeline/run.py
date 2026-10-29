"""Entry point for each scheduled run.

1. Refresh the season schedule (cheap; only re-downloads when nflverse updates it).
2. Pull any pre-game props that are due, and log missed games.
3. Rebuild the site data when anything it depends on changed.
4. Append one line to the run log (data/runs/YYYY-MM.csv), success or failure.
"""
from __future__ import annotations

import hashlib
import os
import sys
import traceback

from . import espn, espn_box, nflverse, notify, odds, script, supa, weather
from .common import DATA, SITE, append_csv, iso, read_json, utcnow

BUILD_VERSION = "1"  # bump to force a rebuild after code changes
RUN_FIELDS = ["run_utc", "finished_utc", "trigger", "status", "built", "summary", "error"]


def _file_hash(p):
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else ""


def main() -> int:
    start = utcnow()
    log: list[str] = []
    status, err, built = "ok", "", False
    out_path = SITE / "data" / "data.json"
    before = _file_hash(out_path)
    try:
        sched_changed = nflverse.refresh_schedule()
        if sched_changed:
            log.append("schedule: updated")
        games = nflverse.schedule()
        supa.sync_games(games, log, announce=sched_changed)  # kickoff times for the accounts database's pick lock

        name_index = read_json(DATA / "name_index.json", {}) or {}

        def idx_for(g):
            merged = dict(name_index.get(g["away_team"], {}))
            merged.update(name_index.get(g["home_team"], {}))
            return merged

        # Only the paid 20k-credit key is used (Michael, 2026-10-28); the older free keys are retired.
        keys = [os.environ.get("ODDS_API_KEY_20K", "").strip()]
        odds_changed = odds.run(keys, games, idx_for, log)

        weather_changed = weather.refresh(games, log)

        try:  # optional source: a problem here must never stop the run
            espn_changed = espn.refresh(log)
        except Exception as ex:
            espn_changed = False
            log.append(f"espn: skipped ({type(ex).__name__}: {str(ex)[:80]})")

        try:  # optional source: box scores for finished games until nflverse publishes them
            box_changed = espn_box.refresh(games, log)
        except Exception as ex:
            box_changed = False
            log.append(f"espn box: skipped ({type(ex).__name__}: {str(ex)[:80]})")

        try:  # optional source: game script from nflverse play-by-play
            script_changed = script.refresh(log)
        except Exception as ex:
            script_changed = False
            log.append(f"game script: skipped ({type(ex).__name__}: {str(ex)[:80]})")

        changed = nflverse.changed_datasets()
        if changed:
            log.append("nflverse updated: " + ", ".join(changed))
        state = read_json(DATA / "build_state.json", {}) or {}
        need = (sched_changed or odds_changed or weather_changed or espn_changed or box_changed or script_changed or changed or not out_path.exists()
                or state.get("version") != BUILD_VERSION or os.environ.get("FORCE_BUILD") == "1")
        if need:
            from .build import build
            from .common import write_json
            build(log)
            built = True
            write_json(DATA / "build_state.json", {"version": BUILD_VERSION, "built_utc": iso(utcnow())})

        try:  # optional: phone alert when a game's lines first cover most players (never fails the run)
            notify.run(log)
        except Exception as ex:
            log.append(f"notify: skipped ({type(ex).__name__}: {str(ex)[:80]})")
    except Exception as e:  # logged, then the run fails so the next schedule retries
        status = "error"
        err = f"{type(e).__name__}: {e}"[:500]
        (DATA / "build_state.json").unlink(missing_ok=True)  # force a full rebuild next run
        traceback.print_exc()
    finally:
        finished = utcnow()
        append_csv(DATA / "runs" / f"{start:%Y-%m}.csv", [{
            "run_utc": iso(start), "finished_utc": iso(finished),
            "trigger": os.environ.get("GITHUB_EVENT_NAME", "local"), "status": status,
            "built": "yes" if built else "no", "summary": " | ".join(log)[:1500], "error": err,
        }], RUN_FIELDS)
        site_changed = _file_hash(out_path) != before
        gh_out = os.environ.get("GITHUB_OUTPUT")
        if gh_out:
            with open(gh_out, "a") as f:
                f.write(f"site_changed={'true' if site_changed else 'false'}\n")
        print("\n".join(log) or "nothing to do")
        print(f"status={status} built={built} site_changed={site_changed}")
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
