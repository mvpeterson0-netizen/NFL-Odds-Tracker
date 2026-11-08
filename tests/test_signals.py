import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline import signals as S
from pipeline.common import iso

NOW = datetime(2026, 11, 8, 15, 0, tzinfo=timezone.utc)
KO = NOW + timedelta(hours=2)


def sig(sid, side=None, fam=None, status=None):
    d = S.REGISTRY[sid]
    return {"id": sid, "family": fam or d["family"], "side": side or d["side"], "status": status or d["status"],
            "version": d["version"], "trigger": "t", "inputs": {}, "asof": iso(NOW)}


def out_with(spread_read=NOW - timedelta(hours=1)):
    return {"sources": {"schedule": {"fetched_utc": iso(spread_read), "last_updated": "x"}}}


class SpreadOrientation(unittest.TestCase):
    def test_home_favored_is_negative_for_home_positive_for_away(self):
        # nflverse spread_line = home favored by 10
        self.assertEqual(S.team_spread(10, "home"), -10)
        self.assertEqual(S.team_spread(10, "away"), 10)
        self.assertEqual(S.team_spread(-3, "home"), 3)
        self.assertEqual(S.team_spread(-3, "away"), -3)
        self.assertIsNone(S.team_spread(None, "home"))

    def test_spread_rules_fire_on_the_right_team(self):
        ids = lambda ts, pos, mid: {s[0] for s in S.spread_signals(pos, mid, ts)}
        self.assertEqual(ids(10, "WR", "rec_yds"), {"SP1"})
        self.assertEqual(ids(9.5, "WR", "rec_yds"), set())
        self.assertEqual(ids(10, "WR", "rec"), {"SP2"})
        self.assertEqual(ids(-10, "QB", "pass_yds"), {"SP3"})
        self.assertEqual(ids(10, "QB", "pass_yds"), {"SP4"})
        self.assertEqual(ids(6, "RB", "rush_yds"), {"SP5"})
        self.assertEqual(ids(-6, "RB", "rush_yds"), set())
        self.assertEqual(ids(7, "RB", "rush_yds"), set())
        self.assertEqual(ids(None, "RB", "rush_yds"), set())

    def test_lead_6_to_8_orientation(self):
        r = {"wk": 10, "ha": "home", "slot": "RB1"}
        q = {"line": 50.5}
        # home favored by 8 -> RB1 rush Under (L6)
        got = {x[0] for x in S.lead_signals("RB", r, "rush_yds", q, [], 8, True)}
        self.assertIn("L6", got)
        # same game, away team RB: team is the underdog -> no L6
        r2 = {"wk": 10, "ha": "away", "slot": "RB1"}
        self.assertNotIn("L6", {x[0] for x in S.lead_signals("RB", r2, "rush_yds", q, [], 8, True)})
        # away QB when home favored by 8: away is 8-pt underdog -> L7
        self.assertIn("L7", {x[0] for x in S.lead_signals("QB", r2, "pass_yds", q, [], 8, True)})
        # spread not ok -> no spread leads
        self.assertNotIn("L7", {x[0] for x in S.lead_signals("QB", r2, "pass_yds", q, [], 8, False)})


