import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline import credit_policy as policy, history_2025 as hist, odds

NOW = datetime(2026, 10, 30, 16, tzinfo=timezone.utc)
GAME = {'game_id': '2025_01_DAL_PHI', 'kickoff_utc': '2025-09-05T00:20:00Z',
        'home_team': 'PHI', 'away_team': 'DAL'}
EVENT = {'id': 'e1', 'home_team': 'Philadelphia Eagles', 'away_team': 'Dallas Cowboys',
         'commence_time': GAME['kickoff_utc']}


class CreditTests(unittest.TestCase):
    def setUp(self):
        # Verify reserve arithmetic with a nonzero floor, even when deployment uses zero.
        self.reserve = patch.object(hist, "PAID_RESERVE", 500)
        self.reserve.start()
        self.addCleanup(self.reserve.stop)

    def test_zero_reserve_can_use_last_credits(self):
        self.assertEqual(policy.PAID_RESERVE, 0)
        with patch.object(hist, "PAID_RESERVE", 0), patch.object(hist, "utcnow", return_value=NOW), patch.object(hist, "fetch_events", return_value=([], {"x-requests-remaining": "50"})):
            hist.quota("paid", {}, 50)
            with self.assertRaises(hist.Stop):
                hist.quota("paid", {}, 51)

    def test_paid_duplicate_is_last_and_core_uses_free_first(self):
        with patch.dict(os.environ, {'ODDS_API_KEY': 'paid', 'ODDS_API_KEY_2': 'free',
                                    'ODDS_API_KEY_20K': 'paid'}, clear=True):
            self.assertEqual(policy.live_keys(), ['free', 'paid'])
            with patch.object(policy, 'floor_for', side_effect=lambda k: 500 if k == 'paid' else 0):
                self.assertEqual(policy.pick_live({1: 5, 2: 12000}, ['free', 'paid'], 7, 5), (1, 5))
                self.assertEqual(policy.pick_live({1: 4, 2: 504}, ['free', 'paid'], 7, 5), (None, None))
                self.assertEqual(policy.pick_live({1: None, 2: None}, ['free', 'paid'], 7, 5), (None, None))

    def test_each_billable_request_checks_current_balance(self):
        state = {}
        with patch.object(hist, 'utcnow', return_value=NOW), patch.object(hist, 'fetch_events', return_value=([], {'x-requests-remaining': '550'})), patch.object(hist, 'http_get', return_value=(b'{}', {'x-requests-remaining': '500', 'x-requests-last': '50'}, 200)) as call:
            hist.request('paid', state, 'url', {}, 50)
            self.assertEqual(state['paid_remaining'], 500)
            self.assertEqual(call.call_args.kwargs['retries'], 1)
        with patch.object(hist, 'utcnow', return_value=NOW), patch.object(hist, 'fetch_events', return_value=([], {'x-requests-remaining': '549'})), patch.object(hist, 'http_get') as call:
            with self.assertRaises(hist.Stop):
                hist.request('paid', {}, 'url', {}, 50)
            call.assert_not_called()

    def test_missing_balance_reset_and_deadline_do_not_spend(self):
        for headers, state in [({}, {}), ({'x-requests-remaining': '20000'}, {'paid_remaining': 600})]:
            with patch.object(hist, 'utcnow', return_value=NOW), patch.object(hist, 'fetch_events', return_value=([], headers)), patch.object(hist, 'http_get') as call:
                with self.assertRaises((hist.Stop, hist.Pause)):
                    hist.request('paid', state, 'url', {}, 1)
                call.assert_not_called()
        with patch.object(hist, 'utcnow', return_value=policy.BACKFILL_DEADLINE), patch.object(hist, 'fetch_events') as probe:
            with self.assertRaises(hist.Stop):
                hist.quota('paid', {}, 1)
            probe.assert_not_called()

    def test_archive_resume_and_reserve_stop_without_live_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'archive'
            responses = [(json.dumps({'data': [EVENT]}).encode(), {'x-requests-remaining': '550', 'x-requests-last': '1'}, 200),
                         (b'{"timestamp":"2025-09-04T21:20:00Z","data":{"bookmakers":[]}}', {'x-requests-remaining': '500', 'x-requests-last': '50'}, 200)]
            with patch.object(hist, 'ROOT', root), patch.object(hist, 'STATE', root / 'state.json'), patch.object(hist, 'utcnow', return_value=NOW), patch.object(hist, 'schedule', return_value=[GAME]), patch.object(hist, 'fetch_events', side_effect=[([], {'x-requests-remaining': '551'}), ([], {'x-requests-remaining': '550'})]), patch.object(hist, 'http_get', side_effect=responses) as call, patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'schedule'}):
                hist.run('paid', [])
                self.assertEqual(call.call_count, 2)
                archive = root / 'odds' / (GAME['game_id'] + '.json')
                self.assertTrue(archive.exists())
                self.assertEqual(json.loads(archive.read_text())['markets'], odds.CORE)
                hist.run('paid', [])
                self.assertEqual(call.call_count, 2)
            # A floor stop is persisted; future monthly resets cannot restart it.
            with patch.object(hist, 'ROOT', root), patch.object(hist, 'STATE', root / 'stopped.json'), patch.object(hist, 'utcnow', return_value=NOW), patch.object(hist, 'schedule', return_value=[GAME]), patch.object(hist, 'fetch_events', return_value=([], {'x-requests-remaining': '500'})), patch.object(hist, 'http_get') as call, patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'schedule'}):
                archive.unlink()
                hist.run('paid', [])
                self.assertIn('stopped', json.loads((root / 'stopped.json').read_text()))
                hist.run('paid', [])
                call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
