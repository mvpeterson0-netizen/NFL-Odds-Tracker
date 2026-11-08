"use strict";
// Signal Stacks (2026-11-07): when several DISTINCT FAMILIES of evidence support the same side of a prop.
// Three surfaces: a "Signal Stack" box on player pages (box), the slate (#/stacks, view) and the Research section (research).
// ADMIN ONLY (2026-11-07): nothing here is in data.json or any public endpoint. The display payload (chips, counts, quote, state,
// update time) and all research detail come from the server-checked admin_signal_research() RPC, after a successful admin check.
(function () {
  // ADMIN ONLY: the payload is not in data.json. It is fetched through the server-checked admin_signal_research() RPC.
  const SS = () => { if (!admin()) return null; loadAdmin(); return (ADM.rows && ADM.rows.display && ADM.rows.display.body) || null; };
  const ST = { basis: "active", min: 1, mk: "", side: "", leads: false, state: "", sig: "" };
  const MK = { pass_yds: "Pass yds", rush_yds: "Rush yds", rec: "Receptions", rec_yds: "Rec yds" };
  const SIDE = { over: "▲ Over", under: "▼ Under" };
  const TIER_ICON = { qualified: "✓", testing: "◌", context: "ⓘ" };
  const TIER_NAME = { qualified: "Qualified", testing: "Testing", context: "Context" };
  const TIER_HELP = {
    qualified: "Qualified: met every documented criterion on forward results, so it counts toward the headline.",
    testing: "Testing: a versioned rule that fires on upcoming props and is graded forward from its lock. Not proven; not in the qualified count.",
    context: "Context: a historical finding relevant to this prop. It is not graded forward and is not a bet signal.",
  };
  const BASIS = { active: ["qualified", "testing"], qualified: ["qualified"], testing: ["testing"], all: ["qualified", "testing", "context"] };
  const pctf = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
  const sgn = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
  let IDX = null, IDXKEY = null;

  function index() {
    const s = SS();
    if (!s) return {};
    if (IDX && IDXKEY === s.generated_utc) return IDX;
    IDX = {}; IDXKEY = s.generated_utc;
    for (const [key, p] of Object.entries(s.props || {})) {
      const [gid, pid, mid] = key.split("|");
      const ko = (D.games[gid] || {}).ko || "";
      const k = pid + "|" + mid;
      if (!IDX[k] || ko < IDX[k].ko) IDX[k] = { key, gid, pid, mid, ko, p };
    }
    return IDX;
  }
  const regOf = (id) => ((SS() || {}).registry || []).find((r) => r.id === id) || { id, label: id, family: "", rule: "", version: "" };
  const famLabel = (f) => (((SS() || {}).families || {})[f] || {}).label || f;
  const counts = (stack, side, basis) => {
    const tiers = BASIS[basis] || BASIS.active;
    let support = 0, oppose = 0, mixed = 0;
    for (const t of tiers) { support += stack[side][t].support; oppose += stack[side][t].oppose; mixed += (stack.mixed[t] || []).length; }
    return { support, oppose: oppose + mixed, mixed };
  };
  const stateBadge = (st) => st === "locked"
    ? `<span class="sk-st sk-locked" title="Locked at the pregame capture; never recomputed">🔒 Locked</span>`
    : `<span class="sk-st sk-watch" title="Early-week watchlist: re-evaluated on every refresh until the pregame lock">◔ Watchlist</span>`;
  const sideSummary = (stack, side, basis) => {
    const c = counts(stack, side, basis), q = counts(stack, side, "qualified");
    return `<span class="sk-sum-s sk-${side}"><b>${SIDE[side]}</b> ${c.support} support · ${c.oppose} ${c.oppose === 1 ? "opposes" : "oppose"}</span> <span class="sk-qn" title="Qualified families supporting this side">${q.support} qualified</span>`;
  };
  const chip = (c, key) => {
    const sideTxt = c.side === "over" ? "Over" : "Under";
    return `<button type="button" class="sk-chip sk-${c.status} sk-${c.side}" data-sk-key="${esc(key)}" data-sk-sig="${esc(c.id)}" aria-expanded="false" aria-label="${esc(c.label)}: supports ${sideTxt}. ${TIER_NAME[c.status]} evidence. Tap for details.">
      <span class="sk-ar" aria-hidden="true">${c.side === "over" ? "▲" : "▼"}</span> ${sideTxt} · ${esc(c.label)} <span class="sk-tag">${TIER_ICON[c.status]} ${TIER_NAME[c.status]}</span></button>`;
  };
  const modelCallout = (m) => {
    const names = { t11: "Frozen additive model (T11)", t12: "Frozen interaction model (T12)", t13: "Challenger (T13)" };
    const rows = Object.keys(names).filter((k) => m && m[k]).map((k) => `<div class="small">${names[k]}: <b>${m[k].side === "over" ? "▲ Over" : "▼ Under"}</b> · est. return ${m[k].edge == null ? "—" : sgn(m[k].edge)} · ${m[k].qualifies ? "meets its 10% trigger" : "below its 10% trigger"}</div>`).join("");
    return rows ? `<div class="sk-model"><div class="sk-model-h"><b>Model callout</b> <span class="muted small">separate from the stack · never counted as a family</span></div>${rows}</div>` : "";
  };

  // ---------- player card box ----------
  function box(pid, mid) {
    const x = index()[pid + "|" + mid];
    if (!x) return "";
    const p = x.p, stack = p.stack;
    const sides = ["under", "over"].filter((s) => counts(stack, s, "all").support + counts(stack, s, "all").oppose > 0);
    const mixed = [...new Set(["qualified", "testing", "context"].flatMap((t) => stack.mixed[t] || []))];
    const q = p.quote || {};
    return `<div class="skbox" data-sk-box="${esc(x.key)}">
      <div class="sk-h"><b>Signal Stack</b> ${stateBadge(p.state)}</div>
      <div class="sk-line small">Line <b>${num(q.line)}</b> · Over ${odds(q.op)} / Under ${odds(q.up)} · ${esc(q.book || "")} <span class="muted">· as of ${fmtTime(p.evaluated)}</span></div>
      <div class="sk-sums">${sides.map((s) => `<div>${sideSummary(stack, s, "active")}${stack.leads[s] ? ` <span class="sk-leads" title="Existing leads firing on this side (counted individually; a different measure from distinct families)">Leads ${stack.leads[s]}</span>` : ""}</div>`).join("")}
        ${mixed.length ? `<div class="small sk-mixed">◐ Mixed family: ${mixed.map(famLabel).join(", ")} — its rules point both ways, so it counts for neither side.</div>` : ""}
        <div class="muted small">Counts are distinct families (Qualified + Testing). Context evidence is shown but not counted.</div></div>
      <div class="sk-chips">${p.chips.map((c) => chip(c, x.key)).join("")}</div>
      <div class="sk-drawer" aria-live="polite" hidden></div>
      ${p.unavailable && p.unavailable.length ? `<div class="muted small">Could not be judged (input missing or stale): ${p.unavailable.map(esc).join(", ")}</div>` : ""}
      ${modelCallout(p.model)}</div>`;
  }

  // ---------- admin-only research detail ----------
  const ADM = { rows: null, pending: false, err: "" };
  function admin() { try { return !!(window.STIX_ADMIN && window.STIX_ADMIN.isResearchAdmin && window.STIX_ADMIN.isResearchAdmin()); } catch (e) { return false; } }
  function loadAdmin() {
    if (ADM.rows || ADM.pending || !admin() || !window.STIX_ACCOUNT || !window.STIX_ACCOUNT.db) return;
    ADM.pending = true;
    window.STIX_ACCOUNT.db("/rest/v1/rpc/admin_signal_research", { method: "POST", body: {} }).then((r) => {
      if (r && r.ok && Array.isArray(r.data)) { ADM.rows = {}; for (const row of r.data) ADM.rows[row.id] = row; }
      else ADM.err = "Research detail isn't available yet (the admin research table may not be set up).";
    }).catch(() => { ADM.err = "Research detail failed to load."; }).finally(() => {
      ADM.pending = false;
      if (typeof render === "function") render();
    });
  }
  function cellRow(c) {
    const s = c.season_roi || {};
    const sp = (y) => (s[y] ? `${s[y].W}–${s[y].L} (${sgn(s[y].roi)})` : "—");
    return `<tr><td>${esc(c.market)}</td><td>${esc(c.condition)}</td><td>${c.W}–${c.L}–${c.P}</td><td>${pctf(c.hit)}</td><td>${sgn(c.roi)}</td><td>${c.games}</td><td>${sp(2025)}</td><td>${sp(2026)}</td><td>${sgn(c.roi_shaded_5)}</td><td>${c.bh_q == null ? "—" : c.bh_q.toFixed(2)}</td></tr>`;
  }
  function adminDetail(sid) {
    if (!admin()) return `<p class="muted small">Season splits, sample sizes and ROI are private research (admin access only).</p>`;
    loadAdmin();
    if (!ADM.rows) return `<p class="muted small">${ADM.err ? esc(ADM.err) : "Loading research detail…"}</p>`;
    const h = ADM.rows["history:" + sid], f = ADM.rows.forward && ADM.rows.forward.body && ADM.rows.forward.body.by_signal && ADM.rows.forward.body.by_signal[sid];
    let out = "";
    if (h) {
      out += `<div class="small"><b>Research history</b> <span class="muted">(${esc(h.body.note)})</span></div>
        <div class="sk-scroll"><table class="sk-t small"><thead><tr><th>Market</th><th>Condition</th><th>W–L–P</th><th>Hit</th><th>ROI</th><th>Games</th><th>2025</th><th>2026</th><th>ROI −5¢</th><th>q</th></tr></thead><tbody>${h.body.cells.map(cellRow).join("")}</tbody></table></div>
        <p class="muted small">q = Benjamini–Hochberg across ${h.body.family_size_for_q} cells tried. ${esc(h.body.status_reason || "")}</p>`;
    } else out += `<p class="muted small">No historical research row for this signal (existing leads keep their own records in Results).</p>`;
    out += f ? `<div class="small"><b>Forward</b> (locked, graded): ${f.bets} bets · ${f.W}–${f.L}–${f.P} · ROI ${sgn(f.roi)} · ${f.games} games · ${f.weeks} weeks. ${f.qualification.qualified ? "Meets every criterion." : "Not qualified yet."}</div>`
      : `<div class="muted small">Forward: no graded locked bets yet.</div>`;
    return out;
  }
  function fillDrawer(boxEl) {
    if (!boxEl) return;
    const dr = boxEl.querySelector(".sk-drawer"), sid = dr && dr.dataset.sid, key = boxEl.dataset.skBox;
    if (!sid) return;
    const s = SS(), p = s.props[key], chipd = p.chips.find((c) => c.id === sid), r = regOf(sid);
    dr.innerHTML = `<div class="sk-d-h"><b>${esc(r.label)}</b> <span class="sk-tag sk-${chipd.status}">${TIER_ICON[chipd.status]} ${TIER_NAME[chipd.status]}</span></div>
      <div class="small"><b>Trigger:</b> ${esc(chipd.trigger)}</div>
      <div class="small"><b>Supports:</b> ${SIDE[chipd.side]} · <b>Family:</b> ${esc(famLabel(chipd.family))} <span class="muted">— ${esc(((s.families || {})[chipd.family] || {}).note || "")}</span></div>
      <div class="small"><b>Rule</b> (${esc(r.version)}): ${esc(r.rule)}</div>
      <div class="small"><b>Evidence status:</b> ${esc(TIER_HELP[chipd.status])}</div>
      <div class="small"><b>Updated:</b> ${fmtTime(p.evaluated)} · ${p.state === "locked" ? "locked snapshot, never recomputed" : "watchlist, re-evaluated each refresh until the pregame lock"}</div>
      ${adminDetail(sid)}`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".sk-chip");
    if (!b) return;
    const boxEl = b.closest("[data-sk-box]"), dr = boxEl.querySelector(".sk-drawer");
    const open = !dr.hidden && dr.dataset.sid === b.dataset.skSig;
    boxEl.querySelectorAll(".sk-chip").forEach((x) => x.setAttribute("aria-expanded", "false"));
    if (open) { dr.hidden = true; dr.dataset.sid = ""; return; }
    dr.dataset.sid = b.dataset.skSig; dr.hidden = false; b.setAttribute("aria-expanded", "true");
    fillDrawer(boxEl);
  });

  // ---------- running hit rate (admin-only, replay on 2025 + 2026 lines) ----------
  const BE = 0.5238;   // break-even hit rate at -110
  function hitRate(sid) {
    if (!admin()) return "";
    loadAdmin();
    if (!ADM.rows) return `<p class="muted small">${ADM.err ? esc(ADM.err) : "Loading hit rate…"}</p>`;
    const row = ADM.rows["series:" + sid], b = row && row.body;
    if (!b || !Array.isArray(b.weeks) || !b.weeks.length) return `<p class="muted small">No 2025/2026 hit-rate series for this signal yet.</p>`;
    let W = 0, L = 0, P = 0; const pts = [];
    for (const x of b.weeks) {
      W += x.W; L += x.L; P += x.P;
      if (W + L) pts.push({ s: x.s, w: x.w, h: W / (W + L), n: W + L });
    }
    if (!pts.length) return `<p class="muted small">No graded bets in this series yet.</p>`;
    const tot = (s) => b.weeks.filter((x) => x.s === s).reduce((a, x) => ({ W: a.W + x.W, L: a.L + x.L, P: a.P + x.P, u: a.u + x.u }), { W: 0, L: 0, P: 0, u: 0 });
    const t25 = tot(2025), t26 = tot(2026);
    const line = (t) => (t.W + t.L ? `${t.W}–${t.L}${t.P ? "–" + t.P : ""} · ${pctf(t.W / (t.W + t.L))}` : "no bets");
    // chart: x = each week with bets (2025 then 2026), y = cumulative hit %
    const w = 320, h = 150, l = 34, r = 8, t = 10, bt = 24;
    const ys = pts.map((q) => q.h).concat([BE]);
    let lo = Math.floor((Math.min(...ys) - 0.04) * 20) / 20, hi = Math.ceil((Math.max(...ys) + 0.04) * 20) / 20;
    lo = Math.max(0, lo); hi = Math.min(1, hi);
    const X = (i) => l + (pts.length < 2 ? (w - l - r) / 2 : (i * (w - l - r)) / (pts.length - 1));
    const Y = (v) => t + ((hi - v) / (hi - lo)) * (h - t - bt);
    const path = pts.map((q, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(q.h).toFixed(1)}`).join(" ");
    const split = pts.findIndex((q) => q.s === 2026);
    const grid = [];
    for (let v = lo; v <= hi + 1e-9; v += 0.05) grid.push(`<line x1="${l}" x2="${w - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/><text x="${l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity=".6">${Math.round(v * 100)}%</text>`);
    const last = pts[pts.length - 1];
    const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Cumulative hit rate by week, 2025 and 2026. Now ${pctf(last.h)} over ${last.n} graded bets." style="max-width:520px">
      ${grid.join("")}
      <line x1="${l}" x2="${w - r}" y1="${Y(BE).toFixed(1)}" y2="${Y(BE).toFixed(1)}" stroke="#d29922" stroke-dasharray="4 3"/>
      <text x="${w - r}" y="${(Y(BE) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#d29922">break-even 52.4%</text>
      ${split > 0 ? `<line x1="${((X(split - 1) + X(split)) / 2).toFixed(1)}" x2="${((X(split - 1) + X(split)) / 2).toFixed(1)}" y1="${t}" y2="${h - bt}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="2 3"/>` : ""}
      <path d="${path}" fill="none" stroke="#58a6ff" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${X(pts.length - 1).toFixed(1)}" cy="${Y(last.h).toFixed(1)}" r="3.5" fill="#58a6ff"/>
      <text x="${Math.min(X(pts.length - 1), w - r - 2).toFixed(1)}" y="${(Y(last.h) - 7).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="currentColor">${pctf(last.h)}</text>
      <text x="${l}" y="${h - 8}" font-size="9" fill="currentColor" fill-opacity=".7">${pts[0].s} wk ${pts[0].w}</text>
      ${split > 0 ? `<text x="${((X(split - 1) + X(split)) / 2 - 3).toFixed(1)}" y="${h - 8}" text-anchor="end" font-size="9" fill="currentColor" fill-opacity=".7">2026 starts ▸</text>` : ""}
      </svg>`;
    const weekRows = b.weeks.filter((x) => x.W + x.L + x.P).map((x) => `<tr><td>${x.s} wk ${x.w}</td><td>${x.W}–${x.L}${x.P ? "–" + x.P : ""}</td><td>${x.W + x.L ? pctf(x.W / (x.W + x.L)) : "—"}</td><td>${sgn(x.W + x.L ? x.u / (x.W + x.L) : null)}</td></tr>`).join("");
    return `<div class="sk-hit"><div class="small"><b>Running hit rate</b> <span class="muted">· cumulative, 2025 → 2026 · replay on past lines</span></div>
      ${svg}
      <div class="small">2025: <b>${line(t25)}</b> · 2026: <b>${line(t26)}</b> · All: <b>${line({ W, L, P })}</b> · units ${(t25.u + t26.u > 0 ? "+" : "") + (t25.u + t26.u).toFixed(1)}</div>
      <details class="small"><summary>Week by week</summary><div class="sk-scroll"><table class="sk-t small"><thead><tr><th>Week</th><th>W–L–P</th><th>Hit</th><th>ROI</th></tr></thead><tbody>${weekRows}</tbody></table></div></details>
      <p class="muted small">${esc(b.note || "")} Hit rate leaves out pushes. Not a forward record: forward results (locked before kickoff) are listed separately.</p></div>`;
  }

  // ---------- slate ----------
  function rows() {
    const s = SS(), out = [];
    for (const [key, p] of Object.entries((s && s.props) || {})) {
      const [gid, pid, mid] = key.split("|");
      const pl = playerById[pid], g = D.games[gid];
      if (!pl || !g || new Date(g.ko) <= new Date()) continue;
      if (ST.mk && mid !== ST.mk) continue;
      if (ST.state && p.state !== ST.state) continue;
      for (const side of ["over", "under"]) {
        if (ST.side && side !== ST.side) continue;
        const c = counts(p.stack, side, ST.basis);
        if (c.support < ST.min) continue;
        if (ST.leads && (p.stack.leads[side] || 0) < 2) continue;
        if (ST.sig && !p.chips.some((x) => x.id === ST.sig && x.side === side)) continue;
        out.push({ key, gid, pid, mid, side, p, pl, g, c, leads: p.stack.leads[side] || 0 });
      }
    }
    out.sort((a, b) => b.c.support - a.c.support || a.c.oppose - b.c.oppose || b.leads - a.leads || a.g.ko.localeCompare(b.g.ko));
    return out;
  }
  function view(arg) {
    const s = SS();
    if (!s) return `<div class="pad"><h2>Signal Stacks</h2><p class="muted">${admin() ? (ADM.err || "Loading…") : "Not available."}</p></div>`;
    if (arg && /^[A-Z0-9]+$/.test(arg) && ST.sig !== arg) ST.sig = arg;
    const rs = rows(), qn = Object.values(s.props).filter((p) => ["over", "under"].some((sd) => counts(p.stack, sd, "qualified").support > 0)).length;
    const sel = (id, opts, v) => `<select id="${id}" aria-label="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const items = rs.slice(0, 150).map((r) => `<a class="sk-row" href="#/player/${esc(r.pid)}" data-sk-open="${esc(r.pid)}|${esc(r.mid)}">
      <div class="sk-r1"><b>${esc(r.pl.name)}</b> <span class="muted small">${esc(r.pl.team)} · ${esc(r.pl.pos)} · ${esc(MK[r.mid] || r.mid)}</span>${stateBadge(r.p.state)}</div>
      <div class="sk-r2"><span class="sk-pill sk-${r.side}">${SIDE[r.side]} ${num(r.p.quote.line)}</span> <span class="small">${odds(r.side === "over" ? r.p.quote.op : r.p.quote.up)}</span>
        <span class="sk-cnt"><b>${r.c.support}</b> support · ${r.c.oppose} ${r.c.oppose === 1 ? "opposes" : "oppose"}</span>
        <span class="sk-qn">${counts(r.p.stack, r.side, "qualified").support} qualified</span>
        ${r.leads ? `<span class="sk-leads" title="Existing leads on this side">Leads ${r.leads}</span>` : ""}</div>
      <div class="sk-r3">${r.p.chips.filter((c) => c.side === r.side).map((c) => `<span class="sk-mini sk-${c.status}">${TIER_ICON[c.status]} ${esc(c.label)}</span>`).join("")}
        ${r.p.chips.filter((c) => c.side !== r.side).map((c) => `<span class="sk-mini sk-opp" title="Opposes ${SIDE[r.side]}">⇄ ${esc(c.label)}</span>`).join("")}</div>
      <div class="muted small">${esc(r.g.away)} @ ${esc(r.g.home)} · ${fmtTime(r.g.ko)}</div></a>`).join("");
    return `<div class="sk-page pad"><h2>Signal Stacks <span class="muted small">slate</span></h2>
      <p class="muted small">Upcoming props where distinct families of evidence agree. <b>${qn}</b> props have a Qualified family right now${qn ? "" : " — none yet, so counts include Testing rules"}. Lead count is separate from family count.</p>
      <div class="sk-filters" role="group" aria-label="Filters">
        <label>Min families ${sel("sk-min", [[1, "1+"], [2, "2+"], [3, "3+"]], ST.min)}</label>
        <label>Evidence ${sel("sk-basis", [["active", "Qualified + Testing"], ["qualified", "Qualified only"], ["testing", "Testing only"], ["all", "Incl. Context"]], ST.basis)}</label>
        <label>Market ${sel("sk-mk", [["", "All"], ...Object.entries(MK)], ST.mk)}</label>
        <label>Side ${sel("sk-side", [["", "Both"], ["over", "Over"], ["under", "Under"]], ST.side)}</label>
        <label>State ${sel("sk-state", [["", "All"], ["locked", "Locked"], ["watch", "Watchlist"]], ST.state)}</label>
        <label class="sk-chk"><input type="checkbox" id="sk-leads" ${ST.leads ? "checked" : ""}> Multiple leads (2+)</label>
        ${ST.sig ? `<button id="sk-clear-sig" class="on" type="button">Signal ${esc(ST.sig)} ✕</button>` : ""}
      </div>
      <p class="small"><b>${rs.length}</b> prop-sides${rs.length > 150 ? " (first 150 shown)" : ""}.</p>
      <div class="sk-list">${items || `<p class="muted pad">No props match these filters.</p>`}</div>
      ${research()}</div>`;
  }
  function bind() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("change", fn); };
    on("sk-min", (e) => { ST.min = +e.target.value; rerender(); }); on("sk-basis", (e) => { ST.basis = e.target.value; rerender(); });
    on("sk-mk", (e) => { ST.mk = e.target.value; rerender(); }); on("sk-side", (e) => { ST.side = e.target.value; rerender(); });
    on("sk-state", (e) => { ST.state = e.target.value; rerender(); }); on("sk-leads", (e) => { ST.leads = e.target.checked; rerender(); });
    const c = document.getElementById("sk-clear-sig"); if (c) c.addEventListener("click", () => { ST.sig = ""; if (location.hash !== "#/stacks") location.hash = "#/stacks"; else rerender(); });
    document.querySelectorAll("[data-sk-open]").forEach((a) => a.addEventListener("click", () => { const [pid, mid] = a.dataset.skOpen.split("|"); S.market[pid] = mid; }));
  }
  function rerender() { if (typeof render === "function") render(); }

  // ---------- Research section ----------
  function research() {
    const s = SS();
    if (!s) return "";
    const matches = {};
    for (const p of Object.values(s.props)) for (const c of p.chips) matches[c.id] = (matches[c.id] || 0) + 1;
    const adm = admin(); if (adm) loadAdmin();
    const fwd = adm && ADM.rows && ADM.rows.forward ? ADM.rows.forward.body : null;
    const rowsHtml = s.registry.map((r) => {
      const f = fwd && fwd.by_signal && fwd.by_signal[r.id];
      const hist = adm && ADM.rows && ADM.rows["history:" + r.id];
      return `<details class="sk-rule"><summary><b>${esc(r.id)}</b> · ${esc(r.label)} <span class="sk-tag sk-${r.status}">${TIER_ICON[r.status]} ${TIER_NAME[r.status]}</span> <span class="muted small">${esc(famLabel(r.family))} · ${SIDE[r.side]}</span></summary>
        <div class="small"><b>Rule</b> (${esc(r.version)}): ${esc(r.rule)}</div>
        <div class="small">Matches <b>${matches[r.id] || 0}</b> upcoming props. ${matches[r.id] ? `<a href="#/stacks/${esc(r.id)}">See them on the slate</a>` : ""}</div>
        ${adm ? hitRate(r.id) + adminDetail(r.id) : `<p class="muted small">Coverage, season splits, game counts, price-based ROI and forward results are private research (admin access only).</p>`}</details>`;
    }).join("");
    const fwdHtml = (() => {
      if (!adm) return "";
      if (!fwd) return `<p class="muted small">Forward grading: no graded locked props yet. The ledger starts at the first pregame lock after launch.</p>`;
      const grp = (basis) => Object.entries(fwd.bases[basis] || {}).map(([g, v]) => `<tr><td>${esc(g)}</td><td>${v.bets}</td><td>${v.W}–${v.L}–${v.P}</td><td>${pctf(v.hit)}</td><td>${sgn(v.roi)}</td><td>${sgn(v.matched_baseline.roi)}</td><td>${v.games}</td></tr>`).join("");
      const cmp = Object.entries(fwd.frozen_model_vs_stack || {}).map(([k, v]) => `<tr><td>${k.toUpperCase()}</td><td>${v.model_picks.bets}</td><td>${sgn(v.model_picks.roi)}</td><td>${v.with_stack_support.bets}</td><td>${sgn(v.with_stack_support.roi)}</td><td>${v.coverage_lost == null ? "—" : pctf(v.coverage_lost, 0)}</td></tr>`).join("");
      return `<section class="sk-fwd"><h4>Forward results (Challenger · locked before kickoff)</h4><p class="muted small">Separate from exploratory history above. One bet per prop-side per group; saved prices; one unit.</p>
        <div class="sk-scroll"><table class="sk-t small"><thead><tr><th>Active families</th><th>Bets</th><th>W–L–P</th><th>Hit</th><th>ROI</th><th>Matched baseline ROI</th><th>Games</th></tr></thead><tbody>${grp("active") || `<tr><td colspan="7" class="muted">No graded bets yet</td></tr>`}</tbody></table></div>
        <div class="sk-scroll"><table class="sk-t small"><thead><tr><th>Frozen model</th><th>Picks</th><th>ROI</th><th>With stack support</th><th>ROI</th><th>Coverage lost</th></tr></thead><tbody>${cmp || `<tr><td colspan="6" class="muted">No graded model picks yet</td></tr>`}</tbody></table></div></section>`;
    })();
    return `<section class="sk-research" id="sk-research"><h3>Signal Stacks <span class="muted small">rules, status, matches</span></h3>
      <p class="muted small">Qualified rules count toward the headline. A Testing rule moves to Qualified only on forward results: at least 150 graded bets, 60 distinct games and 4 weeks; ROI above 0 with a game-clustered p ≤ 0.10 after multiple-comparison correction; positive in 60%+ of weeks and without the 3 best games; still positive with every price 5 points worse. Historical results never qualify a rule.</p>
      ${rowsHtml}${fwdHtml}</section>`;
  }

  // Reveal the nav link only for a verified admin (checked server-side); re-check for up to 30 s while the admin RPC answers.
  function reveal() {
    const a = document.querySelector('a[data-tab="stacks"]');
    if (a) a.hidden = !admin();
    return admin();
  }
  let tries = 0; const iv = setInterval(() => { if (reveal() || ++tries > 60) clearInterval(iv); if (admin()) loadAdmin(); }, 500);
  window.STIX_STACKS = { box, view, bind, research, rows };
})();
