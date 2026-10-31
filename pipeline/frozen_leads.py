"""Append-only pregame decisions for research leads 9–12; standard-library inference.

Only coefficients/preprocessing are shipped, never historical training observations.
Records are created while the game is upcoming, then never recomputed or retracted.
"""
import math
import hashlib
from statistics import mean
from pathlib import Path
from .common import DATA, read_json, write_json, to_float, parse_iso, iso

MODEL_PATH = Path(__file__).with_name('frozen_models.json')
LEDGER_PATH = DATA / 'frozen_leads.json'
MARKETS = {'pass_yds': ('player_pass_yds', 'passing_yards'),
           'rush_yds': ('player_rush_yds', 'rushing_yards'),
           'rec': ('player_receptions', 'receptions'),
           'rec_yds': ('player_reception_yds', 'receiving_yards')}
NAN = float('nan')

def number(x):
    v = to_float(x)
    return v if v is not None and math.isfinite(v) else NAN

def clip(x, low, high):
    return max(low, min(high, x)) if math.isfinite(x) else NAN

def payout(o):
    return o / 100 if o > 0 else 100 / abs(o)

def probability(spec, features):
    """Exact sklearn median-imputation, missing indicators, scaling and logistic link."""
    raw = [number(features.get(c)) for c in spec['columns']]
    x = [v if math.isfinite(v) else spec['medians'][i] for i, v in enumerate(raw)]
    x += [float(not math.isfinite(raw[i])) for i in spec['indicators']]
    z = spec['intercept'] + sum(w * ((v - m) / s) for v, m, s, w in zip(x, spec['mean'], spec['scale'], spec['coef']))
    return 1 / (1 + math.exp(-clip(z, -700, 700)))

def augment(base, columns, group):
    f = dict(base)
    for c in columns:
        if '__X__' in c:
            a, b = c.split('__X__'); f[c] = f[a] * f[b]
        elif c.startswith('group_') and '__' in c:
            g, a = c.rsplit('__', 1); f[c] = float(g == 'group_' + group) * f[a]
        elif c.startswith('group_'):
            f[c] = float(c == 'group_' + group)
    return f

def decide(pos, mid, previous, line, op, up, features, models):
    """History is already ordered, verified offensive appearances, oldest first."""
    decisions = {}
    if pos == 'WR' and len(previous) >= 3:
        last = previous[-3:]
        if mid == 'rec_yds' and all(x.get('result') == 'over' for x in last):
            decisions['t9'] = {'side': 'under'}
        vals = [x.get('act') for x in last]
        if mid == 'rec' and all(v is not None and math.isfinite(v) for v in vals) and vals[0] < vals[1] < vals[2]:
            decisions['t10'] = {'side': 'under'}
    if mid not in MARKETS or not (pos == 'QB' if mid == 'pass_yds' else pos in ('QB', 'RB') if mid == 'rush_yds' else pos in ('RB', 'WR', 'TE')):
        return decisions
    group = pos + ' ' + MARKETS[mid][0]
    for lead, spec in models.items():
        p = probability(spec, augment(features, spec['columns'], group))
        oe, ue = p * (1 + payout(op)) - 1, (1 - p) * (1 + payout(up)) - 1
        side, edge = ('over', oe) if oe >= ue else ('under', ue)
        decisions[lead] = {'side': side, 'probability': p if side == 'over' else 1-p,
                           'edge': edge, 'qualifies': edge >= spec['threshold']}
    return decisions

