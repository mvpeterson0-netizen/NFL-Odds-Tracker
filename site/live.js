"use strict";
// Live tracker on the Picks tab (Michael, 2026-11-22; NFL side).
// Shows the user's locked picks and the signal plays (research.js livePlays) whose games are in progress, against live
// box-score numbers, sorted by how close each is to its line, with a rough unit estimate per play.
//  • Live numbers: ESPN's public game summary, fetched by the browser itself every 30 s, only while the Picks tab is open and
//    visible, and only for games that hold a tracked play. Unofficial endpoint (same one the pipeline uses for box scores):
//    no SLA, may change. Numbers are provisional; grading still uses nflverse / the pipeline's ESPN box score once final.
//  • Estimate: a rough model, NOT validated against past results. Final stat ≈ stat so far + the rest of the game at a pace that
//    blends the pre-game line (early) with the pace so far (later); win chance from a normal curve whose spread shrinks as the
//    game goes on; units = chance × payout − (1 − chance) × 1 at the odds saved with a pick (a signal's own quote, else −110).
//    A play already decided is shown as locked (+payout / −1). Picks with no saved odds show no units (never guessed).
(function () {
  const SB = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  const SUM = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";
  const POLL_MS = 30000, MAP_MS = 60000, FETCH_MS = 12000;
  const TEAM_FIX = { LA: "LAR", WSH: "WAS" }; // ESPN codes -> the codes the app uses in the browser (app.js relabels nflverse "LA" to "LAR"; ESPN already says LAR)
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FEED = { ev: {}, box: {}, mapAt: 0, at: 0, err: "", busy: false };
  let timer = null;

  // ---------- ESPN fetch + parse ----------
  async function getJson(url) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), FETCH_MS);
    try {
      const r = await fetch(url, { signal: c.signal, cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const fixTeam = (a) => { a = String(a || "").toUpperCase(); return TEAM_FIX[a] || a; };
  const normName = (s) => String(s || "").toLowerCase().replace(/[.'’]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const numOf = (x) => { const f = parseFloat(String(x).replace(/,/g, "")); return isFinite(f) ? f : null; };
  function parseStatus(doc) {
    const comp = (((doc.header || {}).competitions) || [{}])[0] || {};
    const st = comp.status || {};
    const sc = {};
    for (const c of comp.competitors || []) sc[c.homeAway] = numOf(c.score);
    return { state: (st.type || {}).state || "", period: st.period || 0, clock: st.displayClock || "", hs: sc.home, as: sc.away };
  }
  function parseBox(doc) {
    const players = {}, tt = {};
    for (const t of ((doc.boxscore || {}).players) || []) {
      const team = fixTeam((t.team || {}).abbreviation);
      for (const cat of t.statistics || []) {
        const keys = cat.keys || [];
        for (const a of cat.athletes || []) {
          const ath = a.athlete || {};
          if (!ath.id) continue;
          const v = {}; keys.forEach((k, i) => { v[k] = (a.stats || [])[i]; });
          const p = players[ath.id] || (players[ath.id] = { name: ath.displayName || "", team, s: {} });
          if (cat.name === "passing") {
            const ca = String(v["completions/passingAttempts"] || "");
            if (ca.includes("/")) { const [c, at] = ca.split("/"); p.s.completions = numOf(c); p.s.attempts = numOf(at); }
            p.s.passing_yards = numOf(v.passingYards);
          } else if (cat.name === "rushing") {
            p.s.carries = numOf(v.rushingAttempts); p.s.rushing_yards = numOf(v.rushingYards);
          } else if (cat.name === "receiving") {
            p.s.receptions = numOf(v.receptions); p.s.receiving_yards = numOf(v.receivingYards); p.s.targets = numOf(v.receivingTargets);
            tt[team] = (tt[team] || 0) + (p.s.targets || 0);
          }
        }
      }
    }
    // name index; a name that would match two players on one team is left out (never guessed)
    const idx = {}, dup = new Set();
    for (const [id, p] of Object.entries(players)) { const k = p.team + "|" + normName(p.name); if (idx[k]) dup.add(k); idx[k] = id; }
    for (const k of dup) delete idx[k];
    return { players, tt, idx };
  }
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  async function loadMap(gids) {
    FEED.mapAt = Date.now();
    // ESPN's default scoreboard is its "current week", which can miss a game ESPN files under the next week (e.g. a Wednesday
    // game). Try the game's own week first, then its kickoff dates (±1 day), then the default; stop at the first that has every game.
    const gs = (gids || []).map((g) => D.games[g]).filter(Boolean);
    const ks = gs.map((x) => (x.ko ? new Date(x.ko).getTime() : NaN)).filter(isFinite);
    const wks = [...new Set(gs.map((x) => x.wk).filter((w) => w != null))];
    const urls = [];
    if (wks.length === 1) urls.push(`${SB}?seasontype=${gs[0].type === "POST" ? 3 : 2}&week=${wks[0]}`);
    if (ks.length) urls.push(`${SB}?dates=${ymd(Math.min(...ks) - 86400e3)}-${ymd(Math.max(...ks) + 86400e3)}`);
    urls.push(SB);
    let lastErr = null, gotAny = false;
    const dbg = [];
    for (const u of urls) {
      let sb;
      const lab = u.includes("week=") ? "wk" : u.includes("dates=") ? "dt" : "def";
      try { sb = await getJson(u); gotAny = true; dbg.push(`${lab}:${(sb.events || []).length}ev`); } catch (e) { lastErr = e; dbg.push(`${lab}:${e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e).slice(0, 18)}`); continue; }
      for (const ev of sb.events || []) {
        const comp = (ev.competitions || [{}])[0] || {};
        const t = {}; for (const c of comp.competitors || []) t[c.homeAway] = fixTeam((c.team || {}).abbreviation);
        const ms = new Date(ev.date).getTime();
        const gid = Object.keys(D.games).find((g) => { const x = D.games[g]; return x.home === t.home && x.away === t.away && x.ko && Math.abs(new Date(x.ko).getTime() - ms) <= 36 * 3600e3; });
        if (!gid) continue;
        const cur = FEED.ev[gid] || (FEED.ev[gid] = {});
        Object.assign(cur, { id: ev.id }, parseStatus({ header: { competitions: [{ status: ev.status || comp.status, competitors: comp.competitors }] } }));
      }
      if ((gids || []).every((g) => FEED.ev[g])) return;
    }
    FEED.dbg = dbg.join(" ");
    if (!gotAny && lastErr) throw lastErr;
  }

  // ---------- which plays are tracked ----------
  const koPast = (ko) => !!ko && new Date(ko).getTime() <= Date.now();
  function plays() {
    if (typeof D === "undefined" || !D || !D.games) return [];
    const P = window.STIX_PICKS, out = new Map();
    const key = (x) => `${x.pid}|${x.mid}|${x.gid}|${x.side}`;
    if (P && P.enabled && P.enabled() && P.list) {
      for (const p of P.list()) {
        const g = D.games[p.gid];
        if (!g || !koPast(g.ko) || (g.final && !(P.held && P.held(p)))) continue; // finished games only while the pick is held (this week, until Tuesday)
        const r = (D.rows[p.pid] || []).find((x) => x.gid === p.gid) || {};
        out.set(key(p), { pid: p.pid, name: p.name, pos: p.pos, team: r.team || (playerById[p.pid] || {}).team, opp: r.opp, ha: r.ha, gid: p.gid, mid: p.mid, side: p.side,
          line: p.line, odds: p.odds == null ? null : Number(p.odds), pickId: p.id, codes: [], gr: P.grade ? P.grade(p) : null });
      }
    }
    const acc = window.STIX_ACCOUNT;
    if (window.STIX_RESEARCH && STIX_RESEARCH.livePlays && acc && acc.signedIn()) {
      for (const s of STIX_RESEARCH.livePlays()) {
        const k = key(s), have = out.get(k);
        if (have) { have.codes = s.codes; continue; }
        const odds = s.side === "o" ? s.op : s.up;
        out.set(k, { pid: s.pid, name: s.name, pos: s.pos, team: s.team, opp: s.opp, ha: s.ha, gid: s.gid, mid: s.mid, side: s.side, line: s.line,
          odds: odds != null && isFinite(Number(odds)) ? Number(odds) : -110, assumedOdds: odds == null, pickId: null, codes: s.codes });
      }
    }
    return [...out.values()].filter((x) => x.line != null && mkt[x.mid]);
  }

  // ---------- numbers ----------
  const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  const cdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  function frac(ev) {
    if (!ev) return null;
    if (ev.state === "post") return 1;
    if (ev.state === "pre" || !ev.state) return 0;
    const p = ev.period || 1, m = String(ev.clock || "0:00").split(":");
    const left = (parseFloat(m[0]) || 0) + (m.length > 1 ? (parseFloat(m[1]) || 0) / 60 : 0);
    if (p >= 5) return 0.97;
    return Math.max(0, Math.min(((p - 1) * 15 + (15 - left)) / 60, 0.99));
  }
  const clockTxt = (ev) => {
    if (!ev) return "";
    if (ev.state === "post") return "Final";
    if (ev.state === "pre") return "Not started";
    if (ev.period === 2 && ev.clock === "0:00") return "Half";
    return ev.period >= 5 ? `OT ${ev.clock}` : `Q${ev.period} ${ev.clock}`;
  };
  const win = (o) => (o > 0 ? o / 100 : 100 / -o);
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const uTxt = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}u`;
  const UNIT = { pass_yds: "yds", rush_yds: "yds", rec_yds: "yds", rec: "rec", pass_att: "att", pass_cmp: "cmp", rush_att: "car" };

  // One play → what to show. status: ok / risk / dead / hit / push / wait
  function evalPlay(x) {
    const ev = FEED.ev[x.gid], bx = FEED.box[x.gid], f = frac(ev);
    const over = x.side === "o", line = x.line, stat = D.markets.find((m) => m.id === x.mid).stat;
    const base = { x, ev, f, clock: clockTxt(ev), word: UNIT[x.mid] || "", cur: null, status: "wait", chip: "No stats yet", room: "", units: null, unitsTxt: "", locked: false, tgt: null, tgtShare: null, pct: 0, pace: null };
    // Official grade (nflverse stats) wins once it exists: settled this-week picks held out of Graded until Tuesday
    const gr = x.gr;
    if (gr && (gr.st === "hit" || gr.st === "miss" || gr.st === "push" || gr.st === "void")) {
      const win_ = gr.st === "hit", st = gr.st === "miss" ? "dead" : gr.st === "hit" ? "hit" : gr.st, cur = gr.act == null ? null : gr.act, odds = x.odds;
      const units = st === "push" || st === "void" ? 0 : odds != null && isFinite(odds) && odds !== 0 ? (win_ ? win(odds) : -1) : null;
      const room = st === "void" ? "Did not play" : st === "push" ? "Exactly on the line" : over ? (win_ ? `Cleared by ${fmt(cur - line)}` : `Short by ${fmt(line - cur)}`) : (win_ ? `Under by ${fmt(line - cur)}` : `Over by ${fmt(cur - line)}`);
      const pl0 = bx && bx.idx[`${x.team}|${normName(x.name)}`], pl1 = pl0 ? bx.players[pl0] : null;
      let tg = null, share = null;
      if (pl1 && (stat === "receptions" || stat === "receiving_yards") && pl1.s.targets != null) { tg = pl1.s.targets; share = bx.tt[x.team] ? Math.round((100 * tg) / bx.tt[x.team]) : null; }
      return { ...base, cur, status: st, chip: { hit: "Hit", dead: over ? "Miss" : "Dead", push: "Push", void: "Void" }[st], room, units, locked: true, p: win_ ? 1 : 0,
        pct: cur == null ? 0 : Math.max(Math.min((cur / line) * 0.8, 1), 0) * 100, pace: null, tgt: tg, tgtShare: share, clock: "Final",
        unitsTxt: units == null ? "no odds saved" : uTxt(units) + " locked" };
    }
    if (!bx) return base;
    const id = bx.idx[`${x.team}|${normName(x.name)}`], pl = id ? bx.players[id] : null;
    if (!pl) return base;
    const cur = pl.s[stat] == null ? 0 : pl.s[stat];
    if (stat === "receptions" || stat === "receiving_yards") {
      const tg = pl.s.targets, tot = bx.tt[x.team];
      if (tg != null) { base.tgt = tg; base.tgtShare = tot ? Math.round((100 * tg) / tot) : null; }
    }
    const out = { ...base, cur, pct: Math.max(Math.min((cur / line) * 0.8, 1), 0) * 100, pace: f == null ? null : f * 0.8 * 100 };
    const final = ev && ev.state === "post";
    let p, status, locked = false;
    if (over ? cur > line : false) { status = "hit"; p = 1; locked = true; }
    else if (!over && cur > line) { status = "dead"; p = 0; locked = true; }
    else if (final) {
      if (cur === line) { status = "push"; p = null; locked = true; }
      else if (over) { status = "dead"; p = 0; locked = true; } // Over finished short
      else { status = "hit"; p = 1; locked = true; } // Under finished below
    } else {
      const fr = Math.max(f || 0, 0.02), w = Math.min(fr / 0.5, 1) * 0.5;
      const rate = (1 - w) * line + w * (cur / fr);
      const exp = cur + (1 - fr) * rate, sd = Math.max(0.45 * line * Math.sqrt(1 - fr), 1);
      const pu = cdf((line - exp) / sd);
      p = over ? 1 - pu : pu;
      status = p >= 0.5 ? "ok" : "risk";
    }
    const odds = x.odds;
    let units = null;
    if (status === "push") units = 0;
    else if (odds != null && isFinite(odds) && odds !== 0) units = p * win(odds) - (1 - p);
    const chips = { ok: "On track", risk: "At risk", dead: over && final ? "Miss" : "Dead", hit: "Hit", push: "Push" };
    const unitWord = out.word;
    const room = status === "dead" && !final ? `Over by ${fmt(cur - line)}` : status === "dead" ? (over ? `Short by ${fmt(line - cur)}` : `Over by ${fmt(cur - line)}`)
      : status === "hit" ? (over ? `Cleared by ${fmt(cur - line)}` : `Under by ${fmt(line - cur)}`) : status === "push" ? "Exactly on the line"
      : over ? `${fmt(line - cur)} ${unitWord} to go` : `${fmt(line - cur)} ${unitWord} of room`;
    return { ...out, status, chip: chips[status], room, units, locked, p, unitsTxt: units == null ? "no odds saved" : uTxt(units) + (locked ? " locked" : " est.") };
  }

  // ---------- rendering ----------
  function rowHtml(r) {
    const x = r.x, tag = x.pickId ? `<span class="lv-tag pick">Pick</span>` : "", sg = x.codes.length ? `<span class="lv-tag sig">Signal</span>` : "";
    const codes = x.codes.length ? ` · <b>${x.codes.map(esc).join(", ")}</b>` : "";
    const g = D.games[x.gid];
    const vs = g ? `${g.away} @ ${g.home}` : x.gid;
    const bar = r.cur == null ? `<div class="lv-bar"></div>` : `<div class="lv-bar"><div class="lv-fill lv-f-${r.status}" style="width:${r.pct.toFixed(1)}%"></div>${r.pace != null && r.status !== "hit" && r.status !== "dead" ? `<div class="lv-pace" style="left:${r.pace.toFixed(1)}%" title="Even pace"></div>` : ""}<div class="lv-line" title="Prop line"></div></div>`;
    const tgt = r.tgt != null ? ` · Targets ${fmt(r.tgt)}${r.tgtShare != null ? ` (${r.tgtShare}%)` : ""}` : "";
    const now = r.cur == null ? `<span class="muted">Waiting for live stats</span>` : `<b>${fmt(r.cur)}</b> now`;
    return `<div class="lv-row"><div class="lv-top"><div class="lv-who">${tag}${sg}<a class="pname" href="#/player/${esc(x.pid)}">${esc(x.name)}</a> <span class="muted small">${esc(x.pos || "")} · ${esc(x.team || "")}</span></div><span class="lv-chip lv-${r.status}">${esc(r.chip)}</span></div>
      <div class="lv-l2 small muted"><span>${x.side === "o" ? "Over" : "Under"} ${fmt(x.line)} ${esc(mkt[x.mid].label.toLowerCase())}${codes}</span><span class="lv-room lv-t-${r.status}">${esc(r.room)}</span></div>${bar}
      <div class="lv-l2 small muted"><span>${now} · ${esc(vs)} ${esc(r.clock)}${tgt}</span><span class="lv-units ${r.units != null && r.units >= 0 ? "lv-pos" : r.units != null ? "lv-neg" : ""}">${esc(r.unitsTxt)}</span></div></div>`;
  }
  function panel() {
    let rows;
    try { rows = plays().map(evalPlay); } catch (e) { console.error("live tracker failed", e); return ""; }
    if (!rows.length) return "";
    const room = (r) => (r.cur == null ? 1e9 : r.x.line - r.cur);
    const alive = rows.filter((r) => r.status === "ok" || r.status === "risk"), done = rows.filter((r) => r.locked), wait = rows.filter((r) => r.status === "wait");
    const by = (a, b) => room(a) - room(b) || a.x.name.localeCompare(b.x.name);
    const secs = [["Needs attention", alive.filter((r) => r.status === "risk").sort(by)], ["On track", alive.filter((r) => r.status === "ok").sort(by)],
      ["Settled", done.sort((a, b) => (a.status === "dead") - (b.status === "dead") || by(a, b))], ["No live stats yet", wait]];
    const sum = (list) => list.reduce((s, r) => s + (r.units || 0), 0), pk = rows.filter((r) => r.x.pickId); // totals count every play saved to My picks (a saved signal counts); unsaved signals stay listed but are not counted
    // W/L: settled = decided plays (pushes counted apart); on pace = settled + live plays counted by current lean (On track = W, At risk = L)
    const wl = (list, pace) => { let w = 0, l = 0, ps = 0; list.forEach((r) => { if (r.status === "hit" || (pace && r.status === "ok")) w++; else if (r.status === "dead" || (pace && r.status === "risk")) l++; else if (r.status === "push") ps++; }); const n = w + l;
      return { w, l, ps, n, txt: n ? `${w}–${l}${ps ? `–${ps}` : ""} (${Math.round((100 * w) / n)}%)` : "—" }; };
    const sAll = wl(pk, false), pAll = wl(pk, true);
    const noOdds = rows.filter((r) => r.units == null && r.status !== "wait").length;
    const age = FEED.at ? Math.max(0, Math.round((Date.now() - FEED.at) / 1000)) : null;
    const stale = FEED.err || (age != null && age > 120);
    const h = secs.filter((s) => s[1].length).map(([t, l]) => `<h4 class="lv-h">${t}</h4>${l.map(rowHtml).join("")}`).join("");
    return `<div class="panel lv" id="lv-panel"><h3><span class="lv-dot${stale ? " stale" : ""}"></span>Live <span class="muted small">(${rows.length}) · ${FEED.err ? esc(FEED.err) : age == null ? "loading…" : `<span id="lv-age">updated ${age}s ago</span>`}</span></h3><div class="body">
      ${pk.length ? `<div class="lv-sum"><span>Est. net <b>${uTxt(sum(pk))}</b></span></div>
      <div class="lv-sum lv-wl"><span>Settled <b>${sAll.txt}</b></span><span>On pace <b>${pAll.txt}</b></span></div>` : ""}${h}
      <details class="lv-how small muted"><summary>How to read this</summary><p>Bar = stat so far against the line (white mark); grey tick = where an even pace would be. Live numbers come from ESPN and are provisional until the game is final. Units are a rough estimate (not validated): chance of winning from the stat so far and time left, at the odds saved with the pick (signals: the line's own quote, else −110). Decided plays show the real result. Est. net, Settled and On pace count every play you saved to My picks, whether or not it is also a signal; signals you have not saved are listed but not counted. Settled = plays already won or lost (a push is listed last); On pace also counts live plays by their current lean (On track as a win, At risk as a loss).${noOdds ? ` ${noOdds} play${noOdds === 1 ? "" : "s"} without saved odds show no units.` : ""}</p></details></div></div>`;
  }
  const pickIds = () => { try { return new Set(plays().filter((x) => x.pickId).map((x) => x.pickId)); } catch (e) { return new Set(); } };
  function redraw() {
    const el = document.getElementById("lv-panel");
    if (!el || !(location.hash || "").startsWith("#/picks")) return;
    const open = el.querySelector("details.lv-how") && el.querySelector("details.lv-how").open;
    const t = document.createElement("div"); t.innerHTML = panel();
    const n = t.firstElementChild;
    if (!n) return;
    const d = n.querySelector("details.lv-how"); if (d && open) d.open = true;
    el.replaceWith(n);
  }

  // ---------- polling ----------
  async function tick() {
    if (FEED.busy || typeof D === "undefined" || !D) return;
    FEED.busy = true;
    try {
      const ps = plays();
      if (!ps.length) return;
      const gids = [...new Set(ps.map((p) => p.gid))];
      if (gids.some((g) => !FEED.ev[g] || FEED.ev[g].state === "pre") && Date.now() - FEED.mapAt > MAP_MS) {
        try { await loadMap(gids); if (gids.every((g) => !FEED.ev[g])) FEED.err = "game not found on ESPN [" + (FEED.dbg || "") + "]"; else if (String(FEED.err).startsWith("game not found on ESPN")) FEED.err = ""; } catch (e) { FEED.err = "ESPN unreachable (" + (e && e.name === "AbortError" ? "timed out" : String((e && e.message) || e).slice(0, 40)) + ")"; }
      }
      // A game still marked pre-game (page opened before kickoff) re-reads the scoreboard at most once per MAP_MS so it flips to live on its own.
      // Games holding one of the user's own picks refresh every 30 s; games with only signal plays every 60 s (each summary is ~45 KB compressed).
      const mine = new Set(ps.filter((p) => p.pickId).map((p) => p.gid)), now = Date.now();
      const offi = (g) => ps.filter((p) => p.gid === g).every((p) => p.gr && ["hit", "miss", "push", "void"].includes(p.gr.st));
      const want = gids.filter((g) => !offi(g) && FEED.ev[g] && FEED.ev[g].state !== "pre" && !(FEED.box[g] && FEED.box[g].final)
        && (!FEED.box[g] || now - FEED.box[g].at >= (mine.has(g) ? POLL_MS : 2 * POLL_MS) - 2000));
      let bad = 0;
      await Promise.all(want.map(async (g) => {
        try {
          const doc = await getJson(SUM + FEED.ev[g].id);
          const st = parseStatus(doc);
          Object.assign(FEED.ev[g], st);
          FEED.box[g] = { ...parseBox(doc), final: st.state === "post", at: Date.now() };
        } catch (e) { bad++; }
      }));
      if (want.length && bad === want.length) FEED.err = "can't reach ESPN"; else if (want.length) { FEED.err = ""; FEED.at = Date.now(); }
    } finally { FEED.busy = false; redraw(); }
  }
  const active = () => document.visibilityState === "visible" && (location.hash || "").startsWith("#/picks");
  function bind(tab) {
    if (tab !== "picks") return;
    if (!timer) {
      timer = setInterval(() => { if (active()) tick(); else redraw(); }, POLL_MS);
      document.addEventListener("visibilitychange", () => { if (active()) tick(); });
    }
    if (document.getElementById("lv-panel")) tick();
  }
  // Age text ticks every 5 s without refetching
  setInterval(() => { const a = document.getElementById("lv-age"); if (a && active() && FEED.at && !FEED.err) a.textContent = `updated ${Math.max(0, Math.round((Date.now() - FEED.at) / 1000))}s ago`; }, 5000);
  window.STIX_LIVE = { panel, bind, pickIds, _t: { parseBox, parseStatus, frac, evalPlay, FEED, normName, cdf } };
})();
