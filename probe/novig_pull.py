"""Throwaway (branch probe/novig-pull only; never merged). One-time real pull through the merged Novig code path
(odds.BOOKS + odds.NFL_EXTRA_BOOKS + williamhill_us = 11 books, to observe whether an 11th book doubles the cost and whether
Caesars returns anything), for every upcoming NFL game within 6 days. Empty responses cost 0. Writes probe/pull_*.* only."""
import csv, json, os, collections
from datetime import timedelta
from pipeline import odds
from pipeline.common import http_get, iso, utcnow, parse_iso

KEY = os.environ["ODDS_API_KEY_20K"]
FLOOR = 5000
BOOKS = odds.BOOKS + odds.NFL_EXTRA_BOOKS + ["williamhill_us"]
now = utcnow()
out = {"run_utc": iso(now), "books_requested": BOOKS, "games": []}
events, h = odds.fetch_events(KEY)
out["balance_start"] = h.get("x-requests-remaining")
evs = sorted((e for e in events if now < parse_iso(e["commence_time"]) < now + timedelta(days=6)), key=lambda e: e["commence_time"])
markets = odds.CORE + odds.OPTIONAL
allrows, stop = [], None
imp = odds._implied
for e in evs:
    rem = out["balance_start"] if not out["games"] else out["games"][-1].get("remaining")
    if rem and str(rem).isdigit() and int(rem) < FLOOR:
        stop = "floor"; break
    gid = f'{e["away_team"]} @ {e["home_team"]}'
    params = {"apiKey": KEY, "bookmakers": ",".join(BOOKS), "markets": ",".join(markets), "oddsFormat": "american", "dateFormat": "iso"}
    body, h, status = http_get(f"{odds.API}/sports/{odds.SPORT}/events/{e['id']}/odds", params)
    g = {"game": gid, "kickoff": e["commence_time"], "status": status, "credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining")}
    if status == 200:
        ev = json.loads(body); ko = parse_iso(e["commence_time"]); cap = utcnow()
        raw = odds._main_line_rows(ev, gid, "track", cap, ko, round((ko - cap).total_seconds() / 60), "n/a", {})
        rows = odds.narrow_novig(raw)
        g["raw_rows_by_book"] = dict(collections.Counter(r["book"] for r in raw))
        g["kept_rows_by_book"] = dict(collections.Counter(r["book"] for r in rows))
        g["caesars_players"] = len({(r["market"], r["player_book_name"]) for r in raw if r["book"] == "williamhill_us"})
        allrows += rows
    out["games"].append(g)
    paid = [x for x in out["games"] if x.get("raw_rows_by_book")]
    if len(paid) == 1 and g.get("raw_rows_by_book") and str(g["credits_last"]).isdigit() and int(g["credits_last"]) > 7:
        stop = f'first paid game cost {g["credits_last"]} (>7): stopped to avoid doubling cost'; break
out["stopped"] = stop
# Novig vs the books at the SAME line (Novig stored at the DK line when it has one)
by = collections.defaultdict(dict)
for r in allrows:
    by[(r["game_id"], r["market"], r["player_book_name"])].setdefault(r["book"], []).append(r)
cmp = {"pairs": 0, "novig_better_over": 0, "novig_better_under": 0, "novig_overround": [], "dk_overround": []}
ex = []
def dec(a): a = float(a); return 1 + a / 100 if a > 0 else 1 + 100 / abs(a)
for k, b in by.items():
    for nv in b.get("novig", []):
        for ref in ("draftkings", "fanduel"):
            for r in b.get(ref, []):
                if r["line"] == nv["line"] and "" not in (nv["over_price"], nv["under_price"], r["over_price"], r["under_price"]):
                    cmp["pairs"] += 1
                    bo, bu = dec(nv["over_price"]) > dec(r["over_price"]), dec(nv["under_price"]) > dec(r["under_price"])
                    cmp["novig_better_over"] += bo; cmp["novig_better_under"] += bu
                    cmp["novig_overround"].append(round(imp(nv["over_price"]) + imp(nv["under_price"]), 3))
                    cmp[ref[:2] + "_overround"] = cmp.get(ref[:2] + "_overround", []) + [round(imp(r["over_price"]) + imp(r["under_price"]), 3)]
                    ex.append({"game": k[0], "player": k[2], "market": k[1], "line": nv["line"], "novig": [nv["over_price"], nv["under_price"]], ref: [r["over_price"], r["under_price"]]})
med = lambda v: sorted(v)[len(v) // 2] if v else None
out["same_line_comparison"] = {"pairs": cmp["pairs"], "novig_better_over": cmp["novig_better_over"], "novig_better_under": cmp["novig_better_under"],
    "median_overround_novig": med(cmp["novig_overround"]), "median_overround_draftkings": med(cmp["dk_overround"]), "median_overround_fanduel": med(cmp.get("fa_overround", []))}
out["sample"] = ex[:12]
with open("probe/pull_rows.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=odds.CAPTURE_FIELDS); w.writeheader(); w.writerows(allrows)
json.dump(out, open("probe/pull_result.json", "w"), indent=1)
print(json.dumps({k: out[k] for k in ("balance_start", "stopped", "same_line_comparison")}, indent=1))
for g in out["games"]: print(g["game"], g["status"], g["credits_last"], g.get("caesars_players"), g.get("kept_rows_by_book", {}).get("novig"))
