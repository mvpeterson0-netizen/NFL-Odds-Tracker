"""Pooled + per-player split tests on props.csv. Writes pooled.csv, players.csv, holdout.json."""
import json
import numpy as np, pandas as pd
from scipy import stats

d = pd.read_csv("props.csv")
d = d[d.res != "push"].copy()
d["under"] = (d.res == "under").astype(int)
d["resid"] = d.act - d.line


def payout(odds):
    o = np.where(pd.isna(odds), -110, odds)
    return np.where(o > 0, o / 100, 100 / np.abs(o))


d["u_pay"] = payout(d.up)
d["o_pay"] = payout(d.op)
d["u_profit"] = np.where(d.under == 1, d.u_pay, -1.0)
d["o_profit"] = np.where(d.under == 0, d.o_pay, -1.0)
d["pos"] = d.pos.where(d.pos.isin(["QB", "RB", "WR", "TE"]), "OTH")

CONDS = [c for c in d.columns if c.startswith("c_")]
LABEL = {"c_home": "Home", "c_turf": "Turf", "c_dome": "Dome/closed roof", "c_early": "Sun early (1pm ET)",
         "c_late": "Sun late (4pm ET)", "c_prime": "Prime time (night)", "c_thursday": "Thursday night",
         "c_monday": "Monday night", "c_division": "Division game", "c_favorite": "Team favored",
         "c_big_dog": "Team 6.5+ underdog", "c_short_rest": "Short rest (≤5 days)", "c_off_bye": "Off bye",
         "c_high_total": "Game total 47+", "c_cold": "Cold (≤40°F, outdoors)", "c_windy": "Wind 15+ mph (outdoors)",
         "c_west_early_away": "West Coast team, 1pm ET away"}


def bh(p):
    p = np.asarray(p, float); n = len(p); o = np.argsort(p)
    q = p[o] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out = np.empty(n); out[o] = np.minimum(q, 1); return out


def two_prop_p(k1, n1, k0, n0):
    p = (k1 + k0) / (n1 + n0)
    se = np.sqrt(p * (1 - p) * (1 / n1 + 1 / n0))
    return 1.0 if se == 0 else 2 * stats.norm.sf(abs((k1 / n1 - k0 / n0) / se))


# ---------------- pooled ----------------
rows = []
for mkt in ("rush_yds", "rec_yds"):
    for pos in ("ALL", "QB", "RB", "WR", "TE"):
        s = d[d.mkt == mkt] if pos == "ALL" else d[(d.mkt == mkt) & (d.pos == pos)]
        if len(s) < 200:
            continue
        for c in CONDS:
            t = s[s[c].notna()]
            a, b = t[t[c] == 1], t[t[c] == 0]
            if len(a) < 40 or len(b) < 40:
                continue
            r = dict(mkt=mkt, pos=pos, cond=LABEL[c], n_in=len(a), n_out=len(b), under_in=a.under.mean(),
                     under_out=b.under.mean(), resid_in=a.resid.mean(), resid_out=b.resid.mean(),
                     roi_under_in=a.u_profit.mean(), p_diff=two_prop_p(a.under.sum(), len(a), b.under.sum(), len(b)),
                     p_vs50=stats.binomtest(int(a.under.sum()), len(a), 0.5).pvalue)
            # replication: 2024-25 vs 2026
            for tag, ss in (("2425", t[t.season < 2026]), ("26", t[t.season == 2026])):
                ai, bi = ss[ss[c] == 1], ss[ss[c] == 0]
                r[f"diff_{tag}"] = ai.under.mean() - bi.under.mean() if len(ai) and len(bi) else np.nan
                r[f"n_in_{tag}"] = len(ai)
            rows.append(r)
pooled = pd.DataFrame(rows)
pooled["q_diff"] = bh(pooled.p_diff)
pooled["q_vs50"] = bh(pooled.p_vs50)
pooled.to_csv("pooled.csv", index=False)
base = d.groupby("mkt").agg(n=("under", "size"), under=("under", "mean"), roi=("u_profit", "mean"))
print(base)


