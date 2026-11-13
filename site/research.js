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
  const CM_READ = `<div class="sg-sub"><b>Reading a player row:</b></div><ul class="sg-ul"><li>"QB −34yds": the QB's passing-yards line change vs last week.</li><li>"7 receivers +46yds": the 7 receivers' receiving-yards line changes added up.</li><li>"net +80": receivers minus QB.</li></ul>`;
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
      desc: () => `Bet the TE's <b>receiving yards Under</b> when all three are true:<ul class="sg-ul"><li>The QB's passing-yards line is down <b>15+</b> vs last week.</li><li>At least 3 teammates (WR/TE/RB) have receiving-yards lines both weeks.</li><li>Their line changes added up, minus the QB change (the gap), is at least <b>10</b>.</li></ul>${CM_READ}` },
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

  // Every upcoming (not started) player × market with a line showing, plus his history. Slotted players only (the rules' universe).
  function candidates(withExtras) {
    const now = Date.now(), out = [];
    for (const p of D.players) {
      if (p.extra && !withExtras) continue;
      const rows = D.rows[p.id] || [];
      for (const r of rows) {
        if (r.final || !r.ko || new Date(r.ko).getTime() <= now) continue;
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
      if (ind) {
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
    return frozenEntries(tab).filter((x) => !x.r.final && new Date(x.r.ko).getTime() > Date.now()
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
      if (m && sel && /^[\d.]+$/.test(m) && /^\d+$/.test(sel)) legs.push({ pid: p.id, mid, side, m, sel, bet: { line: e.point, odds: o.price, cap: e.cap, gid: e.gid, book: "FanDuel", src: "Bet on FD" } });
      else missing.push(`${p.name} (${mkt[mid].label})`);
    }
    // More than FD_SLIP_MAX bets are split into several links of at most FD_SLIP_MAX bets each, in list order.
    const chunks = [];
    for (let i = 0; i < legs.length; i += FD_SLIP_MAX) {
      const part = legs.slice(i, i + FD_SLIP_MAX);
      chunks.push({ legs: part, from: i + 1, to: i + part.length,
        url: "https://sportsbook.fanduel.com/addToBetslip?" + part.map((l, j) => `marketId[${j}]=${l.m}&selectionId[${j}]=${l.sel}`).join("&") });
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
    const b = e.target.closest && e.target.closest("[data-fdall]"); if (!b || !window.STIX_PICKS || !fdSave()) return;
    try { window.STIX_PICKS.recordBets(((RL.fdChunks || [])[+b.dataset.fdchunk || 0] || {}).legs || []); } catch (err) { console.error("picks from FanDuel slip failed", err); }
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
  function auditLine(t) {
    const a = AUDIT[t.id], x = a && (t.opts ? a[RL.opt[t.id]] : a);
    if (!x) return `The audit did not test this setting (${t.optFmt(RL.opt[t.id])}), so there is no interval for it.`;
    const y = AUDIT_YR[t.id], yr = y && (t.opts ? y[RL.opt[t.id]] : y);
    const seasons = yr ? `2025: <b>${pc(yr[0])}</b> ROI<br>2026: <b>${pc(yr[1])}</b> ROI<br>` : "";
    return `<b>Audit replay</b><br>${seasons}Both seasons: <b>${x.rec}</b>, <b>${pc(x.roi)}</b> ROI, 95% interval <b>${pc(x.lo)} to ${pc(x.hi)}</b>${x.note ? ` (${x.note})` : ""}.`;
  }
  function openInfo(id) {
    closePop();
    const t = TABS.find((x) => x.id === id); if (!t) return;
    const ov = document.createElement("div");
    ov.id = "scr-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box nw-box" role="dialog" aria-label="${esc(t.label)}">
      <div class="nw-h"><b>${esc(t.label)} - ${esc(t.short ? t.short() : t.title)}</b><button class="nw-x" aria-label="Close">✕</button></div>
      <div class="small sg-desc">${t.desc()}</div>
      <p class="small"><b>Why it might work:</b> ${esc(t.why)}</p>
      <p class="small">${auditLine(t)}</p>
      <p class="small"><b>What the interval means:</b> the range of ROI you would plausibly get if the same rule were run on other weeks (made by resampling whole weeks 4,000 times). If it reaches below 0%, the result could be luck. It does not account for picking the best rules out of many tried, so it is likely optimistic.</p></div>`;
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
  function spark(by) {
    let W = 0, L = 0, U = 0; const pts = by.map(({ w, list }) => {
      const s = tally(list); U += s.U; W += s.W + s.L;
      return { w, n: s.n, roi: s.n ? s.roi : null, cum: W ? (100 * U) / W : null };
    });
    if (!pts.some((q) => q.n)) return `<div class="sg-nospark muted small">no graded bets</div>`;
    const w = 170, h = 70, l = 30, r = 11, tp = 6, bt = 13, n = pts.length, base = h - bt;
    const vals = pts.flatMap((q) => [q.roi, q.cum]).filter((v) => v != null).concat(0);
    let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 20) { mx += 10; mn -= 10; }
    const rg = mx - mn, X = (i) => (n < 2 ? (l + w - r) / 2 : l + (i * (w - l - r)) / (n - 1)), Y = (v) => tp + ((mx - v) / rg) * (base - tp);
    const fmt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`;
    const ticks = []; let prevY = -99;
    for (const v of [...new Set([mx, 0, mn])].sort((a, b) => b - a)) { if (Y(v) - prevY >= 11) { ticks.push(v); prevY = Y(v); } }
    const every = n > 9 ? 2 : 1, cp = pts.map((q, i) => [i, q]).filter(([, q]) => q.cum != null);
    const last = cp.length ? cp[cp.length - 1][1].cum : 0, col = last >= 0 ? "--over" : "--under";
    return `<svg class="sg-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly ROI and running ROI by week, now ${fmt(last)}">
      <g class="sg-ax"><line x1="${l}" x2="${l}" y1="${tp}" y2="${base}"/><line x1="${l}" x2="${w - r}" y1="${base}" y2="${base}"/>
      ${ticks.map((v) => `<line class="sg-gl" x1="${l}" x2="${w - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${l - 3}" y="${(Y(v) + 2.8).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${pts.map((q, i) => ((n - 1 - i) % every ? "" : `<text x="${X(i).toFixed(1)}" y="${h - 3}" text-anchor="middle">W${q.w}</text>`)).join("")}</g>
      <line x1="${l}" x2="${w - r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke:var(--line)" stroke-dasharray="3 3"/>
      <path d="${cp.map(([i, q], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(q.cum).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(${col})" stroke-width="1.6" stroke-linejoin="round"/>
      ${pts.filter((q) => q.n).map((q) => `<circle cx="${X(pts.indexOf(q)).toFixed(1)}" cy="${Y(q.roi).toFixed(1)}" r="2.3" style="fill:var(${q.roi >= 0 ? "--over" : "--under"})"><title>Week ${q.w}: ${fmt(q.roi)} ROI (${q.n} bets) · running ${fmt(q.cum)}</title></circle>`).join("")}</svg>`;
  }
  function tileHtml(t, st, locked) {
    const on = RL.sigs.includes(t.id), s = st.s, cls = s.n ? (s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : "") : "";
    const cnt = compute(t.id).length;
    const tg = t.opts ? `<span class="sg-tg" role="group" aria-label="${esc(t.label)} threshold">${t.opts.map((v) => `<button type="button" class="${RL.opt[t.id] === v ? "on" : ""}" data-sgopt="${t.id}:${v}" ${locked ? "tabindex=\"-1\"" : ""}>${t.optFmt(v)}</button>`).join("")}</span>` : "";
    return `<div class="sg-cell${locked ? " sg-locked" : ""}"${locked ? ' aria-hidden="true"' : ""}><button type="button" class="sg-tile ${on ? "on" : ""}" data-sig="${t.id}" aria-pressed="${on}" ${locked ? "tabindex=\"-1\"" : ""}>
      <div class="sg-hd"><b>${esc(t.label)}</b><span class="rinfo" role="button" tabindex="0" data-rinfo="${t.id}" aria-label="About ${esc(t.label)}" ${locked ? "tabindex=\"-1\"" : ""}>i</span></div>
      <div class="sg-r2"><span class="sg-roi ${cls}">${s.n ? `${s.roi > 0 ? "+" : s.roi < 0 ? "−" : ""}${Math.abs(s.roi).toFixed(1)}%` : "—"}</span><span class="small sg-st">${s.n ? recTxt(s) : `<span class="muted">no bets</span>`}<br><b>${cnt}</b> this wk</span></div>
      ${st.by ? spark(st.by) : ""}</button>${tg}</div>`;
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
  function initOpts(tabs) {
    RL.optInit = RL.optInit || {};
    if (RL.optInit[SGPAGE] || !laWeeks().length) return;
    RL.optInit[SGPAGE] = true; RL.optTouched = RL.optTouched || {};
    for (const t of tabs) if (t.opts && !RL.optTouched[t.id]) RL.opt[t.id] = bestOpt(t, seasonTally);
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
    // First FREE_TILES tiles in this order are open to everyone; the rest are faded behind a Google sign-in until signed in.
    const gate = !signedIn();
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
  function playersHtml(tabs, picked) {
    const map = new Map();
    for (const t of tabs.filter((x) => !RL.unlocked || RL.unlocked.has(x.id))) {
      if (t.challenger) continue;
      for (const x of compute(t.id).filter(nm)) {
        const side = x.side || t.side;
        if (side !== "over" && side !== "under") continue;
        const k = `${x.c.p.id}|${x.c.mid}|${x.c.r.gid}|${side}`;
        if (!map.has(k)) map.set(k, { ...x, side, bp: true, sigs: [] });
        map.get(k).sigs.push(t);
      }
    }
    let rows = [...map.values()];
    if (picked.length) rows = rows.filter((x) => picked.every((t) => x.sigs.some((y) => y.id === t.id)));
    const byGap = picked.length === 1 && picked[0].cm;
    rows.sort((a, b) => (byGap ? (b.gap ?? -1e9) - (a.gap ?? -1e9) : 0) || b.sigs.length - a.sigs.length || (b.gap ?? -1e9) - (a.gap ?? -1e9) || koMs(a.c) - koMs(b.c) || a.c.p.name.localeCompare(b.c.p.name));
    const head = `<h3 class="sg-sec">${picked.length ? `Players who fit ${picked.length > 1 ? "all " + picked.length + " picked signals" : "this signal"} (${rows.length})` : `Players hitting the most signals (${rows.length})`}</h3>`;
    if (!rows.length) return head + `<p class="muted">${picked.length > 1 ? "No upcoming player fits all of those signals (they may also point opposite ways)." : "No upcoming players right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do."}</p>`;
    const pages = Math.ceil(rows.length / PAGE), key = `bp|${picked.map((t) => t.id).join("+")}|${RL.gid || ""}|${RL.mk || ""}|${RL.q}`, pg = Math.min(Math.max(+(RL.pg || {})[key] || 0, 0), pages - 1);
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
    return h + `</div>${pager}`;
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
    const head = SGPAGE === "ind" ? `<h2 class="gsec">Signals · Indicators</h2><p class="small"><a href="#/search" data-ind-back>← Back to Signals</a> <span class="muted">Rules from the audit's tracked list, covering every quoted player. Same tiles, charts and lists as Signals.</span></p>` : `<h2 class="gsec">Signals</h2><p class="muted small sg-tag">Claude's Fable 5.2 highest ROI Signals</p>`;
    return `<section id="rl" data-page="${SGPAGE}">${head}${inner}</section>`;
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
        if (final ? !r.final : (r.final || !r.ko || new Date(r.ko).getTime() <= now)) continue;
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
          if (g.final || !g.ko || new Date(g.ko).getTime() <= now) continue;
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
      case "qbr2": case "sc1": case "sc2": return `Line ${num(x.pl)} → ${line}`;
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