class Features:
    def __init__(self, d, rows, script):
        self.d, self.rows, self.script = d, rows, script
        self.team_targets = {}
        for (gid, _), st in d.stats.items():
            if st.get('position') not in ('QB','RB','WR','TE','FB'):
                continue
            team = st.get('team'); k = (gid, team)
            self.team_targets[k] = self.team_targets.get(k, 0) + (to_float(st.get('targets')) or 0)

    def history(self, pid, before):
        hist = []
        known = {r['gid']:r for r in self.rows.get(pid, [])}
        for (gid, player), sn in self.d.snaps.items():
            if player != pid:
                continue
            g = self.d.games_by_id.get(gid, {})
            if not g.get('kickoff_utc') or g['kickoff_utc'] >= before or g.get('result', '') == '':
                continue
            if (to_float(sn.get('offense_snaps')) or 0) > 0:
                hist.append(known.get(gid, {'gid':gid,'ko':g['kickoff_utc'],'wk':int(g['week']),
                                           'team':sn.get('team'),'final':True,'m':{}}))
        return sorted(hist, key=lambda r: r['ko'])

    def stat(self, r, pid, col):
        st = self.d.stats.get((r['gid'], pid))
        return (to_float(st.get(col)) or 0.) if st else 0.

    def snap(self, r, pid):
        sn = self.d.snaps.get((r['gid'], pid))
        return number(sn.get('offense_pct')) if sn else NAN

    def share(self, r, pid, pos, mid):
        if mid == 'rush_yds':
            g = self.d.games_by_id.get(r['gid'], {})
            side = 'h' if r['team'] == g.get('home_team') else 'a'
            runs = self.script.get(r['gid'], {}).get('t', {}).get(side, {}).get('designed_runs')
            return self.stat(r, pid, 'carries') / runs if runs else NAN
        if pos == 'QB':
            return self.snap(r, pid)
        total = self.team_targets.get((r['gid'], r['team']))
        return self.stat(r, pid, 'targets') / total if total else NAN

    def make(self, pid, pos, r, mid, quote, hist):
        col = MARKETS[mid][1]; line = quote['line']
        # Preserve the fitted research transform's source-position filter and
        # missing-history fallback. Do not silently fix/retrain a frozen model.
        strict = [x for x in hist if self.d.snaps[(x['gid'],pid)].get('position') in ('QB','RB','WR','TE')]
        fallback = not strict
        hist = strict or sorted([x for x in self.rows.get(pid, []) if x.get('final') and x['ko'] < quote['cap']
                                and (x['gid'],pid) in self.d.stats], key=lambda x:x['ko'])
        vals = [self.stat(x, pid, col) for x in hist]
        us = [(self.share(x, pid, pos, 'rec') * 100 if pos in ('WR', 'TE') else self.snap(x, pid)*100) for x in hist]
        if fallback:
            if pos in ('WR','TE'):
                us = [self.stat(x,pid,'target_share')*100 for x in hist]
            else:
                us = [self.snap(x,pid)*100 for x in hist if self.d.snaps.get((x['gid'],pid),{}).get('position') in ('QB','RB','WR','TE','FB')]
        # Dataset target_share may be absent for zero-event appearances: count as zero.
        prev = next((x for x in reversed(self.rows.get(pid, [])) if x['ko'] < r['ko'] and x.get('final')), None)
        pm = prev.get('m', {}).get(mid, {}) if prev else {}
        pl = None
        if pm.get('lstat') == 'ok' and pm.get('res') in ('over','under','push'):
            # Research line changes are same-book, including when today's primary is FD.
            match = next((x for x in [pm, *pm.get('alt', [])] if x.get('book') == quote.get('book')), None)
            pl = match.get('line') if match else None
        delta = (line - pl) / max(1, pl) if pl is not None else NAN
        op, up = quote['op'], quote['up']
        ip, iu = 1/(1+payout(op)), 1/(1+payout(up))
        f = dict(line=line, away=float(r['ha'] == 'away'), nprior=len(hist),
                 last_ratio=clip(vals[-1]/max(1,line),0,10) if vals else NAN,
                 mean3_ratio=clip(mean(vals[-3:])/max(1,line),0,10) if vals else NAN,
                 mean5_ratio=clip(mean(vals[-5:])/max(1,line),0,10) if vals else NAN,
                 usage_last=us[-1] if us else NAN, usage_delta=mean(us[-2:])-mean(us[:-2]) if len(us)>=4 else NAN,
                 line_delta_ratio=clip(delta,-3,3), market_p=ip/(ip+iu),
                 share=NAN, share_change=NAN, snap_change=NAN, surprise=NAN,
                 rise3=float(vals[-3]<vals[-2]<vals[-1]) if len(vals)>=3 and not fallback else NAN,
                 fall3=float(vals[-3]>vals[-2]>vals[-1]) if len(vals)>=3 and not fallback else NAN)
        # These features reference the team's previous game, even if the player missed it.
        if prev and hist and not fallback and hist[-1]['gid'] == prev['gid']:
            f['share'] = self.share(prev,pid,pos,mid)
            if len(hist)>=4:
                early = hist[-4:-1]
                f['share_change'] = f['share']-mean(self.share(x,pid,pos,mid) for x in early)
                f['snap_change'] = self.snap(prev,pid)-mean(self.snap(x,pid) for x in early)
                baseline = mean(vals[-4:-1])
                f['surprise'] = clip(vals[-1]/baseline-1,-1,5) if baseline else NAN
        return f

