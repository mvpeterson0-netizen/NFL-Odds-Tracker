"""Throwaway probe (branch probe/novig only; never merged). One Odds API event-odds request for the next NFL game
with Novig (exchange region us_ex) plus DraftKings and FanDuel (region us), same 7 prop markets the pipeline uses.
Question: does `novig` return NFL player props through The Odds API, how many players/markets, and what does it cost?
Writes probe/novig_result.json only: counts, costs and a small sample (repo is public; no raw Novig dump)."""
import json, os, urllib.request, urllib.parse, collections, datetime

KEY = os.environ["ODDS_API_KEY_20K"]
API = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl"
BOOKS = ["novig", "draftkings", "fanduel"]
MARKETS = ["player_pass_yds", "player_rush_attempts", "player_rush_yds", "player_receptions", "player_reception_yds",
           "player_pass_attempts", "player_pass_completions"]
FLOOR = 5000  # never run the odds call if the balance is below this


def get(url, params):
    u = url + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(u, timeout=45) as r:
            return r.status, json.loads(r.read()), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}, {k.lower(): v for k, v in (e.headers or {}).items()}


out = {"run_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
st, events, h = get(f"{API}/events", {"apiKey": KEY, "dateFormat": "iso"})
out["events_call"] = {"status": st, "credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining")}
if st != 200 or not events:
    out["stop"] = "events call failed or no upcoming games"
else:
    now = out["run_utc"]
    ev = sorted((e for e in events if e["commence_time"] > now), key=lambda e: e["commence_time"])[0]
    out["event"] = {"id": ev["id"], "game": f'{ev["away_team"]} @ {ev["home_team"]}', "commence_time": ev["commence_time"]}
    rem = h.get("x-requests-remaining", "")
    if rem.isdigit() and int(rem) < FLOOR:
        out["stop"] = f"balance {rem} below floor {FLOOR}"
    else:
        st, body, h = get(f"{API}/events/{ev['id']}/odds", {"apiKey": KEY, "bookmakers": ",".join(BOOKS),
                          "markets": ",".join(MARKETS), "oddsFormat": "american", "dateFormat": "iso"})
        out["odds_call"] = {"status": st, "credits_last": h.get("x-requests-last"), "remaining": h.get("x-requests-remaining"),
                            "books_requested": BOOKS, "markets_requested": MARKETS}
        # ladder[book][(market, player)][point] = {"Over": price, "Under": price}
        by_book, ladder = {}, collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(dict)))
        for bk in body.get("bookmakers", []) if st == 200 else []:
            mk = {}
            for m in bk.get("markets", []):
                players = {o.get("description") for o in m.get("outcomes", []) if o.get("description")}
                mk[m["key"]] = {"outcomes": len(m.get("outcomes", [])), "players": len(players), "last_update": m.get("last_update")}
                for o in m.get("outcomes", []):
                    if o.get("description") and o.get("name") in ("Over", "Under"):
                        ladder[bk["key"]][(m["key"], o["description"])][o.get("point")][o["name"]] = o.get("price")
            by_book[bk["key"]] = mk
        out["by_book"] = by_book
        out["novig_returned"] = "novig" in by_book

        def imp(a):
            return 100 / (a + 100) if a > 0 else -a / (-a + 100)

        def main_line(rungs):
            # the rung with both sides whose two implied probabilities are closest to 50/50 (a book's "main" line)
            both = {pt: v for pt, v in rungs.items() if "Over" in v and "Under" in v}
            if not both:
                return None
            pt = min(both, key=lambda x: abs(imp(both[x]["Over"]) - imp(both[x]["Under"])))
            return pt, both[pt]["Over"], both[pt]["Under"]

        out["novig_rungs_per_player_market"] = {
            "median": sorted(len(r) for r in ladder["novig"].values())[len(ladder["novig"]) // 2] if ladder["novig"] else 0,
            "max": max((len(r) for r in ladder["novig"].values()), default=0)}
        main = {b: {k: main_line(r) for k, r in d.items()} for b, d in ladder.items()}
        rows, same_pt, novig_better_over, novig_better_under, diff_pt = [], 0, 0, 0, 0
        for k, nv in main["novig"].items():
            if not nv:
                continue
            others = {b: main[b].get(k) for b in ("draftkings", "fanduel") if main.get(b, {}).get(k)}
            row = {"market": k[0], "player": k[1], "novig": nv, **{b: v for b, v in others.items()}}
            rows.append(row)
            for b, v in others.items():
                if v[0] == nv[0]:
                    same_pt += 1
                    novig_better_over += nv[1] > v[1]
                    novig_better_under += nv[2] > v[2]
                else:
                    diff_pt += 1
        out["main_line_comparison"] = {"player_markets_with_novig_main_line": len(rows), "novig_vs_book_pairs_same_point": same_pt,
            "novig_vs_book_pairs_different_point": diff_pt, "novig_over_price_better_than_book_same_point": novig_better_over,
            "novig_under_price_better_than_book_same_point": novig_better_under}
        out["novig_overround_main_lines"] = sorted(round(imp(v[1]) + imp(v[2]), 3) for v in main["novig"].values() if v)
        out["sample_rows"] = sorted(rows, key=lambda x: (x["market"], x["player"]))[:14]
        # one full Novig ladder for two players, to show the rung structure (small; repo is public)
        samp = [(k, r) for k, r in ladder["novig"].items() if k[0] == "player_reception_yds"][:2]
        out["sample_novig_ladders"] = [{"market": k[0], "player": k[1], "rungs": {str(pt): v for pt, v in sorted(r.items())}} for k, r in samp]
        if st != 200:
            out["odds_error"] = body
json.dump(out, open("probe/novig_result.json", "w"), indent=1)
print(json.dumps({k: out.get(k) for k in ("events_call", "event", "odds_call", "novig_returned", "stop")}, indent=1))
