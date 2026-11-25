"""Every thesis/signal ever discussed + new pre-specified grids, scored on 2024-2026 (REG).
1 unit per bet at the saved price of the bet side; push = 0. Clusters = season-weeks."""
from __future__ import annotations

import csv, json, sys
from collections import defaultdict

import numpy as np
np.seterr(all="ignore")

from .features import build

F = build()
N = len(F["line"])
S, WK, POS, MID, L = F["season"].astype(int), F["wk"].astype(int), F["pos"], F["mid"], F["line"]
RES, OP, UP = F["res"], F["op"], F["up"]
nan = np.isnan


def payout(o):
    return np.where(o > 0, o / 100, 100 / np.abs(o))


def worse(o, pts=10):
    """price 10 cents worse (American)."""
    o2 = np.where(o <= -100, o - pts, o - pts)
    return np.where((o > 0) & (o2 < 100), -100 - (100 - o2), o2)


UNITS = {}
for side, price, win in (("U", UP, "under"), ("O", OP, "over")):
    for tag, pr in (("", price), ("m10", worse(price))):
        u = np.where(RES == "push", 0.0, np.where(RES == win, payout(pr), -1.0))
        UNITS[side + tag] = u
WIN = {"U": RES == "under", "O": RES == "over"}
PUSH = RES == "push"

f = F
eq = lambda a, v: a == v
isin = lambda a, vs: np.isin(a, list(vs))
PM9 = [("QB", "pass_yds"), ("QB", "rush_yds"), ("RB", "rush_yds"), ("RB", "rec"), ("RB", "rec_yds"),
       ("WR", "rec"), ("WR", "rec_yds"), ("TE", "rec"), ("TE", "rec_yds")]
pmask = lambda p, m: (POS == p) & (MID == m)

R = []   # (id, family, side, mask, description, origin)


def add(i, fam, side, mask, desc, origin=""):
    R.append((i, fam, side, np.asarray(mask, dtype=bool), desc, origin))


# ----------------------------------------------------------------- shared pieces
pl, pres, pact = f["pl"], f["pres"], f["pact"]
raised = (pres == "over") & ~nan(pl) & (L > pl)
slot = f["slot"]
ts = f["ts"]
yds = isin(MID, ("pass_yds", "rush_yds", "rec_yds"))
TOL = np.where(yds, 5.0, 0.5)

