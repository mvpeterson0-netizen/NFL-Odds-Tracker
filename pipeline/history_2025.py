"""One-off five-market 2025 archive. Never writes live captures or site data.

Historical access requires the paid key. Free keys are used first by the LIVE
collector instead. Every billable request gets a fresh, free quota check; a
request is only made when its maximum cost leaves at least 500 paid credits.
A persisted stop and a pre-reset deadline prevent spending next month's quota.
"""
from datetime import timedelta
import json
import os

from .common import (DATA, NFLVERSE, http_get, iso, kickoff_utc, parse_iso,
                     read_csv_bytes, read_json, utcnow, write_json)
from .credit_policy import BACKFILL_DEADLINE, PAID_RESERVE
from .odds import API, SPORT, BOOKS, EXTRA_BOOKS, CORE, fetch_events, match_event

ROOT = DATA / 'history_2025'
STATE = ROOT / 'state.json'
HIST = f'{API}/historical/sports/{SPORT}'
MAX_GAMES_PER_RUN = 16
MAX_ERRORS = 3


class Pause(Exception):
    pass


class Stop(Exception):
    pass


def schedule():
    path = ROOT / 'schedule.json'
    if path.exists():
        return read_json(path, [])
    body, _, status = http_get(f'{NFLVERSE}/schedules/games.csv', timeout=60)
    if status != 200:
        raise Pause('schedule unavailable')
    games = []
    for r in read_csv_bytes(body):
        if r.get('season') == '2025' and r.get('game_type') == 'REG':
            ko = kickoff_utc(r['gameday'], r['gametime'])
            if ko is None:
                raise Pause('missing kickoff')
            games.append({**r, 'kickoff_utc': iso(ko)})
    if len(games) != 272:
        raise Pause('incomplete regular-season schedule')
    games.sort(key=lambda g: (g['kickoff_utc'], g['game_id']))
    write_json(path, games)
    return games


def quota(key, state, max_cost):
    if utcnow() >= BACKFILL_DEADLINE:
        raise Stop('deadline reached; do not use the reset allowance')
    try:
        _, headers = fetch_events(key)  # free, no historical endpoint required
    except RuntimeError:
        raise Pause('cannot verify paid balance') from None
    rem = headers.get('x-requests-remaining', '')
    if not rem.isdigit():
        raise Pause('missing paid balance; no spending allowed')
    balance = int(rem)
    prior = state.get('paid_remaining')
    if prior is not None and balance > prior:
        raise Stop('balance increased; reset or plan change requires a new decision')
    state['paid_remaining'] = balance
    if balance - max_cost < PAID_RESERVE:
        raise Stop(f'paid reserve protected: {balance} remaining, next request up to {max_cost}')


def request(key, state, endpoint, params, max_cost):
    quota(key, state, max_cost)
    # No automatic billable retries: an uncertain response might have been charged.
    body, h, status = http_get(endpoint, {**params, 'apiKey': key}, retries=1)
    rem = h.get('x-requests-remaining', '')
    if not rem.isdigit():
        raise Pause('missing response balance; stopped before any further spending')
    state['paid_remaining'] = int(rem)
    state['credits_spent'] = state.get('credits_spent', 0) + int(h.get('x-requests-last', '0') or '0')
    if status in (401, 403, 429):
        raise Stop(f'paid API rejected request (HTTP {status})')
    if status != 200:
        raise Pause(f'API HTTP {status}')
    return json.loads(body)


def run(key, log):
    if not key:
        return
    state = read_json(STATE, {}) or {}
    if state.get('stopped') or state.get('complete'):
        return
    if utcnow() >= BACKFILL_DEADLINE:
        return
    state.setdefault('markets', list(CORE))
    state.setdefault('games', {})
    state['reserve'] = PAID_RESERVE
    state['deadline_utc'] = iso(BACKFILL_DEADLINE)
    count = 0
    try:
        games = schedule()
        for g in games:
            gid = g['game_id']
            if (ROOT / 'odds' / f'{gid}.json').exists():
                state['games'][gid] = {'status': 'saved'}
                continue
            if state['games'].get(gid, {}).get('status') in ('empty', 'not_found', 'error_limit'):
                continue
            if count >= MAX_GAMES_PER_RUN:
                break
            count += 1
            ko = parse_iso(g['kickoff_utc'])
            date = iso(ko - timedelta(hours=3))
            cache = ROOT / 'events' / (date.replace(':', '-') + '.json')
            try:
                events = read_json(cache, None)
                if events is None:
                    events = request(key, state, f'{HIST}/events', {
                        'date': date, 'dateFormat': 'iso',
                        'commenceTimeFrom': iso(ko - timedelta(hours=1)),
                        'commenceTimeTo': iso(ko + timedelta(hours=1)),
                    }, 1)
                    write_json(cache, events)
                event = match_event(g, events.get('data', []))
                if event is None:
                    state['games'][gid] = {'status': 'not_found', 'date': date}
                    continue
                snapshot = request(key, state, f"{HIST}/events/{event['id']}/odds", {
                    'date': date, 'dateFormat': 'iso', 'oddsFormat': 'american',
                    'bookmakers': ','.join(BOOKS + EXTRA_BOOKS), 'markets': ','.join(CORE),
                }, 10 * len(CORE))
                # Preserve complete raw payload incl. all books, players, odds and timestamps.
                write_json(ROOT / 'odds' / f'{gid}.json', {
                    'game_id': gid, 'requested_snapshot': date, 'downloaded_utc': iso(utcnow()),
                    'markets': list(CORE), 'response': snapshot,
                })
                state['games'][gid] = {'status': 'saved', 'snapshot': snapshot.get('timestamp')}
            except Pause as ex:
                prior = state['games'].get(gid, {})
                errors = prior.get('errors', 0) + 1
                state['games'][gid] = {'status': 'error_limit' if errors >= MAX_ERRORS else 'error',
                                       'errors': errors, 'note': str(ex)}
                raise
            finally:
                write_json(STATE, state)
        finished = sum(x.get('status') in ('saved', 'not_found', 'empty', 'error_limit') for x in state['games'].values())
        state['complete'] = finished == len(games)
        state['saved_games'] = sum(x.get('status') == 'saved' for x in state['games'].values())
        state['unprocessed_games'] = len(games) - finished
        log.append(f"history 2025: {state['saved_games']} saved; {state['unprocessed_games']} unprocessed; paid balance {state.get('paid_remaining', '?')}")
    except Stop as ex:
        state['stopped'] = str(ex)
        log.append(f'history 2025: stopped — {ex}')
    except Pause as ex:
        log.append(f'history 2025: paused — {ex}')
    finally:
        state['saved_games'] = sum(x.get('status') == 'saved' for x in state['games'].values())
        state['updated_utc'] = iso(utcnow())
        write_json(STATE, state)
