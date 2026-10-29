"use strict";
// Stix Research tab: pre-built "Leads" filters shown as tabs above the builder (search.js).
// Uses only data already in data.json (players' per-game rows, lines, usage; game script minutes from play-by-play).
// Every rule is spelled out in the tab's description so a reader can check it. These are leads, not predictions.
(function () {
  const RL = { tab: "move", mk: "" };
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
  const USAGE_RISE = { tshare: 5, snap: 10 }; // percentage points (his recent games vs his earlier games)
  // How many recent games count as "recent" for Usage up / down (slider on those tabs; saved in this browser).
  // Default 2 = the rule before the slider existed, so nothing changes unless it's moved.
  const USAGE_GAMES_DEFAULT = 2, USAGE_GAMES_MIN = 1, USAGE_GAMES_MAX = 4;
  const UG = (() => {
    try { const v = +localStorage.getItem("stix_usage_games"); if (v >= USAGE_GAMES_MIN && v <= USAGE_GAMES_MAX) return { n: v }; } catch { /* default */ }
    return { n: USAGE_GAMES_DEFAULT };
  })();
  const gamesTxt = (n) => (n === 1 ? "his last game" : `his last ${n} games`);
  const FLAT = { count: 0.5, yds: 5, pass_yds: 10 }; // "line unchanged" tolerance
  const COUNT_MKTS = ["rec", "rush_att", "pass_att", "pass_cmp"];
  const SD_GAMES = 8;             // games used for his usual game-to-game swing

  const TABS = [
    { id: "move", label: "Line move", title: "Largest line moves from previous week",
      desc: () => `This week's line (pre-game line if captured, otherwise the latest Mon / Thu / Sun AM snapshot) vs the graded pre-game line from his previous game, same stat. Ranked by <b>size</b> = change ÷ √(last game's line). Bigger lines naturally move more, but not in proportion, so this sits between raw change (which favors big yardage lines) and percent change (which favors tiny lines). Examples: rec yds 77.5 → 68.5 = 1.02; rush yds 11.5 → 10.5 = 0.29; receptions 1.5 → 2.5 = 0.82; pass yds 289.5 → 259.5 = 1.76. A size of 1 is a move of about √line (about 9 rec yds on an 80.5 line, 2.3 catches on 5.5, 16 pass yds on 250.5).` },
    { id: "l3", label: "Last 3 vs line", title: "Last 3 games average furthest from this week's line",
      desc: () => `His average over his last 3 games played vs this week's line. Ranked by <b>size</b> = gap ÷ his usual game-to-game swing (standard deviation of his last ${SD_GAMES} games played, min 3).` },
    { id: "usage", label: "Usage up, line flat", title: "Rising usage, line unchanged",
      desc: () => `Usage = target share for WR/TE, snap share for RB (QBs not included). Rising = average of ${gamesTxt(UG.n)} is at least <b>${USAGE_RISE.tshare} points</b> of target share (WR/TE) or <b>${USAGE_RISE.snap} points</b> of snap share (RB) above his average in his earlier games this season (min 2 earlier games). Line unchanged = within ±${FLAT.count} for receptions / carries, ±${FLAT.yds} for rushing and receiving yards, compared with his previous game's line. Ranked by the usage rise.` },
    { id: "usagedn", label: "Usage down, line flat", title: "Falling usage, line unchanged",
      desc: () => `The inverse of Usage up. Usage = target share for WR/TE, snap share for RB (QBs not included). Falling = average of ${gamesTxt(UG.n)} is at least <b>${USAGE_RISE.tshare} points</b> of target share (WR/TE) or <b>${USAGE_RISE.snap} points</b> of snap share (RB) below his average in his earlier games this season (min 2 earlier games). Line unchanged = within ±${FLAT.count} for receptions / carries, ±${FLAT.yds} for rushing and receiving yards, compared with his previous game's line. Ranked by the usage drop.` },
    { id: "down", label: "Bad script, line down", title: "Line lowered after a game script that worked against him",
      desc: () => scriptDesc("against him", "under", "lower") },
    { id: "up", label: "Good script, line up", title: "Line raised after a game script that helped him",
      desc: () => scriptDesc("in his favor", "over", "higher") },
  ];
  function scriptDesc(way, ou, hl) {
    return `In his previous game the game script went ${way}, he finished <b>${ou}</b> that game's line, and this week's line is <b>${hl}</b>. Game script = how long his team spent with a big lead or deficit: <b>led big</b> = ahead by ${SCRIPT.margin}+ points for at least ${SCRIPT.minutes} of the game's minutes, <b>trailed big</b> = behind by ${SCRIPT.margin}+ for at least ${SCRIPT.minutes} minutes (from nflverse play-by-play; <a href="#/guide">change the margin and minutes on the Guide tab</a>). Rule of thumb: a team with a big lead runs more and passes less, so leading big helps RBs and works against QBs, WRs and TEs; playing from far behind means more passing, which helps QBs, WRs and TEs and works against RBs. Ranked by size of the line change ÷ √(last game's line), as on Line move.`;
  }

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

  // Every upcoming (not started) player × market with a line showing, plus his history.
  function candidates() {
    const now = Date.now(), out = [];
    for (const p of D.players) {
      if (p.extra && !S.all) continue;
      const rows = D.rows[p.id] || [];
      for (const r of rows) {
        if (r.final || !r.ko || new Date(r.ko).getTime() <= now) continue;
        const past = rows.filter((x) => x.wk < r.wk && x.final).sort((a, b) => a.wk - b.wk);
        const played = past.filter((x) => x.played === true);
        const prev = past[past.length - 1] || null;
        for (const [mid, m] of Object.entries(r.m || {})) {
          if (RL.mk && mid !== RL.mk) continue;
          const cur = curLine(m); if (!cur) continue;
          const acts = played.map((x) => x.m && x.m[mid] ? x.m[mid].act : null).filter((v) => v != null);
          const pm = prev && prev.m ? prev.m[mid] : null;
          out.push({ p, r, mid, m, cur, past, played, prev, pm, acts, sd: sd(acts.slice(-SD_GAMES)) });
        }
      }
    }
    return out;
  }
  const prevLine = (c) => (c.pm && c.pm.lstat === "ok" && c.pm.line != null ? c.pm.line : null);

  function compute(tab) {
    const out = [];
    for (const c of candidates()) {
      const pl = prevLine(c);
      if (tab === "move") {
        if (pl == null) continue;
        const ch = c.cur.line - pl; if (!ch) continue;
        out.push({ c, size: pl > 0 ? Math.abs(ch) / Math.sqrt(pl) : null, main: ch, cells: [`${num(pl)} → <b>${num(c.cur.line)}</b>`, `<b>${signed(ch)}</b>`] });
      } else if (tab === "l3") {
        const l3 = c.acts.slice(-3); if (l3.length < 3) continue;
        const avg = l3.reduce((a, b) => a + b, 0) / 3, gap = avg - c.cur.line;
        out.push({ c, size: c.sd ? Math.abs(gap) / c.sd : null, main: gap, cells: [`<b>${num(c.cur.line)}</b>`, `${num(avg)} <span class="muted small">(${l3.map((v) => num(v, 0)).join(", ")})</span>`, `<b>${signed(gap)}</b>`] });
      } else if (tab === "usage" || tab === "usagedn") {
        const pos = c.p.pos; if (pos === "QB") continue;
        const us = c.played.map((x) => usageOf(pos, x)).filter((v) => v != null);
        const N = UG.n;
        if (us.length < N + 2) continue; // N recent games + at least 2 earlier
        const last2 = us.slice(-N), early = us.slice(0, -N);
        const a2 = last2.reduce((a, b) => a + b, 0) / N, ae = early.reduce((a, b) => a + b, 0) / early.length, rise = a2 - ae;
        const need = pos === "RB" ? USAGE_RISE.snap : USAGE_RISE.tshare;
        if (tab === "usage" ? rise < need : rise > -need) continue;
        if (pl == null) continue;
        const tol = COUNT_MKTS.includes(c.mid) ? FLAT.count : c.mid === "pass_yds" ? FLAT.pass_yds : FLAT.yds;
        if (Math.abs(c.cur.line - pl) > tol) continue;
        const kind = pos === "RB" ? "snap" : "tgt share";
        out.push({ c, size: Math.abs(rise), main: rise, cells: [`${num(pl)} → <b>${num(c.cur.line)}</b>`, `${kind} ${Math.round(ae)}% → <b>${Math.round(a2)}%</b> <span class="muted small">(last ${N}: ${last2.map((v) => Math.round(v) + "%").join(", ")})</span>`] });
      } else if (tab === "down" || tab === "up") {
        if (pl == null || !c.prev || c.pm.act == null) continue;
        const info = scriptInfo(c.prev.gid, c.r.team); if (!info) continue;
        const sc = scriptFor(c.p.pos, info), ch = c.cur.line - pl;
        const want = tab === "up" ? 1 : -1;
        if (sc !== want) continue;
        if (want === 1 ? !(c.pm.act > pl && ch > 0) : !(c.pm.act < pl && ch < 0)) continue;
        out.push({ c, size: pl > 0 ? Math.abs(ch) / Math.sqrt(pl) : null, main: ch, cells: [`${esc(scriptTxt(info))} <span class="muted small">(${esc(info.score)})</span>`, `${num(c.pm.act)} vs ${num(pl)}`, `${num(pl)} → <b>${num(c.cur.line)}</b> <b>${signed(ch)}</b>`] });
      }
    }
    out.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || Math.abs(b.main) - Math.abs(a.main));
    return out;
  }
  const HEADS = {
    move: ["Last game → this week", "Change"],
    l3: ["Line", "Last 3 avg", "Avg − line"],
    usage: ["Line (last game → now)", "Usage"],
    usagedn: ["Line (last game → now)", "Usage"],
    down: ["Last game", "His stat vs line", "Line change"],
    up: ["Last game", "His stat vs line", "Line change"],
  };

  function body() {
    const t = TABS.find((x) => x.id === RL.tab) || TABS[0];
    const list = compute(t.id);
    const scoresMissing = (t.id === "down" || t.id === "up") && !Object.values(D.games).some((g) => g.scr);
    let h = `<p class="callout small"><b>${esc(t.title)}.</b></p>`; // full rules: Good / Bad script behind the "i" on their buttons
    if (scoresMissing) return h + `<p class="muted">Game script data (nflverse play-by-play) isn't in the app's data yet, so this tab can't be filled.</p>`;
    if (!list.length) return h + `<p class="muted">No upcoming lines match right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do.</p>`;
    const heads = HEADS[t.id];
    h += `<div class="panel rlist">`;
    for (const x of list.slice(0, 40)) {
      const { p, r, mid, cur } = x.c;
      const size = x.size == null ? "" : t.id === "usage" || t.id === "usagedn" ? `${t.id === "usage" ? "+" : "−"}${Math.round(x.size)} pts` : `size ${num(x.size, 2)}`;
      h += `<div class="rlrow"><div class="rlhead"><a class="pname" href="#/player/${p.id}" data-rpid="${esc(p.id)}" data-rmid="${esc(mid)}">${esc(p.name)}</a>${p.extra ? ` <span class="chip xtra">extra</span>` : ""}
          <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${size}</span></div>
        <div class="muted small">${esc(p.pos)} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)} · line from ${esc(cur.label)}</div>
        <div class="rlcells">${x.cells.map((v, k) => `<span><span class="muted small">${heads[k]}</span> ${v}</span>`).join("")}</div></div>`;
    }
    return h + `</div>${list.length > 40 ? `<p class="muted small">Showing the top 40 of ${list.length}.</p>` : ""}`;
  }

  // 3 columns, each a pair with its inverse stacked: line move / last 3; usage up / down; good script / bad script
  const GRID = ["move", "usage", "up", "l3", "usagedn", "down"];
  // Filters whose full description opens from an "i" on the button.
  const INFO_TABS = ["usage", "usagedn", "up", "down"];
  // Usage up / down "i" pop-up also holds the recent-games slider (Michael, 2026-10-28).
  const ugSlider = () => `<div class="filters rl-ugbox"><label class="rl-ug">Recent games vs his earlier games${UG.n === USAGE_GAMES_DEFAULT ? " (default)" : ""}<span class="rl-ugrow"><input id="rl-ug" type="range" min="${USAGE_GAMES_MIN}" max="${USAGE_GAMES_MAX}" step="1" value="${UG.n}" aria-label="Recent games used for usage"> <b id="rl-ugv">${UG.n}</b></span></label></div>`;
  let infoId = null;
  function openInfo(id) {
    closePop();
    const t = TABS.find((x) => x.id === id); if (!t) return;
    infoId = id;
    // Usage pop-ups: show that filter's list behind it, so moving the slider changes what's on screen.
    if ((id === "usage" || id === "usagedn") && RL.tab !== id) { RL.tab = id; redraw(); }
    const ov = document.createElement("div");
    ov.id = "scr-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box nw-box" role="dialog" aria-label="${esc(t.label)}">
      <div class="nw-h"><b>${esc(t.label)}</b><button class="nw-x" aria-label="Close">✕</button></div>
      ${id === "usage" || id === "usagedn" ? ugSlider() : ""}<p class="small" id="rl-infodesc"><b>${esc(t.title)}.</b> ${t.desc()} Leads for research, not predictions.</p></div>`;
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
    const mks = D.markets;
    return `<section id="rl"><h2 class="gsec">Leads</h2>
      <div class="rlgrid" role="tablist">${GRID.map((id) => { const t = TABS.find((x) => x.id === id); return `<button class="gchip ${t.id === RL.tab ? "on" : ""}" data-rtab="${t.id}">${esc(t.label)}${INFO_TABS.includes(t.id) ? ` <span class="rinfo" role="button" tabindex="0" data-rinfo="${t.id}" aria-label="About ${esc(t.label)}" title="About this filter">i</span>` : ""}</button>`; }).join("")}</div>
      <div class="filters"><label>Stat <select id="rl-mk"><option value="">All stats</option>${mks.map((m) => `<option value="${m.id}" ${m.id === RL.mk ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label></div>
      <div id="rl-body">${body()}</div></section><h2 class="gsec">Builder</h2>`;
  }
  function redraw() {
    const el = document.getElementById("rl"); if (!el) return;
    el.outerHTML = html().replace(/<h2 class="gsec">Builder<\/h2>$/, "");
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rtab]"); if (!b) return;
    RL.tab = b.dataset.rtab; redraw();
  });
  // Opening a player from a lead shows the lead's stat on his player page (same per-player choice the stat tabs set).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-rmid]"); if (!a) return;
    try { S.market[a.dataset.rpid] = a.dataset.rmid; } catch (err) { console.error(err); }
  }, true);
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "rl-mk") { RL.mk = e.target.value; redraw(); } });
  // Usage slider: number updates while dragging; the list redraws when it's let go.
  document.addEventListener("input", (e) => { if (e.target && e.target.id === "rl-ug") { const v = document.getElementById("rl-ugv"); if (v) v.textContent = e.target.value; } });
  document.addEventListener("change", (e) => {
    if (!e.target || e.target.id !== "rl-ug") return;
    UG.n = Math.min(USAGE_GAMES_MAX, Math.max(USAGE_GAMES_MIN, +e.target.value || USAGE_GAMES_DEFAULT));
    try { localStorage.setItem("stix_usage_games", String(UG.n)); } catch { /* setting just won't persist */ }
    redraw();
    // refresh the open pop-up so its rule text and "(default)" match the new setting
    const box = document.querySelector("#scr-ov .rl-ugbox"), d = document.getElementById("rl-infodesc");
    const t = TABS.find((x) => x.id === infoId);
    if (box) box.outerHTML = ugSlider();
    if (d && t) d.innerHTML = `<b>${esc(t.title)}.</b> ${t.desc()} Leads for research, not predictions.`;
    const s = document.getElementById("rl-ug"); if (s) s.focus();
  });

  function safeHtml() { try { return html(); } catch (e) { console.error("research leads failed", e); return ""; } }
  // ---------- Guide tab setting ----------
  function settingsHtml() {
    const ms = scriptMargins();
    if (!ms.length) return "";
    const sel = (id, val, opts, suffix) => `<select id="${id}">${opts.map((v) => `<option value="${v}" ${v === val ? "selected" : ""}>${v}${suffix}</option>`).join("")}</select>`;
    const isDef = SCRIPT.margin === SCRIPT_DEFAULT.margin && SCRIPT.minutes === SCRIPT_DEFAULT.minutes;
    return `<div class="panel" id="g-script"><h3>Game script setting</h3><div class="body">
      <p class="callout">A team <b>led big</b> (or <b>trailed big</b>) in a game when it was ahead (or behind) by at least the margin below for at least the minutes below, out of 60. Used by the <b>Led big / Trailed big</b> chips in player game logs and the <b>Good script / Bad script</b> filters on the Research tab. Saved in this browser only.</p>
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
  window.STIX_RESEARCH = { html: safeHtml, compute, TABS, badge, oppLink, settingsHtml: safeSettings };
})();
