"use strict";
// Stix Research tab: pre-built "Leads" filters shown as tabs above the builder (search.js).
// Uses only data already in data.json (players' per-game rows, lines, usage; game final scores for the game-script tabs).
// Every rule is spelled out in the tab's description so a reader can check it. These are leads, not predictions.
(function () {
  const RL = { tab: "move", mk: "" };
  const SCRIPT_MARGIN = 10;       // a game counts as lopsided when the final margin is 10+ points
  const USAGE_RISE = { tshare: 5, snap: 10 }; // percentage points (last 2 games vs his earlier games)
  const FLAT = { count: 0.5, yds: 5, pass_yds: 10 }; // "line unchanged" tolerance
  const COUNT_MKTS = ["rec", "rush_att", "pass_att", "pass_cmp"];
  const SD_GAMES = 8;             // games used for his usual game-to-game swing

  const TABS = [
    { id: "move", label: "Line move", title: "Lines that moved most from his last game's line",
      desc: () => `This week's line (pre-game line if captured, otherwise the latest Mon / Thu / Sun AM snapshot) vs the graded pre-game line from his previous game, same stat. Ranked by <b>size</b> = change ÷ his usual game-to-game swing in that stat (standard deviation of his last ${SD_GAMES} games played, min 3), so a 1.5 → 2.5 receptions move and a 60.5 → 70.5 yards move are compared fairly. No percentages.` },
    { id: "l3", label: "Last 3 vs line", title: "Last 3 games average furthest from this week's line",
      desc: () => `His average over his last 3 games played vs this week's line. Ranked by <b>size</b> = gap ÷ his usual game-to-game swing (standard deviation of his last ${SD_GAMES} games played, min 3).` },
    { id: "usage", label: "Usage up, line flat", title: "Rising usage, line unchanged",
      desc: () => `Usage = target share for WR/TE, snap share for RB (QBs not included). Rising = average of his last 2 games is at least <b>${USAGE_RISE.tshare} points</b> of target share (WR/TE) or <b>${USAGE_RISE.snap} points</b> of snap share (RB) above his average in his earlier games this season (min 2 earlier games). Line unchanged = within ±${FLAT.count} for receptions / carries, ±${FLAT.yds} for rushing and receiving yards, compared with his previous game's line. Ranked by the usage rise.` },
    { id: "usagedn", label: "Usage down, line flat", title: "Falling usage, line unchanged",
      desc: () => `The inverse of Usage up. Usage = target share for WR/TE, snap share for RB (QBs not included). Falling = average of his last 2 games is at least <b>${USAGE_RISE.tshare} points</b> of target share (WR/TE) or <b>${USAGE_RISE.snap} points</b> of snap share (RB) below his average in his earlier games this season (min 2 earlier games). Line unchanged = within ±${FLAT.count} for receptions / carries, ±${FLAT.yds} for rushing and receiving yards, compared with his previous game's line. Ranked by the usage drop.` },
    { id: "down", label: "Bad script, line down", title: "Line lowered after a game script that worked against him",
      desc: () => scriptDesc("against him", "under", "lower") },
    { id: "up", label: "Good script, line up", title: "Line raised after a game script that helped him",
      desc: () => scriptDesc("in his favor", "over", "higher") },
  ];
  function scriptDesc(way, ou, hl) {
    return `His previous game was lopsided (final margin <b>${SCRIPT_MARGIN}+ points</b>) ${way}, he finished <b>${ou}</b> that game's line, and this week's line is <b>${hl}</b>. Game script rule of thumb: a big lead means more running and fewer passes, so a big <b>win</b> helps RBs and works against QBs, WRs and TEs; a big <b>loss</b> (playing from behind) means more passing, which helps QBs, WRs and TEs and works against RBs. Based on the final score only, not how the game unfolded. Ranked by size of the line change ÷ his usual game-to-game swing.`;
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
  function teamResult(gid, team) {
    const g = D.games[gid];
    if (!g || g.as == null || g.hs == null) return null;
    const home = g.home === team, us = home ? g.hs : g.as, them = home ? g.as : g.hs;
    return { margin: us - them, txt: `${us > them ? "W" : us < them ? "L" : "T"} ${us}–${them} ${home ? "vs" : "@"} ${home ? g.away : g.home}` };
  }
  // script for a position given the team's final margin: +1 helped, -1 hurt, 0 neither
  function scriptFor(pos, margin) {
    if (Math.abs(margin) < SCRIPT_MARGIN) return 0;
    const won = margin > 0;
    return pos === "RB" ? (won ? 1 : -1) : (won ? -1 : 1);
  }
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
        out.push({ c, size: c.sd ? Math.abs(ch) / c.sd : null, main: ch, cells: [`${num(pl)} → <b>${num(c.cur.line)}</b>`, `<b>${signed(ch)}</b>`] });
      } else if (tab === "l3") {
        const l3 = c.acts.slice(-3); if (l3.length < 3) continue;
        const avg = l3.reduce((a, b) => a + b, 0) / 3, gap = avg - c.cur.line;
        out.push({ c, size: c.sd ? Math.abs(gap) / c.sd : null, main: gap, cells: [`<b>${num(c.cur.line)}</b>`, `${num(avg)} <span class="muted small">(${l3.map((v) => num(v, 0)).join(", ")})</span>`, `<b>${signed(gap)}</b>`] });
      } else if (tab === "usage" || tab === "usagedn") {
        const pos = c.p.pos; if (pos === "QB") continue;
        const us = c.played.map((x) => usageOf(pos, x)).filter((v) => v != null);
        if (us.length < 4) continue;
        const last2 = us.slice(-2), early = us.slice(0, -2);
        const a2 = (last2[0] + last2[1]) / 2, ae = early.reduce((a, b) => a + b, 0) / early.length, rise = a2 - ae;
        const need = pos === "RB" ? USAGE_RISE.snap : USAGE_RISE.tshare;
        if (tab === "usage" ? rise < need : rise > -need) continue;
        if (pl == null) continue;
        const tol = COUNT_MKTS.includes(c.mid) ? FLAT.count : c.mid === "pass_yds" ? FLAT.pass_yds : FLAT.yds;
        if (Math.abs(c.cur.line - pl) > tol) continue;
        const kind = pos === "RB" ? "snap" : "tgt share";
        out.push({ c, size: Math.abs(rise), main: rise, cells: [`${num(pl)} → <b>${num(c.cur.line)}</b>`, `${kind} ${Math.round(ae)}% → <b>${Math.round(a2)}%</b> <span class="muted small">(last 2: ${last2.map((v) => Math.round(v) + "%").join(", ")})</span>`] });
      } else if (tab === "down" || tab === "up") {
        if (pl == null || !c.prev || c.pm.act == null) continue;
        const tr = teamResult(c.prev.gid, c.r.team); if (!tr) continue;
        const sc = scriptFor(c.p.pos, tr.margin), ch = c.cur.line - pl;
        const want = tab === "up" ? 1 : -1;
        if (sc !== want) continue;
        if (want === 1 ? !(c.pm.act > pl && ch > 0) : !(c.pm.act < pl && ch < 0)) continue;
        out.push({ c, size: c.sd ? Math.abs(ch) / c.sd : null, main: ch, cells: [`${esc(tr.txt)}`, `${num(c.pm.act)} vs ${num(pl)}`, `${num(pl)} → <b>${num(c.cur.line)}</b> <b>${signed(ch)}</b>`] });
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
    const scoresMissing = (t.id === "down" || t.id === "up") && !Object.values(D.games).some((g) => g.as != null);
    let h = `<p class="callout small"><b>${esc(t.title)}.</b> ${t.desc()} Leads for research, not predictions.</p>`;
    if (scoresMissing) return h + `<p class="muted">Final scores aren't in the app's data yet, so this tab can't be filled.</p>`;
    if (!list.length) return h + `<p class="muted">No upcoming lines match right now. Lines for most games arrive Monday night to Tuesday; this fills in as they do.</p>`;
    const heads = HEADS[t.id];
    h += `<div class="panel rlist">`;
    for (const x of list.slice(0, 40)) {
      const { p, r, mid, cur } = x.c;
      const size = x.size == null ? "" : t.id === "usage" || t.id === "usagedn" ? `${t.id === "usage" ? "+" : "−"}${Math.round(x.size)} pts` : `size ${num(x.size, 2)}`;
      h += `<div class="rlrow"><div class="rlhead"><a class="pname" href="#/player/${p.id}">${esc(p.name)}</a>${p.extra ? ` <span class="chip xtra">extra</span>` : ""}
          <span class="rlstat">${esc(mkt[mid].label)}</span><span class="rlsize">${size}</span></div>
        <div class="muted small">${esc(p.pos)} · ${esc(r.team)} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${fmtTime(r.ko)} · line from ${esc(cur.label)}</div>
        <div class="rlcells">${x.cells.map((v, k) => `<span><span class="muted small">${heads[k]}</span> ${v}</span>`).join("")}</div></div>`;
    }
    return h + `</div>${list.length > 40 ? `<p class="muted small">Showing the top 40 of ${list.length}.</p>` : ""}`;
  }

  // 3 columns, each a pair with its inverse stacked: line move / last 3; usage up / down; good script / bad script
  const GRID = ["move", "usage", "up", "l3", "usagedn", "down"];
  function html() {
    const mks = D.markets;
    return `<section id="rl"><h2 class="gsec">Leads</h2>
      <div class="rlgrid" role="tablist">${GRID.map((id) => { const t = TABS.find((x) => x.id === id); return `<button class="gchip ${t.id === RL.tab ? "on" : ""}" data-rtab="${t.id}">${esc(t.label)}</button>`; }).join("")}</div>
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
  document.addEventListener("change", (e) => { if (e.target && e.target.id === "rl-mk") { RL.mk = e.target.value; redraw(); } });

  function safeHtml() { try { return html(); } catch (e) { console.error("research leads failed", e); return ""; } }
  window.STIX_RESEARCH = { html: safeHtml, compute, TABS };
})();
