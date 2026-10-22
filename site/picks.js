"use strict";
// My picks: Over/Under picks on player props, saved to a PRIVATE GitHub repo the owner chooses.
// Hidden unless this browser has the owner's key (a fine-grained GitHub token limited to that one repo).
// The key and a local copy of the picks live only in this browser's storage; nothing here touches the app's own data.
// Picks lock at kickoff (by this device's clock) and are graded against the line saved when the pick was made.
(function () {
  const LS_CFG = "stix_picks_cfg", LS_CACHE = "stix_picks_cache", FILE = "picks.json";
  const ST = { picks: [], dirty: false, syncing: false, synced: null, err: "", sha: null };

  // ---------- browser storage (always wrapped: it can be blocked or empty) ----------
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const cfg = () => { const c = lsGet(LS_CFG); return c && c.token && c.repo ? c : null; };
  const enabled = () => !!cfg();
  (function loadCache() { const c = lsGet(LS_CACHE); if (c && Array.isArray(c.picks)) { ST.picks = c.picks; ST.dirty = !!c.dirty; ST.synced = c.synced || null; } })();
  const saveCache = () => lsSet(LS_CACHE, { picks: ST.picks, dirty: ST.dirty, synced: ST.synced });

  // ---------- helpers ----------
  const now = () => Date.now();
  const started = (ko) => !ko || new Date(ko).getTime() <= now();
  const live = () => ST.picks.filter((p) => !p.deleted);
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

  // ---------- GitHub sync ----------
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
  async function sync() {
    if (!enabled() || ST.syncing) return;
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
  function rerender() {
    const t = (location.hash || "").split("/")[1];
    if ((t === "picks" || t === "player") && typeof render === "function" && D) {
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
    showTab();
  }
  function showTab() { const a = document.getElementById("tab-picks"); if (a) a.hidden = !enabled(); }

  // ---------- making a pick ----------
  function setPick(pid, mid, side) {
    const r = nextRow(pid);
    if (!r) return;
    const m = r.m[mid];
    const ln = lineNow(m);
    if (!ln || started(r.ko)) return;
    const id = `${r.wk}|${pid}|${mid}`;
    const old = ST.picks.find((p) => p.id === id);
    const t = new Date().toISOString();
    let pick;
    if (old && !old.deleted && old.side === side) pick = Object.assign({}, old, { deleted: true, updated_utc: t }); // tap again = remove
    else {
      const p = playerById[pid];
      pick = { id, pid, name: p.name, pos: p.pos, gid: r.gid, wk: r.wk, mid, side, line: ln.line, odds: side === "o" ? ln.op : ln.up,
        book: ln.book, src: ln.src, cap: ln.cap, ko: r.ko, picked_utc: t, updated_utc: t };
    }
    ST.picks = ST.picks.filter((p) => p.id !== id).concat(pick);
    ST.dirty = true; saveCache(); rerender(); sync();
  }
  function removePick(id) {
    const old = ST.picks.find((p) => p.id === id);
    if (!old || old.deleted || started(old.ko)) return;
    ST.picks = ST.picks.filter((p) => p.id !== id).concat(Object.assign({}, old, { deleted: true, updated_utc: new Date().toISOString() }));
    ST.dirty = true; saveCache(); rerender(); sync();
  }

  // ---------- player page box ----------
  function box(pid, mid) {
    if (!enabled()) return "";
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
      ${ln ? `<div class="pk-line"><b>${lineNum(ln.line)}</b>${ln.src !== "Pre-game" ? ` <span class="chip snapchip">${esc(ln.src)}</span>` : ""}</div>` : ""}</div>`;
    if (!ln) return `<div class="pickbox">${head}<p class="muted small">No line posted yet for this market. Pick buttons appear once one is captured.</p></div>`;
    const btn = (s) => {
      const on = mine && mine.side === s;
      return `<button class="pk-btn ${on ? "on" : ""}" data-pick="${s}" data-pid="${esc(pid)}" data-pmid="${esc(mid)}">${on ? "✓ " : ""}${sideWord(s)} ${lineNum(on ? mine.line : ln.line)}</button>`;
    };
    let note = `<span class="muted small">Tap Over or Under to add it to your picks · tap again to remove · locks at kickoff</span>`;
    if (mine) {
      note = `<span class="small">Saved: <b>${sideWord(mine.side)} ${lineNum(mine.line)}</b> ${oddsTxt(mine.odds)} (${esc(mine.src)}, ${esc(mine.book)})${mine.line !== ln.line ? ` · line now ${lineNum(ln.line)}; tap the other side, or remove and re-add, to take the new line` : ""}</span>`;
    }
    return `<div class="pickbox">${head}<div class="pk-btns">${btn("o")}${btn("u")}</div>${note} ${syncBadge()}</div>`;
  }
  function syncBadge() {
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
  function row(p, g) {
    const mk = mkt[p.mid];
    const gm = D.games[p.gid];
    const vs = gm ? `${gm.away} @ ${gm.home}` : p.gid;
    const chip = { hit: `<span class="pk-res hit">Hit</span>`, miss: `<span class="pk-res miss">Miss</span>`, push: `<span class="pk-res">Push</span>`, void: `<span class="pk-res">Void</span>` }[g.st] || "";
    const right = g.st === "open" ? `<button class="pk-del" data-del="${esc(p.id)}" aria-label="Remove pick" title="Remove">✕</button>` : chip || `<span class="muted small">${esc(g.why || "")}</span>`;
    return `<div class="pk-row"><div><a class="pname" href="#/player/${esc(p.pid)}">${esc(p.name)}</a> · ${esc(mk ? mk.label : p.mid)} <span class="muted small">W${p.wk} ${esc(vs)} · ${fmtTime(p.ko)}</span>
      <div class="small"><b>${sideWord(p.side)} ${lineNum(p.line)}</b> ${oddsTxt(p.odds)} <span class="muted">(${esc(p.src)}, ${esc(p.book)})</span>${g.act != null ? ` · actual <b>${lineNum(g.act)}</b>` : ""}${g.st === "void" ? ` <span class="muted">· ${esc(g.why)}</span>` : ""}</div></div>${right}</div>`;
  }
  function rec(list) {
    const c = { hit: 0, miss: 0, push: 0 };
    for (const x of list) if (c[x.g.st] != null) c[x.g.st]++;
    const n = c.hit + c.miss;
    return { txt: `${c.hit}–${c.miss}–${c.push}`, pct: n ? `${Math.round((c.hit / n) * 100)}%` : "—", n: c.hit + c.miss + c.push };
  }
  function view() {
    if (!enabled()) return setupView();
    const all = live().map((p) => ({ p, g: grade(p) })).sort((a, b) => (a.p.ko || "").localeCompare(b.p.ko || "") || a.p.name.localeCompare(b.p.name));
    const open = all.filter((x) => x.g.st === "open");
    const locked = all.filter((x) => x.g.st === "locked");
    const graded = all.filter((x) => ["hit", "miss", "push", "void"].includes(x.g.st)).reverse();
    const R = rec(graded), O = rec(graded.filter((x) => x.p.side === "o")), U = rec(graded.filter((x) => x.p.side === "u"));
    const byMk = D.markets.map((m) => ({ m, r: rec(graded.filter((x) => x.p.mid === m.id)) })).filter((x) => x.r.n);
    const st = ST.syncing ? "Saving…" : ST.err ? `<span class="pk-err">Not synced: ${esc(ST.err)}</span> <button id="pk-retry">Retry</button>` :
      ST.dirty ? "Waiting to save" : ST.synced ? `Synced with GitHub ${ago(ST.synced)}` : "Not synced yet";
    let h = `<div class="pk-stats"><div class="pk-stat"><span>Record (W–L–P)</span><b>${R.txt}</b></div><div class="pk-stat"><span>Hit rate</span><b>${R.pct}</b></div></div>
      <p class="small muted">Overs ${O.txt} · Unders ${U.txt}${byMk.length ? " · " + byMk.map((x) => `${esc(x.m.label)} ${x.r.txt}`).join(" · ") : ""} · Hit rate leaves out pushes and voids · ${st}</p>`;
    const sec = (title, list, empty) => `<div class="panel"><h3>${title} (${list.length})</h3><div class="body">${list.length ? list.map((x) => row(x.p, x.g)).join("") : `<p class="muted small">${empty}</p>`}</div></div>`;
    h += sec("Open · you can change these until kickoff", open, "No open picks. Open a player page and tap Over or Under.");
    h += sec("Locked · game started", locked, "Picks move here at kickoff. They can't be changed or removed after that.");
    h += sec("Graded", graded, "Graded picks appear here once the game's stats are published.");
    h += `<p class="muted small">Picks are graded against the line saved when you made the pick (a Mon / Thu / Sun AM snapshot or the pre-game line), not the app's graded line.
      Over hits when the actual stat is above that line; equal = push; a player who doesn't play = void. Locking uses this device's clock and the scheduled kickoff.</p>
      <p class="small"><button id="pk-off">Turn off My picks on this device</button> <span class="muted">Removes the key and local copy from this browser. Your picks stay in your GitHub repo.</span></p>`;
    return h;
  }

  function bind(tab) {
    showTab();
    document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => setPick(b.dataset.pid, b.dataset.pmid, b.dataset.pick)));
    document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => removePick(b.dataset.del)));
    const rt = document.getElementById("pk-retry"); if (rt) rt.addEventListener("click", sync);
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
      await sync();
      rerender();
    });
  }

  window.STIX_PICKS = { enabled, box, view, bind, sync };
  // Hidden way in: tap the Stix logo 3 times within ~1.5 s to open My picks (setup on a device without the key).
  // Needed for the home-screen app, which has its own storage and no address bar.
  (function logoTaps() {
    const brand = document.querySelector("header .brand");
    if (!brand) return;
    let taps = [];
    brand.addEventListener("click", () => {
      const t = Date.now();
      taps = taps.filter((x) => t - x < 1500).concat(t);
      if (taps.length >= 3) { taps = []; location.hash = "#/picks"; }
    });
  })();
  // Keep devices in step: sync when the app comes back into view and every 5 minutes while open.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && D) sync(); });
  setInterval(() => { if (document.visibilityState === "visible" && D) sync(); }, 5 * 60000);
  const first = setInterval(() => { if (D) { clearInterval(first); showTab(); sync(); } }, 300);
})();
