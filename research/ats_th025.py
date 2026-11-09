"""TH-025 historical prior ATS versus player prop O/U. Discovery only; no paid APIs."""
import csv,json,io,urllib.request
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from pipeline.common import DATA,NFLVERSE,norm_name,to_float
from pipeline.frozen_leads import MARKETS
REV={v[0]:k for k,v in MARKETS.items()}
OUT=DATA/'challenger'/'ats_th025'
def date(s):return datetime.fromisoformat(str(s).replace('Z','+00:00'))
def payout(p):return p/100 if p>0 else 100/abs(p)
def schedules():
 with open(DATA/'history_2025/schedule.json') as f:games=json.load(f)
 with open(DATA/'schedule.csv') as f:games+=list(csv.DictReader(f))
 return {g['game_id']:g for g in games if g.get('game_type')=='REG' and g.get('result') not in ('',None) and g.get('kickoff_utc')}
def prior(games):
 hist=defaultdict(list)
 for g in games.values():
  s=to_float(g.get('spread_line'));h=to_float(g.get('home_score'));a=to_float(g.get('away_score'))
  if None in (s,h,a):continue
  m=h-a-s
  for t,v in ((g['home_team'],m),(g['away_team'],-m)):hist[(g['game_id'][:4],t)].append((g['kickoff_utc'],v,g['game_id']))
 prev={}
 for (_,team),games0 in hist.items():
  games0.sort()
  for i in range(1,len(games0)):prev[(games0[i][2],team)]=games0[i-1][1]
 return prev
def quotes(games):
 chosen={}
 def add(gid,name,mid,book,stamp,line,op,up):
  g=games.get(gid)
  if not g or not name or mid not in MARKETS or book not in ('draftkings','fanduel'):return
  try:
   diff=(date(g['kickoff_utc'])-date(stamp)).total_seconds()
   if not 0<diff<=4*3600:return
   line=float(line);op=float(op);up=float(up)
   if not op or not up:return
  except (TypeError,ValueError):return
  key=(gid,norm_name(name),mid);rank=(book!='draftkings',abs(diff-10800))
  if key not in chosen or rank<chosen[key][0]:chosen[key]=(rank,(gid,norm_name(name),mid,book,line,op,up))
 for path in sorted((DATA/'history_2025/odds').glob('*.json')):
  with open(path) as f:x=json.load(f)
  for b in x['response']['data'].get('bookmakers',[]):
   if b['key'] not in ('draftkings','fanduel'):continue
   for m in b.get('markets',[]):
    mid=REV.get(m.get('key'))
    if not mid:continue
    pairs=defaultdict(dict)
    for o in m.get('outcomes',[]):pairs[(o.get('description'),o.get('point'))][o.get('name')]=o.get('price')
    for (name,line),pr in pairs.items():
     if 'Over' in pr and 'Under' in pr:add(x['game_id'],name,mid,b['key'],x['requested_snapshot'],line,pr['Over'],pr['Under'])
 with open(DATA/'prop_captures.csv') as f:
  for r in csv.DictReader(f):
   if r.get('pull_type')=='pregame':
    mid=REV.get(r.get('market'))
    if mid:add(r.get('game_id'),r.get('player_book_name'),mid,r.get('book'),r.get('captured_utc'),r.get('line'),r.get('over_price'),r.get('under_price'))
 return [z[1] for z in chosen.values()]

