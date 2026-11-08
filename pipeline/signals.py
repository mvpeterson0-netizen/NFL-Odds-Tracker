"""Signal Stacks: when several *distinct families* of evidence support the same side of a player prop.

Standard library only.  Evidence statuses (see SIGNAL_STACKS.md):
  context   a historical finding relevant to this prop (not graded forward, never counted as a bet signal)
  testing   a versioned rule that fires on upcoming props and is graded forward from its lock time
  qualified a testing rule that met every documented criterion in QUALIFY (none yet)

Every signal is evaluated for ONE player / game / market / side from the inputs available at evaluation time and records
its family, rule version, trigger text, input values and timestamps.  Props with a graded pregame quote are LOCKED once, at
the first eligible pregame capture, and never recomputed (append-only ledger data/signal_stacks.json).  Earlier props with
only a weekly snapshot are a WATCHLIST: recomputed on every build, never persisted, never graded.

Spread orientation (team_spread): points the PLAYER'S TEAM is favored by, NEGATIVE = favored (-10 favored by 10, +10 getting 10).
nflverse game spread_line is points the HOME team is favored by, so home team_spread = -spread_line, away = +spread_line.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

from .common import DATA, iso, parse_iso, read_json, to_float, write_json

VERSION = "signal-stacks-v1"
LEDGER_PATH = DATA / "signal_stacks.json"
OVERLAP_MODEL_PATH = Path(__file__).with_name("frozen_models.json")

# ---- staleness / availability rules (documented in SIGNAL_STACKS.md) ----
SPREAD_MAX_AGE = timedelta(hours=36)     # schedule/spread file must have been read within 36 h of evaluation
FORECAST_MAX_AGE = timedelta(hours=8)    # forecast refreshes every 3 h; older than 8 h is stale
QUOTE_MAX_BEFORE_KO = timedelta(hours=4)  # a lockable pregame quote is captured within 4 h of kickoff

FAMILIES = {
    "game_script": {"label": "Game script", "inputs": ["team_spread"],
                    "note": "All rules here read the same schedule spread, so together they are ONE family."},
    "recent_form": {"label": "Recent form", "inputs": ["prior-game result vs line", "prior-game production"],
                    "note": "Last-game(s) result or production relative to the line."},
    "line_move": {"label": "Line move", "inputs": ["line vs last week's line", "home/away"],
                  "note": "Today's line compared with the same player's line last game."},
    "role_base_rate": {"label": "Role base rate", "inputs": ["depth slot", "market"],
                       "note": "Structural: a role/market pairing with no game-specific input."},
    "workload": {"label": "Workload", "inputs": ["target share / snap share trend", "line vs last week's line"],
                 "note": "Routes, targets and snaps all reflect workload, so they are one family."},
    "weather": {"label": "Weather", "inputs": ["forecast temperature", "forecast wind", "roof"],
                "note": "Needs a forecast available at evaluation time; observed weather is research only."},
}

# id -> definition.  `version` changes whenever the rule text/threshold changes (a changed rule is a NEW signal).
REGISTRY = {
    "SP1": dict(family="game_script", side="under", markets=["rec_yds"], pos=["WR", "TE", "RB"], status="testing", version="v1",
                label="Team +10 or more", rule="Team spread +10 or longer (team is a 10+ point underdog) -> receiving yards Under",
                origin="spread band >=+10 (pre-set band, not refined)"),
    "SP2": dict(family="game_script", side="under", markets=["rec"], pos=["WR", "TE", "RB"], status="testing", version="v1",
                label="Team +10 or more", rule="Team spread +10 or longer -> receptions Under", origin="spread band >=+10 (pre-set band, not refined)"),
    "SP3": dict(family="game_script", side="over", markets=["pass_yds"], pos=["QB"], status="testing", version="v1",
                label="Team -10 or shorter", rule="Team favored by 10 or more (spread <= -10) -> QB passing yards Over", origin="spread band <=-10 (pre-set band, not refined)"),
    "SP4": dict(family="game_script", side="under", markets=["pass_yds"], pos=["QB"], status="testing", version="v1",
                label="Team +10 or more", rule="Team spread +10 or longer -> QB passing yards Under", origin="spread band >=+10 (pre-set band, not refined)"),
    "SP5": dict(family="game_script", side="under", markets=["rush_yds"], pos=["QB", "RB"], status="testing", version="v1",
                label="Team +3 to +6.5", rule="Team spread +3 to +6.5 (small underdog) -> rushing yards Under (QB and RB)", origin="spread band +3..+6.5 (pre-set band, not refined)"),
    "WX1": dict(family="weather", side="under", markets=["pass_yds", "rec", "rec_yds"], pos=["QB", "WR", "TE", "RB"], status="context", version="v1",
                label="Wind 15+ mph", rule="Outdoor game, forecast wind 15 mph or more -> pass/receiving Under (2025 observed games only)", origin="2025 observed wind; no historical forecasts"),
    "WX2": dict(family="weather", side="under", markets=["rec", "rec_yds"], pos=["WR", "TE", "RB"], status="context", version="v1",
                label="Forecast under 55F", rule="Outdoor game, forecast temperature below 55F -> receptions / receiving yards Under (2025 observed games mostly)", origin="2025 observed temperature; no historical forecasts"),
    # existing leads: rules 1-8 (frozen 2026-10-28), 9-10 (frozen 2026-10-31).  Rules 6-8 read the spread -> game_script.
    "L1": dict(family="recent_form", side="under", markets=None, pos=["WR"], status="testing", version="frozen-2026-10-28",
               label="Lead 1 · WR2 went over", rule="WR2 whose line for the same stat went over last week -> Under", origin="existing lead 1"),
    "L2": dict(family="line_move", side="under", markets=None, pos=None, status="testing", version="frozen-2026-10-28",
               label="Lead 2 · Away, line raised", rule="Away team and line higher than last week (same stat) -> Under", origin="existing lead 2"),
    "L3": dict(family="role_base_rate", side="under", markets=["rec_yds"], pos=["TE"], status="testing", version="frozen-2026-10-28",
               label="Lead 3 · TE1 rec yds", rule="TE1 receiving yards -> Under", origin="existing lead 3"),
    "L4": dict(family="role_base_rate", side="under", markets=["rush_yds"], pos=["QB"], status="testing", version="frozen-2026-10-28",
               label="Lead 4 · QB1 rush yds", rule="QB1 rushing yards -> Under", origin="existing lead 4"),
    "L5": dict(family="workload", side="under", markets=None, pos=["WR", "TE", "RB"], status="testing", version="frozen-2026-10-28",
               label="Lead 5 · Usage down, line flat", rule="Usage down (target share >=5 pts / RB snap share >=10 pts below earlier games) with a flat line -> Under", origin="existing lead 5"),
    "L6": dict(family="game_script", side="under", markets=["rush_yds"], pos=["RB"], status="testing", version="frozen-2026-10-28",
               label="Lead 6 · Favored 7+, RB rush", rule="Team favored by 7+ -> RB rushing yards Under", origin="existing lead 6"),
    "L7": dict(family="game_script", side="over", markets=["pass_yds"], pos=["QB"], status="testing", version="frozen-2026-10-28",
               label="Lead 7 · Underdog 7+, QB pass", rule="Team a 7+ underdog -> QB passing yards Over", origin="existing lead 7"),
    "L8": dict(family="game_script", side="over", markets=["rec_yds"], pos=["WR", "TE"], status="testing", version="frozen-2026-10-28",
               label="Lead 8 · Underdog 7+, WR/TE rec", rule="Team a 7+ underdog -> WR/TE receiving yards Over", origin="existing lead 8"),
    "L9": dict(family="recent_form", side="under", markets=["rec_yds"], pos=["WR"], status="testing", version="frozen-2026-10-31",
               label="Lead 9 · Three straight Overs", rule="WR whose last three appearances each went Over the receiving-yards line -> next Under", origin="existing lead 9"),
    "L10": dict(family="recent_form", side="under", markets=["rec"], pos=["WR"], status="testing", version="frozen-2026-10-31",
                label="Lead 10 · Receptions rising", rule="WR whose receptions rose in each of his last three appearances -> next receptions Under", origin="existing lead 10"),
}
LEAD_IDS = [k for k in REGISTRY if k.startswith("L")]
TIERS = ("qualified", "testing", "context")

# The frozen interaction model (T12) / additive model (T11) / Challenger (T13) are shown SEPARATELY and never counted as a family.
# Which model input columns each stack signal reuses (checked against frozen_models.json by tests):
MODEL_INPUT_OVERLAP = {
    "L1": ["last_ratio", "mean3_ratio"], "L9": ["last_ratio", "mean3_ratio", "rise3"], "L10": ["rise3"],
    "L2": ["away", "line_delta_ratio"], "L5": ["usage_last", "usage_delta"],
    "L3": ["group_TE player_reception_yds"], "L4": ["group_QB player_rush_yds"],
    "SP1": [], "SP2": [], "SP3": [], "SP4": [], "SP5": [], "L6": [], "L7": [], "L8": [], "WX1": [], "WX2": [],
}

# Documented criteria for Testing -> Qualified.  All must hold on FORWARD (locked, graded) bets; historical results never qualify a rule.
QUALIFY = {
    "frozen": "Rule text, thresholds and universe unchanged since its lock date (same version).",
    "min_bets": 150, "min_games": 60, "min_weeks": 4,
    "roi": "Forward flat-stake ROI at the recorded prices > 0 and the game-clustered bootstrap p (two-sided) <= 0.10 after Benjamini-Hochberg across all testing rules.",
    "stability": "ROI > 0 in at least 60% of forward weeks and after removing the 3 best games.",
    "price": "ROI stays > 0 when every price is shaded 5 points worse.",
    "independence": "Counts once per family; a rule whose inputs duplicate an already-qualified family adds nothing to the count.",
}


def registry_sha() -> str:
    return hashlib.sha256(json.dumps(REGISTRY, sort_keys=True).encode()).hexdigest()


# ------------------------------------------------------------------ inputs
def team_spread(home_fav, ha):
    """home_fav = nflverse spread_line (points the HOME team is favored by).  Negative result = player's team favored."""
    if home_fav is None:
        return None
    return -home_fav if ha == "home" else home_fav


