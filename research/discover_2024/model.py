"""Model-based discovery: fit on 2024 only, bet 2025-26 where the model's Under (or Over) probability beats the price.
Settings are fixed up front (no tuning on 2025-26). Push rows are dropped from training."""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("SEED2223", "1")
from research.discover_2024 import discover as D  # noqa: E402

f, S, UNITS, WIN, PUSH = D.F, D.S, D.UNITS, D.WIN, D.PUSH
L = f["line"]


def ratio(a, b):
    return np.where((b > 0) & ~np.isnan(a) & ~np.isnan(b), a / np.where(b > 0, b, 1), np.nan)


def imp(o):  # American price -> implied prob
    return np.where(o < 0, -o / (-o + 100), 100 / (o + 100))


iu, io = imp(f["up"]), imp(f["op"])
mkt_u = iu / (iu + io)          # no-vig market Under probability
slotn = np.array([float(s[-1]) if s else np.nan for s in f["slot"].astype(str)])
X = np.column_stack([
    L, ratio(L, f["m3"]), ratio(L, f["mszn"]), ratio(f["a1"], L), ratio(L, f["pl"]), (f["pres"] == "over").astype(float),
    ratio(f["pact"], f["pl"]), D.n_over3, f["tsh_chg"], f["u_last2"] - f["u_early"], f["missed"], f["n_played"], slotn,
    f["ts"], f["total"], f["home"], f["div"], f["prime"], f["rest"], f["outdoor"], f["wind"], f["temp"], f["dome"],
    f["tr7"], f["ld7"], f["ats_t"] == "C", f["ats_o"] == "C", (f["oppq"] == "tough").astype(float) - (f["oppq"] == "soft"),
    mkt_u, f["wk"], f["rd_tot"], ratio(f["rd_lc"], f["rd_tot"]), ratio(f["rd_h1"], f["pl"]), D.cyp,
    *[(D.seg_of == sg).astype(float) for sg in sorted(set(D.seg_of))],
]).astype(float)
y = (D.RES == "under").astype(int)
tr = (S == 2024) & ~PUSH
te = (S >= 2025) & ~PUSH

MODELS = {
    "gbm": HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, min_samples_leaf=40,
                                          l2_regularization=1.0, random_state=0),
    "logit": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)),
}
out = {}
for nm, m in MODELS.items():
    m.fit(X[tr], y[tr])
    pu = m.predict_proba(X)[:, 1]
    res = {"auc_test": float(roc_auc_score(y[te], pu[te])), "auc_market_test": float(roc_auc_score(y[te], mkt_u[te])),
           "logloss_test": float(log_loss(y[te], pu[te])), "logloss_market_test": float(log_loss(y[te], mkt_u[te])),
           "auc_train": float(roc_auc_score(y[tr], pu[tr]))}
    for t in (0.0, 0.02, 0.04, 0.06, 0.08):
        for side, edge in (("U", pu - iu), ("O", (1 - pu) - io)):
            for tag, ss in (("24", [2024]), ("25", [2025]), ("26", [2026])):
                mk = (edge >= t) & np.isin(S, ss)
                n = int(mk.sum())
                w = int(WIN[side][mk].sum()); p = int(PUSH[mk].sum())
                res[f"{side}_t{t:.2f}_{tag}"] = {"n": n, "rec": f"{w}-{n - w - p}",
                                                 "roi": float(100 * UNITS[side][mk].sum() / n) if n else None}
            mk = (edge >= t) & (S >= 2025)
            if mk.sum():
                lo, hi, pv = (lambda m_: (lambda r_: (float(np.percentile(r_, 2.5)), float(np.percentile(r_, 97.5)),
                                                      float(np.mean(r_ <= 0))))(
                    np.where((D.WT @ np.bincount(D.CI[m_], minlength=D.K)) > 0,
                             (D.WT @ np.bincount(D.CI[m_], weights=UNITS[side][m_], minlength=D.K)) /
                             np.maximum(D.WT @ np.bincount(D.CI[m_], minlength=D.K), 1), 0) * 100))(mk)
                res[f"{side}_t{t:.2f}_T"] = {"n": int(mk.sum()), "roi": float(100 * UNITS[side][mk].sum() / mk.sum()),
                                              "ci": [lo, hi], "p": pv}
    out[nm] = res
json.dump(out, open(f"{D.OUT}/model.json", "w"), indent=1)
for nm, r in out.items():
    print(nm, {k: round(v, 4) for k, v in r.items() if k.startswith(("auc", "log"))})
    for t in ("0.00", "0.02", "0.04", "0.06", "0.08"):
        for side in ("U", "O"):
            a = [r[f"{side}_t{t}_{s}"] for s in ("24", "25", "26")]
            T = r.get(f"{side}_t{t}_T")
            print(f"  {side} edge>={t}: " + " | ".join(f"{x['rec']} {x['roi']:+.1f}%" if x["roi"] is not None else "-" for x in a)
                  + (f" | 25-26 {T['roi']:+.1f}% [{T['ci'][0]:+.1f},{T['ci'][1]:+.1f}] n{T['n']}" if T else ""))