# ================================================================= NAMED (frozen leads, audit shortlist, signals)
add("L1", "NAMED", "U", (slot == "WR2") & (pres == "over"), "WR2 (approx slot): same-stat line in his team's previous game went Over -> Under; all 4 markets", "frozen lead 1 (2026 discovery)")
add("L2", "NAMED", "U", (~f["home"]) & ~nan(pl) & (L > pl), "Away team AND line higher than his line in his team's previous game -> Under; all markets, all quoted players", "frozen lead 2")
add("L2h", "NAMED", "U", f["home"] & ~nan(pl) & (L > pl), "Control for L2: home team, line raised -> Under", "audit control")
add("L3", "NAMED", "U", (slot == "TE1") & eq(MID, "rec_yds"), "TE1 (approx slot) receiving yards -> Under", "frozen lead 3")
add("TE-RY", "NAMED", "U", pmask("TE", "rec_yds"), "Any TE receiving yards -> Under (base rate)", "audit")
add("L4", "NAMED", "U", (slot == "QB1") & eq(MID, "rush_yds"), "QB1 rushing yards -> Under", "frozen lead 4")
L5 = (POS != "QB") & (f["u_n"] >= 4) & ((f["u_early"] - f["u_last2"]) >= np.where(POS == "RB", 10, 5)) & ~nan(pl) & (np.abs(L - pl) <= TOL)
add("L5", "NAMED", "U", L5, "Usage down (last-2 avg target share 5+ pts / RB snap share 10+ pts below his earlier games; 4+ games) AND line within 5 yds / 0.5 of last game's line -> Under", "frozen lead 5")
add("L6", "NAMED", "U", pmask("RB", "rush_yds") & (ts <= -7), "Team favoured by 7+ -> RB rushing yards Under", "frozen lead 6")
add("L7", "NAMED", "O", eq(MID, "pass_yds") & (ts >= 7), "Team a 7+ underdog -> QB passing yards Over", "frozen lead 7")
add("L8", "NAMED", "O", isin(POS, ("WR", "TE")) & eq(MID, "rec_yds") & (ts >= 7), "Team a 7+ underdog -> WR/TE receiving yards Over", "frozen lead 8")
r3 = f["r3"]
add("L9", "NAMED", "U", pmask("WR", "rec_yds") & (r3 == "over|over|over"), "WR: each of his last 3 games played went Over its graded rec-yds line -> Under", "lead 9 / indicator")
a1, a2, a3, a4 = f["a1"], f["a2"], f["a3"], f["a4"]
rise3 = (a3 < a2) & (a2 < a1)
add("L10", "NAMED", "U", pmask("WR", "rec") & rise3, "WR receptions rose in each of his last 3 games (strictly) -> receptions Under", "lead 10 / indicator")
add("S03", "NAMED", "U", pmask("WR", "rec_yds") & rise3, "WR receiving yards rose in each of his last 3 games -> Under", "indicator")
add("S04a", "NAMED", "U", pmask("WR", "rec_yds") & rise3 & (f["tsh_chg"] >= 3), "S03 AND target share up 3+ pts in his last game", "audit")
add("S04b", "NAMED", "U", pmask("WR", "rec_yds") & rise3 & (f["tsh_chg"] < 3), "S03 WITHOUT a 3+ pt target-share rise", "audit")
add("SP1", "NAMED", "U", isin(POS, ("WR", "TE", "RB")) & eq(MID, "rec_yds") & (ts >= 10), "Team a 10+ pt underdog -> WR/TE/RB receiving yards Under", "audit / indicator")
add("SP2", "NAMED", "U", isin(POS, ("WR", "TE", "RB")) & eq(MID, "rec") & (ts >= 10), "Team a 10+ pt underdog -> receptions Under", "audit / indicator")
add("SP3", "NAMED", "O", eq(MID, "pass_yds") & (ts <= -10), "Team favoured by 10+ -> QB passing yards Over", "audit / indicator")
add("SP4", "NAMED", "U", eq(MID, "pass_yds") & (ts >= 10), "Team a 10+ pt underdog -> QB passing yards Under", "audit / indicator")
add("SP5", "NAMED", "U", isin(POS, ("QB", "RB")) & eq(MID, "rush_yds") & (ts >= 3) & (ts <= 6.5), "Team a 3 to 6.5 pt underdog -> QB/RB rushing yards Under", "audit / indicator")
sc1 = isin(POS, ("WR", "TE")) & eq(MID, "rec_yds") & raised
add("SC1", "NAMED", "U", sc1 & isin(slot, ("WR1", "WR2", "WR3", "TE1", "TE2")) & (f["tr7"] >= 0.5), "WR/TE (slotted): team trailed by 7+ on half its plays last game, he went Over, line raised -> rec yds Under", "Signals page (GS WR/TE)")
add("SC1-all", "NAMED", "U", sc1 & (f["tr7"] >= 0.5), "SC1 on every quoted WR/TE (no slot filter)", "variant")
add("SC1c", "NAMED", "U", sc1 & (f["tr7"] < 0.5), "Control: same but team did NOT trail 7+ on half its plays", "audit control")
sc2 = pmask("RB", "rush_yds") & raised & (f["ld7"] >= 0.5)
add("SC2", "NAMED", "U", sc2 & isin(slot, ("RB1", "RB2")), "RB (slotted): team led by 7+ on half its plays last game, he went Over his rush line, line raised -> rush yds Under", "Signals page (GS RB)")
add("SC2-all", "NAMED", "U", sc2, "SC2 on every quoted RB", "variant")
add("SC3", "NAMED", "O", eq(MID, "pass_yds") & (f["sc3gap"] >= 10) & (ts >= 7), "Team passes 10+ pts more often when down 13+ than when close (season to date) AND is a 7+ underdog -> QB pass yds Over", "audit")
add("SC4", "NAMED", "U", eq(MID, "pass_yds") & (f["tr13"] >= 0.4), "Team trailed by 13+ on 40%+ of plays last game -> QB pass yds Under", "audit")
add("QBCH", "NAMED", "U", isin(POS, ("WR", "TE")) & eq(MID, "rec_yds") & f["qbch"], "WR/TE rec yds Under when his team's QB this game is not the 1st-quarter QB of its previous game", "Indicators page")
add("RET-U", "NAMED", "U", f["missed"] >= 1, "First game back after missing 1+ team games -> Under (any market)", "audit")
add("RET3-U", "NAMED", "U", f["missed"] >= 3, "First game back after missing 3+ team games -> Under", "audit")
add("LOWP-O", "NAMED", "O", f["lowp"], "Last game his snap share fell 20+ pts and 40%+ below his prior 3 -> Over", "audit")
add("LOWP-U", "NAMED", "U", f["lowp"], "Same trigger -> Under", "audit")
wrte_ry = isin(POS, ("WR", "TE")) & eq(MID, "rec_yds")
for k, m, d in (("UP", f["tsh_chg"] >= 3, "up 3+ pts"), ("DN", f["tsh_chg"] <= -3, "down 3+ pts"), ("ST", np.abs(f["tsh_chg"]) < 3, "within 3 pts")):
    for side in "UO":
        add(f"USG-{k}-{side}", "NAMED", side, wrte_ry & m, f"WR/TE rec yds {'Under' if side == 'U' else 'Over'} when target share {d} in his last game vs the game before", "audit")
