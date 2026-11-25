"use strict";
// Team view (More+ menu, NFL side, #/team). UI only: it reads data the Board already loads (slots, rows, defrank) and
// changes nothing in the pipeline or the stored data. Each game chip has two tap targets, one per team; the picked team's
// offense is drawn as an 11-man formation (QB, RB, TE, three WRs; the five linemen are plain dots) with the picked
// market's line for each skill player, above the opposing defense's Run / Pass / Receiving ranks.
(function () {
  const TV = { gid: "", side: "", mk: "rec_yds" };
  // Market order for the toggle; the labels come from D.markets so they match the Board.
  const ORDER = ["rec_yds", "rec", "rush_yds", "rush_att", "pass_yds", "pass_att", "pass_cmp"];
  // Markets a QB has. The QB always shows passing yards unless a QB market (or Rush yds) is the one picked.
  const QB_MK = ["pass_yds", "pass_att", "pass_cmp", "rush_yds"];
  const PCOL = { QB: "#2f5fa8", RB: "#1f7a4d", WR: "#b3541e", TE: "#6b4bb8" };
  // slot, left, top (px on a 390 px wide field; scaled by percent so it fits any width)
  const SPOTS = [["WR1", 48, 126], ["TE1", 254, 126], ["WR2", 340, 126], ["WR3", 56, 252], ["QB1", 160, 196], ["RB1", 160, 326]];
  const W = 390;
  const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

  function shortName(n) {
    const p = String(n || "").trim().split(/\s+/);
    if (p.length < 2) return n || "";
    return `${p[0][0]}. ${p.slice(1).join(" ")}`;
  }
  const mdef = (id) => D.markets.find((m) => m.id === id);

  // Same coloring rule as the Board's Opp D rank: top quarter = toughest (red), bottom quarter = most allowed (green);
  // under 3 games = no color.
  function rankCls(c) {
    if (!c || c[2] < 3) return "";
    const q = Math.round(c[3] / 4);
    return c[0] <= q ? "tough" : c[0] > c[3] - q ? "easy" : "";
  }
  function ensure() {
    const gs = gamesFor(S.wk);
    if (!gs.length) return null;
    if (!TV.gid || !D.games[TV.gid] || D.games[TV.gid].wk !== S.wk) {
      const pick = (S.game && D.games[S.game] && D.games[S.game].wk === S.wk ? gs.find(([id]) => id === S.game) : null) || gs.find(([, x]) => !x.final) || gs[0];
      TV.gid = pick[0]; TV.side = pick[1].away;
    }
    const g = D.games[TV.gid];
    if (TV.side !== g.away && TV.side !== g.home) TV.side = g.away;
    return g;
  }

  // The line shown for one player and market: the graded pre-game line, or the latest snapshot (shown as pending) until it arrives.
  function lineFor(pid, key) {
    const r = rowFor(pid, S.wk), m = r && r.m ? r.m[key] : null;
    if (!m) return { txt: "—", tip: "No line for this market" };
    if (m.lstat === "ok") return { txt: num(m.line), m, tip: `${m.book || ""} line` };
    const sn = m.lstat === "pending" ? latestSnap(m) : null;
    if (sn) return { txt: num(sn.line), m, pending: true, tip: `${sn.label} line (not final)` };
    const t = { not_collected: "n/c", pending: "pending", no_pregame: "none", not_offered: "n/o", not_requested: "n/r" }[m.lstat] || "—";
    return { txt: t, tip: m.lnote || m.lstat || "", m };
  }
  const ARW = {
    up: `<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1l4 7H1z" fill="#4be08f"/></svg>`,
    down: `<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9L1 2h8z" fill="#ff8a75"/></svg>`,
  };

  function nodeHtml(s, x, y) {
    const pos = s.slot.slice(0, 2);
    const key = pos === "QB" && !QB_MK.includes(TV.mk) ? "pass_yds" : TV.mk;
    const md = mdef(key), applies = !!md && md.pos.includes(pos);
    const L = applies ? lineFor(s.pid, key) : { txt: "—", tip: "This player has no line in this market" };
    let avg = null;
    try { if (applies) avg = window.STIX_MOBILE.form(s.pid, key, pos, S.wk).avg; } catch (e) { avg = null; }
    const ln = L.m && L.m.lstat === "ok" ? L.m.line : L.pending && L.m ? latestSnap(L.m).line : null;
    const dir = ln != null && avg != null ? (avg > ln * 1.03 ? "up" : avg < ln * 0.97 ? "down" : "") : "";
    const act = L.m && L.m.act != null && L.m.lstat === "ok" ? `<span class="tv-act ${L.m.res === "over" ? "o" : L.m.res === "under" ? "u" : ""}">actual ${num(L.m.act)}</span>` : "";
    return `<a class="tv-node${applies ? "" : " dim"}" href="#/player/${esc(s.pid)}" title="${esc(s.name)} · ${esc(L.tip)}" style="left:${(x / W * 100).toFixed(2)}%;top:${y}px">
      <span class="tv-hs" style="border-color:${PCOL[pos]}">${headshot(s.pid, 46)}<span class="tv-pos" style="background:${PCOL[pos]}">${esc(s.slot)}</span></span>
      <span class="tv-name">${esc(shortName(s.name))}</span>
      <span class="tv-tag">${pos === "QB" && md ? esc(md.label.toUpperCase()) : ""}</span>
      <span class="tv-line${L.pending ? " pend" : ""}">${esc(L.txt)}</span>
      <span class="tv-avg">${dir ? ARW[dir] : ""}${avg != null && applies ? `avg ${num(avg)}` : ""}</span>${act}
    </a>`;
  }

  const ICON = {
    run: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></svg>`,
    pass: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/><path d="M9.5 9.5l5 5M11 8l5 5M8 11l5 5"/></svg>`,
    rec: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>`,
  };
  function defBar(opp) {
    const act = TV.mk.startsWith("rush") ? "run" : TV.mk.startsWith("pass") ? "pass" : "rec";
    // Run = RBs' rushing yards, Pass = QBs' passing yards, Rec = WRs' receiving yards (current-season rank, 1 = fewest allowed).
    const defs = [["run", "Run", "RB", "rush_yds"], ["pass", "Pass", "QB", "pass_yds"], ["rec", "Rec", "WR", "rec_yds"]];
    let h = `<div class="tv-def"><span class="tv-deft">${esc(opp)} D</span>`;
    for (const [id, label, pos, mk] of defs) {
      const c = (((D.defrank || {})[pos] || {})[mk] || {})[opp];
      const tip = c ? `${opp} allowed ${num(c[1])} ${pos} ${mdef(mk).label.toLowerCase()} per game in ${c[2]} games. Rank ${c[0]} of ${c[3]} (1 = fewest allowed, toughest).` : `No ${pos} ${mdef(mk).label.toLowerCase()} rank for ${opp} yet`;
      h += `<span class="tv-db${id === act ? " act" : ""} ${rankCls(c)}" title="${esc(tip)}">${ICON[id]}<span class="tv-dl">${label}</span><b class="drk ${rankCls(c)}">${c ? ordinal(c[0]) : "—"}</b></span>`;
    }
    return h + `</div>`;
  }

  function chips() {
    const gs = gamesFor(S.wk).sort((a, b) => (a[1].final ? 1 : 0) - (b[1].final ? 1 : 0));
    let h = `<div class="gamebar tv-chips" role="group" aria-label="Pick a game and a side of the ball">`;
    for (const [gid, g] of gs) {
      const when = new Date(g.ko).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
      const side = (t) => `<button type="button" class="tv-team${gid === TV.gid && t === TV.side ? " on" : ""}" data-tv="side" data-gid="${esc(gid)}" data-team="${esc(t)}" aria-pressed="${gid === TV.gid && t === TV.side}" aria-label="${esc(t)} offense, ${esc(gameLabel(gid))}">${esc(t)}</button>`;
      h += `<div class="gchip tv-chip${gid === TV.gid ? " on" : ""}" title="${esc(fmtTime(g.ko))}"><span class="tv-vs">${side(g.away)}<span class="muted">@</span>${side(g.home)}</span><span class="muted small">${g.final ? "Final" : esc(when)}</span></div>`;
    }
    return h + `</div>`;
  }
  function tabs() {
    return `<div class="tv-tabs" role="group" aria-label="Market">` + ORDER.map((id) => `<button type="button" class="tv-tab${id === TV.mk ? " on" : ""}" data-tv="mk" data-mk="${id}" aria-pressed="${id === TV.mk}">${esc(mdef(id).label)}</button>`).join("") + `</div>`;
  }
  const GHOSTS = [[120, 104], [170, 104], [220, 104], [270, 104], [145, 76], [195, 76], [245, 76], [130, 44], [260, 44], [40, 100], [350, 100]];

  function body() {
    const g = ensure();
    if (!g) return `<p class="muted pad">No games found for week ${S.wk}.</p>`;
    const side = TV.side, opp = side === g.away ? g.home : g.away;
    const slots = slotsFor(S.wk).filter((s) => s.team === side);
    const by = (n) => slots.find((s) => s.slot === n);
    let field = GHOSTS.map(([x, y]) => `<i class="tv-ghost" style="left:${((x - 7) / W * 100).toFixed(2)}%;top:${y - 7}px"></i>`).join("") +
      `<i class="tv-los"></i>` + [104, 132, 160, 188, 216].map((x) => `<i class="tv-ol" style="left:${((x - 13) / W * 100).toFixed(2)}%"></i>`).join("");
    let n = 0;
    for (const [slot, x, y] of SPOTS) { const s = by(slot); if (s) { field += nodeHtml(s, x, y); n++; } }
    const rb2 = by("RB2");
    let depth = "";
    if (rb2) {
      const md = mdef(TV.mk), ok = md && md.pos.includes("RB"), L = ok ? lineFor(rb2.pid, TV.mk) : null;
      depth = `<a class="tv-depth" href="#/player/${esc(rb2.pid)}"><span class="tv-dlab">DEPTH</span>${headshot(rb2.pid, 30)}<span class="tv-dn">${esc(rb2.name)} <span class="muted small">${esc(rb2.slot)}</span></span><b>${L ? esc(L.txt) : "—"}</b></a>`;
    }
    return `${defBar(opp)}
      <div class="tv-field">${n ? field : `<p class="tv-empty">No slotted players for ${esc(side)} in week ${S.wk}.</p>`}</div>
      ${depth}
      <div class="tv-legend muted small"><span>${ARW.up} line below season avg</span><span>${ARW.down} line above season avg</span><span class="tv-lr">Red tough · Green soft</span></div>
      <p class="muted small tv-note">Players and slots are the same ones the Board uses; lines are the Board's lines. Defense ranks are current-season, 1 = fewest allowed.</p>`;
  }

  function view() {
    const g = ensure();
    if (!g) return `<p class="muted pad">No games found for week ${S.wk}.</p>`;
    return `<div class="tv" id="tv">${chips()}${weekSlider(S.wk)}${tabs()}<div id="tv-body">${body()}</div></div>`;
  }

  // Tapping a team or a market repaints only this view, so the market strip keeps its scroll position.
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-tv]"); if (!t) return;
    const root = document.getElementById("tv"); if (!root) return;
    if (t.dataset.tv === "side") { TV.gid = t.dataset.gid; TV.side = t.dataset.team; }
    else if (t.dataset.tv === "mk") TV.mk = t.dataset.mk;
    else return;
    const strip = root.querySelector(".tv-tabs"), cs = root.querySelector(".tv-chips");
    const sl = strip ? strip.scrollLeft : 0, cl = cs ? cs.scrollLeft : 0;
    root.querySelector(".tv-chips").outerHTML = chips();
    root.querySelector(".tv-tabs").outerHTML = tabs();
    root.querySelector("#tv-body").innerHTML = body();
    const s2 = root.querySelector(".tv-tabs"), c2 = root.querySelector(".tv-chips");
    if (s2) s2.scrollLeft = sl; if (c2) c2.scrollLeft = cl;
  });

  window.STIX_TEAM = { view };
})();
