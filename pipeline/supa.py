"""Send each game's kickoff time to the Stix accounts database (Supabase table `games`).

The database uses these times to lock picks at kickoff, so it never relies on a phone's clock.
Runs every pipeline run (about 270 small rows). Skipped when SUPABASE_SERVICE_KEY isn't set
(e.g. local runs). A failure here is logged and never stops the rest of the run.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from .common import USER_AGENT

# Project URL is not secret. The key comes only from the SUPABASE_SERVICE_KEY secret.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hewbbugkbycdkazlwspq.supabase.co").rstrip("/")


def _headers(key: str) -> dict:
    h = {"apikey": key, "Content-Type": "application/json", "User-Agent": USER_AGENT,
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    if not key.startswith("sb_"):  # older JWT-style service_role key also goes in Authorization
        h["Authorization"] = f"Bearer {key}"
    return h


def kickoff_rows(games: list[dict]) -> list[dict]:
    rows = []
    for g in games:
        gid, ko, wk = g.get("game_id", ""), g.get("kickoff_utc", ""), g.get("week", "")
        if gid and ko and str(wk).isdigit():  # games without a set kickoff time are skipped
            rows.append({"game_id": gid, "week": int(wk), "kickoff": ko})
    return rows


def sync_games(games: list[dict], log: list[str], announce: bool = False) -> None:
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not key:
        return
    rows = kickoff_rows(games)
    if not rows:
        return
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/games?on_conflict=game_id",
                                 data=json.dumps(rows).encode(), headers=_headers(key), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if announce:
                log.append(f"accounts db: {len(rows)} kickoffs sent ({resp.status})")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        log.append(f"accounts db: kickoff sync failed (HTTP {e.code}: {body})")
    except Exception as e:  # network trouble etc.; try again next run
        log.append(f"accounts db: kickoff sync failed ({type(e).__name__}: {e})"[:300])


def sync_signal_research(rows: list[dict], log: list[str]) -> None:
    """Admin-only research rows for Signal Stacks (table `signal_research`, supabase/014_signal_research.sql).
    Rows: {id, kind, body}.  The table has row-level security and no public policy; only admin_signal_research() reads it.
    Skipped without SUPABASE_SERVICE_KEY; a failure is logged and never stops the run."""
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not key or not rows:
        return
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/signal_research?on_conflict=id",
                                 data=json.dumps(rows).encode(), headers=_headers(key), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        log.append(f"signal stacks: admin sync failed (HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:160]})")
    except Exception as e:
        log.append(f"signal stacks: admin sync failed ({type(e).__name__}: {e})"[:300])


def read_signal_research(row_id: str):
    """Read one admin-only row body with the service key.  Returns (status, body): ('absent', None) when the row does not
    exist, ('ok', body), or ('error', None) on any failure (the caller must then NOT create or overwrite state)."""
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not key:
        return "nokey", None
    h = _headers(key); h.pop("Prefer", None)
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/signal_research?id=eq.{row_id}&select=body", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            rows = json.loads(r.read().decode())
    except Exception:
        return "error", None
    return ("ok", rows[0]["body"]) if rows else ("absent", None)
