"""Separate research hypothesis registry and conservative weekly evidence rollup.

Never modify fitted models or count exploratory Week 8 discovery as validation.
An unimplemented thesis stays explicitly in needs_data until its test is authored.
"""
from __future__ import annotations
from collections import defaultdict
from .common import DATA, read_json

REGISTRY_PATH=DATA/'challenger'/'theses.json'
VALID={'monitoring','needs_data','existing_frozen_lead','validated','rejected','paused','historical_descriptive'}
LATEST_SCHEMA=1

def registry():
    src=read_json(REGISTRY_PATH,{})
    if src.get('schema_version')!=LATEST_SCHEMA:
        raise ValueError('Thesis registry schema changed unexpectedly')
    items=src.get('entries',[])
    ids=[x['id'] for x in items]
    if len(ids)!=len(set(ids)):
        raise ValueError('Duplicate research thesis ID')
    for x in items:
        if x['status'] not in VALID:
            raise ValueError('Unknown thesis status '+str(x['status']))
    return src

def summarize_bucket(b):
    if not b:return None
    return {k:b.get(k) for k in ('bets','wins','losses','pushes','units','roi')}

def weekly_rollup(reg=None,diagnostics=None,model_summary=None):
    reg=reg or registry()
    diagnostics=diagnostics or {}
    model_summary=model_summary or {}
    out=[]
    leads=diagnostics.get('leads',{})
    for thesis in reg['entries']:
        item={k:v for k,v in thesis.items() if k not in ('notes',)}
        item['notes']=thesis.get('notes','')
        src=thesis.get('metric_source') or {}
        readings=[]
        if src.get('type')=='locked_model_diagnostics':
            segment=src['segment']
            for model in src.get('lead_ids',[]):
                lead=leads.get(model,{})
                for week,w in sorted(lead.get('weeks',{}).items(),key=lambda x:int(x[0])):
                    bucket=w.get('segments',{}).get(segment,{})
                    row=bucket.get('flagged')
                    if row is None:continue
                    # Week 8 is the discovery basis; never call it validation.
                    evidence_phase='discovery' if int(week)<=8 else 'forward_monitoring'
                    readings.append({'model':model,'week':int(week),
                        'phase':evidence_phase,'flagged':summarize_bucket(row),
                        'comparison':summarize_bucket(bucket.get('other'))})
        elif src.get('type')=='existing_frozen_leads':
            lead_id=src['lead_id']
            metric=model_summary.get(lead_id)
            if metric:
                readings.append({'model':lead_id,'phase':'existing_separate_forward_ledger',
                                 'cumulative':metric.get('cumulative'),
                                 'latest_week':metric.get('latest_week'),
                                 'pending':metric.get('pending'),
                                 'void':metric.get('void')})
        item['evidence']=readings
        item['observed_weeks']=sorted({r['week'] for r in readings if 'week' in r and r['phase']=='forward_monitoring'})
        # Transparent: measurements and actual prospective *testing* are different.
        item['test_implemented']=bool(src.get('type') in ('locked_model_diagnostics','existing_frozen_leads'))
        item['conclusion']='Not established; no automatic promotion'
        out.append(item)
    return {'schema_version':1,'registry_count':len(out),'tracked':out,
            'limitations':['Observational buckets share correlated same-player bets and were suggested after reviewing Week 8.',
                           'Only locked pregame model selections can contribute units; no odds are invented for unselected candidates.',
                           'Weekly diagnostic monitoring is not a separately powered, independent bet selection experiment.',
                           'Needs-data hypotheses have no performance statistics until a predeclared implementation exists.',
                           'Never overwrite or silently revise a registered thesis; changes require versioned definitions.']}

def markdown_lines(rollup):
    items=rollup['tracked'];lines=['','## Research thesis registry',
        f'{len(items)} registered independent hypotheses. Results are observational unless a prospective test is explicitly implemented.',
        '| ID | Thesis | State | Evidence |',
        '|---|---|---|---|']
    for x in items:
        readings=x['evidence']
        forward=[r for r in readings if r.get('phase')=='forward_monitoring']
        discovery=[r for r in readings if r.get('phase')=='discovery']
        if forward:
            weeks=sorted({r['week'] for r in forward})
            info=f'Forward monitoring week(s) {", ".join(map(str,weeks))}; descriptive only'
        elif discovery:
            info='Week 8 discovery only; awaiting prospective weeks'
        elif readings:
            info='Existing T9/T10 forward ledger'
        else:
            info='No qualifying evidence yet' if x['test_implemented'] else 'Testing implementation needed'
        lines.append('| '+ ' | '.join([x['id'],x['title'].replace('|','/'),x['status'],info])+' |')
    lines+=['','**Research safeguards:** Every thesis has its own stable ID. The T12 frozen model and T13 Challenger remain untouched; weekly research findings alone cannot promote a strategy. Missing independent tests are identified rather than given fictional returns.',
            'Week 8 triggered several new hypotheses; that same week is treated as discovery, not forward confirmation.']
    return lines
