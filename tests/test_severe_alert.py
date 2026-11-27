import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from pipeline import notify
from pipeline.common import iso

KO = datetime(2026, 11, 27, 1, 20, tzinfo=timezone.utc)
GID = "2026_12_KC_BUF"
GAMES = {GID: {"ko": iso(KO), "away": "KC", "home": "BUF"}}


def wx(**kw):
    base = {"roof": "open", "fc_temp_f": "33", "fc_wind_mph": "23", "fc_gust_mph": "46", "fc_precip_in": "0.48",
            "fc_fetched_utc": iso(KO - timedelta(hours=3))}
    base.update(kw)
    return {GID: base}


PRE = dict(pre_temp_f="33", pre_wind_mph="18", pre_gust_mph="42", pre_precip_in="1.24",
           pre_fetched_utc=iso(KO - timedelta(minutes=20)))


class Rule(unittest.TestCase):
    def test_boundaries(self):
        c = notify.severe_candidate
        self.assertTrue(c(5, 10, 0.3))
        self.assertFalse(c(5, 10, 0.29))
        self.assertTrue(c(18, 20, 0.0))
        self.assertFalse(c(17, 20, 0.0))
        self.assertTrue(c(10, 35, 0.1))
        self.assertFalse(c(10, 35, 0.09))
        self.assertFalse(c(10, 34, 0.1))
        self.assertFalse(c(15, 30, 0.0))  # wind 15 / gust 30 alone is not "severe"


class Early(unittest.TestCase):
    now = KO - timedelta(hours=2)

    def due(self, rows, state=None, now=None):
        return notify.severe_due(rows, GAMES, state or {}, now or self.now)

    def test_fires_from_fresh_forecast_within_six_hours(self):
        d = self.due(wx())
        self.assertEqual([(x["gid"], x["stage"]) for x in d], [(GID, "early")])

    def test_quiet_more_than_six_hours_out(self):
        self.assertEqual(self.due(wx(), now=KO - timedelta(hours=6, minutes=1)), [])
        self.assertEqual(len(self.due(wx(), now=KO - timedelta(hours=6))), 1)

    def test_quiet_when_forecast_is_stale_or_incomplete(self):
        self.assertEqual(self.due(wx(fc_fetched_utc=iso(self.now - timedelta(hours=4, minutes=1)))), [])
        self.assertEqual(self.due(wx(fc_precip_in="")), [])

    def test_quiet_below_threshold(self):
        self.assertEqual(self.due(wx(fc_wind_mph="14", fc_gust_mph="30", fc_precip_in="0.00")), [])

    def test_quiet_for_dome_retractable_and_after_kickoff(self):
        for roof in ("dome", "retractable", ""):
            self.assertEqual(self.due(wx(roof=roof)), [])
        self.assertEqual(self.due(wx(), now=KO + timedelta(minutes=1)), [])

    def test_only_once(self):
        self.assertEqual(self.due(wx(), state={GID: {"early": "x", "ko": iso(KO)}}), [])


class Confirm(unittest.TestCase):
    now = KO - timedelta(minutes=18)

    def due(self, rows, state=None):
        return notify.severe_due(rows, GAMES, state or {}, self.now)

    def test_confirm_after_early(self):
        d = self.due(wx(**PRE), {GID: {"early": "x"}})
        self.assertEqual([x["stage"] for x in d], ["confirm"])

    def test_confirm_without_early_alert(self):
        self.assertEqual([x["stage"] for x in self.due(wx(**PRE))], ["confirm"])

    def test_confirm_only_once(self):
        self.assertEqual(self.due(wx(**PRE), {GID: {"early": "x", "confirm": "y"}}), [])

    def test_cleared_when_early_was_sent_but_reading_is_mild(self):
        mild = dict(PRE, pre_wind_mph="8", pre_gust_mph="14", pre_precip_in="0.02")
        d = self.due(wx(**mild), {GID: {"early": "x"}})
        self.assertEqual([x["stage"] for x in d], ["cleared"])
        self.assertEqual(self.due(wx(**mild), {GID: {"early": "x", "cleared": "z"}}), [])

    def test_mild_reading_without_early_is_silent(self):
        mild = dict(PRE, pre_wind_mph="8", pre_gust_mph="14", pre_precip_in="0.02")
        self.assertEqual(self.due(wx(**mild)), [])

    def test_pre_reading_wins_over_forecast(self):
        mild = dict(PRE, pre_wind_mph="8", pre_gust_mph="14", pre_precip_in="0.02")
        self.assertEqual(self.due(wx(**mild)), [])  # forecast says severe, the later reading does not: no early alert


class Message(unittest.TestCase):
    def test_names_game_and_numbers(self):
        due = notify.severe_due(wx(**PRE), GAMES, {}, KO - timedelta(minutes=18))
        title, body = notify.severe_message(due)
        self.assertIn("KC @ BUF", title)
        self.assertIn("candidate", title)
        self.assertIn("1.24 in", body)
        self.assertIn("not validated", body)


class Run(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = Path(self.tmp.name)
        (self.t / "data.json").write_text(json.dumps({"games": GAMES}))
        self.out = self.t / "gh_out"
        self.state = self.t / "state.json"

    def tearDown(self):
        self.tmp.cleanup()

    def run_it(self, env, now, rows):
        sd = self.t / "site" / "data"
        sd.mkdir(parents=True, exist_ok=True)
        (sd / "data.json").write_text(json.dumps({"games": GAMES}))
        log = []
        with mock.patch.object(notify, "SITE", self.t / "site"), mock.patch.object(notify, "SEVERE_STATE", self.state), \
                mock.patch.object(notify, "utcnow", return_value=now), mock.patch.dict(os.environ, env, clear=False), \
                mock.patch("pipeline.weather.load", return_value=rows):
            return notify.severe_run(log), log

    def test_writes_outputs_and_state_then_stays_quiet(self):
        env = {"NTFY_TOPIC": "t", "GITHUB_OUTPUT": str(self.out)}
        changed, log = self.run_it(env, KO - timedelta(hours=2), wx())
        self.assertTrue(changed)
        text = self.out.read_text()
        self.assertIn("sev_title=Stix severe weather candidate: KC @ BUF", text)
        self.assertEqual(list(json.loads(self.state.read_text())["alerted"][GID]), ["early", "ko"])
        changed2, _ = self.run_it(env, KO - timedelta(hours=1), wx())
        self.assertFalse(changed2)  # same game, same stage: not repeated

    def test_missing_topic_is_logged_not_silent_and_not_recorded(self):
        env = {"NTFY_TOPIC": "", "GITHUB_OUTPUT": str(self.out)}
        changed, log = self.run_it(env, KO - timedelta(hours=2), wx())
        self.assertFalse(changed)
        self.assertTrue(any("NTFY_TOPIC" in l for l in log))
        self.assertFalse(self.state.exists())

    def test_nothing_due_nothing_logged(self):
        env = {"NTFY_TOPIC": "t", "GITHUB_OUTPUT": str(self.out)}
        changed, log = self.run_it(env, KO - timedelta(hours=9), wx())
        self.assertFalse(changed)
        self.assertEqual(log, [])


if __name__ == "__main__":
    unittest.main()