spk = (a1 > 1.5 * (a2 + a3 + a4) / 3)
add("COMBO-C1", "NAMED", "U", pmask("WR", "rec") & rise3 & ~nan(pl) & (L > pl), "L10 (rising WR receptions) AND receptions line raised vs last game", "audit combo")
add("COMBO-C2", "NAMED", "U", pmask("WR", "rec_yds") & rise3 & ~nan(pl) & (L > pl), "S03 (rising WR rec yds) AND rec-yds line raised", "audit combo")
add("COMBO-D", "NAMED", "U", pmask("RB", "rush_yds") & (ts >= 3) & (ts <= 6.5) & (f["ats_t"] == "C") & (f["ats_o"] == "NC"), "RB rush Under, team +3 to +6.5, team covered last game, opponent did not", "audit combo")
add("COMBO-E", "NAMED", "U", pmask("WR", "rec_yds") & spk & ~nan(pl) & (L > pl) & (f["tsh_vs3"] <= 10), "WR: last game 50%+ above his prior-3 average, line raised, target share up no more than 10 pts", "audit combo")
add("COMBO-B", "NAMED", "U", pmask("WR", "rec_yds") & (r3 == "over|over|over") & (ts >= 10), "L9 AND team a 10+ pt underdog", "audit combo")
# ================================================================= QB rushing study
qr = pmask("QB", "rush_yds")
lpl = f["lpl"]
m3 = f["m3"]
add("QB-RU", "QB", "U", qr, "Every QB rushing line -> Under", "audit")
add("QB-R1", "QB", "U", qr & (L >= 25) & (m3 >= 25) & (f["n_played"] >= 3), "QBRu 'avg 25': line 25+ AND he averaged 25+ rush yds over his last 3 games played", "Signals page QBRu mode 2")
add("QB-R1s", "QB", "U", qr & (L >= 30) & (m3 >= 30), "Sensitivity: 30/30 instead of 25/25", "audit")
add("QB-R2", "QB", "U", qr & ~nan(pl) & (L - pl >= 5), "QBRu '+5': line 5+ yds above his line in his team's previous game", "Signals page QBRu mode 3")
add("QB-R2a", "QB", "U", qr & ~nan(lpl) & (L - lpl > 5), "Audit version: line more than 5 above his line at his previous PLAYED game", "audit")
add("QB-R2+7", "QB", "U", qr & ~nan(pl) & (L - pl >= 7), "Line 7+ above previous game's line", "old page toggle")
add("QB-R3", "QB", "U", qr & (L < 15) & (L - m3 >= 5), "Small line (<15) that is 5+ above his last-3 average -> Under", "audit")
add("QBRu-25", "QB", "U", qr & (L >= 25), "QBRu '25+': any QB rushing line of 25 or more", "Signals page QBRu mode 1")
for lo, hi, tag in ((-1, 1.5, "<=1.5"), (2, 14.5, "2-14.5"), (15, 24.5, "15-24.5"), (25, 39.5, "25-39.5"), (40, 999, "40+")):
    for side in "UO":
        add(f"QB-R4-{tag}-{side}", "QB", side, qr & (L >= lo) & (L <= hi), f"QB rushing line {tag} -> {'Under' if side == 'U' else 'Over'}", "audit")
for tag, m in (("fav", ts < 0), ("dog", ts > 0), ("fav7+", ts <= -7), ("dog7+", ts >= 7), ("outdoor<50F", f["outdoor"] & (f["temp"] < 50)),
               ("wind15+", f["outdoor"] & (f["wind"] >= 15)), ("home", f["home"]), ("away", ~f["home"])):
    add(f"QB-R4-{tag}-U", "QB", "U", qr & m, f"QB rushing Under when {tag}", "audit")
# ================================================================= CM (2025-2026 only: needs passing lines)
cmr = isin(POS, ("WR", "TE", "RB")) & eq(MID, "rec_yds") & f["cm_in"] & (f["cm_n"] >= 3)
q, gap = f["cm_qchg"], f["cm_gap"]
add("CM1", "CM", "U", cmr & (q <= -15) & (gap >= 10), "QB pass-yds line down 15+ vs last week AND his receivers' rec-yds lines fell 10+ yds less in total -> every matched receiver's rec yds Under", "audit")
add("CM1-10", "CM", "U", cmr & (q <= -10) & (gap >= 10), "As CM1 with QB drop 10+", "audit")
add("CM1-20", "CM", "U", cmr & (q <= -20) & (gap >= 10), "As CM1 with QB drop 20+ (Signals page CM1 'All')", "Signals page")
for p_ in ("WR", "TE", "RB"):
    add(f"CM1-{p_}", "CM", "U", cmr & (POS == p_) & (q <= -15) & (gap >= 10), f"CM1, {p_} only{' (Signals page CM1 TE)' if p_ == 'TE' else ''}", "audit / Signals page")