class Stacking(unittest.TestCase):
    def test_same_family_counts_once(self):
        st = S.stack_summary([sig("SP5"), sig("L6")])        # both game_script, both under
        self.assertEqual(st["under"]["testing"]["support"], 1)
        self.assertEqual(st["leads"]["under"], 1)

    def test_distinct_families_and_opposition(self):
        st = S.stack_summary([sig("SP5"), sig("L2"), sig("L4"), sig("L7")])   # L7 = game_script over -> mixed with SP5
        self.assertIn("game_script", st["mixed"]["testing"])
        self.assertEqual(st["under"]["testing"]["support"], 2)               # line_move + role_base_rate
        self.assertEqual(st["over"]["testing"]["support"], 0)
        self.assertEqual(st["over"]["testing"]["oppose"], 2)

    def test_context_never_counted_as_active(self):
        st = S.stack_summary([sig("WX1")])
        self.assertEqual(st["under"]["context"]["support"], 1)
        self.assertEqual(S.group_of(st, "under", "active")[0], None)
        st2 = S.stack_summary([sig("WX1"), sig("L2"), sig("L4")])
        self.assertEqual(S.group_of(st2, "under", "active"), ("2", 2, 0))

    def test_groups(self):
        mk = lambda ids: S.stack_summary([sig(i) for i in ids])
        self.assertEqual(S.group_of(mk(["L2"]), "under", "active")[0], "1")
        self.assertEqual(S.group_of(mk(["L2", "L4", "SP5"]), "under", "active")[0], "3+ clean")
        self.assertEqual(S.group_of(mk(["L2", "L4", "SP5", "L1"]), "under", "active")[0], "3+ clean")
        st = S.stack_summary([sig("L2"), sig("L4"), sig("SP5"), sig("L7")])
        self.assertEqual(S.group_of(st, "under", "active")[0], "2")   # game_script is mixed: not support
        # qualified basis ignores testing: nothing qualifies yet
        self.assertIsNone(S.group_of(mk(["L2", "L4", "SP5"]), "under", "qualified")[0])


class StaleInputs(unittest.TestCase):
    def test_spread_states(self):
        self.assertEqual(S._spread_state(out_with(), {"spread": 3}, NOW)[1], "ok")
        self.assertEqual(S._spread_state(out_with(NOW - timedelta(hours=37)), {"spread": 3}, NOW)[1], "stale")
        self.assertEqual(S._spread_state(out_with(), {}, NOW)[1], "missing")
        self.assertEqual(S._spread_state({}, {"spread": 3}, NOW)[1], "stale")

    def test_forecast_states(self):
        wx = lambda **k: {"wx": {"roof": "open", "fc_fetched_utc": iso(NOW - timedelta(hours=1)), "fc_temp_f": 40, "fc_wind_mph": 20, **k}}
        self.assertEqual(S._forecast_state(wx(), NOW)[1], "ok")
        self.assertEqual(S._forecast_state(wx(fc_fetched_utc=iso(NOW - timedelta(hours=9))), NOW)[1], "stale")
        self.assertEqual(S._forecast_state(wx(roof="dome"), NOW)[1], "indoor")
        self.assertEqual(S._forecast_state(wx(roof="retractable"), NOW)[1], "roof_unknown")
        self.assertEqual(S._forecast_state(wx(fc_temp_f=None), NOW)[1], "missing")

    def test_stale_spread_makes_game_script_unavailable_not_false(self):
        p = {"pos": "RB"}; r = {"wk": 10, "ha": "away", "slot": "RB1"}
        ev = S.evaluate_prop("p", p, r, "rush_yds", {"line": 50.5}, [], {"spread": 4},
                             out_with(NOW - timedelta(hours=40)), NOW)
        self.assertFalse([s for s in ev["signals"] if s["family"] == "game_script"])
        self.assertTrue([u for u in ev["unavailable"] if u["id"] == "SP5"])
        self.assertIsNone(ev["inputs"]["team_spread"])


def row(gid, wk, pid_m, ko=KO, final=False, **kw):
    return {"gid": gid, "wk": wk, "ko": iso(ko), "ha": "away", "slot": "RB1", "final": final, "m": pid_m, **kw}


