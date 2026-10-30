"""Phone alert when a game's lines are first posted for most of its players.

After each build, for every game that hasn't kicked off: count our slotted players in that game
(QB1, RB1-2, WR1-3, TE1-2) and how many have at least one line showing, using the same rule as the
Guide page's "Week N lines" panel (pre-game line captured, or a Mon/Thu/Sun AM snapshot while the
pre-game line is pending). The first time a game goes above 50%, it's included in one alert per run
(all games that crossed in that run, batched). Each game alerts at most once.

Two delivery channels, each used only when its secrets are set:
  - ntfy (NTFY_TOPIC): Michael's ntfy app.
  - Web push (VAPID_PRIVATE_KEY + SUPABASE_SERVICE_KEY, and the pywebpush package): every phone or
    browser that tapped "Turn on alerts" in Stix (subscriptions in Supabase table push_subs,
    supabase/003_push_subs.sql). Subscriptions the push service reports as gone (404/410) are deleted.

State lives in data/notify_state.json. A game is recorded only after at least one channel delivered
(or had no one to deliver to), so a total failure is retried on the next run.
Any problem here is logged and never fails the run.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from datetime import timedelta
from zoneinfo import ZoneInfo

from .common import DATA, SITE, iso, parse_iso, read_json, utcnow, write_json

STATE = DATA / "notify_state.json"
THRESHOLD = 0.5  # alert when players-with-a-line / slotted players is ABOVE this
CT = ZoneInfo("America/Chicago")
SITE_URL = "https://www.sharpstix.com/#/guide"
SHOW_ABBR = {"LA": "LAR"}  # same display-only relabel the app uses
SUPABASE_URL = "https://hewbbugkbycdkazlwspq.supabase.co"  # not secret
VAPID_SUB = "https://www.sharpstix.com"  # who is sending (required by push services); a URL, no email
PUSH_TTL = 12 * 3600  # push services may hold an undelivered alert this long
# Same rule as supabase/003_push_subs.sql: only send to known push services.
PUSH_HOST = re.compile(r"^https://(([a-z0-9-]+\.)*push\.apple\.com|fcm\.googleapis\.com|"
                       r"updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/")


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


# ---------- ntfy ----------
def send(topic: str, title: str, body: str, click: str = SITE_URL) -> None:
    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    req = urllib.request.Request(
        f"{server}/{topic}", data=body.encode("utf-8"), method="POST",
        headers={"Title": title, "Tags": "football", "Click": click},  # ASCII-only header values
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"HTTP {resp.status}")


# ---------- web push ----------
def _supa(method: str, path: str, key: str, body: bytes | None = None, extra: dict | None = None):
    base = os.environ.get("SUPABASE_URL_OVERRIDE", SUPABASE_URL).rstrip("/")  # override is for local tests only
    headers = {"apikey": key, "Content-Type": "application/json"}
    if key.startswith("eyJ"):  # older JWT-style keys also go in Authorization; sb_ keys go in apikey only
        headers["Authorization"] = f"Bearer {key}"
    headers.update(extra or {})
    req = urllib.request.Request(f"{base}/rest/v1/{path}", data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def push_all(title: str, body: str, log: list[str], url: str = SITE_URL) -> bool | None:
    """Send to every subscription. Returns None if web push isn't set up, else True when it counts as done."""
    vapid = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not vapid or not key:
        return None
    try:
        import time

        from py_vapid import Vapid
        from pywebpush import WebPusher
    except Exception as ex:
        log.append(f"push: skipped (pywebpush not available: {type(ex).__name__})")
        return None
    try:
        subs = _supa("GET", "push_subs?select=endpoint,p256dh,auth", key) or []
    except Exception as ex:
        log.append(f"push: couldn't read subscriptions ({type(ex).__name__}: {str(ex)[:80]})")
        return False
    payload = json.dumps({"title": title, "body": body, "url": url})
    signer = Vapid.from_string(private_key=vapid)
    exp = int(time.time()) + 12 * 3600
    signed: dict[str, dict] = {}  # one signed VAPID token per push service per run (Apple asks not to re-sign often)
    sent = gone = failed = 0
    now = iso(utcnow())
    for s in subs:
        ep = s.get("endpoint", "")
        q = "endpoint=eq." + urllib.parse.quote(ep, safe="")
        if not PUSH_HOST.match(ep):
            failed += 1
            continue
        try:
            u = urllib.parse.urlparse(ep)
            aud = f"{u.scheme}://{u.netloc}"
            if aud not in signed:
                signed[aud] = signer.sign({"sub": VAPID_SUB, "aud": aud, "exp": exp})
            resp = WebPusher({"endpoint": ep, "keys": {"p256dh": s.get("p256dh", ""), "auth": s.get("auth", "")}}).send(
                payload, {**signed[aud], "Urgency": "high"}, ttl=PUSH_TTL, content_encoding="aes128gcm", timeout=20)
            code = resp.status_code
            if code in (404, 410):  # subscription no longer exists (app removed, alerts turned off, ...)
                gone += 1
                try:
                    _supa("DELETE", f"push_subs?{q}", key)
                except Exception:
                    pass
                continue
            if code > 202:
                failed += 1
                continue
            sent += 1
            try:
                _supa("PATCH", f"push_subs?{q}", key, json.dumps({"last_sent_at": now}).encode())
            except Exception:
                pass  # bookkeeping only
        except Exception:
            failed += 1
    log.append(f"push: {sent} sent, {gone} expired removed, {failed} failed (of {len(subs)})")
    return sent > 0 or failed == 0