def payout(o):
    return o / 100 if o > 0 else 100 / abs(o)


def _spread_state(out, game, now):
    """-> (home_fav, state, info).  state 'ok' | 'missing' | 'stale'."""
    sched = (out.get("sources") or {}).get("schedule") or {}
    read = parse_iso(sched.get("fetched_utc", ""))
    info = {"source": "nflverse schedule spread_line (not an Odds API capture)", "schedule_read_utc": sched.get("fetched_utc"),
            "schedule_published": sched.get("last_updated")}
    hf = (game or {}).get("spread")
    if hf is None:
        return None, "missing", info
    if read is None or now - read > SPREAD_MAX_AGE:
        return hf, "stale", info
    return hf, "ok", info


def _forecast_state(game, now):
    wx = (game or {}).get("wx") or {}
    roof = wx.get("roof")
    if roof in ("dome",):
        return None, "indoor", {"roof": roof}
    if roof != "open":  # retractable: roof state unknown before kickoff -> cannot call it outdoors
        return None, "roof_unknown", {"roof": roof}
    fetched = parse_iso(wx.get("fc_fetched_utc", ""))
    t, w = to_float(wx.get("fc_temp_f")), to_float(wx.get("fc_wind_mph"))
    if fetched is None or t is None or w is None:
        return None, "missing", {"roof": roof}
    if now - fetched > FORECAST_MAX_AGE:
        return None, "stale", {"roof": roof, "fc_fetched_utc": wx.get("fc_fetched_utc")}
    return {"temp_f": t, "wind_mph": w, "gust_mph": to_float(wx.get("fc_gust_mph"))}, "ok", {"roof": roof, "fc_fetched_utc": wx.get("fc_fetched_utc")}


