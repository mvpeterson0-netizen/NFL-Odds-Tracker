"""Free-first live keys and a temporary paid-key reserve for the 2025 backfill."""
import os
from datetime import datetime, timezone

PAID_RESERVE = 0
# Before Nov 1 in either UTC or Central: never spend a newly reset allowance.
BACKFILL_DEADLINE = datetime(2026, 11, 1, tzinfo=timezone.utc)


def live_keys():
    names = ['ODDS_API_KEY'] + [f'ODDS_API_KEY_{i}' for i in range(2, 7)]
    paid = os.environ.get('ODDS_API_KEY_20K', '').strip()
    free = [os.environ.get(n, '').strip() for n in names]
    # A duplicated paid secret must never get classified as a free key.
    return list(dict.fromkeys(k for k in free if k and k != paid)) + ([paid] if paid else [])


def floor_for(key):
    paid = os.environ.get('ODDS_API_KEY_20K', '').strip()
    return PAID_RESERVE if key == paid and datetime.now(timezone.utc) < BACKFILL_DEADLINE else 0


def pick_live(left, keys, preferred, core, skip=()):
    """Try each key's full OR core pull before moving on to the paid key."""
    for i, balance in left.items():
        if i in skip or balance is None:
            continue  # Unknown balances cannot authorize spending.
        spendable = balance - floor_for(keys[i - 1])
        if spendable >= preferred:
            return i, preferred
        if spendable >= core:
            return i, core
    return None, None
