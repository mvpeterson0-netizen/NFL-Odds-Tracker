import unittest
from pipeline.challenger_diagnostics import build_diagnostics, snap_disruption

class DiagnosticTests(unittest.TestCase):
    def test_pre_game_only_and_exact_one_unit_prices(self):
        site={'players':[{'id':'p','name':'Player P','pos':'RB'}],
              'games':{'g':{'away':'A','home':'B'}},
              'rows':{'p':[{'gid':'old','ko':'2026-10-20T18:00:00Z','final':True,'played':True,'snap':80,'m':{}},
                           {'gid':'older','ko':'2026-10-25T18:00:00Z','final':True,'played':True,'snap':80,'m':{}},
                           {'gid':'g','ko':'2026-11-01T18:00:00Z','final':True,'played':True,'snap':30,
                            'm':{'rush_yds':{'act':10}}}]}}
        v={'gid':'g','pid':'p','mid':'rush_yds','wk':8,'ko':'2026-11-01T18:00:00Z',
           'observed_at':'2026-11-01T15:00:00Z',
           'quote':{'cap':'2026-11-01T14:59:00Z','line':20.5,'op':-110,'up':120},
           'decisions':{'t12':{'side':'under','qualifies':True,'edge':.2}},
           'feature_snapshot':{'usage_delta':12.,'surprise':.75}}
        output=build_diagnostics(site,{'g|p|rush_yds':v},{})
        w=output['leads']['t12']['weeks']['8']
        self.assertEqual(w['overall']['units'],1.2)
        self.assertEqual(w['segments']['combined_jump']['flagged']['bets'],1)
        self.assertEqual(w['segments']['low_participation']['flagged']['bets'],1)
        self.assertEqual(w['games'][0]['matchup'],'A @ B')
        self.assertEqual(output['leads']['t13']['overall']['bets'],0)
        self.assertEqual(output['leads']['t12']['pending'],0)

    def test_unverified_disruption_needs_two_previous_snaps(self):
        base={'pid':'p','gid':'g','ko':'2026-11-01T18:00:00Z'}
        rows={('p','g'):{'final':True,'played':True,'snap':20}}
        self.assertIsNone(snap_disruption(base,rows))
        rows[('p','a')]={'played':True,'ko':'2026-10-18T18:00:00Z','snap':85}
        self.assertIsNone(snap_disruption(base,rows))
        rows[('p','b')]={'played':True,'ko':'2026-10-25T18:00:00Z','snap':90}
        result=snap_disruption(base,rows)
        self.assertTrue(result['flag'])
        self.assertIn('unverified',result['cause'])
    def test_no_hindsight_pregame_timestamps(self):
        site={'players':[],'rows':{'p':[{'gid':'g','final':True,'played':True,'m':{'rec':{'act':1}}}]}}
        entry={'gid':'g','pid':'p','mid':'rec','wk':8,'ko':'2026-11-01T18:00:00Z',
               'observed_at':'2026-11-01T19:00:00Z',
               'quote':{'cap':'2026-11-01T14:00:00Z','line':2.5,'op':-110,'up':-110},
               'decisions':{'t12':{'side':'under','qualifies':True}}}
        with self.assertRaisesRegex(ValueError,'pregame'):
            build_diagnostics(site,{'g|p|rec':entry},{})

if __name__=='__main__':
    unittest.main()
