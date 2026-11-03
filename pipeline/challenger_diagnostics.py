"""Prospective-only diagnostics for frozen interaction and weekly challenger.

These are descriptive postgame slices, not training filters, causal injury labels,
new decisions, or statistically validated edge claims.
"""
from collections import defaultdict
from statistics import mean
from .common import DATA, read_json
from .frozen_leads import payout

MARKET_LABELS = {'pass_yds':'Passing yards','rush_yds':'Rushing yards',
                 'rec':'Receptions','rec_yds':'Receiving yards'}

def snap_disruption(entry, rows):
    """Descriptive low-snap flag. Never label its cause as injury."""
    current = rows.get((entry['pid'],entry['gid']))
    if not current or not current.get('final') or current.get('played') is not True:
        return None
    actual = current.get('snap')
    if actual is None:
        return None
    before = sorted((r for (pid,_),r in rows.items()
                     if pid == entry['pid'] and r.get('played') is True
                     and r.get('ko','') < entry['ko'] and r.get('snap') is not None),
                    key=lambda r:r['ko'])[-3:]
    if len(before)<2:
        return None
    baseline = mean(r['snap'] for r in before)
    # At least 20 percentage points AND 40% relative shortfall.
    return {'flag':baseline-actual>=20 and actual<baseline*.60,
            'actual_snap_pct':actual,'prior_snap_pct':round(baseline,1),
            'cause':'unverified: early exit, game script, substitution or restriction'}

def bucket(xs):
    n=len(xs)
    return {'bets':n,'wins':sum(x['units']>0 for x in xs),
            'losses':sum(x['units']<0 for x in xs),
            'pushes':sum(x['units']==0 for x in xs),
            'units':round(sum(x['units'] for x in xs),4),
            'roi':round(sum(x['units'] for x in xs)/n,5) if n else None}

def build_diagnostics(site, frozen, challenger):
    """Only locked, qualified, graded real bets enter P/L. Unknowns remain pending."""
    rows={(pid,r['gid']):r for pid,rs in site.get('rows',{}).items() for r in rs}
    players={p['id']:p for p in site.get('players',[])}
    games=site.get('games',{})
    output={'method':'One unit risked at exact locked price; pushes zero; voids and ungraded excluded.',
            'disclaimer':'Postgame exploratory cuts, not validated filters. Low snaps are not proof of injury. Same-player markets are correlated.',
            'hypotheses':[
                {'id':'persistent_usage','title':'Role persistence versus regression',
                 'rule':'Pregame usage_delta > 10 and/or prior-game surprise > 0.5; compare with other locked bets. No change to T12/T13.'},
                {'id':'participation','title':'Participation disruptions',
                 'rule':'Actual snap share at least 20 percentage points and 40% below the average of 2–3 previous played games. Descriptive only; no automatic injury attribution.'},
                {'id':'low_line','title':'Tiny line / highly concentrated bets',
                 'rule':'QB rushing line <=1.5 and overlapping same-player markets; compare return distribution and concentration.'}
            ],'leads':{}}
    for lead,ledger in (('t12',frozen),('t13',challenger)):
        graded=[];pending=0;voids=0
        for key,v in ledger.items():
            d=v.get('decisions',{}).get(lead)
            if not d or d.get('qualifies') is False:
                continue
            if not (v['quote']['cap']<=v['observed_at']<v['ko']):
                raise ValueError('Invalid diagnostic pregame evidence')
            r=rows.get((v['pid'],v['gid']))
            if not r or not r.get('final') or r.get('played') is None:
                pending+=1;continue
            if r.get('played') is False:
                voids+=1;continue
            m=r.get('m',{}).get(v['mid'],{})
            actual=m.get('act')
            if actual is None:
                pending+=1;continue
            q=v['quote'];side=d['side']
            price=q['op' if side=='over' else 'up']
            units=0 if actual==q['line'] else payout(price) if (actual>q['line'])==(side=='over') else -1
            fs=v.get('feature_snapshot') or {}
            def numeric(k):
                x=fs.get(k)
                return x if isinstance(x,(int,float)) else None
            snap=snap_disruption(v,rows)
            p=players.get(v['pid'],{})
            graded.append({'week':v['wk'],'gid':v['gid'],'player':p.get('name',v['pid']),
                           'position':p.get('pos',''),'market':v['mid'],'side':side,
                           'line':q['line'],'actual':actual,'units':units,'edge':d.get('edge'),
                           'usage_jump':numeric('usage_delta') is not None and numeric('usage_delta')>10,
                           'surprise_jump':numeric('surprise') is not None and numeric('surprise')>.5,
                           'tiny_qb_rush':p.get('pos')=='QB' and v['mid']=='rush_yds' and q['line']<=1.5,
                           'snap':snap})
        weeks={}
        for week in sorted({x['week'] for x in graded}):
            subset=[x for x in graded if x['week']==week]
            games_out=[]
            for gid in sorted({x['gid'] for x in subset}):
                z=[x for x in subset if x['gid']==gid]
                g=games.get(gid,{})
                games_out.append({'gid':gid,'matchup':g.get('away','')+' @ '+g.get('home',''),
                                  'record':bucket(z),
                                  'largest_losses':sorted([{'player':x['player'],'market':x['market'],
                                    'side':x['side'],'line':x['line'],'actual':x['actual']}
                                    for x in z if x['units']<0],key=lambda x:x['player'])[:6]})
            games_out.sort(key=lambda g:-g['record']['units'])
            def segment(pred):
                yes=[x for x in subset if pred(x)]
                no=[x for x in subset if not pred(x)]
                return {'flagged':bucket(yes),'other':bucket(no)}
            disrupted=[{'player':x['player'],'gid':x['gid'],
                        'actual_snap_pct':x['snap']['actual_snap_pct'],
                        'prior_snap_pct':x['snap']['prior_snap_pct'],
                        'units':round(x['units'],4)} for x in subset if x['snap'] and x['snap']['flag']]
            weeks[str(week)]={'overall':bucket(subset),'games':games_out,'segments':{
                 'usage_jump':segment(lambda x:x['usage_jump']),
                 'surprise_jump':segment(lambda x:x['surprise_jump']),
                 'combined_jump':segment(lambda x:x['usage_jump'] and x['surprise_jump']),
                 'tiny_qb_rush':segment(lambda x:x['tiny_qb_rush']),
                 'low_participation':segment(lambda x:x['snap'] is not None and x['snap']['flag']),
                 'over':segment(lambda x:x['side']=='over'),
                 'receiving_yards':segment(lambda x:x['market']=='rec_yds')},
                 'disruptions':disrupted}
        output['leads'][lead]={'overall':bucket(graded),'pending':pending,'voids':voids,'weeks':weeks}
    return output
