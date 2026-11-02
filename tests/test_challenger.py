import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
from types import SimpleNamespace
from pipeline import challenger as c, challenger_report as report
from pipeline.frozen_leads import probability

class ChallengerTests(unittest.TestCase):
    def test_no_active_model_returns_empty_watchlist(self):
        with tempfile.TemporaryDirectory() as td,patch.object(c,'ROOT',Path(td)):
            out=c.update(None,{}, {},datetime.now(timezone.utc))
            self.assertFalse(out['records']);self.assertFalse(out['watchlist'])
            self.assertEqual(out['status']['status'],'awaiting_first_training')

    def test_new_version_does_not_predict_old_locked_opportunity(self):
        with tempfile.TemporaryDirectory() as td,patch.object(c,'ROOT',Path(td)):
            root=Path(td);(root/'ledgers').mkdir();(root/'versions/new').mkdir(parents=True)
            (root/'active.json').write_text(json.dumps({'version':'new'}))
            (root/'versions/new/model.json').write_text(json.dumps({'frozen_at':'2026-11-03T21:00:00Z'}))
            entry={'gid':'g','pid':'p','mid':'rec','decisions':{'t13':{'side':'under'}}}
            (root/'ledgers/old.json').write_text(json.dumps({'records':{'g|p|rec':entry}}))
            def fake(d,p,rows,now,**kw):
                self.assertNotIn('rec',rows['p'][0]['m']);self.assertIn('rec_yds',rows['p'][0]['m'])
                return {'records':{},'watchlist':{}}
            with patch.object(c,'predict',side_effect=fake):
                out=c.update(None,{}, {'p':[{'gid':'g','m':{'rec':{},'rec_yds':{}}}]},datetime(2026,11,4,tzinfo=timezone.utc))
                self.assertEqual(out['records']['g|p|rec']['model_version'],'old')

    def test_existing_weekly_version_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as td,patch.object(c,'ROOT',Path(td)):
            p=Path(td)/'versions/challenger-2026-W45';p.mkdir(parents=True);(p/'model.json').write_text('preserved')
            self.assertEqual(c.train(datetime(2026,11,3,21,tzinfo=timezone.utc))['status'],'already_trained')
            self.assertEqual((p/'model.json').read_text(),'preserved')

    def test_incomplete_data_does_not_change_active(self):
        with tempfile.TemporaryDirectory() as td,patch.object(c,'ROOT',Path(td)),patch.object(c,'dataset',side_effect=RuntimeError('Incomplete outcomes')):
            root=Path(td);(root/'active.json').write_text('{"version":"old"}')
            with self.assertRaisesRegex(RuntimeError,'Incomplete'):c.train(datetime(2026,11,3,21,tzinfo=timezone.utc))
            self.assertEqual(json.loads((root/'active.json').read_text())['version'],'old')

    def test_report_grades_locked_price_and_skips_void(self):
        entry={'pid':'p','gid':'g','mid':'rec','quote':{'line':3.5,'op':-110,'up':120}}
        decision={'side':'under'};rows={('p','g'):{'final':True,'played':True,'m':{'rec':{'act':3}}}}
        self.assertEqual(report.grade(entry,decision,rows),1.2)
        rows[('p','g')]['played']=False;self.assertEqual(report.grade(entry,decision,rows),'void')

    def test_uncertainty_not_reported_with_one_week(self):
        self.assertIsNone(report.stats([{'week':8,'return':1.}])['interval'])
        self.assertIsNone(report.stats([])['roi'])

    def test_exported_imputation_matches_sklearn(self):
        import numpy as np
        import pandas as pd
        from sklearn.pipeline import make_pipeline
        from sklearn.impute import SimpleImputer
        from sklearn.preprocessing import StandardScaler
        from sklearn.linear_model import LogisticRegression
        x=pd.DataFrame({'a':[0.,1.,None,2.]*10,'b':[None]*40});y=[0,1,0,1]*10
        model=make_pipeline(SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True),StandardScaler(),LogisticRegression(C=.01))
        model.fit(x,y);s=c.export_model(model,list(x))
        self.assertTrue(np.allclose(model.predict_proba(x)[:,1],[probability(s,r) for r in x.to_dict('records')],atol=1e-12))

if __name__=='__main__':unittest.main()
