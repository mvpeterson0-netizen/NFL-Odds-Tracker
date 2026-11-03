import unittest
from unittest.mock import patch
from pipeline import challenger_theses as t

class ResearchThesisRegistryTests(unittest.TestCase):
    def test_all_registry_items_have_unique_stable_ids(self):
        reg=t.registry()
        ids=[v['id'] for v in reg['entries']]
        self.assertGreaterEqual(len(ids),20)
        self.assertEqual(len(ids),len(set(ids)))

    def test_discovery_is_never_relabelled_as_forward(self):
        reg={'schema_version':1,'entries':[{'id':'TH-X','title':'Test','question':'Question',
              'status':'monitoring','metric_source':{'type':'locked_model_diagnostics','segment':'usage_jump','lead_ids':['t12']}}]}
        b={'bets':2,'wins':1,'losses':1,'pushes':0,'units':-0.09,'roi':-0.045}
        diagnostics={'leads':{'t12':{'weeks':{
            '8':{'segments':{'usage_jump':{'flagged':b,'other':b}}},
            '9':{'segments':{'usage_jump':{'flagged':b,'other':b}}}}}}}
        out=t.weekly_rollup(reg,diagnostics)
        x=out['tracked'][0]
        self.assertEqual([r['phase'] for r in x['evidence']],['discovery','forward_monitoring'])
        self.assertEqual(x['observed_weeks'],[9])
        self.assertEqual(x['conclusion'],'Not established; no automatic promotion')

    def test_untested_thesis_gets_no_fake_pnl(self):
        reg={'schema_version':1,'entries':[{'id':'TH-Y','title':'Untested','question':'Question',
              'status':'needs_data','metric_source':None}]}
        out=t.weekly_rollup(reg,{'leads':{}})
        x=out['tracked'][0]
        self.assertFalse(x['test_implemented'])
        self.assertEqual(x['evidence'],[])
        self.assertIn('Testing implementation needed','\n'.join(t.markdown_lines(out)))

    def test_existing_frozen_lead_keeps_separate_record(self):
        reg={'schema_version':1,'entries':[{'id':'TH-T9','title':'Streak','question':'Question',
              'status':'existing_frozen_lead','metric_source':{'type':'existing_frozen_leads','lead_id':'t9'}}]}
        p={'t9':{'cumulative':{'bets':3,'units':1.2},'latest_week':{'bets':2},'pending':1,'void':0}}
        out=t.weekly_rollup(reg,{},p)
        entry=out['tracked'][0]['evidence'][0]
        self.assertEqual(entry['model'],'t9')
        self.assertEqual(entry['cumulative']['units'],1.2)

if __name__=='__main__':unittest.main()
