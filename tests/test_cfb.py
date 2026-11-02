"""CFB backend tests. All data here is SYNTHETIC test stubs (not real games or lines); they check logic only."""
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from pipeline import cfb, cfb_history, cfb_odds
from pipeline.cfb_store import MemoryStore, StoreError

NOW = datetime(2026, 11, 4, 14, tzinfo=timezone.utc)
KO = NOW + timedelta(days=3)


def ev(i, home="Alpha Tigers", away="Beta Bears", hc="5", ac="99", state="pre", completed=False, date=None, hid="1", aid="2"):
    return {"id": i, "date": (date or KO).strftime("%Y-%m-%dT%H:%MZ"), "week": {"number": 10},
            "status": {"type": {"state": state, "completed": completed}},
            "competitions": [{"competitors": [
                {"homeAway": "home", "score": "21", "team": {"id": hid, "displayName": home, "conferenceId": hc}},
                {"homeAway": "away", "score": "14", "team": {"id": aid, "displayName": away, "conferenceId": ac}}]}]}


def game(**kw):
    g = cfb.parse_event(ev("g1", **kw))
    return g


def odds_json(players=(("QB One", 250.5),)):
    outs = []
    for n, pt in players:
        outs += [{"name": "Over", "description": n, "price": -115, "point": pt}, {"name": "Under", "description": n, "price": -105, "point": pt}]
    return {"id": "oe1", "bookmakers": [{"key": "draftkings", "markets": [{"key": "player_pass_yds", "last_update": "2026-11-04T14:00:00Z", "outcomes": outs}]}]}


class ParseTests(unittest.TestCase):
    def test_p4_filter(self):
        self.assertEqual(cfb.parse_event(ev("1", hc="8"))["conference"], "SEC")
        self.assertEqual(cfb.parse_event(ev("1", hc="99", ac="1"))["conference"], "ACC")   # P4 visitor counts
        self.assertEqual(cfb.parse_event(ev("1", home="Notre Dame Fighting Irish", hc="18", hid="87"))["conference"], "Notre Dame")
        self.assertIsNone(cfb.parse_event(ev("1", hc="99", ac="98")))

    def test_status_and_scores(self):
        g = cfb.parse_event(ev("1", state="post", completed=True))
        self.assertEqual((g["status"], g["home_score"], g["away_score"]), ("final", 21, 14))
        g = cfb.parse_event(ev("1"))
        self.assertEqual((g["status"], g["home_score"]), ("scheduled", None))

    def test_summary(self):
        doc = {"boxscore": {"players": [{"team": {"displayName": "Alpha Tigers"}, "statistics": [
            {"name": "passing", "keys": ["completions/passingAttempts", "passingYards"], "athletes": [
                {"athlete": {"id": "9", "displayName": "QB One"}, "stats": ["20/30", "1,234"]}]},
            {"name": "rushing", "keys": ["rushingAttempts", "rushingYards"], "athletes": [
                {"athlete": {"id": "9", "displayName": "QB One"}, "stats": ["5", "--"]}]},
            {"name": "punting", "keys": [], "athletes": []}]}]}}
        r = cfb.parse_summary(doc)["9"]
        self.assertEqual((r["pass_cmp"], r["pass_att"], r["pass_yds"], r["rush_att"], r["rush_yds"]), (20, 30, 1234, 5, None))


class OddsTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.g = game()
        self.store.upsert("cfb_games", [dict(self.g)], "game_id")
        self.calls = []

    def fake(self, props=True, left="19000"):
        def get(url, params):
            self.calls.append(url)
            h = {"x-requests-remaining": left, "x-requests-last": "1"}
            if url.endswith("/events"):
                return json.dumps([{"id": "oe1", "home_team": "Alpha Tigers", "away_team": "Beta Bears",
                                    "commence_time": KO.strftime("%Y-%m-%dT%H:%M:%SZ")}]).encode(), h, 200
            body = odds_json() if props else {"id": "oe1", "bookmakers": []}
            return json.dumps(body).encode(), h, 200
        return get

    def test_empty_check_counts_and_then_first_pull_once(self):
        log = []
        cfb_odds.run(self.store, ["k"], [dict(self.g)], log, NOW, self.fake(props=False))
        st = self.store.t["cfb_pull_state"][0]
        self.assertEqual(st["empty_checks"], 1)
        self.assertNotIn("cfb_lines", self.store.t)
        cfb_odds.run(self.store, ["k"], [dict(self.g)], log, NOW + timedelta(minutes=5), self.fake())
        self.assertEqual(len(self.store.t["cfb_lines"]), 1)   # one book/market/player/line row
        self.assertEqual(self.store.t["cfb_lines"][0]["pull_type"], "first")
        n = len(self.calls)
        cfb_odds.run(self.store, ["k"], [dict(self.g)], log, NOW + timedelta(minutes=10), self.fake())
        self.assertEqual([c for c in self.calls[n:] if "/odds" in c], [])     # not pulled again before the window

    def test_pregame_window_pull_once(self):
        self.store.upsert("cfb_pull_state", [{"game_id": "g1", "first_ok_utc": iso_(NOW)}], "game_id")
        t = KO - timedelta(minutes=60)
        cfb_odds.run(self.store, ["k"], [dict(self.g)], [], t, self.fake())
        self.assertEqual(self.store.t["cfb_lines"][0]["pull_type"], "pregame")
        n = len(self.calls)
        cfb_odds.run(self.store, ["k"], [dict(self.g)], [], t + timedelta(minutes=5), self.fake())
        self.assertEqual([c for c in self.calls[n:] if "/odds" in c], [])

    def test_late_first_posting_counts_as_pregame(self):
        cfb_odds.run(self.store, ["k"], [dict(self.g)], [], KO - timedelta(minutes=60), self.fake())
        st = self.store.t["cfb_pull_state"][0]
        self.assertTrue(st["first_ok_utc"] and st["pregame_ok_utc"])

    def test_beyond_horizon_and_low_balance_spend_nothing(self):
        cfb_odds.run(self.store, ["k"], [dict(self.g)], [], NOW - timedelta(days=2), self.fake())
        self.assertEqual(self.calls, [])
        log = []
        cfb_odds.run(self.store, ["k"], [dict(self.g)], log, NOW, self.fake(left="2500"))
        self.assertFalse([c for c in self.calls if "/odds" in c])

    def test_started_game_skipped(self):
        cfb_odds.run(self.store, ["k"], [dict(self.g)], [], KO + timedelta(minutes=1), self.fake())
        self.assertEqual(self.calls, [])


