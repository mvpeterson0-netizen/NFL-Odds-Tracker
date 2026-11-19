"""2-hour line check and Michael's "2-hour lines are live" alert (2026-11-19). All data here is SYNTHETIC test stubs (made-up games and times); they check logic only."""
import unittest
from datetime import datetime, timedelta, timezone

from pipeline import notify, odds

KO = datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc)
iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
GAMES = {"G1": {"ko": iso(KO), "away": "TB", "home": "DET"}, "G2": {"ko": iso(KO), "away": "LA", "home": "SEA"}}


class TwoHourCheck(unittest.TestCase):
    def test_target_two_hours_before(self):
        self.assertEqual(odds.track_target(KO, KO - timedelta(minutes=118)), KO - timedelta(minutes=120))
        self.assertEqual(odds.track_target(KO, KO - timedelta(minutes=125)), KO - timedelta(minutes=150))
        self.assertEqual(odds.track_target(KO, KO - timedelta(minutes=59)), KO - timedelta(minutes=60))


class TwoHourAlert(unittest.TestCase):
    def rows(self, mins, status="ok", gid="G1"):
        return [{"game_id": gid, "status": status, "attempted_utc": iso(KO - timedelta(minutes=mins))}]

    def test_due_after_two_hour_pull(self):
        now = KO - timedelta(minutes=116)
        due = notify.two_hour_due(self.rows(117) + self.rows(118, gid="G2"), GAMES, {}, now)
        self.assertEqual([x["gid"] for x in due], ["G1", "G2"])
        title, body = notify.two_hour_message(due)
        self.assertIn("TB @ DET", title)
        self.assertIn("LAR @ SEA", title)  # same display relabel as the app
        self.assertIn("kickoff 12:00 PM CT", body)

    def test_not_due(self):
        now = KO - timedelta(minutes=100)
        self.assertEqual(notify.two_hour_due(self.rows(150), GAMES, {}, now), [])  # 2:30 check
        self.assertEqual(notify.two_hour_due(self.rows(60), GAMES, {}, now - timedelta(minutes=0)), [])  # 1:00 check
        self.assertEqual(notify.two_hour_due(self.rows(117, "empty"), GAMES, {}, now), [])  # nothing came back
        self.assertEqual(notify.two_hour_due(self.rows(117), GAMES, {"G1": {}}, now), [])  # already alerted
        self.assertEqual(notify.two_hour_due(self.rows(117), GAMES, {}, KO + timedelta(minutes=1)), [])  # kicked off


if __name__ == "__main__":
    unittest.main()
