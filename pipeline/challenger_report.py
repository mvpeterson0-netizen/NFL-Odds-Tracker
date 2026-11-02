"""Weekly descriptive scorecard from pregame evidence only; never fits a model."""
import math
import random
from collections import defaultdict
from statistics import mean
from .common import DATA, SITE, read_json, write_json, utcnow, iso, parse_iso
from .challenger import ROOT, RULES
from .frozen_leads import payout

NAMES={'t9':'WR yardage streak','t10':'WR rising receptions','t11':'Frozen basic','t12':'Frozen interaction','t13':'Weekly challenger'}

def grade(entry,decision,rows):
    r=rows.get((entry['pid'],entry['gid']))
    if not r or not r.get('final'):return None
    if r.get('played') is False:return 'void'
    if r.get('played') is not True:return None
    act=r.get('m',{}).get(entry['mid'],{}).get('act')
    if act is None:return None
    q=entry['quote'];side=decision['side'];odds=q['op' if side=='over' else 'up']
    return 0. if act==q['line'] else payout(odds) if (act>q['line'])==(side=='over') else -1.

def stats(bets):
    if not bets:return {'bets':0,'roi':None,'units':0,'wins':0,'losses':0,'pushes':0,'interval':None}
    returns=[x['return'] for x in bets];weeks=defaultdict(list)
    for x in bets:weeks[x['week']].append(x['return'])
    # Resample complete weeks; with fewer than four weeks do not display an unstable interval.
    interval=None
    if len(weeks)>=4:
        groups=list(weeks.values());rng=random.Random(601);samples=[]
        for _ in range(2000):
            draw=[rng.choice(groups) for _ in groups];samples.append(sum(map(sum,draw))/sum(map(len,draw)))
        samples.sort();interval=[samples[49],samples[1949]]
    return {'bets':len(bets),'units':sum(returns),'roi':mean(returns),'wins':sum(x>0 for x in returns),
            'losses':sum(x<0 for x in returns),'pushes':sum(x==0 for x in returns),'weeks':len(weeks),'interval':interval}

