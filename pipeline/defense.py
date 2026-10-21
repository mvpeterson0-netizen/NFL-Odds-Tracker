"""Opponent defense rank by market and position, from nflverse weekly player stats.

For a defense and a position group (QB/RB/WR/TE), "allowed" is the sum of a stat
by that position group's players against that defense in one game. Teams are
ranked by average allowed per game: 1 = fewest allowed (toughest), N = most.

"As of game" ranks use only games that kicked off before the game in question
and already have published stats, so they reflect what was known pre-game.
"""
from __future__ import annotations

from collections import defaultdict

from .common import to_float

POS_GROUPS = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}


class DefenseRanks:
    def __init__(self, d, markets):
        # (position, stat column) pairs that some market needs
        self.pairs = sorted({(pos, col) for _mid, _ok, col, _l, poss in markets for pos in poss})
        cols = {c for _p, c in self.pairs}
        ko = {g["game_id"]: g.get("kickoff_utc", "") for g in d.games}
        # allowed[(game_id, defense)][(pos, col)] = total
        allowed = defaultdict(lambda: defaultdict(float))
        for (gid, _pid), r in d.stats.items():
            pg = POS_GROUPS.get(r.get("position_group") or "") or POS_GROUPS.get(r.get("position") or "")
            dfn = r.get("opponent_team") or ""
            if not pg or not dfn or gid not in ko:
                continue
            for c in cols:
                v = to_float(r.get(c))
                if v is not None:
                    allowed[(gid, dfn)][(pg, c)] += v
        # Every game with stats counts for both defenses, even if a position had 0.
        self.games = []  # (kickoff_iso, defense, totals)
        for gid in d.stats_games:
            g = d.games_by_id.get(gid)
            if not g or not ko.get(gid):
                continue
            for dfn in (g["home_team"], g["away_team"]):
                self.games.append((ko[gid], dfn, allowed.get((gid, dfn), {})))
        self.games.sort(key=lambda t: t[0])
        self._cache = {}

    def table(self, before_iso: str | None):
        """{(pos, col): {team: (rank, avg, n, of)}} using games that kicked off before `before_iso`."""
        key = before_iso or "ALL"
        if key in self._cache:
            return self._cache[key]
        tot = defaultdict(lambda: defaultdict(float))
        n = defaultdict(int)
        for k, dfn, totals in self.games:
            if before_iso and k >= before_iso:
                break
            n[dfn] += 1
            for p in self.pairs:
                tot[dfn][p] += totals.get(p, 0.0)
        out = {}
        for p in self.pairs:
            avgs = {t: tot[t][p] / n[t] for t in n if n[t]}
            ordered = sorted(avgs.values())
            out[p] = {t: (1 + sum(1 for v in ordered if v < a), round(a, 1), n[t], len(avgs))
                      for t, a in avgs.items()}
        self._cache[key] = out
        return out

    def asof(self, kickoff_iso: str, defense: str, pos: str, col: str):
        return self.table(kickoff_iso).get((pos, col), {}).get(defense)

    def current(self):
        return self.table(None)


def as_fields(v):
    if v is None:
        return {}
    rk, avg, n, of = v
    return {"drk": rk, "dav": avg, "dn": n, "dof": of}

