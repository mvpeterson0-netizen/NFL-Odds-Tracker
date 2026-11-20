"use strict";
// Stix Research tab: pre-built "Leads" filters, then Leads Analysis (how a rule did in a past week / game).
// Uses only data already in data.json (players' per-game rows, lines, usage; game script minutes from play-by-play).
// Original leads 1–8 plus append-only forward candidates 9–12. Candidates, not proven edges.
(function () {
  const RL = { tab: "t1", mk: "", gid: "" };
  // Game script (nflverse play-by-play, built into games[gid].scr as minutes leading "l<m>" / trailing "t<m>" by each
  // margin m): a team "led big" when ahead by MARGIN+ points for at least MINUTES of the game, "trailed big" likewise.
  // Default 13+ for 30 minutes (Michael's choice); each viewer can change both on the Guide tab (saved in this browser).
  const SCRIPT_DEFAULT = { margin: 13, minutes: 30 };
  const SCRIPT_MINUTES = [10, 15, 20, 25, 30, 35, 40, 45];
  const SCRIPT = (() => {
    try { const v = JSON.parse(localStorage.getItem("stix_script") || "null"); if (v && v.margin && v.minutes) return { margin: +v.margin, minutes: +v.minutes }; } catch { /* default */ }
    return { ...SCRIPT_DEFAULT };
  })();
  function scriptMargins() {
    for (const g of Object.values(D.games)) if (g.scr && g.scr.h) return Object.keys(g.scr.h).filter((k) => k[0] === "l").map((k) => +k.slice(1)).sort((a, b) => a - b);
    return [];
  }
  // Frozen theses (claude/frozen-theses.md; rules 1–5 frozen 2026-10-28 ~10:00 PM CT, 6–8 ~10:10 PM CT, Michael's Yes).
  // The lists below apply each rule to this week's upcoming games. Never change a rule's wording or thresholds here:
  // a changed rule is a new thesis with its own record.
  const USAGE_DROP = { tshare: 5, snap: 10 }; // percentage points (his last 2 games vs his earlier games) — rule 5
  const USAGE_N = 2;                            // rule 5 is frozen with the 2-game window
  const FLAT = { count: 0.5, yds: 5, pass_yds: 10 }; // "line flat" tolerance — rule 5
  const COUNT_MKTS = ["rec", "rush_att", "pass_att", "pass_cmp"];
  const BIG_SPREAD = 7;
  const UNIVERSE = "Slotted players only (not All players extras). The rule is scored on the graded pre-game line (~3 h before kickoff); until that line is captured this list uses the latest line showing, so players can join or leave as lines move.";
  // Signals page (Michael 2026-11-12): the page now holds only the "bet every time" theses from the 2026-11-11 thesis audit.
  // Each is a historical replay, not a proven edge; it is scored here on 2026 data only, with the same grading as before
  // (graded pre-game line, saved odds, 1 unit). Thresholds are the audit's; QB-R2 / QB-R4 carry a viewer toggle.
  // Not on this page yet (own PRs): CM1-TE, CM1-20 (needs prior-week QB/receiver line gap) and QBCH (needs the starter data).
  const CM_READ = `<div class="sg-sub"><b>Reading a player row:</b></div><ul class="sg-ul"><li>"QB −20yds": the QB's passing-yards line fell 20 yards vs last week.</li><li>"6 receivers −4yds": the 6 receivers' receiving-yards lines changed by 4 yards in total, all added up.</li><li>"net +16": the receivers' total minus the QB's change (−4 − (−20)), so the QB's line fell 16 yards more.</li></ul>`;
  // Late-yardage indicator wording (shared by SY-*, FH-*, BL-200, NL-U20).
  const LY_WHO = `Bet a WR's, TE's or RB's <b>receiving yards Under</b> when all of these are true:`;
  const LY_SHORT = `<li>He is a <b>short-yardage receiver</b>: before that game he averaged <b>under 10.6 yards per catch</b> over his career since 2024 (at least 20 catches).</li>`;
  const LY_PREV = `<li>In his <b>previous game</b> he finished <b>Over</b> his receiving-yards line with <b>40 or more</b> receiving yards.</li>`;
  const LY_UP = (pct) => pct ? `<li>This week's receiving-yards line is <b>${pct}% or more higher</b> than that game's line.</li>` : `<li>This week's receiving-yards line is <b>higher</b> than that game's line.</li>`;
  const LY_NOLONG = `<li>He would <b>still have been Over</b> that line without his single longest catch.</li>`;
  const LY_FH = `<li>His <b>first-half yards alone</b> were already above that game's line.</li>`;
  const LY_IDS = new Set(["sy25", "synl", "syypc", "fhr30", "fhnl", "bl200", "nlu20"]);
  const TABS = [
    { id: "qbr1", n: 1, side: "under", combo: true, label: "QB-R1", short: () => "L3 gm avg ≥25yd and line ≥25yd",
      title: "QB rushing yards → Under (rushes a lot, high line)", why: "Books may price a rushing QB's recent output too high.",
      desc: () => `Bet a QB's <b>rushing yards Under</b> when both are true:<ul class="sg-ul"><li>This week's rushing-yards line is <b>25 or more</b>.</li><li>In his <b>last 3 games played</b> he averaged <b>25 or more</b> rushing yards.</li></ul><div class="sg-sub">The idea is that a QB who runs a lot gets a high line, and that line may be set too high.</div>` },
    { id: "sc2", n: 2, side: "under", combo: true, label: "SC2", short: () => "RB rush yd under after leading big and hitting the over",
      title: "RB rush Under after a game his team led big", why: "A rushing Over built in a game his team led may not repeat.",
      desc: () => `Bet an RB's <b>rushing yards Under</b> when all three are true:<ul class="sg-ul"><li>In his team's <b>previous game</b> it led by 7+ points on at least <b>half of its offensive plays</b> (from play-by-play).</li><li>He finished <b>Over</b> his rushing line in that game.</li><li>This week's rushing line is <b>higher</b> than that game's line.</li></ul><div class="sg-sub">The idea is that a big rushing game in a game his team led may not repeat.</div>` },
    { id: "sc1", n: 3, side: "under", combo: true, label: "SC1", short: () => "Rec yd under after trailing big and hitting the over",
      title: "WR/TE rec yds Under after a game his team trailed big", why: "Catch-up volume may not repeat.",
      desc: () => `Bet a WR's or TE's <b>receiving yards Under</b> when all three are true:<ul class="sg-ul"><li>In his team's <b>previous game</b> it trailed by 7+ points on at least <b>half of its offensive plays</b> (from play-by-play).</li><li>He finished <b>Over</b> his receiving-yards line in that game.</li><li>This week's line is <b>higher</b> than that game's line.</li></ul><div class="sg-sub">The idea is that catch-up passing volume may not repeat.</div>` },
    { id: "cm1te", n: 6, side: "under", combo: true, cm: true, label: "CM1-TE", short: () => "TE rec yd under when QB line drops 15+ and receivers' lines don't follow", minDrop: 15, only: "TE",
      title: "TE rec yds Under when the QB line drops but receivers' lines don't follow", why: "Books cut the QB but not his pass catchers.",
      desc: () => `Bet the TE's <b>receiving yards Under</b> when both are true:<ul class="sg-ul"><li>The QB's passing-yards line is down <b>15+</b> vs last week.</li><li>The QB's line is down at least <b>10</b> yards more than all the receivers' line changes added up.</li></ul>${CM_READ}` },
    { id: "cm120", n: 7, side: "under", combo: true, cm: true, label: "CM1-20", short: () => "Rec yd under when QB line drops 20+ and receivers' lines don't follow", minDrop: 20, only: null,
      title: "Receiving yards Under when the QB line drops 20+ but receivers' lines don't follow", why: "Books cut the QB but not his pass catchers.",
      desc: () => `Same as CM1-TE, with two differences:<ul class="sg-ul"><li>The QB line is down <b>20+</b>.</li><li>Every qualifying receiver (WR/TE/RB) is a bet.</li></ul>${CM_READ}` },
    { id: "qbch", n: 8, side: "under", qbch: true, label: "QBCH", short: () => "WR/TE rec yd under when the starting QB changed",
      title: "WR/TE rec yds Under when the starting QB changed", why: "A new starting QB may mean lower passing volume or a less proven connection, while the receivers' lines still reflect the old QB.",
      desc: () => `Bet a WR's or TE's <b>receiving yards Under</b> when his team's starting QB is <b>not the QB who started its previous game</b>.<div class="sg-sub"><b>How the starter is picked:</b></div><ul class="sg-ul"><li>Past games: the QB with the most snaps.</li><li>This week's games: the QB the book has posted a passing-yards line for, so players can be flagged before kickoff.</li></ul>` },
    { id: "qbr2", n: 4, side: "under", label: "QB-R2", opts: [5, 7], optFmt: (v) => `+${v}`, short: () => `QB rush yd under when line is ${RL.opt.qbr2}+yd above his last-game line`,
      title: "QB rush Under when the line jumps", why: "A raised QB rushing line may overshoot.",
      desc: () => `Bet a QB's <b>rushing yards Under</b> when this week's rushing-yards line is at least <b>${RL.opt.qbr2} yards higher</b> than his line in his previous game. The toggle changes the size of the jump. The idea is that a big raise may overshoot.` },
    { id: "qbr4", n: 5, side: "under", label: "QB-R4", opts: [25, 40], optFmt: (v) => `${v}+`, short: () => `QB rush yd under when line is ${RL.opt.qbr4}+yd`,
      title: "QB rush Under on high lines", why: "High QB rushing lines may be inflated by a few big games.",
      desc: () => `Bet a QB's <b>rushing yards Under</b> when this week's rushing-yards line is <b>${RL.opt.qbr4} or higher</b>. The toggle changes the minimum line. The idea is that a few big games can inflate high QB rushing lines.` },
    // ---- Indicator page (#/search/indicators, long-press the Signals tab): the audit's tracked indicator rules, same format ----
    { id: "l9", n: 21, page: "ind", side: "under", label: "L9",
      title: "WR rec yds Under after three straight Overs", why: "A run of Overs may be priced into the next line.",
      desc: () => `Bet a WR's <b>receiving yards Under</b> when each of his <b>last 3 games played</b> finished <b>Over</b> that game's graded pre-game receiving-yards line (a push or a missing line breaks the run).` },
    { id: "l10", n: 22, page: "ind", side: "under", label: "L10",
      title: "WR receptions Under after three rising games", why: "Steadily rising catch totals may overstate the next game's opportunity.",
      desc: () => `Bet a WR's <b>receptions Under</b> when his catches rose in each of his <b>last 3 games played</b> (for example 2 → 4 → 6; ties do not count).` },
    { id: "s03", n: 23, page: "ind", side: "under", label: "S03",
      title: "WR rec yds Under after three rising games", why: "Rising yardage may overshoot his true level.",
      desc: () => `Bet a WR's <b>receiving yards Under</b> when his receiving yards rose in each of his <b>last 3 games played</b> (strictly higher each game).` },
    { id: "sp1", n: 24, page: "ind", side: "under", label: "SP1",
      title: "Team a 10+ point underdog → rec yds Under", why: "Big underdogs' passing games may underperform.",
      desc: () => `Bet a WR's, TE's or RB's <b>receiving yards Under</b> when his team is a <b>10+ point underdog</b> (the opponent is favored by 10 or more). ${SPREAD_NOTE}` },
    { id: "sp2", n: 25, page: "ind", side: "under", label: "SP2",
      title: "Team a 10+ point underdog → receptions Under", why: "Same idea as SP1, measured in catches (largely the same games).",
      desc: () => `Bet a WR's, TE's or RB's <b>receptions Under</b> when his team is a <b>10+ point underdog</b>. ${SPREAD_NOTE}` },
    { id: "sp3", n: 26, page: "ind", side: "over", label: "SP3",
      title: "Team favored by 10+ → QB pass yds Over", why: "A heavy favorite's QB may get more drives.",
      desc: () => `Bet a QB's <b>passing yards Over</b> when his team is <b>favored by 10 or more</b>. ${SPREAD_NOTE}` },
    { id: "sp4", n: 27, page: "ind", side: "under", label: "SP4",
      title: "Team a 10+ point underdog → QB pass yds Under", why: "The opposite of the trailing-teams-throw-more belief; it flips sign between seasons in the audit.",
      desc: () => `Bet a QB's <b>passing yards Under</b> when his team is a <b>10+ point underdog</b>. ${SPREAD_NOTE}` },
    { id: "sp5", n: 28, page: "ind", side: "under", label: "SP5",
      title: "Team a 3 to 6.5 point underdog → rushing Under", why: "Small underdogs play from slightly behind and may run less.",
      desc: () => `Bet a QB's or RB's <b>rushing yards Under</b> when his team is a <b>3 to 6.5 point underdog</b>. ${SPREAD_NOTE}` },
    // ---- Late-yardage indicators (2026-11-16, Michael's picks from the 2026-11-15 late-yardage study; receiving yards, WR/TE/RB) ----
    // Historical replay picked after seeing results (see STUDY below); scored here on 2026 games, tracked forward from the day they were added.
    { id: "sy25", n: 29, page: "ind", side: "under", label: "SY-R25", short: () => "Short-yardage receiver, line raised 25%+",
      title: "Short-yardage receiver, line raised 25%+ → rec yds Under", why: "A big raise for a receiver who gets his yards on short catches may overshoot.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_SHORT}${LY_PREV}${LY_UP(25)}</ul>` },
    { id: "synl", n: 30, page: "ind", side: "under", label: "SY-NL", short: () => "Short-yardage receiver, Over without his longest catch",
      title: "Short-yardage receiver who didn't need his longest catch → rec yds Under", why: "His Over came from several short catches, not one play, yet the line still went up.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_SHORT}${LY_PREV}${LY_UP()}${LY_NOLONG}</ul>` },
    { id: "syypc", n: 31, page: "ind", side: "under", label: "SY-YPC", short: () => "Short-yardage receiver with a long-catch game",
      title: "Short-yardage receiver whose yards per catch spiked → rec yds Under", why: "A game of unusually long catches for a short-catch receiver may not repeat.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_SHORT}${LY_PREV}${LY_UP()}<li>In that game his yards per catch were at least <b>1.5 times</b> his own career average (since 2024).</li></ul>` },
    { id: "fhr30", n: 32, page: "ind", side: "under", label: "FH-R30", short: () => "First half alone beat the line, line raised 30%+",
      title: "First-half Over, line raised 30%+ → rec yds Under", why: "A line that jumps after a game where he was already Over by halftime may overreact.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_PREV}${LY_FH}${LY_UP(30)}</ul>` },
    { id: "fhnl", n: 33, page: "ind", side: "under", label: "FH-NL", short: () => "First half alone beat the line, Over without his longest catch",
      title: "First-half Over without his longest catch → rec yds Under", why: "He was Over early and across several catches, yet the line still went up.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_PREV}${LY_UP()}${LY_FH}${LY_NOLONG}</ul>` },
    { id: "bl200", n: 34, page: "ind", side: "under", label: "BL-200", short: () => "Beat his line by 200%+",
      title: "Beat his line by 200%+ → rec yds Under", why: "A huge game may be priced as a new normal.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_PREV}${LY_UP()}<li>He <b>beat that line by 200% or more</b> (at least 3 times the line).</li></ul>` },
    { id: "nlu20", n: 35, page: "ind", side: "under", label: "NL-U20", short: () => "Longest catch under 20 yards",
      title: "Over with no catch of 20+ yards → rec yds Under", why: "A game with no long catch means the Over came from steady volume the line may now overstate.",
      desc: () => `${LY_WHO}<ul class="sg-ul">${LY_PREV}${LY_UP()}<li>His longest catch in that game was <b>under 20 yards</b>.</li></ul>` },
  ];
  const OPT0 = { qbr2: 5, qbr4: 25 }; // default toggle values
  // Rules 1–3 for everyone; 4–8 only for people signed in to a Stix account (Google), Michael 2026-10-29.
  // Front-end gate only: the data behind every rule is in data.json, which anyone can download.
  const FREE_RULES = 3;
  const signedIn = () => { try { return !!(window.STIX_ACCOUNT && window.STIX_ACCOUNT.signedIn()); } catch (e) { return false; } };
  let SGPAGE = "main"; // "main" = Signals, "ind" = the Indicator page (#/search/indicators)
  const visibleTabs = () => TABS.filter((t) => (t.page || "main") === SGPAGE); // gating is by tile order on the page (first 3 free), see topSection
  const SPREAD_NOTE = "Spread = nflverse schedule spread_line (source book and time not stated by nflverse); it can move during the week, and the rule is scored on the value nflverse shows after the game.";

  // ---------- helpers ----------
  function curLine(m) {
    if (!m) return null;
    if (m.lstat === "ok" && m.line != null) return { line: m.line, label: "pre-game", cap: m.cap };
    if (m.lstat === "pending") { const sn = latestSnap(m); if (sn) return { line: sn.line, label: sn.label, cap: sn.cap }; }
    return null;
  }
  function sd(xs) {
    if (xs.length < 3) return null;
    const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
    return v > 0 ? Math.sqrt(v) : null;
  }
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v), d);
  // Game script for a team in a game: minutes leading / trailing by 10+ and 13+, and whether it counts as big.
  function scriptInfo(gid, team) {
    const g = D.games[gid];
    if (!g || !g.scr) return null;
    const home = g.home === team, x = g.scr[home ? "h" : "a"]; if (!x) return null;
    const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
    const score = us == null || them == null ? "" : `${us > them ? "W" : us < them ? "L" : "T"} ${us}–${them} ${home ? "vs" : "@"} ${home ? g.away : g.home}`;
    const M = SCRIPT.margin, l = x["l" + M], t = x["t" + M];
    if (l == null || t == null) return null; // margin not in the data
    const led = l >= SCRIPT.minutes, trailed = t >= SCRIPT.minutes;
    return { x, l, t, score, led, trailed, big: led !== trailed ? (led ? "led" : "trailed") : null };
  }
  // +1 the script helped this position, -1 it worked against him, 0 neither
  function scriptFor(pos, info) {
    if (!info || !info.big) return 0;
    const led = info.big === "led";
    return pos === "RB" ? (led ? 1 : -1) : (led ? -1 : 1);
  }
  const scriptTxt = (info) => `${info.big === "led" ? "Led" : "Trailed"} by ${SCRIPT.margin}+ for ${Math.round(info.big === "led" ? info.l : info.t)} min`;

  // ---------- game script indicator on player game logs (tap for a pop-up) ----------
  function badge(gid, team, pos, pid) {
    try {
      const info = scriptInfo(gid, team); if (!info || !info.big) return "";
      const sc = scriptFor(pos, info), cls = sc > 0 ? "help" : "hurt", led = info.big === "led";
      const tip = `${scriptTxt(info)} (${sc > 0 ? "helps" : "works against"} ${pos}s). Tap for the game script.`;
      return `<span class="scrb ${cls}" role="button" tabindex="0" data-scr="${esc(gid)}|${esc(team)}|${esc(pos)}|${esc(pid || "")}" title="${esc(tip)}">${led ? "Led big" : "Trailed big"}</span>`;
    } catch (e) { console.error("game script badge failed", e); return ""; }
  }
  // The opponent text in a game log row: tappable (opens the game script) when the game has play-by-play data.
  function oppLink(gid, team, pos, pid, label) {
    try {
      const g = D.games[gid];
      if (!g || !g.scr || !g.scr.flow) return label;
      return `<span class="scrlink" role="button" tabindex="0" data-scr="${esc(gid)}|${esc(team)}|${esc(pos)}|${esc(pid || "")}" title="Tap for the game script">${label}</span>`;
    } catch (e) { return label; }
  }

  // Season totals for a team: add up its per-game counts (games with play-by-play data).
  function teamSeason(team) {
    const tot = { g: 0, np: 0, npp: 0, up: [0, 0], cl: [0, 0], dn: [0, 0], last: 0 };
    for (const g of Object.values(D.games)) {
      if (!g.scr || !g.scr.t) continue;
      const side = g.home === team ? "h" : g.away === team ? "a" : null; if (!side) continue;
      const t = g.scr.t[side]; if (!t) continue;
      tot.g++; tot.last = Math.max(tot.last, g.wk);
      for (const k of ["np", "npp"]) tot[k] += t[k] || 0;
      for (const k of ["up", "cl", "dn"]) { tot[k][0] += t[k][0]; tot[k][1] += t[k][1]; }
    }
    return tot;
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  const pctN = (a, b) => (b ? `${Math.round((100 * a) / b)}% <span class="muted">(${b})</span>` : `<span class="muted">—</span>`);
  function leaguePass() {
    let n = 0, p = 0;
    for (const g of Object.values(D.games)) if (g.scr && g.scr.t) for (const s of ["h", "a"]) { const t = g.scr.t[s]; if (t) { n += t.np; p += t.npp; } }
    return pct(p, n);
  }

  // Game-flow chart: the team's score margin over the game (from each scoring change).
  // info (scriptInfo) adds dashed lines at ± the big-margin setting and, when the margin went past one, the
  // minutes beyond it written on the chart (top for leading, bottom for trailing).
  function flowSvg(flow, home, info) {
    const pts = flow.map(([m, d]) => [m, home ? d : -d]);
    const hi = Math.max(0, ...pts.map((x) => x[1])), lo = Math.min(0, ...pts.map((x) => x[1]));
    const T = [0, 7, 13, 21, 28, 35, 42, 49, 56];
    const top = T.find((t) => t >= Math.max(13, hi)) || hi, bot = T.find((t) => t >= Math.max(13, -lo)) || -lo;
    const W = 340, H = 190, L = 30, R = 8, Tp = 10, B = 22, end = Math.max(60, pts[pts.length - 1][0]);
    const xs = (m) => L + ((W - L - R) * m) / end, ys = (v) => Tp + ((H - Tp - B) * (top - v)) / (top + bot);
    let g = "";
    const ticks = [...T.filter((t) => t <= top), ...T.filter((t) => t > 0 && t <= bot).map((t) => -t)].sort((a, b) => a - b);
    for (const t of ticks) g += `<line x1="${L}" x2="${W - R}" y1="${ys(t)}" y2="${ys(t)}" stroke="var(--line)" stroke-width="${t === 0 ? 1.4 : 1}"/><text x="${L - 4}" y="${ys(t) + 3.5}" font-size="10" text-anchor="end" fill="var(--muted)">${t > 0 ? "+" : ""}${t}</text>`;
    for (const q of [15, 30, 45]) g += `<line x1="${xs(q)}" x2="${xs(q)}" y1="${Tp}" y2="${H - B}" stroke="var(--line)" stroke-dasharray="2 3"/>`;
    ["Q1", "Q2", "Q3", "Q4"].forEach((q, i) => { g += `<text x="${xs(7.5 + 15 * i)}" y="${H - 7}" font-size="10" text-anchor="middle" fill="var(--muted)">${q}</text>`; });
    if (end > 60) g += `<text x="${xs((60 + end) / 2)}" y="${H - 7}" font-size="10" text-anchor="middle" fill="var(--muted)">OT</text>`;
    let d = "", prev = 0;
    pts.forEach(([m, v], i) => { d += i === 0 ? `M${xs(m)},${ys(v)}` : ` L${xs(m)},${ys(prev)} L${xs(m)},${ys(v)}`; prev = v; });
    const area = `${d} L${xs(end)},${ys(prev)} L${xs(end)},${ys(0)} L${xs(0)},${ys(0)} Z`;
    const id = "f" + Math.random().toString(36).slice(2, 7);
    g += `<clipPath id="${id}u"><rect x="0" y="0" width="${W}" height="${ys(0)}"/></clipPath><clipPath id="${id}d"><rect x="0" y="${ys(0)}" width="${W}" height="${H}"/></clipPath>`;
    g += `<path d="${area}" fill="var(--over)" opacity=".28" clip-path="url(#${id}u)"/><path d="${area}" fill="var(--under)" opacity=".28" clip-path="url(#${id}d)"/>`;
    g += `<path d="${d} L${xs(end)},${ys(prev)}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    if (info) {
      const M = SCRIPT.margin;
      for (const v of [M, -M]) g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--warn-ink)" stroke-width="1" stroke-dasharray="5 3"/>`;
      const big = (mins) => mins >= SCRIPT.minutes;
      if (info.l > 0) g += `<text x="${L + 6}" y="${Tp + 12}" font-size="11.5" font-weight="700" fill="var(--over)">Led ${M}+ for ${Math.round(info.l)} min${big(info.l) ? " · big" : ""}</text>`;
      if (info.t > 0) g += `<text x="${L + 6}" y="${H - B - 6}" font-size="11.5" font-weight="700" fill="var(--under)">Trailed ${M}+ for ${Math.round(info.t)} min${big(info.t) ? " · big" : ""}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="flowsvg" role="img" aria-label="Score margin over the game">${g}</svg>`;
  }

  function closePop() { const o = document.getElementById("scr-ov"); if (o) o.remove(); }
  function openPop(gid, team, pos, pid) {
    closePop();
    const g = D.games[gid]; if (!g || !g.scr) return;
    const info = scriptInfo(gid, team), home = g.home === team, opp = home ? g.away : g.home;
    const my = (g.scr.t || {})[home ? "h" : "a"], th = (g.scr.t || {})[home ? "a" : "h"];
    const S1 = teamSeason(team), S2 = teamSeason(opp);
    const row = (...c) => `<tr>${c.map((x, i) => `<td${i ? ' class="num"' : ""}>${x}</td>`).join("")}</tr>`;
    const sec = (title, sub, body) => `<div class="scrsec"><div class="scrh">${title}</div>${sub ? `<div class="muted small">${sub}</div>` : ""}${body}</div>`;
    let h = `<div class="share-box nw-box scrbox" role="dialog" aria-label="Game script">
      <div class="nw-h"><b>Game script</b> <span class="muted">${esc(team)} · W${g.wk}</span><button class="nw-x" aria-label="Close">✕</button></div>
      <p><b>${esc(info ? info.score : gameLabel(gid))}</b></p>`;
    if (g.scr.flow) h += flowSvg(g.scr.flow, home, info);
    if (my && th) {
      h += sec("Neutral pass rate", "Pass share of plays with the score within 7, quarters 1–3 (true run/pass tendency)",
        `<table class="wrap scrtab"><thead><tr><th></th><th class="num">This game</th><th class="num">Season</th></tr></thead><tbody>
        ${row(esc(team), pctN(my.npp, my.np), pctN(S1.npp, S1.np))}${row(esc(opp), pctN(th.npp, th.np), pctN(S2.npp, S2.np))}${row("League", "", leaguePass())}</tbody></table>`);
      h += sec("Pass rate by score", "Season pass share when up 13+, within 6, down 13+",
        `<table class="wrap scrtab"><thead><tr><th></th><th class="num">Up 13+</th><th class="num">Within 6</th><th class="num">Down 13+</th></tr></thead><tbody>
        ${row(esc(team), pctN(S1.up[1], S1.up[0]), pctN(S1.cl[1], S1.cl[0]), pctN(S1.dn[1], S1.dn[0]))}${row(esc(opp), pctN(S2.up[1], S2.up[0]), pctN(S2.cl[1], S2.cl[0]), pctN(S2.dn[1], S2.dn[0]))}</tbody></table>`);
    }
    h += `<p class="muted small">Dashed lines = your big-margin setting (${SCRIPT.margin}+; "big" = ${SCRIPT.minutes}+ min, Guide tab). Season = ${S1.g} games with play-by-play through W${S1.last}. Source: nflverse play-by-play.</p></div>`;
    const ov = document.createElement("div");
    ov.id = "scr-ov"; ov.className = "share-ov";
    ov.innerHTML = h;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest(".nw-x")) closePop(); });
  }
  const popHandler = (e) => {
    const b = e.target.closest && e.target.closest("[data-scr]"); if (!b) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation();
    const [gid, team, pos, pid] = b.dataset.scr.split("|");
    try { openPop(gid, team, pos, pid); } catch (err) { console.error("game script pop-up failed", err); }
  };
  document.addEventListener("click", popHandler, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); else popHandler(e); }, true);
  window.addEventListener("hashchange", closePop);

  function usageOf(pos, r) {
    if (pos === "RB") return r.snap == null ? null : r.snap;
    if (pos === "WR" || pos === "TE") return r.tshare == null ? null : r.tshare * 100;
    return null;
  }

  // Which games a pass looks at. Normal pass: games not started yet. In-progress pass (LIVE_PASS, used only to build the
  // "Game in progress" list on Signals): games that kicked off but are not final. Nothing else reads LIVE_PASS.
  let LIVE_PASS = false;
  const gameScope = (final, ko, now) => !final && !!ko && (LIVE_PASS ? new Date(ko).getTime() <= now : new Date(ko).getTime() > now);

  // Every upcoming (not started) player × market with a line showing, plus his history. Slotted players only (the rules' universe).
  function candidates(withExtras) {
    const now = Date.now(), out = [];
    for (const p of D.players) {
      if (p.extra && !withExtras) continue;
      const rows = D.rows[p.id] || [];
      for (const r of rows) {
        if (!gameScope(r.final, r.ko, now)) continue;
        if (RL.gid && r.gid !== RL.gid) continue;
        const past = rows.filter((x) => x.wk < r.wk && x.final).sort((a, b) => a.wk - b.wk);
        const played = past.filter((x) => x.played === true);
        const prev = past[past.length - 1] || null;
        for (const [mid, m] of Object.entries(r.m || {})) {
          if (RL.mk && mid !== RL.mk) continue;
          const cur = curLine(m); if (!cur) continue;
          const pm = prev && prev.m ? prev.m[mid] : null;
          out.push({ p, r, mid, m, cur, past, played, prev, pm });
        }
      }
    }
    return out;
  }
  // Game filter options: upcoming (not started) games where at least one slotted player has a line showing.
  function gameOptions() {
    const now = Date.now(), seen = new Map();
    for (const p of D.players) {
      if (p.extra) continue;
      for (const r of D.rows[p.id] || []) {
        if (r.final || !r.ko || new Date(r.ko).getTime() <= now || seen.has(r.gid)) continue;
        if (Object.values(r.m || {}).some((m) => curLine(m))) seen.set(r.gid, r.ko);
      }
    }
    return [...seen.entries()].sort((a, b) => new Date(a[1]) - new Date(b[1]) || a[0].localeCompare(b[0]));
  }
  const prevLine = (c) => (c.pm && c.pm.lstat === "ok" && c.pm.line != null ? c.pm.line : null);
  // Points his team is favored by (negative = underdog), from nflverse spread_line (home team favored by). null if not posted.
  function favBy(r) {
    const g = D.games[r.gid];
    if (!g || g.spread == null) return null;
    return g.spread * (r.ha === "home" ? 1 : -1);
  }
  const spreadTxt = (f) => (f > 0 ? `favored by ${num(f)}` : f < 0 ? `${num(-f)}-pt underdog` : "pick'em");
  const koMs = (c) => new Date(c.r.ko).getTime();

  function compute(tab) {
    if (TABS.find((t) => t.id === tab)?.cm) return computeCM(TABS.find((t) => t.id === tab));
    if (TABS.find((t) => t.id === tab)?.qbch) return computeQBCH();
    if (TABS.find((t) => t.id === tab)?.frozen) return frozenCandidates(tab);
    const out = [];
    const indTab = TABS.find((t) => t.id === tab)?.page === "ind"; // Indicator rules cover every quoted player (as the audit did), not just slotted ones
    for (const c of candidates(indTab)) {
      const pl = prevLine(c), line = c.cur.line;
      if (!ruleHits(c.r, c.mid, { line }, c.p, c.past, c.played, c.prev).hits.includes(tab)) continue;
      const l3 = c.played.map((x) => (x.m && x.m[c.mid] ? x.m[c.mid].act : null)).filter((v) => v != null).slice(-3);
      const l3t = l3.length ? l3.map((v) => num(v, 0)).join(", ") : `<span class="muted">—</span>`;
      const sh = sharesOf(c.prev);
      let cells, note;
      const ind = TABS.find((t) => t.id === tab)?.page === "ind";
      if (ind && LY_IDS.has(tab)) {
        const d = c.prev && c.prev.rd;
        cells = [`${num(pl)} → <b>${num(line)}</b> <b>${signed(line - pl)}</b>`, d ? `${d.rc} catches, ${num(c.pm.act, 0)} yds · 1st half ${num(d.h1, 0)} · longest ${num(d.lc, 0)}` : "—"];
        note = d ? `Last game: ${num(c.pm.act, 0)} yds vs ${num(pl)} line` : "";
      } else if (ind) {
        const fb = favBy(c.r), last = c.played.slice(-3).map((x) => (x.m && x.m[c.mid] ? x.m[c.mid].act : null)).filter((v) => v != null).map((v) => num(v, 0)).join(", ");
        cells = [`<b>${num(line)}</b>`, fb != null && tab.startsWith("sp") ? esc(spreadTxt(fb)) : esc(last || "—")];
        note = tab.startsWith("sp") ? `Team ${spreadTxt(fb)}` : `Last 3: ${last}`;
      }
      else if (tab === "qbr1" || tab === "qbr4") cells = [`<b>${num(line)}</b>`, l3t];
      else if (tab === "qbr2") cells = [`${num(pl)} → <b>${num(line)}</b> <b>${signed(line - pl)}</b>`, l3t];
      else cells = [`${num(pl)} → <b>${num(line)}</b>`, `${num(c.pm.act)} vs ${num(pl)} · ${Math.round(100 * (tab === "sc1" ? sh.trail : sh.lead))}% of plays ${tab === "sc1" ? "trailing" : "leading"} 7+`];
      out.push({ c, rank: -koMs(c), cells, note });
    }
    out.sort((a, b) => b.rank - a.rank || a.c.p.name.localeCompare(b.c.p.name));
    return out;
  }
  const HEADS = {
    qbr1: ["Line", "Last 3"], qbr4: ["Line", "Last 3"], qbr2: ["Line (last game → now)", "Last 3"],
    cm1te: ["Line (last week → now)", "QB vs receivers"], cm120: ["Line (last week → now)", "QB vs receivers"],
    qbch: ["Line", "QB"],
    sc1: ["Line (last game → now)", "Last game"], sc2: ["Line (last game → now)", "Last game"],
    l9: ["Line", "Last 3"], l10: ["Line", "Last 3"], s03: ["Line", "Last 3"],
    sp1: ["Line", "Spread"], sp2: ["Line", "Spread"], sp3: ["Line", "Spread"], sp4: ["Line", "Spread"], sp5: ["Line", "Spread"],
    sy25: ["Line (last game → now)", "Last game"], synl: ["Line (last game → now)", "Last game"], syypc: ["Line (last game → now)", "Last game"],
    fhr30: ["Line (last game → now)", "Last game"], fhnl: ["Line (last game → now)", "Last game"], bl200: ["Line (last game → now)", "Last game"], nlu20: ["Line (last game → now)", "Last game"],
  };
  const sideChip = (t) => `<span class="chip rl-side ${t.side}">${t.side === "model" ? "Over / Under" : `Bet ${t.side === "over" ? "Over" : "Under"}`}</span>`;
  // Season record for original leads 1–8: every graded week so far (weeks 1 through the latest week with a final game),
  // recomputed from data.json each time, so it updates as games finish. Same grading as Leads Analysis.
  function seasonRecLine(t) {
    const wks = laWeeks().slice().reverse();
    const by = wks.map((w) => [w, analyze(t.id, w)]);
    const used = by.filter(([, l]) => l.length).map(([w]) => w);
    if (!used.length) return t.frozen ? "No graded bets yet." : "No graded games yet.";
    // Original leads cover week 1 on; leads 9–12 only have bets recorded after their Oct 30 freeze, so they start at their first week.
    const first = t.frozen ? used[0] : wks[0], last = t.frozen ? used[used.length - 1] : wks[wks.length - 1];
    const s = tally(by.flatMap(([, l]) => l));
    const label = first === last ? `Week ${first}` : `Weeks ${first}–${last}`;
    return `${label}: <b>${recTxt(s)} · ${s.hit == null ? "–" : s.hit.toFixed(1) + "%"} · ${unitsTxt(s.U)}${s.roi == null ? "" : ` · ${s.roi >= 0 ? "+" : "−"}${Math.abs(s.roi).toFixed(1)}% ROI`}</b>.`;
  }
  const recLine = (t) => t.challenger ? `Weekly learning · ${esc(D.challenger?.version || "awaiting first Tuesday training")} · 10% estimated-return trigger. Watchlist is provisional; only pregame-locked decisions enter the forward record.` : t.frozen ? `${seasonRecLine(t)} Frozen Oct 30, 2026 · forward paper record only. Early-week matches are provisional. Decisions lock at the pregame capture (~3 h before kickoff), at saved odds, 1 unit per bet. No historical results are added.` : seasonRecLine(t);

  function frozenEntries(tab) {
    const out = [];
    const source = tab === "t13" ? D.challenger : D.frozen_research;
    for (const [v, locked] of [...Object.values(source?.records || {}).map((v) => [v, true]), ...Object.values(source?.watchlist || {}).filter((v) => !source?.records?.[[v.gid,v.pid,v.mid].join("|")]).map((v) => [v, false])]) {
      const decision = v.decisions?.[tab];
      if (!decision || decision.qualifies === false) continue;
      const p = D.players.find((x) => x.id === v.pid);
      const r = (D.rows[v.pid] || []).find((x) => x.gid === v.gid);
      if (p && r) out.push({ v, decision, p, r, locked, mid: v.mid });
    }
    return out;
  }
  function frozenCandidates(tab) {
    return frozenEntries(tab).filter((x) => gameScope(x.r.final, x.r.ko, Date.now())
      && (!RL.gid || x.r.gid === RL.gid) && (!RL.mk || x.mid === RL.mk)).map((x) => {
        const { v, decision, p, r, mid } = x, cur = { line: v.quote.line, label: x.locked ? "locked pregame quote" : "provisional weekly snapshot", cap: v.quote.cap };
        const price = decision.side === "over" ? v.quote.op : v.quote.up;
        return { side: decision.side, c: { p, r, mid, cur }, rank: decision.edge || -new Date(r.ko).getTime(),
          badge: `${x.locked ? "Locked" : "Watchlist"} · ${decision.side === "over" ? "Over" : "Under"}`,
          cells: [`<b>${decision.side === "over" ? "Over" : "Under"} ${num(cur.line)}</b> ${odds(price)} · ${esc(v.quote.book)}`,
            decision.edge != null ? `${num(100 * decision.probability)}% win · ${signed(100 * decision.edge)}% estimated ROI` : fmtTime(v.observed_at)] };
      }).sort((a, b) => b.rank - a.rank);
  }

  // "Add all to FanDuel slip" (Michael 2026-10-29): one link that puts the rule's bet side for every listed player
  // (the rows shown, top 40) on the FanDuel bet slip. FanDuel takes several bets in one addToBetslip link as
  // marketId[i]=…&selectionId[i]=… (Michael's iPhone test 2026-10-29: 3 bets all landed; repeated or comma-separated
  // parameters did not work). Each bet uses FanDuel's own current line. Players without a FanDuel link in the latest
  // pull, or whose game has started, are left out and named. Tapping also saves the picks to My picks (one save) only when the switch above the list is on (off by default).
  const FD_SLIP_MAX = 25; // most bets in one FanDuel slip link (Michael, 2026-11-01)
  const FD_SLIP = /^https:\/\/sportsbook\.fanduel\.com\/addToBetslip\?/;
  // Whether a tap on "Add all to FanDuel slip" also saves those picks to My picks. Off unless switched on (Michael,
  // 2026-11-01: he mostly taps it to try the slip, not to log picks). Per browser: localStorage `stix_fd_save` = "1" (save) / "0".
  const fdSave = () => { try { return localStorage.getItem("stix_fd_save") === "1"; } catch { return false; } };
  const setFdSave = (on) => { try { localStorage.setItem("stix_fd_save", on ? "1" : "0"); } catch { /* ignore */ } };
  // Checkboxes (Michael 2026-11-07): the slip holds only the players whose box is checked, per lead, nothing checked to start.
  // Selection lives in memory only (per lead; survives the 5-minute refresh, not a reload).
  const rowKey = (x) => `${x.c.p.id}|${x.c.mid}|${x.c.r.gid}${x.bp ? "|" + x.side : ""}`;
  const selOf = (id) => (RL.sel = RL.sel || {})[id] || (RL.sel[id] = new Set());
  // DraftKings comparison (Michael 2026-11-16): before FanDuel opens, flag any bet where DraftKings (same game, same market,
  // pre-game, same latest pull) offers a better number on the same side. Better = a lower line for an Over, a higher line for
  // an Under; on the same line, better odds (higher American price). Returns null when DraftKings has no comparable line.
  function dkBetter(pid, mid, side, gid, fd) {
    const dk = ((((D.links || {})[pid] || {})[mid]) || {}).draftkings, g = D.games[gid];
    if (!dk || dk.gid !== gid || !g || new Date(g.ko).getTime() <= Date.now()) return null;
    const x = dk[side], fp = fd && fd.point, fx = fd && fd[side];
    if (!x || x.price == null || dk.point == null || fp == null || !fx || fx.price == null) return null;
    const lineWin = side === "o" ? dk.point < fp : dk.point > fp;
    const priceWin = dk.point === fp && x.price > fx.price;
    // oc: DraftKings' outcome id from its slip link (kept URL-encoded), for the "to DK" button. Missing if no usable link.
    const m = DK_SLIP.exec(x.url || "");
    return (lineWin || priceWin) ? { line: dk.point, odds: x.price, why: lineWin ? "line" : "odds", cap: dk.cap, oc: m ? m[1] : null } : null;
  }
  // DraftKings slip links (Michael 2026-11-19). One link holds several bets as ?outcomes=<id>+<id> (his iPhone test that day:
  // "+", "%2B" and repeated outcomes= all put both bets on; comma, outcomes[0]= and the /event/ page did not). A DK outcome id
  // names one exact line, so the link works only while DK still shows the line from Stix's latest pull (every DK line move
  // in 3 days of history changed the id); the button shows when those lines were pulled.
  const DK_SLIP = /^https:\/\/sportsbook\.draftkings\.com\/\?outcomes=([^&#]+)$/;
  const dkSlipUrl = (legs) => "https://sportsbook.draftkings.com/?outcomes=" + legs.map((l) => l.dk.oc).join("+");
  const dkLeg = (l) => Object.assign({}, l, { bet: { line: l.dk.line, odds: l.dk.odds, cap: l.dk.cap, gid: l.bet.gid, book: "DraftKings", src: "Bet on DK" } });
  const slipUrl = (legs) => "https://sportsbook.fanduel.com/addToBetslip?" + legs.map((l, j) => `marketId[${j}]=${l.m}&selectionId[${j}]=${l.sel}`).join("&");
  // Both FD buttons save every checked bet to My picks (when the save switch is on), even ones left off the "best FD only" slip (Michael 2026-11-16); Cancel saves nothing.
  // Popup shown when a tapped slip link includes bets with a better DraftKings number. Every choice is a real link
  // (so the phone doesn't block it); "best FD only" opens a slip without the flagged bets.
  // 2026-11-19 (Michael): "Better DK lines to DK" opens DraftKings with the flagged bets (saved as DraftKings picks when the
  // switch is on), and "Do both" opens the best-FD slip, then the popup stays up with "Next: open DraftKings" for a second
  // tap (a phone opens only one app per tap). The popup now stays open after any link until Close or a tap outside it.
  function dkPopup(chunk, tId) {
    document.querySelector(".rl-dkpop")?.remove();
    const flagged = chunk.legs.filter((l) => l.dk), keep = chunk.legs.filter((l) => !l.dk);
    const toDk = flagged.filter((l) => l.dk.oc), noDk = flagged.filter((l) => !l.dk.oc);
    const caps = toDk.map((l) => l.dk.cap).filter(Boolean).sort(), asOf = caps.length ? fmtTime(caps[0]) : "";
    const rows = flagged.map((l) => `<li><b>${esc(l.name)}</b> ${esc(l.label)} ${l.side === "o" ? "Over" : "Under"}<br><span class="muted small">FD ${num(l.bet.line)} ${odds(l.bet.odds)} · DK ${num(l.dk.line)} ${odds(l.dk.odds)} (better ${l.dk.why})</span></li>`).join("");
    const fdUrl = keep.length ? slipUrl(keep) : "", dkUrl = toDk.length ? dkSlipUrl(toDk) : "";
    const dkBtn = (label) => `<a class="betbtn" data-dkpick="dk" href="${esc(dkUrl)}" target="_blank" rel="noopener">${label} ↗<span class="muted small rl-dkasof">DK lines as of ${esc(asOf)}. If DK moved a line since, that bet won't load.</span></a>`;
    const close = `<button type="button" class="betbtn" data-dkpick="cancel">Close</button>`;
    const el = document.createElement("div"); el.className = "rl-dkpop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    const step1 = () => {
      const both = keep.length && toDk.length
        ? `<a class="betbtn rl-both" data-dkpick="both" href="${esc(fdUrl)}" target="_blank" rel="noopener">Do both: ${keep.length} to FD, then ${toDk.length} to DK ↗</a>` : "";
      const only = keep.length
        ? `<a class="betbtn" data-dkpick="best" href="${esc(fdUrl)}" target="_blank" rel="noopener">Only take best FD lines to FD (${keep.length}) ↗</a>`
        : `<span class="betbtn rl-off" aria-disabled="true" style="opacity:.5">No bets have the best line on FD</span>`;
      const dk = toDk.length ? dkBtn(`Take better DK lines to DK (${toDk.length})`) : "";
      el.innerHTML = `<div class="rl-dkcard"><b>${flagged.length} of ${chunk.legs.length} bets ${flagged.length === 1 ? "has" : "have"} a better line on DraftKings</b><ul>${rows}</ul>
        ${noDk.length ? `<p class="muted small">No DraftKings link for: ${esc(noDk.map((l) => l.name).join(", "))}</p>` : ""}
        <div class="rl-dkbtns">${both}${only}${dk}<a class="betbtn" data-dkpick="all" href="${esc(chunk.url)}" target="_blank" rel="noopener">Take all ${chunk.legs.length} to FD ↗</a>${close}</div></div>`;
    };
    const step2 = () => {
      el.innerHTML = `<div class="rl-dkcard"><b>Step 2 of 2</b><p class="small">Sent ${keep.length} bet${keep.length === 1 ? "" : "s"} to FanDuel. Now the ${toDk.length} better on DraftKings:</p>
        <div class="rl-dkbtns">${dkBtn(`Next: open DraftKings (${toDk.length})`)}${close}</div></div>`;
    };
    const save = (legs) => {
      if (!window.STIX_PICKS || !fdSave() || !legs.length) return;
      try { window.STIX_PICKS.recordBets(legs); } catch (err) { console.error("picks from slip popup failed", err); }
    };
    el.addEventListener("click", (ev) => {
      const b = ev.target.closest && ev.target.closest("[data-dkpick]");
      if (!b) { if (ev.target === el) el.remove(); return; } // tap outside the card closes; on the card does nothing
      const pick = b.dataset.dkpick;
      if (pick === "cancel") { el.remove(); return; }
      // The link opens as usual; the popup stays so the next choice is one tap away.
      if (pick === "dk") save(toDk.map(dkLeg));
      else save(chunk.legs); // best, all, both: every checked bet as FanDuel (Michael 2026-11-16), as before
      if (pick === "both") { setTimeout(step2, 0); return; }
      if (!b.querySelector(".rl-done")) b.insertAdjacentHTML("beforeend", ` <span class="rl-done">✓ opened</span>`);
    });
    step1();
    document.body.appendChild(el);
  }
  function fdSlip(t, rows) {
    const now = Date.now(), legs = [], missing = [], chosen = selOf(t.id);
    for (const x of rows) {
      if (!chosen.has(rowKey(x))) continue;
      const { p, r, mid } = x.c;
      // Leads 1–8 have one side for the whole rule; frozen leads 9–12 carry each row's own recorded side (the models can pick Over or Under per player).
      const side = (x.side || t.side) === "over" ? "o" : "u";
      const e = ((((D.links || {})[p.id] || {})[mid]) || {}).fanduel, o = e && e[side], g = e && D.games[e.gid];
      let m = null, sel = null;
      if (o && FD_SLIP.test(o.url || "") && g && e.gid === r.gid && new Date(g.ko).getTime() > now) {
        try { const u = new URL(o.url); m = u.searchParams.get("marketId"); sel = u.searchParams.get("selectionId"); } catch (err) { m = sel = null; }
      }
      if (m && sel && /^[\d.]+$/.test(m) && /^\d+$/.test(sel)) legs.push({ pid: p.id, mid, side, m, sel, name: p.name, label: mkt[mid].label, dk: dkBetter(p.id, mid, side, r.gid, e), bet: { line: e.point, odds: o.price, cap: e.cap, gid: e.gid, book: "FanDuel", src: "Bet on FD" } });
      else missing.push(`${p.name} (${mkt[mid].label})`);
    }
    // More than FD_SLIP_MAX bets are split into several links of at most FD_SLIP_MAX bets each, in list order.
    const chunks = [];
    for (let i = 0; i < legs.length; i += FD_SLIP_MAX) {
      const part = legs.slice(i, i + FD_SLIP_MAX);
      chunks.push({ legs: part, from: i + 1, to: i + part.length,
        url: slipUrl(part) });
    }
    return { legs, missing, chunks };
  }
  // Shown only where saving picks is possible (signed in with 21+ done, or the old GitHub key on this device).
  function saveSwitch() {
    if (!window.STIX_PICKS || !window.STIX_PICKS.enabled()) return "";
    return `<label class="rl-fdsave small"><input type="checkbox" data-fdsave ${fdSave() ? "checked" : ""}> Also save these to My picks when I tap <span class="muted">(${fdSave() ? "on" : "off: the slip opens, nothing is saved"})</span></label>`;
  }
  function fdSlipBox(t, rows) {
    if (t.challenger) return ""; // Lead 13 (learning challenger): no slip button.
    RL.fdT = t; RL.fdRows = rows;
    const f = fdSlip(t, rows); RL.fdChunks = f.chunks;
    const nSel = selOf(t.id).size;
    const picker = `<span class="small rl-pick"><button type="button" class="linkbtn" data-rlall="1">Select all</button> · <button type="button" class="linkbtn" data-rlall="0">Clear</button> <span class="muted">${nSel} selected</span></span>`;
    if (!f.legs.length && !f.missing.length) return `<div class="betbox rl-fd">${picker}<span class="betbtn rl-off" aria-disabled="true" style="opacity:.5">Check players to add them to the FanDuel slip</span></div>`;
    if (!f.legs.length) return `<div class="betbox rl-fd">${picker}<span class="betbtn rl-off" aria-disabled="true" style="opacity:.5">None of the checked players are on FanDuel</span><span class="muted small">Not on FanDuel: ${esc(f.missing.join(", "))}</span></div>`;
    // Frozen leads 9–12: the slip only opens FanDuel with the recorded side at FanDuel's current line. It never changes the frozen
    // paper record (side, saved quote), which is written elsewhere and scored on the saved pregame quote.
    const sides = new Set(f.legs.map((l) => l.side)), word = sides.size > 1 ? "bet" : sides.has("o") ? "Over" : "Under", many = f.chunks.length > 1;
    const btns = f.chunks.map((c, k) => `<a class="betbtn${many ? " rl-slip" : ""}" href="${esc(c.url)}" target="_blank" rel="noopener" data-fdall="${esc(t.id)}" data-fdchunk="${k}" title="Opens FanDuel with ${c.legs.length} bets on the slip">${many ? `Slip ${k + 1} · ${c.from === c.to ? `bet ${c.from}` : `bets ${c.from}–${c.to}`} ↗` : `Add ${f.legs.length} checked ${word}${f.legs.length > 1 ? "s" : ""} to FanDuel slip ↗`}</a>`).join("");
    return `<div class="betbox rl-fd">${picker}${many ? `<span class="muted small rl-fdnote">FanDuel takes up to ${FD_SLIP_MAX} bets per link, so these ${f.legs.length} ${word}s are split into ${f.chunks.length} slips. Open each one.</span><div class="rl-slips">${btns}</div>` : btns}${t.frozen ? `<span class="muted small">Opens FanDuel at its current line, which can differ from the saved line shown. The frozen record is not changed.</span>` : ""}${f.missing.length ? `<span class="muted small">Not on FanDuel: ${esc(f.missing.join(", "))}</span>` : ""}${saveSwitch()}</div>`;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-rlall]");
    if (a && RL.fdT && RL.fdRows) {
      const s = selOf(RL.fdT.id); s.clear();
      if (a.dataset.rlall === "1") RL.fdRows.forEach((x) => s.add(rowKey(x)));
      document.querySelectorAll("[data-rlck]").forEach((el) => { el.checked = s.has(el.dataset.rlck); });
      refreshSlipBox(); return;
    }
  });
  document.addEventListener("click", (e) => {
    // Switch off: FanDuel opens and nothing is saved. Switch on: save only the slip (chunk) that was tapped.
    const b = e.target.closest && e.target.closest("[data-fdall]"); if (!b) return;
    const chunk = (RL.fdChunks || [])[+b.dataset.fdchunk || 0];
    // Any bet with a better DraftKings number: hold the tap and ask first (the popup's links open FanDuel and save as chosen).
    if (chunk && chunk.legs.some((l) => l.dk)) { e.preventDefault(); dkPopup(chunk, b.dataset.fdall); return; }
    if (!window.STIX_PICKS || !fdSave()) return;
    try { window.STIX_PICKS.recordBets((chunk || {}).legs || []); } catch (err) { console.error("picks from FanDuel slip failed", err); }
  });
  function refreshSlipBox() {
    const box = document.querySelector(".rl-fd"); if (!box || !RL.fdT || !RL.fdRows) return;
    box.outerHTML = fdSlipBox(RL.fdT, RL.fdRows);
  }
  document.addEventListener("change", (e) => {
    const k = e.target && e.target.matches && e.target.matches("[data-rlck]") ? e.target : null;
    if (k && RL.fdT) { const s = selOf(RL.fdT.id); if (k.checked) s.add(k.dataset.rlck); else s.delete(k.dataset.rlck); refreshSlipBox(); return; }
    const c = e.target && e.target.matches && e.target.matches("[data-fdsave]") ? e.target : null; if (!c) return;
    setFdSave(c.checked);
    const note = c.parentNode && c.parentNode.querySelector(".muted"); if (note) note.textContent = `(${c.checked ? "on" : "off: the slip opens, nothing is saved"})`;
  });

  const PAGE = 10;
  const pageKey = (t) => `${t.id}|${RL.gid || ""}|${RL.mk || ""}`;
  function body(head) {
    const t = visibleTabs().find((x) => x.id === RL.tab) || TABS[0];
    const list = compute(t.id).filter(nm);
    let h = head === false ? "" : `<p class="callout small"><b>${t.n}. ${esc(t.title)}.</b> ${sideChip(t)}<br><span class="muted">${recLine(t)}</span></p>`;
    if (t.challenger && !D.challenger?.version) return h + `<p class="muted">Awaiting the first Tuesday-afternoon training run. Frozen signals continue unchanged.</p>`;
    if (t.frozen && !list.length) return h + `<p class="muted">No upcoming matches yet. Weekly snapshots populate a provisional watchlist; matches can change until the pregame capture locks the decision. Only locked decisions are scored.</p>`;
    if (t.spread && !Object.values(D.games).some((g) => g.spread != null)) return h + `<p class="muted">Point spreads (nflverse schedule) aren't in the app's data yet, so this rule can't be filled.</p>`;
    if (!list.length && RL.gid) return h + `<p class="muted">No players in ${esc(gameLabel(RL.gid))} match rule ${t.n} right now.</p>`;
    if (!list.length) return h + `<p class="muted">No upcoming lines match right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do.</p>`;
    const heads = HEADS[t.id];
    // 10 players per page (Michael 2026-11-07). The FanDuel slip and Select all work on the whole list, not just the page shown.
    const pages = Math.ceil(list.length / PAGE), key = pageKey(t), pg = Math.min(Math.max(+(RL.pg || {})[key] || 0, 0), pages - 1);
    (RL.pg = RL.pg || {})[key] = pg; RL.curKey = key;
    h += fdSlipBox(t, list);
    h += `<div class="panel rlist">`;
    for (const x of list.slice(pg * PAGE, pg * PAGE + PAGE)) {
      const { p, r, mid, cur } = x.c;
      h += `<div class="rlrow"><div class="rlhead">${t.challenger ? "" : `<input type="checkbox" class="rl-ck" data-rlck="${esc(rowKey(x))}" aria-label="Add ${esc(p.name)} to the FanDuel slip" ${selOf(t.id).has(rowKey(x)) ? "checked" : ""}>`}<a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
          <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${x.badge || ""}</span></div>
        <div class="muted small">${esc(p.pos)} · ${esc(r.slot || "")} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)} · line from ${esc(cur.label)}</div>
        <div class="rlcells">${x.cells.map((v, k) => `<span><span class="muted small">${heads[k]}</span> ${v}</span>`).join("")}</div></div>`;
    }
    const pager = pages > 1 ? `<div class="rl-pager small"><button type="button" class="linkbtn" data-rlpg="-1" ${pg === 0 ? "disabled" : ""}>‹ Prev</button><span class="muted">Page ${pg + 1} of ${pages} · ${pg * PAGE + 1}–${Math.min(list.length, pg * PAGE + PAGE)} of ${list.length}</span><button type="button" class="linkbtn" data-rlpg="1" ${pg === pages - 1 ? "disabled" : ""}>Next ›</button></div>` : "";
    return h + `</div>${pager}`;
  }

  // Week-cluster 95% intervals from the 2026-11-11 thesis audit (2025 wk1-18 + 2026 wk1-9 replay, flat 1-unit bets). Historical, not live.
  const AUDIT = {
    qbr1: { rec: "62–28", roi: 30.2, lo: 11.3, hi: 48.2 }, sc1: { rec: "187–132", roi: 10.9, lo: 1.9, hi: 19.6 },
    sc2: { rec: "50–26", roi: 24.2, lo: -0.2, hi: 44.3 }, cm1te: { rec: "32–14", roi: 31.4, lo: 8.8, hi: 53.6 },
    cm120: { rec: "67–36", roi: 23.2, lo: 9.3, hi: 38.3 }, qbch: { rec: "182–126", roi: 11.5, lo: 2.8, hi: 19.3 },
    l9: { rec: "91–56", roi: 17.1, lo: 2.9, hi: 31.4 }, l10: { rec: "106–72", roi: 10.1, lo: -2.8, hi: 22.8 }, s03: { rec: "159–119", roi: 8.3, lo: -1.1, hi: 18.6 },
    sp1: { rec: "126–80", roi: 15.9, lo: -1.5, hi: 31.3 }, sp2: { rec: "121–81", roi: 12.7, lo: -1.8, hi: 28.8 }, sp3: { rec: "24–17", roi: 10.9, lo: -23.2, hi: 44.4 },
    sp4: { rec: "23–16", roi: 11.7, lo: -20.3, hi: 40.9 }, sp5: { rec: "297–224", roi: 7.6, lo: 1.2, hi: 13.9 },
    qbr2: { 5: { rec: "29–12", roi: 33.8, lo: 14.5, hi: 54.9 } },
    qbr4: { 25: { rec: "85–59", roi: 11.7, lo: -1.9, hi: 26.3, note: "tested as lines of 25 to 39.5" }, 40: { rec: "16–9", roi: 20.8, lo: -26.7, hi: 70.8 } },
  };
  // ROI by season from the same audit (2025 weeks 1-18, 2026 weeks 1-9). The audit report gives each season's ROI but not each season's W-L.
  const AUDIT_YR = {
    qbr1: [23.2, 46.6], sc1: [5.0, 20.3], sc2: [20.9, 30.7], cm1te: [29.8, 35.1], cm120: [24.7, 19.6], qbch: [8.4, 16.5],
    qbr2: { 5: [32.5, 37.1] }, qbr4: { 25: [6.2, 21.2], 40: [13.2, 51.3] },
    l9: [20.0, 10.9], l10: [12.6, 3.7], s03: [7.5, 10.3], sp1: [17.8, 10.0], sp2: [16.6, 0.5], sp3: [9.0, 18.5], sp4: [22.2, -28.9], sp5: [7.5, 7.9],
  };
  const pc = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
  // Late-yardage study (2026-11-15, 2025 wk1-18 + 2026 wk1-10, receiving yards, 1 unit at the saved price, week-cluster 95% intervals).
  // Picked after seeing results; yr = ROI by season [2025, 2026]. Historical, not live.
  const STUDY = {
    sy25: { rec: "58–24", roi: 33.7, lo: 15.8, hi: 51.1, yr: [24.0, 53.6] }, synl: { rec: "105–57", roi: 22.5, lo: 6.7, hi: 36.7, yr: [14.5, 37.0] },
    syypc: { rec: "54–30", roi: 21.5, lo: 4.8, hi: 37.5, yr: [19.2, 29.3] }, fhr30: { rec: "95–53", roi: 21.2, lo: 10.3, hi: 32.0, yr: [16.9, 29.3] },
    fhnl: { rec: "193–118", roi: 17.4, lo: 9.8, hi: 25.3, yr: [11.9, 26.0] }, bl200: { rec: "117–78", roi: 13.4, lo: 5.0, hi: 22.8, yr: [6.6, 22.3] },
    nlu20: { rec: "112–74", roi: 14.1, lo: 2.8, hi: 23.7, yr: [4.2, 25.6] },
  };
  // Back light for the tile run charts (Michael 2026-11-16): each signal's 95% ROI interval from the audit/study tables above, or null if untested.
  function roiBand(t) {
    const x = STUDY[t.id] || (AUDIT[t.id] && (t.opts ? AUDIT[t.id][RL.opt[t.id]] : AUDIT[t.id]));
    return x && x.lo != null && x.hi != null ? { lo: x.lo, hi: x.hi } : null;
  }
  function auditLine(t) {
    const st = STUDY[t.id];
    if (st) return `<b>Late-yardage study replay</b> (2025 weeks 1–18 + 2026 weeks 1–10)<br>2025: <b>${pc(st.yr[0])}</b> ROI<br>2026: <b>${pc(st.yr[1])}</b> ROI<br>Both seasons: <b>${st.rec}</b>, <b>${pc(st.roi)}</b> ROI, 95% interval <b>${pc(st.lo)} to ${pc(st.hi)}</b>.`;
    const a = AUDIT[t.id], x = a && (t.opts ? a[RL.opt[t.id]] : a);
    if (!x) return `The audit did not test this setting (${t.optFmt(RL.opt[t.id])}), so there is no interval for it.`;
    const y = AUDIT_YR[t.id], yr = y && (t.opts ? y[RL.opt[t.id]] : y);
    const seasons = yr ? `2025: <b>${pc(yr[0])}</b> ROI<br>2026: <b>${pc(yr[1])}</b> ROI<br>` : "";
    return `<b>Audit replay</b><br>${seasons}Both seasons: <b>${x.rec}</b>, <b>${pc(x.roi)}</b> ROI, 95% interval <b>${pc(x.lo)} to ${pc(x.hi)}</b>${x.note ? ` (${x.note})` : ""}.`;
  }
  // ---------- Signal info popup (Michael 2026-11-17 redesign) ----------
  // Display only: the same rules, wording taken from each tab's desc() above, shown as gate cards plus a results chart.
  // No rule, threshold, list, score or number changes. Numbers come from the AUDIT / AUDIT_YR / STUDY tables above.
  const SGI_SPRITE = `<svg id="sgi-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="sgi-form" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="22.5" x2="44" y2="22.5" stroke-width="1" stroke-dasharray="2.5 2.5" stroke-opacity=".45"/><g fill="currentColor" fill-opacity=".6" stroke="none"><circle cx="11" cy="27" r="2.7"/><circle cx="17.5" cy="27" r="2.7"/><circle cx="24" cy="27" r="2.7"/><circle cx="30.5" cy="27" r="2.7"/><circle cx="37" cy="27" r="2.7"/></g><circle cx="24" cy="34" r="3.2" fill="currentColor" stroke="none"/><circle cx="31.5" cy="40" r="3.2" fill="currentColor" stroke="none"/><path d="M34.5 40C42 40 44 33 44 25L44 9" stroke-width="2.6"/><path d="M44 5.5L40.2 10M44 5.5L47.8 10" stroke-width="2.6"/></g></symbol>
<symbol id="sgi-streak" viewBox="0 0 48 48"><line x1="5" y1="26" x2="43" y2="26" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/><rect x="8" y="20" width="8" height="22" rx="2" fill="currentColor"/><rect x="20" y="22" width="8" height="20" rx="2" fill="currentColor"/><rect x="32" y="17" width="8" height="25" rx="2" fill="currentColor"/></symbol>
<symbol id="sgi-up" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round"><line x1="7" y1="36" x2="21" y2="36" stroke-opacity=".4" stroke-width="3"/><line x1="27" y1="14" x2="41" y2="14" stroke-width="3.5"/><line x1="24" y1="33" x2="24" y2="19" stroke-width="2.5" stroke-dasharray="1 4"/><path d="M24 17l-4 4.5M24 17l4 4.5" stroke-width="2.5"/></g></symbol>
<symbol id="sgi-upt" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round"><line x1="4" y1="40" x2="13" y2="40" stroke-opacity=".4" stroke-width="3"/><line x1="19" y1="13" x2="42" y2="13" stroke-width="3.5"/><line x1="16" y1="35" x2="16" y2="20" stroke-width="2.5" stroke-dasharray="1 4"/><path d="M16 16.5l-4 4.5M16 16.5l4 4.5" stroke-width="2.5"/></g></symbol>
<symbol id="sgi-down" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round"><line x1="7" y1="12" x2="21" y2="12" stroke-opacity=".4" stroke-width="3"/><line x1="27" y1="36" x2="41" y2="36" stroke-width="3.5"/><line x1="24" y1="15" x2="24" y2="29" stroke-width="2.5" stroke-dasharray="1 4"/><path d="M24 31l-4-4.5M24 31l4-4.5" stroke-width="2.5"/></g></symbol>
<symbol id="sgi-lag" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="12" x2="36" y2="38" stroke-width="3"/><line x1="8" y1="12" x2="36" y2="24" stroke-width="3" stroke-opacity=".45"/><circle cx="8" cy="12" r="3" fill="currentColor"/><path d="M42 25v12M39 28l3-3 3 3M39 34l3 3 3-3" stroke-width="1.8"/></g></symbol>
<symbol id="sgi-swap" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="24" r="5" fill="currentColor" fill-opacity=".25"/><circle cx="36" cy="24" r="5" fill="currentColor"/><path d="M12 15C18 8 30 8 36 15M36 15l-5-1M36 15l1 5"/><path d="M36 33C30 40 18 40 12 33M12 33l5 1M12 33l-1-5"/></g></symbol>
<symbol id="sgi-trail" viewBox="0 0 48 48"><path d="M6 18L16 24L24 30L32 28L42 36V18Z" fill="currentColor" fill-opacity=".25"/><path d="M6 18L16 24L24 30L32 28L42 36" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="6" y1="18" x2="42" y2="18" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></symbol>
<symbol id="sgi-lead" viewBox="0 0 48 48"><path d="M6 30L16 24L24 18L32 20L42 12V30Z" fill="currentColor" fill-opacity=".25"/><path d="M6 30L16 24L24 18L32 20L42 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="6" y1="30" x2="42" y2="30" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/></symbol>
<symbol id="sgi-cal" viewBox="0 0 48 48"><rect x="2" y="2" width="44" height="44" rx="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2 8a6 6 0 0 1 6-6h32a6 6 0 0 1 6 6v3H2z" fill="currentColor" fill-opacity=".35"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.5" stroke-opacity=".5" stroke-dasharray="0 5.333"><line x1="24" y1="18" x2="40.1" y2="18"/><line x1="8" y1="25.5" x2="40.1" y2="25.5"/><line x1="8" y1="33" x2="40.1" y2="33"/><line x1="8" y1="40.5" x2="40.1" y2="40.5"/></g><circle cx="8" cy="25.5" r="4" style="fill:var(--over)"/><path d="M8 27.9V23.1M5.8 25.3l2.2-2.2 2.2 2.2" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--panel)"/><circle cx="8" cy="33" r="3.1" fill="currentColor"/></symbol>
<symbol id="sgi-rise" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="40" x2="43" y2="40" stroke-opacity=".4" stroke-width="1.5"/><polyline points="8,34 24,24 40,10" stroke-width="2.5"/><circle cx="8" cy="34" r="4" fill="currentColor"/><circle cx="24" cy="24" r="4" fill="currentColor"/><circle cx="40" cy="10" r="4" fill="currentColor"/></g></symbol>
<symbol id="sgi-risef" viewBox="0 0 48 48"><rect x="5" y="5" width="38" height="38" rx="4" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.5"/><g stroke="currentColor" stroke-opacity=".3"><line x1="6" y1="14.5" x2="42" y2="14.5"/><line x1="6" y1="24" x2="42" y2="24"/><line x1="6" y1="33.5" x2="42" y2="33.5"/></g><rect x="8" y="33" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="17" y="27" width="7" height="13" rx="1.5" fill="currentColor"/><rect x="26" y="20" width="7" height="20" rx="1.5" fill="currentColor"/><rect x="35" y="13" width="7" height="27" rx="1.5" fill="currentColor"/></symbol>
<symbol id="sgi-sfav" viewBox="0 0 48 48"><g text-anchor="middle" fill="currentColor"><text x="24" y="16" font-size="14" font-weight="500">−10</text><text x="24" y="28" font-size="11" opacity=".6">vs</text><text x="24" y="43" font-size="14" font-weight="500" opacity=".4">+10</text></g><ellipse cx="24" cy="11" rx="16" ry="8.5" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="sgi-sdog" viewBox="0 0 48 48"><g text-anchor="middle" fill="currentColor"><text x="24" y="16" font-size="14" font-weight="500" opacity=".4">−10</text><text x="24" y="28" font-size="11" opacity=".6">vs</text><text x="24" y="43" font-size="14" font-weight="500">+10</text></g><ellipse cx="24" cy="38" rx="16" ry="8.5" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="sgi-sband" viewBox="0 0 48 48"><g text-anchor="middle" fill="currentColor"><text x="24" y="17" font-size="14" font-weight="500">+3</text><text x="24" y="28" font-size="11" opacity=".6">to</text><text x="24" y="42" font-size="14" font-weight="500">+6.5</text></g><rect x="5" y="3" width="38" height="42" rx="10" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
<symbol id="sgi-field" viewBox="0 0 48 48"><rect x="5" y="10" width="38" height="28" rx="4" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.5"/><g stroke="currentColor" stroke-opacity=".35"><line x1="16" y1="11" x2="16" y2="37"/><line x1="27" y1="11" x2="27" y2="37"/><line x1="38" y1="11" x2="38" y2="37"/></g><line x1="11" y1="14" x2="11" y2="34" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/><circle cx="11" cy="24" r="3" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="14" y1="24" x2="23" y2="24"/><path d="M24 24l-4-3.5M24 24l-4 3.5"/><line x1="29" y1="24" x2="40" y2="24" stroke-opacity=".4" stroke-width="2" stroke-dasharray="2 3"/></g></symbol>
<symbol id="sgi-fluke" viewBox="0 0 48 48"><line x1="6" y1="40" x2="42" y2="40" stroke="currentColor" stroke-opacity=".5" stroke-width="1.5"/><rect x="10" y="30" width="11" height="10" rx="2" fill="currentColor" fill-opacity=".4"/><rect x="28" y="9" width="11" height="31" rx="2" fill="currentColor"/><line x1="6" y1="22" x2="42" y2="22" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2.5"/><path d="M33.5 15l-3 6h5l-3 6" fill="none" style="stroke:var(--sgi-bg)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></symbol>
<symbol id="sgi-nolong" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round"><rect x="6" y="19" width="10" height="10" rx="2" fill="currentColor"/><rect x="18" y="19" width="8" height="10" rx="2" fill="currentColor"/><rect x="28" y="19" width="14" height="10" rx="2" stroke-width="1.8" stroke-dasharray="3 2" stroke-opacity=".6"/><line x1="30" y1="36" x2="40" y2="12" stroke-width="2.5"/></g></symbol>
<symbol id="sgi-half" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="24" cy="24" r="15"/><path d="M24 24V9A15 15 0 0 0 24 39Z" fill="currentColor" fill-opacity=".35" stroke="none"/><path d="M24 15v9l6 4"/></g></symbol>
<symbol id="sgi-beat" viewBox="0 0 48 48"><line x1="4" y1="34" x2="44" y2="34" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 3"/><rect x="25" y="8" width="17" height="32" rx="2.5" fill="currentColor"/><rect x="6" y="28" width="10" height="12" rx="2" fill="currentColor" fill-opacity=".4"/><path d="M20.5 10v22M17.5 13l3-3 3 3M17.5 29l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><text x="33.5" y="28" text-anchor="middle" font-size="12" font-weight="500" style="fill:var(--sgi-bg)">3x</text></symbol>
<symbol id="sgi-u20" viewBox="0 0 48 48"><line x1="4" y1="38" x2="44" y2="38" stroke="currentColor" stroke-width="1.5" stroke-opacity=".5"/><line x1="35" y1="10" x2="35" y2="38" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/><rect x="4" y="19" width="27" height="15" rx="2.5" fill="currentColor"/><text x="17.5" y="30" text-anchor="middle" font-size="11" font-weight="500" style="fill:var(--sgi-bg)">&lt;20</text></symbol>
</defs></svg>`;
  // Gate pieces shared by the late-yardage rules (wording follows LY_* above).
  const GP = {
    SHORT: { i: "field", c: "gr", l: "Short-catch type", s: "Under 10.6 yards per catch since 2024 · 20+ catches" },
    PREV: { i: "cal", c: "bl", l: "Last Week Over, 40+", s: "Receiving yards in his previous game" },
    UP: { i: "up", c: "pu", l: "Line raised", s: "Higher than that game's line" },
    UPP: (n) => ({ i: "upt", c: "pu", x: `${n}%+`, l: `Line raised ${n}%+`, s: "vs that game's line" }),
    NOLONG: { i: "nolong", c: "am", l: "Over without longest catch", s: "Still Over that line without it" },
    FH: { i: "half", c: "bl", l: "First half beat the line", s: "First-half yards alone were above that game's line" },
    YPC: { i: "fluke", c: "am", l: "Last game was a YPC fluke", s: "Yards per catch at least 1.5× his career average" },
    BL: { i: "beat", c: "bl", l: "Beat his line by 200%+", s: "At least 3 times that game's line" },
    U20: { i: "u20", c: "am", l: "Longest catch under 20 yds", s: "In that game" },
  };
  const RAISE = { i: "up", c: "pu", l: "Line raised", s: "Higher than that game's line" };
  const SGP = {
    qbr1: { bet: "Under · QB rush yds", g: () => [{ i: "form", c: "bl", l: "High rushing line", s: "Line is 25+ rush yds" }, { i: "streak", c: "bl", l: "Really runs", s: "Averaged 25+ rush yds over his last 3 games played" }] },
    qbr2: { bet: "Under · QB rush yds", g: () => [{ i: "up", c: "pu", t: `${RL.opt.qbr2}+`, tp: "br", l: `Line up ${RL.opt.qbr2}+ yds`, s: "vs his previous game's line · toggle: 5 or 7" }] },
    qbr4: { bet: "Under · QB rush yds", g: () => [{ i: "form", c: "bl", l: "High rushing line", s: `Line is ${RL.opt.qbr4}+ rush yds · toggle: 25 or 40` }] },
    qbch: { bet: "Under · rec yds · WR TE", g: () => [{ i: "swap", c: "am", l: "New starting QB", s: "Not the QB who started his team's last game" }] },
    sc1: { bet: "Under · rec yds · WR TE", g: () => [{ i: "trail", c: "gr", l: "Team was trailing", s: "Down 7+ on half or more of its plays, last game" }, { i: "cal", c: "bl", l: "Last Week Over", s: "Receiving yards" }, RAISE] },
    sc2: { bet: "Under · rush yds · RB", g: () => [{ i: "lead", c: "gr", l: "Team was leading", s: "Up 7+ on half or more of its plays, last game" }, { i: "cal", c: "bl", l: "Last Week Over", s: "Rushing yards" }, RAISE] },
    cm1te: { bet: "Under · rec yds · TE", g: () => [{ i: "down", c: "pu", t: "15+", tp: "tr", l: "QB pass line cut 15+", s: "vs last week" }, { i: "lag", c: "am", l: "Receiver lines lag 10+", s: "QB's line fell 10+ more than the receivers' lines combined" }] },
    cm120: { bet: "Under · rec yds · WR TE RB", g: () => [{ i: "down", c: "pu", t: "20+", tp: "tr", l: "QB pass line cut 20+", s: "vs last week" }, { i: "lag", c: "am", l: "Receiver lines lag 10+", s: "QB's line fell 10+ more than the receivers' lines combined" }] },
    l9: { bet: "Under · rec yds · WR", g: () => [{ i: "streak", c: "bl", l: "Three straight Overs", s: "His last 3 games played, receiving yards" }] },
    l10: { bet: "Under · receptions · WR", g: () => [{ i: "rise", c: "bl", l: "Receptions rising", s: "Up in each of his last 3 games played" }] },
    s03: { bet: "Under · rec yds · WR", g: () => [{ i: "risef", c: "bl", l: "Yards rising", s: "Strictly higher in each of his last 3 games played" }] },
    sp1: { bet: "Under · rec yds · WR TE RB", g: () => [{ i: "sdog", c: "gr", l: "Team underdog by 10+", s: "Opponent favored by 10 or more" }] },
    sp2: { bet: "Under · receptions · WR TE RB", g: () => [{ i: "sdog", c: "gr", l: "Team underdog by 10+", s: "Opponent favored by 10 or more" }] },
    sp3: { bet: "Over · QB pass yds", g: () => [{ i: "sfav", c: "gr", l: "Team favored by 10+", s: "Spread of 10 or more in his team's favor" }] },
    sp4: { bet: "Under · QB pass yds", g: () => [{ i: "sdog", c: "gr", l: "Team underdog by 10+", s: "Opponent favored by 10 or more" }] },
    sp5: { bet: "Under · rushing · QB RB", g: () => [{ i: "sband", c: "gr", l: "Underdog by 3 to 6.5", s: "Opponent favored by 3 to 6.5" }] },
    sy25: { bet: "Under · rec yds · WR TE RB", g: () => [GP.SHORT, GP.PREV, GP.UPP(25)] },
    synl: { bet: "Under · rec yds · WR TE RB", g: () => [GP.SHORT, GP.PREV, GP.UP, GP.NOLONG] },
    syypc: { bet: "Under · rec yds · WR TE RB", g: () => [GP.SHORT, GP.PREV, GP.UP, GP.YPC] },
    fhr30: { bet: "Under · rec yds · WR TE RB", g: () => [GP.PREV, GP.FH, GP.UPP(30)] },
    fhnl: { bet: "Under · rec yds · WR TE RB", g: () => [GP.PREV, GP.UP, GP.FH, GP.NOLONG] },
    bl200: { bet: "Under · rec yds · WR TE RB", g: () => [GP.PREV, GP.UP, GP.BL] },
    nlu20: { bet: "Under · rec yds · WR TE RB", g: () => [GP.PREV, GP.UP, GP.U20] },
  };
  // Positions in the popup header, best ROI first (Michael 2026-11-18). The last one is the position to drop first and is not bold.
  // Order = each position's historical-replay ROI (2025 wk 2-18 + 2026 wk 2-10); see claude/late-yardage-by-position-2026-11-17.md
  // and claude/signals-by-position-2026-11-18.md. Display only: no rule, list, score or number changes.
  const POS_ORDER = {
    sy25: ["TE", "RB", "WR"], synl: ["WR", "TE", "RB"], syypc: ["WR", "TE", "RB"], fhr30: ["RB", "TE", "WR"], fhnl: ["WR", "TE", "RB"],
    bl200: ["TE", "WR", "RB"], nlu20: ["RB", "TE", "WR"],
    sc1: ["TE", "WR"], qbch: ["TE", "WR"], cm120: ["TE", "RB", "WR"], sp1: ["TE", "RB", "WR"], sp2: ["TE", "WR", "RB"], sp5: ["RB", "QB"],
  };
  function betText(id, sg) {
    const rest = sg.bet.slice(sg.bet.indexOf(" ") + 1), po = POS_ORDER[id];
    if (!po) return esc(rest);
    const base = rest.replace(/(\s·\s)?(\s?\b(WR|TE|RB|QB)\b)+$/, "");
    return `${esc(base)} · ${po.map((x, i) => (i < po.length - 1 ? `<b class="sgp-pb">${x}</b>` : x)).join(" ")}`;
  }
  // Results numbers for a signal (null when the audit did not test this setting).
  function sgpData(t) {
    const st = STUDY[t.id];
    if (st) return { win: "2025 wk 1–18 + 2026 wk 1–10", rec: st.rec, roi: st.roi, lo: st.lo, hi: st.hi, yr: st.yr };
    const a = AUDIT[t.id], x = a && (t.opts ? a[RL.opt[t.id]] : a);
    if (!x) return null;
    const y = AUDIT_YR[t.id], yr = y && (t.opts ? y[RL.opt[t.id]] : y);
    return { win: "2025 wk 1–18 + 2026 wk 1–9", rec: x.rec, roi: x.roi, lo: x.lo, hi: x.hi, yr: yr || null, note: x.note };
  }
  // Results chart: one shared, zero-centered axis (±40, widened in steps of 20 only if a value needs it).
  function sgpResults(t) {
    const d = sgpData(t);
    if (!d) return `<div class="sgp-res"><p class="small muted">${esc(`The audit did not test this setting (${t.optFmt ? t.optFmt(RL.opt[t.id]) : ""}), so there is no interval for it.`)}</p></div>`;
    const vals = [d.roi, d.lo, d.hi].concat(d.yr || []);
    const A = Math.max(40, Math.ceil(Math.max(...vals.map((v) => Math.abs(v))) / 20) * 20);
    const P = (v) => ((v + A) / (2 * A)) * 100;
    const cl = (p, a, b) => Math.min(b, Math.max(a, p));
    const col = (v) => (v >= 0 ? "var(--over)" : "var(--under)");
    const centers = d.yr ? [28, 68, 112] : [28];
    const tc = centers[centers.length - 1];
    const plotH = tc + 36, boxH = plotH + 22;
    const boxW = Math.min(460, Math.max(280, window.innerWidth - 32)) - 28, W = boxW - 54;
    const wide = ((P(d.hi) - P(d.lo)) / 100) * W >= 116;
    let h = `<div class="sgp-plot" style="height:${boxH}px"><div class="sgp-area" style="height:${plotH}px">`;
    for (const k of [-A / 2, A / 2]) h += `<i class="sgp-grid" style="left:${P(k)}%"></i>`;
    h += `<i class="sgp-zero" style="left:50%"></i>`;
    (d.yr || []).forEach((v, i) => {
      const c = centers[i];
      h += `<i class="sgp-dot" style="left:${P(v)}%;top:${c}px;background:${col(v)}"></i><span class="sgp-lab" style="left:${cl(P(v), 9, 91)}%;top:${c - 26}px">${pc(v)}</span>`;
    });
    h += `<i class="sgp-wh" style="left:${P(d.lo)}%;width:${P(d.hi) - P(d.lo)}%;top:${tc - 1}px"></i><i class="sgp-cap" style="left:${P(d.lo)}%;top:${tc - 6}px"></i><i class="sgp-cap" style="left:${P(d.hi)}%;top:${tc - 6}px"></i>`;
    h += `<i class="sgp-dia" style="left:${P(d.roi)}%;top:${tc}px;background:${col(d.roi)}"></i><span class="sgp-lab" style="left:${cl(P(d.roi), 9, 91)}%;top:${tc - 28}px">${pc(d.roi)}</span>`;
    if (wide) {
      h += `<span class="sgp-lab sgp-sm" style="left:${cl(P(d.lo), 7, 93)}%;top:${tc + 14}px">${pc(d.lo)}</span><span class="sgp-lab sgp-sm" style="left:${cl(P(d.hi), 7, 93)}%;top:${tc + 14}px">${pc(d.hi)}</span>`;
    } else {
      h += `<span class="sgp-lab sgp-sm" style="left:${cl(P(d.roi), 22, 78)}%;top:${tc + 14}px">${pc(d.lo)} to ${pc(d.hi)}</span>`;
    }
    h += `</div>`;
    (d.yr ? ["2025", "2026"] : []).forEach((y, i) => { h += `<span class="sgp-row" style="top:${centers[i] - 8}px">${y}</span>`; });
    h += `<span class="sgp-row sgp-tot" style="top:${tc - 8}px">Total</span><span class="sgp-row sgp-sm" style="top:${tc + 14}px">95% CI</span>`;
    h += `<div class="sgp-axis">${[-A, -A / 2, 0, A / 2, A].map((k) => `<span style="left:${P(k)}%">${k > 0 ? "+" : k < 0 ? "−" : ""}${Math.abs(k)}${k === -A || k === A ? "%" : ""}</span>`).join("")}</div></div>`;
    return `<div class="sgp-res"><div class="muted small">${esc(d.win)}</div><div class="sgp-hero"><b style="color:${col(d.roi)}">${pc(d.roi)}</b><b>${esc(d.rec)}</b></div>${h}</div>`;
  }
  function openInfo(id) {
    closePop();
    const t = TABS.find((x) => x.id === id); if (!t) return;
    const sg = SGP[id];
    const ov = document.createElement("div");
    ov.id = "scr-ov"; ov.className = "share-ov";
    if (!document.getElementById("sgi-sprite")) document.body.insertAdjacentHTML("beforeend", SGI_SPRITE);
    const gates = sg.g();
    const lead = gates.length === 1 ? "Must pass 1 gate" : gates.length === 2 ? "Must pass both gates" : `Must pass all ${gates.length} gates`;
    const rows = gates.map((g, i) => `<div class="sgp-g"><div class="sgp-t ${g.c}"><svg viewBox="0 0 48 48" aria-hidden="true"><use href="#sgi-${g.i}"/></svg>${g.t ? `<span class="sgp-tg sgp-${g.tp}">${esc(g.t)}</span>` : ""}${g.x ? `<span class="sgp-sd">${esc(g.x)}</span>` : ""}<span class="sgp-n">${i + 1}</span></div><div><div class="sgp-l">${esc(g.l)}</div><div class="small muted">${esc(g.s)}</div></div></div>`).join("");
    const bulb = `<svg class="sgp-bulb" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    ov.innerHTML = `<div class="share-box nw-box sgp" role="dialog" aria-label="${esc(t.label)} - ${esc(t.short ? t.short() : t.title)}">
      <div class="sgp-h"><div><div class="sgp-code">${esc(t.label)}</div><div class="small muted"><span class="chip rl-side ${sg.bet.startsWith("Over") ? "over" : "under"}" style="margin-left:0">${sg.bet.split(" ")[0]}</span> ${betText(id, sg)}</div></div><button class="nw-x" aria-label="Close">✕</button></div>
      <div class="small muted sgp-lead">${lead}</div>
      <div class="sgp-gs${gates.length > 1 ? " chain" : ""}">${rows}</div>
      ${id === "syypc" ? `<div class="small muted sgp-why">${bulb}<span>Fluke long catches tend not to repeat.</span></div>` : ""}
      ${sgpResults(t)}
      <details class="sgp-how"><summary>How we measured this</summary><p class="small">${auditLine(t)}</p>
      <p class="small"><b>What the interval means:</b> the range of ROI you would plausibly get if the same rule were run on other weeks (made by resampling whole weeks 4,000 times). If it reaches below 0%, the result could be luck.${STUDY[t.id] ? "" : " It does not account for picking the best rules out of many tried, so it is likely optimistic."}</p></details></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest(".nw-x") || e.target.closest("a")) closePop(); });
  }
  const infoHandler = (e) => {
    const b = e.target.closest && e.target.closest("[data-rinfo]"); if (!b) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation();
    openInfo(b.dataset.rinfo);
  };
  document.addEventListener("click", infoHandler, true);
  document.addEventListener("keydown", infoHandler, true);
  // ---------- Signals (Michael 2026-11-10): the old Leads + Leads Analysis, redone as one page ----------
  // Top: how every signal is doing (Last week / Last month / This season), ranked by ROI, each with a run chart of units.
  // Tap a signal (or several) to see its run chart and week-by-week record, and to narrow the players below to those who fit
  // ALL the picked signals. Below: this week's players ranked by how many signals fit them, with FanDuel checkboxes.
  // Week is the smallest level shown (no per-game split). Scoring is unchanged: same analyze() as before.
  // Multi-select (Michael 2026-11-12): off on the Signals page, since those signals are already combinations; still on for the Indicators page.
  const multiSelect = () => SGPAGE === "ind";
  Object.assign(RL, { sigs: [], scope: "season", q: "", opt: { ...OPT0 } });
  const BE = 52.38; // break-even hit rate (%) at -110
  const memo = { d: null, m: new Map() };
  function AN(tab, wk) {
    if (memo.d !== D) { memo.d = D; memo.m = new Map(); }
    const k = tab + "|" + wk + "|" + RL.opt.qbr2 + "|" + RL.opt.qbr4;
    if (!memo.m.has(k)) memo.m.set(k, analyze(tab, wk));
    return memo.m.get(k);
  }
  const nm = (x) => !RL.q || x.c.p.name.toLowerCase().includes(RL.q.trim().toLowerCase());
  const roiTxt = (s) => (s.roi == null ? "—" : `${s.roi >= 0 ? "+" : "−"}${Math.abs(s.roi).toFixed(1)}% ROI`);
  const curWk = () => (typeof defaultWeek === "function" ? defaultWeek() : D.current_week);
  const SCOPES = [["last", "Prior week"], ["month", "This month"], ["season", "This season"]];
  // This month = from the 1st of the current month (by kickoff date, Central time)
  const monthCut = () => ctDate(new Date()).slice(0, 8) + "01";
  const inMonth = (ko) => !!ko && ctDate(new Date(ko)) >= monthCut();
  function inScope(x) {
    if (SGPAGE !== "ind") return true; // Signals page: this season only (no time buttons)
    if (RL.scope === "last") return x.r.wk === curWk() - 1;
    if (RL.scope === "month") return inMonth(x.r.ko);
    return true;
  }
  const scopeName = () => (SCOPES.find((x) => x[0] === RL.scope) || SCOPES[2])[1].toLowerCase();
  function sigRec(t) {
    const by = laWeeks().slice().reverse().map((w) => ({ w, list: AN(t.id, w) }));
    const all = by.flatMap((x) => x.list);
    return { by, all, s: tally(all) };
  }
  const bkey = (x) => `${x.p.id}|${x.mid}|${x.r.gid}|${x.side}`;
  // bets for the picked signals: one signal = its bets; several = only bets that fit every picked signal (same player, stat, game, side)
  function betsFor(ts) {
    const lists = ts.map((t) => sigRec(t).all);
    if (lists.length === 1) return lists[0];
    let keep = new Set(lists[0].map(bkey));
    for (const l of lists.slice(1)) { const k2 = new Set(l.map(bkey)); keep = new Set([...keep].filter((k) => k2.has(k))); }
    return lists[0].filter((x) => keep.has(bkey(x)));
  }
  const byWeek = (bets) => laWeeks().slice().reverse().map((w) => ({ w, list: bets.filter((x) => x.r.wk === w) }));
  // Tile chart (Michael 2026-11-12): a dot for each week's ROI plus a line for the running (cumulative) ROI, with real axes:
  // weeks (W#) along the bottom, ROI % up the side. Weeks with no bets get no dot; the cumulative line carries through.
  function spark(by, band) {
    let W = 0, L = 0, U = 0; const pts = by.map(({ w, list }) => {
      const s = tally(list); U += s.U; W += s.W + s.L;
      return { w, n: s.n, roi: s.n ? s.roi : null, cum: W ? (100 * U) / W : null };
    });
    if (!pts.some((q) => q.n)) return `<div class="sg-nospark muted small">no graded bets</div>`;
    const w = 170, h = 70, l = 30, r = 11, tp = 6, bt = 13, n = pts.length, base = h - bt;
    const vals = pts.flatMap((q) => [q.roi, q.cum]).filter((v) => v != null).concat(0, band ? [band.lo, band.hi] : []);
    let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 20) { mx += 10; mn -= 10; }
    const rg = mx - mn, X = (i) => (n < 2 ? (l + w - r) / 2 : l + (i * (w - l - r)) / (n - 1)), Y = (v) => tp + ((mx - v) / rg) * (base - tp);
    const fmt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`;
    const ticks = []; let prevY = -99;
    for (const v of [...new Set([mx, 0, mn])].sort((a, b) => b - a)) { if (Y(v) - prevY >= 11) { ticks.push(v); prevY = Y(v); } }
    const every = n > 9 ? 2 : 1, cp = pts.map((q, i) => [i, q]).filter(([, q]) => q.cum != null);
    const last = cp.length ? cp[cp.length - 1][1].cum : 0, col = last >= 0 ? "--over" : "--under";
    return `<svg class="sg-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly ROI and running ROI by week, now ${fmt(last)}${band ? `. Shaded band: 95% ROI interval ${fmt(band.lo)} to ${fmt(band.hi)}` : ""}">
      <g class="sg-ax"><line x1="${l}" x2="${l}" y1="${tp}" y2="${base}"/><line x1="${l}" x2="${w - r}" y1="${base}" y2="${base}"/>
      ${ticks.map((v) => `<line class="sg-gl" x1="${l}" x2="${w - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${l - 3}" y="${(Y(v) + 2.8).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${pts.map((q, i) => ((n - 1 - i) % every ? "" : `<text x="${X(i).toFixed(1)}" y="${h - 3}" text-anchor="middle">W${q.w}</text>`)).join("")}</g>
      ${band ? `<rect class="sg-band" x="${l}" y="${Y(band.hi).toFixed(1)}" width="${w - r - l}" height="${Math.max(1, Y(band.lo) - Y(band.hi)).toFixed(1)}"><title>95% ROI interval ${fmt(band.lo)} to ${fmt(band.hi)}</title></rect>${(() => { const yh = Y(band.hi), yl = Y(band.lo), tall = yl - yh >= 17; return `<g class="sg-bl"><text x="${l + 2}" y="${Math.max(tp + 6, tall ? yh + 6.5 : yh - 1.5).toFixed(1)}">${fmt(band.hi)}</text><text x="${l + 2}" y="${Math.min(base - 1.5, tall ? yl - 1.5 : yl + 6.5).toFixed(1)}">${fmt(band.lo)}</text></g>`; })()}` : ""}
      <line x1="${l}" x2="${w - r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke:var(--line)" stroke-dasharray="3 3"/>
      <path d="${cp.map(([i, q], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(q.cum).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(${col})" stroke-width="1.6" stroke-linejoin="round"/>
      ${pts.filter((q) => q.n).map((q) => `<circle cx="${X(pts.indexOf(q)).toFixed(1)}" cy="${Y(q.roi).toFixed(1)}" r="2.3" style="fill:var(${q.roi >= 0 ? "--over" : "--under"})"><title>Week ${q.w}: ${fmt(q.roi)} ROI (${q.n} bets) · running ${fmt(q.cum)}</title></circle>`).join("")}</svg>`;
  }
  function tileHtml(t, st, locked) {
    const on = RL.sigs.includes(t.id), s = st.s, cls = s.n ? (s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : "") : "";
    const cnt = sgFilt(compute(t.id)).length + computeLiveCount(t.id) + doneBets(t.id).length; // this week's players: upcoming + in progress + completed
    const tg = t.opts ? `<span class="sg-tg" role="group" aria-label="${esc(t.label)} threshold">${t.opts.map((v) => `<button type="button" class="${RL.opt[t.id] === v ? "on" : ""}" data-sgopt="${t.id}:${v}" ${locked ? "tabindex=\"-1\"" : ""}>${t.optFmt(v)}</button>`).join("")}</span>` : "";
    return `<div class="sg-cell${locked ? " sg-locked" : ""}"${locked ? ' aria-hidden="true"' : ""}><button type="button" class="sg-tile ${on ? "on" : ""}" data-sig="${t.id}" aria-pressed="${on}" ${locked ? "tabindex=\"-1\"" : ""}>
      <div class="sg-hd"><b>${esc(t.label)}</b><span class="rinfo" role="button" tabindex="0" data-rinfo="${t.id}" aria-label="About ${esc(t.label)}" ${locked ? "tabindex=\"-1\"" : ""}>i</span></div>
      <div class="sg-r2"><span class="sg-roi ${cls}">${s.n ? `${s.roi > 0 ? "+" : s.roi < 0 ? "−" : ""}${Math.abs(s.roi).toFixed(1)}%` : "—"}</span><span class="small sg-st">${s.n ? recTxt(s) : `<span class="muted">no bets</span>`}<br><b>${cnt}</b> ${tnfOn() ? "TNF" : (sgView() === "last" ? "last" : sgView() === "next" ? "next" : "this") + " wk"}</span></div>
      ${st.by ? spark(st.by, roiBand(t)) : ""}</button>${tg}</div>`;
  }
  const sideTxt = (t) => (t.side === "over" ? "Over" : t.side === "under" ? "Under" : "Over / Under");
  // Toggle default (Michael 2026-11-12): a signal with a toggle (QB-R2, QB-R4) opens on whichever setting has the larger ROI so far this season.
  // Worked out once when the page first draws; a tap on the toggle then overrides it.
  function withOpt(t, v, fn) { const old = RL.opt[t.id]; RL.opt[t.id] = v; try { return fn(); } finally { RL.opt[t.id] = old; } }
  function bestOpt(t, tallyOf) {
    let best = t.opts[0], bestRoi = -Infinity;
    for (const v of t.opts) { const r = withOpt(t, v, () => tallyOf(t).roi); if (r != null && r > bestRoi) { best = v; bestRoi = r; } }
    return best;
  }
  const seasonTally = (t) => tally(sigRec(t).all);
  // Toggles that keep their OPT0 default instead of auto-picking the best season setting (Michael 2026-11-16: QB-R4 opens on 25+, not 40+).
  const PINNED_OPT = { qbr4: true };
  function initOpts(tabs) {
    RL.optInit = RL.optInit || {};
    if (RL.optInit[SGPAGE] || !laWeeks().length) return;
    RL.optInit[SGPAGE] = true; RL.optTouched = RL.optTouched || {};
    for (const t of tabs) if (t.opts && !RL.optTouched[t.id] && !PINNED_OPT[t.id]) RL.opt[t.id] = bestOpt(t, seasonTally);
  }
  // Card order (Michael 2026-11-12): changes once a week, not as the toggles are tapped or games finish. Cards are ranked on ROI through
  // the last completed week (before the upcoming-lines week), using each toggle's better setting, so tapping a toggle never reorders them.
  const rankTally = (t) => tally(sigRec(t).all.filter((x) => x.r.wk < curWk()));
  function rankStat(t) { return t.opts ? withOpt(t, bestOpt(t, rankTally), () => rankTally(t)) : rankTally(t); }
  function topSection(tabs) {
    // Chart window: Prior week = just that week; This month / This season = every week in the window.
    const scopeNow = SGPAGE === "ind" ? RL.scope : "season";
    const mWeeks = scopeNow === "month" ? new Set(Object.values(D.games).filter((g) => g.final && inMonth(g.ko)).map((g) => g.wk)) : null;
    const rows = tabs.map((t) => {
      const r = sigRec(t), sc = r.all.filter(inScope);
      const by = scopeNow === "last" ? r.by.filter((x) => x.w === curWk() - 1) : scopeNow === "month" ? r.by.filter((x) => mWeeks.has(x.w)).map((x) => ({ w: x.w, list: x.list.filter(inScope) })) : r.by;
      return { t, by, s: tally(sc) };
    });
    const rk = new Map(tabs.map((t) => [t.id, rankStat(t)]));
    rows.sort((a, b) => { const x = rk.get(a.t.id), y = rk.get(b.t.id); return (y.n ? 1 : 0) - (x.n ? 1 : 0) || (y.roi ?? -1e9) - (x.roi ?? -1e9) || a.t.n - b.t.n; });
    // Michael 2026-11-13: every Signals tile is open to everyone; no sign-in gate. (FREE_TILES / placeGate / the sign-in box stay in the file, unused.)
    const gate = false;
    RL.unlocked = new Set(rows.filter((x, i) => !gate || i < FREE_TILES).map((x) => x.t.id));
    let h = `${SGPAGE === "ind" ? `<div class="sg-scope" role="tablist" aria-label="Time">${SCOPES.map(([k, l]) => `<button class="gchip ${RL.scope === k ? "on" : ""}" data-rscope="${k}">${l}</button>`).join("")}</div>` : ""}<div class="sg-wrap"><div class="sg-grid">${rows.map((x) => tileHtml(x.t, x, !RL.unlocked.has(x.t.id))).join("")}</div>`;
    if (gate && rows.length > FREE_TILES) h += `<div class="sg-gate" id="sg-gate">${ACCT() ? ACCT().googleBlock("sg") : ""}</div>`;
    return h + `</div>`;
  }
  const ACCT = () => window.STIX_ACCOUNT;
  const FREE_TILES = 3;
  // Put the sign-in box over the faded tiles (they share the grid with the free ones, so it is placed after drawing).
  function placeGate() {
    const g = document.getElementById("sg-gate"), grid = document.querySelector("#rl .sg-grid"); if (!g || !grid) return;
    const cells = [...grid.querySelectorAll(".sg-locked")]; if (!cells.length) return;
    const gr = grid.getBoundingClientRect(), free = [...grid.querySelectorAll(".sg-cell:not(.sg-locked)")].map((c) => c.getBoundingClientRect().bottom - gr.top);
    // centre the box on the faded tiles below the last free one, so it never sits on a free tile
    const top = Math.max(Math.max(0, ...free), Math.min(...cells.map((c) => c.getBoundingClientRect().top - gr.top))), bot = Math.max(...cells.map((c) => c.getBoundingClientRect().bottom - gr.top));
    g.style.top = Math.max(0, (top + bot) / 2 - g.offsetHeight / 2) + "px";
    try { if (ACCT() && ACCT().bindGoogle) ACCT().bindGoogle("sg"); } catch (e) { console.error("sign-in button failed", e); }
  }
  window.addEventListener("resize", () => { try { placeGate(); } catch (e) { /* ignore */ } });
  function sigChart(by) {
    let W = 0, L = 0; const pts = [];
    for (const { w, list } of by) {
      const s = tally(list); W += s.W; L += s.L;
      if (W + L) pts.push({ w, h: (100 * W) / (W + L), wk: s.n ? (100 * s.W) / s.n : null, s });
    }
    if (!pts.length) return "";
    const w = 320, h = 170, l = 34, r = 8, tp = 10, bt = 24;
    const vals = pts.map((q) => q.h).concat(pts.filter((q) => q.wk != null).map((q) => q.wk), [BE]);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
    const X = (i) => l + (pts.length < 2 ? (w - l - r) / 2 : (i * (w - l - r)) / (pts.length - 1));
    const Y = (v) => tp + ((hi - v) / (hi - lo)) * (h - tp - bt);
    const stp = hi - lo > 60 ? 20 : 10, grid = [];
    for (let v = lo; v <= hi; v += stp) grid.push(`<line x1="${l}" x2="${w - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--line)"/><text x="${l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" style="fill:var(--muted)">${v}%</text>`);
    const path = pts.map((q, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(q.h).toFixed(1)}`).join(" "), last = pts[pts.length - 1], every = pts.length > 12 ? 2 : 1;
    return `<svg class="sg-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Running hit rate by week. Now ${last.h.toFixed(1)}%.">
      ${grid.join("")}
      <line x1="${l}" x2="${w - r}" y1="${Y(BE).toFixed(1)}" y2="${Y(BE).toFixed(1)}" stroke="#d29922" stroke-dasharray="4 3"/>
      <text x="${w - r}" y="${(Y(BE) - 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#d29922">break-even 52.4%</text>
      <path d="${path}" fill="none" style="stroke:var(--accent)" stroke-width="2" stroke-linejoin="round"/>
      ${pts.filter((q) => q.wk != null).map((q) => `<circle cx="${X(pts.indexOf(q)).toFixed(1)}" cy="${Y(q.wk).toFixed(1)}" r="3" style="fill:var(${q.wk >= BE ? "--over" : "--under"})"><title>Week ${q.w}: ${recTxt(q.s)} (${q.wk.toFixed(0)}%) that week</title></circle>`).join("")}
      <circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last.h).toFixed(1)}" r="4" style="fill:var(--accent)"/>
      <text x="${Math.min(X(pts.length - 1), w - r - 2).toFixed(1)}" y="${(Y(last.h) - 8).toFixed(1)}" text-anchor="end" font-size="11" font-weight="700" style="fill:var(--ink)">${last.h.toFixed(1)}%</text>
      ${pts.map((q, i) => (i % every ? "" : `<text x="${X(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" style="fill:var(--muted)">W${q.w}</text>`)).join("")}</svg>`;
  }
  // Record panel for the picked signal(s): summary, running hit rate, week by week (week = smallest level)
  function recordPanel(ts) {
    const bets = betsFor(ts), by = byWeek(bets), key0 = ts.map((t) => t.id).join("+");
    const many = ts.length > 1, title = ts.map((t) => esc(t.label)).join(" + ");
    let h = `<div class="panel sg-rec"><div class="body"><div class="sg-rec-h"><b>${many ? `Fits all of: ${title}` : title}</b> <button type="button" class="linkbtn" data-sgclear>Clear</button></div>`;
    if (!bets.length) return h + `<p class="muted small">${many ? "No graded bets fit all of these signals (or they point opposite ways)." : "No graded bets yet."}</p></div></div>`;
    const s = tally(bets), cls = s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : "";
    const gapSort = ts.length === 1 && ts[0].cm;
    const sortK = (a, b) => (gapSort ? (b.gap ?? -1e9) - (a.gap ?? -1e9) : 0) || (a.r.ko || "").localeCompare(b.r.ko || "") || a.r.gid.localeCompare(b.r.gid) || a.p.name.localeCompare(b.p.name) || a.mid.localeCompare(b.mid);
    const sec = (k, t2, g) => (g.length ? `<h3 class="la-h ${k}">${t2} (${g.length})</h3><div class="panel rlist">${g.map(laRow).join("")}</div>` : "");
    const weeks = by.slice().reverse().filter((x) => x.list.length).map(({ w, list }) => {
      const st = tally(list), key = `${key0}|${w}`, sorted = list.slice().sort(sortK);
      return `<details class="la-wk" data-lawk="${key}" ${LA.open.has(key) ? "open" : ""}><summary><span class="la-wk-t">Week ${w}</span><span class="muted small">${recTxt(st)} · ${st.n ? unitsTxt(st.U) : "push"}${st.roi == null ? "" : ` · ${roiTxt(st)}`}</span></summary>
        ${sec("hit", "Hits", sorted.filter((x) => x.out === "hit"))}${sec("miss", "Misses", sorted.filter((x) => x.out === "miss"))}${sec("push", "Pushes", sorted.filter((x) => x.out === "push"))}</details>`;
    }).join("");
    return h + `${many ? `<div class="la-sum"><div><span class="muted small">Season</span><b>${recTxt(s)}</b></div><div><span class="muted small">Hit rate</span><b>${s.hit == null ? "—" : s.hit.toFixed(1) + "%"}</b></div><div><span class="muted small">Units</span><b class="${cls}">${s.n ? unitsTxt(s.U) : "—"}</b></div><div><span class="muted small">ROI</span><b>${s.roi == null ? "—" : `${s.roi > 0 ? "+" : s.roi < 0 ? "−" : ""}${Math.abs(s.roi).toFixed(1)}%`}</b></div></div>` : ""}
      <details class="sg-weeks" data-wopen ${RL.wopen ? "open" : ""}><summary>Week by week (${by.filter((x) => x.list.length).length} weeks)</summary>${weeks}</details></div></div>`;
  }
  const BP = { id: "bp", n: 0, side: "mixed", title: "Players" };
  // Players who fit the picked signals. live=false: games not started yet (the main list). live=true: games that have started but
  // are not final (the "Game in progress" list). Same rules and sorting either way; only the games looked at differ.
  // The week in play = the earliest week that still has a game not final (all final: the last week). Its finished games feed the
  // "Completed" list and stay in the signal cards' "this wk" counts, so the count doesn't shrink as games end.
  function sigWeek() {
    const gs = Object.values(D.games), open = gs.filter((g) => !g.final).map((g) => g.wk);
    return open.length ? Math.min(...open) : Math.max(...gs.map((g) => g.wk));
  }
  // Last week / Upcoming week toggle (Michael 2026-11-16): Monday 8 AM through Wednesday (Central) the Signals page can show last week's
  // games (still to play tonight, in progress, completed) or the upcoming week's games, one at a time. Other days: no toggle, and the page
  // behaves as before (sgWk() is null, so every week filter below is a no-op). "Upcoming" = curWk() (the coming Sunday's week).
  function sgToggleOn() {
    const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })), dow = ct.getDay();
    if (!(dow === 2 || dow === 3 || (dow === 1 && ct.getHours() >= 8))) return false;
    return curWk() > 1 && laGames(curWk() - 1).length > 0;
  }
  function sgView() { // "last" | "next" | null (toggle not shown)
    if (!sgToggleOn()) return null;
    if (RL.sgView) return RL.sgView;
    // Not picked yet: open on last week while any of its games is not final, else on the upcoming week.
    return laGames(curWk() - 1).some(([, g]) => !g.final) ? "last" : "next";
  }
  const sgWk = () => { const v = sgView(); return v == null ? null : v === "next" ? curWk() : curWk() - 1; };
  // TNF filter (Michael 2026-11-19): Wednesday and Thursday (Central) only, a button beside the page title narrows every signal card's
  // count and the player lists to the upcoming week's Thursday-night game(s) (by Central kickoff day). Gone Friday through Tuesday, and
  // when the upcoming week has no Thursday game. Display only: no rule, score, list order or stored number changes.
  const ctDay = (d) => d.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" });
  const tnfMemo = { d: null, w: null, s: null };
  function tnfGids() {
    const w = curWk();
    if (tnfMemo.d !== D || tnfMemo.w !== w) tnfMemo.d = D, tnfMemo.w = w, tnfMemo.s = new Set(Object.entries(D.games).filter(([, g]) => g.wk === w && g.ko && ctDay(new Date(g.ko)) === "Thu").map(([id]) => id));
    return tnfMemo.s;
  }
  const tnfShow = () => { const d = ctDay(new Date()); return (d === "Wed" || d === "Thu") && tnfGids().size > 0; };
  const tnfOn = () => !!RL.tnf && tnfShow();
  const sgFilt = (list) => { const w = sgWk(); let l = w == null ? list : list.filter((x) => x.c.r.wk === w); if (tnfOn()) { const g = tnfGids(); l = l.filter((x) => g.has(x.c.r.gid)); } return l; };
  const tnfBtn = () => (tnfShow() ? `<button type="button" class="sg-tnf ${tnfOn() ? "on" : ""}" data-sgtnf aria-pressed="${tnfOn()}" style="position:absolute;right:0;top:50%;transform:translateY(-50%);margin:0;padding:4px 11px;font-size:12px;font-weight:700;line-height:1;border-radius:999px">TNF</button>` : "");
  const gsecRow = (t) => `<div class="sg-ttl" style="position:relative"><h2 class="gsec">${t}</h2>${tnfBtn()}</div>`;
  function sgToggleHtml() {
    const v = sgView(); if (v == null) return "";
    return `<div class="sgview" role="tablist" aria-label="Week"><button type="button" role="tab" aria-selected="${v === "last"}" class="${v === "last" ? "on" : ""}" data-sgview="last">Last week · W${curWk() - 1}</button><button type="button" role="tab" aria-selected="${v === "next"}" class="${v === "next" ? "on" : ""}" data-sgview="next">Upcoming · W${curWk()}</button></div>`;
  }
  // Graded bets for one rule in the week in play (final games only), honoring the game and market filters like compute() does.
  function doneBets(tab) {
    return analyze(tab, sgWk() ?? sigWeek()).filter((x) => (!RL.gid || x.r.gid === RL.gid) && (!RL.mk || x.mid === RL.mk) && (!tnfOn() || tnfGids().has(x.r.gid)));
  }
  function computeLiveCount(tab) {
    LIVE_PASS = true;
    try { return sgFilt(compute(tab)).length; } finally { LIVE_PASS = false; }
  }
  function playerRows(tabs, picked, live) {
    const map = new Map();
    LIVE_PASS = !!live;
    try {
      for (const t of tabs.filter((x) => !RL.unlocked || RL.unlocked.has(x.id))) {
        if (t.challenger) continue;
        for (const x of sgFilt(compute(t.id)).filter(nm)) {
          const side = x.side || t.side;
          if (side !== "over" && side !== "under") continue;
          const k = `${x.c.p.id}|${x.c.mid}|${x.c.r.gid}|${side}`;
          if (!map.has(k)) map.set(k, { ...x, side, bp: true, sigs: [] });
          map.get(k).sigs.push(t);
        }
      }
    } finally { LIVE_PASS = false; }
    let rows = [...map.values()];
    if (picked.length) rows = rows.filter((x) => picked.every((t) => x.sigs.some((y) => y.id === t.id)));
    const byGap = picked.length === 1 && picked[0].cm;
    rows.sort((a, b) => (byGap ? (b.gap ?? -1e9) - (a.gap ?? -1e9) : 0) || b.sigs.length - a.sigs.length || (b.gap ?? -1e9) - (a.gap ?? -1e9) || koMs(a.c) - koMs(b.c) || a.c.p.name.localeCompare(b.c.p.name));
    return rows;
  }
  // "Game in progress" list (Michael 2026-11-15): players who fit a signal this week whose game has started but isn't final.
  // Shown below the main list. No FanDuel checkboxes (betting on the game is closed); the line shown is the one captured for the signal.
  function liveHtml(tabs, picked) {
    const rows = playerRows(tabs, picked, true); if (!rows.length) return "";
    let h = `<h3 class="sg-sec">Game in progress (${rows.length})</h3><p class="muted small">These players fit a signal this week, but their game has started. Lines shown are the ones the signal used; no new picks.</p><div class="panel rlist">`;
    for (const x of rows) {
      const { p, r, mid, cur } = x.c;
      h += `<div class="rlrow sg-pr"><div class="rlhead"><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
        <span class="rlstat">${esc(mkt[mid].label)}</span><span class="chip rl-side ${x.side}">${x.side === "over" ? "Over" : "Under"} ${num(cur.line)}</span></div>
        <div class="sg-m"><span class="muted small">${esc(r.slot || p.pos)} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)}</span><span class="sg-chips">${x.sigs.map((t) => `<span class="chip ${RL.sigs.includes(t.id) ? "on" : ""}" role="button" tabindex="0" data-sig="${t.id}">${esc(t.label)}</span>`).join("")}</span></div></div>`;
    }
    return h + `</div>`;
  }
  // "Completed this week" list: same players as the cards count, graded hit / miss / push against the line the signal used.
  function doneHtml(tabs, picked) {
    const map = new Map();
    for (const t of tabs.filter((x) => !RL.unlocked || RL.unlocked.has(x.id))) {
      if (t.challenger) continue;
      for (const x of doneBets(t.id)) {
        const k = `${x.p.id}|${x.mid}|${x.r.gid}|${x.side}`;
        if (!map.has(k)) map.set(k, { ...x, sigs: [] });
        map.get(k).sigs.push(t);
      }
    }
    let rows = [...map.values()];
    if (picked.length) rows = rows.filter((x) => picked.every((t) => x.sigs.some((y) => y.id === t.id)));
    if (!rows.length) return "";
    const ord = { hit: 0, miss: 1, push: 2 };
    rows.sort((a, b) => ord[a.out] - ord[b.out] || b.sigs.length - a.sigs.length || new Date(a.r.ko) - new Date(b.r.ko) || a.p.name.localeCompare(b.p.name));
    const n = (o) => rows.filter((x) => x.out === o).length, push = n("push");
    let h = `<h3 class="sg-sec">Completed this week (${rows.length})</h3><p class="muted small">${n("hit")} hit · ${n("miss")} missed${push ? ` · ${push} push` : ""}. Graded against the line the signal used.</p><div class="panel rlist">`;
    for (const x of rows) {
      const { p, r, mid } = x, line = x.m.line, act = x.m.act;
      h += `<div class="rlrow sg-pr"><div class="rlhead"><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
        <span class="rlstat">${esc(mkt[mid].label)}</span><span class="chip rl-side ${x.side}">${x.side === "over" ? "Over" : "Under"} ${num(line)}</span><span class="pk-res ${x.out}">${x.out === "hit" ? "Hit" : x.out === "miss" ? "Miss" : "Push"}${act != null ? ` · ${num(act)}` : ""}</span></div>
        <div class="sg-m"><span class="muted small">${esc(r.slot || p.pos)} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)}</span><span class="sg-chips">${x.sigs.map((t) => `<span class="chip ${RL.sigs.includes(t.id) ? "on" : ""}" role="button" tabindex="0" data-sig="${t.id}">${esc(t.label)}</span>`).join("")}</span></div></div>`;
    }
    return h + `</div>`;
  }
  function playersHtml(tabs, picked) {
    const rows = playerRows(tabs, picked, false), live = liveHtml(tabs, picked) + doneHtml(tabs, picked);
    const lastV = sgView() === "last";
    const head = `<h3 class="sg-sec">${lastV ? `Still to play, week ${sgWk()}${picked.length ? ` · ${picked.length > 1 ? "fit all " + picked.length + " picked signals" : "fit this signal"}` : ""} (${rows.length})` : picked.length ? `Players who fit ${picked.length > 1 ? "all " + picked.length + " picked signals" : "this signal"} (${rows.length})` : `Players hitting the most signals (${rows.length})`}</h3>`;
    if (!rows.length) return head + `<p class="muted">${lastV ? "No players left to play from last week's games." : picked.length > 1 ? "No upcoming player fits all of those signals (they may also point opposite ways)." : "No upcoming players right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do."}</p>` + live;
    const pages = Math.ceil(rows.length / PAGE), key = `bp|${sgWk() ?? ""}|${picked.map((t) => t.id).join("+")}|${RL.gid || ""}|${RL.mk || ""}|${RL.q}|${tnfOn() ? "tnf" : ""}`, pg = Math.min(Math.max(+(RL.pg || {})[key] || 0, 0), pages - 1);
    (RL.pg = RL.pg || {})[key] = pg; RL.curKey = key;
    let h = head + fdSlipBox(BP, rows) + `<div class="panel rlist">`;
    for (const x of rows.slice(pg * PAGE, pg * PAGE + PAGE)) {
      const { p, r, mid, cur } = x.c;
      h += `<div class="rlrow sg-pr"><div class="rlhead"><input type="checkbox" class="rl-ck" data-rlck="${esc(rowKey(x))}" aria-label="Add ${esc(p.name)} to the FanDuel slip" ${selOf(BP.id).has(rowKey(x)) ? "checked" : ""}><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
        <span class="rlstat">${esc(mkt[mid].label)}</span><span class="chip rl-side ${x.side}">${x.side === "over" ? "Over" : "Under"} ${num(cur.line)}</span></div>
        ${(() => { const chips = `<span class="sg-chips">${x.sigs.map((t) => `<span class="chip ${RL.sigs.includes(t.id) ? "on" : ""}" role="button" tabindex="0" data-sig="${t.id}">${esc(t.label)}</span>`).join("")}</span>`, meta = `<span class="muted small">${esc(r.slot || p.pos)} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)}</span>`;
          return x.note ? `<div class="sg-m"><span class="small sg-gap">${esc(x.note)}</span>${chips}</div><div class="sg-m">${meta}</div>` : `<div class="sg-m">${meta}${chips}</div>`; })()}</div>`;
    }
    const pager = pages > 1 ? `<div class="rl-pager small"><button type="button" class="linkbtn" data-rlpg="-1" ${pg === 0 ? "disabled" : ""}>‹ Prev</button><span class="muted">Page ${pg + 1} of ${pages} · ${pg * PAGE + 1}–${Math.min(rows.length, pg * PAGE + PAGE)} of ${rows.length}</span><button type="button" class="linkbtn" data-rlpg="1" ${pg === pages - 1 ? "disabled" : ""}>Next ›</button></div>` : "";
    return h + `</div>${pager}` + live;
  }
  function html(page) {
    if (page !== undefined && page !== SGPAGE) { SGPAGE = page === "ind" ? "ind" : "main"; RL.sigs = []; }
    const tabs = visibleTabs();
    initOpts(tabs);
    let inner = topSection(tabs); // also sets RL.unlocked
    RL.sigs = RL.sigs.filter((id) => RL.unlocked.has(id));
    const picked = RL.sigs.map((id) => tabs.find((t) => t.id === id));
    if (picked.length) inner += recordPanel(picked);
    inner += `<div id="rl-body">${playersHtml(tabs, picked)}</div>`;
    setTimeout(placeGate, 0);
    const head = SGPAGE === "ind" ? `${gsecRow("Signals · Indicators")}<p class="small"><a href="#/search" data-ind-back>← Back to Signals</a> <span class="muted">Rules from the audit's tracked list, plus the late-yardage rules (SY-, FH-, BL-, NL-), covering every quoted player. Same tiles, charts and lists as Signals.</span></p>` : `${gsecRow("Signals")}<p class="muted small sg-tag">Claude's Fable 5.2 highest ROI Signals</p>`;
    return `<section id="rl" data-page="${SGPAGE}">${head}${sgToggleHtml()}${inner}</section>`;
  }
  function redraw() {
    const el = document.getElementById("rl"); if (!el) return;
    el.outerHTML = html();
  }
  document.addEventListener("click", (e) => {
    const o = e.target.closest && e.target.closest("[data-sgopt]");
    if (o) { const [k, v] = o.dataset.sgopt.split(":"); RL.opt[k] = +v; (RL.optTouched = RL.optTouched || {})[k] = true; redraw(); return; }
    const c = e.target.closest && e.target.closest("[data-sig]");
    if (c) { const id = c.dataset.sig; RL.sigs = RL.sigs.includes(id) ? RL.sigs.filter((x) => x !== id) : multiSelect() ? [...RL.sigs, id] : [id]; redraw(); return; }
    if (e.target.closest && e.target.closest("[data-sgclear]")) { RL.sigs = []; redraw(); return; }
    if (e.target.closest && e.target.closest("[data-sgtnf]")) { RL.tnf = !tnfOn(); if (RL.tnf && sgToggleOn()) RL.sgView = "next"; redraw(); return; }
    const sv = e.target.closest && e.target.closest("[data-sgview]"); if (sv) { RL.sgView = sv.dataset.sgview; if (RL.sgView === "last") RL.tnf = false; redraw(); return; }
    const sc = e.target.closest && e.target.closest("[data-rscope]"); if (sc) { RL.scope = sc.dataset.rscope; redraw(); return; }
  });
  document.addEventListener("toggle", (e) => { if (e.target && e.target.matches && e.target.matches("[data-fopen]")) RL.fopen = e.target.open; if (e.target && e.target.matches && e.target.matches("[data-wopen]")) RL.wopen = e.target.open; }, true);
  let qT = 0;
  document.addEventListener("input", (e) => {
    if (!e.target || e.target.id !== "rl-q") return;
    RL.q = e.target.value; clearTimeout(qT);
    qT = setTimeout(() => { redraw(); const el = document.getElementById("rl-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250);
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-rlpg]"); if (!b) return;
    const key = RL.curKey || pageKey(visibleTabs().find((x) => x.id === RL.tab) || TABS[0]); (RL.pg = RL.pg || {})[key] = (+RL.pg[key] || 0) + (+b.dataset.rlpg);
    redraw();
    const top = document.querySelector("#rl .rl-fd") || document.getElementById("rl"); if (top && top.scrollIntoView) top.scrollIntoView({ block: "start" });
  });
  // "Sign in to see all 8": the Google sign-in pop-up (whatsnew.js); signing in there keeps the visitor on Research.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-rlsignin]"); if (!b) return;
    e.preventDefault();
    try { window.STIX_WHATSNEW.open({ leads: TABS.length }); } catch (err) { console.error("leads sign-in failed", err); location.hash = "#/picks"; }
  });
  // Signing in or out redraws the Leads (rules 4–8 appear or disappear).
  (function watchAccount() {
    if (window.STIX_ACCOUNT && window.STIX_ACCOUNT.onChange) window.STIX_ACCOUNT.onChange(() => { try { redraw(); } catch (e) { console.error(e); } });
    else setTimeout(watchAccount, 500);
  })();
  // Opening a player from a lead shows the lead's stat on his player page (same per-player choice the stat tabs set).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-rmid]"); if (!a) return;
    try { S.market[a.dataset.rpid] = a.dataset.rmid; } catch (err) { console.error(err); }
  }, true);
  function safeHtml() { try { return html(); } catch (e) { console.error("research leads failed", e); return ""; } }

  // ---------- Leads Analysis (Michael 2026-10-30): how one rule did in one week, optionally one game ----------
  // Scores exactly like claude/frozen-theses.md's frozen.py: slotted players, final games, graded pre-game line with
  // both saved odds, result over/under/push (voids skipped), 1 unit at that line's saved odds for the rule's side.
  // "Last week" = his most recent earlier final game; spread = data.json games[gid].spread (nflverse spread_line).
  const LA = { tab: "t1", wk: null, gid: "", open: new Set() }; // wk: a week number, or "all" (Michael 2026-11-01)
  const payout = (o) => (o > 0 ? o / 100 : 100 / Math.abs(o));
  // Share of the team's offensive plays last game spent trailing / leading by 7+ (game_script.json s7; null until the data is there).
  function sharesOf(prev) {
    if (!prev) return null;
    const g = D.games[prev.gid], t = g && g.scr && g.scr.t && g.scr.t[g.home === prev.team ? "h" : "a"], v = t && t.s7;
    return v && v[0] ? { trail: v[1] / v[0], lead: v[2] / v[0] } : null;
  }
  function ruleHits(r, mid, m, p, past, played, prev) {
    const pm = prev && prev.m ? prev.m[mid] : null;
    const pl = pm && pm.lstat === "ok" && pm.line != null ? pm.line : null;
    const hits = [], line = m.line;
    if (p.pos === "QB" && mid === "rush_yds") {
      const l3 = played.map((x) => (x.m && x.m[mid] ? x.m[mid].act : null)).filter((v) => v != null).slice(-3);
      if (line >= 25 && l3.length === 3 && l3.reduce((a, b) => a + b, 0) / 3 >= 25) hits.push("qbr1");
      if (pl != null && line - pl >= RL.opt.qbr2) hits.push("qbr2");
      if (line >= RL.opt.qbr4) hits.push("qbr4");
    }
    const raised = pm && pm.res === "over" && pl != null && line > pl, sh = raised ? sharesOf(prev) : null;
    if (sh && (p.pos === "WR" || p.pos === "TE") && mid === "rec_yds" && sh.trail >= 0.5) hits.push("sc1");
    if (sh && p.pos === "RB" && mid === "rush_yds" && sh.lead >= 0.5) hits.push("sc2");
    // Indicator page rules. Streaks use his last 3 games played; spread rules use his team's spread (negative = underdog).
    const l3 = played.slice(-3);
    if (p.pos === "WR" && l3.length === 3) {
      if (mid === "rec_yds") {
        if (l3.every((x) => x.m && x.m.rec_yds && x.m.rec_yds.lstat === "ok" && x.m.rec_yds.res === "over")) hits.push("l9");
        const a = l3.map((x) => (x.m && x.m.rec_yds ? x.m.rec_yds.act : null));
        if (a.every((v) => v != null) && a[0] < a[1] && a[1] < a[2]) hits.push("s03");
      }
      if (mid === "rec") {
        const a = l3.map((x) => (x.m && x.m.rec ? x.m.rec.act : null));
        if (a.every((v) => v != null) && a[0] < a[1] && a[1] < a[2]) hits.push("l10");
      }
    }
    const fb = favBy(r);
    if (fb != null) {
      if (fb <= -10 && ["WR", "TE", "RB"].includes(p.pos)) { if (mid === "rec_yds") hits.push("sp1"); if (mid === "rec") hits.push("sp2"); }
      if (p.pos === "QB" && mid === "pass_yds") { if (fb >= 10) hits.push("sp3"); if (fb <= -10) hits.push("sp4"); }
      if (fb <= -3 && fb >= -6.5 && (p.pos === "QB" || p.pos === "RB") && mid === "rush_yds") hits.push("sp5");
    }
    // Late-yardage indicators: receiving yards Under for WR/TE/RB after an Over of 40+ yards with a higher line this week.
    // Needs his previous game's play-by-play detail (prev.rd, from data/rec_detail.json); no detail yet = no signal, never a guess.
    if (mid === "rec_yds" && ["WR", "TE", "RB"].includes(p.pos) && pm && pm.res === "over" && pl != null && line > pl && prev.rd && prev.rd.tot >= 40) {
      const d = prev.rd, up = line / pl - 1, needLong = d.tot - d.lc < pl;
      const ypc = d.hc >= 20 ? d.hy / d.hc : null, short = ypc != null && ypc < 10.6;
      if (short && up >= 0.25) hits.push("sy25");
      if (short && !needLong) hits.push("synl");
      if (short && d.rc > 0 && d.tot / d.rc >= 1.5 * ypc) hits.push("syypc");
      if (d.h1 > pl && up >= 0.30) hits.push("fhr30");
      if (d.h1 > pl && !needLong) hits.push("fhnl");
      if (pm.act != null && pm.act / pl - 1 >= 2) hits.push("bl200");
      if (d.lc < 20) hits.push("nlu20");
    }
    return { hits, pm, pl, f: null };
  }
  // CM1 (correlated line movement): per team-game, the QB's passing-yards line change vs the previous week (his previous
  // game, which must be the week before) against the receiving-yards line changes of his WR/TE/RB teammates (matched = a line both weeks).
  // gap = sum of the receivers' line changes minus the QB's change; the rule needs >= 3 matched receivers, a QB drop of at least
  // the rule's minimum and gap >= CM_GAP (receivers' lines fell 10+ yards less than the QB's).
  // Lines are the app's pre-game line per player (DraftKings, FanDuel fallback); the audit matched the same book one calendar week
  // earlier from raw captures, so results here can differ slightly. This week's line is the latest one showing until it is captured.
  const CM_GAP = 10, CM_RECS = 3;
  function cmGames(final) {
    const now = Date.now(), by = new Map();
    for (const p of D.players) {
      const rows = (D.rows[p.id] || []).slice().sort((a, b) => a.wk - b.wk);
      for (const r of rows) {
        if (final ? !r.final : !gameScope(r.final, r.ko, now)) continue;
        const mid = p.pos === "QB" ? "pass_yds" : (p.pos === "WR" || p.pos === "TE" || p.pos === "RB") ? "rec_yds" : null;
        const m = mid && r.m && r.m[mid]; if (!m) continue;
        const prev = rows.filter((x) => x.wk < r.wk && x.final).pop();
        if (!prev || prev.wk !== r.wk - 1) continue;
        const pm = prev.m && prev.m[mid], pl = pm && pm.lstat === "ok" && pm.line != null ? pm.line : null;
        const cur = final ? (m.lstat === "ok" && m.line != null ? { line: m.line, label: "pre-game", cap: m.cap } : null) : curLine(m);
        if (pl == null || !cur) continue;
        const k = r.gid + "|" + r.team; if (!by.has(k)) by.set(k, { gid: r.gid, team: r.team, qb: null, recs: [] });
        const e = { p, r, mid, m, cur, pl, pm, chg: cur.line - pl };
        if (mid === "pass_yds") { if (!by.get(k).qb) by.get(k).qb = e; } else by.get(k).recs.push(e);
      }
    }
    const out = [];
    for (const g of by.values()) {
      if (!g.qb || g.recs.length < CM_RECS) continue;
      const sum = g.recs.reduce((a, x) => a + x.chg, 0);
      out.push({ ...g, qbChg: g.qb.chg, sum, gap: sum - g.qb.chg });
    }
    return out;
  }
  // QB prop = his passing-yards line change vs last week; Receivers (n) = the SUM of the line changes of his n WR/TE/RB teammates (not each); net = receivers' sum minus the QB change.
  // Non-breaking spaces inside each part so a narrow screen only wraps between the parts.
  const cmNote = (g) => [`QB ${signed(g.qbChg, 0)}yds`, `${g.recs.length} receivers ${signed(g.sum, 0)}yds`, `net ${signed(g.gap, 0)}`].map((x) => x.replace(/ /g, "\u00a0")).join(" · ");
  function cmBets(t, final) {
    const out = [];
    for (const g of cmGames(final)) {
      if (!(g.qbChg <= -t.minDrop && g.gap >= CM_GAP)) continue;
      for (const e of g.recs) if (!t.only || e.p.pos === t.only) out.push({ g, e });
    }
    return out;
  }
  function computeCM(t) {
    return cmBets(t, false).filter(({ e }) => (!RL.gid || e.r.gid === RL.gid) && (!RL.mk || e.mid === RL.mk)).map(({ g, e }) => ({
      c: { p: e.p, r: e.r, mid: e.mid, cur: e.cur }, gap: g.gap, note: cmNote(g), rank: g.gap,
      cells: [`${num(e.pl)} → <b>${num(e.cur.line)}</b>`, cmNote(g)] }));
  }
  function analyzeCM(t, wk) {
    const out = [];
    for (const { g, e } of cmBets(t, true)) {
      const { p, r, mid, m } = e;
      if (r.wk !== wk || m.op == null || m.up == null || !["over", "under", "push"].includes(m.res)) continue;
      const o = m.res === "push" ? "push" : m.res === "under" ? "hit" : "miss";
      out.push({ p, r, mid, m, rule: t, side: "under", out: o, u: o === "hit" ? payout(m.up) : o === "miss" ? -1 : 0, odds: m.up, pl: e.pl, pm: e.pm, f: null, gap: g.gap, note: cmNote(g) });
    }
    return out;
  }
  // QBCH (starting QB changed): bet WR/TE receiving yards Under for a team whose starting QB is not the one who started its previous game.
  // Past games (scoring): the starter is the one in nflverse's game file (a post-game record, g.hq / g.aq); if a game has none yet, the QB with the
  // most snaps. This week's games (flags): the QB the book has posted a passing-yards line for, so a player can be flagged before kickoff; if lines
  // move to another QB the flag can change until the line is captured. "Previous game" = the team's most recent earlier final game.
  function qbchTeams(final) {
    const now = Date.now(), starters = new Map(), snapQB = new Map(); // team -> [{wk, gid, id, name}]
    const teamList = (t) => { if (!starters.has(t)) starters.set(t, []); return starters.get(t); };
    for (const p of D.players) if (p.pos === "QB") for (const r of D.rows[p.id] || []) {
      if (!r.final || r.played !== true) continue;
      const k = r.gid + "|" + r.team, cur = snapQB.get(k);
      if (!cur || (r.snap ?? 0) > (cur.snap ?? 0)) snapQB.set(k, { id: p.id, name: p.name, snap: r.snap, wk: r.wk, gid: r.gid, team: r.team });
    }
    const startOf = (gid, team) => {
      const g = D.games[gid], f = g && (g.home === team ? g.hq : g.away === team ? g.aq : null);
      return f && f.id ? { id: f.id, name: f.n } : (snapQB.get(gid + "|" + team) || null);
    };
    for (const [gid, g] of Object.entries(D.games)) {
      if (!g.final) continue;
      for (const team of [g.home, g.away]) { const s = startOf(gid, team); if (s) teamList(team).push({ wk: g.wk, gid, id: s.id, name: s.name }); }
    }
    const prevOf = (team, wk) => (starters.get(team) || []).filter((x) => x.wk < wk).sort((a, b) => a.wk - b.wk).pop();
    const out = [];
    for (const [gid, g] of Object.entries(D.games)) {
      for (const team of [g.home, g.away]) {
        let starter = null;
        if (final) { if (!g.final) continue; starter = startOf(gid, team); }
        else {
          if (!gameScope(g.final, g.ko, now)) continue;
          const lined = D.players.filter((p) => p.pos === "QB").map((p) => ({ p, r: (D.rows[p.id] || []).find((x) => x.gid === gid && x.team === team) }))
            .filter((x) => x.r && curLine(x.r.m && x.r.m.pass_yds));
          const pick = lined.find((x) => x.r.slot === "QB1") || lined[0]; starter = pick && { id: pick.p.id, name: pick.p.name };
        }
        if (!starter) continue;
        const prev = prevOf(team, g.wk);
        if (!prev || prev.id === starter.id) continue;
        out.push({ gid, team, wk: g.wk, starter, prev });
      }
    }
    return out;
  }
  function qbchBets(final) {
    const out = [];
    for (const g of qbchTeams(final)) {
      const note = `${g.starter.name} (last game: ${g.prev.name})`;
      for (const p of D.players) {
        if (p.pos !== "WR" && p.pos !== "TE") continue;
        const r = (D.rows[p.id] || []).find((x) => x.gid === g.gid && x.team === g.team), m = r && r.m && r.m.rec_yds; if (!m) continue;
        const cur = final ? (m.lstat === "ok" && m.line != null ? { line: m.line, label: "pre-game", cap: m.cap } : null) : curLine(m);
        if (cur) out.push({ g, p, r, m, cur, note });
      }
    }
    return out;
  }
  function computeQBCH() {
    return qbchBets(false).filter((e) => (!RL.gid || e.r.gid === RL.gid) && (!RL.mk || RL.mk === "rec_yds")).map((e) => ({
      c: { p: e.p, r: e.r, mid: "rec_yds", cur: e.cur }, note: e.note, rank: -koMs({ r: e.r }), cells: [`<b>${num(e.cur.line)}</b>`, e.note] }));
  }
  function analyzeQBCH(t, wk) {
    const out = [];
    for (const e of qbchBets(true)) {
      const { p, r, m } = e;
      if (r.wk !== wk || m.op == null || m.up == null || !["over", "under", "push"].includes(m.res)) continue;
      const o = m.res === "push" ? "push" : m.res === "under" ? "hit" : "miss";
      out.push({ p, r, mid: "rec_yds", m, rule: t, side: "under", out: o, u: o === "hit" ? payout(m.up) : o === "miss" ? -1 : 0, odds: m.up, pl: null, pm: null, f: null, note: e.note });
    }
    return out;
  }
  // Every graded bet one rule made in one week: [{p, r, mid, m, side, out: "hit"|"miss"|"push", u, pm, pl, f}]
  function analyze(tab, wk) {
    const t = TABS.find((x) => x.id === tab), out = [];
    if (t && t.cm) return analyzeCM(t, wk);
    if (t && t.qbch) return analyzeQBCH(t, wk);
    if (t?.frozen) {
      for (const x of frozenEntries(tab)) {
        const { v, decision, p, r, mid } = x;
        const act = r.m?.[mid]?.act;
        if (!x.locked || r.wk !== wk || !r.final || r.played !== true || act == null) continue;
        const side = decision.side, odds = v.quote[side === "over" ? "op" : "up"];
        const result = act === v.quote.line ? "push" : act > v.quote.line ? "over" : "under";
        const o = result === "push" ? "push" : result === side ? "hit" : "miss";
        out.push({ p, r, mid, m: { ...v.quote, act }, rule: t, side, out: o,
          u: o === "hit" ? payout(odds) : o === "miss" ? -1 : 0, odds });
      }
      return out;
    }
    for (const p of D.players) {
      if (p.extra && t?.page !== "ind") continue;
      const rows = (D.rows[p.id] || []).slice().sort((a, b) => a.wk - b.wk);
      for (const r of rows) {
        if (r.wk !== wk || !r.final) continue;
        const past = rows.filter((x) => x.wk < r.wk && x.final), played = past.filter((x) => x.played === true), prev = past[past.length - 1] || null;
        for (const [mid, m] of Object.entries(r.m || {})) {
          if (m.lstat !== "ok" || m.op == null || m.up == null || !["over", "under", "push"].includes(m.res)) continue;
          const x = ruleHits(r, mid, m, p, past, played, prev);
          if (!x.hits.includes(tab)) continue;
          const odds = t.side === "under" ? m.up : m.op;
          const o = m.res === "push" ? "push" : m.res === t.side ? "hit" : "miss";
          out.push({ p, r, mid, m, rule: t, side: t.side, out: o, u: o === "hit" ? payout(odds) : o === "miss" ? -1 : 0, odds, ...x });
        }
      }
    }
    return out;
  }
  // Weeks with at least one final game (newest first), and the week's games.
  function laWeeks() { return [...new Set(Object.values(D.games).filter((g) => g.final).map((g) => g.wk))].sort((a, b) => b - a); }
  function laGames(wk) { return Object.entries(D.games).filter(([, g]) => g.wk === wk).sort((a, b) => (a[1].ko || "").localeCompare(b[1].ko || "") || a[0].localeCompare(b[0])); }
  const unitsTxt = (u) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(2)} u`;
  function tally(list) {
    const W = list.filter((x) => x.out === "hit").length, L = list.filter((x) => x.out === "miss").length, P = list.filter((x) => x.out === "push").length;
    const U = list.reduce((a, x) => a + x.u, 0), n = W + L;
    return { W, L, P, U, n, hit: n ? (100 * W) / n : null, roi: n ? (100 * U) / n : null };
  }
  const recTxt = (s) => `${s.W}–${s.L}${s.P ? `–${s.P}` : ""}`;
  function why(x) {
    const line = num(x.m.line);
    switch (x.rule.id) {
      case "qbr2": case "sc1": case "sc2": case "sy25": case "synl": case "syypc": case "fhr30": case "fhnl": case "bl200": case "nlu20": return `Line ${num(x.pl)} → ${line}`;
      case "qbch": return esc(x.note);
      case "sp1": case "sp2": case "sp3": case "sp4": case "sp5": { const fb = favBy(x.r); return fb == null ? "" : `Team ${spreadTxt(fb)}`; }
      case "cm1te": case "cm120": return `Line ${num(x.pl)} → ${line} · ${esc(x.note)}`;
      default: return "";
    }
  }
  function laRow(x) {
    const { p, r, mid, m } = x;
    const cls = x.out === "hit" ? "la-hit" : x.out === "miss" ? "la-miss" : "la-push";
    const w = why(x);
    return `<div class="rlrow ${cls}"><div class="rlhead"><span class="la-mark" aria-hidden="true">${x.out === "hit" ? "✓" : x.out === "miss" ? "✗" : "–"}</span>${LA.tab === "all" ? `<span class="rl-n" title="${esc(x.rule.title)}">${x.rule.n}</span>` : ""}<a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
        <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${x.out === "push" ? "push" : unitsTxt(x.u)}</span></div>
      <div class="muted small">${esc(p.pos)} · ${esc(r.slot || "")} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)}</div>
      <div class="rlcells"><span><span class="muted small">${x.side === "over" ? "Over" : "Under"}</span> <b>${num(m.line)}</b> <span class="muted small">${odds(x.odds)}</span></span><span><span class="muted small">Actual</span> <b>${num(m.act)}</b></span>${w ? `<span class="muted small">${w}</span>` : ""}</div></div>`;
  }
  function analysisBody() {
    // "All leads" (Michael 2026-10-30): every visible rule together; each rule's bet counts on its own, so a player-stat
    // that fits two rules counts twice (as the rules' separate records add up).
    const isAll = LA.tab === "all", rules = isAll ? visibleTabs() : [TABS.find((x) => x.id === LA.tab)];
    const t = rules[0];
    const allWk = LA.wk === "all", wkList = allWk ? laWeeks().slice().reverse() : [LA.wk];
    const all = rules.flatMap((r) => wkList.flatMap((w) => analyze(r.id, w)));
    const games = allWk ? [] : laGames(LA.wk), nFinal = games.filter(([, g]) => g.final).length;
    const list = LA.gid ? all.filter((x) => x.r.gid === LA.gid) : all;
    const s = tally(list);
    const scope = allWk ? `All weeks (${wkList[0]}–${wkList[wkList.length - 1]})` : LA.gid ? esc(gameLabel(LA.gid)) : `Week ${LA.wk}${nFinal < games.length ? ` (${nFinal} of ${games.length} games final)` : ""}`;
    let h = `<p class="callout small">${isAll ? `<b>All ${rules.length} leads together.</b> Each rule's bet counts separately, so a player-stat that fits two rules counts twice.` : `<b>${t.n}. ${esc(t.title)}.</b> ${sideChip(t)}`}<br><span class="muted">${t.frozen && !isAll ? recLine(t) : (allWk ? `Weeks 1–7 are discovery data for original leads 1–8 (in-sample); week 8 onward is out-of-sample. Leads 9–12: only decisions recorded after the Oct 30 freeze.` : LA.wk <= 7 ? `Weeks 1–7 are discovery data for original leads 1–8.` : "Original leads 1–8: week 8 onward. Leads 9–12: only decisions after the Oct 30 freeze. Lead 13: only decisions after challenger activation; historical fits are excluded.")}</span></p>`;
    if (!isAll && t.spread && !Object.values(D.games).some((g) => (allWk || g.wk === LA.wk) && g.spread != null)) return h + `<p class="muted">No point spreads in the app's data for ${allWk ? "any week" : `week ${LA.wk}`}, so this rule can't be scored.</p>`;
    h += `<div class="la-sum"><div><span class="muted small">${scope}</span><b>${recTxt(s)}</b></div><div><span class="muted small">Hit rate</span><b>${s.hit == null ? "—" : s.hit.toFixed(1) + "%"}</b></div><div><span class="muted small">Units</span><b class="${s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : ""}">${s.n ? unitsTxt(s.U) : "—"}</b></div><div><span class="muted small">ROI</span><b>${s.roi == null ? "—" : (s.roi > 0 ? "+" : s.roi < 0 ? "−" : "") + Math.abs(s.roi).toFixed(1) + "%"}</b></div></div>`;
    if (isAll && list.length) {
      // per-rule breakdown; tap a rule to see only it
      h += `<div class="panel la-games">${rules.map((r) => { const g = list.filter((x) => x.rule === r); if (!g.length) return ""; const st = tally(g); return `<button type="button" class="la-game" data-larule="${r.id}"><span><span class="rl-n">${r.n}</span> ${esc(r.label)}</span><span class="muted small">${recTxt(st)} · ${st.n ? unitsTxt(st.U) : "push"}</span><span class="muted">›</span></button>`; }).join("")}</div>`;
    }
    if (!allWk && !LA.gid && all.length) {
      // per-game breakdown; tap a game to see only it
      const by = new Map();
      for (const x of all) { if (!by.has(x.r.gid)) by.set(x.r.gid, []); by.get(x.r.gid).push(x); }
      h += `<div class="panel la-games">${games.filter(([g]) => by.has(g)).map(([g]) => { const st = tally(by.get(g)); return `<button type="button" class="la-game" data-lagid="${esc(g)}"><span>${esc(gameLabel(g))}</span><span class="muted small">${recTxt(st)} · ${st.n ? unitsTxt(st.U) : "push"}</span><span class="muted">›</span></button>`; }).join("")}</div>`;
    }
    if (!list.length) return h + `<p class="muted">${LA.gid && !(D.games[LA.gid] || {}).final ? "This game isn't final yet." : `No graded bets for ${isAll ? "any lead" : `rule ${t.n}`} ${LA.gid ? "in this game" : allWk ? "in any week" : `in week ${LA.wk}`}.`}</p>`;
    const sortK = (a, b) => (a.r.ko || "").localeCompare(b.r.ko || "") || a.r.gid.localeCompare(b.r.gid) || a.p.name.localeCompare(b.p.name) || a.mid.localeCompare(b.mid) || a.rule.n - b.rule.n;
    const grp = (k, title) => { const g = list.filter((x) => x.out === k).sort(sortK); return g.length ? `<h3 class="la-h ${k}">${title} (${g.length})</h3><div class="panel rlist">${g.map(laRow).join("")}</div>` : ""; };
    const foot = `<p class="muted small">Graded on the pre-game line (~3 h before kickoff) at its saved odds, 1 unit per bet; voids and lines without both saved odds are left out. Same scoring as the rule's frozen record.</p>`;
    if (!allWk) return h + grp("hit", "Hits") + grp("miss", "Misses") + grp("push", "Pushes") + foot;
    // All weeks: one expandable section per week (newest first); open one to see that week's actual players
    const sec = (k, title, g) => g.length ? `<h3 class="la-h ${k}">${title} (${g.length})</h3><div class="panel rlist">${g.map(laRow).join("")}</div>` : "";
    h += wkList.slice().reverse().map((w) => {
      const g = list.filter((x) => x.r.wk === w); if (!g.length) return "";
      const st = tally(g), sorted = g.slice().sort(sortK), key = String(w);
      return `<details class="la-wk" data-lawk="${key}" ${LA.open.has(key) ? "open" : ""}><summary><span class="la-wk-t">Week ${w}${w <= 7 ? ` <span class="muted small">in-sample</span>` : ""}</span><span class="muted small">${recTxt(st)}${st.hit == null ? "" : ` · ${st.hit.toFixed(1)}%`} · ${st.n ? unitsTxt(st.U) : "push"}</span></summary>
        ${sec("hit", "Hits", sorted.filter((x) => x.out === "hit"))}${sec("miss", "Misses", sorted.filter((x) => x.out === "miss"))}${sec("push", "Pushes", sorted.filter((x) => x.out === "push"))}</details>`;
    }).join("");
    return h + foot;
  }
  // Observational diagnostic scorecards produced by the immutable-ledger backend.
  // Keep these distinct from the bet-selection model and its forward record.
  function challengerDiagnosticsHtml() {
    if (!signedIn() || !["t12", "t13", "all"].includes(LA.tab)) return "";
    const root = D.challenger_diagnostics;
    if (!root || !root.leads) return "<p class=\"muted small\">Challenger diagnostics will appear after the next data build.</p>";
    const ids = LA.tab === "all" ? ["t12", "t13"] : [LA.tab];
    const titles = { t12: "Frozen interaction", t13: "Weekly challenger" };
    const names = {
      usage_jump: "Pregame usage increase >10",
      surprise_jump: "Previous performance surprise >50%",
      combined_jump: "Both signals",
      low_participation: "Low participation (cause unverified)",
      tiny_qb_rush: "QB rushing line at or below 1.5",
      over: "Over selections",
      receiving_yards: "Receiving-yard selections"
    };
    const stat = (b) => b ? `${b.wins}–${b.losses} · ${signed(b.units, 2)}u` : "No graded bets";
    const sections = ids.map((id) => {
      const lead = root.leads[id];
      if (!lead) return "";
      const wk = LA.wk === "all"
        ? Math.max(0, ...Object.keys(lead.weeks || {}).map(Number))
        : LA.wk;
      const w = (lead.weeks || {})[String(wk)];
      if (!w) return `<p class="muted small">${titles[id]}: no graded bets for week ${wk}.</p>`;
      const games = (w.games || []).filter((g) => !LA.gid || g.gid === LA.gid);
      const table = `<table class="la-table"><thead><tr><th>Game</th><th>W–L</th><th>Units</th></tr></thead><tbody>${games.map((g) =>
        `<tr><td>${esc(g.matchup)}</td><td>${g.record.wins}–${g.record.losses}</td><td>${signed(g.record.units, 2)}u</td></tr>`).join("")}</tbody></table>`;
      const slices = Object.entries(names).map(([key, label]) => {
        const seg = w.segments[key];
        return `<tr><td>${label}</td><td>${stat(seg?.flagged)}</td><td>${stat(seg?.other)}</td></tr>`;
      }).join("");
      const flags = (w.disruptions || []).filter((v) => !LA.gid || v.gid === LA.gid);
      return `<details class="la-wk" ${id === "t12" ? "open" : ""}>
        <summary><b>${titles[id]} — Week ${wk}</b> · ${stat(w.overall)}</summary>
        <div class="muted small">Saved prices, one unit risked. ${lead.pending} pending and ${lead.voids} void overall.</div>
        ${table}
        <h4>Exploratory conditions</h4>
        <table class="la-table"><thead><tr><th>Condition</th><th>Flagged</th><th>Other</th></tr></thead><tbody>${slices}</tbody></table>
        <p class="muted small">Conditions can overlap, and bets on one player are correlated. Postgame grouping is not proof of an edge.</p>
        ${flags.length ? `<p class="muted small">Low-participation flags: ${flags.map((v) => `${esc(v.player)} (${num(v.actual_snap_pct)}% snaps vs ${num(v.prior_snap_pct)}% prior)`).join("; ")}. Cause not verified.</p>` : ""}
      </details>`;
    }).join("");
    return `<section class="la-diagnostics"><h3>Challenger learning diagnostics</h3>
      <p class="muted small">Exploratory prospective monitoring; no adjustment to model training, thresholds, or locked bets.</p>
      ${sections}</section>`;
  }

  function thesisRegistryHtml() {
    // Display only after a successful server-side admin RPC; ordinary signed-in accounts cannot see this panel.
    if (!window.STIX_ADMIN?.isResearchAdmin?.()) return "";
    const source = D.research_theses;
    if (!source?.tracked) return '<p class="muted small">Research registry appears after the next successful data refresh.</p>';
    const stats = (v) => v ? `${v.wins}–${v.losses} · ${signed(v.units || 0, 2)}u` : "No observations";
    const items = source.tracked.map((t) => {
      const prior = (t.evidence || []).filter((x) => x.phase === "discovery");
      const future = (t.evidence || []).filter((x) => x.phase === "forward_monitoring");
      const latest = future.length ? future[future.length - 1] : prior.length ? prior[prior.length - 1] : null;
      const status = t.status === "needs_data" ? "Test not implemented"
        : t.status === "existing_frozen_lead" ? "Existing locked strategy"
        : future.length ? "Forward monitoring (descriptive)" : "Awaiting prospective evidence";
      const detail = latest ? `${latest.model.toUpperCase()} · Week ${latest.week} · Flagged: ${stats(latest.flagged)} · Others: ${stats(latest.comparison)}`
        : t.status === "existing_frozen_lead" ? "Tracked separately in existing forward lead results"
        : "No independent performance results established";
      return `<details><summary><b>${esc(t.id)} · ${esc(t.title)}</b> <span class="muted small">— ${esc(status)}</span></summary>
        <p>${esc(t.question)}</p>
        <p class="muted small">${esc(detail)}</p>
        <p class="muted small">${esc(t.notes || "")}</p></details>`;
    }).join("");
    return `<section class="la-diagnostics"><details><summary><b>Research Thesis Registry (${source.registry_count})</b> <span class="muted small">· Independent weekly tracking</span></summary>
      <p class="muted small">Each hypothesis retains a stable identifier. Week 8 discovery does not count as forward confirmation. Not-yet-implemented ideas do not have win rates or ROI. No automatic changes to T12/T13.</p>
      ${items}</details></section>`;
  }

  function analysisHtml() {
    const weeks = laWeeks();
    if (!weeks.length) return `<section id="la"></section>`;
    const tabs = visibleTabs();
    if (LA.tab !== "all" && !tabs.some((t) => t.id === LA.tab)) LA.tab = tabs[0].id;
    if (LA.wk == null || (LA.wk !== "all" && !weeks.includes(LA.wk))) LA.wk = weeks[0];
    const games = LA.wk === "all" ? [] : laGames(LA.wk);
    if (LA.gid && !games.some(([g]) => g === LA.gid)) LA.gid = "";
    let body;
    try { body = analysisBody(); } catch (e) { console.error("leads analysis failed", e); body = `<p class="muted">Leads Analysis hit an error. Try refreshing.</p>`; }
    return `<section id="la"><h2 class="gsec">Leads Analysis</h2>
      <div class="filters"><label>Lead <select id="la-tab"><option value="all" ${LA.tab === "all" ? "selected" : ""}>All leads</option>${tabs.map((t) => `<option value="${t.id}" ${t.id === LA.tab ? "selected" : ""}>${t.n}. ${esc(t.label)}</option>`).join("")}</select></label>
        <label>Week <select id="la-wk"><option value="all" ${LA.wk === "all" ? "selected" : ""}>All weeks</option>${weeks.map((w) => `<option value="${w}" ${w === LA.wk ? "selected" : ""}>Week ${w}</option>`).join("")}</select></label>
        <label>Game <select id="la-gid" ${LA.wk === "all" ? "disabled" : ""}><option value="">All games</option>${games.map(([g, x]) => `<option value="${esc(g)}" ${g === LA.gid ? "selected" : ""}>${esc(gameLabel(g))}${x.final ? "" : " (not final)"}</option>`).join("")}</select></label></div>
      ${signedIn() ? "" : `<p class="muted small">Rules 4–8 appear here after you sign in, same as the Leads above.</p>`}
      <div id="la-body">${body}</div>${challengerDiagnosticsHtml()}${thesisRegistryHtml()}</section>`;
  }
  function laRedraw() { const el = document.getElementById("la"); if (el) el.outerHTML = analysisHtml(); }
  document.addEventListener("change", (e) => {
    const id = e.target && e.target.id;
    if (id === "la-tab") { LA.tab = e.target.value; laRedraw(); }
    if (id === "la-wk") { LA.wk = e.target.value === "all" ? "all" : +e.target.value; LA.gid = ""; laRedraw(); }
    if (id === "la-gid") { LA.gid = e.target.value; laRedraw(); }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-larule]"); if (!b) return;
    LA.tab = b.dataset.larule; laRedraw();
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-lagid]"); if (!b) return;
    LA.gid = b.dataset.lagid; laRedraw();
    const el = document.getElementById("la"); if (el) el.scrollIntoView({ block: "start" });
  });
  // remember which week sections are open across redraws (toggle doesn't bubble, so listen in the capture phase)
  document.addEventListener("toggle", (e) => { const d = e.target; if (d && d.classList && d.classList.contains("la-wk")) { d.open ? LA.open.add(d.dataset.lawk) : LA.open.delete(d.dataset.lawk); } }, true);
  function safeAnalysis() { return ""; } // folded into Signals (html) 2026-11-10
  // ---------- Guide tab setting ----------
  function settingsHtml() {
    const ms = scriptMargins();
    if (!ms.length) return "";
    const sel = (id, val, opts, suffix) => `<select id="${id}">${opts.map((v) => `<option value="${v}" ${v === val ? "selected" : ""}>${v}${suffix}</option>`).join("")}</select>`;
    const isDef = SCRIPT.margin === SCRIPT_DEFAULT.margin && SCRIPT.minutes === SCRIPT_DEFAULT.minutes;
    return `<div class="panel" id="g-script"><h3>Game script setting</h3><div class="body">
      <p class="callout">A team <b>led big</b> (or <b>trailed big</b>) in a game when it was ahead (or behind) by at least the margin below for at least the minutes below, out of 60. Used by the <b>Led big / Trailed big</b> chips in player game logs. Saved in this browser only.</p>
      <div class="filters"><label>Margin ${sel("gs-margin", SCRIPT.margin, ms, "+ points")}</label>
        <label>For at least ${sel("gs-min", SCRIPT.minutes, SCRIPT_MINUTES, " minutes")}</label>
        ${isDef ? `<span class="muted small">Default (${SCRIPT_DEFAULT.margin}+ for ${SCRIPT_DEFAULT.minutes} min)</span>` : `<button id="gs-reset" type="button">Reset to ${SCRIPT_DEFAULT.margin}+ for ${SCRIPT_DEFAULT.minutes} min</button>`}</div>
      <p class="muted small">Rule of thumb behind the colors: a team with a big lead runs more and passes less, so leading big is shown as helping RBs (green) and working against QBs, WRs and TEs (red); trailing big is the reverse. Minutes come from nflverse play-by-play (score at each play × game clock).</p>
    </div></div>`;
  }
  function saveScript() {
    try { localStorage.setItem("stix_script", JSON.stringify(SCRIPT)); } catch { /* setting just won't persist */ }
    try { render(); } catch (e) { console.error(e); }
    const el = document.getElementById("g-script"); if (el) el.scrollIntoView({ block: "center" });
  }
  document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "gs-margin") { SCRIPT.margin = +e.target.value; saveScript(); }
    if (e.target && e.target.id === "gs-min") { SCRIPT.minutes = +e.target.value; saveScript(); }
  });
  document.addEventListener("click", (e) => { if (e.target && e.target.id === "gs-reset") { Object.assign(SCRIPT, SCRIPT_DEFAULT); saveScript(); } });

  function safeSettings() { try { return settingsHtml(); } catch (e) { console.error("game script setting failed", e); return ""; } }
  window.STIX_RESEARCH = { html: safeHtml, htmlFor: (pg) => { try { return html(pg); } catch (e) { console.error("research page failed", e); return ""; } }, analysis: safeAnalysis, analyze, compute, TABS, badge, oppLink, settingsHtml: safeSettings };
})();