# ------------------------------------------------------------------ signals
def _applies(sig, pos, mid):
    return (sig["markets"] is None or mid in sig["markets"]) and (sig["pos"] is None or pos in sig["pos"])


def lead_signals(pos, r, mid, quote, history, home_fav, spread_ok):
    """Leads 1-8 exactly as frozen (see claude/frozen-theses.md frozen.py); 9-10 as pipeline.frozen_leads.decide.
    history = the player's rows, any order.  Returns [(lead_id, trigger_text, inputs)]."""
    out = []
    past = sorted([x for x in history if x["wk"] < r["wk"] and x.get("final")], key=lambda x: x["wk"])
    prev = past[-1] if past else None
    played = [x for x in past if x.get("played") is True]
    pm = (prev.get("m") or {}).get(mid) if prev else None
    pl = pm["line"] if pm and pm.get("lstat") == "ok" and pm.get("line") is not None else None
    line = quote["line"]
    if r.get("slot") == "WR2" and pm and pm.get("res") == "over":
        out.append(("L1", f"WR2; last week went Over ({pl:g} line, {pm.get('act'):g} actual)" if pl is not None and pm.get("act") is not None else "WR2; last week went Over",
                    {"last_result": "over", "last_line": pl, "last_actual": pm.get("act")}))
    if r.get("ha") == "away" and pl is not None and line > pl:
        out.append(("L2", f"Away; line {line:g} is up from {pl:g} last week", {"ha": "away", "line": line, "last_line": pl}))
    if r.get("slot") == "TE1" and mid == "rec_yds":
        out.append(("L3", "TE1 receiving yards", {"slot": "TE1"}))
    if r.get("slot") == "QB1" and mid == "rush_yds":
        out.append(("L4", "QB1 rushing yards", {"slot": "QB1"}))
    if pos != "QB" and pl is not None:
        def usage(x):
            if pos == "RB":
                return x.get("snap")
            return None if x.get("tshare") is None else x["tshare"] * 100
        us = [u for u in (usage(x) for x in played) if u is not None]
        if len(us) >= 4:
            drop = sum(us[-2:]) / 2 - sum(us[:-2]) / len(us[:-2])
            tol = 0.5 if mid in ("rec", "rush_att", "pass_att", "pass_cmp") else 10 if mid == "pass_yds" else 5
            if drop <= -(10 if pos == "RB" else 5) and abs(line - pl) <= tol:
                out.append(("L5", f"Usage {drop:+.1f} pts vs earlier games; line {line:g} vs {pl:g} last week (flat)",
                            {"usage_change_pts": round(drop, 2), "line": line, "last_line": pl, "tolerance": tol}))
    if spread_ok and home_fav is not None:
        fav_by = home_fav if r["ha"] == "home" else -home_fav   # + = player's team favored by this many points
        if fav_by >= 7 and pos == "RB" and mid == "rush_yds":
            out.append(("L6", f"Team favored by {fav_by:g}", {"team_spread": -fav_by}))
        if fav_by <= -7 and mid == "pass_yds":
            out.append(("L7", f"Team a {-fav_by:g}-point underdog", {"team_spread": -fav_by}))
        if fav_by <= -7 and pos in ("WR", "TE") and mid == "rec_yds":
            out.append(("L8", f"Team a {-fav_by:g}-point underdog", {"team_spread": -fav_by}))
    wr_apps = [x for x in played]
    if pos == "WR" and len(wr_apps) >= 3:
        last = wr_apps[-3:]
        if mid == "rec_yds" and all(((x.get("m") or {}).get("rec_yds") or {}).get("res") == "over" for x in last):
            out.append(("L9", "Last three appearances each went Over the receiving-yards line", {"streak": 3}))
        vals = [x.get("m", {}).get("rec", {}).get("act") for x in last]
        if mid == "rec" and all(v is not None for v in vals) and vals[0] < vals[1] < vals[2]:
            out.append(("L10", f"Receptions rose {vals[0]:g} -> {vals[1]:g} -> {vals[2]:g}", {"receptions": vals}))
    return out


