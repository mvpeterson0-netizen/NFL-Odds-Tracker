"use strict";
// Stix Research tab: pre-built "Leads" filters, then Leads Analysis (how a rule did in a past week / game).
// Uses only data already in data.json (players' per-game rows, lines, usage; game script minutes from play-by-play).
// Leads = the 8 frozen theses (claude/frozen-theses.md), each spelled out behind its "i". Candidates, not predictions.
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
  const TABS = [
    { id: "t1", n: 1, side: "under", label: "WR2 went over → Under",
      title: "WR2 who went over his line last week (same stat) → Under",
      why: "Books may overreact to a secondary receiver's good game.", rec: "99–54 · 64.7% · +34.1 u · +22.3% ROI",
      desc: () => `His slot this week is <b>WR2</b> and, in his previous game, he finished <b>over</b> that game's graded pre-game line for the same stat. "Previous game" = his team's most recent earlier final game (even if he didn't play). Ordered by how far over he went (actual − line, ÷ √line).` },
    { id: "t2", n: 2, side: "under", label: "Away, line raised → Under",
      title: "Away game and his line is higher than last week (same stat) → Under",
      why: "Fading a raised line, with road-game drag.", rec: "333–239 · 58.2% · +50.9 u · +8.9% ROI",
      desc: () => `His team is <b>away</b> and this week's line is <b>higher</b> than the graded pre-game line from his previous game for the same stat (any amount). Ordered by size of the raise ÷ √(last game's line), as on the old Line move tab.` },
    { id: "t3", n: 3, side: "under", label: "TE1 rec yds → Under",
      title: "TE1 receiving yards → Under",
      why: "Tight-end yardage is lumpy: a few big games lift the average, so the typical game lands below a line set near it.", rec: "122–85 · 58.9% · +24.0 u · +11.6% ROI",
      desc: () => `Every player slotted <b>TE1</b> this week with a receiving yards line. Ordered by kickoff.` },
    { id: "t4", n: 4, side: "under", label: "QB1 rush yds → Under",
      title: "QB1 rushing yards → Under",
      why: "Same lumpiness: occasional scrambles inflate the average.", rec: "125–86 · 59.2% · +23.5 u · +11.2% ROI",
      desc: () => `Every player slotted <b>QB1</b> this week with a rushing yards line. Ordered by kickoff.` },
    { id: "t5", n: 5, side: "under", label: "Usage down, line flat → Under",
      title: "Usage down, line flat → Under",
      why: "The line hasn't caught up with a shrinking role.", rec: "68–46 · 59.6% · +11.2 u · +9.8% ROI",
      desc: () => `Usage = target share for WR/TE, snap share for RB (QBs not included). Down = average of his last ${USAGE_N} games played is at least <b>${USAGE_DROP.tshare} points</b> of target share (WR/TE) or <b>${USAGE_DROP.snap} points</b> of snap share (RB) below his average in his earlier games this season (min 2 earlier games). Line flat = within ±${FLAT.count} for receptions / carries / attempts / completions, ±${FLAT.yds} for rushing and receiving yards, ±${FLAT.pass_yds} for passing yards, compared with his previous game's graded line. The ${USAGE_N}-game window is fixed because the rule was frozen with it. Ordered by the usage drop.` },
    { id: "t6", n: 6, side: "under", label: "Favored by 7+: RB rush → Under", spread: true,
      title: "His team favored by 7+ → RB rushing yards Under",
      why: "The expected-blowout run game may already be priced in, possibly over-priced.", rec: "29–14 · 67.4% · +11.8 u · +27.5% ROI",
      desc: () => `RBs with a rushing yards line whose team is favored by <b>${BIG_SPREAD} or more</b> points. Ordered by spread, then kickoff.` },
    { id: "t7", n: 7, side: "over", label: "7+ underdog: QB pass → Over", spread: true,
      title: "His team a 7+ underdog → QB passing yards Over",
      why: "Trailing teams may throw more than the line assumes.", rec: "18–6 · 75.0% · +10.1 u · +42.1% ROI",
      desc: () => `Players with a passing yards line whose team is a <b>${BIG_SPREAD}+ point underdog</b>. Ordered by spread, then kickoff.` },
    { id: "t8", n: 8, side: "over", label: "7+ underdog: WR/TE rec → Over", spread: true,
      title: "His team a 7+ underdog → WR/TE receiving yards Over",
      why: "Same trailing-team passing volume.", rec: "59–42 · 58.4% · +10.6 u · +10.5% ROI",
      desc: () => `WRs and TEs with a receiving yards line whose team is a <b>${BIG_SPREAD}+ point underdog</b>. Ordered by spread, then kickoff.` },
  ];
  // Rules 1–3 for everyone; 4–8 only for people signed in to a Stix account (Google), Michael 2026-10-29.
  // Front-end gate only: the data behind every rule is in data.json, which anyone can download.
  const FREE_RULES = 3;
  const signedIn = () => { try { return !!(window.STIX_ACCOUNT && window.STIX_ACCOUNT.signedIn()); } catch (e) { return false; } };
  const visibleTabs = () => (signedIn() ? TABS : TABS.slice(0, FREE_RULES));
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
  function candidates() {
    const now = Date.now(), out = [];
    for (const p of D.players) {
      if (p.extra) continue;
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
    const out = [];
    for (const c of candidates()) {
      const pl = prevLine(c), pos = c.p.pos, line = c.cur.line;
      if (tab === "t1") {
        if (c.r.slot !== "WR2" || !c.pm || c.pm.res !== "over" || pl == null) continue;
        const by = c.pm.act - pl;
        out.push({ c, rank: pl > 0 ? by / Math.sqrt(pl) : 0, cells: [`<b>${num(line)}</b>`, `${num(c.pm.act)} vs ${num(pl)} <span class="muted small">(over by ${num(by)})</span>`] });
      } else if (tab === "t2") {
        if (c.r.ha !== "away" || pl == null || !(line > pl)) continue;
        const ch = line - pl;
        out.push({ c, rank: pl > 0 ? ch / Math.sqrt(pl) : 0, cells: [`${num(pl)} → <b>${num(line)}</b> <b>${signed(ch)}</b>`, `@ ${esc(c.r.opp)}`] });
      } else if (tab === "t3" || tab === "t4") {
        if (tab === "t3" ? !(c.r.slot === "TE1" && c.mid === "rec_yds") : !(c.r.slot === "QB1" && c.mid === "rush_yds")) continue;
        const l3 = c.played.map((x) => (x.m && x.m[c.mid] ? x.m[c.mid].act : null)).filter((v) => v != null).slice(-3);
        out.push({ c, rank: -koMs(c), cells: [`<b>${num(line)}</b>`, l3.length ? l3.map((v) => num(v, 0)).join(", ") : `<span class="muted">—</span>`] });
      } else if (tab === "t5") {
        if (pos === "QB" || pl == null) continue;
        const us = c.played.map((x) => usageOf(pos, x)).filter((v) => v != null);
        if (us.length < USAGE_N + 2) continue; // 2 recent games + at least 2 earlier
        const rec = us.slice(-USAGE_N), early = us.slice(0, -USAGE_N);
        const ar = rec.reduce((a, b) => a + b, 0) / USAGE_N, ae = early.reduce((a, b) => a + b, 0) / early.length, drop = ar - ae;
        if (drop > -(pos === "RB" ? USAGE_DROP.snap : USAGE_DROP.tshare)) continue;
        const tol = COUNT_MKTS.includes(c.mid) ? FLAT.count : c.mid === "pass_yds" ? FLAT.pass_yds : FLAT.yds;
        if (Math.abs(line - pl) > tol) continue;
        const kind = pos === "RB" ? "snap" : "tgt share";
        out.push({ c, rank: -drop, badge: `−${Math.round(-drop)} pts`, cells: [`${num(pl)} → <b>${num(line)}</b>`, `${kind} ${Math.round(ae)}% → <b>${Math.round(ar)}%</b> <span class="muted small">(last ${USAGE_N}: ${rec.map((v) => Math.round(v) + "%").join(", ")})</span>`] });
      } else if (tab === "t6" || tab === "t7" || tab === "t8") {
        const f = favBy(c.r); if (f == null) continue;
        const ok = tab === "t6" ? f >= BIG_SPREAD && pos === "RB" && c.mid === "rush_yds"
          : tab === "t7" ? f <= -BIG_SPREAD && c.mid === "pass_yds"
          : f <= -BIG_SPREAD && (pos === "WR" || pos === "TE") && c.mid === "rec_yds";
        if (!ok) continue;
        out.push({ c, rank: Math.abs(f) * 1e13 - koMs(c), cells: [`<b>${num(line)}</b>`, esc(spreadTxt(f))] });
      }
    }
    out.sort((a, b) => b.rank - a.rank || a.c.p.name.localeCompare(b.c.p.name));
    return out;
  }
  const HEADS = {
    t1: ["Line", "Last game: his stat vs line"],
    t2: ["Line (last game → now)", "Game"],
    t3: ["Line", "Last 3"], t4: ["Line", "Last 3"],
    t5: ["Line (last game → now)", "Usage"],
    t6: ["Line", "Team"], t7: ["Line", "Team"], t8: ["Line", "Team"],
  };
  const sideChip = (t) => `<span class="chip rl-side ${t.side}">Bet ${t.side === "over" ? "Over" : "Under"}</span>`;
  const recLine = (t) => `Weeks 1–7, when the rule was picked: <b>${t.rec}</b>. A candidate, not proven; scored from week 8 on.`;

  // "Add all to FanDuel slip" (Michael 2026-10-29): one link that puts the rule's bet side for every listed player
  // (the rows shown, top 40) on the FanDuel bet slip. FanDuel takes several bets in one addToBetslip link as
  // marketId[i]=…&selectionId[i]=… (Michael's iPhone test 2026-10-29: 3 bets all landed; repeated or comma-separated
  // parameters did not work). Each bet uses FanDuel's own current line. Players without a FanDuel link in the latest
  // pull, or whose game has started, are left out and named. Tapping also saves the picks to My picks (one save).
  const FD_SLIP = /^https:\/\/sportsbook\.fanduel\.com\/addToBetslip\?/;
  function fdSlip(t, rows) {
    const now = Date.now(), side = t.side === "over" ? "o" : "u", legs = [], missing = [];
    for (const x of rows) {
      const { p, r, mid } = x.c;
      const e = ((((D.links || {})[p.id] || {})[mid]) || {}).fanduel, o = e && e[side], g = e && D.games[e.gid];
      let m = null, sel = null;
      if (o && FD_SLIP.test(o.url || "") && g && e.gid === r.gid && new Date(g.ko).getTime() > now) {
        try { const u = new URL(o.url); m = u.searchParams.get("marketId"); sel = u.searchParams.get("selectionId"); } catch (err) { m = sel = null; }
      }
      if (m && sel && /^[\d.]+$/.test(m) && /^\d+$/.test(sel)) legs.push({ pid: p.id, mid, side, m, sel, bet: { line: e.point, odds: o.price, cap: e.cap, gid: e.gid, book: "FanDuel", src: "Bet on FD" } });
      else missing.push(`${p.name} (${mkt[mid].label})`);
    }
    const url = "https://sportsbook.fanduel.com/addToBetslip?" + legs.map((l, i) => `marketId[${i}]=${l.m}&selectionId[${i}]=${l.sel}`).join("&");
    return { legs, missing, url };
  }
  function fdSlipBox(t, rows) {
    const f = fdSlip(t, rows); RL.fdLegs = f.legs;
    if (!f.legs.length) return "";
    const word = t.side === "over" ? "Over" : "Under";
    return `<div class="betbox rl-fd"><a class="betbtn" href="${esc(f.url)}" target="_blank" rel="noopener" data-fdall="${esc(t.id)}" title="Opens FanDuel with all ${f.legs.length} bets on the slip">Add all ${f.legs.length} ${word}s to FanDuel slip ↗</a>${f.missing.length ? `<span class="muted small">Not on FanDuel: ${esc(f.missing.join(", "))}</span>` : ""}</div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-fdall]"); if (!b || !window.STIX_PICKS) return;
    try { window.STIX_PICKS.recordBets(RL.fdLegs || []); } catch (err) { console.error("picks from FanDuel slip failed", err); }
  });

  function body() {
    const t = visibleTabs().find((x) => x.id === RL.tab) || TABS[0];
    const list = compute(t.id);
    let h = `<p class="callout small"><b>${t.n}. ${esc(t.title)}.</b> ${sideChip(t)}<br><span class="muted">${recLine(t)}</span></p>`;
    if (t.spread && !Object.values(D.games).some((g) => g.spread != null)) return h + `<p class="muted">Point spreads (nflverse schedule) aren't in the app's data yet, so this rule can't be filled.</p>`;
    if (!list.length && RL.gid) return h + `<p class="muted">No players in ${esc(gameLabel(RL.gid))} match rule ${t.n} right now.</p>`;
    if (!list.length) return h + `<p class="muted">No upcoming lines match right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do.</p>`;
    const heads = HEADS[t.id];
    h += fdSlipBox(t, list.slice(0, 40));
    h += `<div class="panel rlist">`;
    for (const x of list.slice(0, 40)) {
      const { p, r, mid, cur } = x.c;
      h += `<div class="rlrow"><div class="rlhead"><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
          <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${x.badge || ""}</span></div>
        <div class="muted small">${esc(p.pos)} · ${esc(r.slot || "")} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)} · line from ${esc(cur.label)}</div>
        <div class="rlcells">${x.cells.map((v, k) => `<span><span class="muted small">${heads[k]}</span> ${v}</span>`).join("")}</div></div>`;
    }
    return h + `</div>${list.length > 40 ? `<p class="muted small">Showing the top 40 of ${list.length}.</p>` : ""}`;
  }

  function openInfo(id) {
    closePop();
    const t = TABS.find((x) => x.id === id); if (!t) return;
    const ov = document.createElement("div");
    ov.id = "scr-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box nw-box" role="dialog" aria-label="Rule ${t.n}">
      <div class="nw-h"><b>Rule ${t.n} · Bet ${t.side === "over" ? "Over" : "Under"}</b><button class="nw-x" aria-label="Close">✕</button></div>
      <p class="small"><b>${esc(t.title)}.</b> ${t.desc()}</p>
      <p class="small"><b>Why it might work</b> (an interpretation, not proven): ${esc(t.why)}</p>
      <p class="small">${recLine(t)} Picked from many conditions tested on weeks 1–7, so the real rate is likely lower; break-even at −110 is about 52.4%.</p>
      <p class="muted small">${UNIVERSE}${t.spread ? " " + SPREAD_NOTE : ""}</p></div>`;
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
  function html() {
    const mks = D.markets, gopts = gameOptions();
    if (RL.gid && !gopts.some(([g]) => g === RL.gid)) RL.gid = ""; // that game started or has no lines: back to all games
    return `<section id="rl"><h2 class="gsec">Leads</h2>
      <div class="rlgrid rl8" role="tablist">${visibleTabs().map((t) => `<button class="gchip ${t.id === RL.tab ? "on" : ""}" data-rtab="${t.id}"><span class="rl-n">${t.n}</span> ${esc(t.label)} <span class="rinfo" role="button" tabindex="0" data-rinfo="${t.id}" aria-label="About rule ${t.n}" title="About this rule">i</span></button>`).join("")}${signedIn() ? "" : `<button type="button" class="gchip rl-lock" data-rlsignin>🔒 Sign in to see all ${TABS.length}</button>`}</div>
      <div class="filters"><label>Stat <select id="rl-mk"><option value="">All stats</option>${mks.map((m) => `<option value="${m.id}" ${m.id === RL.mk ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label>
        <label>Game <select id="rl-gid"><option value="">All games</option>${gopts.map(([g, ko]) => `<option value="${esc(g)}" ${g === RL.gid ? "selected" : ""}>${esc(gameLabel(g))} · ${fmtTime(ko)}</option>`).join("")}</select></label></div>
      <div id="rl-body">${body()}</div></section>`;
  }
  function redraw() {
    const el = document.getElementById("rl"); if (!el) return;
    el.outerHTML = html();
    const an = document.getElementById("la"); if (an) an.outerHTML = analysisHtml(); // rules 4–8 follow sign-in here too
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rtab]"); if (!b) return;
    RL.tab = b.dataset.rtab; redraw();
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
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "rl-mk") { RL.mk = e.target.value; redraw(); } });
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "rl-gid") { RL.gid = e.target.value; redraw(); } });
  function safeHtml() { try { return html(); } catch (e) { console.error("research leads failed", e); return ""; } }

  // ---------- Leads Analysis (Michael 2026-10-30): how one rule did in one week, optionally one game ----------
  // Scores exactly like claude/frozen-theses.md's frozen.py: slotted players, final games, graded pre-game line with
  // both saved odds, result over/under/push (voids skipped), 1 unit at that line's saved odds for the rule's side.
  // "Last week" = his most recent earlier final game; spread = data.json games[gid].spread (nflverse spread_line).
  const LA = { tab: "t1", wk: null, gid: "" };
  const payout = (o) => (o > 0 ? o / 100 : 100 / Math.abs(o));
  function ruleHits(r, mid, m, p, past, played, prev) {
    const pm = prev && prev.m ? prev.m[mid] : null;
    const pl = pm && pm.lstat === "ok" && pm.line != null ? pm.line : null;
    const f = favBy(r), hits = [];
    if (r.slot === "WR2" && pm && pm.res === "over") hits.push("t1");
    if (r.ha === "away" && pl != null && m.line > pl) hits.push("t2");
    if (r.slot === "TE1" && mid === "rec_yds") hits.push("t3");
    if (r.slot === "QB1" && mid === "rush_yds") hits.push("t4");
    if (p.pos !== "QB" && pl != null) {
      const us = played.map((x) => usageOf(p.pos, x)).filter((u) => u != null);
      if (us.length >= USAGE_N + 2) {
        const early = us.slice(0, -USAGE_N), drop = us.slice(-USAGE_N).reduce((a, b) => a + b, 0) / USAGE_N - early.reduce((a, b) => a + b, 0) / early.length;
        const tol = COUNT_MKTS.includes(mid) ? FLAT.count : mid === "pass_yds" ? FLAT.pass_yds : FLAT.yds;
        if (drop <= -(p.pos === "RB" ? USAGE_DROP.snap : USAGE_DROP.tshare) && Math.abs(m.line - pl) <= tol) hits.push("t5");
      }
    }
    if (f != null && f >= BIG_SPREAD && p.pos === "RB" && mid === "rush_yds") hits.push("t6");
    if (f != null && f <= -BIG_SPREAD && mid === "pass_yds") hits.push("t7");
    if (f != null && f <= -BIG_SPREAD && (p.pos === "WR" || p.pos === "TE") && mid === "rec_yds") hits.push("t8");
    return { hits, pm, pl, f };
  }
  // Every graded bet one rule made in one week: [{p, r, mid, m, side, out: "hit"|"miss"|"push", u, pm, pl, f}]
  function analyze(tab, wk) {
    const t = TABS.find((x) => x.id === tab), out = [];
    for (const p of D.players) {
      if (p.extra) continue;
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
          out.push({ p, r, mid, m, side: t.side, out: o, u: o === "hit" ? payout(odds) : o === "miss" ? -1 : 0, odds, ...x });
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
    const t = x.r, line = num(x.m.line);
    switch (LA.tab) {
      case "t1": return `Last game ${num(x.pm.act)} vs ${num(x.pl)} line (over)`;
      case "t2": return `Line ${num(x.pl)} → ${line} · @ ${esc(t.opp)}`;
      case "t5": return `Line ${num(x.pl)} → ${line}`;
      case "t6": case "t7": case "t8": return esc(spreadTxt(x.f));
      default: return "";
    }
  }
  function laRow(x) {
    const { p, r, mid, m } = x;
    const cls = x.out === "hit" ? "la-hit" : x.out === "miss" ? "la-miss" : "la-push";
    const w = why(x);
    return `<div class="rlrow ${cls}"><div class="rlhead"><span class="la-mark" aria-hidden="true">${x.out === "hit" ? "✓" : x.out === "miss" ? "✗" : "–"}</span><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>
        <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${x.out === "push" ? "push" : unitsTxt(x.u)}</span></div>
      <div class="muted small">${esc(p.pos)} · ${esc(r.slot || "")} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)}</div>
      <div class="rlcells"><span><span class="muted small">${x.side === "over" ? "Over" : "Under"}</span> <b>${num(m.line)}</b> <span class="muted small">${odds(x.odds)}</span></span><span><span class="muted small">Actual</span> <b>${num(m.act)}</b></span>${w ? `<span class="muted small">${w}</span>` : ""}</div></div>`;
  }
  function analysisBody() {
    const t = TABS.find((x) => x.id === LA.tab);
    const all = analyze(LA.tab, LA.wk);
    const games = laGames(LA.wk), nFinal = games.filter(([, g]) => g.final).length;
    const list = LA.gid ? all.filter((x) => x.r.gid === LA.gid) : all;
    const s = tally(list);
    const scope = LA.gid ? esc(gameLabel(LA.gid)) : `Week ${LA.wk}${nFinal < games.length ? ` (${nFinal} of ${games.length} games final)` : ""}`;
    let h = `<p class="callout small"><b>${t.n}. ${esc(t.title)}.</b> ${sideChip(t)}<br><span class="muted">${LA.wk <= 7 ? "Weeks 1–7 are the weeks this rule was picked from (in-sample), so these results flatter it." : "Week 8 on: weeks the rule had never seen when it was frozen (out-of-sample)."}</span></p>`;
    if (t.spread && !Object.values(D.games).some((g) => g.wk === LA.wk && g.spread != null)) return h + `<p class="muted">No point spreads in the app's data for week ${LA.wk}, so this rule can't be scored.</p>`;
    h += `<div class="la-sum"><div><span class="muted small">${scope}</span><b>${recTxt(s)}</b></div><div><span class="muted small">Hit rate</span><b>${s.hit == null ? "—" : s.hit.toFixed(1) + "%"}</b></div><div><span class="muted small">Units</span><b class="${s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : ""}">${s.n ? unitsTxt(s.U) : "—"}</b></div><div><span class="muted small">ROI</span><b>${s.roi == null ? "—" : (s.roi > 0 ? "+" : s.roi < 0 ? "−" : "") + Math.abs(s.roi).toFixed(1) + "%"}</b></div></div>`;
    if (!LA.gid && all.length) {
      // per-game breakdown; tap a game to see only it
      const by = new Map();
      for (const x of all) { if (!by.has(x.r.gid)) by.set(x.r.gid, []); by.get(x.r.gid).push(x); }
      h += `<div class="panel la-games">${games.filter(([g]) => by.has(g)).map(([g]) => { const st = tally(by.get(g)); return `<button type="button" class="la-game" data-lagid="${esc(g)}"><span>${esc(gameLabel(g))}</span><span class="muted small">${recTxt(st)} · ${st.n ? unitsTxt(st.U) : "push"}</span><span class="muted">›</span></button>`; }).join("")}</div>`;
    }
    if (!list.length) return h + `<p class="muted">${LA.gid && !(D.games[LA.gid] || {}).final ? "This game isn't final yet." : `No graded bets for rule ${t.n} ${LA.gid ? "in this game" : `in week ${LA.wk}`}.`}</p>`;
    const sortK = (a, b) => (a.r.ko || "").localeCompare(b.r.ko || "") || a.r.gid.localeCompare(b.r.gid) || a.p.name.localeCompare(b.p.name) || a.mid.localeCompare(b.mid);
    const grp = (k, title) => { const g = list.filter((x) => x.out === k).sort(sortK); return g.length ? `<h3 class="la-h ${k}">${title} (${g.length})</h3><div class="panel rlist">${g.map(laRow).join("")}</div>` : ""; };
    return h + grp("hit", "Hits") + grp("miss", "Misses") + grp("push", "Pushes") +
      `<p class="muted small">Graded on the pre-game line (~3 h before kickoff) at its saved odds, 1 unit per bet; voids and lines without both saved odds are left out. Same scoring as the rule's frozen record.</p>`;
  }
  function analysisHtml() {
    const weeks = laWeeks();
    if (!weeks.length) return `<section id="la"></section>`;
    const tabs = visibleTabs();
    if (!tabs.some((t) => t.id === LA.tab)) LA.tab = tabs[0].id;
    if (LA.wk == null || !weeks.includes(LA.wk)) LA.wk = weeks[0];
    const games = laGames(LA.wk);
    if (LA.gid && !games.some(([g]) => g === LA.gid)) LA.gid = "";
    let body;
    try { body = analysisBody(); } catch (e) { console.error("leads analysis failed", e); body = `<p class="muted">Leads Analysis hit an error. Try refreshing.</p>`; }
    return `<section id="la"><h2 class="gsec">Leads Analysis</h2>
      <div class="filters"><label>Lead <select id="la-tab">${tabs.map((t) => `<option value="${t.id}" ${t.id === LA.tab ? "selected" : ""}>${t.n}. ${esc(t.label)}</option>`).join("")}</select></label>
        <label>Week <select id="la-wk">${weeks.map((w) => `<option value="${w}" ${w === LA.wk ? "selected" : ""}>Week ${w}</option>`).join("")}</select></label>
        <label>Game <select id="la-gid"><option value="">All games</option>${games.map(([g, x]) => `<option value="${esc(g)}" ${g === LA.gid ? "selected" : ""}>${esc(gameLabel(g))}${x.final ? "" : " (not final)"}</option>`).join("")}</select></label></div>
      ${signedIn() ? "" : `<p class="muted small">Rules 4–8 appear here after you sign in, same as the Leads above.</p>`}
      <div id="la-body">${body}</div></section>`;
  }
  function laRedraw() { const el = document.getElementById("la"); if (el) el.outerHTML = analysisHtml(); }
  document.addEventListener("change", (e) => {
    const id = e.target && e.target.id;
    if (id === "la-tab") { LA.tab = e.target.value; laRedraw(); }
    if (id === "la-wk") { LA.wk = +e.target.value; LA.gid = ""; laRedraw(); }
    if (id === "la-gid") { LA.gid = e.target.value; laRedraw(); }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-lagid]"); if (!b) return;
    LA.gid = b.dataset.lagid; laRedraw();
    const el = document.getElementById("la"); if (el) el.scrollIntoView({ block: "start" });
  });
  function safeAnalysis() { try { return analysisHtml(); } catch (e) { console.error("leads analysis failed", e); return ""; } }
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
  window.STIX_RESEARCH = { html: safeHtml, analysis: safeAnalysis, analyze, compute, TABS, badge, oppLink, settingsHtml: safeSettings };
})();
