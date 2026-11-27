import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from pipeline import weather
from pipeline.common import iso, read_csv, write_csv

KO = datetime(2026, 11, 27, 1, 20, tzinfo=timezone.utc)


def series(ko, precip, snow=None, codes=None, first=-1, last=4):
    """Synthetic hourly series for tests of the code only (not real weather): hours first..last around the kickoff hour."""
    start = ko.replace(minute=0, second=0, microsecond=0)
    out = {}
    for n, i in enumerate(range(first, last + 1)):
        t = (start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M")
        out[t] = {"temperature_2m": 33.0, "wind_speed_10m": 18.0, "wind_gusts_10m": 42.0, "precipitation": precip[n],
                  "snowfall": None if snow is None else snow[n], "weather_code": None if codes is None else codes[n]}
    return out


class Window(unittest.TestCase):
    def test_keeps_six_hours_and_sums_the_game_window(self):
        s = series(KO, [0.05, 0.10, 0.20, 0.30, 0.40, 0.50], snow=[0, 0.1, 0.1, 0.1, 0.1, 0.9],
                   codes=[61, 63, 65, 73, 75, 3])
        w = weather._window(s, KO)
        self.assertEqual(w["precip_in"], "1.0")  # kickoff hour + next 3 only: 0.10+0.20+0.30+0.40
        self.assertEqual(w["precip_hrs"], "0.05;0.1;0.2;0.3;0.4;0.5")
        self.assertEqual(w["snow_in"], "0.4")  # same 4-hour window as precip_in
        self.assertEqual(w["wcode_hrs"], "61;63;65;73;75;3")

    def test_outer_hours_missing_leaves_blanks_but_window_still_works(self):
        s = series(KO, [0.0, 0.1, 0.2, 0.3], first=0, last=3)
        w = weather._window(s, KO)
        self.assertEqual(w["precip_in"], "0.6")
        self.assertEqual(w["precip_hrs"], ";0.0;0.1;0.2;0.3;")  # hour before and the 4th hour after are blank
        self.assertEqual(w["snow_in"], "")  # no snowfall in the data: blank, not zero
        self.assertEqual(w["wcode_hrs"], ";;;;;")

    def test_incomplete_game_window_is_still_none(self):
        s = series(KO, [0.0, 0.1, 0.2], first=0, last=2)
        self.assertIsNone(weather._window(s, KO))


class Fetch(unittest.TestCase):
    def body(self, extra):
        h = {"time": ["2026-11-27T01:00"], "temperature_2m": [33.0], "precipitation": [0.1],
             "wind_speed_10m": [18.0], "wind_gusts_10m": [42.0]}
        if extra:
            h.update({"snowfall": [0.0], "weather_code": [61]})
        return json.dumps({"hourly": h}).encode()

    def test_asks_for_snow_and_codes(self):
        with mock.patch.object(weather, "http_get", return_value=(self.body(True), {}, 200)) as g:
            out = weather._fetch("u", 1, 2, KO, KO, True)
        self.assertIn("snowfall", g.call_args[0][1]["hourly"])
        self.assertIn("weather_code", g.call_args[0][1]["hourly"])
        self.assertEqual(out["2026-11-27T01:00"]["weather_code"], 61)

    def test_falls_back_to_original_variables_on_http_400(self):
        calls = []

        def fake(url, params, timeout, retries):
            calls.append(params["hourly"])
            return (b"bad", {}, 400) if "snowfall" in params["hourly"] else (self.body(False), {}, 200)
        with mock.patch.object(weather, "http_get", side_effect=fake):
            out = weather._fetch("u", 1, 2, KO, KO, False)
        self.assertEqual(len(calls), 2)
        self.assertNotIn("snowfall", calls[1])
        self.assertEqual(out["2026-11-27T01:00"]["precipitation"], 0.1)

    def test_other_errors_are_not_retried_without_extras(self):
        with mock.patch.object(weather, "http_get", return_value=(b"x", {}, 500)) as g:
            with self.assertRaises(RuntimeError):
                weather._fetch("u", 1, 2, KO, KO, False)
        self.assertEqual(g.call_count, 1)


class Refresh(unittest.TestCase):
    def test_new_columns_stored_and_old_columns_and_rows_untouched(self):
        game = {"game_id": "2026_12_KC_BUF", "kickoff_utc": iso(KO), "stadium": "Highmark Stadium"}
        old_row = {"game_id": "2026_01_OLD_ROW", "stadium": "Lumen Field", "roof": "open", "obs_temp_f": "60",
                   "obs_wind_mph": "5", "obs_precip_in": "0.0", "note": ""}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weather.csv"
            write_csv(path, [old_row], weather.FIELDS[:20])  # the file as it was before this change (20 columns)
            s = series(KO, [0.1] * 6, snow=[0.0] * 6, codes=[61] * 6)
            now = KO - timedelta(minutes=19)
            with mock.patch.object(weather, "WEATHER_PATH", path), mock.patch.object(weather, "utcnow", return_value=now), \
                    mock.patch.object(weather, "_fetch", return_value=s):
                weather.refresh([game], [])
            rows = {r["game_id"]: r for r in read_csv(path)}
            r = rows["2026_12_KC_BUF"]
            self.assertEqual(r["fc_precip_in"], "0.4")
            self.assertEqual(r["pre_precip_in"], "0.4")  # the original columns behave as before
            self.assertEqual(r["pre_precip_hrs"], "0.1;0.1;0.1;0.1;0.1;0.1")
            self.assertEqual(r["fc_wcode_hrs"], "61;61;61;61;61;61")
            old = rows["2026_01_OLD_ROW"]
            self.assertEqual((old["obs_temp_f"], old["obs_wind_mph"], old["obs_precip_in"]), ("60", "5", "0.0"))
            self.assertEqual(old["obs_precip_hrs"], "")  # existing rows are not rewritten with invented hourly values

    def test_original_columns_keep_their_order(self):
        self.assertEqual(weather.FIELDS[:20], ["game_id", "stadium", "roof", "fc_fetched_utc", "fc_temp_f", "fc_wind_mph",
            "fc_gust_mph", "fc_precip_in", "fc_precip_prob", "obs_fetched_utc", "obs_temp_f", "obs_wind_mph", "obs_gust_mph",
            "obs_precip_in", "note", "pre_fetched_utc", "pre_temp_f", "pre_wind_mph", "pre_gust_mph", "pre_precip_in"])


class ObservedFill(unittest.TestCase):
    """Games observed before hourly detail existed get only the three new columns, once; stored values are never changed."""
    PAST = datetime(2026, 11, 1, 18, 0, tzinfo=timezone.utc)
    NOW = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)

    def setup_file(self, tmp, **extra):
        row = {"game_id": "2026_08_X_BUF", "stadium": "Highmark Stadium", "roof": "open", "obs_fetched_utc": "2026-11-08T00:00:00Z",
               "obs_temp_f": "41", "obs_wind_mph": "9", "obs_gust_mph": "20", "obs_precip_in": "0.12", "note": ""}
        row.update(extra)
        path = Path(tmp) / "weather.csv"
        write_csv(path, [row], weather.FIELDS)
        return path

    def run_refresh(self, path, series_by_call):
        game = {"game_id": "2026_08_X_BUF", "kickoff_utc": iso(self.PAST), "stadium": "Highmark Stadium"}
        with mock.patch.object(weather, "WEATHER_PATH", path), mock.patch.object(weather, "utcnow", return_value=self.NOW), \
                mock.patch.object(weather, "_fetch", return_value=series_by_call) as f:
            log = []
            weather.refresh([game], log)
        return f, log

    def test_fills_new_columns_and_leaves_stored_values_alone(self):
        s = series(self.PAST, [0.0, 0.02, 0.04, 0.03, 0.03, 0.0], snow=[0.0] * 6, codes=[3, 61, 61, 61, 3, 3])
        for v in s.values():
            v["temperature_2m"], v["wind_speed_10m"], v["precipitation"] = 99.0, 99.0, v["precipitation"]  # archive "revised"
        with tempfile.TemporaryDirectory() as tmp:
            path = self.setup_file(tmp)
            f, log = self.run_refresh(path, s)
            r = read_csv(path)[0]
            self.assertEqual((r["obs_temp_f"], r["obs_wind_mph"], r["obs_gust_mph"], r["obs_precip_in"]), ("41", "9", "20", "0.12"))
            self.assertEqual(r["obs_fetched_utc"], "2026-11-08T00:00:00Z")
            self.assertEqual(r["obs_precip_hrs"], "0.0;0.02;0.04;0.03;0.03;0.0")
            self.assertEqual(r["obs_wcode_hrs"], "3;61;61;61;3;3")
            self.assertEqual(r["obs_snow_in"], "0.0")
            self.assertTrue(any("hourly detail filled for 1" in l for l in log))
            self.assertEqual(f.call_count, 1)

    def test_not_repeated_once_filled(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.setup_file(tmp, obs_precip_hrs="0.0;0.0;0.0;0.0;0.0;0.0")
            f, _ = self.run_refresh(path, {})
            self.assertEqual(f.call_count, 0)

    def test_unavailable_window_is_marked_and_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.setup_file(tmp)
            self.run_refresh(path, {})  # archive returned nothing for the game
            self.assertEqual(read_csv(path)[0]["obs_precip_hrs"], "na")
            f, _ = self.run_refresh(path, {})
            self.assertEqual(f.call_count, 0)

    def test_not_filled_before_the_archive_delay(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.setup_file(tmp)
            game = {"game_id": "2026_08_X_BUF", "kickoff_utc": iso(self.NOW - timedelta(days=3)), "stadium": "Highmark Stadium"}
            with mock.patch.object(weather, "WEATHER_PATH", path), mock.patch.object(weather, "utcnow", return_value=self.NOW), \
                    mock.patch.object(weather, "_fetch", return_value={}) as f:
                weather.refresh([game], [])
            self.assertEqual(f.call_count, 0)

    def test_at_most_ten_stadiums_per_run(self):
        names = [n for n, v in weather.STADIUMS.items() if v[2] != "dome"][:14]
        games = [{"game_id": f"2026_08_{i}", "kickoff_utc": iso(self.PAST), "stadium": n} for i, n in enumerate(names)]
        rows = [{"game_id": g["game_id"], "stadium": g["stadium"], "roof": "open", "obs_temp_f": "50", "obs_wind_mph": "5",
                 "obs_precip_in": "0.0", "obs_fetched_utc": "2026-11-08T00:00:00Z", "note": ""} for g in games]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weather.csv"
            write_csv(path, rows, weather.FIELDS)
            with mock.patch.object(weather, "WEATHER_PATH", path), mock.patch.object(weather, "utcnow", return_value=self.NOW), \
                    mock.patch.object(weather, "_fetch", return_value=series(self.PAST, [0.0] * 6)) as f:
                weather.refresh(games, [])
            self.assertEqual(f.call_count, 10)
            left = [r for r in read_csv(path) if not r["obs_precip_hrs"]]
            self.assertEqual(len(left), 4)  # the rest are filled on later runs


if __name__ == "__main__":
    unittest.main()