def spread_signals(pos, mid, ts):
    """SP1-SP5 from the player's TEAM spread (negative = favored)."""
    out = []
    if ts is None:
        return out
    def fire(sid, cond, text):
        if cond and _applies(REGISTRY[sid], pos, mid):
            out.append((sid, text, {"team_spread": ts}))
    desc = f"Team {ts:+g}" + (" (favored)" if ts < 0 else " (underdog)" if ts > 0 else "")
    fire("SP1", ts >= 10, desc)
    fire("SP2", ts >= 10, desc)
    fire("SP3", ts <= -10, desc)
    fire("SP4", ts >= 10, desc)
    fire("SP5", 3 <= ts <= 6.5, desc)
    return out


def weather_signals(pos, mid, fc):
    out = []
    if not fc:
        return out
    if fc["wind_mph"] >= 15 and _applies(REGISTRY["WX1"], pos, mid):
        out.append(("WX1", f"Forecast wind {fc['wind_mph']:g} mph", dict(fc)))
    if fc["temp_f"] < 55 and _applies(REGISTRY["WX2"], pos, mid):
        out.append(("WX2", f"Forecast {fc['temp_f']:g}F", dict(fc)))
    return out


def evaluate_prop(pid, p, r, mid, quote, history, game, out, now):
    """All signals for one prop at evaluation time `now`.  Never reads same-game results."""
    pos = p["pos"]
    hf, sstate, sinfo = _spread_state(out, game, now)
    ts = team_spread(hf, r["ha"]) if sstate == "ok" else None
    fc, wstate, winfo = _forecast_state(game, now)
    fired = lead_signals(pos, r, mid, quote, history, hf, sstate == "ok") + spread_signals(pos, mid, ts) + weather_signals(pos, mid, fc)
    sigs, unavailable = [], []
    for sid, trigger, inputs in fired:
        d = REGISTRY[sid]
        sigs.append({"id": sid, "family": d["family"], "side": d["side"], "status": d["status"], "version": d["version"],
                     "trigger": trigger, "inputs": inputs, "asof": iso(now)})
    for sid, d in REGISTRY.items():   # applicable-but-unavailable: inputs missing or stale, so the rule could not be judged
        if not _applies(d, pos, mid):
            continue
        if d["family"] == "game_script" and sstate in ("missing", "stale") and sid not in {s["id"] for s in sigs}:
            unavailable.append({"id": sid, "reason": f"spread {sstate}"})
        if d["family"] == "weather" and wstate in ("missing", "stale", "roof_unknown"):
            unavailable.append({"id": sid, "reason": f"forecast {wstate}"})
    inputs = {"team_spread": ts, "spread_home_fav": hf, "spread_state": sstate, **{"spread_" + k: v for k, v in sinfo.items()},
              "ha": r["ha"], "slot": r.get("slot"), "pos": pos, "forecast_state": wstate,
              "forecast": ({**winfo, **fc} if wstate == "ok" else None)}
    return {"signals": sigs, "unavailable": unavailable, "inputs": inputs}


