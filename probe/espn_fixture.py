"""Throwaway: save real ESPN scoreboard + summary for the Sunday night game (MIN @ SF) as test fixtures."""
import json, urllib.request
SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873077"
def raw(u): return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode()
open("probe/fixture_snf_scoreboard.json", "w").write(raw(SB))
open("probe/fixture_snf_summary.json", "w").write(raw(SUM))