add("CM1-ctl", "CM", "U", cmr & (q <= -15) & (gap < 10), "Control: QB down 15+ but receivers' lines DID follow (gap < 10)", "audit control")
add("CM2", "CM", "O", cmr & (q >= 15) & (gap <= -10), "Mirror: QB line up 15+, receivers' lines lag -> rec yds Over", "audit")
cmrec = isin(POS, ("WR", "TE", "RB")) & eq(MID, "rec") & f["cm_in"] & (f["cm_recn"] >= 3)
add("CM1-rec", "CM", "U", cmrec & (q <= -15) & (f["cm_recsum"] >= 0), "QB down 15+, receivers' receptions lines not cut at all -> receptions Under", "audit")
add("CM3", "CM", "U", eq(MID, "pass_yds") & f["cm_isqb"] & (q >= 15), "QB pass-yds line up 15+ vs last week -> Under", "audit")
add("CM3d", "CM", "O", eq(MID, "pass_yds") & f["cm_isqb"] & (q <= -15), "QB pass-yds line down 15+ vs last week -> Over", "audit")
# ================================================================= Late-yardage family (rec yds, WR/TE/RB)
base = isin(POS, ("WR", "TE", "RB")) & eq(MID, "rec_yds") & (pres == "over") & ~nan(pl) & (L > pl) & (f["rd_tot"] >= 40)
tot, h1, lc, rc, ry, q4, q1y = f["rd_tot"], f["rd_h1"], f["rd_lc"], f["rd_rc"], f["rd_ry"], f["rd_q4"], f["rd_q1"]
hc, hy = f["hc"], f["hy"]
up = L / pl - 1
need = (tot - lc) < pl
beat = pact / pl - 1


def ypc(n):
    return np.where(hc >= n, hy / np.maximum(hc, 1), np.nan)