def stack_summary(signals):
    """Distinct families by side and tier.  A family whose signals disagree is MIXED: it supports neither side."""
    fam = defaultdict(lambda: defaultdict(set))          # tier -> family -> sides
    for s in signals:
        fam[s["status"]][s["family"]].add(s["side"])
    res = {"over": {t: {"support": 0, "oppose": 0} for t in TIERS}, "under": {t: {"support": 0, "oppose": 0} for t in TIERS},
           "mixed": {t: [] for t in TIERS}}
    for tier, fams in fam.items():
        for f, sides in fams.items():
            if len(sides) > 1:
                res["mixed"][tier].append(f)
                continue
            side = next(iter(sides)); other = "under" if side == "over" else "over"
            res[side][tier]["support"] += 1
            res[other][tier]["oppose"] += 1
    leads = {"over": 0, "under": 0}
    for s in signals:
        if s["id"] in LEAD_IDS:
            leads[s["side"]] += 1
    res["leads"] = leads   # existing leads are counted individually, a different measure from distinct families
    return res


# ------------------------------------------------------------------ ledger + payload
def _model_callout(out, key):
    fr = (out.get("frozen_research") or {})
    rec = (fr.get("records") or {}).get(key) or (fr.get("watchlist") or {}).get(key)
    ch = (out.get("challenger") or {})
    crec = (ch.get("records") or {}).get(key) or (ch.get("watchlist") or {}).get(key)
    callout = {}
    for src, name in ((rec, "t11"), (rec, "t12"), (crec, "t13")):
        d = ((src or {}).get("decisions") or {}).get(name)
        if d:
            callout[name] = {"side": d.get("side"), "qualifies": bool(d.get("qualifies")), "edge": d.get("edge")}
    return callout


def public_prop(rec, state, model):
    """The ONLY fields the site payload may carry per prop (see PUBLIC_FIELDS and tests)."""
    return {"state": state, "evaluated": rec["evaluated_utc"], "quote": {k: rec["quote"].get(k) for k in ("line", "op", "up", "book", "cap")},
            "chips": [{"id": s["id"], "family": s["family"], "side": s["side"], "status": s["status"], "label": REGISTRY[s["id"]]["label"],
                       "trigger": s["trigger"]} for s in rec["signals"]],
            "stack": rec["stack"], "model": model,
            "unavailable": [u["id"] for u in rec.get("unavailable", [])]}


PUBLIC_FIELDS = {"state", "evaluated", "quote", "chips", "stack", "model", "unavailable"}
PUBLIC_CHIP_FIELDS = {"id", "family", "side", "status", "label", "trigger"}
PUBLIC_REGISTRY_FIELDS = {"id", "family", "label", "side", "status", "version", "rule"}


def public_registry():
    return [{"id": k, **{f: v[f] for f in ("family", "label", "side", "status", "version", "rule")}} for k, v in REGISTRY.items()]


def _lock_quote(m, ko, now, frozen_at):
    """Quote eligible for a LOCK: the app's graded first pregame capture, captured before kickoff, within 4 h of it,
    at/after the ledger start, with a line and both prices."""
    if m.get("lstat") != "ok":
        return None
    cap = parse_iso(m.get("cap", ""))
    if cap is None or cap < frozen_at or cap > now or not (ko - cap <= QUOTE_MAX_BEFORE_KO) or cap >= ko:
        return None
    if m.get("line") is None or not m.get("op") or not m.get("up"):
        return None
    return {k: m.get(k) for k in ("line", "op", "up", "book", "cap")}


