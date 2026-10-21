"use strict";
// NFL Prop Tracker front end. Reads data/data.json (built by the GitHub Action). No external libraries.

let D = null;
const S = { tab: "board", wk: null, game: "", team: "", pos: "", q: "", slotWk: null, slotTeam: "", market: {}, showAn: false };
const SLOT_ORDER = ["QB1", "RB1", "RB2", "WR1", "WR2", "WR3", "TE1", "TE2"];
const app = document.getElementById("app");

// ---------- formatting ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NA = (t = "no data") => `<span class="na">${esc(t)}</span>`;
function fmtTime(iso, withDay = true) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleString(undefined, {
    weekday: withDay ? "short" : undefined, month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}
function ago(iso) {
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const num = (v, d = 1) => (v == null ? null : Number.isInteger(v) ? String(v) : v.toFixed(d));
const odds = (v) => (v == null ? NA() : v > 0 ? `+${v}` : String(v));
const pct = (v) => (v == null ? NA() : `${Math.round(v)}%`);
function impl(o) { if (o == null) return null; return o > 0 ? 100 / (o + 100) : -o / (-o + 100); }

// ---------- data helpers ----------
const playerById = {};
const mkt = {};
function slotsFor(wk) { return D.slots.filter((s) => s.wk === wk); }
function rowFor(pid, wk) { return (D.rows[pid] || []).find((r) => r.wk === wk); }
function marketsFor(pos) { return D.markets.filter((m) => m.pos.includes(pos)); }
function gameLabel(gid) {
  const g = D.games[gid]; if (!g) return gid;
  return `${g.away} @ ${g.home}`;
}
function lineCell(m) {
  if (!m) return NA();
  switch (m.lstat) {
    case "ok": return `<b>${num(m.line)}</b>`;
    case "not_collected": return NA("not collected");
    case "pending": {
      const sn = latestSnap(m);
      if (sn) return `<b class="snap" title="${esc(snapTip(m))}">${num(sn.line)}</b> <span class="chip snapchip" title="${esc(snapTip(m))}">${esc(sn.label)}</span>`;
      return `<span class="na" title="Pull scheduled ${esc(fmtTime(m.pull_open))}">pending</span>`;
    }
    case "no_pregame": return `<span class="na" title="${esc(m.lnote)}">no pre-game line</span>`;
    case "not_offered": return `<span class="na" title="${esc(m.lnote)}">not offered</span>`;
    case "not_requested": return `<span class="na" title="${esc(m.lnote)}">not requested</span>`;
    default: return NA();
  }
}
function latestSnap(m) { return m && m.snaps && m.snaps.length ? m.snaps[m.snaps.length - 1] : null; }
function snapTip(m) {
  const lines = (m.snaps || []).map((x) => `${x.label} (${fmtTime(x.cap)}, ${x.book}): ${num(x.line)}  ${odds(x.op).replace(/<[^>]+>/g, "")}/${odds(x.up).replace(/<[^>]+>/g, "")}`);
  return "Line-movement snapshots (not graded):\n" + lines.join("\n") +
    (m.lstat === "pending" ? "\nThe official pre-game line (~3 h before kickoff) replaces these and is the one graded." : "");
}
function ouCell(m, side) {
  const k = side === "o" ? "op" : "up";
  if (m && m.lstat === "ok") return odds(m[k]);
  const sn = m && m.lstat === "pending" ? latestSnap(m) : null;
  return sn ? `<span class="snap">${odds(sn[k])}</span>` : "";
}
function moveNote(m) {
  if (!m || !m.snaps || !m.snaps.length || m.lstat !== "ok") return "";
  const path = m.snaps.map((x) => `${esc(x.label)} ${num(x.line)}`).join(" → ") + ` → Pre ${num(m.line)}`;
  const d = m.line - m.snaps[0].line;
  return `<div class="muted" title="${esc(snapTip(m))}">${path} (${d > 0 ? "+" : ""}${num(d)})</div>`;
}
function actualCell(r, m) {
  if (m && m.act != null) return `<b>${num(m.act)}</b>`;
  if (r.played === false) return NA("DNP");
  if (!r.final) return NA("not played");
  return NA("stats pending");
}
function resultCell(m) {
  if (!m || !m.res) return "";
  return `<span class="res ${m.res}">${m.res === "pending" ? "pending" : m.res}</span>`;
}
function capCell(m) {
  const sn = m && m.lstat === "pending" ? latestSnap(m) : null;
  if (sn) return `${esc(sn.book)} · <span title="${esc(sn.cap)}">${fmtTime(sn.cap)}</span> <span class="muted">(${esc(sn.label)} snapshot)</span>` +
    (m.snaps.length > 1 ? `<div class="muted">${m.snaps.map((x) => `${esc(x.label)} ${num(x.line)}`).join(" → ")}</div>` : "");
  if (!m || m.lstat !== "ok") return "";
  const late = m.inwin === "no" ? ` <span class="chip" title="Captured outside the 2.5–3.5 h window">${esc(m.mins)} min pre</span>` : "";
  return `${esc(m.book)} · <span title="${esc(m.cap)}">${fmtTime(m.cap)}</span>${late}${moveNote(m)}`;
}
function ordinal(n) { const v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); }
function drankCell(m, pos, mk, opp) {
  if (!m || m.drk == null) return `<span class="na" title="No games by ${esc(opp)} before this game yet">no data</span>`;
  const cur = ((D.defrank || {})[pos] || {})[mk.id] || {};
  const c = cur[opp];
  const tip = `${opp} allowed ${num(m.dav)} ${pos} ${mk.label.toLowerCase()} per game in its ${m.dn} game${m.dn === 1 ? "" : "s"} before this one. ` +
    `Rank ${m.drk} of ${m.dof} (1 = fewest allowed, toughest).` + (c ? ` Current season: ${ordinal(c[0])} (${num(c[1])}/g, ${c[2]} gm).` : "");
  const cls = m.dn < 3 ? "" : m.drk <= Math.round(m.dof / 4) ? "tough" : m.drk > m.dof - Math.round(m.dof / 4) ? "easy" : "";
  return `<span class="drk ${cls}" title="${esc(tip)}">${ordinal(m.drk)}</span> <span class="muted small">${num(m.dav)}/g${m.dn < 3 ? ` · ${m.dn} gm` : ""}</span>`;
}
function wxCell(gid) {
  const g = D.games[gid]; if (!g) return "";
  const w = g.wx || {};
  if (w.roof === "dome") return `<span class="wx muted" title="Fixed-roof stadium (${esc(g.stadium)})">Dome</span>`;
  if (!g.wx) return NA("no data");
  if (w.note) return `<span class="na" title="${esc(g.stadium)}">no data (${esc(w.note)})</span>`;
  const roof = w.roof === "retractable" ? "Retractable roof (open/closed unknown) · " : "";
  const fmt = (p) => {
    const t = w[p + "_temp_f"], wd = w[p + "_wind_mph"], pr = w[p + "_precip_in"], pp = w[p + "_precip_prob"];
    if (t == null) return null;
    let x = `${t}°F · wind ${wd} mph`;
    if (pr != null) x += ` · ${pr} in precip`;
    if (pp != null) x += ` (${pp}% chance)`;
    return x;
  };
  const obs = fmt("obs"), fc = fmt("fc");
  const ko = new Date(g.ko).getTime(), now = Date.now();
  const src = "Open-Meteo, at the stadium: temperature and wind at the kickoff hour, precipitation summed over the kickoff hour + next 3 hours.";
  if (obs) return `<span class="wx" title="${esc(roof + "Observed. Gusts " + (w.obs_gust_mph ?? "?") + " mph. " + (fc ? "Last pre-game forecast: " + fc + ". " : "") + src)}"><span class="muted">Obs</span> ${esc(obs)}</span>`;
  if (fc) {
    const pre = ko > now ? "Fcst" : "Last fcst";
    const tip = roof + `Forecast fetched ${fmtTime(w.fc_fetched_utc)}. Gusts ${w.fc_gust_mph ?? "?"} mph. ` + (ko > now ? "Refreshed every ~3 h until kickoff. " : "Observed values appear about 6 days after the game. ") + src;
    return `<span class="wx" title="${esc(tip)}"><span class="muted">${pre}</span> ${esc(fc)}</span>`;
  }
  if (ko > now) return `<span class="na" title="Open-Meteo forecasts reach 16 days ahead">forecast not out yet</span>`;
  return `<span class="na" title="Open-Meteo's observed archive has about a 5-day delay">observed weather pending</span>`;
}
function usageCell(r, pos) {
  if (pos === "QB") return "";
  const parts = [];
  if (pos === "RB") {
    parts.push(r.car != null ? `${num(r.car, 0)} car` : null);
    parts.push(r.tgt != null ? `${num(r.tgt, 0)} tgt` : null);
  } else {
    if (r.tgt != null) parts.push(`${num(r.tgt, 0)} tgt` + (r.tshare != null ? ` (${Math.round(r.tshare * 100)}%)` : ""));
  }
  const s = parts.filter(Boolean).join(", ");
  if (s) return s;
  return r.final ? (r.played === false ? "" : NA()) : "";
}
function snapCell(r) {
  if (r.snap != null) return pct(r.snap);
  if (!r.final) return "";
  if (r.played === false) return "";
  return r.snaps_avail ? "0%" : NA();
}
function notes(r, m, slotRow) {
  const out = [];
  if (r.dnp) out.push(r.dnp);
  else if (m && m.lnote && m.lstat !== "pending") out.push(m.lnote);
  if (m && m.lstat === "pending") out.push(`Pre-game pull scheduled ${fmtTime(m.pull_open)} – ${fmtTime(m.pull_close, false)}`);
  if (r.inj && !r.dnp) out.push(r.inj);
  if (r.note) out.push(r.note);
  if (slotRow && slotRow.change) out.push("Slot change: " + slotRow.change);
  return out.map((t) => (t.startsWith("Pre-game pull scheduled") ? t : esc(t))).join(" · ");
}

// ---------- views ----------
function weekSelect(id, val) {
  return `<select id="${id}">${D.weeks.map((w) => `<option value="${w}" ${w === val ? "selected" : ""}>Week ${w}${w === D.current_week ? " (current)" : ""}</option>`).join("")}</select>`;
}
function teamOptions(val) {
  const teams = [...new Set(D.players.map((p) => p.team))].sort();
  return `<option value="">All teams</option>` + teams.map((t) => `<option ${t === val ? "selected" : ""}>${t}</option>`).join("");
}

function gamesFor(wk) {
  return Object.entries(D.games).filter(([, g]) => g.wk === wk)
    .sort((a, b) => a[1].ko.localeCompare(b[1].ko) || a[0].localeCompare(b[0]));
}
function gameBar(wk) {
  const gs = gamesFor(wk);
  if (!gs.length) return "";
  const chip = (gid, label, sub, extra = "") =>
    `<button class="gchip ${S.game === gid ? "on" : ""}" data-gid="${esc(gid)}" ${extra}>${label}${sub ? `<span class="muted small">${sub}</span>` : ""}</button>`;
  let h = `<div class="gamebar" role="group" aria-label="Filter by game">` + chip("", "All games", `${gs.length} games`);
  for (const [gid, g] of gs) {
    const when = new Date(g.ko).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
    h += chip(gid, `<b>${esc(g.away)} @ ${esc(g.home)}</b>`, g.final ? "Final" : esc(when), `title="${esc(fmtTime(g.ko))}"`);
  }
  return h + `</div>`;
}

function viewBoard() {
  const wk = S.wk;
  const q = S.q.trim().toLowerCase();
  if (S.game && !(D.games[S.game] && D.games[S.game].wk === wk)) S.game = "";
  let slots = slotsFor(wk);
  if (S.team) slots = slots.filter((s) => s.team === S.team);
  if (S.pos) slots = slots.filter((s) => s.slot.startsWith(S.pos));
  if (q) slots = slots.filter((s) => s.name.toLowerCase().includes(q));
  const items = [];
  for (const s of slots) {
    const r = rowFor(s.pid, wk);
    if (!r) continue;
    if (S.game && r.gid !== S.game) continue;
    items.push({ s, r, ko: r.ko });
  }
  items.sort((a, b) => a.ko.localeCompare(b.ko) || a.r.gid.localeCompare(b.r.gid) || a.s.team.localeCompare(b.s.team) || SLOT_ORDER.indexOf(a.s.slot) - SLOT_ORDER.indexOf(b.s.slot));
  let html = gameBar(wk) + `<div class="filters">
    <label>Week ${weekSelect("f-wk", wk)}</label>
    <label>Team <select id="f-team">${teamOptions(S.team)}</select></label>
    <label>Position <select id="f-pos"><option value="">All</option>${["QB", "RB", "WR", "TE"].map((p) => `<option ${p === S.pos ? "selected" : ""}>${p}</option>`).join("")}</select></label>
    <label>Player <input type="search" id="f-q" placeholder="Search name" value="${esc(S.q)}"></label>
    <span class="muted small">${items.length} players · graded lines are the pre-game line (~3h before kickoff), not closing lines; yellow chips are earlier snapshots (Mon / Thu / Sun AM) · Opp D rank: 1 = toughest, 32 = most allowed</span>
  </div>`;
  if (!items.length) return html + `<p class="muted">No slotted players match these filters for week ${wk}.</p>`;
  html += `<div class="panel scroll"><table><thead><tr>
    <th>Game</th><th>Team</th><th>Slot</th><th>Player</th><th>Market</th><th title="Opponent defense rank in this stat vs. this position, using only games before this one. 1 = fewest allowed (toughest).">Opp D rank</th><th class="num" title="Pre-game line captured ~3 h before kickoff (graded). Before that, the latest snapshot is shown with a yellow Mon / Thu / Sun AM chip (not graded).">Line</th>
    <th class="num">Over</th><th class="num">Under</th><th>Book · captured</th><th class="num">Actual</th><th>Result</th>
    <th class="num">Snap %</th><th>Usage</th><th>Notes</th></tr></thead><tbody>`;
  let lastGid = null;
  for (const { s, r } of items) {
    const pos = s.slot.slice(0, 2);
    const ms = marketsFor(pos);
    ms.forEach((mk, i) => {
      const m = r.m[mk.id];
      const first = i === 0;
      const grp = first && r.gid !== lastGid ? "grp" : "";
      html += `<tr class="${grp}">
        <td>${first ? `${esc(gameLabel(r.gid))}<div class="muted small">${fmtTime(r.ko)}</div><div class="small wxline">${wxCell(r.gid)}</div>` : ""}</td>
        <td>${first ? esc(s.team) : ""}</td>
        <td>${first ? `<span class="chip ${s.change ? "chg" : ""}" title="${esc(s.change ? "Changed: " + s.change : s.basis)}">${s.slot}${s.change ? " ↺" : ""}</span>` : ""}</td>
        <td>${first ? `<a href="#/player/${s.pid}">${esc(s.name)}</a>` : ""}</td>
        <td>${esc(mk.label)}</td>
        <td class="small">${drankCell(m, pos, mk, r.opp)}</td>
        <td class="num">${lineCell(m)}</td>
        <td class="num">${ouCell(m, "o")}</td>
        <td class="num">${ouCell(m, "u")}</td>
        <td class="small">${capCell(m)}</td>
        <td class="num">${actualCell(r, m)}</td>
        <td>${resultCell(m)}</td>
        <td class="num">${first ? snapCell(r) : ""}</td>
        <td class="small">${first ? usageCell(r, pos) : ""}</td>
        <td class="note">${notes(r, m, first ? s : null)}</td></tr>`;
      lastGid = r.gid;
    });
  }
  html += `</tbody></table></div>`;
  return html;
}

function chartSVG(rows, mid) {
  const pts = rows.map((r) => ({ wk: r.wk, act: r.m[mid]?.act ?? null, line: r.m[mid]?.lstat === "ok" ? r.m[mid].line : null, r }));
  const vals = pts.flatMap((p) => [p.act, p.line]).filter((v) => v != null);
  if (!vals.length) return `<p class="muted pad">No data to chart yet.</p>`;
  const W = 900, H = 220, L = 44, R = 12, T = 12, B = 30;
  const max = Math.max(...vals) * 1.1 || 1, min = 0;
  const xs = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const ys = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  let g = "";
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--line)"/>
      <text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${Math.round(v)}</text>`;
  }
  pts.forEach((p, i) => {
    g += `<text x="${xs(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">W${p.wk}</text>`;
  });
  // actual line (breaks at DNP / not played)
  let path = "", pen = false;
  pts.forEach((p, i) => {
    if (p.act == null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${xs(i)},${ys(p.act)} `; pen = true;
  });
  g += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  pts.forEach((p, i) => {
    if (p.act != null) g += `<circle cx="${xs(i)}" cy="${ys(p.act)}" r="4" fill="var(--accent)"><title>W${p.wk} actual ${num(p.act)}</title></circle>`;
    if (p.line != null) {
      const res = p.r.m[mid].res;
      const col = res === "over" ? "var(--over)" : res === "under" ? "var(--under)" : "var(--ink)";
      g += `<line x1="${xs(i) - 12}" x2="${xs(i) + 12}" y1="${ys(p.line)}" y2="${ys(p.line)}" stroke="${col}" stroke-width="3"><title>W${p.wk} pre-game line ${num(p.line)}</title></line>`;
    }
    if (p.r.played === false) g += `<text x="${xs(i)}" y="${ys(min) - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">DNP</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${g}</svg>`;
}

function analysisPanel(pid, mid, rows) {
  const an = (D.analysis[pid] || {})[mid] || {};
  const f = (v, n) => (v == null ? NA() : `${num(v, 1)}${n != null ? ` <span class="muted small">(n=${n})</span>` : ""}`);
  let h = `<div class="grid2">
    <div class="panel"><h3>Hit rate vs stored pre-game lines</h3><div class="body kv">
      <div>Graded games</div><div>${an.n_graded ?? 0}</div>
      <div>Over / Under / Push</div><div>${an.over ?? 0} / ${an.under ?? 0} / ${an.push ?? 0}</div>
      <div>Empirical over rate</div><div>${an.over_rate == null ? NA("no graded lines yet") : `${(an.over_rate * 100).toFixed(0)}% <span class="muted small">(n=${(an.over ?? 0) + (an.under ?? 0)}, pushes excluded)</span>`}</div>
      <div>Avg implied over prob (vig removed)</div><div>${an.implied_over == null ? NA("no graded lines yet") : `${(an.implied_over * 100).toFixed(0)}% <span class="muted small">(n=${an.n_implied})</span>`}</div>
      <div>Games with stats</div><div>${an.n_games ?? 0}</div>
    </div></div>
    <div class="panel"><h3>Week-to-week line change vs production</h3><div class="body">`;
  if (!an.moves || !an.moves.length) h += `<p class="muted">Needs two games with stored lines.</p>`;
  else {
    h += `<table><thead><tr><th>Weeks</th><th class="num">Prev line</th><th class="num">Prev actual</th><th class="num">Actual − line</th><th class="num">New line</th><th class="num">Line change</th></tr></thead><tbody>`;
    for (const mv of an.moves) h += `<tr><td>W${mv.from_wk} → W${mv.to_wk}</td><td class="num">${num(mv.line_prev)}</td><td class="num">${mv.act_prev == null ? NA("DNP") : num(mv.act_prev)}</td><td class="num">${mv.resid_prev == null ? "" : num(mv.resid_prev)}</td><td class="num">${num(mv.line)}</td><td class="num">${mv.dline > 0 ? "+" : ""}${num(mv.dline)}</td></tr>`;
    h += `</tbody></table>`;
  }
  h += `</div></div></div>
  <div class="panel scroll"><h3>Pre-game line vs rolling production (prior games only)</h3><table><thead><tr>
    <th>Wk</th><th class="num">Line</th><th class="num">Actual</th><th class="num">3-gm mean</th><th class="num">3-gm median</th>
    <th class="num">5-gm mean</th><th class="num">5-gm median</th><th class="num">Line − 5-gm mean</th><th class="num">Implied over (no vig)</th></tr></thead><tbody>`;
  for (const r of rows) {
    const m = r.m[mid]; if (!m) continue;
    const io = m.lstat === "ok" && m.op != null && m.up != null ? impl(m.op) / (impl(m.op) + impl(m.up)) : null;
    h += `<tr><td>W${r.wk} ${esc(r.ha === "home" ? "vs" : "@")} ${esc(r.opp)}</td>
      <td class="num">${lineCell(m)}</td><td class="num">${actualCell(r, m)}</td>
      <td class="num">${f(m.mean3, m.n3)}</td><td class="num">${f(m.med3, m.n3)}</td>
      <td class="num">${f(m.mean5, m.n5)}</td><td class="num">${f(m.med5, m.n5)}</td>
      <td class="num">${m.lstat === "ok" && m.mean5 != null ? num(m.line - m.mean5) : ""}</td>
      <td class="num">${io == null ? "" : `${(io * 100).toFixed(0)}%`}</td></tr>`;
  }
  h += `</tbody></table></div>`;
  return h;
}

function viewPlayer(pid) {
  const p = playerById[pid];
  if (!p) return `<p>Player not found. <a href="#/board">Back to board</a></p>`;
  const rows = D.rows[pid] || [];
  const ms = marketsFor(p.pos);
  const mid = S.market[pid] && ms.some((m) => m.id === S.market[pid]) ? S.market[pid] : ms[0].id;
  const curSlot = [...D.slots].filter((s) => s.pid === pid).sort((a, b) => b.wk - a.wk)[0];
  let h = `<p class="small"><a href="#/board">← Board</a></p>
    <div class="ph"><h2>${esc(p.name)}</h2><span class="chip">${esc(p.team)} · ${esc(p.pos)}</span>
    ${curSlot ? `<span class="muted">Week ${curSlot.wk}: <b>${curSlot.slot}</b> — ${esc(curSlot.basis)}</span>` : ""}</div>
    ${curSlot && curSlot.change ? `<p class="callout">Slot change: ${esc(curSlot.change)}</p>` : ""}
    <div class="mtabs">${ms.map((m) => `<button data-mid="${m.id}" class="${m.id === mid ? "on" : ""}">${esc(m.label)}</button>`).join("")}
    <span style="flex:1"></span><button id="an-toggle" class="${S.showAn ? "on" : ""}">${S.showAn ? "Hide analysis" : "Show analysis"}</button></div>
    <div class="panel"><div class="chart">${chartSVG(rows, mid)}</div>
    <div class="legend"><span><i style="border-color:var(--accent)"></i>Actual</span><span><i style="border-color:var(--ink);border-top-width:3px"></i>Pre-game line (green = over hit, red = under)</span></div></div>
    <div class="panel scroll"><table><thead><tr><th>Wk</th><th>Opponent</th><th title="Opponent defense rank in this stat vs. this position, using only games before this one. 1 = fewest allowed (toughest).">Opp D rank</th><th>Weather</th><th>Slot</th><th class="num" title="Pre-game line captured ~3 h before kickoff (graded). Before that, the latest snapshot is shown with a yellow Mon / Thu / Sun AM chip (not graded).">Line</th>
    <th class="num">Over</th><th class="num">Under</th><th>Book · captured</th><th class="num">Actual</th><th>Result</th>
    <th class="num">Snap %</th><th>Usage</th><th>Notes</th></tr></thead><tbody>`;
  for (const r of rows) {
    const m = r.m[mid];
    h += `<tr><td>${r.wk}</td><td>${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} <span class="muted small">${fmtTime(r.ko)}</span></td>
      <td class="small">${drankCell(m, p.pos, mkt[mid], r.opp)}</td>
      <td class="small">${wxCell(r.gid)}</td>
      <td>${esc(r.slot) || '<span class="muted small">not slotted</span>'}</td>
      <td class="num">${lineCell(m)}</td><td class="num">${ouCell(m, "o")}</td>
      <td class="num">${ouCell(m, "u")}</td><td class="small">${capCell(m)}${m && m.alt ? m.alt.map((a) => `<div class="muted">${esc(a.book)}: ${num(a.line)} (${a.op > 0 ? "+" : ""}${a.op ?? "?"}/${a.up > 0 ? "+" : ""}${a.up ?? "?"})</div>`).join("") : ""}</td>
      <td class="num">${actualCell(r, m)}</td><td>${resultCell(m)}</td><td class="num">${snapCell(r)}</td>
      <td class="small">${usageCell(r, p.pos)}</td><td class="note">${notes(r, m, null)}</td></tr>`;
  }
  h += `</tbody></table></div>`;
  if (S.showAn) h += analysisPanel(pid, mid, rows);
  return h;
}

function viewLeads() {
  let h = `<p class="callout">Upcoming props where the stored pre-game line differs most from the player's last 5 games (prior games only, min 3 games played).
    Sorted by percent gap. These are leads for further research, not predictions or guaranteed value. Lines appear here only after they are captured, about 3 hours before each kickoff.</p>`;
  if (!D.leads.length) return h + `<p class="muted">No upcoming lines captured yet.</p>`;
  h += `<div class="panel scroll"><table><thead><tr><th>Player</th><th>Team</th><th>Market</th><th>Game</th><th class="num">Line</th><th>Book · captured</th>
    <th class="num">3-gm mean</th><th class="num">5-gm mean</th><th class="num">5-gm median</th><th class="num">Line − 5-gm mean</th><th class="num">% gap</th></tr></thead><tbody>`;
  for (const l of D.leads) {
    const p = playerById[l.pid]; if (!p) continue;
    const mk = mkt[l.mid];
    h += `<tr><td><a href="#/player/${l.pid}">${esc(p.name)}</a></td><td>${esc(p.team)}</td><td>${esc(mk.label)}</td><td>${esc(gameLabel(l.gid))}</td>
      <td class="num"><b>${num(l.line)}</b></td><td class="small">${esc(l.book)} · ${fmtTime(l.cap)}</td>
      <td class="num">${num(l.mean3)} <span class="muted small">(n=${l.n3})</span></td><td class="num">${num(l.mean5)} <span class="muted small">(n=${l.n5})</span></td>
      <td class="num">${num(l.med5)}</td><td class="num">${l.gap5 > 0 ? "+" : ""}${num(l.gap5)}</td>
      <td class="num">${l.pct5 == null ? "" : `${l.pct5 > 0 ? "+" : ""}${l.pct5}%`}</td></tr>`;
  }
  return h + `</tbody></table></div>`;
}

function viewSlots() {
  const wk = S.slotWk;
  let rows = D.slots.filter((s) => s.wk === wk);
  if (S.slotTeam) rows = rows.filter((s) => s.team === S.slotTeam);
  rows.sort((a, b) => a.team.localeCompare(b.team) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  let h = `<p class="callout">Slots use only pre-game information: the latest ESPN depth chart snapshot before kickoff (via nflverse), average offensive snap share over the player's last 3 games played for the team (players with no snaps yet: 0.6 × depth score), and that week's injury report (Out players excluded, Doubtful ranked last). Slots freeze at kickoff.</p>
  <div class="filters"><label>Week ${weekSelect("s-wk", wk)}</label><label>Team <select id="s-team">${teamOptions(S.slotTeam)}</select></label>
  <span class="muted small">${rows.filter((r) => r.change).length} changes from prior week</span></div>`;
  if (!rows.length) return h + `<p class="muted">No slots computed for week ${wk} yet (computed through each team's next game).</p>`;
  h += `<div class="panel scroll"><table><thead><tr><th>Team</th><th>Slot</th><th>Player</th><th>Basis</th><th>Change from prior week</th><th>Depth chart as of</th><th>Status</th></tr></thead><tbody>`;
  let last = null;
  for (const s of rows) {
    h += `<tr class="${s.team !== last ? "grp" : ""}"><td>${s.team !== last ? esc(s.team) : ""}</td><td>${s.slot}</td><td><a href="#/player/${s.pid}">${esc(s.name)}</a></td>
      <td class="note">${esc(s.basis)}</td><td class="note">${esc(s.change)}</td><td class="small muted">${fmtTime(s.snapshot)}</td><td class="small">${s.frozen ? "final" : "provisional"}</td></tr>`;
    last = s.team;
  }
  return h + `</tbody></table></div>`;
}

function viewLog(live) {
  const src = D.sources || {};
  let h = `<div class="grid2"><div class="panel"><h3>Data sources</h3><div class="body"><table class="wrap"><thead><tr><th>Dataset</th><th>Source last updated</th><th>Fetched</th></tr></thead><tbody>`;
  for (const [k, v] of Object.entries(src)) h += `<tr><td><a href="${esc(v.url)}">${esc(v.label)}</a></td><td class="small">${esc(v.last_updated)}</td><td class="small">${fmtTime(v.fetched_utc)}</td></tr>`;
  h += `</tbody></table></div></div>
    <div class="panel"><h3>Prop collection</h3><div class="body kv">
      <div>Collection started</div><div>${fmtTime(D.collection_start_utc)}</div>
      <div>Games with a pre-game line</div><div>${D.odds.games_captured}</div>
      <div>Stored lines (pre-game / snapshots)</div><div>${D.odds.captures} / ${D.odds.snapshot_captures ?? 0}</div>
      <div>Last capture</div><div>${D.odds.last_capture_utc ? fmtTime(D.odds.last_capture_utc) : NA("none yet")}</div>
      <div>API credits remaining</div><div>${D.odds.credits_remaining || NA("unknown until first pull")}</div>
      <div>Site data built</div><div>${fmtTime(D.generated_utc)}</div>
    </div></div></div>`;
  if (live && live.length) {
    h += `<div class="panel scroll"><h3>Recent scheduled runs (live from GitHub)</h3><table><thead><tr><th>Started</th><th>Trigger</th><th>Result</th><th>Link</th></tr></thead><tbody>`;
    for (const r of live.slice(0, 15)) h += `<tr><td>${fmtTime(r.run_started_at || r.created_at)}</td><td>${esc(r.event)}</td><td>${esc(r.conclusion || r.status)}</td><td><a href="${esc(r.html_url)}">log</a></td></tr>`;
    h += `</tbody></table></div>`;
  }
  h += `<div class="panel scroll"><h3>Pull log (snapshots: Mon / Thu / Sun AM; graded line: pre-game ~3 h before kickoff)</h3><table><thead><tr><th>Game</th><th>Type</th><th>Status</th><th>Attempted</th><th class="num">Min before KO</th><th>In window</th><th>Markets</th><th class="num">Lines</th><th class="num">Credits used / left</th><th>Note</th></tr></thead><tbody>`;
  const pl = [...D.pull_log].reverse();
  if (!pl.length) h += `<tr><td colspan="10" class="muted">No pulls yet. The first pull runs about 3 hours before the next kickoff.</td></tr>`;
  const PT = { pregame: "Pre-game", mon: "Mon", thu: "Thu", sun: "Sun AM" };
  for (const p of pl) h += `<tr><td>${esc(gameLabel(p.game_id))}</td><td>${esc(PT[p.pull_type || "pregame"] || p.pull_type)}</td><td>${esc(p.status)}</td><td class="small">${fmtTime(p.attempted_utc)}</td><td class="num">${esc(p.minutes_before_kickoff)}</td><td>${esc(p.in_window)}</td><td class="small mono">${esc((p.markets || "").replace(/player_/g, ""))}</td><td class="num">${esc(p.outcomes)}</td><td class="num">${esc(p.credits_last)} / ${esc(p.credits_remaining)}</td><td class="note">${esc(p.note)}</td></tr>`;
  h += `</tbody></table></div>`;
  if (D.unmatched.length) {
    h += `<div class="panel scroll"><h3>Lines not matched to a player</h3><table><thead><tr><th>Game</th><th>Book</th><th>Market</th><th>Name from book</th></tr></thead><tbody>`;
    for (const u of D.unmatched) h += `<tr><td>${esc(gameLabel(u.game_id))}</td><td>${esc(u.book)}</td><td>${esc(u.market)}</td><td>${esc(u.name)}</td></tr>`;
    h += `</tbody></table></div>`;
  }
  h += `<div class="panel scroll"><h3>Run log (as of last data build)</h3><table><thead><tr><th>Run</th><th>Trigger</th><th>Status</th><th>Built</th><th>Summary</th></tr></thead><tbody>`;
  for (const r of [...D.runs].reverse().slice(0, 60)) h += `<tr><td class="small">${fmtTime(r.run_utc)}</td><td>${esc(r.trigger)}</td><td>${esc(r.status)}</td><td>${esc(r.built)}</td><td class="note">${esc(r.summary)}${r.error ? " · " + esc(r.error) : ""}</td></tr>`;
  return h + `</tbody></table></div>`;
}

// ---------- routing ----------
let LIVE = null;
function render() {
  const hash = location.hash || "#/board";
  const [, tab, arg] = hash.split("/");
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (tab === "player" ? "board" : tab)));
  if (tab === "player") app.innerHTML = viewPlayer(arg);
  else if (tab === "leads") app.innerHTML = viewLeads();
  else if (tab === "slots") app.innerHTML = viewSlots();
  else if (tab === "log") app.innerHTML = viewLog(LIVE);
  else app.innerHTML = viewBoard();
  bind(tab, arg);
}
function bind(tab, arg) {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on("f-wk", "change", (e) => { S.wk = +e.target.value; S.game = ""; render(); });
  document.querySelectorAll("[data-gid]").forEach((b) => b.addEventListener("click", () => { S.game = b.dataset.gid; render(); }));
  on("f-team", "change", (e) => { S.team = e.target.value; render(); });
  on("f-pos", "change", (e) => { S.pos = e.target.value; render(); });
  on("f-q", "input", (e) => { S.q = e.target.value; clearTimeout(bind.t); bind.t = setTimeout(() => { render(); const el = document.getElementById("f-q"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 200); });
  on("s-wk", "change", (e) => { S.slotWk = +e.target.value; render(); });
  on("s-team", "change", (e) => { S.slotTeam = e.target.value; render(); });
  on("an-toggle", "click", () => { S.showAn = !S.showAn; render(); });
  document.querySelectorAll("[data-mid]").forEach((b) => b.addEventListener("click", () => { S.market[arg] = b.dataset.mid; render(); }));
}

async function liveRuns() {
  if (!D.repo) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${D.repo}/actions/workflows/update.yml/runs?per_page=20`);
    if (!r.ok) return null;
    return (await r.json()).workflow_runs || null;
  } catch { return null; }
}
async function status() {
  const st = document.getElementById("status");
  const stale = document.getElementById("stale");
  LIVE = await liveRuns();
  const warn = [];
  if (LIVE && LIVE.length) {
    const done = LIVE.filter((r) => r.status === "completed");
    const ok = done.find((r) => r.conclusion === "success");
    const latest = done[0];
    if (ok) {
      const t = ok.updated_at;
      st.textContent = `Last updated ${ago(t)} (${fmtTime(t)})`;
      if (Date.now() - new Date(t).getTime() > 75 * 60000) warn.push(`Data may be stale: the last successful update was ${ago(t)}.`);
    } else st.textContent = "No successful run yet";
    if (latest && latest.conclusion && latest.conclusion !== "success") warn.push(`The most recent run (${fmtTime(latest.updated_at)}) ended with "${latest.conclusion}". It will retry on the next schedule.`);
  } else {
    st.textContent = `Data built ${ago(D.generated_utc)} (${fmtTime(D.generated_utc)})`;
    if (Date.now() - new Date(D.generated_utc).getTime() > 30 * 3600000) warn.push(`Data may be stale: last data build was ${ago(D.generated_utc)}.`);
  }
  if (warn.length) { stale.hidden = false; stale.textContent = "⚠ " + warn.join(" "); st.classList.add("bad"); }
  if ((location.hash || "").startsWith("#/log")) render();
}

(async function init() {
  try {
    const r = await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    D = await r.json();
  } catch (e) {
    app.innerHTML = `<p class="pad">Could not load data (${esc(e.message)}).</p>`;
    document.getElementById("status").textContent = "No data";
    return;
  }
  D.players.forEach((p) => (playerById[p.id] = p));
  D.markets.forEach((m) => (mkt[m.id] = m));
  S.wk = D.current_week || D.weeks[D.weeks.length - 1];
  S.slotWk = S.wk;
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
  status();
})();