def good_market(cap=KO - timedelta(hours=1), line=50.5):
    return {"lstat": "ok", "line": line, "op": -110, "up": -110, "book": "DraftKings", "cap": iso(cap)}


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "ledger.json"
        self.players = {"p1": {"pos": "RB", "name": "A B", "team": "AAA"}}
        self.out = {**out_with(), "games": {"g1": {"spread": 4}}}   # home favored by 4 -> away RB is -4... see below

    def tearDown(self):
        self.tmp.cleanup()

    def run_update(self, rows, now=NOW, out=None):
        return S.update(out or self.out, self.players, {"p1": rows}, now, path=self.path)

    def test_no_locks_before_ledger_start_and_repeat_capture_ignored(self):
        # first run creates the ledger at NOW; a capture earlier than frozen_at is not lockable
        early = row("g1", 10, {"rush_yds": good_market(cap=NOW - timedelta(minutes=30))})
        # ko-cap = 2.5h (ok) but cap >= frozen_at? frozen_at == NOW and cap < NOW -> not lockable
        res = self.run_update([early])
        self.assertEqual(res["locked_total"], 0)
        # a later capture locks once
        later_now = NOW + timedelta(minutes=30)
        r2 = row("g1", 10, {"rush_yds": good_market(cap=later_now - timedelta(minutes=5))})
        res = self.run_update([r2], later_now)
        self.assertEqual(res["locked_total"], 1)
        saved = json.loads(self.path.read_text())
        rec = dict(saved["records"]["g1|p1|rush_yds"])
        # repeat capture with a different line must not rewrite the record
        r3 = row("g1", 10, {"rush_yds": good_market(cap=later_now + timedelta(minutes=20), line=99.5)})
        self.run_update([r3], later_now + timedelta(minutes=30))
        saved2 = json.loads(self.path.read_text())
        self.assertEqual(saved2["records"]["g1|p1|rush_yds"], rec)
        self.assertEqual(rec["quote"]["line"], 50.5)
        self.assertEqual(rec["rule_versions"], {s["id"]: s["version"] for s in rec["signals"]})
        # spread orientation in the locked record: home favored 4 and away player -> +4 underdog -> SP5
        self.assertEqual(rec["inputs"]["team_spread"], 4)
        self.assertIn("SP5", {s["id"] for s in rec["signals"]})

    def test_quote_must_be_within_four_hours_and_before_kickoff(self):
        self.run_update([])                                         # create ledger
        n = NOW + timedelta(minutes=10)
        far = row("g1", 10, {"rush_yds": good_market(cap=KO - timedelta(hours=5))})
        self.assertEqual(self.run_update([far], n)["locked_total"], 0)
        noprice = row("g1", 10, {"rush_yds": {**good_market(cap=n - timedelta(minutes=1)), "up": None}})
        self.assertEqual(self.run_update([noprice], n)["locked_total"], 0)

    def test_registry_change_blocks_locks(self):
        self.run_update([])
        saved = json.loads(self.path.read_text())
        saved["registry_sha256"] = "0" * 64
        self.path.write_text(json.dumps(saved))
        n = NOW + timedelta(minutes=10)
        r = row("g1", 10, {"rush_yds": good_market(cap=n - timedelta(minutes=1))})
        self.assertEqual(self.run_update([r], n)["locked_total"], 0)

    def test_after_kickoff_never_evaluated(self):
        self.run_update([])
        n = KO + timedelta(minutes=5)
        r = row("g1", 10, {"rush_yds": good_market(cap=KO - timedelta(minutes=10))})
        res = self.run_update([r], n)
        self.assertEqual(res["locked_total"], 0)
        self.assertEqual(res["props"], {})