def observations(games,prev,qs):
 names=defaultdict(set);stats={}
 for season in (2025,2026):
  url=f'{NFLVERSE}/stats_player/stats_player_week_{season}.csv'
  with urllib.request.urlopen(url,timeout=180) as f:rr=list(csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig')))
  for r in rr:
   if r.get('season_type')!='REG' or r.get('game_id') not in games:continue
   n=norm_name(r.get('player_display_name',''));pid=r.get('player_id')
   if not n or not pid:continue
   names[(season,n)].add(pid);stats[(r['game_id'],pid)]=r
 out=[];miss=0;noprev=0;push=0
 for gid,name,mid,book,line,op,up in qs:
  ids=names.get((int(gid[:4]),name),set())
  if len(ids)!=1:miss+=1;continue
  r=stats.get((gid,next(iter(ids))))
  if not r:miss+=1;continue
  pos=r.get('position')
  if (mid=='pass_yds' and pos!='QB') or (mid=='rush_yds' and pos not in ('QB','RB')) or (mid in ('rec','rec_yds') and pos not in ('RB','WR','TE')):continue
  g=games[gid];team=r.get('team')
  if team not in (g['home_team'],g['away_team']):miss+=1;continue
  opp=g['away_team'] if team==g['home_team'] else g['home_team']
  a=prev.get((gid,team));b=prev.get((gid,opp))
  if a is None or b is None:noprev+=1;continue
  val=to_float(r.get(MARKETS[mid][1]))
  if val is None:miss+=1;continue
  if val==line:push+=1;continue
  def state(x):return 'C' if x>0 else 'NC' if x<0 else 'P'
  home=(team==g['home_team']);sp=to_float(g.get('spread_line'))
  if sp is None:continue
  teamsp=-sp if home else sp
  margin='bigC' if a>=7 else 'smallC' if a>0 else 'bigNC' if a<=-7 else 'smallNC' if a<0 else 'P'
  for side,price,win in (('over',op,val>line),('under',up,val<line)):
   out.append(dict(gid=gid,season=int(gid[:4]),week=int(g['week']),market=mid,position=pos,side=side,
       state=state(a)+'/'+state(b),team_state=state(a),opp_state=state(b),margin=margin,
       role='fav' if teamsp<0 else 'dog' if teamsp>0 else 'pick',location='home' if home else 'away',
       win=int(win),profit=payout(price) if win else -1))
 return out,dict(unmatched_quotes=miss,no_prior_ATS=noprev,pushes=push)
def summary(items):
 n=len(items);w=sum(z['win'] for z in items)
 return dict(n=n,wins=w,losses=n-w,games=len({z['gid'] for z in items}),weeks=len({(z['season'],z['week']) for z in items}),
     n2025=sum(z['season']==2025 for z in items),n2026=sum(z['season']==2026 for z in items),
     hit_pct=round(100*w/n,2),roi_pct=round(100*sum(z['profit'] for z in items)/n,2))
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 games=schedules();prev=prior(games);qs=quotes(games)
 obs,diag=observations(games,prev,qs)
 if not obs:raise RuntimeError('No graded props; inspect upstream data before reporting')
 baseline=defaultdict(list)
 for z in obs:baseline[(z['market'],z['position'],z['side'])].append(z)
 families={
  'joint':('state','market','position','side'),
  'joint_market':('state','market','side'),
  'all_market':('state','side'),
  'team':('team_state','market','position','side'),
  'opponent':('opp_state','market','position','side'),
  'margin':('margin','market','position','side'),
  'role':('state','role','market','position','side'),
  'location':('state','location','market','position','side')}
 results=[]
 for family,fields in families.items():
  groups=defaultdict(list)
  for z in obs:groups[tuple(z[k] for k in fields)].append(z)
  for key,items in groups.items():
   row=dict(family=family,**dict(zip(fields,key)),**summary(items))
   if 'position' in fields:
    b=summary(baseline[(items[0]['market'],items[0]['position'],items[0]['side'])])
    row.update(baseline_hit_pct=b['hit_pct'],baseline_roi_pct=b['roi_pct'],lift_pp=round(row['hit_pct']-b['hit_pct'],2))
   results.append(row)
 cols=sorted({k for z in results for k in z})
 with open(OUT/'all_buckets.csv','w',newline='') as f:
  w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows(results)
 selected=sorted([z for z in results if z['family']=='joint' and z['n']>=100 and z['games']>=30 and z['n2025']>=30 and z['n2026']>=10],key=lambda x:x['roi_pct'],reverse=True)
 report=dict(thesis='TH-025',status='historical_discovery_only',quotes=len(qs),graded_props=len(obs)//2,
  **diag,overall_states=[z for z in results if z['family']=='all_market'],
  sampled_joint_buckets=selected[:30],n_sampled_joint=len(selected),
  caveats=['No prospective positive-EV result established','Exploratory multiple comparisons and game clustering can inflate apparent edge','DK preferred, FD fallback at pregame capture; sample coverage may vary by season and market','Pushes excluded from denominators; prior ATS pushes separate'])
 with open(OUT/'report.json','w') as f:json.dump(report,f,indent=2)
 with open(OUT/'report.md','w') as f:
  f.write('# TH-025 ATS state vs player props\n\n**Exploratory data, not a validated signal.**\n\n')
  f.write(f"Graded {len(obs)//2} props across {len(qs)} lines. {diag}\n\n")
  for title,items in [('Overall prior-game ATS combinations',report['overall_states']),('Top market-position sample-qualified combinations',selected[:30])]:
   f.write('## '+title+'\n\n| ATS | Market | Position | Side | Bets | Wins | Hit % | ROI % | Lift | 2025 / 2026 |\n|---|---|---|---|---:|---:|---:|---:|---:|---|\n')
   for z in items:
    f.write('| '+' | '.join(str(z.get(k,'')) for k in ('state','market','position','side','n','wins','hit_pct','roi_pct','lift_pp'))+f" | {z['n2025']} / {z['n2026']} |\n")
   f.write('\n')
  f.write('All tested rows: all_buckets.csv. No multiple-comparison-adjusted or prospective EV claim.\n')
 print(json.dumps({k:v for k,v in report.items() if k not in ('overall_states','sampled_joint_buckets')},indent=2))
if __name__=='__main__':main()
