"use strict";
// Other books (2026-10-29): every book's line from each upcoming game's latest multi-book pull (data.json "books",
// built from data/other_books + the DraftKings/FanDuel rows of the same pull). Display only: grading, Research rules
// and My picks still use DraftKings/FanDuel. Two views: a "Lines at other books" box on player pages (best Over, best
// Under, consensus) and the Arbitrage tab (#/arb).
(function () {
  const BOOKS = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", williamhill_us: "Caesars", fanatics: "Fanatics",
    betrivers: "BetRivers", espnbet: "theScore Bet", hardrockbet: "Hard Rock", ballybet: "Bally Bet", fliff: "Fliff", novig: "Novig" };
  const bname = (b) => BOOKS[b] || b;
  const LS_OFF = "stix_arb_off"; // books the viewer switched off on the Arbitrage tab (this browser only)
  const LS_MID = "stix_arb_mid"; // minimum middle size (% of the line) chosen on the Arbitrage tab (this browser only)
  const MID_OPTS = [3, 5, 8, 10, 15], MID_DEFAULT = 8;
  const MID_WORST_PRICE = -120; // Middles only use legs priced -120 or better (Michael 2026-11-23): a wider gap bought with a heavy-juice alt line (e.g. -450) is not a real middle
  const LS_EDGE = "stix_arb_edge"; // "only middles whose estimated hit chance beats break-even" (this browser only; default on)
  const A = { mk: "", edge: (() => { try { return localStorage.getItem(LS_EDGE) !== "0"; } catch (e) { return true; } })(), mid: (() => { try { const v = Number(localStorage.getItem(LS_MID)); return MID_OPTS.includes(v) ? v : MID_DEFAULT; } catch (e) { return MID_DEFAULT; } })(), off: (() => { try { const v = JSON.parse(localStorage.getItem(LS_OFF) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } })() };
  const dec = (o) => (o == null ? null : o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  const sg = (v) => (v > 0 ? `+${v}` : String(v));
  // Novig is an exchange: its American price is shown first, with the contract price in cents in parentheses, e.g. "-113 (53¢)"
  // (the American price converted back: probability x 100). Novig's fee schedule (support.novig.com "Fees on Novig", dated
  // 2026-10-15) charges no fee on pregame straight trades, maker or taker, and Stix only shows pregame lines, so the price
  // shown is the all-in price; the fee applies to live trades, futures and parlays only.
  const px = (book, v) => (book === "novig" ? `${sg(v)} (${Math.round(100 * (v > 0 ? 100 / (v + 100) : -v / (-v + 100)))}¢)` : sg(v));
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
      return `<td class="${best ? "bk-best" : ""}">${px(r[0], p)}${best ? " ★" : ""}</td>`;
    };
    return `<div class="bkbox"><div class="bk-h"><b>Lines at other books</b><span class="muted small">${x.rows.length} books · ${fmtTime(x.cap)}</span></div>
      <div class="bk-sum small">Best Over <b>${num(bestO[1])}</b> ${esc(bname(bestO[0]))} ${px(bestO[0], bestO[2])} · Best Under <b>${num(bestU[1])}</b> ${esc(bname(bestU[0]))} ${px(bestU[0], bestU[3])} · Consensus <b>${num(cons)}</b></div>
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
  // Middles (Michael 2026-11-23): Over at one book and Under at a higher line at another, so both bets win if the stat lands
  // between the two lines. Size = Under line - Over line as a % of the midpoint of the two lines. Per player/stat the pair with the
  // widest gap is kept (ties: better return). "Needs" = how often the middle must hit just to break even, from the stake split below
  // (miss = one side wins, one loses; hit = both win). Stats are whole numbers, so outcomes inside the gap are
  // ceil(Under) - floor(Over) - 1 (e.g. Over 32.5 / Under 34.5 -> 33 and 34); gaps with only one result are skipped.
  // Estimated hit chance (Michael 2026-11-23). Spread of each stat: sd = a * sqrt(line), with a fitted per stat from every graded
  // line of the season so far (actual - pre-game line; a^2 = sum of squared misses / sum of lines). Centre = median of the books' lines
  // for that player/stat. Chance = P(Over line < result < Under line) under a normal curve, with half-point boundaries for whole-number
  // results. Backtest weeks 8-11 (claude/middles-backtest-2026-11-23.md): predicted vs actual hit rates matched on average
  // (3.5% vs 3.8%, 6.2% vs 6.5%) but the sample is small, so this is an estimate, not a promise. Below a centre line of 10 (e.g. a QB's rush yards) it overstated the chance (0 of 36 hit), so those get no estimate and are left out while the filter is on.
  let SIG = null;
  function sigmas() {
    if (SIG) return SIG;
    const se = {}, sl = {};
    for (const rows of Object.values(D.rows || {})) for (const r of rows) {
      if (!r.final || r.played !== true) continue;
      for (const [mid, m] of Object.entries(r.m || {})) {
        if (m.lstat !== "ok" || m.act == null || !m.line) continue;
        const e = m.act - m.line; se[mid] = (se[mid] || 0) + e * e; sl[mid] = (sl[mid] || 0) + m.line;
      }
    }
    SIG = {}; for (const mid of Object.keys(se)) SIG[mid] = Math.sqrt(se[mid] / sl[mid]);
    return SIG;
  }
  const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2),
    p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  function middles() {
    const out = [];
    for (const [gid, g] of Object.entries(D.books || {})) {
      if (started(gid)) continue;
      for (const [pid, ms] of Object.entries(g.p || {})) {
        for (const [mid, rows] of Object.entries(ms)) {
          if (A.mk && mid !== A.mk) continue;
          const rs = rows.filter((r) => !A.off.includes(r[0]));
          let best = null;
          for (const o of rs) for (const u of rs) {
            if (o[0] === u[0] || o[2] == null || u[3] == null || !(u[1] > o[1])) continue;
            if (o[2] < MID_WORST_PRICE || u[3] < MID_WORST_PRICE) continue; // both legs must be priced -120 or better
            const mp = (o[1] + u[1]) / 2, gp = (u[1] - o[1]) / mp * 100;
            if (gp < A.mid || Math.ceil(u[1]) - Math.floor(o[1]) - 1 < 2) continue; // needs at least 2 whole-number results in the gap
            const S = 1 / dec(o[2]) + 1 / dec(u[3]), ret = 1 / S - 1, both = 2 / S - 1;
            const a = sigmas()[mid], ctr = median(rs.map((r) => r[1]));
            const pHit = a && ctr >= 10 ? Phi((Math.ceil(u[1]) - 0.5 - ctr) / (a * Math.sqrt(ctr))) - Phi((Math.floor(o[1]) + 0.5 - ctr) / (a * Math.sqrt(ctr))) : null;
            const need = (-ret) / (both - ret);
            if (A.edge && !(pHit != null && pHit >= need)) continue; // estimated hit chance must beat break-even
            const c = { pHit, gid, pid, mid, cap: g.cap, o, u, S, ret, both, gp, n: Math.ceil(u[1]) - Math.floor(o[1]) - 1, need };
            if (!best || gp > best.gp + 1e-9 || (Math.abs(gp - best.gp) < 1e-9 && ret > best.ret)) best = c;
          }
          if (best) out.push(best);
        }
      }
    }
    return out.sort((a, b) => (A.edge ? (b.pHit / b.need) - (a.pHit / a.need) : b.gp - a.gp) || b.gp - a.gp);
  }
  function midRow(x) {
    const p = (D.players || []).find((q) => q.id === x.pid), g = D.games[x.gid];
    const name = p ? p.name : x.pid, team = p ? p.team : "";
    const so = 100 / dec(x.o[2]) / x.S, su = 100 / dec(x.u[3]) / x.S;
    const mk = (D.markets.find((m) => m.id === x.mid) || {}).label || x.mid;
    const lo = Math.floor(x.o[1]) + 1, hi = Math.ceil(x.u[1]) - 1, span = lo === hi ? `${lo}` : `${lo} to ${hi}`;
    return `<div class="rlrow arbrow"><div class="rlhead"><a class="pname" href="#/player/${esc(x.pid)}">${esc(name)}</a> <span class="rlstat">${esc(mk)}</span>
        <span class="arb-ev pos">${x.gp.toFixed(1)}% gap</span></div>
      <div class="muted small">${esc(team)} · ${esc(gameLabel(x.gid))} · ${fmtTime(g.ko)} · lines ${ago(x.cap)}</div>
      <div class="arb-legs small"><span>Over <b>${num(x.o[1])}</b> ${esc(bname(x.o[0]))} ${px(x.o[0], x.o[2])} · bet <b>$${so.toFixed(2)}</b></span>
        <span>Under <b>${num(x.u[1])}</b> ${esc(bname(x.u[0]))} ${px(x.u[0], x.u[3])} · bet <b>$${su.toFixed(2)}</b></span></div>
      <div class="small">Both win (<b>${usd(x.both)}</b> on $100) if he lands on ${span} (${x.n} result${x.n === 1 ? "" : "s"}). Otherwise one side wins: <b>${usd(x.ret)}</b>. Needs the middle to hit about <b>${(x.need * 100).toFixed(1)}%</b> of the time to break even; estimated chance <b>${x.pHit == null ? "n/a" : (x.pHit * 100).toFixed(1) + "%"}</b>.</div></div>`;
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
      <div class="arb-legs small"><span>Over <b>${num(x.o[1])}</b> ${esc(bname(x.o[0]))} ${px(x.o[0], x.o[2])} · bet <b>$${so.toFixed(2)}</b></span>
        <span>Under <b>${num(x.u[1])}</b> ${esc(bname(x.u[0]))} ${px(x.u[0], x.u[3])} · bet <b>$${su.toFixed(2)}</b></span></div>
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
    const arbs = compute().filter((x) => cents(x.ret) > 0); // arbs at 0% or lower are hidden (Michael 2026-11-23)
    h += `<h3 class="small">Guaranteed profit (${arbs.length})</h3>`;
    h += arbs.length ? `<div class="panel rlist">${arbs.slice(0, 40).map(row).join("")}</div>` : `<p class="muted small">None right now with these books.</p>`;
    const mids = middles();
    h += `<h3 class="small">Middles (${mids.length})</h3>
      <div class="filters"><label><input type="checkbox" id="arb-edge" ${A.edge ? "checked" : ""}> Only if estimated hit chance beats break-even</label></div>
      <div class="filters"><label>Minimum gap <select id="arb-mid">${MID_OPTS.map((v) => `<option value="${v}" ${v === A.mid ? "selected" : ""}>${v}% of the line</option>`).join("")}</select></label></div>
      <p class="muted small">Over at one book and Under at a higher line at another: if the stat lands between the two lines, both bets win. Gap = Under line minus Over line, as a % of the two lines' midpoint. Both bets must be priced -120 or better (no heavy-juice alt lines), with at least 2 whole-number results inside the gap. The estimated hit chance comes from how far each stat usually lands from its line; it is a model, not a promise, and backtests are still thin. Not guaranteed: you give up a little when it misses.</p>`;
    h += mids.length ? `<div class="panel rlist">${mids.slice(0, 40).map(midRow).join("")}</div>` : `<p class="muted small">None right now${A.edge ? " whose estimated hit chance beats break-even" : ` at ${A.mid}% or wider`} with these books.</p>`;
    return h + `</section>`;
  }
  function bind() {
    document.querySelectorAll("[data-arbbook]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.arbbook;
      A.off = A.off.includes(k) ? A.off.filter((x) => x !== k) : A.off.concat(k);
      try { localStorage.setItem(LS_OFF, JSON.stringify(A.off)); } catch (e) { /* this browser only */ }
      render();
    }));
    const ed = document.getElementById("arb-edge");
    if (ed) ed.addEventListener("change", (e) => { A.edge = e.target.checked; try { localStorage.setItem(LS_EDGE, A.edge ? "1" : "0"); } catch (er) { /* this browser only */ } render(); });
    const m = document.getElementById("arb-mid");
    if (m) m.addEventListener("change", (e) => { A.mid = Number(e.target.value); try { localStorage.setItem(LS_MID, String(A.mid)); } catch (er) { /* this browser only */ } render(); });
    const s = document.getElementById("arb-mk"); if (s) s.addEventListener("change", (e) => { A.mk = e.target.value; render(); });
  }
  window.STIX_BOOKS = { box: (pid, mid) => { try { return box(pid, mid); } catch (e) { console.error("books box failed", e); return ""; } }, view, bind, compute, middles };
})();
