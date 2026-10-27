"""Phone alert when a game's lines are first posted for most of its players.

After each build, for every game that hasn't kicked off: count our slotted players in that game
(QB1, RB1-2, WR1-3, TE1-2) and how many have at least one line showing, using the same rule as the
Guide page's "Week N lines" panel (pre-game line captured, or a Mon/Thu/Sun AM snapshot while the
pre-game line is pending). The first time a game goes above 50%, it's included in one ntfy
notification per run (all games that crossed in that run, batched). Each game alerts at most once.

Sent only when the NTFY_TOPIC secret is set. State lives in data/notify_state.json; a game is
recorded there only after its alert was sent, so a failed send is retried on the next run.
Any problem here is logged and never fails the run.
"""
from __future__ import annotations

import os
import urllib.request
from datetime import timedelta
from zoneinfo import ZoneInfo

from .common import DATA, SITE, iso, parse_iso, read_json, utcnow, write_json

STATE = DATA / "notify_state.json"
THRESHOLD = 0.5  # alert when players-with-a-line / slotted players is ABOVE this
CT = ZoneInfo("America/Chicago")
SITE_URL = "https://www.sharpstix.com/#/guide"
SHOW_ABBR = {"LA": "LAR"}  # same display-only relabel the app uses


def _abbr(t: str) -> str:
    return SHOW_ABBR.get(t, t)


def coverage(d: dict, now) -> list[dict]:
    """Per upcoming game: slotted players in the game and how many have a line showing."""
    out = []
    rows = d.get("rows", {})
    for gid, g in d.get("games", {}).items():
        ko = parse_iso(g.get("ko", ""))
        if not ko or ko <= now:
            continue
        wk = g.get("wk")
        tracked = players = 0
        for s in d.get("slots", []):
            if s.get("wk") != wk:
                continue
            r = next((x for x in rows.get(s.get("pid"), []) if x.get("wk") == wk), None)
            if not r or r.get("gid") != gid:
                continue
            tracked += 1
            for m in (r.get("m") or {}).values():
                if m.get("lstat") == "ok" or (m.get("lstat") == "pending" and m.get("snaps")):
                    players += 1
                    break
        out.append({"gid": gid, "wk": wk, "ko": ko, "away": g.get("away", ""), "home": g.get("home", ""),
                    "tracked": tracked, "players": players})
    return out


def message(crossed: list[dict]) -> tuple[str, str]:
    crossed = sorted(crossed, key=lambda c: (c["ko"], c["gid"]))
    wks = sorted({c["wk"] for c in crossed})
    title = f"Stix: lines up for {len(crossed)} game{'s' if len(crossed) != 1 else ''} (Week {'/'.join(map(str, wks))})"
    lines = []
    for c in crossed:
        ko = c["ko"].astimezone(CT)
        when = ko.strftime("%a %-I:%M %p").replace(":00 ", " ")
        lines.append(f"{_abbr(c['away'])} @ {_abbr(c['home'])}: {c['players']}/{c['tracked']} players · {when} CT")
    return title, "\n".join(lines)


def send(topic: str, title: str, body: str) -> None:
    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    req = urllib.request.Request(
        f"{server}/{topic}", data=body.encode("utf-8"), method="POST",
        headers={"Title": title, "Tags": "football", "Click": SITE_URL},  # ASCII-only header values
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"HTTP {resp.status}")


def run(log: list[str]) -> bool:
    """Returns True when the state file changed."""
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        return False  # not set up: do nothing, record nothing
    d = read_json(SITE / "data" / "data.json", None)
    if not d:
        return False
    now = utcnow()
    state = read_json(STATE, {}) or {}
    alerted = state.get("alerted", {})
    crossed = [c for c in coverage(d, now)
               if c["gid"] not in alerted and c["tracked"] and c["players"] / c["tracked"] > THRESHOLD]
    if not crossed:
        return False
    title, body = message(crossed)
    try:
        send(topic, title, body)
    except Exception as ex:  # retried next run because nothing is recorded
        log.append(f"notify: send failed ({type(ex).__name__}: {str(ex)[:80]})")
        return False
    stamp = iso(now)
    for c in crossed:
        alerted[c["gid"]] = {"utc": stamp, "players": c["players"], "tracked": c["tracked"]}
    # keep the file small: drop games that kicked off more than 14 days ago
    cutoff = iso(now - timedelta(days=14))
    keep = {k: v for k, v in alerted.items() if (d.get("games", {}).get(k) or {}).get("ko", "9999") > cutoff}
    write_json(STATE, {"alerted": keep})
    log.append(f"notify: alert sent for {len(crossed)} game(s): " + ", ".join(c["gid"] for c in crossed))
    return True
