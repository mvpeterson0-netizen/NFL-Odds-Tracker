"use strict";
// Stix phone layout. Loaded before app.js; only takes over the Board and player pages on narrow
// screens (<= 760px). It uses app.js helpers at render time. If anything here throws, app.js
// catches it and renders the normal desktop view, so the desktop layout never depends on this file.
(function () {
  const MQ = window.matchMedia("(max-width: 760px)");

  // ---------- season average + trend (rules: STARTER_SLOTS / TREND_RULES in app.js, shown on the Guide tab) ----------
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  function form(pid, mid, pos, beforeWk) {
    const R = TREND_RULES;
    const starts = (D.rows[pid] || []).filter((r) => r.wk < beforeWk && r.final && r.played === true &&
      STARTER_SLOTS.includes(r.slot) && r.m[mid] && r.m[mid].act != null);
    const acts = starts.map((r) => r.m[mid].act);
    const avg = mean(acts);
    const out = { n: starts.length, avg, trend: null, usage: "" };
    if (starts.length < R.minGames) return out;
    const last = acts.slice(-R.lastN), lastAvg = mean(last);
    out.lastAvg = lastAvg;
    let dir = 0;
    if (avg === 0) dir = lastAvg > 0 ? 1 : 0;
    else { const ch = ((lastAvg - avg) / avg) * 100; out.pctCh = ch; dir = ch >= R.pct ? 1 : ch <= -R.pct ? -1 : 0; }
    out.trend = dir;
    const uKey = pos === "WR" || pos === "TE" ? "tshare" : pos === "RB" ? "snap" : null;
    if (uKey && dir !== 0) {
      const u = starts.map((r) => r[uKey]).filter((v) => v != null);
      const uAvg = mean(u), uLast = mean(starts.slice(-R.lastN).map((r) => r[uKey]).filter((v) => v != null));
      if (uAvg && uLast != null) {
        const uch = ((uLast - uAvg) / uAvg) * 100;
        const udir = uch >= R.usagePct ? 1 : uch <= -R.usagePct ? -1 : 0;
        out.usage = udir === 0 ? "" : udir === dir ? (dir > 0 ? "usage ↑" : "usage ↓") : "mixed";
      }
    }
    return out;
  }
  // Targets (WR / TE / RB): last played game, last 3 played games, and season average over starts.
  const TGT_POS = ["WR", "TE", "RB"];
  function targets(pid, pos, beforeWk) {
    if (!TGT_POS.includes(pos)) return null;
    const played = (D.rows[pid] || []).filter((r) => r.wk < beforeWk && r.final && r.played === true && r.tgt != null);
    if (!played.length) return { n: 0 };
    const last = played[played.length - 1];
    const starts = played.filter((r) => STARTER_SLOTS.includes(r.slot));
    return { n: played.length, last: last.tgt, lastWk: last.wk, lastShare: last.tshare,
             last3: mean(played.slice(-3).map((r) => r.tgt)), avg: starts.length ? mean(starts.map((r) => r.tgt)) : null, nStarts: starts.length };
  }
  const pctS = (v) => (v == null ? "" : ` (${Math.round(v * 100)}%)`);
  function tgtLine(t) {
    if (!t) return "";
    if (!t.n) return `<div class="mtgt muted">Targets: no games yet</div>`;
    return `<div class="mtgt" title="Last game: week ${t.lastWk}. Share = his share of the team's targets. Season avg counts starts only.">` +
      `Targets <b>${num(t.last, 0)}</b> last${pctS(t.lastShare)} · <b>${num(t.last3)}</b> last 3 · <b>${t.avg == null ? "—" : num(t.avg)}</b> avg</div>`;
  }

  function trendHtml(f, big) {
    if (f.trend == null) return `<span class="na" title="Fewer than ${TREND_RULES.minGames} starts">—</span>`;
    const t = f.trend > 0 ? ["↑", "Rising", "up"] : f.trend < 0 ? ["↓", "Falling", "down"] : ["→", "Steady", "flat"];
    const tip = `Last ${TREND_RULES.lastN} starts avg ${num(f.lastAvg)} vs season ${num(f.avg)}` + (f.pctCh != null ? ` (${f.pctCh > 0 ? "+" : ""}${Math.round(f.pctCh)}%)` : "");
    return `<span class="mtrend ${t[2]}" title="${esc(tip)}">${t[0]}${big ? " " + t[1] : ""}</span>${f.usage ? `<span class="musage ${f.usage === "mixed" ? "mixed" : ""}">${esc(f.usage)}</span>` : ""}`;
  }
  function lineHtml(m) {
    if (!m) return `<span class="na">—</span>`;
    if (m.lstat === "ok") {
      const res = m.res && m.res !== "pending" ? ` <span class="res ${m.res}">${m.res}</span>` : "";
      return `<b>${num(m.line)}</b>${res}`;
    }
    const sn = m.lstat === "pending" ? latestSnap(m) : null;
    if (sn) return `<b>${num(sn.line)}</b> <span class="chip snapchip">${esc(sn.label)}</span>`;
    const t = { not_collected: "n/c", pending: "pending", no_pregame: "none", not_offered: "n/o", not_requested: "n/r" }[m.lstat] || "—";
    return `<span class="na" title="${esc(m.lnote || m.lstat || "")}">${t}</span>`;
  }
  function oppHtml(m) {
    if (!m || m.drk == null) return `<span class="na">—</span>`;
    const cls = m.dn < 3 ? "" : m.drk <= Math.round(m.dof / 4) ? "tough" : m.drk > m.dof - Math.round(m.dof / 4) ? "easy" : "";
    return `<span class="drk ${cls}">${ordinal(m.drk)}</span>`;
  }
  function wxShort(gid) {
    const g = D.games[gid]; if (!g) return "";
    const w = g.wx || {};
    if (w.roof === "dome") return `<span class="wxb dome">Dome</span>`;
    const s = wxSummary(w); if (!s) return "";
    const v = wxValues(w);
    return `<span class="wxb ${s.nice ? "nice" : "bad"}">${esc(s.label)}</span> <span class="muted">${v.t}°F · ${v.wind} mph</span>`;
  }

  // ---------- Board (cards) ----------
  function board() {
    const wk = S.wk, q = S.q.trim().toLowerCase();
    if (S.game && !(D.games[S.game] && D.games[S.game].wk === wk)) S.game = "";
    let slots = typeof slotsShown === "function" ? slotsShown(wk) : slotsFor(wk);
    if (S.team) slots = slots.filter((s) => s.team === S.team);
    if (S.pos) slots = slots.filter((s) => s.slot.startsWith(S.pos));
    if (q) slots = slots.filter((s) => s.name.toLowerCase().includes(q));
    const items = [];
    for (const s of slots) {
      const r = rowFor(s.pid, wk);
      if (!r || (S.game && r.gid !== S.game)) continue;
      items.push({ s, r });
    }
    items.sort((a, b) => a.r.ko.localeCompare(b.r.ko) || a.r.gid.localeCompare(b.r.gid) || a.s.team.localeCompare(b.s.team) || slotRank(a.s.slot) - slotRank(b.s.slot));
    let h = gameBar(wk) + `<div class="filters mfilters">
      <label>Week ${weekSelect("f-wk", wk)}</label>
      <label>Team <select id="f-team">${teamOptions(S.team)}</select></label>
      <label>Position <select id="f-pos"><option value="">All</option>${["QB", "RB", "WR", "TE"].map((p) => `<option ${p === S.pos ? "selected" : ""}>${p}</option>`).join("")}</select></label>
      <label>Player <input type="search" id="f-q" placeholder="Search name" value="${esc(S.q)}"></label></div>
      <p class="muted small mnote">${items.length} players · tap a player for details · <a href="#/guide">how AVG, OPP and trend work</a></p>`;
    if (!items.length) return h + `<p class="muted">No slotted players match these filters for week ${wk}.</p>`;
    let lastGid = null;
    for (const { s, r } of items) {
      if (r.gid !== lastGid) {
        if (lastGid) h += `</section>`;
        h += `<section class="mgame"><div class="mgame-h"><div><b>${esc(gameLabel(r.gid))}</b> <span class="muted">${fmtTime(r.ko)}</span></div><div class="small">${wxShort(r.gid)}</div></div>`;
        lastGid = r.gid;
      }
      const pos = s.slot.slice(0, 2);
      let rows = "";
      for (const mk of marketsFor(pos)) {
        const m = r.m[mk.id];
        const f = form(s.pid, mk.id, pos, wk);
        rows += `<div class="mrow"><span class="mlab">${esc(mk.label)}</span><span>${lineHtml(m)}</span><span>${f.avg == null ? `<span class="na">—</span>` : num(f.avg)}</span><span>${oppHtml(m)}</span><span>${trendHtml(f)}</span></div>`;
      }
      h += `<a class="mcard" href="#/player/${s.pid}">
        <div class="mcard-h">${headshot(s.pid, 40)}<div><div class="mname">${esc(s.name)}</div><div class="muted small">${esc(s.team)} · <span class="chip ${s.change ? "chg" : ""} ${s.extra ? "xtra" : ""}">${s.slot}${s.change ? " ↺" : ""}</span></div>${tgtLine(targets(s.pid, pos, wk))}</div><span class="mchev">›</span></div>
        <div class="mrow mhead"><span></span><span>LINE</span><span>AVG</span><span>OPP</span><span>TREND</span></div>${rows}</a>`;
    }
    return h + `</section>`;
  }

  // ---------- Player page ----------
  function player(pid) {
    const p = playerById[pid];
    if (!p) return `<p>Player not found. <a href="#/board">Back</a></p>`;
    const rows = D.rows[pid] || [];
    const ms = marketsFor(p.pos);
    const mid = S.market[pid] && ms.some((m) => m.id === S.market[pid]) ? S.market[pid] : ms[0].id;
    const mk = mkt[mid];
    const cur = rows.find((r) => r.wk === S.wk) || rows.filter((r) => !r.final)[0] || rows[rows.length - 1];
    const m = cur ? cur.m[mid] : null;
    const f = cur ? form(pid, mid, p.pos, cur.wk) : { n: 0, avg: null, trend: null };
    let h = `<div class="mplayer">
      <div class="mp-top"><a href="#/board" class="mback" id="m-back">‹ Board</a></div>
      <div class="mp-h">${headshot(pid, 64)}<div><h2>${esc(p.name)}</h2><div class="muted">${esc(p.team)} · ${esc(cur && cur.slot ? cur.slot : p.pos)}</div>
        ${cur ? `<div class="small">W${cur.wk} ${cur.ha === "home" ? "vs" : "@"} ${esc(cur.opp)} · ${fmtTime(cur.ko)}</div><div class="small">${wxShort(cur.gid)}</div>` : ""}</div></div>
      <div class="mtabs">${ms.map((x) => `<button data-mid="${x.id}" class="${x.id === mid ? "on" : ""}">${esc(x.label)}</button>`).join("")}</div>
      <div class="mtiles">
        <div><span>LINE</span>${lineHtml(m)}</div>
        <div><span>AVG</span>${f.avg == null ? `<span class="na">—</span>` : `<b>${num(f.avg)}</b><small>${f.n} start${f.n === 1 ? "" : "s"}</small>`}</div>
        <div><span>OPP</span>${oppHtml(m)}${m && m.dav != null ? `<small>${num(m.dav)}/g allowed</small>` : ""}</div>
        <div><span>TREND</span>${trendHtml(f, true)}</div>
      </div>
      ${typeof pickBoxSafe === "function" ? pickBoxSafe(pid, mid) : ""}
      ${cur ? tgtLine(targets(pid, p.pos, cur.wk)).replace('class="mtgt', 'class="mtgt mtgt-big') : ""}
      <div class="panel"><h3>${esc(mk.label)} by week</h3><div class="chart">${chartSVG(rows, mid, { W: 400, H: 230, L: 30, R: 26, T: 26, B: 24, fs: 12, edgeAbove: true })}</div>
        <div class="legend"><span><i style="border-color:var(--accent)"></i>Actual</span><span><i style="border-color:var(--ink);border-top-width:3px"></i>Pre-game line</span><span><i style="border-color:var(--warn-ink);border-top-width:3px;border-top-style:dashed"></i>Snapshot</span></div></div>`;
    // Line movement for this week's game
    if (m && (m.snaps || m.lstat === "ok")) {
      h += `<div class="panel"><h3>Line movement (W${cur.wk})</h3><div class="body mlist">`;
      for (const x of m.snaps || []) h += `<div><span class="chip snapchip">${esc(x.label)}</span> <b>${num(x.line)}</b> <span class="muted">${odds(x.op)}/${odds(x.up)} · ${esc(x.book)} · ${fmtTime(x.cap)}</span></div>`;
      if (m.lstat === "ok") h += `<div><span class="chip">Pre-game</span> <b>${num(m.line)}</b> <span class="muted">${odds(m.op)}/${odds(m.up)} · ${esc(m.book)} · ${fmtTime(m.cap)}</span> <span class="muted small">(graded)</span></div>`;
      h += `</div></div>`;
    }
    // Game log
    const showT = TGT_POS.includes(p.pos);
    h += `<div class="panel"><h3>Game log</h3><div class="mlog"><div class="mlog-r mhead ${showT ? "t" : ""}"><span>Wk</span><span>Opp</span><span>Line</span><span>Act</span>${showT ? "<span>Tgt</span>" : ""}<span>Snap</span></div>`;
    for (const r of [...rows].reverse()) {
      const mm = r.m[mid] || {};
      const w = D.games[r.gid] && D.games[r.gid].wx ? wxSummary(D.games[r.gid].wx) : null;
      const em = D.games[r.gid] && D.games[r.gid].wx && D.games[r.gid].wx.roof === "dome" ? "🏟️" : w ? (w.label.match(/\p{Extended_Pictographic}/u) || [""])[0] : "";
      h += `<div class="mlog-r ${showT ? "t" : ""}"><span>${r.wk}</span><span>${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} ${oppHtml(mm)} ${em}${STARTER_SLOTS.includes(r.slot) ? "" : ` <span class="muted small">${esc(r.slot || "not slotted")}</span>`}</span>
        <span>${lineHtml(mm)}</span><span>${actualCell(r, mm)}</span>${showT ? `<span>${r.tgt == null ? "" : num(r.tgt, 0)}</span>` : ""}<span>${snapCell(r)}</span></div>`;
    }
    h += `</div></div>`;
    // Context
    const notesTxt = cur ? notes(cur, m, null) : "";
    h += `<div class="panel"><h3>Matchup &amp; context</h3><div class="body mlist">
      ${m && m.drk != null ? `<div>${drankCell(m, p.pos, mk, cur.opp)}</div><div class="muted small">${esc(cur.opp)} allowed ${num(m.dav)} ${p.pos} ${esc(mk.label.toLowerCase())} per game in ${m.dn} games (rank ${m.drk} of ${m.dof}; 1 = fewest).</div>` : ""}
      ${cur ? `<div>Weather: ${wxCell(cur.gid)}</div>` : ""}
      ${(() => { const lp = rows.filter((r) => cur && r.wk < cur.wk && r.final && r.played === true).pop(); const u = lp ? usageCell(lp, p.pos) : ""; return u ? `<div>Last game usage (W${lp.wk}): ${u}</div>` : ""; })()}
      ${notesTxt ? `<div class="muted small">${notesTxt}</div>` : ""}
      <div class="muted small"><a href="#/guide">How AVG, OPP, trend and weather labels work</a></div>
    </div></div></div>`;
    return h;
  }

  window.STIX_MOBILE = {
    active: () => MQ.matches,
    render(tab, arg) {
      if (tab === "player") return player(arg);
      if (!tab || tab === "board" || tab === "") return board();
      return null; // other tabs use the shared views
    },
    bind(tab) {
      const back = document.getElementById("m-back");
      if (back) back.addEventListener("click", (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
    },
  };
  // Re-render when crossing the phone/desktop breakpoint (e.g. rotating a tablet).
  const onChange = () => { try { if (typeof render === "function" && D) render(); } catch (e) { /* app not ready yet */ } };
  if (MQ.addEventListener) MQ.addEventListener("change", onChange); else if (MQ.addListener) MQ.addListener(onChange);
})();
