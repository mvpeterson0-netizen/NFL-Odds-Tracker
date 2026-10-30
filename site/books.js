"use strict";
// Other books (2026-10-29): every book's line from each upcoming game's latest multi-book pull (data.json "books",
// built from data/other_books + the DraftKings/FanDuel rows of the same pull). Display only: grading, Research rules
// and My picks still use DraftKings/FanDuel. Two views: a "Lines at other books" box on player pages (best Over, best
// Under, consensus) and the Arbitrage tab (#/arb).
(function () {
  const BOOKS = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", williamhill_us: "Caesars", fanatics: "Fanatics",
    betrivers: "BetRivers", espnbet: "theScore Bet", hardrockbet: "Hard Rock", ballybet: "Bally Bet", fliff: "Fliff" };
  const bname = (b) => BOOKS[b] || b;
  const LS_OFF = "stix_arb_off"; // books the viewer switched off on the Arbitrage tab (this browser only)
  const A = { mk: "", off: (() => { try { const v = JSON.parse(localStorage.getItem(LS_OFF) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } })() };
  const dec = (o) => (o == null ? null : o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  const sg = (v) => (v > 0 ? `+${v}` : String(v));
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const started = (gid) => { const g = D.games[gid]; return !g || new Date(g.ko) <= new Date(); };
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  // [book, line, over, under] rows for a player/market in an upcoming game, or null.
  function rowsFor(pid, mid) {
    for (const [gid, g] of Object.entries(D.books || {})) {
      const r = ((g.p || {})[pid] || {})[mid];
      if (r && r.length && !started(gid)) return { gid, cap: g.cap, rows: r };
    }
    return null;
  }

  // ---------- player page box ----------
  function box(pid, mid) {
    const x = rowsFor(pid, mid);
    if (!x || x.rows.length < 2) return "";
    const withO = x.rows.filter((r) => r[2] != null), withU = x.rows.filter((r) => r[3] != null);
    const bestO = [...withO].sort((a, b) => a[1] - b[1] || dec(b[2]) - dec(a[2]))[0];
    const bestU = [...withU].sort((a, b) => b[1] - a[1] || dec(b[3]) - dec(a[3]))[0];
    const cons = median(x.rows.map((r) => r[1]));
    const rows = [...x.rows].sort((a, b) => a[1] - b[1] || bname(a[0]).localeCompare(bname(b[0])));
    const cell = (r, side) => {
      const p = r[side === "o" ? 2 : 3]; if (p == null) return `<td class="muted">—</td>`;
      const best = side === "o" ? r === bestO : r === bestU;
      return `<td class="${best ? "bk-best" : ""}">${sg(p)}${best ? " ★" : ""}</td>`;
    };
    return `<div class="bkbox"><div class="bk-h"><b>Lines at other books</b><span class="muted small">${x.rows.length} books · ${fmtTime(x.cap)}</span></div>
      <div class="bk-sum small">Best Over <b>${num(bestO[1])}</b> ${esc(bname(bestO[0]))} ${sg(bestO[2])} · Best Under <b>${num(bestU[1])}</b> ${esc(bname(bestU[0]))} ${sg(bestU[3])} · Consensus <b>${num(cons)}</b></div>
      <details><summary class="small">All ${x.rows.length} books</summary><table class="bk-t small"><thead><tr><th>Book</th><th>Line</th><th>Over</th><th>Under</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(bname(r[0]))}</td><td>${num(r[1])}</td>${cell(r, "o")}${cell(r, "u")}</tr>`).join("")}</tbody></table></details></div>`;
  }

  // ---------- Arbitrage tab ----------
  // For each player/stat: the best pair of Over at one book and Under at another (Over line <= Under line, same pull).
  // Stakes split so both sides pay the same: return = 1 / (1/dOver + 1/dUnder) - 1 of the total stake, whichever side wins.
  // If the Over line is lower than the Under line, both can win (a "middle"); the return is then at least that.
  function compute() {
    const out = [];
    for (const [gid, g] of Object.entries(D.books || {})) {
      if (started(gid)) continue;
      for (const [pid, ms] of Object.entries(g.p || {})) {
        for (const [mid, rows] of Object.entries(ms)) {
          if (A.mk && mid !== A.mk) continue;
          const rs = rows.filter((r) => !A.off.includes(r[0]));
          let best = null;
          for (const o of rs) for (const u of rs) {
            if (o[0] === u[0] || o[2] == null || u[3] == null || o[1] > u[1]) continue;
            const S = 1 / dec(o[2]) + 1 / dec(u[3]), ret = 1 / S - 1, both = u[1] > o[1] ? 2 / S - 1 : null;
            const c = { gid, pid, mid, cap: g.cap, o, u, S, ret, both };
            if (!best || ret > best.ret + 1e-9 || (Math.abs(ret - best.ret) < 1e-9 && u[1] - o[1] > best.u[1] - best.o[1])) best = c;
          }
          if (best) out.push(best);
        }
      }
    }
    return out.sort((a, b) => b.ret - a.ret || (b.u[1] - b.o[1]) - (a.u[1] - a.o[1]));
  }
  // Profit on $100 total, rounded to cents (so 0.00% from rounding never counts as a guaranteed profit).
  const cents = (v) => Math.round(v * 10000) / 100;
  const pct = (v) => { const c = cents(v); return `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c).toFixed(2)}%`; };
  const usd = (v) => { const c = cents(v); return `${c > 0 ? "+" : c < 0 ? "−" : ""}$${Math.abs(c).toFixed(2)}`; };
  function row(x) {
    const p = (D.players || []).find((q) => q.id === x.pid), g = D.games[x.gid];
    const name = p ? p.name : x.pid, team = p ? p.team : "";
    const so = 100 / dec(x.o[2]) / x.S, su = 100 / dec(x.u[3]) / x.S;
    const mk = (D.markets.find((m) => m.id === x.mid) || {}).label || x.mid;
    const ev = x.both != null ? `≥ ${pct(x.ret)}` : pct(x.ret);
    return `<div class="rlrow arbrow"><div class="rlhead"><a class="pname" href="#/player/${esc(x.pid)}">${esc(name)}</a> <span class="rlstat">${esc(mk)}</span>
        <span class="arb-ev ${cents(x.ret) > 0 ? "pos" : "neg"}">${ev}</span></div>
      <div class="muted small">${esc(team)} · ${esc(gameLabel(x.gid))} · ${fmtTime(g.ko)} · lines ${ago(x.cap)}</div>
      <div class="arb-legs small"><span>Over <b>${num(x.o[1])}</b> ${esc(bname(x.o[0]))} ${sg(x.o[2])} · bet <b>$${so.toFixed(2)}</b></span>
        <span>Under <b>${num(x.u[1])}</b> ${esc(bname(x.u[0]))} ${sg(x.u[3])} · bet <b>$${su.toFixed(2)}</b></span></div>
      <div class="small">If both bet ($100 total): <b>${usd(x.ret)}</b> whichever side wins${x.both != null ? ` · both win (<b>${usd(x.both)}</b>) if he lands between ${num(x.o[1])} and ${num(x.u[1])}` : ""}</div></div>`;
  }
  function view() {
    const bks = D.books || {}, any = Object.keys(bks).some((gid) => !started(gid));
    let h = `<section class="pad arb"><h2 class="gsec">Arbitrage</h2>
      <p class="muted small">Best Over at one book and Under at another, from the same pull. "If both bet" splits $100 so either side pays the same. Lines move: check both books before betting.</p>`;
    if (!any) return h + `<p class="muted">No lines from other books for upcoming games yet. They arrive with each game's next line check.</p></section>`;
    const seen = new Set(); for (const g of Object.values(bks)) for (const ms of Object.values(g.p || {})) for (const rows of Object.values(ms)) for (const r of rows) seen.add(r[0]);
    h += `<div class="arb-books">${[...seen].sort((a, b) => bname(a).localeCompare(bname(b))).map((b) => `<button type="button" class="gchip ${A.off.includes(b) ? "" : "on"}" data-arbbook="${esc(b)}">${esc(bname(b))}</button>`).join("")}</div>
      <div class="filters"><label>Stat <select id="arb-mk"><option value="">All stats</option>${D.markets.map((m) => `<option value="${m.id}" ${m.id === A.mk ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label></div>`;
    const list = compute(), arbs = list.filter((x) => cents(x.ret) > 0), near = list.filter((x) => cents(x.ret) <= 0).slice(0, 15);
    h += `<h3 class="small">Guaranteed profit (${arbs.length})</h3>`;
    h += arbs.length ? `<div class="panel rlist">${arbs.slice(0, 40).map(row).join("")}</div>` : `<p class="muted small">None right now with these books.</p>`;
    if (near.length) h += `<h3 class="small">Closest (break-even or a small loss)</h3><div class="panel rlist">${near.map(row).join("")}</div>`;
    return h + `</section>`;
  }
  function bind() {
    document.querySelectorAll("[data-arbbook]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.arbbook;
      A.off = A.off.includes(k) ? A.off.filter((x) => x !== k) : A.off.concat(k);
      try { localStorage.setItem(LS_OFF, JSON.stringify(A.off)); } catch (e) { /* this browser only */ }
      render();
    }));
    const s = document.getElementById("arb-mk"); if (s) s.addEventListener("change", (e) => { A.mk = e.target.value; render(); });
  }
  window.STIX_BOOKS = { box: (pid, mid) => { try { return box(pid, mid); } catch (e) { console.error("books box failed", e); return ""; } }, view, bind, compute };
})();