def _watch_quote(m, now):
    snaps = [s for s in (m.get("snaps") or []) if s.get("cap") and s["cap"] <= iso(now)]
    if m.get("lstat") != "pending" or not snaps:
        return None
    s = max(snaps, key=lambda x: x["cap"])
    if s.get("line") is None or not s.get("op") or not s.get("up"):
        return None
    return {k: s.get(k) for k in ("line", "op", "up", "book", "cap")}


def _load_ledger(path, log):
    """-> (saved, mode).  mode 'remote' (admin-only Supabase row 'ledger'; used when SUPABASE_SERVICE_KEY is set and no explicit
    path is given), 'local' (a file; tests / local runs, git-ignored), or 'blocked' (remote read failed: never create or
    overwrite a ledger on a failed read)."""
    if path is not None:
        return read_json(path, None), "local"
    from . import supa
    status, body = supa.read_signal_research("ledger")
    if status == "nokey":
        return read_json(LEDGER_PATH, None), "local"
    if status == "error":
        if log is not None:
            log.append("signal stacks: admin ledger could not be read; no new locks this run (watchlist only)")
        return None, "blocked"
    return body, "remote"


def _save_ledger(saved, mode, path, log):
    if mode == "local":
        write_json(path or LEDGER_PATH, saved)
    elif mode == "remote":
        from . import supa
        supa.sync_signal_research([{"id": "ledger", "kind": "ledger", "body": saved}], log if log is not None else [])


def update(out, players, rows, now, path=None, log=None):
    """Lock new eligible props and rebuild the watchlist.  Returns the PUBLIC payload (display fields only)."""
    sha = registry_sha()
    saved, mode = _load_ledger(path, log)
    new_ledger = saved is None and mode != "blocked"
    if mode == "blocked":
        saved = {"version": None, "frozen_at": iso(now), "registry_sha256": sha, "records": {}}   # in-memory only, never saved
    elif new_ledger:
        saved = {"version": VERSION, "frozen_at": iso(now), "registry_sha256": sha, "records": {}}
    locking_ok = saved.get("version") == VERSION and saved.get("registry_sha256") == sha
    if not locking_ok and log is not None:
        log.append("signal stacks: rule registry changed without a new ledger version; no new locks (watchlist only)")
    frozen_at = parse_iso(saved["frozen_at"])
    records, changed = saved["records"], new_ledger
    watch = {}
    games = out.get("games") or {}
    for pid, rs in rows.items():
        p = players.get(pid)
        if not p:
            continue
        for r in rs:
            ko = parse_iso(r["ko"])
            if r.get("final") or ko is None or ko <= now:
                continue                                   # never create a decision after kickoff
            for mid, m in (r.get("m") or {}).items():
                if mid not in ("pass_yds", "rush_yds", "rec", "rec_yds"):
                    continue                               # markets with a historical research base
                key = "|".join([r["gid"], pid, mid])
                if key in records:
                    continue                               # locked: never recomputed (repeat captures change nothing)
                quote = _lock_quote(m, ko, now, frozen_at) if locking_ok else None
                if quote:
                    ev = evaluate_prop(pid, p, r, mid, quote, rows.get(pid, []), games.get(r["gid"]), out, now)
                    records[key] = {"gid": r["gid"], "pid": pid, "mid": mid, "wk": r["wk"], "ko": r["ko"], "pos": p["pos"],
                                    "evaluated_utc": iso(now), "quote": quote, "rule_versions": {s["id"]: s["version"] for s in ev["signals"]},
                                    "registry_sha256": sha, **ev, "stack": stack_summary(ev["signals"])}
                    changed = True
                    continue
                wq = _watch_quote(m, now)
                if wq:
                    ev = evaluate_prop(pid, p, r, mid, wq, rows.get(pid, []), games.get(r["gid"]), out, now)
                    watch[key] = {"gid": r["gid"], "pid": pid, "mid": mid, "wk": r["wk"], "ko": r["ko"], "evaluated_utc": iso(now),
                                  "quote": wq, **ev, "stack": stack_summary(ev["signals"])}
    if changed and mode != "blocked":
        _save_ledger(saved, mode, path, log)
    props = {}
    for k, rec in watch.items():
        if rec["signals"]:
            props[k] = public_prop(rec, "watch", _model_callout(out, k))
    for k, rec in records.items():
        if parse_iso(rec["ko"]) > now and rec["signals"]:
            props[k] = public_prop(rec, "locked", _model_callout(out, k))
    return {"version": VERSION, "generated_utc": iso(now), "registry": public_registry(),
            "families": {k: {"label": v["label"], "note": v["note"]} for k, v in FAMILIES.items()}, "props": props,
            "locked_total": len(records), "frozen_at": saved["frozen_at"]}


