"use strict";
// NFL Prop Tracker front end. Reads data/data.json (built by the GitHub Action). No external libraries.

let D = null;
const S = { tab: "board", defMk: "WR:rec_yds", defAsc: true, wk: null, game: "", team: "", pos: "", q: "", slotWk: null, slotTeam: "", market: {}, showAn: false };
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
// Weather summary labels. These thresholds are the single source for both the labels and the Guide tab.
const WX_RULES = {
  rainIn: 0.05,      // precipitation (in) over kickoff hour + next 3 h
  rainProb: 50,      // forecast chance of precipitation (%)
  snowIn: 0.02,      // precipitation (in) that counts as snow when cold
  snowTempF: 34,     // at or below this temperature, precipitation is labeled Snowy
  windMph: 15,       // sustained wind at kickoff (mph)
  gustMph: 25,       // wind gusts at kickoff (mph)
  freezingF: 32,     // at or below: Freezing
  coldF: 40,         // at or below: Cold
  hotF: 85,          // at or above: Hot
};
// Trend + season average rules (used by the phone cards and listed on the Guide tab).
const STARTER_SLOTS = ["QB1", "RB1", "WR1", "WR2", "WR3", "TE1"];
const TREND_RULES = {
  lastN: 3,          // compare the last N started games ...
  pct: 10,           // ... to the season average: >= +10% Rising, <= -10% Falling, otherwise Steady
  minGames: 4,       // fewer started games than this: no trend ("—"); needs more than lastN so the comparison means something
  usagePct: 10,      // usage (target share for WR/TE, snap share for RB) moving >= 10% the same way backs the trend
};
function wxValues(w) {
  const p = w.obs_temp_f != null ? "obs" : w.fc_temp_f != null ? "fc" : null;
  if (!p) return null;
  const n = (k) => (w[`${p}_${k}`] == null ? null : Number(w[`${p}_${k}`]));
  return { kind: p, t: n("temp_f"), wind: n("wind_mph"), gust: n("gust_mph"), pr: n("precip_in"), pp: p === "fc" ? n("precip_prob") : null };
}
function wxSummary(w) {
  const v = wxValues(w); if (!v) return null;
  const R = WX_RULES, out = [], why = [];
  const wetAmt = v.pr != null && v.pr >= R.rainIn, wetProb = v.pp != null && v.pp >= R.rainProb;
  if (v.t != null && v.t <= R.snowTempF && ((v.pr != null && v.pr >= R.snowIn) || wetProb)) { out.push("Snowy"); why.push(`${v.t}°F with ${v.pr ?? 0} in precip${v.pp != null ? ` / ${v.pp}% chance` : ""}`); }
  else if (wetAmt || wetProb) { out.push("Rainy"); why.push(wetAmt ? `${v.pr} in precip` : `${v.pp}% chance of precip`); }
  if ((v.wind != null && v.wind >= R.windMph) || (v.gust != null && v.gust >= R.gustMph)) { out.push("Windy"); why.push(`wind ${v.wind} mph, gusts ${v.gust ?? "?"} mph`); }
  if (v.t != null && v.t <= R.freezingF) { out.push("Freezing"); why.push(`${v.t}°F`); }
  else if (v.t != null && v.t <= R.coldF) { out.push("Cold"); why.push(`${v.t}°F`); }
  else if (v.t != null && v.t >= R.hotF) { out.push("Hot"); why.push(`${v.t}°F`); }
  const EMOJI = { Rainy: "🌧️", Snowy: "❄️", Windy: "💨", Nice: "☀️" };
  const parts = out.length ? out : ["Nice"];
  const label = parts.map((x) => (EMOJI[x] ? `${EMOJI[x]} ${x}` : x)).join(" & ");
  return { label, nice: !out.length, why: out.length ? why.join("; ") : "no trigger met", kind: v.kind };
}
function wxBadge(w, roof) {
  const s = wxSummary(w); if (!s) return "";
  const tip = `${s.label}: ${s.why} (${s.kind === "obs" ? "observed" : "forecast"}). Triggers are on the Guide tab.` + (roof ? " Retractable-roof stadium." : "");
  return `<a href="#/guide" class="wxb ${s.nice ? "nice" : "bad"}" title="${esc(tip)}">${esc(s.label)}</a> `;
}
function wxCell(gid) {
  const g = D.games[gid]; if (!g) return "";
  const w = g.wx || {};
  if (w.roof === "dome") return `<a href="#/guide" class="wxb dome" title="Fixed-roof stadium (${esc(g.stadium)}). Weather does not apply.">Dome</a>`;
  if (!g.wx) return NA("no data");
  if (w.note) return `<span class="na" title="${esc(g.stadium)}">no data (${esc(w.note)})</span>`;
  const roof = w.roof === "retractable" ? "Retractable-roof stadium · " : "";
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
  const badge = wxBadge(w, !!roof);
  if (obs) return badge + `<span class="wx" title="${esc(roof + "Observed. Gusts " + (w.obs_gust_mph ?? "?") + " mph. " + (fc ? "Last pre-game forecast: " + fc + ". " : "") + src)}"><span class="muted">Obs</span> ${esc(obs)}</span>`;
  if (fc) {
    const pre = ko > now ? "Fcst" : "Last fcst";
    const tip = roof + `Forecast fetched ${fmtTime(w.fc_fetched_utc)}. Gusts ${w.fc_gust_mph ?? "?"} mph. ` + (ko > now ? "Refreshed every ~3 h until kickoff. " : "Observed values appear about 6 days after the game. ") + src;
    return badge + `<span class="wx" title="${esc(tip)}"><span class="muted">${pre}</span> ${esc(fc)}</span>`;
  }
  if (ko > now) return `<span class="na" title="Open-Meteo forecasts reach 16 days ahead">forecast not out yet</span>`;
  return `<span class="na" title="Open-Meteo's observed archive has about a 5-day delay">observed weather pending</span>`;
}
function headshot(pid, size) {
  const p = playerById[pid];
  if (!p || !p.img) return `<span class="hs none" style="width:${size}px;height:${size}px"></span>`;
  return `<img class="hs" src="${esc(p.img)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hs none',style:'width:${size}px;height:${size}px'}))">`;
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
  html += `<div class="panel scroll board"><table><thead><tr>
    <th>Game</th><th>Team</th><th>Slot</th><th>Player</th><th>Market</th><th title="Opponent defense rank in this stat vs. this position, using only games before this one. 1 = fewest allowed (toughest).">Opp D rank</th><th class="num" title="Pre-game line captured ~3 h before kickoff (graded). Before that, the latest snapshot is shown with a yellow Mon / Thu / Sun AM chip (not graded).">Line</th>
    <th class="num">Over</th><th class="num">Under</th><th>Book · captured</th><th class="num">Actual</th><th>Result</th>
    <th class="num">Snap %</th><th>Usage</th><th>Notes</th></tr></thead><tbody>`;
  // Rows per game, so the Game cell can span every row of that game.
  const span = {};
  for (const { s, r } of items) span[r.gid] = (span[r.gid] || 0) + marketsFor(s.slot.slice(0, 2)).length;
  let lastGid = null;
  for (const { s, r } of items) {
    const pos = s.slot.slice(0, 2);
    const ms = marketsFor(pos);
    ms.forEach((mk, i) => {
      const m = r.m[mk.id];
      const first = i === 0;
      const newGame = first && r.gid !== lastGid;
      const grp = newGame ? "grp" : first ? "plr" : "";
      html += `<tr class="${grp}">
        ${newGame ? `<td class="gamecell" rowspan="${span[r.gid]}"><div class="gwrap"><b>${esc(gameLabel(r.gid))}</b><div class="muted small">${fmtTime(r.ko)}</div><div class="small wxline">${wxCell(r.gid)}</div></div></td>` : ""}
        <td>${first ? esc(s.team) : ""}</td>
        <td>${first ? `<span class="chip ${s.change ? "chg" : ""}" title="${esc(s.change ? "Changed: " + s.change : s.basis)}">${s.slot}${s.change ? " ↺" : ""}</span>` : ""}</td>
        <td>${first ? `<a class="pname" href="#/player/${s.pid}">${headshot(s.pid, 28)}${esc(s.name)}</a>` : ""}</td>
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

function niceStep(range, target = 5) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of [1, 2, 2.5, 5, 10]) if (raw <= f * mag) return f * mag;
  return 10 * mag;
}
function chartSVG(rows, mid, o = {}) {
  // act = actual stat; line = graded pre-game line; proj = latest snapshot shown until the pre-game line exists
  const pts = rows.map((r) => {
    const m = r.m[mid] || {};
    const sn = m.lstat === "pending" ? latestSnap(m) : null;
    return { wk: r.wk, r, m, act: m.act ?? null, line: m.lstat === "ok" ? m.line : null,
             proj: sn && sn.line != null ? sn : null };
  });
  const vals = pts.flatMap((p) => [p.act, p.line, p.proj ? p.proj.line : null]).filter((v) => v != null);
  if (!vals.length) return `<p class="muted pad">No data to chart yet.</p>`;
  const { W = 1200, H = 280, L = 48, R = 70, T = 22, B = 30, fs = 12, edgeAbove = false } = o; // phone view passes a smaller canvas
  // edgeAbove: put line/snapshot labels above the marker for the last week so they are not cut off on narrow charts
  const lbl = (i, x, y) => (edgeAbove && i === pts.length - 1 ? `x="${x}" y="${y - 9}" text-anchor="middle"` : `x="${x + 18}" y="${y + 4}"`);
  const top = Math.max(...vals);
  const step = niceStep(top || 1);
  const max = Math.ceil((top * 1.08) / step) * step || step, min = 0;
  const xs = (i) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const ys = (v) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const fmtTick = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(step < 1 ? 1 : 1));
  let g = "";
  for (let v = min; v <= max + 1e-9; v += step) {
    g += `<line x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}" stroke="var(--line)"/>
      <text x="${L - 8}" y="${ys(v) + 4}" text-anchor="end" font-size="${fs}" fill="var(--muted)">${fmtTick(v)}</text>`;
  }
  pts.forEach((p, i) => {
    g += `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle" font-size="${fs}" fill="var(--muted)">W${p.wk}</text>`;
  });
  // actual line (breaks at DNP / not played)
  let path = "", pen = false;
  pts.forEach((p, i) => {
    if (p.act == null) { pen = false; return; }
    path += `${pen ? "L" : "M"}${xs(i)},${ys(p.act)} `; pen = true;
  });
  g += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  pts.forEach((p, i) => {
    const x = xs(i);
    if (p.line != null) {
      const res = p.m.res;
      const col = res === "over" ? "var(--over)" : res === "under" ? "var(--under)" : "var(--ink)";
      g += `<line x1="${x - 14}" x2="${x + 14}" y1="${ys(p.line)}" y2="${ys(p.line)}" stroke="${col}" stroke-width="3"><title>W${p.wk} pre-game line ${num(p.line)} (${esc(p.m.book || "")})</title></line>
        <text ${lbl(i, x, ys(p.line))} font-size="${fs}" font-weight="600" fill="${col}">${num(p.line)}</text>`;
    }
    if (p.proj) {
      const y = ys(p.proj.line);
      g += `<line x1="${x - 14}" x2="${x + 14}" y1="${y}" y2="${y}" stroke="var(--warn-ink)" stroke-width="3" stroke-dasharray="4 3"><title>W${p.wk} ${esc(p.proj.label)} snapshot ${num(p.proj.line)} (${esc(p.proj.book)}, ${esc(fmtTime(p.proj.cap))}). Not graded; replaced by the pre-game line.</title></line>
        <text ${lbl(i, x, y)} font-size="${fs}" font-weight="600" fill="var(--warn-ink)">${num(p.proj.line)} ${esc(p.proj.label)}</text>`;
    }
    if (p.act != null) {
      g += `<circle cx="${x}" cy="${ys(p.act)}" r="4.5" fill="var(--accent)"><title>W${p.wk} actual ${num(p.act)}</title></circle>
        <text x="${x}" y="${ys(p.act) - 9}" text-anchor="middle" font-size="${fs}" fill="var(--accent)">${num(p.act)}</text>`;
    }
    if (p.r.played === false) g += `<text x="${x}" y="${ys(min) - 6}" text-anchor="middle" font-size="${fs - 1}" fill="var(--muted)">DNP</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
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

// ---------- compact cells for the desktop player table ----------
const BOOK_ABBR = { DraftKings: "DK", FanDuel: "FD" };
function wxCompact(gid) {
  const g = D.games[gid]; if (!g) return "";
  const w = g.wx || {};
  if (w.roof === "dome") return `<span class="wxb dome" title="Fixed-roof stadium (${esc(g.stadium)}). Weather does not apply.">Dome</span>`;
  const v = g.wx ? wxValues(w) : null;
  if (!v) {
    const future = new Date(g.ko).getTime() > Date.now();
    return `<span class="na" title="${future ? "Open-Meteo forecasts reach about 16 days ahead" : "Observed weather arrives about 6 days after the game"}">${future ? "forecast not out yet" : "pending"}</span>`;
  }
  const s = wxSummary(w);
  const rain = v.pr == null ? "–" : v.pr === 0 ? "0" : String(v.pr).replace(/^0\./, ".");
  const tip = `${v.kind === "obs" ? "Observed" : `Forecast (fetched ${fmtTime(w.fc_fetched_utc)})`}: ${v.t}°F, wind ${v.wind} mph` +
    (v.gust != null ? ` (gusts ${v.gust} mph)` : "") + `, ${v.pr ?? "?"} in precipitation over the kickoff hour + next 3 h` +
    (v.pp != null ? ` (${v.pp}% chance)` : "") + (w.roof === "retractable" ? ". Retractable-roof stadium" : "") +
    `. ${s.label}: ${s.why}. Label rules are on the Guide tab.`;
  return `<span class="wxc" title="${esc(tip)}"><a href="#/guide" class="wxb ${s.nice ? "nice" : "bad"}">${esc(s.label)}</a> · ${v.t} · ${v.wind}mph · ${rain}in</span>`;
}
function lineCompact(m) {
  if (m && m.lstat === "not_collected") return `<span class="na" title="Game was played before line collection began (10/20/2026)">N/A</span>`;
  return lineCell(m);
}
function oddsCompact(m) {
  if (m && m.lstat === "ok") return `${odds(m.op)} / ${odds(m.up)}`;
  const sn = m && m.lstat === "pending" ? latestSnap(m) : null;
  return sn ? `<span class="snap">${odds(sn.op)} / ${odds(sn.up)}</span>` : "";
}
function bookCompact(m) {
  const strip = (x) => String(x).replace(/<[^>]+>/g, "");
  if (m && m.lstat === "ok") {
    const moves = (m.snaps || []).map((x) => `${x.label} ${num(x.line)} (${x.book}, ${fmtTime(x.cap)})`).join("; ");
    const alts = (m.alt || []).map((a) => `${a.book} ${num(a.line)} (${strip(odds(a.op))}/${strip(odds(a.up))})`).join("; ");
    const tip = `${m.book}, captured ${fmtTime(m.cap)}` + (m.mins ? ` (${m.mins} min before kickoff)` : "") +
      (alts ? `. Also: ${alts}` : "") + (moves ? `. Earlier: ${moves}` : "");
    return `<span title="${esc(tip)}">${esc(BOOK_ABBR[m.book] || m.book)} · Pre</span>`;
  }
  const sn = m && m.lstat === "pending" ? latestSnap(m) : null;
  if (!sn) return "";
  const tip = (m.snaps || []).map((x) => `${x.label}: ${num(x.line)} (${x.book}, ${fmtTime(x.cap)})`).join("; ") + ". Snapshot, not graded.";
  return `<span title="${esc(tip)}">${esc(BOOK_ABBR[sn.book] || sn.book)} · ${esc(sn.label)}</span>`;
}
function snapUse(r, pos) {
  const parts = [];
  const sc = snapCell(r);
  if (sc) parts.push(sc);
  if (pos === "RB") {
    if (r.car != null) parts.push(`${num(r.car, 0)} car`);
    if (r.tgt != null) parts.push(`${num(r.tgt, 0)} tgt`);
  } else if (pos !== "QB" && r.tgt != null) parts.push(`${num(r.tgt, 0)} tgt`);
  return parts.join(" · ");
}
function actualCompact(r, m) {
  if (r.played === false) return `<span class="na" title="${esc(r.dnp || "Did not play")}">DNP</span>`;
  return actualCell(r, m);
}

function viewPlayer(pid) {
  const p = playerById[pid];
  if (!p) return `<p>Player not found. <a href="#/board">Back to board</a></p>`;
  const rows = D.rows[pid] || [];
  const ms = marketsFor(p.pos);
  const mid = S.market[pid] && ms.some((m) => m.id === S.market[pid]) ? S.market[pid] : ms[0].id;
  const curSlot = [...D.slots].filter((s) => s.pid === pid).sort((a, b) => b.wk - a.wk)[0];
  let h = `<p class="small"><a href="#/board">← Board</a></p>
    <div class="ph">${headshot(pid, 72)}<h2>${esc(p.name)}</h2><span class="chip">${esc(p.team)} · ${esc(p.pos)}</span>
    ${curSlot ? `<span class="muted">Week ${curSlot.wk}: <b>${curSlot.slot}</b> — ${esc(curSlot.basis)}</span>` : ""}</div>
    ${curSlot && curSlot.change ? `<p class="callout">Slot change: ${esc(curSlot.change)}</p>` : ""}
    <div class="mtabs">${ms.map((m) => `<button data-mid="${m.id}" class="${m.id === mid ? "on" : ""}">${esc(m.label)}</button>`).join("")}
    <span style="flex:1"></span><button id="an-toggle" class="${S.showAn ? "on" : ""}">${S.showAn ? "Hide analysis" : "Show analysis"}</button></div>
    <div class="panel"><div class="chart">${chartSVG(rows, mid, { edgeAbove: true })}</div>
    <div class="legend"><span><i style="border-color:var(--accent)"></i>Actual</span><span><i style="border-color:var(--ink);border-top-width:3px"></i>Pre-game line (green = over hit, red = under)</span><span><i style="border-color:var(--warn-ink);border-top-width:3px;border-top-style:dashed"></i>Latest snapshot (Mon / Thu / Sun AM), until the pre-game line arrives</span></div></div>
    <div class="panel scroll"><table class="ptable"><thead><tr><th>Wk</th><th>Opponent</th><th title="Opponent defense rank in this stat vs. this position, using only games before this one. 1 = fewest allowed (toughest).">Opp D rank</th><th title="Label · temperature (°F) · wind · precipitation. Hover for details.">Weather</th><th>Slot</th><th class="num" title="Pre-game line captured ~3 h before kickoff (graded). Before that, the latest snapshot is shown with a yellow Mon / Thu / Sun AM chip (not graded).">Line</th>
    <th class="num" title="Over / Under odds">Odds</th><th title="Book · which pull (hover for the exact time and line movement)">Book</th><th class="num">Actual</th><th>Result</th>
    <th class="num" title="Offensive snap share · usage (targets; carries for RBs)">Snap · use</th><th></th></tr></thead><tbody>`;
  for (const r of rows) {
    const m = r.m[mid];
    const nt = notes(r, m, null);
    h += `<tr><td>${r.wk}</td><td title="${esc(fmtTime(r.ko))}">${r.ha === "home" ? "vs." : "@"} ${esc(r.opp)}</td>
      <td class="small">${drankCell(m, p.pos, mkt[mid], r.opp)}</td>
      <td class="small">${wxCompact(r.gid)}</td>
      <td>${r.slot ? esc(r.slot) : '<span class="na">N/A</span>'}</td>
      <td class="num">${lineCompact(m)}</td><td class="num">${oddsCompact(m)}</td>
      <td class="small">${bookCompact(m)}</td>
      <td class="num">${actualCompact(r, m)}</td><td>${resultCell(m)}</td>
      <td class="num small">${snapUse(r, p.pos)}</td>
      <td>${nt ? `<button class="info" data-note title="Show notes" aria-label="Show notes">ⓘ</button>` : ""}</td></tr>`;
    if (nt) h += `<tr class="noterow" hidden><td></td><td colspan="11" class="note">${nt}</td></tr>`;
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

function weekPullsPanel() {
  const W = D.week_pulls;
  if (!W || !W.pulls) return "";
  const PT = { pregame: "Pre-game", mon: "Mon", thu: "Thu", sun: "Sun AM" };
  const MK = Object.fromEntries(D.markets.map((m) => [m.key, m.label]));
  const pulls = [...W.pulls].sort((a, b) => b.attempted_utc.localeCompare(a.attempted_utc));
  let h = `<div class="panel"><h3>Week ${W.week} pulls (${pulls.length}) · tap a pull to see the lines it returned</h3><div class="body wkp">`;
  if (!pulls.length) return h + `<p class="muted">No pulls yet this week.</p></div></div>`;
  for (const p of pulls) {
    const key = `${p.game_id}|${p.pull_type || "pregame"}|${p.attempted_utc}`;
    const lines = (W.lines || {})[key] || [];
    const tracked = (W.tracked || {})[p.game_id] || [];
    const byPlayer = {};
    for (const [name, gs, mk, book, line, op, up] of lines) (byPlayer[gs || "?" + name] ||= { name, gs, items: [] }).items.push({ mk, book, line, op, up });
    const got = new Set(lines.map((l) => l[1]).filter(Boolean));
    const missing = tracked.filter(([pid]) => !got.has(pid));
    const trackedIds = new Set(tracked.map(([pid]) => pid));
    const slotOf = Object.fromEntries(tracked.map(([pid, , slot]) => [pid, slot]));
    const ok = p.status === "ok";
    h += `<details class="wkpull"><summary><span class="wkg">${esc(gameLabel(p.game_id))}</span>
      <span class="chip ${p.pull_type && p.pull_type !== "pregame" ? "snapchip" : ""}">${esc(PT[p.pull_type || "pregame"] || p.pull_type)}</span>
      <span class="${ok ? "" : "na"}">${esc(p.status)}</span>
      <span class="muted small">${fmtTime(p.attempted_utc)}${p.minutes_before_kickoff ? ` · ${esc(p.minutes_before_kickoff)} min before KO` : ""}</span>
      <span class="small">${lines.length} lines · ${Object.keys(byPlayer).length} players${tracked.length ? ` · <b class="${missing.length ? "wkmiss" : "wkall"}">${tracked.length - missing.length}/${tracked.length} tracked</b>` : ""}</span>
      <span class="muted small">credits ${esc(p.credits_last || "0")}</span></summary>`;
    if (p.note) h += `<p class="muted small">${esc(p.note)}</p>`;
    if (missing.length) h += `<p class="small"><b>Tracked players with no line in this pull:</b> ${missing.map(([pid, name, slot]) => `<a href="#/player/${pid}">${esc(name)}</a> <span class="muted">${esc(slot)}</span>`).join(", ")}</p>`;
    if (lines.length) {
      const players = Object.values(byPlayer).sort((a, b) => (trackedIds.has(b.gs) - trackedIds.has(a.gs)) || a.name.localeCompare(b.name));
      h += `<table class="wrap wkt"><tbody>`;
      for (const pl of players) {
        const tr = trackedIds.has(pl.gs);
        h += `<tr class="${tr ? "" : "untracked"}"><td>${tr ? `<a href="#/player/${pl.gs}">${esc(pl.name)}</a> <span class="muted small">${esc(slotOf[pl.gs])}</span>` : `${esc(pl.name)} <span class="muted small">not tracked</span>`}</td>
          <td class="small">${pl.items.sort((a, b) => a.mk.localeCompare(b.mk) || a.book.localeCompare(b.book)).map((it) => `${esc(MK[it.mk] || it.mk)} <b>${num(it.line)}</b> <span class="muted">${odds(it.op)}/${odds(it.up)} ${esc(BOOK_ABBR[it.book] || it.book)}</span>`).join(" · ")}</td></tr>`;
      }
      h += `</tbody></table>`;
    }
    h += `</details>`;
  }
  return h + `</div></div>`;
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
  h += weekPullsPanel();
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

function viewGuide() {
  const R = WX_RULES;
  const row = (label, cls, rule) => `<tr><td><span class="wxb ${cls}">${label}</span></td><td class="wrapcell">${rule}</td></tr>`;
  return `<div class="panel"><h3>Weather labels</h3><div class="body">
    <p class="callout">Each game's weather gets a one-glance label from the numbers below. Several can apply at once and are joined with "&amp;" (for example <b>🌧️ Rainy &amp; 💨 Windy</b>). If none apply, the label is <b>Nice</b>. Past games use observed weather; upcoming games use the latest forecast. Hover a label on the Board to see which values triggered it.</p>
    <table class="wrap"><thead><tr><th>Label</th><th>Triggered when</th></tr></thead><tbody>
    ${row("🌧️ Rainy", "bad", `Precipitation of <b>${R.rainIn} in or more</b> over the kickoff hour and next 3 hours, <b>or</b> a forecast chance of precipitation of <b>${R.rainProb}% or more</b>.`)}
    ${row("❄️ Snowy", "bad", `Temperature at kickoff of <b>${R.snowTempF}°F or colder</b> with <b>${R.snowIn} in or more</b> of precipitation (or a ${R.rainProb}%+ chance). Replaces Rainy.`)}
    ${row("💨 Windy", "bad", `Sustained wind at kickoff of <b>${R.windMph} mph or more</b>, <b>or</b> gusts of <b>${R.gustMph} mph or more</b>.`)}
    ${row("Freezing", "bad", `Temperature at kickoff of <b>${R.freezingF}°F or colder</b>.`)}
    ${row("Cold", "bad", `Temperature at kickoff of <b>${R.coldF}°F or colder</b> (and above ${R.freezingF}°F).`)}
    ${row("Hot", "bad", `Temperature at kickoff of <b>${R.hotF}°F or hotter</b>.`)}
    ${row("☀️ Nice", "nice", "None of the above.")}
    ${row("Dome", "dome", "Fixed-roof stadium. Weather does not apply.")}
    </tbody></table>
    <p class="muted small">These thresholds are this app's own rules of thumb for flagging games worth a closer look. They are not an official standard and not a prediction of how weather affects any stat. Weather data: Open-Meteo, at the stadium: temperature and wind at the kickoff hour, precipitation summed over the kickoff hour + next 3 hours.</p>
  </div></div>
  <div class="panel"><h3>Season average and trend (phone player cards)</h3><div class="body">
    <table class="wrap"><thead><tr><th>Item</th><th>Rule</th></tr></thead><tbody>
    <tr><td><b>Starts</b></td><td class="wrapcell">A game counts as a start when the player's pre-game slot was a starting spot: <b>${STARTER_SLOTS.join(", ")}</b> (slots come from the depth chart and recent snap share; see the Slots tab), and he played. Our data sources have no official "started" field, so this is the app's definition.</td></tr>
    <tr><td><b>AVG</b> (season average)</td><td class="wrapcell">Average of the stat over every <b>start</b> this season before the upcoming game. Games he didn't start or didn't play are left out. Shows "—" with no starts yet.</td></tr>
    <tr><td><b>↑ Rising</b></td><td class="wrapcell">Average of his last <b>${TREND_RULES.lastN} starts</b> is <b>${TREND_RULES.pct}% or more above</b> his season average.</td></tr>
    <tr><td><b>↓ Falling</b></td><td class="wrapcell">Average of his last ${TREND_RULES.lastN} starts is <b>${TREND_RULES.pct}% or more below</b> his season average.</td></tr>
    <tr><td><b>→ Steady</b></td><td class="wrapcell">Within ±${TREND_RULES.pct}% of his season average.</td></tr>
    <tr><td><b>—</b></td><td class="wrapcell">Fewer than <b>${TREND_RULES.minGames} starts</b>: not enough to call a trend.</td></tr>
    <tr><td><b>usage ↑ / usage ↓</b></td><td class="wrapcell">Shown next to Rising or Falling when his usage over the same last ${TREND_RULES.lastN} starts moved <b>${TREND_RULES.usagePct}% or more</b> the same way vs. his season average: <b>target share</b> for WR/TE, <b>snap share</b> for RB (not used for QB). <b>mixed</b> means usage moved the opposite way.</td></tr>
    </tbody></table>
    <p class="muted small">Rules of thumb for spotting a player whose recent production differs from his season, not predictions.</p>
  </div></div>
  <div class="panel"><h3>Other symbols</h3><div class="body"><table class="wrap"><tbody>
    <tr><td><span class="chip snapchip">Mon</span> <span class="chip snapchip">Thu</span> <span class="chip snapchip">Sun AM</span></td><td class="wrapcell">Line-movement snapshots (Monday 8 AM, Thursday 2 PM, Sunday 8 AM Central). Shown until the pre-game line arrives; never graded.</td></tr>
    <tr><td><b>Line</b> (no chip)</td><td class="wrapcell">Pre-game line captured about 3 hours before kickoff. This is the line that is graded over / under / push / void.</td></tr>
    <tr><td><span class="drk tough">5th</span> / <span class="drk easy">28th</span></td><td class="wrapcell">Opp D rank: how the opponent ranks in that stat against that position, using only games before that game. 1 = fewest allowed (toughest), 32 = most allowed. Colored only after 3+ games: red = top quarter (toughest), green = bottom quarter.</td></tr>
    <tr><td><span class="chip chg">WR2 ↺</span></td><td class="wrapcell">The player's slot changed from the prior week (hover for the reason).</td></tr>
  </tbody></table></div></div>`;
}

// ---------- Defense ranks tab ----------
function defMarkets() {
  const out = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) for (const m of D.markets) if (m.pos.includes(pos)) out.push({ key: `${pos}:${m.id}`, pos, m });
  return out;
}
function viewDefense() {
  const list = defMarkets();
  if (!list.some((x) => x.key === S.defMk)) S.defMk = list[0].key;
  const sel = list.find((x) => x.key === S.defMk);
  const tbl = ((D.defrank || {})[sel.pos] || {})[sel.m.id] || {};
  // This week's opponent for each defense (from the current week's schedule)
  const facing = {};
  for (const [gid, g] of Object.entries(D.games)) if (g.wk === D.current_week) {
    facing[g.home] = { opp: g.away, ha: "vs.", ko: g.ko };
    facing[g.away] = { opp: g.home, ha: "@", ko: g.ko };
  }
  // Slotted players at the selected position on each defense's opponent this week, with their line for the selected market
  const facingPlayers = {};
  for (const s of slotsFor(D.current_week)) {
    if (!s.slot.startsWith(sel.pos)) continue;
    const r = rowFor(s.pid, D.current_week);
    (facingPlayers[s.team] = facingPlayers[s.team] || []).push({ s, m: r ? r.m[sel.m.id] : null });
  }
  for (const arr of Object.values(facingPlayers)) arr.sort((a, b) => SLOT_ORDER.indexOf(a.s.slot) - SLOT_ORDER.indexOf(b.s.slot));
  const rows = Object.entries(tbl).map(([team, v]) => ({ team, rk: v[0], avg: v[1], n: v[2], of: v[3] }));
  rows.sort((a, b) => (S.defAsc ? a.rk - b.rk : b.rk - a.rk) || a.team.localeCompare(b.team));
  const of = rows.length ? rows[0].of : 32, q = Math.round(of / 4);
  const stats = (D.sources || {}).stats;
  let h = `<div class="gamebar" role="group" aria-label="Choose a market">` + list.map((x) =>
    `<button class="gchip ${x.key === S.defMk ? "on" : ""}" data-dm="${x.key}"><b>${x.pos}</b><span class="muted small">${esc(x.m.label)}</span></button>`).join("") + `</div>
    <p class="callout">How each defense ranks in <b>${sel.pos} ${esc(sel.m.label.toLowerCase())} allowed per game</b> this season.
    1 = fewest allowed (toughest), ${of} = most allowed. Counts every game with published stats, so it updates automatically as each week's stats arrive
    ${stats ? `(nflverse stats last updated ${esc(stats.last_updated)})` : ""}. "This week" is who each defense plays in week ${D.current_week};
    "Facing" lists that opponent's ${sel.pos}s and their current ${esc(sel.m.label.toLowerCase())} line (yellow chip = an earlier Mon / Thu / Sun AM snapshot, not the graded pre-game line).</p>`;
  if (!rows.length) return h + `<p class="muted">No games with stats yet.</p>`;
  h += `<div class="panel scroll"><table class="dtable"><thead><tr>
    <th class="num"><button class="sortb" id="d-sort" title="Reverse order">Rank ${S.defAsc ? "▲" : "▼"}</button></th><th>Defense</th>
    <th class="num">${esc(sel.m.label)} allowed / game</th><th class="num">Games</th><th>This week</th>
    <th title="The opponent's slotted ${sel.pos}s this week and their ${esc(sel.m.label.toLowerCase())} line. Pre-game line (~3 h before kickoff) once captured; before that, the latest snapshot with a yellow Mon / Thu / Sun AM chip.">Facing · ${esc(sel.m.label)} line</th></tr></thead><tbody>`;
  for (const r of rows) {
    const cls = r.n < 3 ? "" : r.rk <= q ? "tough" : r.rk > of - q ? "easy" : "";
    const f = facing[r.team];
    h += `<tr><td class="num"><span class="drk ${cls}">${ordinal(r.rk)}</span></td><td><b>${esc(r.team)}</b></td>
      <td class="num">${num(r.avg)}</td><td class="num">${r.n}</td>
      <td>${f ? `${f.ha} ${esc(f.opp)} <span class="muted small">${fmtTime(f.ko)}</span>` : `<span class="muted small">bye</span>`}</td>
      <td class="small">${!f ? "" : (facingPlayers[f.opp] || []).map(({ s, m }) =>
        `<div class="facing">${lineCell(m)} <a class="pname" href="#/player/${s.pid}">${esc(s.name)}</a> <span class="muted">${s.slot}</span></div>`).join("") || `<span class="muted">no slotted ${sel.pos}</span>`}</td></tr>`;
  }
  return h + `</tbody></table></div><p class="muted small">Ties share a rank. Red = top quarter (toughest), green = bottom quarter (most allowed). Same numbers as the Opp D rank column on the Board, which uses only games before each matchup.</p>`;
}

// ---------- routing ----------
let LIVE = null;
function render() {
  const hash = location.hash || "#/board";
  const [, tab, arg] = hash.split("/");
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (tab === "player" ? "board" : tab)));
  // Phone layout (mobile.js) may take over the Board and player pages on narrow screens.
  // If it is missing or throws, the normal desktop view renders instead.
  let mobileHtml = null;
  try { if (window.STIX_MOBILE && window.STIX_MOBILE.active()) mobileHtml = window.STIX_MOBILE.render(tab, arg); }
  catch (e) { console.error("mobile view failed; showing desktop view", e); mobileHtml = null; }
  if (mobileHtml != null) app.innerHTML = mobileHtml;
  else if (tab === "player") app.innerHTML = viewPlayer(arg);
  else if (tab === "leads") app.innerHTML = viewLeads();
  else if (tab === "slots") app.innerHTML = viewSlots();
  else if (tab === "log") app.innerHTML = viewLog(LIVE);
  else if (tab === "guide") app.innerHTML = viewGuide();
  else if (tab === "defense") app.innerHTML = viewDefense();
  else if (tab === "search") {
    // Search lives in search.js; if it is missing or throws, show a message instead of breaking the app.
    try { app.innerHTML = window.STIX_SEARCH ? window.STIX_SEARCH.view(arg) : `<p class="pad">Search didn't load. Try refreshing.</p>`; }
    catch (e) { console.error(e); app.innerHTML = `<p class="pad">Search hit an error on that request. Try rewording it, or <a href="#/search">see the examples</a>.</p>`; }
  }
  else app.innerHTML = viewBoard();
  bind(tab, arg);
  if (tab === "search" && window.STIX_SEARCH) { try { window.STIX_SEARCH.bind(); } catch (e) { console.error(e); } }
  if (mobileHtml != null) { try { window.STIX_MOBILE.bind(tab, arg); } catch (e) { console.error(e); } }
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
  document.querySelectorAll("[data-dm]").forEach((b) => b.addEventListener("click", () => { S.defMk = b.dataset.dm; render(); }));
  on("d-sort", "click", () => { S.defAsc = !S.defAsc; render(); });
  document.querySelectorAll("[data-note]").forEach((b) => b.addEventListener("click", () => {
    const nr = b.closest("tr").nextElementSibling;
    if (nr && nr.classList.contains("noterow")) { nr.hidden = !nr.hidden; b.classList.toggle("on", !nr.hidden); }
  }));
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
  index();
  S.wk = D.current_week || D.weeks[D.weeks.length - 1];
  S.slotWk = S.wk;
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
  render();
  status();
  // Site code version (version.txt is written at deploy). If a newer version goes live, reload to pick it up.
  const getVer = async () => { try { const r = await fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" }); return r.ok ? (await r.text()).trim() : null; } catch { return null; } };
  let SITE_V = await getVer();
  const checkVer = async () => {
    const v = await getVer();
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (SITE_V && v && v !== SITE_V && !typing) location.reload();
    else if (!SITE_V && v) SITE_V = v;
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVer(); });
  // Pick up new lines / snapshots / stats without a manual reload: check for new site data every 5 minutes.
  setInterval(async () => {
    checkVer();
    try {
      const r = await fetch(`data/data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) return;
      const nd = await r.json();
      if (nd.generated_utc === D.generated_utc) return;
      D = nd; index();
      const typing = document.activeElement && document.activeElement.id === "f-q";
      const board = document.querySelector(".panel.board"), keep = board ? board.scrollTop : 0;
      if (!typing) { render(); const b2 = document.querySelector(".panel.board"); if (b2) b2.scrollTop = keep; }
      status();
    } catch { /* try again next time */ }
  }, 5 * 60 * 1000);
})();
function index() {
  for (const k in playerById) delete playerById[k];
  D.players.forEach((p) => (playerById[p.id] = p));
  D.markets.forEach((m) => (mkt[m.id] = m));
}
