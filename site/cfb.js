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
    rWk: "", rMk: "", rPos: "", rBy: "week", rSide: "over", rGame: "", open: {}, pMk: "" };

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
  function betRow(x) {
    const r = x.r, cls = x.out === "hit" ? "la-hit" : x.out === "miss" ? "la-miss" : "la-push";
    return `<div class="rlrow ${cls}"><div class="rlhead"><span class="la-mark" aria-hidden="true">${x.out === "hit" ? "✓" : x.out === "miss" ? "✗" : "–"}</span>${pLink(r)}
      <span class="rlstat">${esc(r.mk.short)}</span><span class="rlsize">${x.out === "push" ? "push" : unitsTxt(x.u)}</span></div>
      <div class="muted small">${r.pos ? esc(r.pos) + " · " : ""}${esc(teamAbbr(r))} ${r.side === "home" ? "vs" : "@"} ${esc(abbr(r.g, r.side === "home" ? "away" : "home"))} · wk ${r.wk}</div>
      <div class="rlcells"><span><span class="muted small">${x.side === "over" ? "Over" : "Under"}</span> <b>${num(r.main.line)}</b> <span class="muted small">${odds(x.odds)}</span></span><span><span class="muted small">Actual</span> <b>${num(r.act)}</b></span></div></div>`;
  }
  const sectionRows = (list, k, title) => {
    const g = list.filter((x) => x.out === k).sort((a, b) => a.r.g.kickoff.localeCompare(b.r.g.kickoff) || a.r.name.localeCompare(b.r.name));
    return g.length ? `<h3 class="la-h ${k}">${title} (${g.length})</h3><div class="panel rlist">${g.map(betRow).join("")}</div>` : "";
  };
  function results() {
    const weeks = weeksList();
    const base = resultRows(false), list = bets(base, C.rSide), s = tally(list);
    const gamesInWeek = C.rWk === "" ? [] : C.games.filter((g) => g.week === +C.rWk && g.status === "final");
    if (C.rGame && !gamesInWeek.some((g) => g.game_id === C.rGame)) C.rGame = "";
    const pos = [...new Set(weeks.flatMap((w) => rowsFor(w)).filter(graded).map((r) => r.pos).filter(Boolean))].sort();
    const opt = (v, cur, l) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
    let h = `<div class="c-bar"><label class="small">Bet <select id="c-rside">${opt("over", C.rSide, "All Over")}${opt("under", C.rSide, "All Under")}</select></label>
      <label class="small">Stat <select id="c-rmk">${opt("", C.rMk, "All stats")}${MK.map((m) => opt(m.id, C.rMk, m.label)).join("")}</select></label>
      <label class="small">Pos <select id="c-rpos">${opt("", C.rPos, "All")}${pos.map((p) => opt(p, C.rPos, p)).join("")}</select></label>
      <label class="small">Week <select id="c-rwk">${opt("", C.rWk, "All weeks")}${weeks.map((w) => opt(w, C.rWk, `Week ${w}`)).join("")}</select></label>
      <label class="small">Game <select id="c-rgame" ${C.rWk === "" ? "disabled" : ""}>${opt("", C.rGame, "All games")}${gamesInWeek.map((g) => opt(g.game_id, C.rGame, matchup(g))).join("")}</select></label>${searchBox}</div>`;
    if (!base.length) return h + `<p class="muted pad">No graded lines for these filters yet.</p>` + foot;
    const scope = C.rWk === "" ? (() => { const w = base.map((r) => r.wk); const a = Math.min(...w), z = Math.max(...w); return a === z ? `Week ${a}` : `All weeks (${a}–${z})`; })() : C.rGame ? matchup(C.games.find((g) => g.game_id === C.rGame)) : `Week ${C.rWk}`;
    h += `<p class="callout small"><b>1 unit on every graded line, all ${C.rSide === "over" ? "Over" : "Under"}</b>, at the saved odds. Switch Bet to see the other side. This is a record of what blindly betting each side would have done, not a recommendation.</p>
      <div class="la-sum"><div><span class="muted small">${esc(scope)}</span><b>${recTxt(s)}</b></div><div><span class="muted small">Hit rate</span><b>${s.hit == null ? "—" : s.hit.toFixed(1) + "%"}</b></div><div><span class="muted small">Units</span><b class="${s.U > 0 ? "la-pos" : s.U < 0 ? "la-neg" : ""}">${s.n ? unitsTxt(s.U) : "—"}</b></div><div><span class="muted small">ROI</span><b class="${s.roi > 0 ? "la-pos" : s.roi < 0 ? "la-neg" : ""}">${roiTxt(s.roi)}</b></div></div>`;
    // both sides side by side; tap one to switch
    const so = tally(bets(base, "over")), su = tally(bets(base, "under"));
    h += `<div class="panel la-games">` + [["over", "All Over", so], ["under", "All Under", su]].map(([k, l, t]) =>
      `<button type="button" class="la-game ${C.rSide === k ? "on" : ""}" data-rside="${k}"><span>${l}</span><span class="muted small">${recTxt(t)} · ${t.n ? unitsTxt(t.U) : "—"} · ROI ${roiTxt(t.roi)}</span><span class="muted">›</span></button>`).join("") + `</div>`;
    if (!list.length) return h + `<p class="muted pad">None of these lines has both Over and Under odds saved, so none can be scored.</p>` + foot;
    const opts = [["week", "Week"], ["game", "Game"], ["team", "Team"], ["player", "Player"]].concat(C.rMk === "" ? [["stat", "Stat"]] : []);
    const by = opts.some(([k]) => k === C.rBy) ? C.rBy : "week";
    h += `<div class="c-bar"><span class="small muted">Group by</span><span class="mtabs">${opts.map(([k, l]) => `<button class="gchip ${by === k ? "on" : ""}" data-rb="${k}"><b>${l}</b></button>`).join("")}</span></div>`;
    const keyOf = { week: (x) => `Week ${x.r.wk}`, game: (x) => `${matchup(x.r.g)} (wk ${x.r.wk})`, team: (x) => teamSchool(x.r) || "(unknown team)", player: (x) => x.r.name, stat: (x) => x.r.mk.label }[by];
    const groups = new Map();
    for (const x of list) (groups.get(keyOf(x)) || groups.set(keyOf(x), []).get(keyOf(x))).push(x);
    const arr = [...groups].map(([k, xs]) => ({ k, xs, t: tally(xs) }));
    arr.sort(by === "week" ? (a, b) => b.xs[0].r.wk - a.xs[0].r.wk : (a, b) => b.t.U - a.t.U || b.t.n - a.t.n || a.k.localeCompare(b.k));
    h += arr.map(({ k, xs, t }) => {
      const id = `${by}|${k}`, sorted = xs;
      return `<details class="la-wk" data-cwk="${esc(id)}" ${C.open[id] ? "open" : ""}><summary><span class="la-wk-t">${esc(k)}</span><span class="muted small">${recTxt(t)}${t.hit == null ? "" : ` · ${t.hit.toFixed(1)}%`} · ${t.n ? unitsTxt(t.U) : "push"}${t.roi == null ? "" : ` · ROI ${roiTxt(t.roi)}`}</span></summary>
        ${sectionRows(sorted, "hit", "Hits")}${sectionRows(sorted, "miss", "Misses")}${sectionRows(sorted, "push", "Pushes")}</details>`;
    }).join("");
    return h + `<p class="muted small">Graded on the line captured about 1 hour before kickoff at its saved odds (DraftKings first, then FanDuel), 1 unit per bet; lines without both prices saved are left out. A player in the box score with no entry for a stat counts as 0 for it. Research tool only.</p>`;
  }

  // ---------- Player card ----------
  function playerCard(key) {
    const back = `<p class="small"><a href="#/cfb/board">← Board</a> · <a href="#/cfb/results">Results</a></p>`;
    const all = weeksList().flatMap((w) => rowsFor(w)).filter((r) => r.key === key);
    if (!all.length) return back + `<p class="muted pad">No lines found for this player.</p>`;
    const mks = MK.filter((m) => all.some((r) => r.mk.id === m.id));
    const mid = mks.some((m) => m.id === C.pMk) ? C.pMk : mks[0].id;
    const rs = all.filter((r) => r.mk.id === mid).sort((a, b) => a.g.kickoff.localeCompare(b.g.kickoff));
    const latest = all.slice().sort((a, b) => b.g.kickoff.localeCompare(a.g.kickoff))[0];
    const gr = rs.filter(graded), t = tally(gr);
    const mkObj = MK.find((m) => m.id === mid);
    const avgAct = gr.length ? gr.reduce((s, r) => s + r.act, 0) / gr.length : null, avgLine = rs.reduce((s, r) => s + Number(r.main.line), 0) / rs.length;
    let h = back + `<div class="ph"><h2>${esc(latest.name)}</h2><span class="chip">${esc(teamSchool(latest) || "–")}${latest.pos ? ` · ${esc(latest.pos)}` : ""}</span></div>
      <div class="mtabs">${mks.map((m) => `<button data-pm="${m.id}" class="${m.id === mid ? "on" : ""}">${esc(m.label)}</button>`).join("")}</div>
      <div class="c-sum"><div><b>${rs.length}</b><span>games with a line</span></div><div><b>${num(avgLine)}</b><span>avg line</span></div>${gr.length ? `<div><b>${num(avgAct)}</b><span>avg actual</span></div><div class="over"><b>${t.o}</b><span>Over</span></div><div class="under"><b>${t.u}</b><span>Under</span></div>` : ""}</div>`;
    h += `<div class="panel"><div class="chart">${chart(rs)}</div><div class="legend"><span><i style="border-color:var(--accent)"></i>Actual</span><span><i style="border-color:var(--ink);border-top-width:3px"></i>Line (green = over hit, red = under)</span></div></div>`;
    h += `<div class="panel"><table class="ctable"><thead><tr><th>Wk</th><th>Opp</th><th class="num">Line</th><th class="num">Over / Under</th><th class="num">Act</th><th>Result</th></tr></thead><tbody>` +
      rs.map((r) => `<tr><td>${r.wk}</td><td>${r.side ? (r.side === "home" ? "vs " : "@ ") + esc(abbr(r.g, r.side === "home" ? "away" : "home")) : esc(matchup(r.g))}</td>
        <td class="num"><b>${num(r.main.line)}</b>${r.kind === "first" ? ` <span class="chip snapchip" title="First-posted line; graded line not captured yet">1st</span>` : ""}</td><td class="num small">${odds(r.main.over_price)} / ${odds(r.main.under_price)}</td>
        <td class="num">${r.act == null ? '<span class="muted">–</span>' : `<b>${num(r.act)}</b>`}</td><td>${resCell(r)}</td></tr>`).join("") + `</tbody></table></div>`;
    // Every book's line for each game (the "other books" box, like the NFL side)
    h += `<div class="panel"><h3>${esc(mkObj.label)}: lines by book</h3><div class="body">` + rs.slice().reverse().map((r, i) =>
      `<details ${i === 0 ? "open" : ""}><summary class="small"><b>Week ${r.wk}</b> ${esc(matchup(r.g))} <span class="muted">· ${r.kind === "first" ? "first-posted lines" : "~1 h before kickoff"}</span></summary>
      <table class="ctable inner"><thead><tr><th>Book</th><th class="num">Line</th><th class="num">Over</th><th class="num">Under</th></tr></thead><tbody>` +
      r.books.map((b) => `<tr><td>${esc(BOOK[b.book] || b.book)}</td><td class="num"><b>${num(b.line)}</b></td><td class="num">${odds(b.over_price)}</td><td class="num">${odds(b.under_price)}</td></tr>`).join("") + `</tbody></table></details>`).join("") + `</div></div>`;
    return h + foot;
  }
  function chart(rs) {
    const W = 600, H = 170, pad = 28, n = rs.length;
    const vals = rs.flatMap((r) => [Number(r.main.line), r.act].filter((v) => v != null));
    const max = Math.max(...vals, 10) * 1.15, y = (v) => H - pad - ((H - 2 * pad) * v) / max, bw = Math.min(60, (W - 2 * pad) / n / 1.6);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Actual vs line by game"><line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--line)"/>`;
    rs.forEach((r, i) => {
      const cx = pad + ((W - 2 * pad) * (i + 0.5)) / n, line = Number(r.main.line);
      if (r.act != null) s += `<rect x="${cx - bw / 2}" y="${y(r.act)}" width="${bw}" height="${H - pad - y(r.act)}" fill="var(--accent)" opacity=".55"/><text x="${cx}" y="${y(r.act) - 4}" text-anchor="middle" font-size="11" fill="var(--ink)">${num(r.act)}</text>`;
      const col = r.outcome === "over" ? "var(--over)" : r.outcome === "under" ? "var(--under)" : "var(--ink)";
      s += `<line x1="${cx - bw / 1.2}" y1="${y(line)}" x2="${cx + bw / 1.2}" y2="${y(line)}" stroke="${col}" stroke-width="3"/>`;
      s += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted)">Wk ${r.wk}</text>`;
    });
    return s + `</svg>`;
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
    on("c-rside", "change", (e) => { C.rSide = e.target.value; rerender(); });
    on("c-rmk", "change", (e) => { C.rMk = e.target.value; rerender(); });
    on("c-rgame", "change", (e) => { C.rGame = e.target.value; rerender(); });
    document.querySelectorAll("[data-rside]").forEach((b) => b.addEventListener("click", () => { C.rSide = b.dataset.rside; rerender(); }));
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
