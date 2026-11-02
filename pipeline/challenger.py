"""Expanding-history challenger. Training dependencies are isolated to train().

No Odds API calls, no modification of frozen coefficients/decisions, no retrospective
predictions credited as forward results. Runtime inference uses the frozen transform.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import csv
import io
import copy
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from .common import DATA, NFLVERSE, http_get, iso, utcnow, read_json, write_json, read_csv, norm_name, to_float
from .frozen_leads import Features, MARKETS, MODEL_PATH, augment, probability, update as predict

ROOT = DATA / 'challenger'
RULES = {'version':'expanding-interaction-v1','C':.01,'threshold':.10,
         'history':'2025 plus completed 2026 available at weekly cutoff',
         'training':'Tuesday 15:00 America/Chicago','report':'Wednesday morning America/Chicago',
         'promotion':'Never automatic; separate prospective record',
         'checkpoints':'After 8 activated versions and after regular season; weekly monitoring is descriptive'}

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def load_csv(url, cache):
    body, _, status = http_get(url, timeout=180)
    if status != 200: raise RuntimeError(f'Public NFL data unavailable: {status}')
    cache.parent.mkdir(parents=True, exist_ok=True); cache.write_bytes(body)
    return list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))

def quote_rows(season):
    """Fixed DK primary / FD fallback; no best-price hindsight or fabricated lines."""
    out=[]
    if season==2025:
        for path in sorted((DATA/'history_2025/odds').glob('*.json')):
            x=read_json(path, {}); ev=x['response']['data']
            for b in ev['bookmakers']:
                if b['key'] not in ('draftkings','fanduel'): continue
                for m in b['markets']:
                    mid=next((k for k,v in MARKETS.items() if v[0]==m['key']),None)
                    if mid is None: continue
                    pairs={}
                    for o in m['outcomes']: pairs.setdefault((o['description'],o['point']),{})[o['name']]=o['price']
                    for (name,line),p in pairs.items():
                        if 'Over' in p and 'Under' in p:
                            out.append(dict(gid=x['game_id'],mid=mid,nm=norm_name(name),line=line,op=p['Over'],up=p['Under'],
                                            book=b['key'],cap=x['requested_snapshot']))
    else:
        for r in read_csv(DATA/'prop_captures.csv'):
            if r.get('pull_type')!='pregame' or r.get('book') not in ('draftkings','fanduel'): continue
            mid=next((k for k,v in MARKETS.items() if v[0]==r['market']),None)
            if mid:
                vals=[to_float(r.get(k)) for k in ('line','over_price','under_price')]
                if all(v is not None for v in vals):
                    out.append(dict(gid=r['game_id'],mid=mid,nm=norm_name(r['player_book_name']),line=vals[0],op=vals[1],up=vals[2],book=r['book'],cap=r['captured_utc']))
    first={}
    for q in sorted(out,key=lambda q:(q['cap'],abs(q['op']-q['up']))):first.setdefault((q['gid'],q['nm'],q['mid'],q['book']),q)
    primary={}
    for q in sorted(first.values(),key=lambda q:q['book']!='draftkings'):primary.setdefault((q['gid'],q['nm'],q['mid']),q)
    return list(primary.values()),first

def dataset(season, cutoff, cache):
    stats=load_csv(f'{NFLVERSE}/stats_player/stats_player_week_{season}.csv',cache/f'stats_{season}.csv')
    snaps=load_csv(f'{NFLVERSE}/snap_counts/snap_counts_{season}.csv',cache/f'snaps_{season}.csv')
    schedule=read_json(DATA/'history_2025/schedule.json',[]) if season==2025 else read_csv(DATA/'schedule.csv')
    games={g['game_id']:g for g in schedule if g.get('game_type')=='REG'}
    completed={gid:g for gid,g in games.items() if g.get('result','')!='' and g['kickoff_utc']<iso(cutoff)}
    stats=[s for s in stats if s.get('season_type')=='REG' and s.get('game_id') in completed]
    snaps=[s for s in snaps if s.get('game_type')=='REG' and s.get('game_id') in completed]
    # Require complete source game coverage, including zero-event offensive appearances.
    missing_stats=set(completed)-{s['game_id'] for s in stats};missing_snaps=set(completed)-{s['game_id'] for s in snaps}
    unfinished=[g['game_id'] for g in games.values() if g['kickoff_utc']<iso(cutoff-timedelta(hours=12)) and g.get('result','')=='']
    if missing_stats or missing_snaps or unfinished:
        raise RuntimeError(f'Incomplete {season} outcomes: stats={sorted(missing_stats)}, snaps={sorted(missing_snaps)}, schedule={unfinished}')
    names={}
    for s in stats:names.setdefault(norm_name(s['player_display_name']),set()).add(s['player_id'])
    ids={n:next(iter(v)) for n,v in names.items() if len(v)==1}
    sm={(s['game_id'],s['player_id']):s for s in stats}
    sn={(s['game_id'],ids[norm_name(s['player'])]):s for s in snaps if norm_name(s['player']) in ids}
    d=SimpleNamespace(stats=sm,snaps=sn,games_by_id=games)
    # Designed-run share is the only PBP field in the frozen models. It must use
    # the exact denominator, not total QB/RB carries as a stand-in.
    pbp=load_csv_pbp(season,cache)
    runs={}
    for p in pbp:
        if p.get('game_id') not in completed or not p.get('posteam'):continue
        if p.get('play_type')!='no_play' and to_float(p.get('qb_kneel'))!=1 and to_float(p.get('rush_attempt'))==1 and to_float(p.get('qb_scramble'))!=1:
            k=(p['game_id'],p['posteam']);runs[k]=runs.get(k,0)+1
    script={gid:{'t':{side:{'designed_runs':runs.get((gid,g[team]),0)} for side,team in [('h','home_team'),('a','away_team')]}} for gid,g in completed.items()}
    quotes,allbooks=quote_rows(season)
    allbooks={k:q for k,q in allbooks.items() if q['gid'] in completed and q['cap']<completed[q['gid']]['kickoff_utc'] and q['cap']<iso(cutoff)}
    quotes=[q for q in quotes if q['gid'] in completed and q['cap']<completed[q['gid']]['kickoff_utc'] and q['cap']<iso(cutoff) and q['nm'] in ids]
    rows={};observations=[]
    for nm,pid in ids.items():
        by={}
        for (gid,p),s in sm.items():
            if p==pid:by[gid]=s['team']
        for (gid,p),s in sn.items():
            if p==pid:by[gid]=s['team']
        # Include the player's known team games even if inactive, for previous-team-game lines.
        teams=set(by.values())
        for gid,g in completed.items():
            if gid not in by and len(teams)==1 and next(iter(teams)) in (g['home_team'],g['away_team']):by[gid]=next(iter(teams))
        rr=[]
        for gid,team in by.items():
            g=games[gid];r={'gid':gid,'ko':g['kickoff_utc'],'wk':int(g['week']),'team':team,'final':True,'ha':'home' if team==g['home_team'] else 'away','m':{}}
            for mid in MARKETS:
                q=next((allbooks.get((gid,nm,mid,b)) for b in ('draftkings','fanduel') if allbooks.get((gid,nm,mid,b))),None)
                s=sm.get((gid,pid));n=sn.get((gid,pid));played=s is not None or (to_float((n or {}).get('offense_snaps')) or 0)>0
                if q and played:
                    act=to_float((s or {}).get(MARKETS[mid][1])) or 0.
                    other=[{**v,'book':'DraftKings' if b=='draftkings' else 'FanDuel'} for b in ('draftkings','fanduel') if (v:=allbooks.get((gid,nm,mid,b))) and b!=q['book']]
                    r['m'][mid]={**q,'book':'DraftKings' if q['book']=='draftkings' else 'FanDuel','lstat':'ok','res':'over' if act>q['line'] else 'under' if act<q['line'] else 'push','alt':other}
            rr.append(r)
        rows[pid]=sorted(rr,key=lambda r:r['ko'])
    engine=Features(d,rows,script)
    for q in quotes:
        pid=ids[q['nm']];s=sm.get((q['gid'],pid));n=sn.get((q['gid'],pid))
        if s is None and not (to_float((n or {}).get('offense_snaps')) or 0)>0:continue
        pos=(s or n).get('position');mid=q['mid']
        if pos not in ('QB','RB','WR','TE') or (mid=='pass_yds' and pos!='QB') or (mid=='rush_yds' and pos not in ('QB','RB')):continue
        r=next((r for r in rows[pid] if r['gid']==q['gid']),None)
        if r is None:continue
        act=to_float((s or {}).get(MARKETS[mid][1])) or 0.
        if act==q['line']:continue
        quote={**q,'book':'DraftKings' if q['book']=='draftkings' else 'FanDuel'}
        history=engine.history(pid,q['cap'])
        assert all(x['ko']<q['cap'] for x in history)
        fs=engine.make(pid,pos,r,mid,quote,history)
        observations.append((fs,pos+' '+MARKETS[mid][0],int(act>q['line']),q['gid'],q['cap']))
    return observations,{'season':season,'games':len(completed),'rows':len(observations),'ambiguous_names':len(names)-len(ids)}

def load_csv_pbp(season,cache):
    import gzip
    url=f'{NFLVERSE}/pbp/play_by_play_{season}.csv.gz';body,_,status=http_get(url,timeout=240)
    if status!=200:raise RuntimeError('PBP denominator source unavailable')
    (cache/f'pbp_{season}.csv.gz').write_bytes(body)
    return csv.DictReader(io.StringIO(gzip.decompress(body).decode('utf-8-sig')))

def export_model(model, columns):
    im,sc,lr=[s[1] for s in model.steps]
    return {'name':'weekly interaction challenger','threshold':.10,'columns':columns,'medians':im.statistics_.tolist(),
            'indicators':im.indicator_.features_.tolist(),'mean':sc.mean_.tolist(),'scale':sc.scale_.tolist(),
            'coef':lr.coef_[0].tolist(),'intercept':float(lr.intercept_[0])}

def train(now=None):
    import numpy as np
    import pandas as pd
    from sklearn.pipeline import make_pipeline
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LogisticRegression
    now=now or utcnow();local=now.astimezone(ZoneInfo('America/Chicago'));version='challenger-'+local.strftime('%G-W%V')
    folder=ROOT/'versions'/version;cfgpath=folder/'model.json'
    if cfgpath.exists():return {'status':'already_trained','version':version}
    ROOT.mkdir(parents=True,exist_ok=True);frozen_hash=digest(MODEL_PATH)
    cache=DATA.parent/'.cache/challenger'/version;cache.mkdir(parents=True,exist_ok=True)
    reference=read_json(MODEL_PATH,{})['models']['t12'];columns=reference['columns']
    policy={'rules':RULES,'columns':columns,'feature_code_sha256':digest(Path(__file__).with_name('frozen_leads.py')),
            'training_code_sha256':digest(__file__)}
    prior_policy=read_json(ROOT/'policy.json',policy)
    if prior_policy!=policy:raise RuntimeError('Learning procedure changed: requires a new experiment version')
    allrows=[];coverage=[]
    for y in [2025,2026]:
        obs,cov=dataset(y,now,cache);allrows+=obs;coverage.append(cov)
    if len(allrows)<3000 or not any(x['season']==2026 and x['rows'] for x in coverage):raise RuntimeError('Insufficient training coverage')
    x=pd.DataFrame([augment(a,columns,g) for a,g,_,_,_ in allrows])[columns].replace([np.inf,-np.inf],np.nan);y=np.array([a[2] for a in allrows])
    data_hash=hashlib.sha256(x.to_numpy(dtype=float).tobytes()+y.tobytes()+json.dumps([(a[3],a[4]) for a in allrows]).encode()).hexdigest()
    active=read_json(ROOT/'active.json',{}).get('version')
    last_manifest=read_json(ROOT/'versions'/str(active)/'manifest.json',{})
    if last_manifest.get('training_dataset_sha256')==data_hash:
        status={'status':'no_new_data','version':active,'at':iso(now)};write_json(ROOT/'status.json',status)
        return status
    model=make_pipeline(SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True),StandardScaler(),LogisticRegression(C=.01,max_iter=3000,random_state=601))
    model.fit(x,y);spec=export_model(model,columns)
    if not np.allclose(model.predict_proba(x.iloc[:100])[:,1],[probability(spec,r) for r in x.iloc[:100].to_dict('records')],atol=1e-12):raise RuntimeError('Portable inference parity failed')
    activated=utcnow();cfg={'version':version,'frozen_at':iso(activated),'models':{'t13':spec}}
    manifest={'rules':RULES,'training_cutoff_utc':iso(now),'activated_utc':iso(activated),'coverage':coverage,'rows':len(x),'training_dataset_sha256':data_hash,
              'inputs':{p.name:digest(p) for p in cache.iterdir()},'feature_code_sha256':digest(Path(__file__).with_name('frozen_leads.py')),
              'training_code_sha256':digest(__file__),'frozen_config_sha256':frozen_hash,'columns':columns,
              'calibration':'No mapping fitted; evaluate forward calibration','limitations':'Historical corrections/publication times unavailable; no injury/news assumptions'}
    if digest(MODEL_PATH)!=frozen_hash:raise RuntimeError('Frozen model unexpectedly modified')
    folder.mkdir(parents=True);write_json(cfgpath,cfg);write_json(folder/'manifest.json',manifest);write_json(ROOT/'policy.json',policy)
    # Immutable first version files are complete before active pointer changes.
    write_json(ROOT/'active.json',{'version':version});status={'status':'activated','version':version,'at':iso(activated)};write_json(ROOT/'status.json',status)
    return status

def update(d,players,rows,now):
    active=read_json(ROOT/'active.json',{});version=active.get('version');records={}
    for p in sorted((ROOT/'ledgers').glob('*.json')):
        for k,v in read_json(p,{}).get('records',{}).items():records.setdefault(k,{**v,'model_version':p.stem})
    if not version:return {'records':records,'watchlist':{},'status':read_json(ROOT/'status.json',{'status':'awaiting_first_training'})}
    cfgpath=ROOT/'versions'/version/'model.json';cfg=read_json(cfgpath,{})
    if cfg.get('frozen_at','')>iso(now):raise ValueError('Challenger activation is in the future')
    own=read_json(ROOT/'ledgers'/f'{version}.json',{}).get('records',{})
    previous=set(records)-set(own)
    filtered={pid:[{**r,'m':{mid:m for mid,m in r.get('m',{}).items() if '|'.join([r['gid'],pid,mid]) not in previous}} for r in rs] for pid,rs in rows.items()}
    result=predict(d,players,filtered,now,path=ROOT/'ledgers'/f'{version}.json',model_path=cfgpath)
    for k,v in result['records'].items():records[k]={**v,'model_version':version}
    def public(v):return {**{k:x for k,x in v.items() if k!='feature_snapshot'},'decisions':{'t13':v['decisions']['t13']} if 't13' in v['decisions'] else {}}
    return {'version':version,'frozen_at':cfg['frozen_at'],'records':{k:public(v) for k,v in records.items()},
            'watchlist':{k:public({**v,'model_version':version}) for k,v in result['watchlist'].items()},'status':read_json(ROOT/'status.json',{})}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['train','report']);args=parser.parse_args()
    try:
        if args.action=='train':print(json.dumps(train()))
        else:
            from .challenger_report import build_report
            print(build_report())
    except Exception as e:
        ROOT.mkdir(parents=True,exist_ok=True);write_json(ROOT/'status.json',{'status':'failed','at':iso(utcnow()),'error':str(e),'previous_active':read_json(ROOT/'active.json',{})})
        raise