SY = base & (ypc(20) < 10.6)
H1 = base & (h1 > pl)
FH = H1 & (up >= 0.30)
BL = base & (beat >= 0.5)
NL = base & ~need
add("LY-base", "LY", "U", base, "BASE of the family: last game Over his rec-yds line with 40+ yds, line raised this week", "late-yardage study")
LYV = [
    ("SY", SY, "Short-yardage receiver: under 10.6 yds/catch on 20+ catches since 2024 (before that game)"),
    ("SY-R25", SY & (up >= 0.25), "SY AND line raised 25%+ (indicator SY-R25 / Signals SY +25%)"),
    ("SY-NL", SY & ~need, "SY AND still Over without his longest catch (Signals SY No Long)"),
    ("SY-YPC", SY & (rc > 0) & (tot / np.maximum(rc, 1) >= 1.5 * ypc(20)), "SY AND that game's yds/catch 1.5x his normal (Signals SY Fluke)"),
    ("SY-c40", base & (ypc(40) < 10.6), "SY needing 40+ earlier catches"), ("SY-c10", base & (ypc(10) < 10.6), "SY needing 10+ earlier catches"),
    ("SY-c30", base & (ypc(30) < 10.6), "SY needing 30+ earlier catches"),
    ("SY-11.0", base & (ypc(20) < 11.0), "yds/catch threshold 11.0"), ("SY-11.5", base & (ypc(20) < 11.5), "threshold 11.5"),
    ("SY-12.0", base & (ypc(20) < 12.0), "threshold 12.0"), ("SY-10.0", base & (ypc(20) < 10.0), "threshold 10.0"),
    ("SY-9.5", base & (ypc(20) < 9.5), "threshold 9.5"), ("SY-9.0", base & (ypc(20) < 9.0), "threshold 9.0"),
    ("SY-FH30", SY & (h1 > pl) & (up >= 0.30), "SY AND 1st-half yds above line AND raised 30%+"), ("SY-noH1", SY & ~(h1 > pl), "SY but 1st half NOT above line"),
    ("SY-H1", SY & (h1 > pl), "SY AND 1st half above line"), ("SY-lc<30", SY & (lc < 30), "SY AND no catch of 30+"), ("SY-lc30+", SY & (lc >= 30), "SY AND a catch of 30+"),
    ("SY-L30-44", SY & (L >= 30) & (L <= 44.5), "SY AND this week's line 30-44.5"), ("SY-L<30", SY & (L < 30), "SY AND line under 30"), ("SY-L45+", SY & (L >= 45), "SY AND line 45+"),
    ("SY-need", SY & need, "SY but he needed his longest catch"), ("SY-up10-25", SY & (up >= 0.10) & (up < 0.25), "SY AND raise 10-25%"), ("SY-up<10", SY & (up < 0.10), "SY AND raise under 10%"),
    ("SY-lcsh50", SY & (lc / tot >= 0.5), "SY AND longest catch 50%+ of his yards"),
    ("FH-R30", FH, "1st-half yds alone above his line AND line raised 30%+ (Signals 1H +30%)"), ("FH-NL", H1 & ~need, "1st half above line AND Over without longest catch (Signals 1H No Long)"),
    ("FH-R20", H1 & (up >= 0.20), "1st half above line AND raised 20%+"), ("FH-any", H1, "1st half above line, any raise"),
    ("FH-60pct", H1 & (h1 / tot >= 0.6), "1st half above line AND 60%+ of yds before half"), ("FH-q4<25", H1 & (q4 / tot < 0.25), "1st half above line AND under 25% of yds in Q4"),
    ("FH-WR", H1 & (POS == "WR"), "1st half above line, WR only"), ("FH-q4<10", H1 & (q4 / tot < 0.10), "...and under 10% in Q4"),
    ("FH-L40-59", H1 & (L >= 40) & (L <= 59.5), "...this week's line 40-59.5"), ("FH-2x", base & (h1 >= 2 * pl), "1st-half yds at least 2x line"),
    ("FH-1.5x-R20", base & (h1 >= 1.5 * pl) & (up >= 0.2), "1st half 1.5x line AND raised 20%+"), ("FH-L60+", H1 & (L >= 60), "...line 60+"),
    ("FH-75pct", H1 & (h1 / tot >= 0.75), "...75%+ of yds before half"), ("FH-1.5x", base & (h1 >= 1.5 * pl), "1st half 1.5x line"),
    ("FH-1.25x", base & (h1 >= 1.25 * pl), "1st half 1.25x line"), ("FH-L<40", H1 & (L < 40), "...line under 40"), ("FH-RB", H1 & (POS == "RB"), "...RB only"),
    ("FH-WR-R20", H1 & (POS == "WR") & (up >= 0.2), "...WR, raised 20%+"), ("FH-up10-20", H1 & (up >= 0.1) & (up < 0.2), "...raise 10-20%"), ("FH-TE", H1 & (POS == "TE"), "...TE only"),
    ("FH-Q1", base & (q1y > pl), "Already above his line after the 1st quarter"), ("FH-not", base & ~(h1 > pl), "Comparison: 1st half NOT above line"),
    ("FH-need", H1 & need, "1st half above but needed longest catch"), ("FH-up0-10", H1 & (up < 0.1), "...raise under 10%"), ("FH-up20-30", H1 & (up >= 0.2) & (up < 0.3), "...raise 20-30%"),
    ("BL-50-H1", BL & (h1 > pl), "Beat line by 50%+ AND 1st half above line"), ("BL-150", base & (beat >= 1.5), "Beat line by 150%+"),
    ("BL-200", base & (beat >= 2), "Beat line by 200%+ (indicator BL-200)"), ("BL-75", base & (beat >= 0.75), "Beat line by 75%+"), ("BL-50", BL, "Beat line by 50%+ (headline)"),
    ("BL-25", base & (beat >= 0.25), "Beat by 25%+"), ("BL-100", base & (beat >= 1), "Beat by 100%+"), ("BL-50-100", base & (beat >= .5) & (beat < 1), "Band 50-100%"),
    ("BL-100-150", base & (beat >= 1) & (beat < 1.5), "Band 100-150%"), ("BL-150-200", base & (beat >= 1.5) & (beat < 2), "Band 150-200%"), ("BL-300", base & (beat >= 3), "Beat by 300%+"),
    ("BL-<50", base & (beat < 0.5), "Comparison: beat by under 50%"), ("BL-0-25", base & (beat < .25), "Band 0-25%"), ("BL-25-50", base & (beat >= .25) & (beat < .5), "Band 25-50%"),
    ("BL-50-noH1", BL & ~(h1 > pl), "Beat by 50%+ but 1st half NOT above"),
    ("NL", NL, "Still Over after removing his single longest catch (headline)"), ("NL-H1", NL & (h1 > pl), "NL AND 1st half above line"),
    ("NL-U20", base & (lc < 20), "Longest catch under 20 yds (indicator NL-U20)"), ("NL-q4<25", NL & (q4 / tot < 0.25), "NL AND under 25% of yds in Q4"),
    ("NL-big", NL & ((lc / tot >= 0.3) | (lc >= 25)), "NL but the long catch was big (30%+ of yds or 25+)"), ("NL-small", NL & (lc / tot < 0.3) & (lc < 25), "NL and long catch small"),
    ("NL-sh40-50", base & (lc / tot >= .4) & (lc / tot < .5), "Longest catch 40-50% of yds"), ("NL-lc30-39", base & (lc >= 30) & (lc < 40), "Longest catch 30-39"),
    ("NL-bigplay", NL & (ypc(20) >= 12.7), "Big-play receiver (12.7+ ypc) and NL"), ("NL-sh25-40", base & (lc / tot >= .25) & (lc / tot < .4), "Longest 25-40% of yds"),
    ("NL-lc20-29", base & (lc >= 20) & (lc < 30), "Longest catch 20-29"), ("NL-need", base & need, "Comparison: Over only because of longest catch"),
    ("NL-sh50", base & (lc / tot >= .5), "Longest catch 50%+ of yds"), ("NL-lc40+", base & (lc >= 40), "Longest catch 40+"), ("NL-mid", NL & (ypc(20) >= 10.6) & (ypc(20) < 12.7), "In-between receiver, NL"),
    ("NL-noH1", NL & ~(h1 > pl), "NL but 1st half NOT above"),
    ("LY-SYorFH30", SY | FH, "SY OR FH-R30"), ("LY-SYorFH20", SY | (H1 & (up >= .2)), "SY OR (1st half & raised 20%+)"), ("LY-SYorH1", SY | H1, "SY OR 1st half above"),
]
cnt = SY.astype(int) + FH.astype(int) + BL.astype(int) + NL.astype(int)
LYV += [("LY-3of4", base & (cnt >= 3), "3+ of the four headlines (SY, FH-R30, BL-50, NL) on the same bet"), ("LY-4of4", base & (cnt == 4), "All four headlines"),
        ("LY-2of4", base & (cnt == 2), "Exactly 2 of the four")]
for i, m, d in LYV:
    add(i, "LY", "U", m, d, "late-yardage study (2026-11-15)")
