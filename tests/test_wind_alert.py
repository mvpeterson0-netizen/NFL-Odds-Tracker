import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from pipeline import notify, weather
from pipeline.common import iso, read_csv

KO = datetime(2026, 11, 26, 1, 20, tzinfo=timezone.utc)  # a Thursday-night kickoff


def series_for(ko, wind):
    start = ko.replace(minute=0, second=0, microsecond=0)
    out = {}
    for i in range(4):
        t = (start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M")
        out[t] = {"temperature_2m": 40.0, "wind_speed_10m": wind, "wind_gusts_10m": wind + 8,
                  "precipitation": 0.0, "precipitation_probability": 10}
    return out


class PreWindow(unittest.TestCase):
    def test_window_is_22_to_3_minutes_before_kickoff(self):
        row = {}
        self.assertFalse(weather.pre_due(KO, KO - timedelta(minutes=23), row))
        self.assertTrue(weather.pre_due(KO, KO - timedelta(minutes=22), row))
        self.assertTrue(weather.pre_due(KO, KO - timedelta(minutes=17), row))
        self.assertTrue(weather.pre_due(KO, KO - timedelta(minutes=4), row))
        self.assertFalse(weather.pre_due(KO, KO - timedelta(minutes=3), row))
        self.assertFalse(weather.pre_due(KO, KO + timedelta(minutes=5), row))

    def test_taken_once_then_frozen(self):
        self.assertFalse(weather.pre_due(KO, KO - timedelta(minutes=18), {"pre_wind_mph": "18"}))


class PreReading(unittest.TestCase):
    def run_refresh(self, tmp, now, wind):
        game = {"game_id": "2026_12_KC_BUF", "kickoff_utc": iso(KO), "stadium": "Highmark Stadium"}
        with mock.patch.object(weather, "WEATHER_PATH", Path(tmp) / "weather.csv"), \
                mock.patch.object(weather, "utcnow", return_value=now), \
                mock.patch.object(weather, "_fetch", return_value=series_for(KO, wind)) as f:
            log = []
            weather.refresh([game], log)
            return f, read_csv(Path(tmp) / "weather.csv")[0]

    def test_reading_stored_in_window_and_kept(self):
        with tempfile.TemporaryDirectory() as tmp:
            f, row = self.run_refresh(tmp, KO - timedelta(minutes=19), 18)
            self.assertEqual(row["pre_wind_mph"], "18")
            self.assertEqual(row["pre_fetched_utc"], iso(KO - timedelta(minutes=19)))
            # a later run inside the window does not overwrite the frozen reading
            f2, row2 = self.run_refresh(tmp, KO - timedelta(minutes=10), 3)
            self.assertEqual(row2["pre_wind_mph"], "18")
            self.assertEqual(row2["pre_fetched_utc"], row["pre_fetched_utc"])

    def test_no_reading_outside_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, row = self.run_refresh(tmp, KO - timedelta(hours=5), 18)
            self.assertEqual(row.get("pre_wind_mph", ""), "")
            self.assertNotEqual(row["fc_wind_mph"], "")  # the ordinary 3-hour forecast still runs


class WindAlert(unittest.TestCase):
    now = KO - timedelta(minutes=15)
    games = {"2026_12_KC_BUF": {"ko": iso(KO), "away": "KC", "home": "BUF"}}

    def wx(self, **kw):
        base = {"roof": "open", "pre_wind_mph": "16", "pre_fetched_utc": iso(KO - timedelta(minutes=19))}
        base.update(kw)
        return {"2026_12_KC_BUF": base}

    def test_fires_at_15_or_more_outdoors(self):
        self.assertEqual(len(notify.wind_due(self.wx(), self.games, {}, self.now)), 1)
        self.assertEqual(len(notify.wind_due(self.wx(pre_wind_mph="15"), self.games, {}, self.now)), 1)

    def test_quiet_below_15(self):
        self.assertEqual(notify.wind_due(self.wx(pre_wind_mph="14"), self.games, {}, self.now), [])

    def test_quiet_for_dome_retractable_or_no_reading(self):
        for roof in ("dome", "retractable"):
            self.assertEqual(notify.wind_due(self.wx(roof=roof), self.games, {}, self.now), [])
        self.assertEqual(notify.wind_due(self.wx(pre_wind_mph=""), self.games, {}, self.now), [])

    def test_once_per_game_and_never_after_kickoff(self):
        self.assertEqual(notify.wind_due(self.wx(), self.games, {"2026_12_KC_BUF": {}}, self.now), [])
        self.assertEqual(notify.wind_due(self.wx(), self.games, {}, KO + timedelta(minutes=1)), [])

    def test_message_names_game_and_wind(self):
        due = notify.wind_due(self.wx(pre_wind_mph="18"), self.games, {}, self.now)
        title, body = notify.wind_message(due)
        self.assertIn("KC @ BUF 18 mph", title)
        self.assertIn("Indicators", body)


if __name__ == "__main__":
    unittest.main()
