"use strict";
// Stix college football (Power 4 games only): Board and Results.
// The data lives in the Stix database (not in this public repo) and is readable only by signed-in users who confirmed 21+;
// the database enforces that, this file just asks. Reads the tables made by supabase/011_cfb.sql.
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
  const C = { games: null, wk: null, weekData: {}, loading: false, err: "", mk: "player_pass_yds", q: "", game: "", note: "" };

  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "")
    .replace(/[^a-z ]+/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
  const odds = (v) => (v == null ? "" : v > 0 ? `+${v}` : String(v));
  const num = (v) => (v == null ? "" : Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(1));
  const fmtKo = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  const rerender = () => { if ((location.hash || "").startsWith("#/cfb") && typeof render === "function") render(); };

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

  async function loadGames() {
    C.games = await getAll("/rest/v1/cfb_games?select=*&order=kickoff.asc,game_id.asc");
  }
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
    for (const [k, ls] of groups) {
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
      rows.push({ g, mk, name: main.player_name, team: res ? res.team_name : "", pos: res ? res.pos : "", main, others: books.slice(1), kind, act, outcome });
    }
    rows.sort((a, b) => a.g.kickoff.localeCompare(b.g.kickoff) || a.g.game_id.localeCompare(b.g.game_id) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    return rows;
  }

  async function start() {
    if (C.loading) return;
    C.loading = true; C.err = "";
    try {
      if (!C.games) await loadGames();
      if (C.wk == null && C.games.length) {
        const weeks = [...new Set(C.games.map((g) => g.week).filter((w) => w != null))].sort((a, b) => a - b);
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
    } catch (e) { C.err = `Couldn't load college football data: ${e.message}`; }
    C.loading = false;
    rerender();
  }

  // ---------- views ----------
  function weekBar() {
    const weeks = [...new Set(C.games.map((g) => g.week).filter((w) => w != null))].sort((a, b) => a - b);
    return `<label class="small">Week <select id="c-wk">${weeks.map((w) => `<option value="${w}" ${w === C.wk ? "selected" : ""}>${w}</option>`).join("")}</select></label>`;
  }
  function filters(tab) {
    const gs = C.games.filter((g) => g.week === C.wk);
    const chips = tab === "board" ? `<div class="gamebar" role="group" aria-label="Choose a game"><button class="gchip ${C.game ? "" : "on"}" data-cg=""><b>All games</b><span class="muted small">${gs.length}</span></button>` +
      gs.map((g) => `<button class="gchip ${C.game === g.game_id ? "on" : ""}" data-cg="${esc(g.game_id)}"><b>${esc(g.away_team)} @ ${esc(g.home_team)}</b><span class="muted small">${g.status === "final" ? `Final ${g.away_score}–${g.home_score}` : esc(fmtKo(g.kickoff))}</span></button>`).join("") + `</div>` : "";
    return `<div class="c-bar">${weekBar()} <span class="mtabs">${MK.map((m) => `<button class="gchip ${C.mk === m.id ? "on" : ""}" data-cm="${m.id}"><b>${m.short}</b></button>`).join("")}</span>
      <input id="c-q" type="search" placeholder="Search player or team" value="${esc(C.q)}" autocomplete="off"></div>${chips}`;
  }
  function visible(tab) {
    const q = norm(C.q);
    return rowsFor(C.wk).filter((r) => r.mk.id === C.mk && (!C.game || r.g.game_id === C.game) && (tab !== "results" || (r.g.status === "final" && r.outcome !== "nomatch" && r.outcome !== "")) &&
      (!q || norm(r.name).includes(q) || norm(r.team).includes(q)));
  }
  const resCell = (r) => (r.outcome === "nomatch" ? `<span class="muted small" title="No player with this name in the box score (did not play, or the name is written differently)">no box score match</span>`
    : r.outcome ? `<span class="res ${r.outcome}">${r.outcome}</span>` : `<span class="muted small">${r.g.status === "in" ? "live" : "pending"}</span>`);
  function table(rows, tab) {
    if (!rows.length) return `<p class="muted pad">${tab === "results" ? "No graded lines for this filter yet." : "No lines for this filter yet. Lines are collected starting midweek and again about 1 hour before kickoff."}</p>`;
    let h = `<div class="panel scroll"><table class="dtable"><thead><tr><th>Game</th><th>Player</th><th>Pos</th><th class="num">Line</th><th class="num">Over / Under</th><th>Book</th><th>Other books</th><th class="num">Actual</th><th>Result</th></tr></thead><tbody>`;
    let last = "";
    for (const r of rows) {
      const first = r.g.game_id !== last; last = r.g.game_id;
      h += `<tr class="${first ? "grp" : ""}"><td class="small">${first ? `<b>${esc(r.g.away_team)} @ ${esc(r.g.home_team)}</b><div class="muted">${r.g.status === "final" ? `Final ${r.g.away_score}–${r.g.home_score}` : esc(fmtKo(r.g.kickoff))}</div>` : ""}</td>
        <td><b>${esc(r.name)}</b>${r.team ? `<div class="muted small">${esc(r.team)}</div>` : ""}</td><td>${esc(r.pos) || '<span class="muted">–</span>'}</td>
        <td class="num"><b>${num(r.main.line)}</b>${r.kind === "first" ? ` <span class="chip snapchip" title="First-posted line. The graded line is captured about 1 hour before kickoff.">first</span>` : ""}</td>
        <td class="num">${odds(r.main.over_price)} / ${odds(r.main.under_price)}</td><td class="small">${esc(BOOK[r.main.book] || r.main.book)}</td>
        <td class="small">${r.others.map((o) => `${esc(BOOK[o.book] || o.book)} ${num(o.line)}`).join(" · ")}</td>
        <td class="num">${r.act == null ? '<span class="muted">–</span>' : `<b>${num(r.act)}</b>`}</td><td>${resCell(r)}</td></tr>`;
    }
    return h + `</tbody></table></div>`;
  }
  function summary(rows) {
    const n = rows.length, o = rows.filter((r) => r.outcome === "over").length, u = rows.filter((r) => r.outcome === "under").length, p = n - o - u;
    if (!n) return "";
    return `<p class="callout">${n} graded line${n === 1 ? "" : "s"} · Over ${o} (${Math.round((100 * o) / n)}%) · Under ${u} (${Math.round((100 * u) / n)}%)${p ? ` · Push ${p}` : ""}. Graded on the line captured about 1 hour before kickoff.</p>`;
  }
  function view(arg) {
    const tab = arg === "results" ? "results" : "board";
    const acc = ACC();
    const head = `<h2 class="c-h">College football · Power 4 · passing, rushing and receiving yards</h2>`;
    if (!acc) return `<p class="pad">Sign-in didn't load. Try refreshing.</p>`;
    if (!acc.ready()) {
      const g = acc.gate();
      return head + `<p class="callout">College football is for signed-in users 21 and over.</p>` + (g || "");
    }
    if (!C.games && !C.loading && !C.err) setTimeout(start, 0);
    if (C.err) return head + `<p class="pad pk-err">${esc(C.err)} <button id="c-retry">Retry</button></p>`;
    if (!C.games || C.wk == null) {
      return head + (C.games && !C.games.length ? `<p class="muted pad">No college football games collected yet.</p>` : `<p class="muted pad">Loading college football…</p>`);
    }
    if (!C.weekData[C.wk]) { setTimeout(start, 0); return head + filters(tab) + `<p class="muted pad">Loading week ${C.wk}…</p>`; }
    const rows = visible(tab);
    return head + (C.note ? `<p class="callout">${esc(C.note)}</p>` : "") + filters(tab) + (tab === "results" ? summary(rows) : "") + table(rows, tab) +
      `<p class="muted small">Games with at least one Power 4 team (ACC, Big Ten, Big 12, SEC, Notre Dame). Lines: The Odds API (DraftKings first, then FanDuel; other books listed). Results: ESPN box scores. A player who is in the box score but has no entry for a stat counts as 0 for it. Research tool only.</p>`;
  }
  function bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("c-retry", "click", () => { C.err = ""; start(); rerender(); });
    on("c-wk", "change", (e) => { C.wk = +e.target.value; C.game = ""; C.note = ""; start(); rerender(); });
    document.querySelectorAll("[data-cg]").forEach((b) => b.addEventListener("click", () => { C.game = b.dataset.cg; rerender(); }));
    document.querySelectorAll("[data-cm]").forEach((b) => b.addEventListener("click", () => { C.mk = b.dataset.cm; rerender(); }));
    on("c-q", "input", (e) => {
      C.q = e.target.value; clearTimeout(bind.t);
      bind.t = setTimeout(() => { rerender(); const el = $("c-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 200);
    });
    if (ACC()) ACC().bind();
  }
  if (ACC()) ACC().onChange(() => {
    if (!ACC().signedIn()) { C.games = null; C.wk = null; C.weekData = {}; C.err = ""; C.note = ""; }
    rerender();
  });
  window.STIX_CFB = { view, bind, norm, rowsFor, _state: C };
})();
