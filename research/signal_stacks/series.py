"""Weekly hit-rate series per Signal Stacks rule, 2025 + 2026 (REPLAY of today's rule on historical lines).

python -m research.signal_stacks.series [--out DIR]      (needs props.csv from research.signal_stacks.dataset)

For every rule in pipeline.signals.REGISTRY this applies the rule exactly as written to each graded pregame main line
(props.csv: 2025 archive snapshot at kickoff - 3 h, 2026 the app's graded pregame capture) and records W / L / P and
flat 1-unit profit at the saved price per (season, week).  Pushes are refunded and left out of the hit rate.
Writes series_signal_research.sql (admin-only table rows 'series:<ID>', NOT committed) and series.json.

Honest limits (also written into every row's note):
  * Replay, not forward: the spread is nflverse's schedule spread_line (closing-type), weather is the observed post-game record.
  * "Last game" history comes from the player's earlier games that have a graded line in props.csv.
  * L1, L3, L4 need the depth-chart slot (WR2, TE1, QB1), which exists for 2026 only; 2025 weeks are left out and the row says so.
  * L5 usage: 2026 from the app's rows, 2025 from nflverse target share / offensive snap share.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from pipeline.common import norm_name
from pipeline.signals import REGISTRY

ROOT = Path(__file__).resolve().parents[2]
NOTE_BASE = ("Replay of the rule as written on past lines (DraftKings, FanDuel fallback, about 3 h before kickoff), flat 1 unit at the saved price, "
             "pushes refunded; four markets only (pass yds, rush yds, receptions, rec yds). Spread = nflverse schedule spread_line (closing-type, not a capture-time quote); weather = observed, not a forecast.")
NO_SLOT_2025 = "2025 weeks are not shown: this rule needs the depth-chart slot, which was only captured from 2026."


def payout(p):
    p = float(p)
    return p / 100 if p > 0 else 100 / abs(p)


def fl(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def load(path, cache):
    rows = []
    for r in csv.DictReader(open(path)):
        if r["result"] not in ("over", "under", "push"):
            continue
        r["season"] = int(r["season"]); r["week"] = int(r["week"]); r["line"] = float(r["line"])
        for k in ("over_price", "under_price", "team_spread", "temp_f", "wind_mph", "actual"):
            r[k] = fl(r[k])
        r["played"] = r["played"] == "True"
        rows.append(r)
    return rows


def usage_tables(cache):
    D = json.load(open(ROOT / "site/data/data.json"))
    slot, use = {}, {}
    for pid, prs in D["rows"].items():
        for r in prs:
            slot[(2026, pid, r["wk"])] = r.get("slot")
            pos = next((p["pos"] for p in D["players"] if p["id"] == pid), None) if False else None
            use[(2026, pid, r["wk"])] = (r.get("snap"), None if r.get("tshare") is None else r["tshare"] * 100)
    pos26 = {p["id"]: p["pos"] for p in D["players"]}
    for (s, pid, wk), (snap, ts) in list(use.items()):
        use[(s, pid, wk)] = snap if pos26.get(pid) == "RB" else ts
    # 2025: nflverse
    ts25 = {}
    for r in csv.DictReader(open(cache / "stats_2025.csv", encoding="utf-8-sig")):
        if r["season_type"] == "REG":
            ts25[(int(r["week"]), r["player_id"])] = fl(r["target_share"])
    sn25 = {}
    for r in csv.DictReader(open(cache / "snaps_2025.csv", encoding="utf-8-sig")):
        if r.get("game_type", "REG") == "REG":
            sn25[(int(r["week"]), r["team"], norm_name(r["player"]))] = (fl(r["offense_pct"]) or 0) * 100
    return slot, use, ts25, sn25


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/home/claude/stix_research/out")
    ap.add_argument("--cache", default="/home/claude/stix_research/cache")
    a = ap.parse_args()
    out, cache = Path(a.out), Path(a.cache)
    props = load(out / "props.csv", cache)
    slot, use26, ts25, sn25 = usage_tables(cache)

    by = defaultdict(dict)               # (season, pid) -> week -> {"m": {mid: row}, ...}
    for r in props:
        g = by[(r["season"], r["pid"])].setdefault(r["week"], {"m": {}, "ha": r["ha"], "team": r["team"], "played": False, "pos": r["pos"], "name": r["name"]})
        g["m"][r["market"]] = r
        g["played"] = g["played"] or r["played"]

    def usage(season, pid, wk, g):
        if season == 2026:
            return use26.get((2026, pid, wk))
        if g["pos"] == "RB":
            return sn25.get((wk, g["team"], norm_name(g["name"])))
        v = ts25.get((wk, pid))
        return None if v is None else v * 100

    bets = defaultdict(list)             # signal id -> [(season, week, result, side, op, up, gid)]

    def add(sid, r):
        bets[sid].append((r["season"], r["week"], r["result"], REGISTRY[sid]["side"], r["over_price"], r["under_price"], r["gid"]))

    for r in props:
        pos, mid, ts = r["pos"], r["market"], r["team_spread"]
        pid, season, wk = r["pid"], r["season"], r["week"]
        games = by[(season, pid)]
        past_wks = sorted(w for w in games if w < wk)
        prev = games[past_wks[-1]] if past_wks else None
        played = [games[w] for w in past_wks if games[w]["played"]]
        pm = prev["m"].get(mid) if prev else None
        pl = pm["line"] if pm else None
        ap_ = lambda sid: (REGISTRY[sid]["markets"] is None or mid in REGISTRY[sid]["markets"]) and (REGISTRY[sid]["pos"] is None or pos in REGISTRY[sid]["pos"])
        sl = slot.get((season, pid, wk)) if season == 2026 else None
        if ts is not None:                                   # game script: SP1-5, L6-8
            if ts >= 10 and ap_("SP1"): add("SP1", r)
            if ts >= 10 and ap_("SP2"): add("SP2", r)
            if ts <= -10 and ap_("SP3"): add("SP3", r)
            if ts >= 10 and ap_("SP4"): add("SP4", r)
            if 3 <= ts <= 6.5 and ap_("SP5"): add("SP5", r)
            fav_by = -ts                                     # + = player's team favored
            if fav_by >= 7 and pos == "RB" and mid == "rush_yds": add("L6", r)
            if fav_by <= -7 and mid == "pass_yds": add("L7", r)
            if fav_by <= -7 and pos in ("WR", "TE") and mid == "rec_yds": add("L8", r)
        indoor = r["roof"] in ("dome", "closed")
        if not indoor and r["wind_mph"] is not None and r["wind_mph"] >= 15 and ap_("WX1"): add("WX1", r)
        if not indoor and r["temp_f"] is not None and r["temp_f"] < 55 and ap_("WX2"): add("WX2", r)
        if sl == "WR2" and pm and pm["result"] == "over": add("L1", r)
        if r["ha"] == "away" and pl is not None and r["line"] > pl: add("L2", r)
        if sl == "TE1" and mid == "rec_yds": add("L3", r)
        if sl == "QB1" and mid == "rush_yds": add("L4", r)
        if pos != "QB" and pl is not None:                   # L5 usage down, line flat
            us = [u for u in (usage(season, pid, w, games[w]) for w in past_wks if games[w]["played"]) if u is not None]
            if len(us) >= 4:
                drop = sum(us[-2:]) / 2 - sum(us[:-2]) / len(us[:-2])
                tol = 0.5 if mid in ("rec", "rush_att", "pass_att", "pass_cmp") else 10 if mid == "pass_yds" else 5
                if drop <= -(10 if pos == "RB" else 5) and abs(r["line"] - pl) <= tol:
                    add("L5", r)
        if pos == "WR" and len(played) >= 3:
            last = played[-3:]
            if mid == "rec_yds" and all((x["m"].get("rec_yds") or {}).get("result") == "over" for x in last): add("L9", r)
            vals = [(x["m"].get("rec") or {}).get("actual") for x in last]
            if mid == "rec" and all(v is not None for v in vals) and vals[0] < vals[1] < vals[2]: add("L10", r)

    rows, summary = [], {}
    for sid, d in REGISTRY.items():
        wk = defaultdict(lambda: [0, 0, 0, 0.0])
        for season, week, res, side, op, up, gid in bets.get(sid, []):
            c = wk[(season, week)]
            if res == "push":
                c[2] += 1
            elif res == side:
                c[0] += 1
                price = op if side == "over" else up
                c[3] += payout(price) if price is not None else 0.0
            else:
                c[1] += 1; c[3] -= 1
        weeks = [{"s": s, "w": w, "W": c[0], "L": c[1], "P": c[2], "u": round(c[3], 3)} for (s, w), c in sorted(wk.items())]
        note = NO_SLOT_2025 if sid in ("L1", "L3", "L4") else ""      # shown under the chart; the method text stays in the row only
        W = sum(x["W"] for x in weeks); L = sum(x["L"] for x in weeks)
        summary[sid] = (W, L, round(100 * W / (W + L), 1) if W + L else None, len(weeks))
        rows.append((f"series:{sid}", {"signal": sid, "side": d["side"], "weeks": weeks, "note": note, "method": NOTE_BASE, "breakeven": 0.5238}))
    (out / "series.json").write_text(json.dumps(dict(rows), indent=1))
    sql = ["-- Weekly hit-rate series for Signal Stacks (admin-only table; kind 'history'). Generated by research/signal_stacks/series.py.",
           "-- Touches only public.signal_research rows whose id starts with 'series:'.",
           "insert into public.signal_research (id, kind, body) values"]
    sql.append(",\n".join("  ('%s', 'history', '%s'::jsonb)" % (i, json.dumps(b, separators=(",", ":")).replace("'", "''")) for i, b in rows))
    sql.append("on conflict (id) do update set body = excluded.body, updated_utc = now();")
    (out / "series_signal_research.sql").write_text("\n".join(sql) + "\n")
    for sid, v in summary.items():
        print(f"{sid:4} W {v[0]:4} L {v[1]:4} hit {v[2]}%  weeks {v[3]}")


if __name__ == "__main__":
    main()