# ---------------- per player ----------------
def player_tests(df, min_in, min_out, min_tot):
    out = []
    for (pid, mkt), s in df.groupby(["pid", "mkt"]):
        if len(s) < min_tot:
            continue
        name, pos = s.name.iloc[-1], s.pos.iloc[-1]
        for c in CONDS:
            t = s[s[c].notna()]
            a, b = t[t[c] == 1], t[t[c] == 0]
            if len(a) < min_in or len(b) < min_out:
                continue
            k1, k0 = int(a.under.sum()), int(b.under.sum())
            p = stats.fisher_exact([[k1, len(a) - k1], [k0, len(b) - k0]])[1]
            tp = stats.ttest_ind(a.resid, b.resid, equal_var=False).pvalue if len(a) > 2 and len(b) > 2 else np.nan
            out.append(dict(pid=pid, name=name, pos=pos, mkt=mkt, cond=c, label=LABEL[c], n=len(s), n_in=len(a),
                            n_out=len(b), u_in=k1, under_in=k1 / len(a), under_out=k0 / len(b),
                            diff=k1 / len(a) - k0 / len(b), resid_in=a.resid.mean(), resid_out=b.resid.mean(),
                            line_in=a.line.mean(), line_out=b.line.mean(),
                            roi_under_in=a.u_profit.mean(), roi_over_in=a.o_profit.mean(), p_fisher=p, p_resid=tp,
                            p_vs50_in=stats.binomtest(k1, len(a), 0.5).pvalue,
                            seasons=",".join(sorted({str(x) for x in s.season}))))
    o = pd.DataFrame(out)
    o["q_fisher"] = bh(o.p_fisher)
    o["q_vs50_in"] = bh(o.p_vs50_in)
    return o


full = player_tests(d, 6, 6, 20)
# shrunk under rate in condition: beta prior centred on player's own overall rate, worth 20 games
for _, r in full.iterrows():
    pass
k_prior = 20
full["under_in_shrunk"] = (full.u_in + k_prior * ((full.under_in * full.n_in + full.under_out * full.n_out) / (full.n_in + full.n_out))) / (full.n_in + k_prior)
full.sort_values("p_fisher").to_csv("players.csv", index=False)
print("player tests:", len(full), "player-markets:", full.groupby(["pid", "mkt"]).ngroups)
print("p<0.05:", (full.p_fisher < 0.05).sum(), "expected by chance ~", round(0.05 * len(full)))
print("p<0.01:", (full.p_fisher < 0.01).sum(), "expected ~", round(0.01 * len(full)))
print("q<0.10:", (full.q_fisher < 0.10).sum(), " q<0.25:", (full.q_fisher < 0.25).sum())

# ---------------- holdout: discover on 2024-25, test on 2026 ----------------
disc = player_tests(d[d.season < 2026], 5, 5, 16)
test = d[d.season == 2026]
res = {}
for thr in (0.05, 0.10, 0.20):
    flags = disc[disc.p_fisher < thr]
    bets = []
    for _, f in flags.iterrows():
        g = test[(test.pid == f.pid) & (test.mkt == f.mkt) & (test[f.cond] == 1)]
        side_under = f["diff"] > 0
        for _, x in g.iterrows():
            bets.append(dict(win=x.under if side_under else 1 - x.under,
                             profit=x.u_profit if side_under else x.o_profit, side="under" if side_under else "over"))
    b = pd.DataFrame(bets)
    if len(b):
        res[str(thr)] = dict(flags=int(len(flags)), flags_expected_by_chance=round(thr * len(disc)),
                             bets_2026=int(len(b)), hit=float(b.win.mean()), roi=float(b.profit.mean()),
                             under_bets=int((b.side == "under").sum()),
                             under_hit=float(b[b.side == "under"].win.mean()) if (b.side == "under").any() else None,
                             p_vs50=float(stats.binomtest(int(b.win.sum()), len(b), 0.5).pvalue))
res["disc_tests"] = int(len(disc))
json.dump(res, open("holdout.json", "w"), indent=1)
print(json.dumps(res, indent=1))

# permutation null: shuffle condition labels within player-market to see how many p<0.01 arise by chance
rng = np.random.default_rng(7)
null_counts = []
for it in range(30):
    dd = d.copy()
    for c in CONDS:
        dd[c] = dd.groupby(["pid", "mkt"])[c].transform(lambda x: rng.permutation(x.values))
    nt = player_tests(dd, 6, 6, 20)
    null_counts.append(((nt.p_fisher < 0.01).sum(), (nt.p_fisher < 0.001).sum()))
nc = np.array(null_counts)
json.dump(dict(real_p01=int((full.p_fisher < 0.01).sum()), real_p001=int((full.p_fisher < 0.001).sum()),
               null_p01_mean=float(nc[:, 0].mean()), null_p01_max=int(nc[:, 0].max()),
               null_p001_mean=float(nc[:, 1].mean()), null_p001_max=int(nc[:, 1].max())),
          open("perm.json", "w"), indent=1)
print(open("perm.json").read())
