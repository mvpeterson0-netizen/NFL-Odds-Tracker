"""Graded-only week tests (2026-11-27). All games here are SYNTHETIC stubs; they check logic only."""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from pipeline import odds

G12 = {"game_id": "2026_12_AAA_BBB", "week": 12, "kickoff_utc": "2026-11-29T18:00:00Z"}
G13 = {"game_id": "2026_13_CCC_DDD", "week": 13, "kickoff_utc": "2026-12-06T18:00:00Z"}
NOW = datetime(2026, 11, 28, 14, tzinfo=timezone.utc)


def _run(snaps, sweeps, tracks, due=()):
    log = []
    with patch.object(odds, "utcnow", return_value=NOW), patch.object(odds, "link_test", return_value=False), \
         patch.object(odds, "plan", return_value=(list(due), [])), \
         patch.object(odds, "plan_snapshots", return_value=snaps), \
         patch.object(odds, "plan_sweeps", return_value=sweeps), \
         patch.object(odds, "plan_tracking", return_value=tracks), \
         patch.object(odds, "fetch_events", side_effect=RuntimeError("stop")) as fe:
        try:
            odds.run(["k"], [G12, G13], lambda g: {}, log)
        except RuntimeError:
            pass
    return fe.called


class GradedOnlyTests(unittest.TestCase):
    def test_prefix_matches_only_week_12(self):
        self.assertTrue(odds.graded_only(G12))
        self.assertFalse(odds.graded_only(G13))

    def test_week_12_snapshots_sweeps_and_checks_make_no_request(self):
        self.assertFalse(_run([(G12, "sun")], [(G12, "sweep")], [G12]))

    def test_other_weeks_still_pull(self):
        self.assertTrue(_run([(G13, "mon")], [], []))
        self.assertTrue(_run([], [], [G13]))

    def test_graded_pregame_pull_for_week_12_still_runs(self):
        self.assertTrue(_run([], [], [], due=[G12]))


if __name__ == "__main__":
    unittest.main()