def build_report(now=None):
    now=now or utcnow();site=read_json(SITE/'data/data.json',{});rows={(p,r['gid']):r for p,rs in site.get('rows',{}).items() for r in rs}
    original=read_json(DATA/'frozen_leads.json',{}).get('records',{});challenger={}
    for path in sorted((ROOT/'ledgers').glob('*.json')):
        for k,v in read_json(path,{}).get('records',{}).items():challenger.setdefault(k,{**v,'model_version':path.stem})
    bets=[];probabilities=[];unknown=defaultdict(int);void=defaultdict(int);evidence={}
    for records,leads in [(original,['t9','t10','t11','t12']),(challenger,['t13'])]:
        for key,v in records.items():
            if not(v['quote']['cap']<=v['observed_at']<v['ko']):raise ValueError('Invalid pregame evidence timing')
            for lead in leads:
                d=v.get('decisions',{}).get(lead)
                if not d:continue
                ret=grade(v,d,rows);qual=d.get('qualifies',True)
                if ret is None:
                    if qual:unknown[lead]+=1
                    continue
                if ret=='void':
                    if qual:void[lead]+=1
                    continue
                evidence[(lead,key)]={'return':ret if qual else 0.,'week':v['wk'],'qualifies':qual}
                if qual:bets.append({'lead':lead,'key':key,'week':v['wk'],'ko':v['ko'],'return':ret,'entry':v,'decision':d})
                if 'probability' in d:
                    act=rows[(v['pid'],v['gid'])]['m'][v['mid']]['act'];line=v['quote']['line']
                    if act!=line:
                        p=d['probability'] if d['side']=='over' else 1-d['probability']
                        op,up=v['quote']['op'],v['quote']['up'];ip=1/(1+payout(op));iu=1/(1+payout(up))
                        probabilities.append({'lead':lead,'p':p,'y':float(act>line),'market':ip/(ip+iu),'ko':v['ko'],'key':key})
    latest=max((r['wk'] for r in rows.values() if r.get('final')),default=None);summary={}
    for lead in NAMES:
        z=[x for x in bets if x['lead']==lead];p=[x for x in probabilities if x['lead']==lead]
        summary[lead]={'name':NAMES[lead],'cumulative':stats(z),'latest_week':stats([x for x in z if x['week']==latest]),'pending':unknown[lead],'void':void[lead],
            'probability':{'n':len(p),'brier':mean((x['p']-x['y'])**2 for x in p) if p else None,'market_brier':mean((x['market']-x['y'])**2 for x in p) if p else None,
                           'bins':[{'low':low/10,'n':len(g),'predicted':mean(x['p'] for x in g),'actual':mean(x['y'] for x in g)} for low in range(10) if (g:=[x for x in p if low/10<=x['p']<(low+1)/10])]},
            'concentration':{},'worse_price_roi':None,'without_best_week_roi':None}
        if z:
            worse=[];weekly=defaultdict(float)
            for x in z:
                odds=x['entry']['quote']['op' if x['decision']['side']=='over' else 'up'];new=(odds-10) if odds>110 or odds<0 else -110
                worse.append(payout(new) if x['return']>0 else x['return']);weekly[x['week']]+=x['return']
            summary[lead]['worse_price_roi']=mean(worse);best=max(weekly,key=weekly.get)
            summary[lead]['without_best_week_roi']=stats([x for x in z if x['week']!=best])['roi']
            for label,field in [('players','pid'),('games','gid'),('markets','mid')]:
                groups=defaultdict(list)
                for x in z:groups[x['entry'][field]].append(x)
                summary[lead]['concentration'][label]=sorted([{'id':k,'bets':len(v),'units':sum(x['return'] for x in v)} for k,v in groups.items()],key=lambda x:-x['units'])[:5]
    common=set(k for l,k in evidence if l=='t12')&set(k for l,k in evidence if l=='t13')
    # Compare identical quoted prices only; two different prices are not a matched opportunity.
    common={k for k in common if original[k]['quote']==challenger[k]['quote']}
    paired=[];agreement=defaultdict(int)
    for k in common:
        a=evidence[('t12',k)];b=evidence[('t13',k)];paired.append({'week':a['week'],'return':b['return']-a['return']})
        ds1=original[k]['decisions']['t12'];ds2=challenger[k]['decisions']['t13'];agreement['both_bet' if a['qualifies'] and b['qualifies'] else 'challenger_only' if b['qualifies'] else 'frozen_only' if a['qualifies'] else 'both_skip']+=1
        if a['qualifies'] and b['qualifies']:agreement['same_side' if ds1['side']==ds2['side'] else 'opposite_sides']+=1
    active=read_json(ROOT/'active.json',{});version=active.get('version');manifest=read_json(ROOT/'versions'/str(version)/'manifest.json',{})
    changes=[];versions=sorted((ROOT/'versions').glob('*/model.json'))
    if version and len(versions)>1:
        cfg=read_json(ROOT/'versions'/version/'model.json',{})['models']['t13'];previous=next((p for p in reversed(versions) if p.parent.name!=version),None)
        if previous:
            old=read_json(previous,{})['models']['t13']
            # Coefficient comparisons require matched transformed dimensions/scalers; report raw probability shifts later instead.
            changes=['New weights fitted on expanding history; coefficient magnitudes are not directly comparable because scaling/imputation were refitted.']
            from .frozen_leads import probability, augment
            shifts=[]
            for v in challenger.values():
                fs=v.get('feature_snapshot');mid=v['mid'];pos=next((p['pos'] for p in site.get('players',[]) if p['id']==v['pid']),None)
                if fs and pos and mid in MARKETS_FOR_REPORT:
                    fs={k:(float('nan') if x is None else x) for k,x in fs.items()};group=pos+' '+MARKETS_FOR_REPORT[mid]
                    p1=probability(old,augment(fs,old['columns'],group));p2=probability(cfg,augment(fs,cfg['columns'],group));shifts.append({'gid':v['gid'],'pid':v['pid'],'mid':mid,'delta_over_probability':p2-p1})
            changes+=sorted(shifts,key=lambda x:-abs(x['delta_over_probability']))[:5]
    report={'generated_utc':iso(now),'source_generated_utc':site.get('generated_utc'),'training_status':read_json(ROOT/'status.json',{}),
            'active':active,'manifest':manifest,'latest_graded_week':latest,'models':summary,'paired':stats(paired),'agreement':dict(agreement),'changes':changes,
            'learning_status':'descriptive monitoring; no model promotion or significance declaration','rules':RULES}
    report['checkpoint']={'activated_versions':len(versions),'eight_version_review_due':len(versions)>=8,
                          'regular_season_review_due':latest is not None and latest>=18}
    ROOT.mkdir(parents=True,exist_ok=True);write_json(ROOT/'weekly_report.json',report)
    pct=lambda x:'not enough data' if x is None else f'{100*x:+.1f}%'
    lines=['# Stix weekly learning report','',f'Generated: {iso(now)}',f'Active challenger: {version or "awaiting first Tuesday training"}',
           f'Training status: {report["training_status"].get("status","awaiting first training")}',
           '', '| Strategy | Week bets | Week ROI | Total bets | Total units | Total ROI | Pending |', '|---|---:|---:|---:|---:|---:|---:|']
    for v in summary.values():
        a=v['latest_week'];b=v['cumulative'];lines.append(f'| {v["name"]} | {a["bets"]} | {pct(a["roi"])} | {b["bets"]} | {b["units"]:+.2f} | {pct(b["roi"])} | {v["pending"]} |')
    lines+=['','## What we have learned',f'Matched graded opportunities: {len(common)}. Challenger minus frozen net units: {report["paired"]["units"]:+.2f}.',
            'A positive week is not proof of an edge. Comparing ROI alone changes the denominator when strategies select different numbers of bets.',
            'Calibration, market comparison, price sensitivity, concentration, paired uncertainty and version changes are included in weekly_report.json.',
            'Intervals require at least four independent week clusters and remain nominal; repeated weekly monitoring is not a stopping rule.',
            '', '## Data quality and limitations',
            f'Site snapshot used: {site.get("generated_utc")}. Training errors or delayed grades must be disclosed; unknown is not zero.',
            'No future outcomes entered original predictions. Later stat corrections may update grading, never the saved decisions.',
            'No causal injury or gameplan explanation is inferred from numerical patterns. No promotion occurs automatically.']
    if version is None:lines+=['','Challenger has no forward evidence yet; do not compare historical fit with frozen live returns.']
    (ROOT/'weekly_report.md').write_text('\n'.join(lines)+'\n')
    stamp=now.astimezone(__import__('zoneinfo').ZoneInfo('America/Chicago')).strftime('%G-W%V')
    archive=ROOT/'reports'/stamp;archive.mkdir(parents=True,exist_ok=True)
    write_json(archive/'report.json',report);(archive/'report.md').write_text('\n'.join(lines)+'\n')
    return str(ROOT/'weekly_report.md')

MARKETS_FOR_REPORT={'pass_yds':'player_pass_yds','rush_yds':'player_rush_yds','rec':'player_receptions','rec_yds':'player_reception_yds'}