def iso_(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


class ResultsTests(unittest.TestCase):
    def test_fetch_once_then_refetch_rules(self):
        store = MemoryStore()
        g = cfb.parse_event(ev("g1", state="post", completed=True, date=NOW - timedelta(hours=5)))
        store.upsert("cfb_games", [dict(g)], "game_id")
        doc = {"boxscore": {"players": [{"team": {"displayName": "Alpha Tigers"}, "statistics": [
            {"name": "rushing", "keys": ["rushingAttempts", "rushingYards"], "athletes": [
                {"athlete": {"id": "7", "displayName": "RB One"}, "stats": ["10", "55"]}]}]}]}}
        n = []
        gj = lambda url: (n.append(url), doc)[1]  # noqa: E731
        self.assertEqual(cfb.refresh_results(store, [g], [], NOW, gj), 1)
        self.assertEqual(store.t["cfb_results"][0]["rush_yds"], 55)
        self.assertEqual(cfb.refresh_results(store, [g], [], NOW + timedelta(hours=1), gj), 0)   # < 2 h
        self.assertEqual(cfb.refresh_results(store, [g], [], NOW + timedelta(hours=3), gj), 1)   # correction check
        self.assertEqual(cfb.refresh_results(store, [g], [], NOW + timedelta(hours=9), gj), 0)   # fetched after kickoff+7h: frozen
        self.assertEqual(len(n), 2)


class HistoryTests(unittest.TestCase):
    def test_off_without_weeks_and_no_double_download(self):
        store = MemoryStore()
        g = cfb.parse_event(ev("g1", state="post", completed=True, date=NOW - timedelta(days=4)))
        g["week"] = 9
        store.upsert("cfb_games", [g], "game_id")
        calls = []

        def get(url, params):
            calls.append(url)
            h = {"x-requests-remaining": "19000", "x-requests-last": "30"}
            if url.endswith("/events"):
                return json.dumps({"data": [{"id": "oe1", "home_team": "Alpha Tigers", "away_team": "Beta Bears",
                                             "commence_time": g["kickoff"]}]}).encode(), h, 200
            return json.dumps({"timestamp": iso_(NOW - timedelta(days=4, hours=1)), "data": odds_json()}).encode(), h, 200
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}):
            self.assertEqual(cfb_history.run(store, "k", [], NOW, get, weeks=[]), 0)
            self.assertEqual(calls, [])
            self.assertEqual(cfb_history.run(store, "k", [], NOW, get, weeks=[9]), 1)
            self.assertEqual(store.t["cfb_lines"][0]["source"], "The Odds API (historical)")
            n = len(calls)
            self.assertEqual(cfb_history.run(store, "k", [], NOW, get, weeks=[9]), 0)
            self.assertEqual(len(calls), n)

    def test_floor_blocks_spend(self):
        store = MemoryStore()
        g = cfb.parse_event(ev("g1", state="post", completed=True, date=NOW - timedelta(days=4)))
        g["week"] = 9
        store.upsert("cfb_games", [g], "game_id")
        calls = []

        def get(url, params):
            calls.append(url)
            return b'{"data":[]}', {"x-requests-remaining": "15010"}, 200
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}):
            cfb_history.run(store, "k", [], NOW, get, weeks=[9])
        self.assertFalse([c for c in calls if "/odds" in c])


class RunIsolationTests(unittest.TestCase):
    def test_failures_never_raise_and_no_key_skips(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(cfb.run([], []))
        store = MemoryStore()
        store.fail_on = {"cfb_games"}
        log = []
        with patch.object(cfb, "_get_json", return_value={"week": {"number": 10}, "events": [ev("g1")]}):
            self.assertFalse(cfb.run([], log, store=store, now=NOW))
        self.assertTrue(any("skipped" in x for x in log))


if __name__ == "__main__":
    unittest.main()
