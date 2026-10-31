import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace
from pipeline.frozen_leads import decide, update, probability, MODEL_PATH, Features
from pipeline.script import _team


class FrozenLeadTests(unittest.TestCase):
    def test_streaks_include_zero_and_break_on_push_or_tie(self):
        h = [{'act':v,'result':'over'} for v in [0,2,4]]
        self.assertIn('t10', decide('WR','rec',h,3.5,-110,-110,{},{}))
        self.assertIn('t9', decide('WR','rec_yds',h,30.5,-110,-110,{},{}))
        h[1]['result']='push';h[1]['act']=0
        self.assertNotIn('t9', decide('WR','rec_yds',h,30.5,-110,-110,{},{}))
        self.assertNotIn('t10', decide('WR','rec',h,3.5,-110,-110,{},{}))
        self.assertNotIn('t10', decide('RB','rec',h,3.5,-110,-110,{},{}))

    def test_threshold_and_direction(self):
        # Constant 80% Over model: selected side and estimated-return gate are explicit.
        model={'columns':[],'medians':[],'indicators':[],'mean':[],'scale':[],
               'coef':[],'intercept':1.3862943611198906,'threshold':.1}
        x=decide('QB','pass_yds',[],200.5,-110,-110,{}, {'t11':model})['t11']
        self.assertEqual(x['side'],'over');self.assertTrue(x['qualifies'])
        model['threshold']=1
        self.assertFalse(decide('QB','pass_yds',[],200.5,-110,-110,{}, {'t11':model})['t11']['qualifies'])

    def test_ledger_locks_nonbets_and_rejects_backfill(self):
        d=SimpleNamespace(stats={},snaps={},games_by_id={})
        p={'p':{'pos':'WR'}}
        q={'lstat':'ok','line':10.5,'op':-110,'up':-110,'book':'DraftKings','cap':'2026-11-01T17:00:00Z'}
        row={'gid':'g','wk':8,'ko':'2026-11-01T20:00:00Z','final':False,'ha':'home','team':'A','m':{'rec_yds':q}}
        now=datetime(2026,11,1,17,1,tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'ledger.json'
            a=update(d,p,{'p':[row]},now,path)
            original=json.loads(json.dumps(a))
            self.assertEqual(len(a['records']),1)
            q['line']=99.5
            self.assertEqual(update(d,p,{'p':[row]},now,path),original)
            # A new game first encountered after kickoff must never acquire forward decisions.
            row['gid']='past';row['ko']='2026-11-01T16:00:00Z'
            self.assertEqual(update(d,p,{'p':[row]},now,path),original)
            # Nor can old historical quotes or future-dated captures enter a new game's record.
            row['gid']='old';row['ko']='2026-11-01T21:00:00Z';q['cap']='2026-10-30T00:00:00Z'
            self.assertEqual(update(d,p,{'p':[row]},now,path),original)
            q['cap']='2026-11-01T19:00:00Z'
            self.assertEqual(update(d,p,{'p':[row]},now,path),original)

    def test_designed_runs_exclude_scrambles_kneels_no_plays(self):
        plays=[{'posteam':'A','rush_attempt':'1','qb_scramble':s,'qb_kneel':k,'play_type':t}
               for s,k,t in [('0','0','run'),('1','0','run'),('0','1','run'),('0','0','no_play')]]
        self.assertEqual(_team(plays,'A')['designed_runs'],1)

    def test_midnight_capture_never_includes_same_game(self):
        # Local game date is Oct 25 but both pregame quote and kickoff are Oct 26 UTC.
        # Even if a retrospective fixture contains its final stats, it cannot be history.
        d=SimpleNamespace(stats={},snaps={('g','p'):{'offense_snaps':'20'}},
            games_by_id={'g':{'kickoff_utc':'2026-10-26T00:20:00Z','result':'7','week':'7'}})
        self.assertEqual(Features(d,{},{}).history('p','2026-10-26T00:00:17Z'),[])

    def test_weekly_preview_is_ephemeral_then_pregame_locks(self):
        d=SimpleNamespace(stats={},snaps={},games_by_id={})
        p={'p':{'pos':'WR'}}
        q={'line':10.5,'op':-110,'up':-110,'book':'DraftKings','cap':'2026-10-30T18:00:00Z'}
        m={'lstat':'pending','snaps':[q]}
        row={'gid':'g','wk':8,'ko':'2026-11-01T20:00:00Z','final':False,'ha':'home','team':'A','m':{'rec_yds':m}}
        now=datetime(2026,11,1,17,1,tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'ledger.json'
            a=update(d,p,{'p':[row]},now,path)
            self.assertEqual(len(a['watchlist']),1);self.assertFalse(a['records'])
            self.assertNotIn('watchlist',json.loads(path.read_text()))
            q['line']=20.5
            self.assertEqual(next(iter(update(d,p,{'p':[row]},now,path)['watchlist'].values()))['quote']['line'],20.5)
            m.update(q);m['lstat']='ok';m['cap']='2026-11-01T17:00:00Z'
            locked=update(d,p,{'p':[row]},now,path)
            self.assertFalse(locked['watchlist']);self.assertEqual(len(locked['records']),1)
            m['lstat']='pending';q['line']=50.5
            after=update(d,p,{'p':[row]},now,path)
            self.assertFalse(after['watchlist']);self.assertEqual(after['records'],locked['records'])

    def test_config_models_are_fixed(self):
        c=json.loads(MODEL_PATH.read_text())
        self.assertEqual(set(c['models']),{'t11','t12'})
        self.assertTrue(all(x['threshold']==.1 for x in c['models'].values()))

if __name__=='__main__':unittest.main()
