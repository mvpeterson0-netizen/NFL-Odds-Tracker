"""CFB weekend graded-pull tests (2026-11-27). All data here is SYNTHETIC test stubs; they check logic only."""
import unittest
from datetime import datetime, timedelta, timezone

from pipeline import cfb_odds

NOW = datetime(2026, 11, 28, 17, 0, tzinfo=timezone.utc)


def game(mins):
    return {"game_id": "g1", "status": "scheduled", "kickoff": (NOW + timedelta(minutes=mins)).strftime("%Y-%m-%dT%H:%M:%SZ")}


class WeekendTests(unittest.TestCase):
    def test_no_early_first_pull_on_the_weekend(self):
        self.assertIsNone(cfb_odds.choose_pull(game(600), {}, NOW))

    def test_pregame_pull_still_made_in_window(self):
        self.assertEqual(cfb_odds.choose_pull(game(60), {}, NOW), ("pregame", 60))

    def test_no_second_pregame_pull(self):
        self.assertIsNone(cfb_odds.choose_pull(game(60), {"pregame_ok_utc": "x"}, NOW))

    def test_floor_lowered_then_restored(self):
        self.assertEqual(cfb_odds.credit_floor(NOW), 1000)
        self.assertEqual(cfb_odds.credit_floor(cfb_odds.WEEKEND_UNTIL), 3000)

    def test_normal_rules_after_the_weekend(self):
        later = cfb_odds.WEEKEND_UNTIL + timedelta(days=2)
        g = {"game_id": "g1", "status": "scheduled", "kickoff": (later + timedelta(hours=10)).strftime("%Y-%m-%dT%H:%M:%SZ")}
        self.assertEqual(cfb_odds.choose_pull(g, {}, later)[0], "first")

    def test_pick_key_uses_weekend_floor(self):
        def get(url, params):
            return "[]", {"x-requests-remaining": "1990"}, 200
        self.assertEqual(cfb_odds.pick_key(["k"], get, NOW)[2], 1990)
        with self.assertRaises(cfb_odds.Stop):
            cfb_odds.pick_key(["k"], get, cfb_odds.WEEKEND_UNTIL)


if __name__ == "__main__":
    unittest.main()