class ForwardGrading(unittest.TestCase):
    def rec(self, gid, line, ids, side_prices=(-110, -110), mid="rush_yds", wk=10):
        sigs = [sig(i) for i in ids]
        return {"gid": gid, "pid": "p1", "mid": mid, "wk": wk, "quote": {"line": line, "op": side_prices[0], "up": side_prices[1]},
                "signals": sigs, "stack": S.stack_summary(sigs)}

    def test_line_odds_grading_push_and_void(self):
        recs = {"a|p1|rush_yds": self.rec("a", 50.5, ["L2"]),
                "b|p1|rush_yds": self.rec("b", 50.0, ["L2"], (-110, +120)),
                "c|p1|rush_yds": self.rec("c", 50.5, ["L2"])}
        rows = {"p1": [
            {"gid": "a", "pid": "p1", "wk": 10, "final": True, "played": True, "m": {"rush_yds": {"act": 40}}},
            {"gid": "b", "pid": "p1", "wk": 10, "final": True, "played": True, "m": {"rush_yds": {"act": 50}}},   # push
            {"gid": "c", "pid": "p1", "wk": 10, "final": True, "played": False, "m": {"rush_yds": {"act": 0}}},   # void
        ]}
        rep = S.forward_report(recs, rows)
        one = rep["bases"]["active"]["1"]
        self.assertEqual((one["bets"], one["W"], one["L"], one["P"]), (2, 1, 0, 1))
        self.assertAlmostEqual(one["units"], 100 / 110, places=3)
        self.assertEqual(rep["by_signal"]["L2"]["bets"], 2)    # graded once per prop-side (under side only fired)

    def test_each_prop_side_once_and_counts_by_group(self):
        recs = {"a|p1|rush_yds": self.rec("a", 50.5, ["L2", "L4", "SP5"])}
        rows = {"p1": [{"gid": "a", "pid": "p1", "wk": 10, "final": True, "played": True, "m": {"rush_yds": {"act": 60}}}]}
        rep = S.forward_report(recs, rows)
        g = rep["bases"]["active"]
        self.assertEqual(list(g), ["3+ clean"])
        self.assertEqual((g["3+ clean"]["bets"], g["3+ clean"]["L"]), (1, 1))
        self.assertEqual(rep["bases"]["qualified"], {})
        self.assertFalse(rep["by_signal"]["L2"]["qualification"]["qualified"])

    def test_ungraded_props_are_skipped(self):
        recs = {"a|p1|rush_yds": self.rec("a", 50.5, ["L2"])}
        rows = {"p1": [{"gid": "a", "pid": "p1", "wk": 10, "final": False, "m": {}}]}
        self.assertEqual(S.forward_report(recs, rows)["bets_graded_props"], 0)


class PublicBoundary(unittest.TestCase):
    def test_public_prop_has_only_allowed_fields(self):
        sigs = [sig("L2"), sig("SP5")]
        for s in sigs:
            s["inputs"] = {"secret_roi": 0.3, "history": [1, 2]}
        rec = {"evaluated_utc": iso(NOW), "quote": {"line": 1, "op": -110, "up": -110, "book": "DK", "cap": iso(NOW), "snaps": [1]},
               "signals": sigs, "stack": S.stack_summary(sigs), "unavailable": [{"id": "WX1", "reason": "x"}], "inputs": {"a": 1}}
        p = S.public_prop(rec, "watch", {})
        self.assertEqual(set(p), S.PUBLIC_FIELDS)
        for c in p["chips"]:
            self.assertEqual(set(c), S.PUBLIC_CHIP_FIELDS)
        self.assertEqual(set(p["quote"]), {"line", "op", "up", "book", "cap"})
        self.assertNotIn("secret_roi", json.dumps(p))
        self.assertNotIn("inputs", p)

    def test_public_registry_fields(self):
        for d in S.public_registry():
            self.assertEqual(set(d), S.PUBLIC_REGISTRY_FIELDS)
            self.assertNotIn("origin", d)

    def test_update_payload_has_no_research_fields(self):
        with tempfile.TemporaryDirectory() as t:
            players = {"p1": {"pos": "RB"}}
            out = {**out_with(), "games": {"g1": {"spread": 4}}}
            r = row("g1", 10, {"rush_yds": {"lstat": "pending", "snaps": [{"cap": iso(NOW - timedelta(minutes=5)), "line": 50.5, "op": -110, "up": -110, "book": "DK"}]}})
            res = S.update(out, players, {"p1": [r]}, NOW, path=Path(t) / "l.json")
            blob = json.dumps(res)
            for banned in ("roi", "forward", "history_2025", "by_signal", "origin", "sha256_hist"):
                self.assertNotIn(banned, blob.replace("registry_sha256", ""))
            self.assertEqual(set(next(iter(res["props"].values()))), S.PUBLIC_FIELDS)

    def test_data_json_has_no_signal_stacks(self):
        site = Path(__file__).resolve().parent.parent / "site" / "data" / "data.json"
        if not site.exists():
            self.skipTest("no built data.json")
        self.assertNotIn("signal_stacks", json.loads(site.read_text()))

    def test_publish_forward_sends_display_only_to_admin_table(self):
        sent = []
        from pipeline import supa
        orig = supa.sync_signal_research
        supa.sync_signal_research = lambda rows, log: sent.extend(rows)
        try:
            with tempfile.TemporaryDirectory() as t:
                S.publish_forward({}, NOW, [], path=Path(t) / "l.json", forward_path=Path(t) / "f.json", display={"props": {}})
        finally:
            supa.sync_signal_research = orig
        self.assertEqual({r["id"]: r["kind"] for r in sent}, {"forward": "forward", "display": "display"})

    def test_site_js_never_reads_public_payload(self):
        js = (Path(__file__).resolve().parent.parent / "site" / "stacks.js").read_text()
        self.assertNotIn("D.signal_stacks", js)
        self.assertIn("admin_signal_research", js)


