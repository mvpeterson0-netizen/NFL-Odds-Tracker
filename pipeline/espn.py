"""ESPN player status notes and news headlines for the player updates pop-up.

Source: ESPN's public but unofficial / undocumented JSON endpoints (no key). Chosen by Michael on 2026-10-25
knowing the risks: no SLA, endpoints may change or be blocked without notice, and Disney's Terms of Use
(which cover ESPN) limit use to personal, noncommercial use and bar automated access.

Two requests per run:
  * league injuries: every team's player status notes (status, date, one-line note) -- one call
  * league news: recent headlines, kept only when ESPN tags them with a player

Only QB/RB/WR/TE are kept. The result is written to data/espn_news.json (rewritten each run; not an
archive). Any failure is logged and the previous file is kept, so ESPN problems never stop a run.
"""
from __future__ import annotations

import json
import re

from .common import DATA, http_get, iso, read_json, utcnow, write_json

INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries"
NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100"
PATH = DATA / "espn_news.json"
POSITIONS = {"QB", "RB", "WR", "TE"}
_ID_RE = re.compile(r"/id/(\d+)")


def _get_json(url):
    body, _, status = http_get(url, timeout=45)
    if status != 200:
        raise RuntimeError(f"HTTP {status}")
    return json.loads(body)


def _athlete_id(ath: dict) -> str:
    if ath.get("id"):
        return str(ath["id"])
    for ln in ath.get("links") or []:
        m = _ID_RE.search(ln.get("href") or "")
        if m:
            return m.group(1)
    return ""


def _player_link(ath: dict) -> str:
    for ln in ath.get("links") or []:
        if "news" in (ln.get("rel") or []) and "desktop" in (ln.get("rel") or []):
            return ln.get("href") or ""
    return ""


def parse_injuries(doc: dict) -> dict:
    out = {}
    for team in doc.get("injuries") or []:
        for it in team.get("injuries") or []:
            ath = it.get("athlete") or {}
            pos = ((ath.get("position") or {}).get("abbreviation") or "").upper()
            aid = _athlete_id(ath)
            if not aid or pos not in POSITIONS:
                continue
            out[aid] = {
                "name": ath.get("displayName") or "",
                "status": it.get("status") or "",
                "date": it.get("date") or "",
                "note": (it.get("shortComment") or "").strip(),
                "url": _player_link(ath),
            }
    return out


def parse_news(doc: dict) -> dict:
    out = {}
    for a in doc.get("articles") or []:
        head = (a.get("headline") or "").strip()
        url = ((a.get("links") or {}).get("web") or {}).get("href") or ""
        if not head or not url:
            continue
        ids = {str(c["athleteId"]) for c in a.get("categories") or []
               if c.get("type") == "athlete" and c.get("athleteId")}
        for aid in ids:
            out.setdefault(aid, []).append({"headline": head, "date": a.get("published") or "", "url": url})
    return out


def refresh(log: list) -> bool:
    """Fetch ESPN data; return True when the stored content changed."""
    old = read_json(PATH, None) or {}
    new = {"status": old.get("status", {}), "news": old.get("news", {}),
           "status_utc": old.get("status_utc", ""), "news_utc": old.get("news_utc", "")}
    ok = []
    try:
        new["status"] = parse_injuries(_get_json(INJURIES_URL))
        new["status_utc"] = iso(utcnow())
        ok.append(f"{len(new['status'])} status notes")
    except Exception as ex:  # keep the previous notes
        log.append(f"espn: status notes skipped ({type(ex).__name__}: {str(ex)[:80]})")
    try:
        new["news"] = parse_news(_get_json(NEWS_URL))
        new["news_utc"] = iso(utcnow())
        ok.append(f"headlines for {len(new['news'])} players")
    except Exception as ex:
        log.append(f"espn: news skipped ({type(ex).__name__}: {str(ex)[:80]})")
    changed = (new["status"], new["news"]) != (old.get("status"), old.get("news"))
    if changed or not PATH.exists():
        write_json(PATH, new, compact=True)
    if ok:
        log.append("espn: " + ", ".join(ok) + ("" if changed else " (unchanged)"))
    return changed