# ------------------------------------------------------------------ forward grading (Challenger)
def _result(rec, game_rows):
    """Grade a locked prop from the saved quote and the actual stat; None until the game is final."""
    r = game_rows.get(rec["gid"])
    if not r or not r.get("final"):
        return None
    if r.get("played") is False:
        return "void"
    mm = (r.get("m") or {}).get(rec["mid"]) or {}
    act = mm.get("act")
    if r.get("played") is not True or act is None:
        return None
    line = rec["quote"]["line"]
    return "over" if act > line else "under" if act < line else "push"


def group_of(stack, side, basis):
    """Evaluation group for one prop-side.  basis 'qualified' counts qualified families only; 'active' = qualified + testing.
    A mixed family counts as opposing."""
    tiers = ("qualified",) if basis == "qualified" else ("qualified", "testing")
    sup = sum(stack[side][t]["support"] for t in tiers)
    opp = sum(stack[side][t]["oppose"] for t in tiers) + sum(len(stack["mixed"][t]) for t in tiers)
    if sup == 0:
        return None, sup, opp
    if sup >= 3:
        return ("3+ with opposition" if opp else "3+ clean"), sup, opp
    return str(sup), sup, opp


def _agg(bets):
    w = sum(b["res"] == b["side"] for b in bets); push = sum(b["res"] == "push" for b in bets)
    l = len(bets) - w - push
    units = sum((payout(b["price"]) if b["res"] == b["side"] else -1.0) for b in bets if b["res"] != "push")
    n = w + l
    return {"bets": len(bets), "W": w, "L": l, "P": push, "hit": (w / n if n else None), "units": round(units, 3),
            "roi": (units / n if n else None), "games": len({b["gid"] for b in bets})}


def forward_report(ledger_records, rows, model_records=None):
    """Grade locked snapshots once per prop and side for each evaluation group; compare with matched baselines and the
    frozen model.  Everything here is FORWARD (locked before kickoff); nothing historical is mixed in."""
    game_rows = {}
    byg = {}
    for pid, rs in rows.items():
        for r in rs:
            byg[(r["gid"], pid)] = r
    graded = []
    for key, rec in ledger_records.items():
        r = byg.get((rec["gid"], rec["pid"]))
        res = _result(rec, {rec["gid"]: r} if r else {})
        if res is None or res == "void":
            continue
        for side in ("over", "under"):
            price = rec["quote"]["op"] if side == "over" else rec["quote"]["up"]
            graded.append({"key": key, "gid": rec["gid"], "wk": rec["wk"], "mid": rec["mid"], "side": side, "res": res, "price": price,
                           "stack": rec["stack"], "pid": rec["pid"],
                           "sids": [s["id"] for s in rec["signals"] if s["side"] == side]})
    report = {"version": VERSION, "kind": "forward (locked before kickoff)", "bets_graded_props": len({g["key"] for g in graded}),
              "bases": {}}
    base_cell = defaultdict(list)
    for g in graded:
        base_cell[(g["mid"], g["side"])].append(g)
    for basis in ("qualified", "active"):
        groups = defaultdict(list)
        for g in graded:
            grp, _, _ = group_of(g["stack"], g["side"], basis)
            if grp:
                groups[grp].append(g)         # one bet per (prop, side) per group: each prop-side is in exactly one group
        out = {}
        for grp, bets in groups.items():
            weeks = defaultdict(list)
            for b in bets:
                weeks[b["wk"]].append(b)
            cum, cum_rows = [], []
            for wk in sorted(weeks):
                cum += weeks[wk]
                cum_rows.append({"week": wk, "weekly": _agg(weeks[wk]), "cumulative": _agg(cum)})
            mix = defaultdict(int)
            for b in bets:
                mix[(b["mid"], b["side"])] += 1
            tot = sum(mix.values())
            base_hit = sum(_agg(base_cell[c])["hit"] * n for c, n in mix.items() if _agg(base_cell[c])["hit"] is not None) / tot
            base_roi = sum(_agg(base_cell[c])["roi"] * n for c, n in mix.items() if _agg(base_cell[c])["roi"] is not None) / tot
            out[grp] = {**_agg(bets), "by_week": cum_rows, "matched_baseline": {"hit": base_hit, "roi": base_roi,
                        "note": "all locked props in the same markets and sides, weighted to this group's mix"}}
        report["bases"][basis] = out
    # per-signal forward record: each locked prop-side where the signal fired for that side, graded once
    by_signal = {}
    for sid, d in REGISTRY.items():
        bets = [g for g in graded if sid in g["sids"]]
        agg = _agg(bets)
        agg["weeks"] = len({b["wk"] for b in bets})
        agg["status"] = d["status"]; agg["version"] = d["version"]
        agg["qualification"] = qualification_status(agg)
        by_signal[sid] = agg
    report["by_signal"] = by_signal
    # frozen model picks vs the subset that also has stack support
    comp = {}
    for name in ("t12", "t13"):
        picks = []
        for g in graded:
            mr = (model_records or {}).get(g["key"], {})
            d = (mr.get("decisions") or {}).get(name)
            if d and d.get("qualifies") and d.get("side") == g["side"]:
                picks.append(g)
        sup = [g for g in picks if group_of(g["stack"], g["side"], "active")[0]]
        clean = [g for g in sup if group_of(g["stack"], g["side"], "active")[2] == 0]
        comp[name] = {"model_picks": _agg(picks), "with_stack_support": _agg(sup), "supported_and_unopposed": _agg(clean),
                      "coverage_kept": (len(sup) / len(picks) if picks else None),
                      "coverage_lost": (1 - len(sup) / len(picks) if picks else None)}
    report["frozen_model_vs_stack"] = comp
    return report