# ================================================================= SEQ grid
seqm = {"RY": "rec_yds", "RC": "rec", "RU": "rush_yds", "PY": "pass_yds"}
for code, mid in seqm.items():
    mm = eq(MID, mid)
    pats = {
        "OV3": r3 == "over|over|over", "UN3": r3 == "under|under|under", "R3": rise3, "F3": (a3 > a2) & (a2 > a1),
        "R4": (a4 < a3) & rise3, "F4": (a4 > a3) & (a3 > a2) & (a2 > a1), "AH4": (a4 < a3) & (a3 > a2) & (a2 < a1),
        "AL4": (a4 > a3) & (a3 < a2) & (a2 > a1), "SPK": a1 > 1.5 * (a2 + a3 + a4) / 3, "COL": a1 < 0.5 * (a2 + a3 + a4) / 3,
        "LUP": ~nan(lpl) & (L > lpl), "LDN": ~nan(lpl) & (L < lpl), "LEQ": ~nan(lpl) & (L == lpl)}
    for k, m in pats.items():
        for side in "UO":
            add(f"SEQ-{code}-{k}-{side}", "SEQ", side, mm & m, f"{mid}: {k} pattern over his recent games played -> {'Under' if side == 'U' else 'Over'}", "audit grid")
# ================================================================= spread grid
bands = {"fav10+": ts <= -10, "fav7-9.5": (ts <= -7) & (ts > -10), "fav3-6.5": (ts <= -3) & (ts > -7), "pick": np.abs(ts) < 3,
         "dog3-6.5": (ts >= 3) & (ts < 7), "dog7-9.5": (ts >= 7) & (ts < 10), "dog10+": ts >= 10}
for b, m in bands.items():
    for p_, m_ in PM9:
        for side in "UO":
            add(f"SPG-{p_}-{m_}-{b}-{side}", "SPG", side, pmask(p_, m_) & m, f"{p_} {m_} when team is {b}", "audit grid")
# ================================================================= ATS grid
for tt in ("C", "NC"):
    for oo in ("C", "NC"):
        for p_, m_ in PM9:
            for side in "UO":
                add(f"ATS-{tt}/{oo}-{p_}-{m_}-{side}", "ATS", side, pmask(p_, m_) & (f["ats_t"] == tt) & (f["ats_o"] == oo),
                    f"{p_} {m_}; team last game ATS {tt}, opponent last game ATS {oo}", "audit grid")
# ================================================================= weather
od, tmp, wind = f["outdoor"], f["temp"], f["wind"]
add("WX1", "WX", "U", od & (wind >= 15) & isin(MID, ("pass_yds", "rec", "rec_yds")), "Outdoor, observed wind 15+ mph -> pass yds / receptions / rec yds Under", "audit")
add("WX2", "WX", "U", od & (tmp < 55) & isin(MID, ("rec", "rec_yds")), "Outdoor, observed temp under 55F -> receptions / rec yds Under", "audit")
grp = {"QB-pass_yds": pmask("QB", "pass_yds"), "QB-rush_yds": pmask("QB", "rush_yds"), "RB-rush_yds": pmask("RB", "rush_yds"),
       "WRTE-rec_yds": isin(POS, ("WR", "TE")) & eq(MID, "rec_yds"), "WRTE-rec": isin(POS, ("WR", "TE")) & eq(MID, "rec")}
for gname, gm in grp.items():
    for t, m in (("<40F", tmp < 40), ("40-54F", (tmp >= 40) & (tmp < 55)), ("55-69F", (tmp >= 55) & (tmp < 70)), (">=70F", tmp >= 70), ("wind>=15", wind >= 15)):
        add(f"WXG-{gname}-{t}-U", "WX", "U", gm & od & m, f"{gname} Under, outdoor, {t} (observed)", "audit grid")
# ================================================================= BASE
for m_ in ("rec_yds", "rec", "rush_yds", "pass_yds"):
    for side in "UO":
        add(f"BASE-{m_}-{side}", "BASE", side, eq(MID, m_), f"Every {m_} {'Under' if side == 'U' else 'Over'}", "baseline")
for side in "UO":
    add(f"BASE-ALL-{side}", "BASE", side, np.ones(N, bool), f"Every prop {'Under' if side == 'U' else 'Over'}", "baseline")
# ================================================================= NEW grids (pre-specified before looking)
def grid(fam, buckets, desc):
    for b, m in buckets.items():
        for p_, m_ in PM9:
            for side in "UO":
                add(f"{fam}-{p_}-{m_}-{b}-{side}", fam, side, pmask(p_, m_) & m, f"{p_} {m_}: {desc} {b}", "new 2026-11-22")


r = m3 / L
okl = L >= np.where(yds, 5, 1.5)
grid("FORM3", {"form>=1.25x": okl & (r >= 1.25), "form1.10-1.25x": okl & (r >= 1.10) & (r < 1.25), "form0.90-1.10x": okl & (r >= .9) & (r < 1.1),
               "form0.75-0.90x": okl & (r >= .75) & (r < .9), "form<0.75x": okl & (r < .75)}, "last-3-games average vs this line")
