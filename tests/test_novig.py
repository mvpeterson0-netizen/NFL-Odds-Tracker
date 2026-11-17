"""Novig tests. All data here is SYNTHETIC test stubs (made-up players, lines and prices); they check logic only."""
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline import build, notify, odds
from pipeline.common import append_csv

NOW = datetime(2026, 11, 17, 16, tzinfo=timezone.utc)
KO = NOW + timedelta(days=3)


def row(book, line, over, under, player="Test Receiver", market="player_reception_yds", gsis="00-0000001"):
    return {"game_id": "2026_11_AAA_BBB", "event_id": "e1", "pull_type": "track", "captured_utc": "2026-11-17T16:00:00Z",
            "kickoff_utc": "2026-11-20T01:15:00Z", "minutes_before_kickoff": 100, "in_window": "n/a", "book": book,
            "market": market, "player_book_name": player, "gsis_id": gsis, "line": line, "over_price": over,
            "under_price": under, "book_last_update": "", "source": "The Odds API"}


class BookListTests(unittest.TestCase):
    def test_nfl_list_swaps_caesars_for_novig_and_stays_ten(self):
        self.assertIn("novig", odds.NFL_EXTRA_BOOKS)
        self.assertNotIn("williamhill_us", odds.NFL_EXTRA_BOOKS)
        self.assertEqual(len(odds.BOOKS + odds.NFL_EXTRA_BOOKS), 10)  # one request group (same credits)

    def test_shared_list_for_cfb_and_2025_history_is_unchanged(self):
        self.assertIn("williamhill_us", odds.EXTRA_BOOKS)
        self.assertNotIn("novig", odds.EXTRA_BOOKS)


class NarrowTests(unittest.TestCase):
    def test_keeps_rungs_at_dk_fd_line_plus_tightest_and_drops_the_rest(self):
        rows = [row("draftkings", 30.5, -110, -114), row("fanduel", 29.5, -114, -114),
                row("novig", 9.5, -355, 239),            # thin: wide spread, not at a book line
                row("novig", 29.5, -125, -135),          # at FanDuel's line
                row("novig", 30.5, -128, -118),          # at DraftKings' line
                row("novig", 31.5, -104, -108),          # tightest overall
                row("novig", 40.5, 300, ""),             # one-sided: dropped
                row("betmgm", 30.5, -115, -115)]
        out = odds.narrow_novig(rows)
        self.assertEqual(sorted(r["line"] for r in out if r["book"] == "novig"), [29.5, 30.5, 31.5])
        self.assertEqual(sorted((r["book"], r["line"]) for r in out if r["book"] != "novig"),
                         [("betmgm", 30.5), ("draftkings", 30.5), ("fanduel", 29.5)])  # others untouched

    def test_player_without_dk_fd_line_keeps_only_tightest(self):
        out = odds.narrow_novig([row("novig", 20.5, -212, -217), row("novig", 22.5, -105, -112), row("novig", 25.5, 150, -190)])
        self.assertEqual([r["line"] for r in out], [22.5])

    def test_prices_are_stored_unchanged_as_american(self):
        out = odds.narrow_novig([row("draftkings", 30.5, -110, -114), row("novig", 30.5, -113, -113)])
        nv = [r for r in out if r["book"] == "novig"][0]
        self.assertEqual((nv["over_price"], nv["under_price"]), (-113, -113))


class BookLinesTests(unittest.TestCase):
    def run_book_lines(self, rows):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            (t / "other").mkdir()
            (t / "track").mkdir()
            append_csv(t / "other" / "week_11.csv", [r for r in rows if r["book"] not in ("draftkings", "fanduel")], odds.CAPTURE_FIELDS)
            append_csv(t / "caps.csv", [r for r in rows if r["book"] in ("draftkings", "fanduel")], odds.CAPTURE_FIELDS)
            games = {"2026_11_AAA_BBB": {"kickoff_utc": KO.strftime("%Y-%m-%dT%H:%M:%SZ"), "home_team": "BBB", "away_team": "AAA"}}
            with patch.object(odds, "OTHER_DIR", t / "other"), patch.object(odds, "TRACK_DIR", t / "track"), \
                    patch.object(build, "TRACK_DIR", t / "track"), patch.object(build, "CAPTURES_PATH", t / "caps.csv"):
                return build.book_lines({}, games, NOW)

    def test_novig_shown_at_draftkings_line_even_when_another_rung_is_more_balanced(self):
        rows = [row("draftkings", 30.5, -110, -114), row("fanduel", 29.5, -114, -114),
                row("novig", 30.5, -128, -118), row("novig", 31.5, -104, -108), row("novig", 9.5, -355, 239)]
        out = self.run_book_lines(rows)["2026_11_AAA_BBB"]["p"]["00-0000001"]["rec_yds"]
        nv = [r for r in out if r[0] == "novig"]
        self.assertEqual(nv, [["novig", 30.5, -128.0, -118.0]])
        self.assertEqual(sorted(r[0] for r in out), ["draftkings", "fanduel", "novig"])  # one row per book

    def test_novig_without_dk_or_fd_uses_tightest_rung(self):
        rows = [row("betmgm", 30.5, -115, -115), row("novig", 22.5, -210, -215), row("novig", 24.5, -106, -112)]
        out = self.run_book_lines(rows)["2026_11_AAA_BBB"]["p"]["00-0000001"]["rec_yds"]
        self.assertEqual([r for r in out if r[0] == "novig"], [["novig", 24.5, -106.0, -112.0]])

    def test_sportsbook_selection_unchanged(self):
        rows = [row("betmgm", 30.5, -105, -125), row("betmgm", 32.5, -112, -113)]
        out = self.run_book_lines(rows)["2026_11_AAA_BBB"]["p"]["00-0000001"]["rec_yds"]
        self.assertEqual(out, [["betmgm", 32.5, -112.0, -113.0]])  # closest to even money, as before


class ArbitrageExclusionTests(unittest.TestCase):
    def test_novig_never_used_for_arbitrage_alerts(self):
        d = {"games": {"g": {"ko": KO.strftime("%Y-%m-%dT%H:%M:%SZ")}},
             "books": {"g": {"cap": "x", "p": {"p1": {"rec_yds": [["novig", 30.5, 150, -400], ["draftkings", 30.5, -400, 150]]}}}}}
        self.assertEqual(notify.arbs(d, NOW), [])           # would be a 'guaranteed profit' if Novig were allowed
        d["books"]["g"]["p"]["p1"]["rec_yds"][0][0] = "betmgm"
        self.assertEqual(len(notify.arbs(d, NOW)), 1)       # same prices between two sportsbooks still alert
        self.assertEqual(notify.BOOK_LABEL["novig"], "Novig")


if __name__ == "__main__":
    unittest.main()