class ModelOverlap(unittest.TestCase):
    def test_declared_overlap_matches_frozen_model_columns(self):
        models = json.loads(S.OVERLAP_MODEL_PATH.read_text())["models"]
        cols = set()
        for m in models.values():
            cols.update(m["columns"])
        declared = {c for v in S.MODEL_INPUT_OVERLAP.values() for c in v}
        # every declared overlap input must really be a model column (no invented overlap)
        missing = [c for c in declared if c not in cols]
        self.assertEqual(missing, [], f"declared overlap inputs not in frozen model columns: {missing}")
        # spread rules declare no overlap with the model
        for sid in ("SP1", "SP2", "SP3", "SP4", "SP5"):
            self.assertEqual(S.MODEL_INPUT_OVERLAP[sid], [])
        self.assertFalse([c for c in cols if "spread" in c.lower()], "model reads a spread column: SP rules would overlap it")


if __name__ == "__main__":
    unittest.main()


class RemoteLedger(unittest.TestCase):
    def test_failed_remote_read_never_locks_or_saves(self):
        import os
        from pipeline import supa
        saves = []
        o_read, o_sync = supa.read_signal_research, supa.sync_signal_research
        supa.read_signal_research = lambda rid: ("error", None)
        supa.sync_signal_research = lambda rows, log: saves.extend(rows)
        try:
            players = {"p1": {"pos": "RB"}}
            r = row("g1", 10, {"rush_yds": good_market(cap=NOW - timedelta(minutes=5))})
            res = S.update({**out_with(), "games": {"g1": {"spread": 4}}}, players, {"p1": [r]}, NOW, log=[])
            self.assertEqual(res["locked_total"], 0)
            self.assertEqual(saves, [])
        finally:
            supa.read_signal_research, supa.sync_signal_research = o_read, o_sync

    def test_remote_mode_saves_ledger_row_not_a_file(self):
        from pipeline import supa
        saves = []
        o_read, o_sync = supa.read_signal_research, supa.sync_signal_research
        supa.read_signal_research = lambda rid: ("absent", None)
        supa.sync_signal_research = lambda rows, log: saves.extend(rows)
        try:
            S.update({**out_with(), "games": {}}, {}, {}, NOW, log=[])
        finally:
            supa.read_signal_research, supa.sync_signal_research = o_read, o_sync
        self.assertEqual([(s["id"], s["kind"]) for s in saves], [("ledger", "ledger")])
