"""Per-prop feature columns for the three-season re-run (inputs: /tmp/three_season.pkl from data.py).
Everything is information available before kickoff, except where a column says 'post-game' (spread/total/weather are
nflverse closing-type / observed values, as in every earlier audit)."""
from __future__ import annotations

import os

import pickle
from collections import defaultdict

import numpy as np

MKTS = ("pass_yds", "rush_yds", "rec", "rec_yds")


def nanmean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def build(path="/tmp/three_season.pkl"):
    d = pickle.load(open(path, "rb"))
    games, props, tl, s7, states, rdet, q1 = d["games"], d["props"], d["tl"], d["s7"], d["states"], d["rdet"], d["q1"]
    P = {(p["season"], p["pid"], p["wk"], p["mid"]): p for p in props}
    T = {k: [v[w] for w in sorted(v)] for k, v in tl.items()}           # (season,pid) -> entries by week
    # team game lists
    tgames = defaultdict(list)
    for gid, g in games.items():
        tgames[(g["season"], g["home"])].append(gid)
        tgames[(g["season"], g["away"])].append(gid)
    for k in tgames:
        tgames[k].sort(key=lambda x: games[x]["wk"])

    def team_prev_gid(s, team, wk):
        prev = [x for x in tgames[(s, team)] if games[x]["wk"] < wk]
        return prev[-1] if prev else None

    # ATS per team-game
    def ats(gid, team):
        g = games[gid]
        if g["spread"] is None:
            return ""
        margin = (g["hs"] - g["as"]) if team == g["home"] else (g["as"] - g["hs"])
        line = g["spread"] if team == g["home"] else -g["spread"]   # points team favoured by
        return "C" if margin > line else "NC" if margin < line else ""

    # ---- slots (approx., pre-game snap share) ----
    by_tw = defaultdict(list)
    for (s, pid), ents in T.items():
        for i, e in enumerate(ents):
            by_tw[(s, e["team"], e["wk"])].append((pid, e, ents[:i]))
    prevseason = defaultdict(list)  # (s, pid) -> last snaps prior season
    for (s, pid), ents in T.items():
        prevseason[(s + 1, pid)] = [e["snap"] for e in ents if e["played"] and e["snap"] is not None][-3:]
    for pid, lst in d["snap23"].items():
        prevseason[(2024, pid)] = [x[2] for x in sorted(lst)][-3:]
    propteam = defaultdict(set)
    for p in props:
        propteam[(p["season"], p["gid"], p["team"])].add(p["pid"])
    slot = {}
    for (s, team, wk), lst in by_tw.items():
        for pos, n in (("QB", 1), ("RB", 2), ("WR", 3), ("TE", 2)):
            cand = []
            for pid, e, past in lst:
                if e["pos"] != pos or e["status"] in ("RES", "INA", "CUT"):
                    continue
                h = [x["snap"] for x in past if x["played"] and x["team"] == team and x["snap"] is not None][-3:]
                if not h:
                    h = prevseason.get((s, pid), [])
                sc = sum(h) / len(h) if h else -1
                haspr = pid in propteam.get((s, e["gid"], team), set())
                cand.append((sc, haspr, pid))
            cand.sort(reverse=True)
            for i, (_, _, pid) in enumerate(cand[:n]):
                slot[(s, pid, wk)] = f"{pos}{i + 1}"
    # ---- opponent allowed (season to date) per pos-market ----
    allowed = defaultdict(lambda: defaultdict(float))  # (s, def, wk) -> (pos,mid) -> total
    for (s, pid), ents in T.items():
        for e in ents:
            if not e["played"]:
                continue
            g = games[e["gid"]]
            dfn = g["away"] if e["team"] == g["home"] else g["home"]
            for mid in MKTS:
                allowed[(s, dfn, e["wk"])][(e["pos"], mid)] += e["act"].get(mid, 0.0)
    oppq = {}
    for s in (2024, 2025, 2026):
        teams = sorted({t for (ss, t) in tgames if ss == s})
        for wk in range(1, 19):
            vals = defaultdict(dict)
            for t in teams:
                past = [allowed[(s, t, games[x]["wk"])] for x in tgames[(s, t)] if games[x]["wk"] < wk]
                if len(past) < 3:
                    continue
                for pm in [(p_, m_) for p_ in ("QB", "RB", "WR", "TE") for m_ in MKTS]:
                    vals[pm][t] = sum(x.get(pm, 0.0) for x in past) / len(past)
            for pm, tv in vals.items():
                order = sorted(tv, key=lambda t: (tv[t], t))
                n = len(order)
                for i, t in enumerate(order):
                    oppq[(s, t, wk, pm)] = "tough" if i < n / 4 else "soft" if i >= n - n / 4 else ""
    # ---- QBs per game (1st quarter) ----
    qbset = {(s, pid) for (s, pid), ents in T.items() if any(e["pos"] == "QB" for e in ents)}

    def q1qb(gid, team):
        s = games[gid]["season"]
        dct = q1.get((gid, team), {})
        c = [(v[0], -v[1], pid) for pid, v in dct.items() if (s, pid) in qbset]
        return max(c)[2] if c else None

    qbline = defaultdict(list)
    for p in props:
        if p["pos"] == "QB" and p["mid"] in ("pass_yds", "rush_yds"):
            qbline[(p["gid"], p["team"], p["mid"])].append((p["line"], p["pid"]))
    qbch = {}
    for (s, team), gl in tgames.items():
        for i, gid in enumerate(gl):
            if i == 0:
                continue
            prevq = q1qb(gl[i - 1], team)
            cur = None
            for mid in ("pass_yds", "rush_yds"):
                if qbline.get((gid, team, mid)):
                    cur = max(qbline[(gid, team, mid)])[1]
                    break
            if cur is None:
                cur = q1qb(gid, team)
            if prevq and cur:
                qbch[(gid, team)] = cur != prevq
    # ---- CM (QB line change vs receivers, previous calendar week) ----
    cm = {}      # (s, team, wk) -> dict
    for (s, team), gl in tgames.items():
        for gid in gl:
            wk = games[gid]["wk"]
            q = qbline.get((gid, team, "pass_yds"))
            if not q:
                continue
            ln, qpid = max(q)
            pp = P.get((s, qpid, wk - 1, "pass_yds"))
            if not pp or pp["team"] != team:
                continue
            qchg = ln - pp["line"]
            cm[(s, team, wk)] = {"qchg": qchg, "qpid": qpid}
    # receivers matched (built from props index for speed)
    byteam = defaultdict(list)
    for p in props:
        byteam[(p["season"], p["team"], p["wk"], p["mid"])].append(p)
    for (s, team, wk), c in cm.items():
        for mid, key in (("rec_yds", "gap"), ("rec", "recsum")):
            ch = {}
            for p in byteam.get((s, team, wk, mid), []):
                if p["pos"] not in ("WR", "TE", "RB"):
                    continue
                pp = P.get((s, p["pid"], wk - 1, mid))
                if pp:
                    ch[p["pid"]] = p["line"] - pp["line"]
            c[mid + "_n"] = len(ch)
            c[mid + "_set"] = set(ch)
            c[key] = (sum(ch.values()) - c["qchg"]) if key == "gap" else sum(ch.values())
    # ---- career catches/yards before each game (since 2024) ----
    order = sorted(games, key=lambda x: (games[x]["season"], games[x]["wk"], x))
    cum, hist_before = defaultdict(lambda: [0, 0.0]), {}
    if os.environ.get("SEED2223") == "1":   # start career catches/yards from 2022-23 (default: since 2024)
        for k, v in d.get("seed", {}).items():
            cum[k] = list(v)
    rbyg = defaultdict(dict)
    for (gid, pid), e in rdet.items():
        rbyg[gid][pid] = e
    for gid in order:
        for pid in rbyg.get(gid, {}):
            hist_before[(gid, pid)] = tuple(cum[pid])
        for pid, e in rbyg.get(gid, {}).items():
            cum[pid][0] += e["rc"]; cum[pid][1] += e["ry"]
    # team prior-game pass-rate states (SC3)
    # ---- columns ----
    cols = defaultdict(list)
    keep = []
    for p in props:
        if p["res"] not in ("over", "under", "push") or p["op"] is None or p["up"] is None or p["line"] is None:
            continue
        s, pid, wk, mid, team = p["season"], p["pid"], p["wk"], p["mid"], p["team"]
        g = games[p["gid"]]
        home = team == g["home"]
        ents = [e for e in T.get((s, pid), []) if e["wk"] < wk]
        played = [e for e in ents if e["played"]]
        prev = ents[-1] if ents else None
        pm = P.get((s, pid, prev["wk"], mid)) if prev else None
        c = cols
        c["season"].append(s); c["wk"].append(wk); c["pos"].append(p["pos"]); c["mid"].append(mid)
        c["pid"].append(pid); c["name"].append(p["name"]); c["gid"].append(p["gid"]); c["team"].append(team)
        c["line"].append(p["line"]); c["op"].append(p["op"]); c["up"].append(p["up"]); c["res"].append(p["res"])
        c["act"].append(p["act"] if p["act"] is not None else np.nan)
        ts = None if g["spread"] is None else (-g["spread"] if home else g["spread"])
        c["ts"].append(np.nan if ts is None else ts)
        c["total"].append(np.nan if g["total"] is None else g["total"])
        outdoor = g["roof"] in ("outdoors", "open")
        c["outdoor"].append(outdoor); c["dome"].append(g["roof"] in ("dome", "closed"))
        c["temp"].append(np.nan if g["temp"] is None else g["temp"]); c["wind"].append(np.nan if g["wind"] is None else g["wind"])
        c["home"].append(home); c["div"].append(g["div"])
        c["prime"].append((g["gametime"] or "") >= "19:00")
        rest = g["home_rest"] if home else g["away_rest"]
        c["rest"].append(np.nan if rest is None else rest)
        c["slot"].append(slot.get((s, pid, wk), ""))
        c["prev_ok"].append(prev is not None); c["pplayed"].append(bool(prev and prev["played"]))
        c["pl"].append(pm["line"] if pm else np.nan); c["pres"].append(pm["res"] if pm else "")
        c["pact"].append(pm["act"] if pm and pm["act"] is not None else np.nan)
        a = [e["act"].get(mid) for e in played]
        c["n_played"].append(len(a))
        last4 = a[-4:]
        for i in range(4):
            c[f"a{i + 1}"].append(last4[-(i + 1)] if len(last4) > i else np.nan)    # a1 = most recent
        c["m3"].append(sum(a[-3:]) / 3 if len(a) >= 3 else np.nan)
        c["mszn"].append(sum(a) / len(a) if len(a) >= 4 else np.nan)
        r3 = []
        for e in played[-3:]:
            q = P.get((s, pid, e["wk"], mid))
            r3.append(q["res"] if q else "")
        c["r3"].append("|".join(r3) if len(r3) == 3 else "")
        lp = P.get((s, pid, played[-1]["wk"], mid)) if played else None
        c["lpl"].append(lp["line"] if lp else np.nan)
        # usage
        us = [(e["tshare"] if p["pos"] in ("WR", "TE") else e["snap"]) for e in played]
        us = [u for u in us if u is not None]
        c["u_n"].append(len(us))
        c["u_last2"].append(sum(us[-2:]) / 2 if len(us) >= 4 else np.nan)
        c["u_early"].append(sum(us[:-2]) / len(us[:-2]) if len(us) >= 4 else np.nan)
        tsh = [e["tshare"] for e in played if e["tshare"] is not None]
        c["tsh_chg"].append(tsh[-1] - tsh[-2] if len(tsh) >= 2 else np.nan)
        c["tsh_vs3"].append(tsh[-1] - sum(tsh[-4:-1]) / 3 if len(tsh) >= 4 else np.nan)
        sn = [e["snap"] for e in played if e["snap"] is not None]
        lowp = False
        if prev and prev["played"] and prev["snap"] is not None and len(sn) >= 4:
            m = sum(sn[-4:-1]) / 3
            lowp = (m - prev["snap"] >= 20) and (prev["snap"] <= 0.6 * m)
        c["lowp"].append(lowp)
        miss = 0
        if played:
            for e in reversed(ents):
                if e["played"]:
                    break
                miss += 1
        c["missed"].append(miss)
        # game script, previous team game
        pg = team_prev_gid(s, team, wk)
        v = s7.get((pg, team)) if pg else None
        c["tr7"].append(v[1] / v[0] if v and v[0] else np.nan); c["ld7"].append(v[2] / v[0] if v and v[0] else np.nan)
        c["tr13"].append(v[3] / v[0] if v and v[0] else np.nan)
        opp = g["away"] if home else g["home"]
        po = team_prev_gid(s, opp, wk)
        c["ats_t"].append(ats(pg, team) if pg else ""); c["ats_o"].append(ats(po, opp) if po else "")
        dn = [0, 0]; cl = [0, 0]
        for x in tgames[(s, team)]:
            if games[x]["wk"] >= wk:
                break
            st = states.get((x, team))
            if st:
                dn[0] += st["dn"][0]; dn[1] += st["dn"][1]; cl[0] += st["cl"][0]; cl[1] += st["cl"][1]
        c["sc3gap"].append(100 * (dn[1] / dn[0] - cl[1] / cl[0]) if dn[0] >= 20 and cl[0] >= 20 else np.nan)
        # receiving detail of previous team game
        r = rdet.get((prev["gid"], pid)) if prev and prev["played"] else None
        for k in ("tot", "h1", "q1", "q4", "lc", "rc", "ry"):
            c["rd_" + k].append(r[k] if r and r[k] is not None else np.nan)
        hb = hist_before.get((prev["gid"], pid), (0, 0.0)) if prev else (0, 0.0)
        c["hc"].append(hb[0]); c["hy"].append(hb[1])
        c["qbch"].append(qbch.get((p["gid"], team), None) is True)
        cmx = cm.get((s, team, wk))
        c["cm_qchg"].append(cmx["qchg"] if cmx else np.nan)
        inset = cmx is not None and pid in cmx.get(mid + "_set", set())
        c["cm_in"].append(inset)
        c["cm_gap"].append(cmx["gap"] if cmx and "gap" in cmx else np.nan)
        c["cm_n"].append(cmx.get("rec_yds_n", 0) if cmx else 0)
        c["cm_recsum"].append(cmx["recsum"] if cmx and "recsum" in cmx else np.nan)
        c["cm_recn"].append(cmx.get("rec_n", 0) if cmx else 0)
        c["cm_isqb"].append(bool(cmx and cmx["qpid"] == pid))
        c["oppq"].append(oppq.get((s, opp, wk, (p["pos"], mid)), ""))
        keep.append(p)
    out = {}
    for k, v in cols.items():
        try:
            out[k] = np.array(v, dtype=float) if not isinstance(v[0], (str, bool, np.bool_)) else np.array(v)
        except (TypeError, ValueError):
            out[k] = np.array(v, dtype=object)
    return out


if __name__ == "__main__":
    F = build()
    print(len(F["line"]), {k: F[k].dtype for k in list(F)[:10]})
