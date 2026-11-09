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
