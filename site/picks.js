"use strict";
// My picks: Over/Under picks on player props.
// Two ways to save them:
//  • Account (default going forward): signed in with email (account.js). Picks are stored in the Stix database;
//    the database itself refuses changes after kickoff, so the phone's clock doesn't matter.
//  • GitHub (the original way, kept until old picks are imported): a private repo + key saved in this browser.
// Picks are graded against the line saved when the pick was made. Every pick is 1 unit; dollars = units × unit size.
(function () {
  // false = the Picks tab stays hidden for visitors who aren't signed in (open it with the 3-tap logo or #/picks).
  // Flip to true when sign-up is open to everyone.
  const OPEN_SIGNUP = true; // Picks tab for everyone (Michael, 2026-10-27); visitors see the sign-in screen until signed in
  const LS_CFG = "stix_picks_cfg", LS_CACHE = "stix_picks_cache", FILE = "picks.json";
  const ST = { picks: [], dirty: false, syncing: false, synced: null, err: "", sha: null };          // GitHub mode
  const AC = { picks: [], loaded: false, loading: false, err: "", saving: 0, uid: null, at: 0 };          // account mode
  const ACC = () => window.STIX_ACCOUNT;

  // ---------- browser storage (always wrapped: it can be blocked or empty) ----------
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const cfg = () => { const c = lsGet(LS_CFG); return c && c.token && c.repo ? c : null; };
  (function loadCache() { const c = lsGet(LS_CACHE); if (c && Array.isArray(c.picks)) { ST.picks = c.picks; ST.dirty = !!c.dirty; ST.synced = c.synced || null; } })();
  const saveCache = () => lsSet(LS_CACHE, { picks: ST.picks, dirty: ST.dirty, synced: ST.synced });

  // Which storage is in use right now: "acct", "gh", or null (picking not available on this device).
  const mode = () => (ACC() && ACC().signedIn() ? (ACC().ready() ? "acct" : null) : cfg() ? "gh" : null);
  const enabled = () => mode() !== null;
  const unit = () => (mode() === "acct" ? ACC().unitSize() : 10);
  // Visitors who can't save picks yet (not signed in, or signed in but the 21+ step isn't done) still see Over/Under.
  // A tap remembers that pick and asks them to sign in; once signed in + 21+, it's saved automatically (Michael, 2026-10-27).
  const offer = () => OPEN_SIGNUP && !enabled() && !!ACC();
  const LS_WANT = "stix_pending_pick", WANT_MAX_MS = 30 * 60000;

  // ---------- helpers ----------
  const now = () => Date.now();
  const started = (ko) => !ko || new Date(ko).getTime() <= now();
  const live = () => (mode() === "acct" ? AC.picks : ST.picks.filter((p) => !p.deleted));
  const sideWord = (s) => (s === "o" ? "Over" : "Under");
  const lineNum = (v) => (v == null ? "" : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const oddsTxt = (v) => (v == null ? "" : v > 0 ? `+${v}` : String(v));
  function lineNow(m) {
    if (!m) return null;
    if (m.lstat === "ok" && m.line != null) return { line: m.line, op: m.op, up: m.up, book: m.book, src: "Pre-game", cap: m.cap };
    if (m.lstat === "pending") { const sn = latestSnap(m); if (sn && sn.line != null) return { line: sn.line, op: sn.op, up: sn.up, book: sn.book, src: sn.label, cap: sn.cap }; }
    return null;
  }
  function nextRow(pid) {
    const rows = (D.rows[pid] || []).filter((r) => r.ko && !started(r.ko)).sort((a, b) => a.ko.localeCompare(b.ko));
    return rows[0] || null;
  }
  function grade(p) {
    if (!started(p.ko)) return { st: "open" };
    const r = (D.rows[p.pid] || []).find((x) => x.gid === p.gid);
    const m = r ? r.m[p.mid] : null;
    const act = m ? m.act : null;
    if (act != null) {
      if (act === p.line) return { st: "push", act };
      const over = act > p.line;
      return { st: (p.side === "o") === over ? "hit" : "miss", act };
    }
    if (r && r.final && r.played === false) return { st: "void", why: "did not play" };
    if (r && r.final) return { st: "locked", why: "waiting for stats" };
    return { st: "locked", why: "in progress" };
  }
  function rerender() {
    const t = (location.hash || "").split("/")[1];
    if ((t === "picks" || t === "player") && typeof render === "function" && D) {
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
    showTab();
  }
  function showTab() {
    const a = document.getElementById("tab-picks");
    if (a) a.hidden = !(OPEN_SIGNUP || cfg() || (ACC() && ACC().signedIn()));
  }

  // ---------- account storage ----------
  // Database row <-> the pick shape the screens use.
  function fromRow(r) {
    const g = D && D.games[r.game_id];
    return { id: r.pick_key, pid: r.player_id, name: r.player_name, pos: r.pos, gid: r.game_id, wk: r.week, mid: r.market, side: r.side,
      line: r.line == null ? null : Number(r.line), odds: r.odds, book: r.book || "", src: r.line_label || (r.source === "Bet on DK" ? "Bet on DK" : r.source),
      cap: r.line_captured_at, ko: g ? g.ko : null, picked_utc: r.picked_at, updated_utc: r.updated_at };
  }
  function toRow(p, source) {
    return { pick_key: p.id, game_id: p.gid, week: p.wk, player_id: p.pid, player_name: p.name, pos: p.pos || null, market: p.mid,
      side: p.side, line: p.line, odds: p.odds == null ? null : Math.round(p.odds), book: p.book || null, source,
      line_label: p.src || null, line_captured_at: p.cap || null };
  }
  async function acLoad() {
    if (mode() !== "acct" || AC.loading) return;
    AC.loading = true;
    const uid = ACC().user().id;
    const r = await ACC().db("/rest/v1/picks?select=*&order=picked_at.asc");
    AC.loading = false;
    if (r.ok && Array.isArray(r.data)) { AC.picks = r.data.map(fromRow); AC.loaded = true; AC.err = ""; AC.uid = uid; AC.at = Date.now(); }
    else if (r.status !== 401) AC.err = `Couldn't load your picks: ${r.error}`;
    rerender();
    applyWanted();
  }

  // ---------- pick tapped before signing in ----------
  function wantedPick() {
    const w = lsGet(LS_WANT);
    return w && w.pid && w.mid && (w.side === "o" || w.side === "u") && Date.now() - (w.at || 0) < WANT_MAX_MS ? w : null;
  }
  const clearWanted = () => lsSet(LS_WANT, null);
  function wantedLabel() {
    const w = wantedPick();
    if (!w) return "";
    const p = playerById[w.pid], mk = mkt[w.mid];
    return `${p ? p.name : ""} ${sideWord(w.side)} ${lineNum(w.line)} ${mk ? mk.label : ""}`.replace(/\s+/g, " ").trim();
  }
  function askSignIn(pid, mid, side) {
    const r = nextRow(pid);
    const ln = r ? lineNow(r.m[mid]) : null;
    if (!r || !ln || started(r.ko)) return;
    lsSet(LS_WANT, { pid, mid, side, gid: r.gid, line: ln.line, back: location.hash || "#/board", at: Date.now() });
    if (ACC().signedIn()) { location.hash = "#/picks"; return; } // signed in: the 21+ step comes next on the Picks tab
    if (window.STIX_WHATSNEW && window.STIX_WHATSNEW.open) window.STIX_WHATSNEW.open({ pick: wantedLabel() });
    else location.hash = "#/picks";
  }
  // Once the account is ready and its picks are loaded: save the remembered pick (never removes or flips an existing
  // same-side pick), then go back to the page the pick was tapped on.
  function applyWanted() {
    if (mode() !== "acct" || !AC.loaded || !D) return; // after a redirect sign-in the data file may not be loaded yet
    const w = wantedPick();
    if (!lsGet(LS_WANT)) return;
    clearWanted();
    if (!w) return;
    const r = nextRow(w.pid);
    const ln = r && r.gid === w.gid ? lineNow(r.m[w.mid]) : null;
    if (!ln || started(r.ko)) { AC.err = "Your pick wasn't saved: the game has started or the line is no longer posted."; rerender(); }
    else {
      const id = `${r.wk}|${w.pid}|${w.mid}`;
      const old = AC.picks.find((x) => x.id === id);
      if (!old || old.side !== w.side) setPick(w.pid, w.mid, w.side);
    }
    if ((location.hash || "").startsWith("#/picks") && w.back && !w.back.startsWith("#/picks")) location.hash = w.back;
  }
  // Save (add or change) one pick. The screen updates right away; if the server refuses, it changes back and says why.
  async function acSave(pick, source) {
    const before = AC.picks;
    AC.picks = AC.picks.filter((p) => p.id !== pick.id).concat(Object.assign({}, pick, { saving: true }));
    AC.saving++; AC.err = ""; rerender();
    const r = await ACC().db("/rest/v1/picks?on_conflict=user_id,pick_key", { method: "POST", body: toRow(pick, source), prefer: "resolution=merge-duplicates,return=representation" });
    AC.saving--;
    if (r.ok && Array.isArray(r.data) && r.data[0]) AC.picks = AC.picks.filter((p) => p.id !== pick.id).concat(fromRow(r.data[0]));
    else { AC.picks = before; AC.err = `Pick not saved: ${r.error}`; }
    rerender();
  }
  async function acDelete(id) {
    const before = AC.picks;
    AC.picks = AC.picks.filter((p) => p.id !== id);
    AC.saving++; AC.err = ""; rerender();
    const r = await ACC().db(`/rest/v1/picks?pick_key=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=representation" });
    AC.saving--;
    if (!r.ok) { AC.picks = before; AC.err = `Pick not removed: ${r.error}`; }
    else if (Array.isArray(r.data) && r.data.length === 0) { AC.picks = before; AC.err = "Pick not removed (it may already be locked)."; }
    rerender();
  }

  // ---------- GitHub storage (original) ----------
  const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
  async function gh(method, body) {
    const c = cfg();
    return fetch(`https://api.github.com/repos/${c.repo}/contents/${FILE}`, {
      method, cache: "no-store",
      headers: Object.assign({ Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json" }, body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  // Merge two lists: newest edit wins, but an edit made after kickoff never replaces one made before it.
  function merge(a, b) {
    const out = {};
    for (const p of [...a, ...b]) {
      const q = out[p.id];
      if (!q) { out[p.id] = p; continue; }
      const late = (x) => x.ko && x.updated_utc > x.ko;
      if (late(p) !== late(q)) { out[p.id] = late(p) ? q : p; continue; }
      if ((p.updated_utc || "") > (q.updated_utc || "")) out[p.id] = p;
    }
    return Object.values(out);
  }
  const same = (a, b) => JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)));
  async function pull() {
    const r = await gh("GET");
    if (r.status === 404) { ST.sha = null; return []; }
    if (r.status === 401 || r.status === 403) throw new Error("GitHub rejected the key (expired, wrong repo, or missing Contents permission)");
    if (!r.ok) throw new Error(`GitHub returned ${r.status}`);
    const j = await r.json();
    ST.sha = j.sha;
    const o = JSON.parse(b64d(j.content || "") || "{}");
    return Array.isArray(o.picks) ? o.picks : [];
  }
  async function push(list) {
    const body = { message: "Update picks", content: b64e(JSON.stringify({ version: 1, picks: list }, null, 1)) };
    if (ST.sha) body.sha = ST.sha;
    const r = await gh("PUT", body);
    if (r.status === 409 || r.status === 422) return false; // changed elsewhere since we read it
    if (r.status === 401 || r.status === 403) throw new Error("GitHub rejected the key (expired, or missing Contents write permission)");
    if (!r.ok) throw new Error(`GitHub returned ${r.status} while saving`);
    ST.sha = (await r.json()).content.sha;
    return true;
  }
  async function ghSync() {
    if (!cfg() || ST.syncing) return;
    ST.syncing = true; ST.err = ""; rerender();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await pull();
        const merged = merge(remote, ST.picks);
        ST.picks = merged;
        if (same(merged, remote)) { ST.dirty = false; break; }
        if (await push(merged)) { ST.dirty = false; break; }
      }
      ST.synced = new Date().toISOString();
    } catch (e) { ST.err = e.message || String(e); }
    ST.syncing = false; saveCache(); rerender();
  }
  // Refresh whichever storage is in use (and keep the GitHub copy current while it exists on this device).
  function sync() { if (mode() === "acct") acLoad(); if (cfg()) ghSync(); }

  // ---------- making a pick ----------
  function setPick(pid, mid, side) {
    const r = nextRow(pid);
    if (!r) return;
    const m = r.m[mid];
    const ln = lineNow(m);
    if (!ln || started(r.ko)) return;
    const id = `${r.wk}|${pid}|${mid}`;
    const t = new Date().toISOString();
    const p = playerById[pid];
    const fresh = { id, pid, name: p.name, pos: p.pos, gid: r.gid, wk: r.wk, mid, side, line: ln.line, odds: side === "o" ? ln.op : ln.up,
      book: ln.book, src: ln.src, cap: ln.cap, ko: r.ko, picked_utc: t, updated_utc: t };
    if (mode() === "acct") {
      const old = AC.picks.find((x) => x.id === id);
      if (old && old.side === side) acDelete(id); // tap again = remove
      else acSave(fresh, "manual");
      return;
    }
    const old = ST.picks.find((x) => x.id === id);
    const pick = old && !old.deleted && old.side === side ? Object.assign({}, old, { deleted: true, updated_utc: t }) : fresh;
    ST.picks = ST.picks.filter((x) => x.id !== id).concat(pick);
    ST.dirty = true; saveCache(); rerender(); ghSync();
  }
  // A tap on a sportsbook bet button ("Bet on FanDuel") also saves the pick (only on devices where My picks is set up), at
  // the line and odds from the link. Never removes or flips silently: it always records the side that was tapped.
  function recordBet(pid, mid, side, bet) {
    if (!enabled() || !bet || bet.line == null) return;
    const r = nextRow(pid);
    if (!r || started(r.ko) || (bet.gid && bet.gid !== r.gid)) return;
    const id = `${r.wk}|${pid}|${mid}`;
    const t = new Date().toISOString();
    const p = playerById[pid];
    const pick = { id, pid, name: p.name, pos: p.pos, gid: r.gid, wk: r.wk, mid, side, line: bet.line, odds: bet.odds,
      book: bet.book || "DraftKings", src: bet.src || "Bet on DK", cap: bet.cap, ko: r.ko, picked_utc: t, updated_utc: t };
    if (mode() === "acct") { acSave(pick, pick.src); return; }
    ST.picks = ST.picks.filter((x) => x.id !== id).concat(pick);
    ST.dirty = true; saveCache(); ghSync();
  }
  function removePick(id) {
    if (mode() === "acct") { const old = AC.picks.find((p) => p.id === id); if (old && !started(old.ko)) acDelete(id); return; }
    const old = ST.picks.find((p) => p.id === id);
    if (!old || old.deleted || started(old.ko)) return;
    ST.picks = ST.picks.filter((p) => p.id !== id).concat(Object.assign({}, old, { deleted: true, updated_utc: new Date().toISOString() }));
    ST.dirty = true; saveCache(); rerender(); ghSync();
  }

  // ---------- player page box ----------
  function box(pid, mid) {
    if (!enabled() && !offer()) return "";
    if (offer()) {
      const r = nextRow(pid);
      if (!r) return "";
      const ln = lineNow(r.m[mid]);
      const mk = mkt[mid];
      if (!ln) return "";
      const b = (s) => `<button class="pk-btn" data-pick="${s}" data-pid="${esc(pid)}" data-pmid="${esc(mid)}">${sideWord(s)} ${lineNum(ln.line)}</button>`;
      return `<div class="pickbox"><div class="pk-h"><div><b>Week ${r.wk} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${esc(mk.label)}</b><div class="muted small">${fmtTime(r.ko)} · ${esc(ln.book)}</div></div>
        <div class="pk-line"><b>${lineNum(ln.line)}</b></div></div><div class="pk-btns">${b("o")}${b("u")}</div><span class="muted small">Tap to save a pick to My picks (free account).</span></div>`;
    }
    const r = nextRow(pid);
    const mk = mkt[mid];
    if (!r) {
      // No game left to pick: show this market's most recent pick (locked or graded) if there is one.
      const last = live().filter((p) => p.pid === pid && p.mid === mid).sort((a, b) => (b.ko || "").localeCompare(a.ko || ""))[0];
      if (!last) return `<div class="pickbox"><span class="muted small">No upcoming game to pick.</span></div>`;
      const g = grade(last);
      const res = { hit: "Hit", miss: "Miss", push: "Push", void: "Void" }[g.st] || (g.why ? g.why : "");
      return `<div class="pickbox"><span class="small">Your week ${last.wk} pick: <b>${sideWord(last.side)} ${lineNum(last.line)}</b> ${oddsTxt(last.odds)} (${esc(last.src)}, ${esc(last.book)}) · 🔒 locked${res ? ` · ${esc(res)}` : ""}${g.act != null ? ` · actual ${lineNum(g.act)}` : ""}</span></div>`;
    }
    const id = `${r.wk}|${pid}|${mid}`;
    const mine = live().find((p) => p.id === id);
    const ln = lineNow(r.m[mid]);
    const head = `<div class="pk-h"><div><b>Week ${r.wk} ${r.ha === "home" ? "vs" : "@"} ${esc(r.opp)} · ${esc(mk.label)}</b><div class="muted small">${fmtTime(r.ko)}${ln ? ` · ${esc(ln.book)}` : ""}</div></div>
      ${ln ? `<div class="pk-line"><b>${lineNum(ln.line)}</b></div>` : ""}</div>`;
    if (!ln) return `<div class="pickbox">${head}<p class="muted small">No line posted yet for this market. Pick buttons appear once one is captured.</p></div>`;
    const btn = (s) => {
      const on = mine && mine.side === s;
      return `<button class="pk-btn ${on ? "on" : ""}" data-pick="${s}" data-pid="${esc(pid)}" data-pmid="${esc(mid)}" ${mine && mine.saving ? "disabled" : ""}>${on ? "✓ " : ""}${sideWord(s)} ${lineNum(on ? mine.line : ln.line)}</button>`;
    };
    let note = "";
    if (mine) {
      note = `<span class="small">Saved: <b>${sideWord(mine.side)} ${lineNum(mine.line)}</b> ${oddsTxt(mine.odds)} (${esc(mine.src)}, ${esc(mine.book)})${mine.line !== ln.line ? ` · line now ${lineNum(ln.line)}; tap the other side, or remove and re-add, to take the new line` : ""}</span>`;
    }
    return `<div class="pickbox">${head}<div class="pk-btns">${btn("o")}${btn("u")}</div>${note} ${saveBadge()}</div>`;
  }
  function saveBadge() {
    if (mode() === "acct") {
      if (AC.saving) return `<span class="muted small">· saving…</span>`;
      if (AC.err) return `<span class="small pk-err">· ${esc(AC.err)}</span>`;
      return "";
    }
    if (ST.syncing) return `<span class="muted small">· saving…</span>`;
    if (ST.err) return `<span class="small pk-err">· not saved to GitHub yet (${esc(ST.err)}) <a href="#/picks">details</a></span>`;
    if (ST.dirty) return `<span class="muted small">· waiting to save</span>`;
    return "";
  }

  // ---------- Picks tab ----------
  function setupView() {
    const owner = (D.repo || "").split("/")[0];
    return `<div class="panel"><h3>Set up My picks on this device</h3><div class="body">
      <p class="small">Picks are saved to a private GitHub repo that only you can open. Enter the repo and your key once on each device you use.
      The key stays in this browser only. Other people using the app don't see the Picks tab or the pick buttons.</p>
      <form id="pk-setup" class="pk-form">
        <label>Picks repo <input id="pk-repo" placeholder="${esc(owner || "your-name")}/stix-picks" value="${esc(owner ? owner + "/stix-picks" : "")}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <label>Key (fine-grained token) <input id="pk-token" type="password" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
        <button type="submit">Save and connect</button> <span id="pk-msg" class="small pk-err"></span>
      </form></div></div>`;
  }
  // Result of one pick in units (each pick = 1 unit) at the odds saved with it.
  // Win pays at those American odds, loss = −1 u, push / void = 0. Missing odds → not counted (labeled, never guessed).
  function profit(p, g) {
    if (g.st === "push" || g.st === "void") return 0;
    if (g.st !== "hit" && g.st !== "miss") return null;
    if (g.st === "miss") return -1;
    const o = Number(p.odds);
    if (!p.odds || !isFinite(o) || o === 0) return null;
    return o > 0 ? o / 100 : 100 / -o;
  }
  const units = (v) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} u`);
  const money = (v) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v * unit()).toFixed(2)}`);
  const both = (v) => (v == null ? "—" : `${units(v)} (${money(v)})`);
  function row(p, g, readOnly) {
    const mk = mkt[p.mid];
    const gm = D.games[p.gid];
    const vs = gm ? `${gm.away} @ ${gm.home}` : p.gid;
    const chip = { hit: `<span class="pk-res hit">Hit</span>`, miss: `<span class="pk-res miss">Miss</span>`, push: `<span class="pk-res">Push</span>`, void: `<span class="pk-res">Void</span>` }[g.st] || "";
    const right = g.st === "open" && !readOnly ? `<button class="pk-del" data-del="${esc(p.id)}" aria-label="Remove pick" title="Remove" ${p.saving ? "disabled" : ""}>✕</button>` : chip || `<span class="muted small">${esc(g.why || (g.st === "open" ? "open" : ""))}</span>`;
    const pl = profit(p, g);
    return `<div class="pk-row"><div><a class="pname" href="#/player/${esc(p.pid)}">${esc(p.name)}</a> · ${esc(mk ? mk.label : p.mid)} <span class="muted small">W${p.wk} ${esc(vs)} · ${fmtTime(p.ko)}</span>
      <div class="small"><b>${sideWord(p.side)} ${lineNum(p.line)}</b> ${oddsTxt(p.odds)} <span class="muted">(${esc(p.src)}, ${esc(p.book)})</span>${g.act != null ? ` · actual <b>${lineNum(g.act)}</b>` : ""}${g.st === "void" ? ` <span class="muted">· ${esc(g.why)}</span>` : ""}${["hit", "miss", "push", "void"].includes(g.st) ? ` · <span class="${pl > 0 ? "pk-up" : pl < 0 ? "pk-down" : "muted"}">${pl == null ? "P/L n/a (no odds saved)" : both(pl)}</span>` : ""}${p.saving ? ` <span class="muted">· saving…</span>` : ""}</div></div>${right}</div>`;
  }
  function rec(list) {
    const c = { hit: 0, miss: 0, push: 0 };
    for (const x of list) if (c[x.g.st] != null) c[x.g.st]++;
    const n = c.hit + c.miss;
    let pl = 0, noOdds = 0;
    for (const x of list) { const v = profit(x.p, x.g); if (v == null) { if (x.g.st === "hit") noOdds++; } else pl += v; }
    return { txt: `${c.hit}–${c.miss}–${c.push}`, pct: n ? `${Math.round((c.hit / n) * 100)}%` : "—", n: c.hit + c.miss + c.push, pl, noOdds, bets: list.length };
  }
  function picksView(list, statusTxt, lockNote) {
    const all = list.map((p) => ({ p, g: grade(p) })).sort((a, b) => (a.p.ko || "").localeCompare(b.p.ko || "") || a.p.name.localeCompare(b.p.name));
    const open = all.filter((x) => x.g.st === "open");
    const locked = all.filter((x) => x.g.st === "locked");
    const graded = all.filter((x) => ["hit", "miss", "push", "void"].includes(x.g.st)).reverse();
    const R = rec(graded), O = rec(graded.filter((x) => x.p.side === "o")), U = rec(graded.filter((x) => x.p.side === "u"));
    const byMk = D.markets.map((m) => ({ m, r: rec(graded.filter((x) => x.p.mid === m.id)) })).filter((x) => x.r.n);
    let h = `<div class="pk-stats"><div class="pk-stat"><span>Record (W–L–P)</span><b>${R.txt}</b></div><div class="pk-stat"><span>Hit rate</span><b>${R.pct}</b></div>
      <div class="pk-stat"><span>Profit / loss</span><b class="${R.bets && R.pl > 0 ? "pk-up" : R.bets && R.pl < 0 ? "pk-down" : ""}">${R.bets ? units(R.pl) : "—"}</b>${R.bets ? `<span>${money(R.pl)} at $${unit().toFixed(2)}/unit</span>` : ""}</div></div>
      <p class="small muted">Overs ${O.txt} (${units(O.pl)}) · Unders ${U.txt} (${units(U.pl)})${byMk.length ? " · " + byMk.map((x) => `${esc(x.m.label)} ${x.r.txt} (${units(x.r.pl)})`).join(" · ") : ""}
      · Every pick is 1 unit at the odds saved with it; pushes and voids are 0; picks still in progress aren't counted until graded${R.noOdds ? ` · ${R.noOdds} winning pick${R.noOdds === 1 ? "" : "s"} had no saved odds and ${R.noOdds === 1 ? "isn't" : "aren't"} counted` : ""}
      · Hit rate leaves out pushes and voids · ${statusTxt}</p>`;
    const sec = (title, l, empty) => `<div class="panel"><h3>${title} (${l.length})</h3><div class="body">${l.length ? l.map((x) => row(x.p, x.g)).join("") : `<p class="muted small">${empty}</p>`}</div></div>`;
    const nShare = open.length + locked.length;
    if (nShare && window.STIX_SHARE && window.STIX_SHARE.openPicks) h += `<p class="pk-sharerow"><button id="pk-share" class="sh-main" type="button">Share this week's picks (${nShare})</button></p>`;
    h += sec("Open · you can change these until kickoff", open, "No open picks. Open a player page and tap Over or Under.");
    h += sec("Locked · game started", locked, "Picks move here at kickoff. They can't be changed or removed after that.");
    h += sec("Graded", graded, "Graded picks appear here once the game's stats are published.");
    h += `<p class="muted small">Picks are graded against the line saved when you made the pick (a Mon / Thu / Sun AM snapshot or the pre-game line), not the app's graded line.
      Over hits when the actual stat is above that line; equal = push; a player who doesn't play = void. ${lockNote}</p>`;
    return h;
  }
  function ghView() {
    const st = ST.syncing ? "Saving…" : ST.err ? `<span class="pk-err">Not synced: ${esc(ST.err)}</span> <button id="pk-retry">Retry</button>` :
      ST.dirty ? "Waiting to save" : ST.synced ? `Synced with GitHub ${ago(ST.synced)}` : "Not synced yet";
    return picksView(ST.picks.filter((p) => !p.deleted), st, "Locking uses this device's clock and the scheduled kickoff.") +
      `<p class="small"><button id="pk-off">Turn off My picks on this device</button> <span class="muted">Removes the key and local copy from this browser. Your picks stay in your GitHub repo.</span></p>`;
  }
  // Earlier picks still saved in GitHub on this device, shown read-only while signed in (until they're imported).
  function ghLegacy() {
    const old = ST.picks.filter((p) => !p.deleted);
    if (!cfg() || !old.length) return "";
    const rows = old.map((p) => ({ p, g: grade(p) })).sort((a, b) => (b.p.ko || "").localeCompare(a.p.ko || "")).map((x) => row(x.p, x.g, true)).join("");
    return `<details class="panel ac-legacy"><summary><b>Earlier picks saved to GitHub (${old.length})</b> <span class="muted small">· not in your account yet; importing them is the next update</span></summary><div class="body">${rows}</div></details>`;
  }
  function view() {
    const acc = ACC();
    if (acc && acc.signedIn()) {
      const g = acc.gate();
      if (g) return g;
      if (!AC.loaded) { if (!AC.loading) setTimeout(acLoad, 0); return `<p class="muted pad">Loading your picks…</p>${acc.accountBox()}`; }
      const st = AC.saving ? "Saving…" : AC.err ? `<span class="pk-err">${esc(AC.err)}</span> <button id="pk-retry">Retry</button>` : "Saved to your account";
      return picksView(AC.picks, st, "Locks are enforced by the Stix server at the scheduled kickoff, so a device's clock can't change them.") + ghLegacy() + acc.accountBox();
    }
    if (cfg()) return (acc ? `<div class="panel ac"><div class="body"><p class="small"><b>New:</b> sign in with your email to keep your picks in a Stix account, on every device. <a href="#/picks" id="pk-goacct">Sign in</a></p></div></div>` : "") + ghView();
    return acc ? acc.gate() || "" : setupView();
  }

  function bind(tab) {
    showTab();
    // Opening the Picks tab refreshes from the account (at most every 15 s), so picks made on another device show up.
    if (tab === "picks" && mode() === "acct" && AC.loaded && !AC.saving && Date.now() - AC.at > 15000) acLoad();
    if (ACC()) ACC().bind();
    document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => (enabled() ? setPick : offer() ? askSignIn : () => {})(b.dataset.pid, b.dataset.pmid, b.dataset.pick)));
    document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => removePick(b.dataset.del)));
    const rt = document.getElementById("pk-retry"); if (rt) rt.addEventListener("click", sync);
    const sh = document.getElementById("pk-share");
    if (sh) sh.addEventListener("click", () => {
      // Open + locked picks (not yet graded), in kickoff order, as an image to share.
      const list = live().map((p) => ({ p, g: grade(p) })).filter((x) => x.g.st === "open" || x.g.st === "locked")
        .sort((a, b) => (a.p.ko || "").localeCompare(b.p.ko || "") || a.p.name.localeCompare(b.p.name))
        .map((x) => Object.assign({}, x.p, { locked: x.g.st === "locked" }));
      try { window.STIX_SHARE.openPicks(list); } catch (err) { console.error("picks share failed", err); }
    });
    const ga = document.getElementById("pk-goacct");
    if (ga) ga.addEventListener("click", (e) => { e.preventDefault(); signInWanted = true; rerender(); });
    const off = document.getElementById("pk-off");
    if (off) off.addEventListener("click", () => { if (confirm("Turn off My picks on this device? Your picks stay saved in your GitHub repo.")) { lsSet(LS_CFG, null); lsSet(LS_CACHE, null); ST.picks = []; ST.dirty = false; ST.synced = null; ST.err = ""; rerender(); } });
    const f = document.getElementById("pk-setup");
    if (f) f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const repo = document.getElementById("pk-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
      const token = document.getElementById("pk-token").value.trim();
      const msg = document.getElementById("pk-msg");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { msg.textContent = "Enter the repo as owner/name, e.g. your-name/stix-picks."; return; }
      if (!token) { msg.textContent = "Enter your key."; return; }
      msg.textContent = "Checking…";
      lsSet(LS_CFG, { repo, token });
      try { await pull(); } catch (err) { lsSet(LS_CFG, null); msg.textContent = `Couldn't connect: ${err.message}`; return; }
      msg.textContent = "";
      await ghSync();
      rerender();
    });
  }
  // A device with the GitHub key sees its GitHub picks first; "Sign in" switches the tab to the sign-in screen.
  let signInWanted = false;
  const viewOuter = () => (signInWanted && cfg() && ACC() && !ACC().signedIn() ? ACC().gate() + `<p class="small"><a href="#/picks" id="pk-back">Back to my GitHub picks</a></p>` : view());
  const bindOuter = (tab) => {
    bind(tab);
    const bk = document.getElementById("pk-back");
    if (bk) bk.addEventListener("click", (e) => { e.preventDefault(); signInWanted = false; rerender(); });
  };

  window.STIX_PICKS = { enabled, box, view: viewOuter, bind: bindOuter, sync, recordBet, wantedLabel, clearWanted };
  // Account changes (signed in / out, 21+ confirmed, unit size): reload picks and redraw.
  if (ACC()) ACC().onChange(() => {
    if (!ACC().signedIn()) { AC.picks = []; AC.loaded = false; AC.uid = null; }
    else { signInWanted = false; if (ACC().ready() && (!AC.loaded || AC.uid !== ACC().user().id)) { AC.loaded = false; acLoad(); } }
    rerender();
    applyWanted();
  });
  // Hidden way in: tap the Stix logo 3 times within ~1.5 s to open the admin page (site traffic + users;
  // data only for admin accounts). Was My picks until the Picks tab opened to everyone (Michael, 2026-10-27).
  // Needed for the home-screen app, which has its own storage and no address bar.
  (function logoTaps() {
    const brand = document.querySelector("header .brand");
    if (!brand) return;
    let taps = [];
    brand.addEventListener("click", () => {
      const t = Date.now();
      taps = taps.filter((x) => t - x < 1500).concat(t);
      if (taps.length >= 3) { taps = []; location.hash = "#/admin"; }
    });
  })();
  // Keep devices in step: refresh when the app comes back into view and every 5 minutes while open.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && D) sync(); });
  setInterval(() => { if (document.visibilityState === "visible" && D) sync(); }, 5 * 60000);
  const first = setInterval(() => { if (D) { clearInterval(first); showTab(); sync(); applyWanted(); } }, 300);
})();