def run(log: list[str]) -> bool:
    """Returns True when the state file changed."""
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    push_ready = bool(os.environ.get("VAPID_PRIVATE_KEY", "").strip() and os.environ.get("SUPABASE_SERVICE_KEY", "").strip())
    if not topic and not push_ready:
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
    ok = False
    if topic:
        try:
            send(topic, title, body)
            ok = True
            log.append("notify: ntfy sent")
        except Exception as ex:
            log.append(f"notify: send failed ({type(ex).__name__}: {str(ex)[:80]})")
    try:
        p = push_all(title, body, log)
        ok = ok or bool(p)
    except Exception as ex:
        log.append(f"push: skipped ({type(ex).__name__}: {str(ex)[:80]})")
    if not ok:
        return False  # nothing recorded, so the next run retries
    stamp = iso(now)
    for c in crossed:
        alerted[c["gid"]] = {"utc": stamp, "players": c["players"], "tracked": c["tracked"]}
    cutoff = iso(now - timedelta(days=14))  # keep the file small
    keep = {k: v for k, v in alerted.items() if (d.get("games", {}).get(k) or {}).get("ko", "9999") > cutoff}
    write_json(STATE, {"alerted": keep})
    log.append(f"notify: alert for {len(crossed)} game(s): " + ", ".join(c["gid"] for c in crossed))
    return True


# ---------- arbitrage alerts (Michael 2026-10-29) ----------
# After each build: from data.json "books" (each upcoming game's latest multi-book pull), the best Over at one book +
# Under at another for each player/stat (Over line <= Under line), same math as the Arbitrage tab (site/books.js).
# An opportunity whose profit on $100 total, split so either side pays the same, is at least $0.01 is alerted once
# (key: game, player, stat, both books and lines). State: data/arb_alert_state.json (pruned after kickoff).
ARB_STATE = DATA / "arb_alert_state.json"
ARB_URL = "https://www.sharpstix.com/#/arb"
ARB_EXCLUDE_BOOKS: tuple[str, ...] = ()  # books never used for arbitrage alerts
ARB_WEB_PUSH = True  # also send to everyone who turned on Stix alerts (web push); ntfy always when NTFY_TOPIC is set
ARB_MAX_LINES = 8
BOOK_LABEL = {"draftkings": "DraftKings", "fanduel": "FanDuel", "betmgm": "BetMGM", "williamhill_us": "Caesars",
              "fanatics": "Fanatics", "betrivers": "BetRivers", "espnbet": "theScore Bet", "hardrockbet": "Hard Rock",
              "ballybet": "Bally Bet", "fliff": "Fliff"}