rs = f["mszn"] / L
grid("FORMS", {"szn>=1.25x": okl & (rs >= 1.25), "szn1.10-1.25x": okl & (rs >= 1.1) & (rs < 1.25), "szn0.90-1.10x": okl & (rs >= .9) & (rs < 1.1),
               "szn0.75-0.90x": okl & (rs >= .75) & (rs < .9), "szn<0.75x": okl & (rs < .75)}, "season-to-date average (4+ games) vs this line")
mv = L / pl - 1
grid("MOVE", {"up25+": mv >= .25, "up10-25": (mv >= .10) & (mv < .25), "flat": np.abs(mv) < .10, "down10-25": (mv <= -.10) & (mv > -.25), "down25+": mv <= -.25},
     "line change vs his line in his team's previous game")
rr = pact / pl
grid("RESID", {"last>=2x": f["pplayed"] & (rr >= 2), "last1.5-2x": f["pplayed"] & (rr >= 1.5) & (rr < 2), "last1-1.5x": f["pplayed"] & (rr > 1) & (rr < 1.5),
               "last0.5-1x": f["pplayed"] & (rr < 1) & (rr >= .5), "last<0.5x": f["pplayed"] & (rr < .5)}, "last game's result as a multiple of last game's line")
grid("SIT", {"home": f["home"], "away": ~f["home"], "primetime": f["prime"], "division": f["div"], "shortrest": f["rest"] <= 5, "postbye": f["rest"] >= 13,
             "total48+": f["total"] >= 48, "total<=40": f["total"] <= 40, "dome": f["dome"], "wk14+": WK >= 14, "wk1-4": WK <= 4}, "situation")
grid("DEF", {"softD": f["oppq"] == "soft", "toughD": f["oppq"] == "tough"}, "opponent allowed (season to date, top/bottom quartile to this position-market)")
LB = {"rec_yds": [(-1, 19.5), (20, 34.5), (35, 49.5), (50, 64.5), (65, 999)], "rush_yds": [(-1, 14.5), (15, 29.5), (30, 49.5), (50, 69.5), (70, 999)],
      "rec": [(-1, 2.5), (3, 3.5), (4, 4.5), (5, 5.5), (6, 99)], "pass_yds": [(-1, 199.5), (200, 224.5), (225, 249.5), (250, 274.5), (275, 999)]}
for p_, m_ in PM9:
    for lo, hi in LB[m_]:
        for side in "UO":
            add(f"LINE-{p_}-{m_}-{lo if lo >= 0 else 0}-{hi if hi < 900 else '+'}-{side}", "LINE", side, pmask(p_, m_) & (L >= lo) & (L <= hi),
                f"{p_} {m_} line {lo if lo >= 0 else 0} to {hi if hi < 900 else 'up'}", "new 2026-11-22")
for m_ in ("rec_yds", "rec", "rush_yds", "pass_yds"):
    mm = eq(MID, m_)
    add(f"PRICE-{m_}-Uplus-U", "PRICE", "U", mm & (UP >= 100), f"{m_}: Under priced at plus money -> Under", "new 2026-11-22")
    add(f"PRICE-{m_}-Oplus-O", "PRICE", "O", mm & (OP >= 100), f"{m_}: Over priced at plus money -> Over", "new 2026-11-22")
    add(f"PRICE-{m_}-Ujuiced-U", "PRICE", "U", mm & (UP <= -130), f"{m_}: Under juiced to -130 or worse -> Under", "new 2026-11-22")
    add(f"PRICE-{m_}-Ojuiced-O", "PRICE", "O", mm & (OP <= -130), f"{m_}: Over juiced to -130 or worse -> Over", "new 2026-11-22")

# ================================================================= statistics
CL = sorted(set(zip(S, WK)))
cidx = {c: i for i, c in enumerate(CL)}
CI_ = np.array([cidx[(s, w)] for s, w in zip(S, WK)])
K = len(CL)
rng = np.random.default_rng(20261122)
B = 4000
W = rng.multinomial(K, [1 / K] * K, size=B).astype(float)     # bootstrap weights over season-weeks
BASEROI = {}
for side in "UO":
    for s in (2024, 2025, 2026):
        for p_ in ("QB", "RB", "WR", "TE"):
            for m_ in ("pass_yds", "rush_yds", "rec", "rec_yds"):
                mk = (S == s) & (POS == p_) & (MID == m_)
                if mk.sum():
                    BASEROI[(side, s, p_, m_)] = (UNITS[side][mk].sum(), mk.sum())


