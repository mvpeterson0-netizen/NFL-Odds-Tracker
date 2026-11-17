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
        by_book, lines = {}, collections.defaultdict(dict)
        for bk in body.get("bookmakers", []) if st == 200 else []:
            mk = {}
            for m in bk.get("markets", []):
                players = {o.get("description") for o in m.get("outcomes", []) if o.get("description")}
                mk[m["key"]] = {"outcomes": len(m.get("outcomes", [])), "players": len(players),
                                "last_update": m.get("last_update")}
                by_book.setdefault(bk["key"], {})
                for o in m.get("outcomes", []):
                    if o.get("description"):
                        lines[(m["key"], o["description"])].setdefault(bk["key"], {})[o.get("name")] = [o.get("point"), o.get("price")]
            by_book[bk["key"]] = mk
        out["by_book"] = by_book
        out["novig_returned"] = "novig" in by_book
        out["outcome_field_keys_seen"] = sorted({k for bk in body.get("bookmakers", []) for m in bk.get("markets", [])
                                                 for o in m.get("outcomes", []) for k in o}) if st == 200 else []
        both = [{"market": k[0], "player": k[1], "by_book": v} for k, v in lines.items() if "novig" in v and len(v) >= 2]
        out["players_with_novig_and_another_book"] = len(both)
        out["sample_compare"] = sorted(both, key=lambda x: (x["market"], x["player"]))[:10]
        if st != 200:
            out["odds_error"] = body
json.dump(out, open("probe/novig_result.json", "w"), indent=1)
print(json.dumps({k: out.get(k) for k in ("events_call", "event", "odds_call", "novig_returned", "stop")}, indent=1))
