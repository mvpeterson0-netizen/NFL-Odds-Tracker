"""Tests of the parsing and aggregation logic only, on SYNTHETIC station text written for the tests (not real observations).
The network calls (IEM, nflverse) are not exercised here."""
import unittest
from datetime import datetime, timezone

from research import metar_backfill as m

HEADER = "station,valid,lon,lat,tmpf,sknt,gust,p01i,vsby,wxcodes\n"
KO = datetime(2026, 1, 4, 18, 0, tzinfo=timezone.utc)


def text(rows):
    return HEADER + "\n".join(",".join(r) for r in rows) + "\n"


class Parse(unittest.TestCase):
    def test_parses_values_and_missing(self):
        obs = m.parse_obs(text([["BUF", "2026-01-04 18:51", "-78.73", "42.94", "31", "15", "25", "0.10", "2", "-SN BR"],
                                ["BUF", "2026-01-04 17:51", "-78.73", "42.94", "M", "M", "M", "M", "M", "M"]]))
        self.assertEqual([o["time"].hour for o in obs], [17, 18])  # sorted by time
        self.assertIsNone(obs[0]["tmpf"])
        self.assertEqual(obs[1]["p01i"], 0.10)
        self.assertEqual(obs[1]["wx"], "-SN BR")
        self.assertEqual(obs[0]["wx"], "")
        self.assertAlmostEqual(obs[1]["lat"], 42.94)


class Summarize(unittest.TestCase):
    def obs(self):
        return m.parse_obs(text([
            ["X", "2026-01-04 17:51", "-1", "40", "30", "5", "M", "0.50", "5", "M"],            # before kickoff: ignored
            ["X", "2026-01-04 18:51", "-1", "40", "31", "10", "M", "0.10", "3", "-RA"],
            ["X", "2026-01-04 18:58", "-1", "40", "31", "12", "20", "0.15", "2", "RA"],        # special: same hour, larger running value
            ["X", "2026-01-04 19:51", "-1", "40", "32", "20", "35", "0.30", "0.5", "+SN"],
            ["X", "2026-01-04 20:51", "-1", "40", "32", "8", "M", "0.00", "10", "M"],
            ["X", "2026-01-04 23:51", "-1", "40", "32", "8", "M", "9.00", "10", "M"],          # after the window: ignored
        ]))

    def test_hourly_max_is_summed_not_double_counted(self):
        s = m.summarize(self.obs(), KO)
        self.assertEqual(s["precip_hrs"], "0.15;0.30;0.00")
        self.assertEqual(s["precip_in"], "0.45")
        self.assertEqual(s["precip_peak_hr_in"], "0.30")
        self.assertEqual(s["n_obs"], "4")

    def test_wind_gust_conversion_and_codes(self):
        s = m.summarize(self.obs(), KO)
        self.assertEqual(s["wind_mph_max"], "23")     # 20 kt = 23.0 mph
        self.assertEqual(s["gust_mph_max"], "40")     # 35 kt = 40.3 mph
        self.assertEqual(s["snow_seen"], "1")
        self.assertEqual(s["freezing_seen"], "0")
        self.assertEqual(s["vsby_min_mi"], "0.5")
        self.assertEqual(s["precip_obs_frac"], "0.75")  # 3 of 4 reports show rain or snow

    def test_no_reports_in_window_gives_none(self):
        self.assertIsNone(m.summarize(self.obs(), datetime(2026, 1, 10, 18, 0, tzinfo=timezone.utc)))


class Helpers(unittest.TestCase):
    def test_kickoff_is_converted_from_eastern(self):
        self.assertEqual(m.kickoff_utc("2026-01-04", "13:00"), datetime(2026, 1, 4, 18, 0, tzinfo=timezone.utc))
        self.assertEqual(m.kickoff_utc("2026-09-10", "20:20"), datetime(2026, 9, 11, 0, 20, tzinfo=timezone.utc))  # EDT
        self.assertIsNone(m.kickoff_utc("", ""))

    def test_distance(self):
        self.assertAlmostEqual(m.miles(0, 0, 0, 1), 69.1, delta=0.2)
        self.assertEqual(m.miles(42.0, -78.0, 42.0, -78.0), 0.0)

    def test_every_listed_home_team_has_a_known_stadium_or_is_oak(self):
        for team in m.STATION_BY_HOME:
            if team != "OAK":
                self.assertIn(m.HOME_STADIUM[team], m.STADIUMS)


if __name__ == "__main__":
    unittest.main()