def update(d, players, rows, now, path=LEDGER_PATH, model_path=MODEL_PATH):
    cfg = read_json(model_path, {}); start = cfg['frozen_at']; version = cfg['version']
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    saved = read_json(path, {'version': version, 'model_sha256': digest, 'frozen_at': start, 'records': {}})
    if saved.get('version') != version:
        raise ValueError('Frozen ledger version mismatch; use a new ledger for changed models')
    if saved.get('model_sha256') != digest:
        raise ValueError('Frozen model configuration changed; preserve the old version and ledger')
    records = saved['records']; script = read_json(DATA/'game_script.json', {}).get('games', {})
    engine = Features(d, rows, script); changed = False
    watchlist = {}
    for pid, p in players.items():
        for r in rows.get(pid, []):
            if r['ko'] <= iso(now) or r.get('final'):
                continue  # Never create or backfill a decision after kickoff.
            for mid, m in r.get('m', {}).items():
                key = '|'.join([r['gid'],pid,mid])
                if key in records or mid not in MARKETS:
                    continue
                preview = m.get('lstat') == 'pending'
                if preview:
                    snapshots = [x for x in m.get('snaps', []) if x.get('cap','') and x['cap'] <= iso(now)]
                    if not snapshots:
                        continue
                    source = max(snapshots, key=lambda x:x['cap'])
                elif m.get('lstat') == 'ok':
                    source = m
                else:
                    continue
                if not (source.get('cap','') and source['cap'] <= iso(now) < r['ko']) or (not preview and source['cap'] < start):
                    continue
                q = {k: source.get(k) for k in ('line','op','up','book','cap')}
                if any(q[k] is None for k in ('line','op','up')) or not q['op'] or not q['up']:
                    continue
                hist = engine.history(pid, q['cap'])
                prior = []
                for x in hist:
                    mm = x.get('m', {}).get(mid, {})
                    prior.append({'act': engine.stat(x,pid,MARKETS[mid][1]), 'result': mm.get('res')})
                f = engine.make(pid,p['pos'],r,mid,q,hist)
                ds = decide(p['pos'],mid,prior,q['line'],q['op'],q['up'],f,cfg['models'])
                entry = {'gid':r['gid'],'pid':pid,'mid':mid,'wk':r['wk'],'ko':r['ko'],
                                'observed_at':iso(now),'quote':q,'decisions':ds,
                                'feature_snapshot':{k:v if math.isfinite(v) else None for k,v in f.items()}}
                if preview:
                    watchlist[key] = {k:v for k,v in entry.items() if k != 'feature_snapshot'}
                else:
                    records[key] = entry
                    changed = True
    if changed or not path.exists():
        write_json(path, saved)
    return {**saved, 'watchlist': watchlist}