def _dec(o):
    return 1 + o / 100 if o > 0 else 1 + 100 / abs(o)


def arbs(d: dict, now) -> list[dict]:
    out = []
    for gid, g in (d.get("books") or {}).items():
        ko = parse_iso(((d.get("games") or {}).get(gid) or {}).get("ko", ""))
        if not ko or ko <= now:
            continue
        for pid, ms in (g.get("p") or {}).items():
            for mid, rows in ms.items():
                rs = [r for r in rows if r[0] not in ARB_EXCLUDE_BOOKS]
                best = None
                for o in rs:
                    for u in rs:
                        if o[0] == u[0] or o[2] is None or u[3] is None or o[1] > u[1]:
                            continue
                        S = 1 / _dec(o[2]) + 1 / _dec(u[3])
                        ret = 1 / S - 1
                        if best is None or ret > best["ret"]:
                            best = {"gid": gid, "pid": pid, "mid": mid, "o": o, "u": u, "ret": ret, "ko": ko}
                if best and round(best["ret"] * 10000) / 100 > 0:
                    out.append(best)
    return sorted(out, key=lambda x: -x["ret"])


def arb_message(new: list[dict], d: dict) -> tuple[str, str]:
    names = {p["id"]: p["name"] for p in d.get("players", [])}
    labels = {m["id"]: m["label"] for m in d.get("markets", [])}
    title = f"Stix: {len(new)} arbitrage{'s' if len(new) != 1 else ''} found"
    lines = []
    for x in new[:ARB_MAX_LINES]:
        o, u = x["o"], x["u"]
        sg = lambda v: f"+{v:g}" if v > 0 else f"{v:g}"
        lines.append(f"{names.get(x['pid'], x['pid'])} {labels.get(x['mid'], x['mid'])}: O {o[1]:g} {BOOK_LABEL.get(o[0], o[0])} "
                     f"{sg(o[2])} / U {u[1]:g} {BOOK_LABEL.get(u[0], u[0])} {sg(u[3])} = +${x['ret'] * 100:.2f} per $100")
    if len(new) > ARB_MAX_LINES:
        lines.append(f"and {len(new) - ARB_MAX_LINES} more in Stix")
    return title, "\n".join(lines)


def arb_run(log: list[str]) -> bool:
    """Returns True when the state file changed."""
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    push_ready = ARB_WEB_PUSH and bool(os.environ.get("VAPID_PRIVATE_KEY", "").strip() and os.environ.get("SUPABASE_SERVICE_KEY", "").strip())
    if not topic and not push_ready:
        return False
    d = read_json(SITE / "data" / "data.json", None)
    if not d:
        return False
    now = utcnow()
    state = read_json(ARB_STATE, {}) or {}
    seen = state.get("alerted", {})
    found = arbs(d, now)
    key = lambda x: f"{x['gid']}|{x['pid']}|{x['mid']}|{x['o'][0]}|{x['o'][1]}|{x['u'][0]}|{x['u'][1]}"
    new = [x for x in found if key(x) not in seen]
    if not new:
        return False
    title, body = arb_message(new, d)
    ok = False
    if topic:
        try:
            send(topic, title, body, click=ARB_URL)
            ok = True
            log.append("arb: ntfy sent")
        except Exception as ex:
            log.append(f"arb: ntfy failed ({type(ex).__name__}: {str(ex)[:80]})")
    if push_ready:
        try:
            ok = bool(push_all(title, body, log, url=ARB_URL)) or ok
        except Exception as ex:
            log.append(f"arb: push skipped ({type(ex).__name__}: {str(ex)[:80]})")
    if not ok:
        return False  # nothing recorded, so the next run retries
    stamp = iso(now)
    for x in new:
        seen[key(x)] = {"utc": stamp, "ko": iso(x["ko"]), "ret": round(x["ret"], 4)}
    keep = {k: v for k, v in seen.items() if v.get("ko", "9999") > iso(now)}
    write_json(ARB_STATE, {"alerted": keep})
    log.append(f"arb: alert for {len(new)} arbitrage(s)")
    return True
