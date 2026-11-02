"""Supabase access for college football (CFB) data.

The Stix repo is public, so CFB lines and results are NOT committed to it; the pipeline writes them to the
accounts database (tables in supabase/011_cfb.sql) with the server key, and only signed-in users who confirmed
21+ can read them. Standard library only. Nothing here runs without SUPABASE_SERVICE_KEY (local runs skip CFB).

`Store` talks to Supabase's REST interface. `MemoryStore` has the same methods for tests.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from .common import USER_AGENT

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hewbbugkbycdkazlwspq.supabase.co").rstrip("/")
PAGE = 1000   # Supabase returns at most 1000 rows per request by default
CHUNK = 500   # rows per write request


class StoreError(RuntimeError):
    pass


def _headers(key: str, prefer: str | None = None) -> dict:
    h = {"apikey": key, "Content-Type": "application/json", "User-Agent": USER_AGENT}
    if not key.startswith("sb_"):  # older JWT-style service_role key also goes in Authorization
        h["Authorization"] = f"Bearer {key}"
    if prefer:
        h["Prefer"] = prefer
    return h


class Store:
    def __init__(self, key: str, url: str = SUPABASE_URL):
        self.key, self.url = key, url.rstrip("/")

    def _req(self, method, path, params=None, body=None, prefer=None):
        q = ("?" + urllib.parse.urlencode(params, safe="(),.*")) if params else ""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}{q}", data=data, method=method,
                                     headers=_headers(self.key, prefer))
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise StoreError(f"{method} {path}: HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}") from None
        except Exception as e:  # network trouble etc.
            raise StoreError(f"{method} {path}: {type(e).__name__}: {e}"[:300]) from None

    def select(self, table: str, params: dict | None = None) -> list[dict]:
        """All matching rows (pages through Supabase's 1000-row limit). `params` are PostgREST filters,
        e.g. {"select": "game_id,status", "game_id": "in.(1,2)", "order": "game_id"}."""
        out, offset = [], 0
        while True:
            p = dict(params or {})
            p.update({"limit": PAGE, "offset": offset})
            rows = self._req("GET", table, p) or []
            out.extend(rows)
            if len(rows) < PAGE:
                return out
            offset += PAGE

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        for i in range(0, len(rows), CHUNK):
            self._req("POST", table, {"on_conflict": on_conflict}, rows[i:i + CHUNK],
                      "resolution=merge-duplicates,return=minimal")

    def insert_ignore(self, table: str, rows: list[dict], on_conflict: str) -> None:
        """Insert rows; rows that already exist (same on_conflict key) are skipped."""
        for i in range(0, len(rows), CHUNK):
            self._req("POST", table, {"on_conflict": on_conflict}, rows[i:i + CHUNK],
                      "resolution=ignore-duplicates,return=minimal")

    def insert(self, table: str, rows: list[dict]) -> None:
        for i in range(0, len(rows), CHUNK):
            self._req("POST", table, None, rows[i:i + CHUNK], "return=minimal")


def from_env() -> Store | None:
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    return Store(key) if key else None


class MemoryStore:
    """In-memory stand-in with the same methods (tests only). `fail_on` makes one table raise StoreError."""

    def __init__(self):
        self.t: dict[str, list[dict]] = {}
        self.fail_on: set[str] = set()

    def _check(self, table):
        if table in self.fail_on:
            raise StoreError(f"{table}: simulated failure")

    def select(self, table, params=None):
        self._check(table)
        rows = [dict(r) for r in self.t.get(table, [])]
        for k, v in (params or {}).items():
            if k in ("select", "order", "limit", "offset"):
                continue
            if v.startswith("in.(") and v.endswith(")"):
                ok = set(v[4:-1].split(","))
                rows = [r for r in rows if str(r.get(k)) in ok]
            elif v.startswith("eq."):
                rows = [r for r in rows if str(r.get(k)) == v[3:]]
            elif v.startswith("gte."):
                rows = [r for r in rows if str(r.get(k)) >= v[4:]]
        return rows

    def _key(self, row, on_conflict):
        return tuple(str(row.get(c)) for c in on_conflict.split(","))

    def upsert(self, table, rows, on_conflict):
        self._check(table)
        cur = self.t.setdefault(table, [])
        for row in rows:
            for r in cur:
                if self._key(r, on_conflict) == self._key(row, on_conflict):
                    r.update(row)
                    break
            else:
                cur.append(dict(row))

    def insert_ignore(self, table, rows, on_conflict):
        self._check(table)
        cur = self.t.setdefault(table, [])
        have = {self._key(r, on_conflict) for r in cur}
        for row in rows:
            k = self._key(row, on_conflict)
            if k not in have:
                cur.append(dict(row))
                have.add(k)

    def insert(self, table, rows):
        self._check(table)
        self.t.setdefault(table, []).extend(dict(r) for r in rows)