def qualification_status(stats):
    """Which QUALIFY criteria a testing signal currently meets.  stats = forward aggregate for the rule (or None)."""
    st = stats or {"bets": 0, "games": 0, "weeks": 0, "roi": None}
    checks = {"min_bets": st.get("bets", 0) >= QUALIFY["min_bets"], "min_games": st.get("games", 0) >= QUALIFY["min_games"],
              "min_weeks": st.get("weeks", 0) >= QUALIFY["min_weeks"], "positive_roi": bool(st.get("roi") is not None and st["roi"] > 0)}
    return {"checks": checks, "qualified": all(checks.values()) and bool(st.get("passes_stability_price_and_bh"))}


def _model_records():
    """Frozen (T11/T12) and Challenger (T13) pregame ledgers, keyed gid|pid|mid."""
    recs = dict(read_json(DATA / "frozen_leads.json", {}).get("records", {}))
    root = DATA / "challenger" / "ledgers"
    if root.exists():
        for f in sorted(root.glob("*.json")):
            for k, v in read_json(f, {}).get("records", {}).items():
                recs.setdefault(k, {"decisions": {}})
                recs[k] = {**recs[k], "decisions": {**recs[k].get("decisions", {}), **v.get("decisions", {})}}
    return recs


FORWARD_PATH = DATA / "challenger" / "signal_stacks_forward.json"


def publish_forward(rows, now, log=None, path=None, forward_path=None, display=None):
    """Forward grading wired into the Challenger outputs: writes data/challenger/signal_stacks_forward.json (only when the
    numbers change) and sends the same report to the admin-only Supabase table `signal_research` (never to the site payload)."""
    saved, mode = _load_ledger(path, log)
    if mode == "blocked":
        return None
    records = (saved or {}).get("records", {})
    report = forward_report(records, rows, _model_records())
    report["registry_sha256"] = registry_sha()
    body = json.dumps(report, sort_keys=True)
    if mode == "local":    # remote mode: the report goes ONLY to the admin table (nothing is written into git)
        fp = forward_path or FORWARD_PATH
        old = read_json(fp, None)
        if old is None or json.dumps({k: v for k, v in old.items() if k != "generated_utc"}, sort_keys=True) != body:
            write_json(fp, {**report, "generated_utc": iso(now)})
    try:
        from . import supa
        rows_out = [{"id": "forward", "kind": "forward", "body": {**report, "generated_utc": iso(now)}}]
        if display is not None:    # the admin-only display payload used by the Stacks surfaces
            rows_out.append({"id": "display", "kind": "display", "body": display})
        supa.sync_signal_research(rows_out, log if log is not None else [])
    except Exception as ex:  # optional: never stops a build
        if log is not None:
            log.append(f"signal stacks: admin sync skipped ({type(ex).__name__}: {str(ex)[:80]})")
    return report
