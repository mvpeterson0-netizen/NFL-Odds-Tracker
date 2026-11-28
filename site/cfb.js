"use strict";
// Stix college football (CFB side; Power 4 games only): Board, Results and player cards.
// The data lives in the Stix database (not in this public repo) and is readable only by signed-in users who confirmed 21+;
// the database enforces that, this file just asks. Reads the tables made by supabase/011_cfb.sql and 012_cfb_team_names.sql.
(function () {
  const ACC = () => window.STIX_ACCOUNT;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MK = [
    { id: "player_pass_yds", label: "Passing yards", short: "Passing", stat: "pass_yds" },
    { id: "player_rush_yds", label: "Rushing yards", short: "Rushing", stat: "rush_yds" },
    { id: "player_reception_yds", label: "Receiving yards", short: "Receiving", stat: "rec_yds" },
  ];
  const BOOK = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", williamhill_us: "Caesars", fanatics: "Fanatics", betrivers: "BetRivers", espnbet: "ESPN BET", hardrockbet: "Hard Rock", ballybet: "Bally Bet", fliff: "Fliff" };
  const BOOK_RANK = ["draftkings", "fanduel"];
  const C = { games: null, wk: null, weekData: {}, loading: false, err: "", mk: "player_pass_yds", q: "", game: "", note: "",
    rWk: "", rMk: "", rPos: "", rBy: "week", rGame: "", open: {}, pMk: "", pos: {}, gen: 0 };

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "")
    .replace(/[^a-z ]+/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
  const odds = (v) => (v == null ? "" : v > 0 ? `+${v}` : String(v));
  const num = (v) => (v == null ? "" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(1));
  const fmtKo = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  const rerender = () => { if ((location.hash || "").startsWith("#/cfb") && typeof render === "function") render(); };
  const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : "–");
  const sgn = (v) => (v > 0 ? "+" : "") + (Math.round(v * 10) / 10);

  // ---------- team names: abbreviation (CIN) for tight spots, school name without the mascot (Baylor) elsewhere ----------
  const abbr = (g, side) => g[side + "_abbr"] || g[side + "_short"] || g[side + "_team"];
  const school = (g, side) => g[side + "_short"] || g[side + "_team"];
  const sideOf = (g, teamName) => (teamName === g.home_team ? "home" : teamName === g.away_team ? "away" : null);
  const matchup = (g, fn = abbr) => `${fn(g, "away")} @ ${fn(g, "home")}`;

  async function getAll(path) {
    let out = [], off = 0;
    for (;;) {
      const r = await ACC().db(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${off}`);
      if (!r.ok) throw new Error(r.error || "request failed");
      const d = Array.isArray(r.data) ? r.data : [];
      out = out.concat(d);
      if (d.length < 1000) return out;
      off += 1000;
    }
  }
  const inList = (a) => "(" + a.map((x) => encodeURIComponent(x)).join(",") + ")";
  const weeksList = () => [...new Set(C.games.map((g) => g.week).filter((w) => w != null))].sort((a, b) => a - b);

  async function loadGames() { C.games = await getAll("/rest/v1/cfb_games?select=*&order=kickoff.asc,game_id.asc"); }
  // Loading is done in parallel: up to 3 weeks at a time (each week's lines and results together), then every player position
  // that isn't known yet in a few big batches, once for all the weeks (not once per week). Calls queue behind each other so two
  // screens asking for the same weeks never download them twice.
  async function pool(tasks, n) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) await tasks[i++](); }));
  }
  let loadChain = Promise.resolve();
  function loadWeeks(list) {
    const p = loadChain.catch(() => {}).then(() => doLoad(list));
    loadChain = p;
    return p;
  }
  async function doLoad(list) {
    const need = list.filter((w) => !C.weekData[w]), gen = C.gen, raw = {};
    if (!need.length) return;
    await pool(need.map((wk) => async () => {
      const ids = C.games.filter((g) => g.week === wk).map((g) => g.game_id), d = { lines: [], results: [] };
      if (ids.length) {
        [d.lines, d.results] = await Promise.all([
          getAll(`/rest/v1/cfb_lines?select=game_id,pull_type,captured_utc,book,market,player_name,line,over_price,under_price&game_id=in.${inList(ids)}&order=id.asc`),
          getAll(`/rest/v1/cfb_results?select=game_id,athlete_id,player_name,team_name,pass_att,pass_yds,rush_att,rush_yds,rec,rec_yds&game_id=in.${inList(ids)}&order=game_id.asc,athlete_id.asc`)]);
      }
      raw[wk] = d;
    }), 3);
    const unknown = [...new Set(need.flatMap((w) => raw[w].results.map((r) => r.athlete_id)).filter((a) => !(a in C.pos)))], batches = [];
    for (let i = 0; i < unknown.length; i += 200) batches.push(unknown.slice(i, i + 200));
    await pool(batches.map((b) => async () => {
      const got = {};
      for (const p of await getAll(`/rest/v1/cfb_players?select=athlete_id,pos&athlete_id=in.${inList(b)}&order=athlete_id.asc`)) got[p.athlete_id] = p.pos;
      if (gen === C.gen) for (const a of b) C.pos[a] = got[a] || "";
    }), 6);
    if (gen !== C.gen) return; // signed out while loading: drop it
    for (const wk of need) { raw[wk].results.forEach((r) => (r.pos = C.pos[r.athlete_id] || "")); C.weekData[wk] = raw[wk]; }
  }
  const loadWeek = async (wk) => { await loadWeeks([wk]); return C.weekData[wk]; };
  const loadAllWeeks = () => loadWeeks(weeksList());
  const allLoaded = () => !!C.games && weeksList().every((w) => C.weekData[w]);

  // One row per game + market + player: the graded (~1 h before kickoff) line if captured, else the latest line showing.
  // Built once per week and reused (rebuilt only if that week's data or the games list is replaced). Callers must not change the rows.
  const RC = new Map();
  function rowsFor(wk) {
    const d = C.weekData[wk]; if (!d) return [];
    const hit = RC.get(wk);
    if (hit && hit.d === d && hit.g === C.games) return hit.rows;
    const rows = buildRows(wk, d);
    RC.set(wk, { d, g: C.games, rows });
    return rows;
  }
  function buildRows(wk, d) {
    const games = new Map(C.games.filter((g) => g.week === wk).map((g) => [g.game_id, g]));
    const resBy = new Map();
    for (const r of d.results) (resBy.get(r.game_id) || resBy.set(r.game_id, new Map()).get(r.game_id)).set(norm(r.player_name), r);
    const groups = new Map();
    for (const l of d.lines) {
      const k = `${l.game_id}|${l.market}|${norm(l.player_name)}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(l);
    }
    const rows = [];
    for (const ls of groups.values()) {
      const g = games.get(ls[0].game_id); if (!g) continue;
      const kind = ls.some((l) => l.pull_type === "pregame") ? "pregame" : "first";
      const byBook = new Map();
      for (const l of ls.filter((x) => x.pull_type === kind)) { // latest capture per book
        const o = byBook.get(l.book); if (!o || l.captured_utc > o.captured_utc) byBook.set(l.book, l);
      }
      const books = [...byBook.values()].sort((a, b) => {
        const ra = BOOK_RANK.indexOf(a.book), rb = BOOK_RANK.indexOf(b.book);
        return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || a.book.localeCompare(b.book);
      });
      const main = books[0], mk = MK.find((m) => m.id === main.market);
      const res = (resBy.get(g.game_id) || new Map()).get(norm(main.player_name)) || null;
      let act = null, outcome = "";
      if (g.status === "final") {
        if (res) {
          act = res[mk.stat] == null ? 0 : Number(res[mk.stat]); // listed in the box score but no entry for this stat = 0
          const line = Number(main.line);
          outcome = act > line ? "over" : act < line ? "under" : "push";
        } else outcome = "nomatch";
      }
      const side = res ? sideOf(g, res.team_name) : null;
      rows.push({ g, wk, mk, name: main.player_name, key: norm(main.player_name), team: res ? res.team_name : "", side, pos: res ? res.pos : "",
        main, books, kind, act, outcome });
    }
    rows.sort((a, b) => a.g.kickoff.localeCompare(b.g.kickoff) || a.g.game_id.localeCompare(b.g.game_id) || (a.side || "").localeCompare(b.side || "") || a.name.localeCompare(b.name));
    return rows;
  }
  const teamAbbr = (r) => (r.side ? abbr(r.g, r.side) : "");
  const teamSchool = (r) => (r.side ? school(r.g, r.side) : "");
  const graded = (r) => r.g.status === "final" && r.outcome !== "nomatch" && r.outcome !== "";

  async function start() {
    if (C.loading) return;
    C.loading = true; C.err = "";
    try {
      if (!C.games) await loadGames();
      if (/^#\/cfb\/(results|signals|player-)/.test(location.hash || "")) await loadAllWeeks();
      if (C.wk == null && C.games.length) {
        const weeks = weeksList();
        const up = weeks.find((w) => C.games.some((g) => g.week === w && g.status !== "final"));
        let pick = up != null ? up : weeks[weeks.length - 1];
        await loadWeek(pick);
        if (!C.weekData[pick].lines.length && weeks.indexOf(pick) > 0) { // next week's lines aren't posted yet: show last week
          C.note = `Week ${pick}'s lines aren't posted yet (they usually appear midweek). Showing week ${weeks[weeks.indexOf(pick) - 1]}.`;
          pick = weeks[weeks.indexOf(pick) - 1];
          await loadWeek(pick);
        }
        C.wk = pick;
      } else if (C.wk != null) await loadWeek(C.wk);
      if (/^#\/cfb\/(results|signals|player-)/.test(location.hash || "")) await loadAllWeeks();
    } catch (e) { C.err = `Couldn't load college football data: ${e.message}`; }
    C.loading = false;
    rerender();
  }

  // ---------- shared bits ----------
  const resCell = (r) => (r.outcome === "nomatch" ? `<span class="muted small" title="No player with this name in the box score (did not play, or the name is written differently)">no match</span>`
    : r.outcome ? `<span class="res ${r.outcome}">${r.outcome}</span>` : "");
  const pLink = (r) => `<a class="pname" href="#/cfb/player-${esc(r.key.replace(/ /g, "_"))}"><b>${esc(r.name)}</b></a>`;
  const mkTabs = (cur, attr, withAll) => `<span class="mtabs">${withAll ? `<button class="gchip ${cur === "" ? "on" : ""}" ${attr}=""><b>All</b></button>` : ""}${MK.map((m) => `<button class="gchip ${cur === m.id ? "on" : ""}" ${attr}="${m.id}"><b>${m.short}</b></button>`).join("")}</span>`;
  const foot = `<p class="muted small">Power 4 games (ACC, Big Ten, Big 12, SEC, Notre Dame). Lines: The Odds API, graded on the line captured about 1 hour before kickoff (DraftKings first, then FanDuel; every book is on the player's card). Results: ESPN box scores; a player in the box score with no entry for a stat counts as 0. Research tool only.</p>`;
  const searchBox = `<input id="c-q" type="search" placeholder="Search player or team" value="${esc(C.q)}" autocomplete="off">`;

  // ---------- Board ----------
  function boardRows() {
    const q = norm(C.q);
    return rowsFor(C.wk).filter((r) => r.mk.id === C.mk && (!C.game || r.g.game_id === C.game) &&
      (!q || r.key.includes(q) || norm(teamSchool(r)).includes(q) || norm(teamAbbr(r)).includes(q)));
  }
  function board() {
    const gs = C.games.filter((g) => g.week === C.wk);
    const rows = boardRows();
    const anyFinal = rows.some((r) => r.g.status === "final");
    let h = `<div class="c-bar"><label class="small">Week <select id="c-wk">${weeksList().map((w) => `<option value="${w}" ${w === C.wk ? "selected" : ""}>${w}</option>`).join("")}</select></label>${mkTabs(C.mk, "data-cm")}${searchBox}</div>
      <div class="gamebar" role="group" aria-label="Choose a game"><button class="gchip ${C.game ? "" : "on"}" data-cg=""><b>All</b><span class="muted small">${gs.length}</span></button>` +
      gs.map((g) => `<button class="gchip ${C.game === g.game_id ? "on" : ""}" data-cg="${esc(g.game_id)}"><b>${esc(matchup(g))}</b><span class="muted small">${g.status === "final" ? `Final ${g.away_score}–${g.home_score}` : esc(fmtKo(g.kickoff))}</span></button>`).join("") + `</div>`;
    if (!rows.length) return h + `<p class="muted pad">No lines for this filter yet. Lines are collected starting midweek and again about 1 hour before kickoff.</p>` + foot;
    h += `<div class="panel"><table class="ctable"><thead><tr><th>Player</th><th>Team</th><th class="num">Line</th>${anyFinal ? `<th class="num">Act</th><th>Result</th>` : ""}</tr></thead><tbody>`;
    let last = "";
    for (const r of rows) {
      if (r.g.game_id !== last) {
        last = r.g.game_id;
        h += `<tr class="ghead"><td colspan="${anyFinal ? 5 : 3}"><b>${esc(matchup(r.g))}</b> <span class="muted">· ${r.g.status === "final" ? `Final ${r.g.away_score}–${r.g.home_score}` : esc(fmtKo(r.g.kickoff))}</span></td></tr>`;
      }
      h += `<tr><td>${pLink(r)}${r.pos ? ` <span class="muted small">${esc(r.pos)}</span>` : ""}</td><td>${esc(teamAbbr(r)) || '<span class="muted">–</span>'}</td>
        <td class="num"><b>${num(r.main.line)}</b>${r.kind === "first" ? ` <span class="chip snapchip" title="First-posted line. The graded line is captured about 1 hour before kickoff.">1st</span>` : ""}</td>
        ${anyFinal ? `<td class="num">${r.act == null ? '<span class="muted">–</span>' : `<b>${num(r.act)}</b>`}</td><td>${resCell(r)}</td>` : ""}</tr>`;
    }
    return h + `</tbody></table></div><p class="muted small">Tap a player for his card: every game, every book's line and odds.</p>` + foot;
  }

  // ---------- Results: modeled on the NFL side's Leads Analysis (record, hit rate, units, ROI) ----------
  // The "bet" is 1 unit on every graded line, all Over or all Under, at the saved odds. Lines without both saved prices are left out.
  const payout = (o) => (o > 0 ? o / 100 : 100 / Math.abs(o));
  const unitsTxt = (u) => `${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(2)} u`;
  const roiTxt = (v) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "%");
  const recTxt = (s) => `${s.W}–${s.L}${s.P ? `–${s.P}` : ""}`;
  function bets(rows, side) {
    const out = [];
    for (const r of rows) {
      const odds = side === "over" ? r.main.over_price : r.main.under_price;
      if (odds == null || r.main.over_price == null || r.main.under_price == null) continue;
      const o = r.outcome === "push" ? "push" : r.outcome === side ? "hit" : "miss";
      out.push({ r, side, odds, out: o, u: o === "hit" ? payout(odds) : o === "miss" ? -1 : 0 });
    }
    return out;
  }
  function tally(list) {
    const W = list.filter((x) => x.out === "hit").length, L = list.filter((x) => x.out === "miss").length, P = list.filter((x) => x.out === "push").length;
    const U = list.reduce((a, x) => a + x.u, 0), n = W + L;
    return { W, L, P, U, n, hit: n ? (100 * W) / n : null, roi: n ? (100 * U) / n : null };
  }
  function resultRows(skipGame) {
    const out = [];
    for (const w of weeksList()) {
      if (C.rWk !== "" && w !== +C.rWk) continue;
      for (const r of rowsFor(w)) {
        if (!graded(r) || (C.rMk && r.mk.id !== C.rMk) || (C.rPos && r.pos !== C.rPos)) continue;
        if (!skipGame && C.rGame && r.g.game_id !== C.rGame) continue;
        out.push(r);
      }
    }
    return out;
  }
  // Each graded line, with what 1 unit on the Over and 1 unit on the Under would have returned at the saved odds.
  function lineRows(rows) {
    return rows.map((r) => {
      const ob = bets([r], "over")[0], ub = bets([r], "under")[0];
      return { r, ou: ob ? ob.u : null, uu: ub ? ub.u : null };
    });
  }
  function resRow(x) {
    const r = x.r, cls = r.outcome === "over" ? "la-hit" : r.outcome === "under" ? "la-miss" : "la-push";
    return `<div class="rlrow ${cls}"><div class="rlhead">${pLink(r)}<span class="rlstat">${esc(r.mk.short)}</span><span class="rlsize ${r.outcome === "over" ? "over" : r.outcome === "under" ? "under" : ""}">${r.outcome === "push" ? "push" : r.outcome === "over" ? "Over" : "Under"}</span></div>
      <div class="muted small">${r.pos ? esc(r.pos) + " · " : ""}${esc(teamAbbr(r))} ${r.side === "home" ? "vs" : "@"} ${esc(abbr(r.g, r.side === "home" ? "away" : "home"))} · wk ${r.wk}</div>
      <div class="rlcells"><span><span class="muted small">Line</span> <b>${num(r.main.line)}</b> <span class="muted small">${odds(r.main.over_price)} / ${odds(r.main.under_price)}</span></span><span><span class="muted small">Actual</span> <b>${num(r.act)}</b></span></div></div>`;
  }
  const sectionRows = (xs, k, title) => {
    const g = xs.filter((x) => x.r.outcome === k).sort((a, b) => a.r.g.kickoff.localeCompare(b.r.g.kickoff) || a.r.name.localeCompare(b.r.name));
    return g.length ? `<h3 class="la-h ${k === "over" ? "hit" : k === "under" ? "miss" : ""}">${title} (${g.length})</h3><div class="panel rlist">${g.map(resRow).join("")}</div>` : "";
  };
  const sideTxt = (t) => (t.n ? `${unitsTxt(t.U)} · ROI ${roiTxt(t.roi)}` : "—");
  function results() {
    const weeks = weeksList();
    const base = resultRows(true);
    const pos = [...new Set(weeks.flatMap((w) => rowsFor(w)).filter(graded).map((r) => r.pos).filter(Boolean))].sort();
    const opt = (v, cur, l) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
    const chips = (key, cur, items) => items.map(([v, l]) => `<button class="gchip ${String(v) === String(cur) ? "on" : ""}" data-rf="${key}" data-v="${esc(v)}"><b>${esc(l)}</b></button>`).join("");
    const row = (label, key, cur, items) => `<div class="crow"><span class="small muted">${label}</span><div class="crow-s">${chips(key, cur, [["", "All"]].concat(items))}</div></div>`;
    let h = row("Position", "pos", C.rPos, pos.map((p) => [p, p])) + row("Market", "mk", C.rMk, MK.map((m) => [m.id, m.short]));
    if (!base.length) return h + `<p class="muted pad">No graded lines for these filters yet.</p>` + foot;
    const n = base.length, o = base.filter((r) => r.outcome === "over").length, u = base.filter((r) => r.outcome === "under").length, p = n - o - u;
    const to = tally(bets(base, "over")), tu = tally(bets(base, "under"));
    const cls = (t) => (t.U > 0 ? "la-pos" : t.U < 0 ? "la-neg" : "");
    h += `<div class="la-sum c3"><div><span class="muted small">Graded lines</span><b>${n}</b><span class="muted small">${p ? `${p} push${p === 1 ? "" : "es"}` : "no pushes"}</span></div>
      <div><span class="muted small">Over finished</span><b>${o} · ${pct(o, n)}</b><span class="small ${cls(to)}">${sideTxt(to)}</span></div>
      <div><span class="muted small">Under finished</span><b>${u} · ${pct(u, n)}</b><span class="small ${cls(tu)}">${sideTxt(tu)}</span></div></div>`;
    const by = "week", keyOf = (x) => `Week ${x.r.wk}`;
    const groups = new Map(), xsAll = lineRows(base);
    for (const x of xsAll) (groups.get(keyOf(x)) || groups.set(keyOf(x), []).get(keyOf(x))).push(x);
    const arr = [...groups].map(([k, xs]) => ({ k, xs, n: xs.length, o: xs.filter((x) => x.r.outcome === "over").length, u: xs.filter((x) => x.r.outcome === "under").length }));
    arr.sort((a, b) => b.xs[0].r.wk - a.xs[0].r.wk);
    h += arr.map(({ k, xs, n: gn, o: go, u: gu }) => {
      const id = `${by}|${k}`, wo = tally(bets(xs.map((x) => x.r), "over")), wu = tally(bets(xs.map((x) => x.r), "under"));
      return `<details class="la-wk cw" data-cwk="${esc(id)}" ${C.open[id] ? "open" : ""}><summary><span class="la-wk-t">${esc(k)}</span><span class="muted small cw-c">${go > gu ? `<b>${go} O</b>` : `${go} O`} · ${gu > go ? `<b>${gu} U</b>` : `${gu} U`}${gn - go - gu ? ` · ${gn - go - gu} P` : ""}</span><span class="small cw-u"><span class="${wo.U > 0 ? "la-pos" : wo.U < 0 ? "la-neg" : ""}">O ${wo.n ? unitsTxt(wo.U) : "—"}</span> · <span class="${wu.U > 0 ? "la-pos" : wu.U < 0 ? "la-neg" : ""}">U ${wu.n ? unitsTxt(wu.U) : "—"}</span></span></summary>
        ${sectionRows(xs, "over", "Over")}${sectionRows(xs, "under", "Under")}${sectionRows(xs, "push", "Pushes")}</details>`;
    }).join("");
    return h + `<p class="muted small">Graded on the line captured about 1 hour before kickoff (DraftKings first, then FanDuel). Units and ROI are what 1 unit on every line's Over (or Under) would have returned at the saved odds; lines without both prices saved are left out of those two figures only. A player in the box score with no entry for a stat counts as 0 for it. Research tool only.</p>`;
  }

  // ---------- Opponent defense rank (same idea as the NFL Defense tab) ----------
  // For a defense and a position group (QB / RB / WR / TE), "allowed" = the sum of a stat (pass, rush or receiving yards) by that
  // position group's players against that defense in one game. Defenses are ranked by average allowed per game: 1 = fewest allowed.
  // "As of a game" uses only final games that kicked off before it, so the rank is what was known pre-game. Computed in the browser
  // from cfb_results + cfb_players; nothing is stored. A defense is ranked only if it is a Power 4 team: the data holds Power 4 games
  // only, so a team with 5+ games in it is Power 4 and one with fewer is a non-Power-4 opponent (shown with no rank).
  const PGRP = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" };
  const DSTATS = ["pass_yds", "rush_yds", "rec_yds"];
  const ordinal = (n) => { const v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); };
  const DEF = { key: "", games: [], ranked: null, cache: new Map() };
  function defIndex() {
    const key = `${C.games.length}|${C.games.filter((g) => g.status === "final").length}|${weeksList().filter((w) => C.weekData[w]).length}`;
    if (DEF.key === key) return DEF;
    DEF.key = key; DEF.cache = new Map(); DEF.games = [];
    const cnt = new Map();
    for (const g of C.games) for (const t of [g.home_team, g.away_team]) cnt.set(t, (cnt.get(t) || 0) + 1);
    DEF.ranked = new Set([...cnt].filter(([, n]) => n >= 5).map(([t]) => t));
    if (DEF.ranked.size < 20) DEF.ranked = new Set(cnt.keys()); // early season: too few games to tell them apart, rank everyone
    for (const g of C.games) {
      if (g.status !== "final" || !C.weekData[g.week]) continue;
      const rs = C.weekData[g.week].results.filter((r) => r.game_id === g.game_id);
      if (!rs.length) continue;
      const tot = { [g.home_team]: {}, [g.away_team]: {} };
      for (const r of rs) {
        const pg = PGRP[r.pos], side = sideOf(g, r.team_name);
        if (!pg || !side) continue;
        const t = tot[side === "home" ? g.away_team : g.home_team];
        for (const s of DSTATS) if (r[s] != null) t[`${pg}|${s}`] = (t[`${pg}|${s}`] || 0) + Number(r[s]);
      }
      const ko = Date.parse(g.kickoff);
      DEF.games.push({ ko, def: g.home_team, tot: tot[g.home_team] }, { ko, def: g.away_team, tot: tot[g.away_team] });
    }
    DEF.games.sort((a, b) => a.ko - b.ko);
    return DEF;
  }
  // { "QB|pass_yds": { team: {rk, avg, n, of} } } using final games that kicked off before beforeMs (all games when null)
  function defTable(beforeMs) {
    const D = defIndex(), ck = beforeMs == null ? "ALL" : String(beforeMs);
    if (D.cache.has(ck)) return D.cache.get(ck);
    const tot = new Map(), n = new Map();
    for (const g of D.games) {
      if (beforeMs != null && g.ko >= beforeMs) break;
      if (!D.ranked.has(g.def)) continue;
      n.set(g.def, (n.get(g.def) || 0) + 1);
      const t = tot.get(g.def) || tot.set(g.def, {}).get(g.def);
      for (const k in g.tot) t[k] = (t[k] || 0) + g.tot[k];
    }
    const out = {};
    for (const pg of ["QB", "RB", "WR", "TE"]) for (const s of DSTATS) {
      const k = `${pg}|${s}`, avgs = new Map();
      for (const [team, c] of n) avgs.set(team, (tot.get(team)[k] || 0) / c);
      const vals = [...avgs.values()];
      out[k] = {};
      for (const [team, a] of avgs) out[k][team] = { rk: 1 + vals.filter((v) => v < a).length, avg: a, n: n.get(team), of: vals.length };
    }
    D.cache.set(ck, out);
    return out;
  }
  // The rank of the defense `r`'s player faced, as of that game; null when there's none to show.
  function oppRank(r, pg) {
    const g = r.g, dfn = r.side ? (r.side === "home" ? g.away_team : g.home_team) : null;
    if (!dfn || !pg) return null;
    const k = `${pg}|${r.mk.stat}`, v = (defTable(Date.parse(g.kickoff))[k] || {})[dfn];
    return v ? { ...v, team: dfn, cur: (defTable(null)[k] || {})[dfn] } : null;
  }
  function rankCell(rk, pg, mk) {
    if (!rk) return "";
    const tip = `${rk.team} allowed ${num(rk.avg)} ${pg} ${mk.label.toLowerCase()} per game in its ${rk.n} game${rk.n === 1 ? "" : "s"} before this one. ` +
      `Rank ${rk.rk} of ${rk.of} (1 = fewest allowed, toughest).` + (rk.cur ? ` Season so far: ${ordinal(rk.cur.rk)} (${num(rk.cur.avg)}/g, ${rk.cur.n} gm).` : "");
    const cls = rk.n < 3 ? "" : rk.rk <= Math.round(rk.of / 4) ? "tough" : rk.rk > rk.of - Math.round(rk.of / 4) ? "easy" : "";
    return ` <span class="drk ${cls}" title="${esc(tip)}">${ordinal(rk.rk)}</span>`;
  }
  const scoreCell = (r) => {
    const g = r.g;
    if (g.status !== "final" || g.home_score == null || g.away_score == null) return '<span class="muted">–</span>';
    if (!r.side) return `${esc(abbr(g, "away"))} ${g.away_score}–${g.home_score} ${esc(abbr(g, "home"))}`;
    const mine = r.side === "home" ? g.home_score : g.away_score, theirs = r.side === "home" ? g.away_score : g.home_score;
    return `${mine > theirs ? "W" : mine < theirs ? "L" : "T"} ${mine}–${theirs}`;
  };

  // ---------- Player card ----------
  function playerCard(key) {
    const back = `<p class="small"><a href="#/cfb/board">← Board</a> · <a href="#/cfb/results">Results</a></p>`;
    const all = weeksList().flatMap((w) => rowsFor(w)).filter((r) => r.key === key);
    if (!all.length) return back + `<p class="muted pad">No lines found for this player.</p>`;
    const mks = MK.filter((m) => all.some((r) => r.mk.id === m.id));
    const mid = mks.some((m) => m.id === C.pMk) ? C.pMk : mks[0].id;
    const rs = all.filter((r) => r.mk.id === mid).map((r) => ({ ...r })).sort((a, b) => a.g.kickoff.localeCompare(b.g.kickoff));
    const latest = all.slice().sort((a, b) => b.g.kickoff.localeCompare(a.g.kickoff))[0];
    const ptTeam = (all.slice().sort((a, b) => b.g.kickoff.localeCompare(a.g.kickoff)).find((r) => r.team) || {}).team;
    if (ptTeam) rs.forEach((r) => { if (!r.side) r.side = sideOf(r.g, ptTeam); }); // games he has no box-score line in: take his side from his team
    const pg = PGRP[(all.find((r) => r.pos) || {}).pos || ""] || null; // QB / RB / WR / TE
    const gr = rs.filter(graded), t = tally(gr);
    const mkObj = MK.find((m) => m.id === mid);
    const avgAct = gr.length ? gr.reduce((s, r) => s + r.act, 0) / gr.length : null, avgLine = rs.reduce((s, r) => s + Number(r.main.line), 0) / rs.length;
    let h = back + `<div class="ph"><h2>${esc(latest.name)}</h2><span class="chip">${esc(teamSchool(latest) || "–")}${latest.pos ? ` · ${esc(latest.pos)}` : ""}</span></div>
      <div class="mtabs">${mks.map((m) => `<button data-pm="${m.id}" class="${m.id === mid ? "on" : ""}">${esc(m.label)}</button>`).join("")}</div>
      <div class="c-sum"><div><b>${rs.length}</b><span>games with a line</span></div><div><b>${num(avgLine)}</b><span>avg line</span></div>${gr.length ? `<div><b>${num(avgAct)}</b><span>avg actual</span></div><div class="over"><b>${gr.filter((r) => r.outcome === "over").length}</b><span>Over</span></div><div class="under"><b>${gr.filter((r) => r.outcome === "under").length}</b><span>Under</span></div>` : ""}</div>`;
    const hasFirst = rs.some((r) => r.kind === "first" && r.g.status !== "final");
    h += `<div class="panel"><div class="chart">${chart(rs)}</div><div class="legend"><span><i style="border-color:var(--accent)"></i>Actual</span><span><i style="border-color:var(--ink);border-top-width:3px"></i>Line (green = over hit, red = under)</span>${hasFirst ? `<span><i style="border-color:var(--warn-ink);border-top-width:3px;border-top-style:dashed"></i>First-posted line (not graded yet)</span>` : ""}</div></div>`;
    h += `<div class="panel"><table class="ctable"><thead><tr><th>Wk</th><th>Opp</th><th class="num">Line</th><th class="num">Act</th><th>Result</th><th class="num">Score</th></tr></thead><tbody>` +
      rs.map((r) => `<tr><td>${r.wk}</td><td>${r.side ? (r.side === "home" ? "vs " : "@ ") + esc(abbr(r.g, r.side === "home" ? "away" : "home")) + rankCell(oppRank(r, pg), pg, r.mk) : esc(matchup(r.g))}</td>
        <td class="num"><b>${num(r.main.line)}</b>${r.kind === "first" ? ` <span class="chip snapchip" title="First-posted line; graded line not captured yet">1st</span>` : ""}</td>
        <td class="num">${r.act == null ? '<span class="muted">–</span>' : `<b>${num(r.act)}</b>`}</td><td>${resCell(r)}</td><td class="num">${scoreCell(r)}</td></tr>`).join("") + `</tbody></table></div>
      <p class="muted small">${pg ? `Rank next to the opponent: where that defense stood against ${pg} ${esc(mkObj.label.toLowerCase())} before the game (1 = fewest allowed per game), among Power 4 defenses. Hover for the numbers. Positions come from ESPN rosters.` : `No position on file for this player, so there's no opponent rank.`} Score is from this player's team's side (W/L).</p>`;
    // Every book's line for each game (the "other books" box, like the NFL side)
    h += `<div class="panel"><h3>${esc(mkObj.label)}: lines by book</h3><div class="body">` + rs.slice().reverse().map((r, i) =>
      `<details ${i === 0 ? "open" : ""}><summary class="small"><b>Week ${r.wk}</b> ${esc(matchup(r.g))} <span class="muted">· ${r.kind === "first" ? "first-posted lines" : "~1 h before kickoff"}</span></summary>
      <table class="ctable inner"><thead><tr><th>Book</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th></tr></thead><tbody>` +
      r.books.map((b) => `<tr><td>${esc(BOOK[b.book] || b.book)}</td><td class="num"><b>${num(b.line)}</b></td><td class="num">${odds(b.over_price)}</td><td class="num">${odds(b.under_price)}</td></tr>`).join("") + `</tbody></table></details>`).join("") + `</div></div>`;
    return h + foot;
  }
  // The NFL side's chart (chartSVG in app.js): actual line + dots with their numbers, the line as a bar colored by the result
  // with its number, and the first-posted line as a dashed bar until the graded line exists. Rows are reshaped to what it reads.
  function chart(rs) {
    if (typeof chartSVG !== "function") return `<p class="muted pad">Chart didn't load. Try refreshing.</p>`;
    const rows = rs.map((r) => {
      const ok = r.kind === "pregame" || r.g.status === "final", line = Number(r.main.line), bk = BOOK[r.main.book] || r.main.book;
      return { wk: r.wk, m: { x: { act: r.act, line: ok ? line : null, lstat: ok ? "ok" : "pending", res: r.outcome, book: bk,
        snaps: ok ? [] : [{ label: "1st", line, book: bk, cap: r.main.captured_utc, op: r.main.over_price, up: r.main.under_price }] } } };
    });
    const phone = window.STIX_MOBILE && window.STIX_MOBILE.active && window.STIX_MOBILE.active();
    return chartSVG(rows, "x", phone ? { W: 400, H: 230, L: 30, R: 26, T: 26, B: 24, fs: 12 } : {});
  }

  // ---------- Signals (CFB side, Michael 2026-11-27): the "big game, line raised, now Under" variants and the QB passing line-move
  // fade from the 2026-11-27 CFB study (claude/cfb-signal-port-2026-11-27.md). Frozen 2026-11-27: definitions never change; records
  // through week 12 are discovery (the rules were picked after seeing them), week 13 on is forward ("Since freeze").
  // Computed in the browser from the same rows as the Board and Results. Records count only lines captured ~1 h before kickoff
  // (as the study did); a first-posted line can show a player in "this week" but never counts in a record.
  // Only players on Power 4 teams (teams with 5+ stored games) qualify: every game of theirs is stored, so "previous game" is exact.
  const SG_FREEZE_WK = 13;
  const SGT = [
    { id: "bigbeat", tile: "Big Beat", opts: [
      { v: "bl50", tg: "50%+", lbl: "Beat by 50%+", side: "under", mk: "player_reception_yds", def: "Receiving yards Under (WR/TE/RB) when last game he went Over his receiving-yards line by 50% or more with 40+ yards, and this week's line is higher.", disc: { rec: "65–40", roi: 17.1, lo: 0.3, hi: 34.4 } },
      { v: "resid", tg: "1.5–2×", lbl: "1.5–2× last line", side: "under", mk: "player_reception_yds", def: "WR receiving yards Under when last game he finished at 1.5 to 2 times his receiving-yards line (no line-raise needed).", disc: { rec: "28–12", roi: 32.1, lo: 7.2, hi: 58.0 } },
      { v: "bg", tg: "Big", lbl: "Big game", side: "under", mk: "player_reception_yds", def: "WR/TE receiving yards Under when last game he finished 50%+ over his receiving-yards line with 40+ yards (no line-raise needed).", disc: { rec: "70–46", roi: 14.2, lo: -1.4, hi: 29.4 } } ] },
    { id: "jump", tile: "Line Jump", opts: [
      { v: "up25", tg: "+25%", lbl: "Line up 25%+", side: "under", mk: "player_reception_yds", def: "WR receiving yards Under when this week's line is 25%+ higher than his line in his team's previous game.", disc: { rec: "34–13", roi: 36.5, lo: 15.1, hi: 58.3 } },
      { v: "rise3", tg: "Rise 3", lbl: "Rising 3 + raised", side: "under", mk: "player_reception_yds", def: "WR receiving yards Under when his receiving yards rose in each of his last 3 games played and this week's line is higher than last game's (NFL combo C2).", disc: { rec: "26–14", roi: 22.8, lo: -3.0, hi: 48.2 } } ] },
    { id: "qbfade", tile: "QB Fade", opts: [
      { v: "both", tg: "Both", lbl: "Both directions", side: "both", mk: "player_pass_yds", def: "QB passing yards: Under when this week's line is 10%+ higher than his line in his team's previous game; Over when it is 10%+ lower. Found after looking at the data (the NFL version lost), so treat it as a lead.", disc: { rec: "129–79", roi: 17.4, lo: 5.0, hi: 29.7 } },
      { v: "up", tg: "Up", lbl: "Line up 10%+ → Under", side: "under", mk: "player_pass_yds", def: "QB passing yards Under when this week's line is 10%+ higher than his line in his team's previous game.", disc: { rec: "69–43", roi: 16.6, lo: -1.2, hi: 34.3 } },
      { v: "down", tg: "Down", lbl: "Line down 10%+ → Over", side: "over", mk: "player_pass_yds", def: "QB passing yards Over when this week's line is 10%+ lower than his line in his team's previous game.", disc: { rec: "60–36", roi: 18.2, lo: -0.3, hi: 35.9 } } ] },
  ];
  const SG = { sel: "", opt: { bigbeat: "bl50", jump: "up25", qbfade: "both" }, fwd: false, key: "", idx: null };
  // index: every row with its player's team, previous team game and that game's row / result, built once per data load
  function sgIndex() {
    const weeks = weeksList(), key = `${C.games.length}|${C.games.filter((g) => g.status === "final").length}|${weeks.filter((w) => C.weekData[w]).length}`;
    if (SG.key === key && SG.idx) return SG.idx;
    const cnt = new Map();
    for (const g of C.games) for (const t of [g.home_team, g.away_team]) cnt.set(t, (cnt.get(t) || 0) + 1);
    const p4 = new Set([...cnt].filter(([, n]) => n >= 5).map(([t]) => t));
    const tgames = new Map();
    for (const g of C.games.slice().sort((a, b) => a.kickoff.localeCompare(b.kickoff))) for (const t of [g.home_team, g.away_team]) (tgames.get(t) || tgames.set(t, []).get(t)).push(g);
    const all = weeks.flatMap((w) => rowsFor(w)), byGame = new Map(), resBy = new Map(), team = new Map(), aid = new Map();
    for (const r of all) byGame.set(`${r.g.game_id}|${r.mk.id}|${r.key}`, r);
    for (const w of weeks) for (const x of (C.weekData[w] || { results: [] }).results) {
      const k = norm(x.player_name); resBy.set(`${x.game_id}|${k}`, x); team.set(k, x.team_name); aid.set(k, x.athlete_id); // latest week wins
    }
    SG.idx = { p4, tgames, all, byGame, resBy, team, aid };
    SG.key = key;
    return SG.idx;
  }
  // context for one row: team, previous team game, his row and result there, recent receiving yards in games played
  function sgCtx(r) {
    const I = sgIndex(), team = r.team || I.team.get(r.key) || "";
    if (!team || !I.p4.has(team) || !sideOf(r.g, team)) return null;
    const gl = I.tgames.get(team) || [], i = gl.findIndex((g) => g.game_id === r.g.game_id);
    const prior = gl.slice(0, Math.max(i, 0)).filter((g) => g.status === "final");
    if (i < 1 || !prior.length) return null;
    const pg = prior[prior.length - 1], pr = I.byGame.get(`${pg.game_id}|${r.mk.id}|${r.key}`) || null;
    const pres = I.resBy.get(`${pg.game_id}|${r.key}`) || null;
    const played = prior.map((g) => I.resBy.get(`${g.game_id}|${r.key}`)).filter(Boolean);
    const pos = r.pos || C.pos[I.aid.get(r.key)] || "";
    const pl = pr && pr.kind === "pregame" ? Number(pr.main.line) : null; // as in the study: the previous ~1 h line only
    const pact = pl != null && pres && graded(pr) ? pr.act : null;
    return { team, side: sideOf(r.g, team), pos, pg, pr, pl, pact, recy: played.map((x) => (x.rec_yds == null ? 0 : Number(x.rec_yds))) };
  }
  // which side a row bets for a tile + toggle (null = no bet). Frozen 2026-11-27.
  function sgSide(tid, v, r, c) {
    if (!c) return null;
    const L = Number(r.main.line), pl = c.pl, pact = c.pact;
    if (r.mk.id === "player_reception_yds") {
      if (tid === "bigbeat" && v === "bl50") return ["WR", "TE", "RB"].includes(c.pos) && pact != null && pact > pl && pact >= 40 && pact / pl - 1 >= 0.5 && L > pl ? "under" : null;
      if (tid === "bigbeat" && v === "resid") return c.pos === "WR" && pact != null && pact / pl >= 1.5 && pact / pl < 2 ? "under" : null;
      if (tid === "bigbeat" && v === "bg") return ["WR", "TE"].includes(c.pos) && pact != null && pact >= 1.5 * pl && pact >= 40 ? "under" : null;
      if (tid === "jump" && v === "up25") return c.pos === "WR" && pl != null && L / pl - 1 >= 0.25 ? "under" : null;
      if (tid === "jump" && v === "rise3") { const a = c.recy, n = a.length; return c.pos === "WR" && n >= 3 && a[n - 3] < a[n - 2] && a[n - 2] < a[n - 1] && pl != null && L > pl ? "under" : null; }
    }
    if (r.mk.id === "player_pass_yds" && tid === "qbfade" && pl != null) {
      const mv = L / pl - 1;
      if (mv >= 0.10 && v !== "down") return "under";
      if (mv <= -0.10 && v !== "up") return "over";
    }
    return null;
  }
  const sgOpt = (t, v) => t.opts.find((o) => o.v === (v || SG.opt[t.id])) || t.opts[0];
  // every bet for a tile + toggle: { r, c, side, u, out } ; u = units at the saved price (null when the row isn't graded or not ~1 h)
  function sgBets(t, v) {
    const I = sgIndex(), o = sgOpt(t, v), out = [];
    for (const r of I.all) {
      if (r.mk.id !== o.mk) continue;
      const c = sgCtx(r), side = sgSide(t.id, o.v, r, c);
      if (!side) continue;
      const price = side === "over" ? r.main.over_price : r.main.under_price;
      const counts = r.kind === "pregame" && graded(r) && r.main.over_price != null && r.main.under_price != null;
      const res = counts ? (r.outcome === "push" ? "push" : r.outcome === side ? "hit" : "miss") : null;
      out.push({ r, c, side, price, counts, out: res, u: res === "hit" ? payout(price) : res === "miss" ? -1 : res === "push" ? 0 : null });
    }
    return out;
  }
  const sgCurWk = () => { const w = weeksList(); return w.find((x) => C.games.some((g) => g.week === x && g.status !== "final")) ?? w[w.length - 1]; };
  function sgRec(t, v) {
    const bs = sgBets(t, v).filter((b) => b.counts && (!SG.fwd || b.r.wk >= SG_FREEZE_WK));
    const s = tally(bs.map((b) => ({ out: b.out, u: b.u })));
    const first = bs.length ? Math.min(...bs.map((b) => b.r.wk)) : sgCurWk();
    const by = weeksList().filter((w) => w >= (SG.fwd ? SG_FREEZE_WK : first) && w <= sgCurWk()).map((w) => ({ w, list: bs.filter((b) => b.r.wk === w) }));
    return { s, by, bets: bs };
  }
  const sgThisWk = (t, v) => sgBets(t, v).filter((b) => b.r.wk === sgCurWk());
  function sgSpark(by, band) {
    const pts = []; let W = 0, U = 0;
    for (const { w, list } of by) { const s = tally(list); U += s.U; W += s.n; pts.push({ w, n: s.n, roi: s.n ? s.roi : null, cum: W ? (100 * U) / W : null }); }
    if (!pts.some((q) => q.n)) return `<div class="sg-nospark muted small">no graded bets${SG.fwd ? " since the freeze yet" : ""}</div>`;
    const w = 170, h = 70, l = 30, r = 11, tp = 6, bt = 13, n = pts.length, base = h - bt;
    const vals = pts.flatMap((q) => [q.roi, q.cum]).filter((v) => v != null).concat(0, band ? [band.lo, band.hi] : []);
    let mn = Math.min(...vals), mx = Math.max(...vals); if (mx - mn < 20) { mx += 10; mn -= 10; }
    const rg = mx - mn, X = (i) => (n < 2 ? (l + w - r) / 2 : l + (i * (w - l - r)) / (n - 1)), Y = (v) => tp + ((mx - v) / rg) * (base - tp);
    const fmt = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`;
    const ticks = []; let prevY = -99;
    for (const v of [...new Set([mx, 0, mn])].sort((a, b) => b - a)) { if (Y(v) - prevY >= 11) { ticks.push(v); prevY = Y(v); } }
    const every = n > 9 ? 2 : 1, cp = pts.map((q, i) => [i, q]).filter(([, q]) => q.cum != null), last = cp.length ? cp[cp.length - 1][1].cum : 0;
    return `<svg class="sg-spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly ROI and running ROI by week, now ${fmt(last)}${band ? `. Shaded band: 95% interval from the study, ${fmt(band.lo)} to ${fmt(band.hi)}` : ""}">
      <g class="sg-ax"><line x1="${l}" x2="${l}" y1="${tp}" y2="${base}"/><line x1="${l}" x2="${w - r}" y1="${base}" y2="${base}"/>
      ${ticks.map((v) => `<line class="sg-gl" x1="${l}" x2="${w - r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${l - 3}" y="${(Y(v) + 2.8).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${pts.map((q, i) => ((n - 1 - i) % every ? "" : `<text x="${X(i).toFixed(1)}" y="${h - 3}" text-anchor="middle">W${q.w}</text>`)).join("")}</g>
      ${band ? `<rect class="sg-band" x="${l}" y="${Y(band.hi).toFixed(1)}" width="${w - r - l}" height="${Math.max(1, Y(band.lo) - Y(band.hi)).toFixed(1)}"><title>95% interval from the study ${fmt(band.lo)} to ${fmt(band.hi)}</title></rect>${(() => { const yh = Y(band.hi), yl = Y(band.lo), tall = yl - yh >= 17; return `<g class="sg-bl"><text x="${l + 2}" y="${Math.max(tp + 6, tall ? yh + 6.5 : yh - 1.5).toFixed(1)}">${fmt(band.hi)}</text><text x="${l + 2}" y="${Math.min(base - 1.5, tall ? yl - 1.5 : yl + 6.5).toFixed(1)}">${fmt(band.lo)}</text></g>`; })()}` : ""}
      <line x1="${l}" x2="${w - r}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" style="stroke:var(--line)" stroke-dasharray="3 3"/>
      <path d="${cp.map(([i, q], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(q.cum).toFixed(1)}`).join(" ")}" fill="none" style="stroke:var(${last >= 0 ? "--over" : "--under"})" stroke-width="1.6" stroke-linejoin="round"/>
      ${pts.filter((q) => q.n).map((q) => `<circle cx="${X(pts.indexOf(q)).toFixed(1)}" cy="${Y(q.roi).toFixed(1)}" r="2.3" style="fill:var(${q.roi >= 0 ? "--over" : "--under"})"><title>Week ${q.w}: ${fmt(q.roi)} ROI (${q.n} bets) · running ${fmt(q.cum)}</title></circle>`).join("")}</svg>`;
  }
  function sgTile(t) {
    const o = sgOpt(t), st = sgRec(t), s = st.s, on = SG.sel === t.id, cls = s.n ? (s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : "") : "";
    const roi = `<span class="sg-roi ${cls}">${s.n ? `${s.roi > 0 ? "+" : s.roi < 0 ? "−" : ""}${Math.abs(s.roi).toFixed(1)}%` : "—"}</span>`;
    const tg = `<span class="sg-tg" role="group" aria-label="${esc(t.tile)} version">${t.opts.map((x) => `<button type="button" class="${x.v === o.v ? "on" : ""}" data-csgopt="${t.id}:${x.v}">${esc(x.tg)} <span class="sg-n">${sgThisWk(t, x.v).length}</span></button>`).join("")}</span>`;
    return `<div class="sg-cell sg-cell3"><button type="button" class="sg-tile ${on ? "on" : ""}" data-csig="${t.id}" aria-pressed="${on}">
      <div class="sg-hd"><b class="sg-ttl2">${esc(t.tile)}</b>${roi}</div>
      <div class="sg-r2"><span class="small sg-st">${s.n ? recTxt(s) : `<span class="muted">no bets</span>`}<br><span class="sg-wk"><b>${sgThisWk(t).length}</b> this wk</span></span></div>
      ${sgSpark(st.by, SG.fwd ? null : { lo: o.disc.lo, hi: o.disc.hi })}</button>${tg}</div>`;
  }
  // one player row, same markup as the NFL Signals page: name, market, the bet, result when final, why it fired, game
  function sgRow(b, chips) {
    const r = b.r, c = b.c, opp = abbr(r.g, c.side === "home" ? "away" : "home"), L = Number(r.main.line);
    const why = r.mk.id === "player_pass_yds" ? `Line ${num(L)} vs ${num(c.pl)} last game (${sgn(100 * (L / c.pl - 1))}%)`
      : c.pact != null ? `Last game: ${num(c.pact)} yds vs ${num(c.pl)} line` : c.pl != null ? `Line ${num(L)} vs ${num(c.pl)} last game` : "";
    const res = b.counts ? `<span class="pk-res ${b.out}">${b.out === "hit" ? "Hit" : b.out === "miss" ? "Miss" : "Push"} · ${num(r.act)}</span>`
      : r.g.status === "final" && r.act != null ? `<span class="pk-res" title="Graded on the first-posted line, so it is not counted in the record">Act ${num(r.act)} · uncounted</span>` : "";
    const first = r.kind === "first" ? ` · <span title="First-posted line: the line about 1 hour before kickoff wasn't captured, so this bet doesn't count in the record">1st line</span>` : "";
    const meta = `<span class="muted small">${c.pos ? esc(c.pos) + " · " : ""}${esc(abbr(r.g, c.side))} ${c.side === "home" ? "vs" : "@"} ${esc(opp)} · ${r.g.status === "final" ? `Final ${esc(abbr(r.g, "away"))} ${r.g.away_score}–${r.g.home_score} ${esc(abbr(r.g, "home"))}` : esc(fmtKo(r.g.kickoff))}${first}</span>`;
    const ch = chips ? `<span class="sg-chips">${chips}</span>` : "";
    return `<div class="rlrow sg-pr"><div class="rlhead">${pLink(r)}<span class="rlstat">${{ player_pass_yds: "Pass yds", player_rush_yds: "Rush yds", player_reception_yds: "Rec yds" }[r.mk.id]}</span><span class="chip rl-side ${b.side}">${b.side === "over" ? "Over" : "Under"} ${num(L)}</span>${res}</div>
      ${why ? `<div class="sg-m"><span class="small sg-gap">${esc(why)}</span>${ch}</div><div class="sg-m">${meta}</div>` : `<div class="sg-m">${meta}${ch}</div>`}</div>`;
  }
  const SG_SHORT = { bigbeat: "Beat", jump: "Jump", qbfade: "QB Fade" };
  const sgChip = (t, o) => `<span class="chip" role="button" tabindex="0" data-csgopt="${t.id}:${o.v}">${esc(SG_SHORT[t.id])} · ${esc(o.tg)}</span>`;
  function sgPanel(t) {
    const o = sgOpt(t), st = sgRec(t), now = sgThisWk(t), up = now.filter((b) => b.r.g.status !== "final"), done = now.filter((b) => b.r.g.status === "final");
    const d = o.disc, ds = `${d.rec}, ${d.roi > 0 ? "+" : ""}${d.roi}% ROI, 95% interval ${d.lo > 0 ? "+" : ""}${d.lo}% to +${d.hi}%`;
    let h = `<div class="panel sg-pan"><div class="body"><p><b>${esc(t.tile)} · ${esc(o.lbl)}</b> <a href="#" data-csig-clear class="small" style="float:right">Clear</a></p>
      <p class="small">${esc(o.def)}</p>
      <p class="muted small">Frozen 2026-11-27. Study record (weeks 1–12, found on these same games, so it overstates the edge): ${esc(ds)}. Only games from week ${SG_FREEZE_WK} on are a fair test.</p>
      <details><summary><b>Week by week</b> (${st.by.filter((x) => x.list.length).length} weeks)</summary><table class="ctable inner"><thead><tr><th>Wk</th><th class="num">Record</th><th class="num">Units</th></tr></thead><tbody>` +
      st.by.filter((x) => x.list.length).slice().reverse().map((x) => { const s = tally(x.list); return `<tr><td>${x.w}${x.w >= SG_FREEZE_WK ? ` <span class="muted small">fwd</span>` : ""}</td><td class="num">${recTxt(s)}</td><td class="num ${s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : ""}">${unitsTxt(s.U)}</td></tr>`; }).join("") + `</tbody></table></details></div></div>`;
    h += `<h3 class="sg-sec">Players who fit this signal (${up.length})</h3>` + (up.length ? `<div class="panel rlist">${up.map((b) => sgRow(b)).join("")}</div>` : `<p class="muted small">None for week ${sgCurWk()} yet.</p>`);
    if (done.length) h += `<h3 class="sg-sec">Completed this week (${done.length})</h3><p class="muted small">${(() => { const c = done.filter((b) => b.counts), t = tally(c); return c.length ? `${t.W} hit · ${t.L} missed. ` : ""; })()}Graded against the line the signal used; first-posted lines are shown but not counted.</p><div class="panel rlist">${done.map((b) => sgRow(b)).join("")}</div>`;
    return h;
  }
  function signals() {
    const cw = sgCurWk();
    let h = `<div class="sg-ttl"><h2 class="gsec">Signals${SG.fwd ? ` <span class="muted small" style="font-weight:600">· since freeze</span>` : ""}</h2></div>
      <div class="mtabs"><button class="gchip ${SG.fwd ? "" : "on"}" data-csgfwd="0"><b>Season</b></button><button class="gchip ${SG.fwd ? "on" : ""}" data-csgfwd="1"><b>Since freeze</b></button></div>
      <p class="muted small">From the 2026-11-27 CFB study: "big game, line raised, now Under" and the QB line-move fade. Tap a tile for its players; the small buttons pick the version. Week ${cw} is the current week.</p>`;
    const rows = [SGT.slice(0, 2), SGT.slice(2)];
    for (const row of rows) {
      h += `<div class="sg-grid">${row.map(sgTile).join("")}</div>`;
      const sel = row.find((t) => t.id === SG.sel);
      if (sel) h += sgPanel(sel);
    }
    if (!SG.sel) { // every player who fits any version this week, most signals first; completed games listed after
      const m = new Map();
      for (const t of SGT) for (const o of t.opts) for (const b of sgThisWk(t, o.v)) {
        const k = `${b.r.g.game_id}|${b.r.mk.id}|${b.r.key}|${b.side}`;
        const e = m.get(k) || m.set(k, { b, tags: [] }).get(k); e.tags.push(sgChip(t, o));
      }
      const all = [...m.values()].sort((a, b) => b.tags.length - a.tags.length || a.b.r.g.kickoff.localeCompare(b.b.r.g.kickoff) || a.b.r.name.localeCompare(b.b.r.name));
      const up = all.filter((e) => e.b.r.g.status !== "final"), done = all.filter((e) => e.b.r.g.status === "final");
      const PAGE = 25, pages = Math.max(1, Math.ceil(up.length / PAGE)), pg = Math.min(Math.max(SG.pg || 0, 0), pages - 1); SG.pg = pg;
      h += `<h3 class="sg-sec">Players hitting the most signals (${up.length})</h3>` + (up.length ? `<div class="panel rlist">${up.slice(pg * PAGE, pg * PAGE + PAGE).map((e) => sgRow(e.b, e.tags.join(""))).join("")}</div>` +
        (pages > 1 ? `<div class="rl-pager small"><button type="button" class="linkbtn" data-csgpg="-1" ${pg === 0 ? "disabled" : ""}>‹ Prev</button><span class="muted">Page ${pg + 1} of ${pages} · ${pg * PAGE + 1}–${Math.min(up.length, pg * PAGE + PAGE)} of ${up.length}</span><button type="button" class="linkbtn" data-csgpg="1" ${pg === pages - 1 ? "disabled" : ""}>Next ›</button></div>` : "")
        : `<p class="muted small">No upcoming players for week ${cw} yet. Players show up once their lines are posted.</p>`);
      if (done.length) h += `<h3 class="sg-sec">Completed this week (${done.length})</h3><div class="panel rlist">${done.map((e) => sgRow(e.b, e.tags.join(""))).join("")}</div>`;
    }
    return h + `<p class="muted small">Records: 1 unit per bet at the saved price, graded only on lines captured about 1 hour before kickoff (FanDuel first, then other books; there are no DraftKings CFB lines). "1st" = first-posted line: the player is shown, but the bet never counts in a record. Players on Power 4 teams only. Study details: weeks 9–12 for receiving signals, 1–12 for QB Fade; nothing in the study cleared a multiple-testing check. Research tool only.</p>`;
  }

  function view(arg) {
    arg = arg || "board";
    const acc = ACC();
    const head = `<h2 class="c-h">College football · Power 4</h2>`;
    if (!acc) return `<p class="pad">Sign-in didn't load. Try refreshing.</p>`;
    if (!acc.ready()) {
      const g = acc.gate();
      return head + `<p class="callout">College football is for signed-in users 21 and over.</p>` + (g || "");
    }
    if (!C.games && !C.loading && !C.err) setTimeout(start, 0);
    if (C.err) return head + `<p class="pad pk-err">${esc(C.err)} <button id="c-retry">Retry</button></p>`;
    if (!C.games || C.wk == null) return head + (C.games && !C.games.length ? `<p class="muted pad">No college football games collected yet.</p>` : `<p class="muted pad">Loading college football…</p>`);
    const needAll = arg === "results" || arg === "signals" || arg.startsWith("player-");
    if (!C.weekData[C.wk] || (needAll && !allLoaded())) { setTimeout(start, 0); return head + `<p class="muted pad">Loading…</p>`; }
    if (arg.startsWith("player-")) return playerCard(arg.slice(7).replace(/_/g, " "));
    return head + (C.note && arg === "board" ? `<p class="callout">${esc(C.note)}</p>` : "") + (arg === "results" ? results() : arg === "signals" ? signals() : board());
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("c-retry", "click", () => { C.err = ""; start(); rerender(); });
    on("c-wk", "change", (e) => { C.wk = +e.target.value; C.game = ""; C.note = ""; start(); rerender(); });
    document.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", () => { C[{ pos: "rPos", mk: "rMk", wk: "rWk" }[b.dataset.rf]] = b.dataset.v; rerender(); }));
    document.querySelectorAll("[data-cg]").forEach((b) => b.addEventListener("click", () => { C.game = b.dataset.cg; rerender(); }));
    document.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", () => { C.mk = b.dataset.cm; rerender(); }));
    document.querySelectorAll("[data-rb]").forEach((b) => b.addEventListener("click", () => { C.rBy = b.dataset.rb; rerender(); }));
    document.querySelectorAll("[data-pm]").forEach((b) => b.addEventListener("click", () => { C.pMk = b.dataset.pm; rerender(); }));
    document.querySelectorAll("[data-csig]").forEach((b) => b.addEventListener("click", () => { SG.sel = SG.sel === b.dataset.csig ? "" : b.dataset.csig; rerender(); }));
    document.querySelectorAll("[data-csgopt]").forEach((b) => b.addEventListener("click", () => { const [t, v] = b.dataset.csgopt.split(":"); SG.opt[t] = v; SG.sel = t; rerender(); }));
    document.querySelectorAll("[data-csgpg]").forEach((b) => b.addEventListener("click", () => { SG.pg = (SG.pg || 0) + Number(b.dataset.csgpg); rerender(); }));
    document.querySelectorAll("[data-csgfwd]").forEach((b) => b.addEventListener("click", () => { SG.fwd = b.dataset.csgfwd === "1"; rerender(); }));
    document.querySelectorAll("[data-csig-clear]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); SG.sel = ""; rerender(); }));
    on("c-q", "input", (e) => {
      C.q = e.target.value; clearTimeout(bind.t);
      bind.t = setTimeout(() => { rerender(); const el = $("c-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200);
    });
    if (ACC()) ACC().bind();
  }
  // remember which groups are open across redraws (toggle doesn't bubble, so listen in the capture phase)
  document.addEventListener("toggle", (e) => { const d = e.target; if (d && d.classList && d.classList.contains("la-wk") && d.dataset.cwk) { if (d.open) C.open[d.dataset.cwk] = true; else delete C.open[d.dataset.cwk]; } }, true);
  if (ACC()) ACC().onChange(() => {
    if (!ACC().signedIn()) { C.games = null; C.wk = null; C.weekData = {}; C.pos = {}; C.gen++; RC.clear(); DEF.key = ""; SG.key = ""; SG.idx = null; C.err = ""; C.note = ""; }
    rerender();
  });
  window.STIX_CFB = { view, bind, norm, rowsFor, _state: C };
})();