def stats(mask, side):
    u = UNITS[side][mask]
    n = int(mask.sum())
    if n == 0:
        return None
    w = int(WIN[side][mask].sum()); pu = int(PUSH[mask].sum())
    cu = np.bincount(CI_[mask], weights=u, minlength=K); cn = np.bincount(CI_[mask], minlength=K).astype(float)
    bu, bn = W @ cu, W @ cn
    roib = np.where(bn > 0, bu / np.maximum(bn, 1), 0)
    out = {"bets": n, "w": w, "l": n - w - pu, "p": pu, "units": round(float(u.sum()), 2), "roi": 100 * u.sum() / n,
           "lo": float(np.percentile(roib, 2.5) * 100), "hi": float(np.percentile(roib, 97.5) * 100),
           "p1": float((np.sum(roib <= 0) + 1) / (B + 1)), "roi_m10": 100 * UNITS[side + "m10"][mask].sum() / n,
           "wks": int((cn > 0).sum()), "pct_wk_pos": float(np.mean(cu[cn > 0] > 0) * 100), "players": int(len(set(F["pid"][mask])))}
    # matched baseline: same season x position x market mix, same side
    bu_, bn_ = 0.0, 0
    keys, counts = np.unique(np.stack([S[mask].astype(str), POS[mask], MID[mask]]), axis=1, return_counts=True)
    for (s, p_, m_), k in zip(keys.T, counts):
        tu, tn = BASEROI[(side, int(s), str(p_), str(m_))]
        bu_ += k * tu / tn; bn_ += k
    out["base"] = 100 * bu_ / bn_
    for s in (2024, 2025, 2026):
        mk = mask & (S == s)
        k = int(mk.sum())
        out[f"n{s}"] = k
        out[f"roi{s}"] = 100 * UNITS[side][mk].sum() / k if k else None
        out[f"rec{s}"] = f"{int(WIN[side][mk].sum())}-{int(k - WIN[side][mk].sum() - PUSH[mk].sum())}" if k else ""
    mk = mask & (S == 2026) & (WK >= 10)
    k = int(mk.sum())
    out["n26f"] = k; out["roi26f"] = 100 * UNITS[side][mk].sum() / k if k else None
    out["rec26f"] = f"{int(WIN[side][mk].sum())}-{int(k - WIN[side][mk].sum() - PUSH[mk].sum())}" if k else ""
    return out


def bh(ps):
    ps = np.asarray(ps); n = len(ps)
    o = np.argsort(ps); q = np.empty(n)
    run = 1.0
    for rank in range(n, 0, -1):
        i = o[rank - 1]
        run = min(run, ps[i] * n / rank)
        q[i] = run
    return q


LEADS = {"L1", "L2", "L2h", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "S03", "S04a", "S04b"}
OOS_LEAD = (S == 2024) | (S == 2025) | ((S == 2026) & (WK >= 8))
OOS_LY = (S == 2024) | ((S == 2026) & (WK >= 11))
OOS_AUD = (S == 2024) | ((S == 2026) & (WK >= 10))


def oos_mask(i, fam):
    if i in LEADS:
        return OOS_LEAD, "2024 + 2025 + 2026 wk8+ (lead found on 2026 wk1-7)"
    if fam == "LY":
        return OOS_LY, "2024 + 2026 wk11 (found on 2025 + 2026 wk1-10)"
    if fam in ("NAMED", "QB", "CM", "SEQ", "SPG", "ATS", "WX"):
        return OOS_AUD, "2024 + 2026 wk10-11 (found/audited on 2025 + 2026 wk1-9)"
    return None, "none (new, pre-specified 2026-11-22; all three seasons are fresh)"


rows = []
for i, fam, side, mask, desc, origin in R:
    st = stats(mask, side)
    om, otxt = oos_mask(i, fam)
    if st is not None:
        st["oos_def"] = otxt
        if om is not None:
            mk = mask & om
            k = int(mk.sum())
            st["oos_n"] = k
            st["oos_roi"] = 100 * UNITS[side][mk].sum() / k if k else None
            st["oos_rec"] = f"{int(WIN[side][mk].sum())}-{int(k - WIN[side][mk].sum() - PUSH[mk].sum())}" if k else ""
            st["oos_p1"] = stats(mk, side)["p1"] if k else None
    if st is None:
        rows.append({"id": i, "family": fam, "side": side, "desc": desc, "origin": origin, "bets": 0})
        continue
    rows.append({"id": i, "family": fam, "side": side, "desc": desc, "origin": origin, **st})
scored = [r for r in rows if r.get("bets", 0) >= 20 and r["family"] != "BASE"]
q_all = bh([r["p1"] for r in scored])
for r, q in zip(scored, q_all):
    r["q_global"] = float(q)
for fam in {r["family"] for r in scored}:
    sub = [r for r in scored if r["family"] == fam]
    for r, q in zip(sub, bh([r["p1"] for r in sub])):
        r["q_family"] = float(q)
json.dump(rows, open("/tmp/three_season_rules.json", "w"))
with open("/tmp/three_season_rules.csv", "w", newline="") as fh:
    keys = ["id", "family", "side", "bets", "w", "l", "p", "units", "roi", "lo", "hi", "p1", "q_family", "q_global", "base", "roi_m10",
            "rec2024", "roi2024", "rec2025", "roi2025", "rec2026", "roi2026", "rec26f", "roi26f", "oos_rec", "oos_roi", "oos_n", "oos_p1", "oos_def", "wks", "pct_wk_pos", "players", "desc", "origin"]
    w = csv.DictWriter(fh, keys, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()})
print(len(rows), "rules;", len(scored), "with 20+ bets")
