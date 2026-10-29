"use strict";
// Review queue (#/review): one card per slotted player × stat with a line this week, each shown once.
// Swipe up = Over, down = Under, left or right = skip (buttons and arrow keys do the same).
// Over / Under save a pick through My picks (picks.js → the picks table, with its kickoff lock).
// "Reviewed" is saved to the signed-in account (Supabase table reviews, supabase/009_reviews.sql) so phone and
// computer share it. A reviewed card comes back only if its line later moves more than the "line flat" tolerance
// used by the Research leads (±0.5 receptions / carries / attempts / completions, ±5 rush / rec yds, ±10 pass yds).
// Cards are ordered by kickoff, then game, then slot. Everything shown comes from data.json; nothing is estimated.
(function () {
  const RV = { rows: {}, loaded: false, loading: false, err: "", at: 0, uid: null, busy: 0 };
  const ACC = () => window.STIX_ACCOUNT, PK = () => window.STIX_PICKS;
  const COUNT_MKTS = ["rec", "rush_att", "pass_att", "pass_cmp"];
  const tol = (mid) => (COUNT_MKTS.includes(mid) ? 0.5 : mid === "pass_yds" ? 10 : 5);
  const n1 = (v) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const oddsT = (v) => (v == null ? "" : v > 0 ? `+${v}` : String(v));
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const ready = () => !!(PK() && PK().acctReady && PK().acctReady());

  // ---------- cards ----------
  function cards() {
    const out = [];
    const now = Date.now();
    for (const p of D.players) {
      if (p.extra) continue; // slotted players only (Michael, 2026-10-28)
      const r = PK().nextRow(p.id);
      if (!r || !r.ko || new Date(r.ko).getTime() <= now) continue;
      marketsFor(p.pos).forEach((mk, mi) => {
        const ln = PK().lineNow(r.m[mk.id]); if (!ln) return;
        const key = `${r.wk}|${p.id}|${mk.id}`;
        if (PK().pickFor(key)) return; // already picked (player page or earlier swipe)
        const seen = RV.rows[key];
        let moved = null;
        if (seen) { if (Math.abs(ln.line - seen.line) <= tol(mk.id)) return; moved = seen.line; }
        out.push({ p, r, mk, mi, ln, key, moved });
      });
    }
    const g = (c) => [c.r.ko, c.r.gid, slotRank(c.r.slot || c.p.pos), c.p.name, c.mi];
    out.sort((a, b) => { const x = g(a), y = g(b); for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; });
    return out;
  }

  // ---------- account storage ----------
  async function load() {
    if (!ready() || RV.loading) return;
    RV.loading = true;
    const uid = ACC().user().id;
    const wks = [...new Set(D.players.map((p) => PK().nextRow(p.id)).filter(Boolean).map((r) => r.wk))];
    const q = wks.length ? `&week=in.(${wks.join(",")})` : "&week=eq.-1";
    const r = await ACC().db(`/rest/v1/reviews?select=review_key,line,decision${q}`);
    RV.loading = false;
    if (r.ok && Array.isArray(r.data)) {
      RV.rows = {}; for (const x of r.data) RV.rows[x.review_key] = { line: Number(x.line), decision: x.decision };
      RV.loaded = true; RV.err = ""; RV.at = Date.now(); RV.uid = uid;
    } else RV.err = `Couldn't load what you've reviewed: ${r.error}`;
    redraw();
  }
  async function decide(c, decision) {
    if (RV.busy) return;
    const before = RV.rows[c.key];
    RV.rows[c.key] = { line: c.ln.line, decision };
    if (decision !== "skip") PK().savePick(c.p.id, c.mk.id, decision);
    RV.err = ""; RV.busy++; redraw();
    const r = await ACC().db("/rest/v1/reviews?on_conflict=user_id,review_key", { method: "POST",
      body: { review_key: c.key, week: c.r.wk, line: c.ln.line, decision }, prefer: "resolution=merge-duplicates,return=minimal" });
    RV.busy--;
    if (!r.ok) {
      if (before) RV.rows[c.key] = before; else delete RV.rows[c.key];
      RV.err = `Not saved as reviewed: ${r.error}${decision !== "skip" ? " (check the Picks tab for the pick)" : ""}`;
    }
    redraw();
  }

  // ---------- drawing ----------
  function stats(c) {
    const { p, r, mk } = c, mid = mk.id;
    const past = (D.rows[p.id] || []).filter((x) => x.wk < r.wk && x.final).sort((a, b) => a.wk - b.wk);
    const played = past.filter((x) => x.played === true && x.m[mid] && x.m[mid].act != null);
    const fm = window.STIX_MOBILE && window.STIX_MOBILE.form ? window.STIX_MOBILE.form(p.id, mid, p.pos, r.wk) : { n: 0, avg: null };
    const l3 = played.slice(-3).map((x) => x.m[mid].act);
    const graded = past.filter((x) => x.m[mid] && (x.m[mid].res === "over" || x.m[mid].res === "under"));
    const overs = graded.filter((x) => x.m[mid].res === "over").length;
    return { fm, l3: l3.length ? mean(l3) : null, l3v: l3, n3: l3.length, graded: graded.length, overs };
  }
  // Compact so the whole card fits on one phone screen (Michael, 2026-10-28): line + odds on one row,
  // 4 small tiles, a short chart, the last 5 games of the game log (same rows as the phone player page).
  const LOG_ROWS = 5;
  function cardHtml(c) {
    const { p, r, mk, ln } = c, m = r.m[mk.id];
    const s = stats(c);
    const all = (D.rows[p.id] || []).filter((x) => x.final || x === r).sort((a, b) => a.wk - b.wk);
    RV.chart = { rows: all.slice(-8), mid: mk.id };
    const g = D.games[r.gid];
    const tile = (lab, val, sub) => `<div class="rv-tile"><span>${lab}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    const log = window.STIX_MOBILE && window.STIX_MOBILE.gameLog ? window.STIX_MOBILE.gameLog(p.id, mk.id, all.filter((x) => x.final), LOG_ROWS) : "";
    return `<div class="rv-card" id="rv-card" tabindex="0" aria-label="${esc(p.name)} ${esc(mk.label)} ${n1(ln.line)}">
      <div>${c.moved != null ? `<p class="rv-moved small">Line moved since you reviewed it: ${n1(c.moved)} → <b>${n1(ln.line)}</b></p>` : ""}
      <div class="rv-h"><a class="pname rv-name" href="#/player/${esc(p.id)}" data-rpid="${esc(p.id)}" data-rmid="${esc(mk.id)}">${esc(p.name)}</a>
        <span class="rv-mk">${esc(mk.label)} <b>${n1(ln.line)}</b></span></div>
      <div class="rv-sub muted small"><span>${esc(r.team)} ${esc(r.slot || p.pos)} · ${g ? `${esc(g.away)} @ ${esc(g.home)}` : ""} · ${fmtTime(r.ko)}</span>
        <span>O ${oddsT(ln.op)} / U ${oddsT(ln.up)} · ${esc(ln.src)} ${esc(BOOK(ln.book))}</span></div></div>
      <div class="rv-tiles">${tile("Season", s.fm.avg == null ? "—" : n1(Math.round(s.fm.avg * 10) / 10), s.fm.n ? `${s.fm.n} starts` : "no starts")}
        ${tile("Last 3", s.l3 == null ? "—" : n1(Math.round(s.l3 * 10) / 10), s.n3 ? s.l3v.map((v) => n1(v)).join(", ") : "no games")}
        ${tile("Over line", s.graded ? `${s.overs}/${s.graded}` : "—", s.graded ? "graded" : "none yet")}
        <div class="rv-tile"><span>Opp D</span><b class="rv-drk">${m && m.drk != null ? ordinal(m.drk) : "—"}</b><small>${m && m.dav != null ? `${n1(m.dav)}/g` : "no data"}</small></div></div>
      <div class="chart rv-chart" id="rv-chart">${chartSVG(all.slice(-8), mk.id, chartOpts(150))}</div>
      ${log}
      <div><div class="rv-btns"><button class="rv-b rv-o" data-rv="o">▲ Over</button><button class="rv-b rv-s" data-rv="skip">Skip</button><button class="rv-b rv-u" data-rv="u">▼ Under</button></div>
      <p class="muted small rv-hint">Swipe ↑ Over · ↓ Under · ←→ Skip · saves at ${n1(ln.line)}</p></div></div>${footLine()}`;
  }
  // The site footer (sources, "research tool only", privacy) shrinks to one line that expands, on this page only,
  // so the card can use the space (Michael, 2026-10-28). Same text and links as the footer in index.html.
  function footLine() {
    const f = document.querySelector("footer.foot");
    return f ? `<details class="rv-foot muted small"><summary>Research tool only, not predictions · sources &amp; privacy</summary><div>${f.innerHTML}</div></details>` : "";
  }
  const chartOpts = (H) => ({ W: 400, H: Math.round(H), L: 30, R: 26, T: 22, B: 22, fs: 12, edgeAbove: true });
  // Use the screen height that's free to make the card roomier (never smaller than its compact size): about half
  // goes to a taller chart, the rest to more padding in the game log, tiles and buttons. Capped so desktop stays sane.
  function fitCard() {
    const el = document.getElementById("rv-card"); if (!el) return;
    el.style.removeProperty("--rvx");
    const ch = document.getElementById("rv-chart");
    if (ch && RV.chart) ch.innerHTML = chartSVG(RV.chart.rows, RV.chart.mid, chartOpts(150));
    const ft = document.querySelector(".rv-foot");
    const free = window.innerHeight - el.getBoundingClientRect().top - (ft ? ft.offsetHeight + 10 : 0) - 6;
    const extra = Math.min(free - el.offsetHeight, 240);
    if (extra < 12) return;
    const svg = ch && ch.querySelector("svg");
    if (svg && RV.chart) {
      const perPx = 400 / (svg.getBoundingClientRect().width || 400);
      ch.innerHTML = chartSVG(RV.chart.rows, RV.chart.mid, chartOpts(150 + extra * 0.5 * perPx));
    }
    el.style.setProperty("--rvx", `${Math.floor(extra * 0.5)}px`);
  }
  window.addEventListener("resize", () => { if ((location.hash || "").split("/")[1] === "review") fitCard(); });
  const BOOK = (b) => ({ DraftKings: "DK", FanDuel: "FD" }[b] || b || "");
  let retryT = null, retries = 0;
  function retry() {
    if (retryT || retries > 60) return; // up to ~30 s
    retries++;
    retryT = setTimeout(() => { retryT = null; redraw(); }, 500);
  }
  function view() {
    const acc = ACC();
    if (!acc || !acc.signedIn()) return `<p class="pad">Sign in on the <a href="#/picks">Picks tab</a> to use the review queue.</p>`;
    // Opened directly (reload, home-screen app): the account and picks load in the background, and their own
    // redraws only cover the Picks / player pages, so check again shortly until they're in.
    if (!acc.ready()) { retry(); return (acc.error && acc.error()) || retries > 6 ? `<p class="pad">Finish signing in on the <a href="#/picks">Picks tab</a> to use the review queue.</p>` : `<p class="muted pad">Loading your account…</p>`; }
    if (!ready()) { setTimeout(() => PK().sync(), 0); retry(); return `<p class="muted pad">Loading your picks…</p>`; }
    if (!RV.loaded || RV.uid !== acc.user().id) { if (!RV.loading) setTimeout(load, 0); return `<p class="muted pad">Loading your review queue…</p>`; }
    const list = cards();
    let h = `<div class="rv-top"><a href="#/picks">← Picks</a><b>Review queue</b><span class="muted small">${list.length} left this week</span></div>`;
    if (RV.err) h += `<p class="small pk-err pad">${esc(RV.err)}</p>`;
    if (!list.length) return h + `<div class="panel"><div class="body"><p><b>All caught up.</b></p><p class="muted small">Every slotted player × stat with a line this week has been reviewed or picked. New cards appear as lines post (most arrive Monday night to Wednesday), and a reviewed card comes back if its line moves more than ±0.5 (receptions, carries, attempts, completions), ±5 (rushing / receiving yards) or ±10 (passing yards).</p></div></div>` + footLine();
    return h + cardHtml(list[0]);
  }
  function entry() {
    if (!ready() || !RV.loaded) { if (ready() && !RV.loading) setTimeout(load, 0); return `<p class="rv-entry"><a class="rv-go" href="#/review">Review this week's lines</a></p>`; }
    const n = cards().length;
    return `<p class="rv-entry"><a class="rv-go" href="#/review">Review this week's lines${n ? ` (${n} left)` : " · all caught up"}</a></p>`;
  }

  // ---------- interaction ----------
  function redraw() {
    const t = (location.hash || "").split("/")[1];
    if ((t === "review" || t === "picks") && typeof render === "function" && D) render();
  }
  function current() { const l = cards(); return l.length ? l[0] : null; }
  function bind(tab) {
    if (tab !== "review") return;
    if (RV.loaded && !RV.busy && Date.now() - RV.at > 15000) load(); // pick up reviews made on another device
    const el = document.getElementById("rv-card"); if (!el) return;
    fitCard();
    document.querySelectorAll("[data-rv]").forEach((b) => b.addEventListener("click", () => { const c = current(); if (c) decide(c, b.dataset.rv); }));
    // swipe
    let x0 = null, y0 = null, dx = 0, dy = 0, id = null;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button, a")) return; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; id = e.pointerId; try { el.setPointerCapture(id); } catch { /* ignore */ } });
    el.addEventListener("pointermove", (e) => {
      if (x0 == null || e.pointerId !== id) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 30}deg)`;
      el.classList.toggle("go-o", -dy > 90 && Math.abs(dy) > Math.abs(dx));
      el.classList.toggle("go-u", dy > 90 && Math.abs(dy) > Math.abs(dx));
      el.classList.toggle("go-s", Math.abs(dx) > 90 && Math.abs(dx) >= Math.abs(dy));
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      const c = current();
      const dec = Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? "o" : "u") : Math.abs(dx) > 90 ? "skip" : null;
      if (dec && c) decide(c, dec); else { el.style.transform = ""; el.classList.remove("go-o", "go-u", "go-s"); }
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }
  document.addEventListener("keydown", (e) => {
    if ((location.hash || "").split("/")[1] !== "review" || e.target.closest("input, select, textarea")) return;
    const dec = { ArrowUp: "o", ArrowDown: "u", ArrowLeft: "skip", ArrowRight: "skip" }[e.key]; if (!dec) return;
    e.preventDefault(); const c = current(); if (c) decide(c, dec);
  });
  if (ACC()) ACC().onChange(() => { if (!ACC().signedIn()) { RV.rows = {}; RV.loaded = false; RV.uid = null; } retries = 0; redraw(); });

  window.STIX_REVIEW = { view, bind, entry, load };
})();
