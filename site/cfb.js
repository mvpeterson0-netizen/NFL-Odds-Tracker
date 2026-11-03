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
    rWk: "", rMk: "", rPos: "", rBy: "week", rGame: "", open: {}, pMk: "" };

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
  async function loadWeek(wk) {
    if (C.weekData[wk]) return C.weekData[wk];
    const ids = C.games.filter((g) => g.week === wk).map((g) => g.game_id);
    const d = { lines: [], results: [] };
    if (ids.length) {
      d.lines = await getAll(`/rest/v1/cfb_lines?select=game_id,pull_type,captured_utc,book,market,player_name,line,over_price,under_price&game_id=in.${inList(ids)}&order=id.asc`);
      d.results = await getAll(`/rest/v1/cfb_results?select=game_id,athlete_id,player_name,team_name,pass_att,pass_yds,rush_att,rush_yds,rec,rec_yds&game_id=in.${inList(ids)}&order=game_id.asc,athlete_id.asc`);
      const aids = [...new Set(d.results.map((r) => r.athlete_id))], pos = {};
      for (let i = 0; i < aids.length; i += 150) {
        for (const p of await getAll(`/rest/v1/cfb_players?select=athlete_id,pos&athlete_id=in.${inList(aids.slice(i, i + 150))}&order=athlete_id.asc`)) pos[p.athlete_id] = p.pos;
      }
      d.results.forEach((r) => (r.pos = pos[r.athlete_id] || ""));
    }
    C.weekData[wk] = d;
    return d;
  }
  async function loadAllWeeks() { for (const w of weeksList()) await loadWeek(w); }
  const allLoaded = () => !!C.games && weeksList().every((w) => C.weekData[w]);

  // One row per game + market + player: the graded (~1 h before kickoff) line if captured, else the latest line showing.
  function rowsFor(wk) {
    const d = C.weekData[wk]; if (!d) return [];
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
      if (/^#\/cfb\/(results|player-)/.test(location.hash || "")) await loadAllWeeks();
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
    const q = norm(C.q), out = [];
    for (const w of weeksList()) {
      if (C.rWk !== "" && w !== +C.rWk) continue;
      for (const r of rowsFor(w)) {
        if (!graded(r) || (C.rMk && r.mk.id !== C.rMk) || (C.rPos && r.pos !== C.rPos)) continue;
        if (!skipGame && C.rGame && r.g.game_id !== C.rGame) continue;
        if (q && !(r.key.includes(q) || norm(teamSchool(r)).includes(q) || norm(teamAbbr(r)).includes(q))) continue;
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
    const base = resultRows(false);
    const gamesInWeek = C.rWk === "" ? [] : C.games.filter((g) => g.week === +C.rWk && g.status === "final");
    if (C.rGame && !gamesInWeek.some((g) => g.game_id === C.rGame)) C.rGame = "";
    const pos = [...new Set(weeks.flatMap((w) => rowsFor(w)).filter(graded).map((r) => r.pos).filter(Boolean))].sort();
    const opt = (v, cur, l) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
    let h = `<div class="c-bar">
      <label class="small">Stat <select id="c-rmk">${opt("", C.rMk, "All stats")}${MK.map((m) => opt(m.id, C.rMk, m.label)).join("")}</select></label>
      <label class="small">Pos <select id="c-rpos">${opt("", C.rPos, "All")}${pos.map((p) => opt(p, C.rPos, p)).join("")}</select></label>
      <label class="small">Week <select id="c-rwk">${opt("", C.rWk, "All weeks")}${weeks.map((w) => opt(w, C.rWk, `Week ${w}`)).join("")}</select></label>
      <label class="small">Game <select id="c-rgame" ${C.rWk === "" ? "disabled" : ""}>${opt("", C.rGame, "All games")}${gamesInWeek.map((g) => opt(g.game_id, C.rGame, matchup(g))).join("")}</select></label>${searchBox}</div>`;
    if (!base.length) return h + `<p class="muted pad">No graded lines for these filters yet.</p>` + foot;
    const n = base.length, o = base.filter((r) => r.outcome === "over").length, u = base.filter((r) => r.outcome === "under").length, p = n - o - u;
    const to = tally(bets(base, "over")), tu = tally(bets(base, "under"));
    const cls = (t) => (t.U > 0 ? "la-pos" : t.U < 0 ? "la-neg" : "");
    h += `<div class="la-sum c3"><div><span class="muted small">Graded lines</span><b>${n}</b><span class="muted small">${p ? `${p} push${p === 1 ? "" : "es"}` : "no pushes"}</span></div>
      <div><span class="muted small">Over finished</span><b>${o} · ${pct(o, n)}</b><span class="small ${cls(to)}">1 u on each: ${sideTxt(to)}</span></div>
      <div><span class="muted small">Under finished</span><b>${u} · ${pct(u, n)}</b><span class="small ${cls(tu)}">1 u on each: ${sideTxt(tu)}</span></div></div>`;
    const opts = [["week", "Week"], ["game", "Game"], ["team", "Team"], ["player", "Player"]].concat(C.rMk === "" ? [["stat", "Stat"]] : []);
    const by = opts.some(([k]) => k === C.rBy) ? C.rBy : "week";
    h += `<div class="c-bar"><span class="small muted">Group by</span><span class="mtabs">${opts.map(([k, l]) => `<button class="gchip ${by === k ? "on" : ""}" data-rb="${k}"><b>${l}</b></button>`).join("")}</span></div>`;
    const keyOf = { week: (x) => `Week ${x.r.wk}`, game: (x) => `${matchup(x.r.g)} (wk ${x.r.wk})`, team: (x) => teamSchool(x.r) || "(unknown team)", player: (x) => x.r.name, stat: (x) => x.r.mk.label }[by];
    const groups = new Map(), xsAll = lineRows(base);
    for (const x of xsAll) (groups.get(keyOf(x)) || groups.set(keyOf(x), []).get(keyOf(x))).push(x);
    const arr = [...groups].map(([k, xs]) => ({ k, xs, n: xs.length, o: xs.filter((x) => x.r.outcome === "over").length, u: xs.filter((x) => x.r.outcome === "under").length }));
    arr.sort(by === "week" ? (a, b) => b.xs[0].r.wk - a.xs[0].r.wk : (a, b) => b.n - a.n || a.k.localeCompare(b.k));
    h += arr.map(({ k, xs, n: gn, o: go, u: gu }) => {
      const id = `${by}|${k}`;
      return `<details class="la-wk" data-cwk="${esc(id)}" ${C.open[id] ? "open" : ""}><summary><span class="la-wk-t">${esc(k)}</span><span class="muted small">${gn} · <span class="over">${go} Over</span> · <span class="under">${gu} Under</span>${gn - go - gu ? ` · ${gn - go - gu} push` : ""}</span></summary>
        ${sectionRows(xs, "over", "Over")}${sectionRows(xs, "under", "Under")}${sectionRows(xs, "push", "Pushes")}</details>`;
    }).join("");
    return h + `<p class="muted small">Graded on the line captured about 1 hour before kickoff (DraftKings first, then FanDuel). "1 u on each" is what 1 unit on every line's Over (or Under) would have returned at the saved odds; lines without both prices saved are left out of those two figures only. A player in the box score with no entry for a stat counts as 0 for it. Research tool only.</p>`;
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
    const rs = all.filter((r) => r.mk.id === mid).sort((a, b) => a.g.kickoff.localeCompare(b.g.kickoff));
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
    const needAll = arg === "results" || arg.startsWith("player-");
    if (!C.weekData[C.wk] || (needAll && !allLoaded())) { setTimeout(start, 0); return head + `<p class="muted pad">Loading…</p>`; }
    if (arg.startsWith("player-")) return playerCard(arg.slice(7).replace(/_/g, " "));
    return head + (C.note && arg === "board" ? `<p class="callout">${esc(C.note)}</p>` : "") + (arg === "results" ? results() : board());
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("c-retry", "click", () => { C.err = ""; start(); rerender(); });
    on("c-wk", "change", (e) => { C.wk = +e.target.value; C.game = ""; C.note = ""; start(); rerender(); });
    on("c-rwk", "change", (e) => { C.rWk = e.target.value; C.rGame = ""; rerender(); });
    on("c-rmk", "change", (e) => { C.rMk = e.target.value; rerender(); });
    on("c-rgame", "change", (e) => { C.rGame = e.target.value; rerender(); });
    on("c-rpos", "change", (e) => { C.rPos = e.target.value; rerender(); });
    document.querySelectorAll("[data-cg]").forEach((b) => b.addEventListener("click", () => { C.game = b.dataset.cg; rerender(); }));
    document.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", () => { C.mk = b.dataset.cm; rerender(); }));
    document.querySelectorAll("[data-rb]").forEach((b) => b.addEventListener("click", () => { C.rBy = b.dataset.rb; rerender(); }));
    document.querySelectorAll("[data-pm]").forEach((b) => b.addEventListener("click", () => { C.pMk = b.dataset.pm; rerender(); }));
    on("c-q", "input", (e) => {
      C.q = e.target.value; clearTimeout(bind.t);
      bind.t = setTimeout(() => { rerender(); const el = $("c-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200);
    });
    if (ACC()) ACC().bind();
  }
  // remember which groups are open across redraws (toggle doesn't bubble, so listen in the capture phase)
  document.addEventListener("toggle", (e) => { const d = e.target; if (d && d.classList && d.classList.contains("la-wk") && d.dataset.cwk) { if (d.open) C.open[d.dataset.cwk] = true; else delete C.open[d.dataset.cwk]; } }, true);
  if (ACC()) ACC().onChange(() => {
    if (!ACC().signedIn()) { C.games = null; C.wk = null; C.weekData = {}; C.err = ""; C.note = ""; }
    rerender();
  });
  window.STIX_CFB = { view, bind, norm, rowsFor, _state: C };
})();
