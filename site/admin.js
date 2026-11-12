"use strict";
// Stix admin page (#/admin, opened by tapping the Stix logo 3 times): site traffic and site users.
// Data comes from admin-only database functions (supabase/006_admin.sql); anyone can open the page, but the
// database returns nothing unless the signed-in account is in the admins table.
(function () {
  const ACC = () => window.STIX_ACCOUNT;
  const inclKey = "stix_admin_include_me";
  const getIncl = () => { try { return localStorage.getItem(inclKey) === "1"; } catch { return false; } };
  const AD = { incl: getIncl(), days: 30, traffic: null, users: null, err: "", denied: false, loading: false, loadedFor: null, sel: null, activity: null, actErr: "", tab: "traffic" };
  // Tweet plan tab (supabase/015_tweet_plan.sql): edits are held here until "Submit changes"; Claude acts on the request.
  const TP = { data: null, err: "", loading: false, edits: {}, openText: {}, msg: "", sending: false };
  const TP_STATUS = ["Not drafted", "Drafted (chat only)", "Scheduled on X", "Posted", "Failed / skipped", "Manual"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (n) => Number(n || 0).toLocaleString("en-US");
  const dur = (s) => { s = Math.round(Number(s) || 0); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`; return `${Math.floor(m / 60)}h ${m % 60}m`; };
  const when = (t) => t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  const day = (t) => t ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  // playerById is app.js's lookup (a top-level const, so shared by name between the page's scripts, not on window).
  const playerName = (id) => { try { const p = typeof playerById !== "undefined" ? playerById[id] : null; return p ? `${p.name} (${p.team} ${p.pos})` : id; } catch { return id; } };
  const SCREEN = { board: "Board", player: "Player page", search: "Research", leads: "Results", defense: "Defense", guide: "Guide", picks: "Picks", admin: "Admin", slots: "Guide (slots)", log: "Guide (log)", other: "Other" };
  const TAP = { pick: "Pick Over/Under", pick_remove: "Remove pick", bet_fd: "Bet on FanDuel", share: "Share", updates: "Player updates", game_script: "Game script", research_lead: "Research lead", filter: "Research filter", board_filter: "Board filter", search_run: "Run search", all_players: "All players switch", alerts_on: "Alerts on", alerts_off: "Alerts off", signin_start: "Sign-in started", signin_done: "Signed in", signin_later: "Sign-in pop-up: Not now" };
  const detailText = (name, d) => {
    if (!d) return "";
    if (name === "player" || name === "share" || name === "updates" || name === "pick_remove") return playerName(d.split("|").pop());
    if (name === "pick" || name === "bet_fd") { const [side, mk, pid] = d.split("|"); return `${side === "o" ? "Over" : side === "u" ? "Under" : side} · ${mk} · ${playerName(pid)}`; }
    return d;
  };

  async function load() {
    if (!ACC() || !ACC().signedIn() || AD.loading) return;
    AD.loading = true; AD.err = ""; AD.denied = false; rerender();
    const [t, u] = await Promise.all([
      ACC().db("/rest/v1/rpc/admin_traffic", { method: "POST", body: { p_days: AD.days, p_include_admins: AD.incl } }),
      ACC().db("/rest/v1/rpc/admin_users", { method: "POST", body: {} }),
    ]);
    AD.loading = false; AD.loadedFor = `${ACC().user().id}|${AD.days}|${AD.incl}`;
    if (!t.ok || !u.ok) {
      const e = (!t.ok ? t : u);
      if (/not allowed|permission|42501|404/i.test(`${e.error} ${e.status}`)) AD.denied = true; else AD.err = e.error || "Couldn't load.";
      AD.traffic = null; AD.users = null;
    } else { AD.traffic = t.data; AD.users = u.data || []; }
    rerender();
  }
  async function loadActivity(uid) {
    AD.sel = uid; AD.activity = null; AD.actErr = ""; rerender();
    const r = await ACC().db("/rest/v1/rpc/admin_user_activity", { method: "POST", body: { p_user: uid } });
    if (AD.sel !== uid) return;
    if (r.ok) AD.activity = r.data || []; else AD.actErr = r.error || "Couldn't load.";
    rerender();
  }
  function rerender() { if ((location.hash || "").startsWith("#/admin") && typeof window.render === "function") window.render(); }
  // Verify Results-only research access using the same server-enforced admin RPC.
  // A signed-in account alone never grants access, and localStorage cannot grant it.
  const RA = { userId: null, allowed: false, pending: false, checked: false };
  function isResearchAdmin() {
    const acc = ACC(), uid = acc?.signedIn() ? acc.user()?.id : null;
    if (!uid) return false;
    if (RA.userId !== uid) { RA.userId=uid; RA.allowed=false; RA.checked=false; RA.pending=false; }
    if (!RA.checked && !RA.pending) {
      RA.pending=true;
      acc.db("/rest/v1/rpc/admin_users", { method:"POST", body:{} })
        .then((r) => {
          // Only a successful, server-authorized RPC establishes admin status.
          if (RA.userId === uid) { RA.allowed=!!r?.ok; RA.checked=true; }
        })
        .catch(() => { if (RA.userId === uid) { RA.allowed=false; RA.checked=true; } })
        .finally(() => {
          if (RA.userId !== uid) return;
          RA.pending=false;
          if ((location.hash || "").startsWith("#/leads") && typeof render === "function") render();
        });
    }
    return RA.checked && RA.allowed;
  }

  // ---------- pieces ----------
  const card = (label, value, sub) => `<div class="ad-card"><div class="ad-l">${esc(label)}</div><div class="ad-v">${value}</div>${sub ? `<div class="ad-s">${sub}</div>` : ""}</div>`;
  function bars(perDay) {
    if (!perDay.length) return `<p class="muted small">No visits recorded in this period yet.</p>`;
    const max = Math.max(1, ...perDay.map((x) => x.devices));
    return `<div class="ad-bars" role="img" aria-label="Visitors per day">${perDay.map((x) => {
      const h = Math.max(3, Math.round((x.devices / max) * 100));
      const lab = new Date(x.day + "T12:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
      return `<div class="ad-bar" title="${esc(lab)}: ${x.devices} visitors, ${x.views} screen views, ${dur(x.secs)}"><span class="ad-bn">${x.devices}</span><i style="height:${h}%"></i><span class="ad-bl">${esc(lab)}</span></div>`;
    }).join("")}</div>`;
  }
  const table = (head, rows) => `<div class="ad-tw"><table class="ad-t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="muted">None yet</td></tr>`}</tbody></table></div>`;

  function dashboard() {
    const t = AD.traffic, users = AD.users || [];
    const since = Date.now() - AD.days * 864e5;
    const newUsers = users.filter((u) => new Date(u.created_at).getTime() >= since).length;
    const avg = t.views ? t.view_secs / t.views : 0;
    const chips = [7, 30, 90].map((d) => `<button class="gchip ${AD.days === d ? "on" : ""}" data-addays="${d}">${d} days</button>`).join("");
    const screens = (t.screens || []).map((s) => `<tr><td>${esc(SCREEN[s.name] || s.name)}</td><td class="num">${fmtN(s.views)}</td><td class="num">${fmtN(s.devices)}</td><td class="num">${dur(s.secs)}</td><td class="num">${dur(s.views ? s.secs / s.views : 0)}</td></tr>`);
    const taps = (t.taps_by_name || []).map((s) => `<tr><td>${esc(TAP[s.name] || s.name)}</td><td class="num">${fmtN(s.count)}</td><td class="num">${fmtN(s.devices)}</td></tr>`);
    const players = (t.players || []).map((s) => `<tr><td><a href="#/player/${esc(s.id)}">${esc(playerName(s.id))}</a></td><td class="num">${fmtN(s.visitors)}</td><td class="num">${fmtN(s.visits ?? s.views)}</td><td class="num">${dur(s.secs)}</td></tr>`);
    const plats = (t.platforms || []).map((s) => `<tr><td>${esc(s.platform)}${s.home_screen ? " · home-screen app" : ""}</td><td class="num">${fmtN(s.devices)}</td></tr>`);
    const urows = users.map((u) => `<tr class="ad-u ${AD.sel === u.user_id ? "on" : ""}" data-aduser="${esc(u.user_id)}" tabindex="0">
      <td>${esc(u.email)}</td><td>${esc(u.provider)}</td><td>${day(u.created_at)}</td><td>${when(u.last_active || u.last_sign_in_at)}</td>
      <td class="num">${fmtN(u.picks)}</td><td class="num">${fmtN(u.views)}</td><td class="num">${dur(u.view_secs)}</td><td class="num">${fmtN(u.taps)}</td><td>${u.age_confirmed ? "✓" : "—"}</td></tr>`);
    let act = "";
    if (AD.sel) {
      const u = users.find((x) => x.user_id === AD.sel);
      const rows = (AD.activity || []).map((e) => `<tr><td>${when(e.at)}</td><td>${e.kind === "view" ? esc(SCREEN[e.name] || e.name) : esc(TAP[e.name] || e.name)}</td><td>${esc(detailText(e.name, e.detail))}</td><td class="num">${e.kind === "view" ? dur(e.secs) : ""}</td></tr>`);
      act = `<div class="panel"><h3>Recent activity · ${esc(u ? u.email : "")} <button class="ad-x" id="ad-close" aria-label="Close">✕</button></h3><div class="body">
        ${AD.actErr ? `<p class="pk-err small">${esc(AD.actErr)}</p>` : AD.activity ? table(["When", "Screen / tap", "Detail", "Time"], rows) : `<p class="muted small">Loading…</p>`}
        <p class="muted small">Latest 200 events.</p></div></div>`;
    }
    return `<div class="ad">
      ${tabsBar()}
      <div class="ad-head"><h2>Stix admin</h2><div class="ad-chips">${chips}<button id="ad-refresh">Refresh</button>
        <label class="ad-incl"><input type="checkbox" id="ad-incl" ${AD.incl ? "checked" : ""}> Include my activity</label></div></div>
      <p class="muted small ad-note">${AD.incl ? "Traffic includes admin accounts (you)." : "Traffic leaves out admin accounts (you), including what a device did before you signed in on it."}</p>
      <div class="ad-cards">
        ${card("Visitors", fmtN(t.devices), "browsers / devices")}
        ${card("Signed-in users active", fmtN(t.active_users), `${fmtN(t.signed_in_devices)} of ${fmtN(t.devices)} devices signed in`)}
        ${card("Accounts", fmtN(users.length), `${fmtN(newUsers)} new in ${AD.days} days`)}
        ${card("Screen views", fmtN(t.views), `avg ${dur(avg)} each`)}
        ${card("Time in app", dur(t.view_secs), "visible time")}
        ${card("Taps", fmtN(t.taps), "tracked buttons")}
      </div>
      <div class="panel"><h3>Visitors per day</h3><div class="body">${bars(t.per_day || [])}</div></div>
      <div class="ad-grid">
        <div class="panel"><h3>Screens</h3><div class="body">${table(["Screen", "Views", "Visitors", "Total time", "Avg"], screens)}</div></div>
        <div class="panel"><h3>Taps</h3><div class="body">${table(["Button", "Taps", "Visitors"], taps)}</div></div>
        <div class="panel"><h3>Most-viewed players</h3><div class="body">${table(["Player", "Visitors", "Visits", "Time"], players)}<p class="muted small">Ranked by visitors (devices), then visits. A visit = a look at the player 30+ min after the last one on the same device, so switching apps and back isn't counted again.</p></div></div>
        <div class="panel"><h3>Devices</h3><div class="body">${table(["Device", "Visitors"], plats)}</div></div>
      </div>
      <div class="panel"><h3>Users (${fmtN(users.length)})</h3><div class="body">
        ${table(["Email", "Sign-in", "Joined", "Last active", "Picks", "Views", "Time", "Taps", "21+"], urows)}
        <p class="muted small">Tap a user to see their recent activity. Views, time and taps are all-time (kept 6 months).</p></div></div>
      ${act}
      <p class="muted small">Last ${AD.days} days, Central time. Time on screen counts only while Stix is visible and can be undercounted when an iPhone app is closed. Browsers opened once with <code>?me=1</code> aren't tracked.
        Anonymous page counts are also in <a href="https://sharpstix.goatcounter.com" target="_blank" rel="noopener">GoatCounter</a>.</p>
    </div>`;
  }

  // ---------- Tweet plan tab ----------
  const tabsBar = () => `<div class="ad-tabs"><button class="gchip ${AD.tab === "traffic" ? "on" : ""}" data-adtab="traffic">Traffic &amp; users</button><button class="gchip ${AD.tab === "tweets" ? "on" : ""}" data-adtab="tweets">Tweet plan</button></div>`;
  async function loadTweets() {
    if (!ACC() || !ACC().signedIn() || TP.loading) return;
    TP.loading = true; TP.err = ""; rerender();
    const r = await ACC().db("/rest/v1/rpc/admin_tweet_plan", { method: "POST", body: {} });
    TP.loading = false;
    if (r.ok) TP.data = r.data; else TP.err = /404|42501|not allowed/i.test(`${r.error} ${r.status}`) ? "The tweet plan isn't set up in the database yet (run supabase/015_tweet_plan.sql)." : (r.error || "Couldn't load.");
    rerender();
  }
  const tpChangeCount = () => Object.values(TP.edits).reduce((n, f) => n + Object.keys(f).length, 0);
  function tweetsPage() {
    if (!TP.data && !TP.loading && !TP.err) setTimeout(loadTweets, 0);
    if (TP.err) return `<div class="ad">${tabsBar()}<div class="panel ac"><h3>Tweet plan</h3><div class="body"><p class="small pk-err">${esc(TP.err)}</p><button id="tp-reload">Try again</button></div></div></div>`;
    if (!TP.data) return `<div class="ad">${tabsBar()}<p class="muted pad">Loading tweet plan…</p></div>`;
    const plan = TP.data.plan || [], reqs = TP.data.requests || [];
    const pending = {};
    reqs.filter((q) => q.status === "pending").forEach((q) => (q.changes || []).forEach((c) => { pending[c.slot_key] = Object.assign(pending[c.slot_key] || {}, c.fields); }));
    const val = (row, f) => (TP.edits[row.slot_key] && f in TP.edits[row.slot_key]) ? TP.edits[row.slot_key][f] : (row[f] ?? "");
    const inp = (row, f, w) => `<input class="tp-in ${TP.edits[row.slot_key] && f in TP.edits[row.slot_key] ? "dirty" : ""}" style="min-width:${w}px" data-tpk="${esc(row.slot_key)}" data-tpf="${f}" value="${esc(val(row, f))}" aria-label="${f} for ${esc(row.slot)}">`;
    let lastDay = null;
    const rows = plan.map((r) => {
      const head = r.day_label !== lastDay ? `<tr class="tp-day"><td colspan="8">${esc(r.day_label || "")}</td></tr>` : ""; lastDay = r.day_label;
      const st = val(r, "status");
      const sel = `<select class="tp-in ${TP.edits[r.slot_key] && "status" in TP.edits[r.slot_key] ? "dirty" : ""}" style="min-width:150px" data-tpk="${esc(r.slot_key)}" data-tpf="status" aria-label="Status for ${esc(r.slot)}">${TP_STATUS.map((o) => `<option ${o === st ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      const pend = pending[r.slot_key] ? `<span class="tp-pend" title="${esc(JSON.stringify(pending[r.slot_key]))}">Claude is working on a change</span>` : "";
      const open = TP.openText[r.slot_key];
      return head + `<tr class="tp-r"><td data-l="Slot"><b>${esc(r.slot)}</b></td><td data-l="Tweet about">${inp(r, "topic", 220)}</td><td data-l="Data first available" class="muted small">${esc(r.data_ready || "")}</td><td data-l="Draft run" class="muted small">${esc(r.draft_run || "")}</td>
        <td data-l="Post time">${inp(r, "post_time", 90)}</td><td data-l="Status">${sel}</td><td data-l="Scheduled on X for" class="small">${esc(r.x_time || "—")} ${pend}</td><td data-l="Notes">${inp(r, "notes", 200)} <button class="tp-txt" data-tptext="${esc(r.slot_key)}">${open ? "Hide text" : "Tweet text"}</button></td></tr>`
        + (open ? `<tr class="tp-tr"><td class="tp-e"></td><td colspan="7" data-l="Tweet text"><textarea class="tp-ta ${TP.edits[r.slot_key] && "tweet_text" in TP.edits[r.slot_key] ? "dirty" : ""}" rows="5" data-tpk="${esc(r.slot_key)}" data-tpf="tweet_text" placeholder="Tweet text for this slot (Claude uses it instead of drafting one)">${esc(val(r, "tweet_text"))}</textarea></td></tr>` : "");
    }).join("");
    const n = tpChangeCount();
    const reqRows = reqs.slice(0, 8).map((q) => {
      const what = (q.changes || []).map((c) => { const p = plan.find((x) => x.slot_key === c.slot_key); return `${esc(p ? p.slot : c.slot_key)}: ${Object.entries(c.fields).map(([k, v]) => `${esc(k.replace("_", " "))} → ${esc(String(v ?? "").slice(0, 60))}`).join(", ")}`; }).join("<br>");
      return `<tr><td>${when(q.created_at)}</td><td>${what}</td><td>${esc(q.status === "needs_attention" ? "Needs attention" : q.status === "done" ? "Done" : "Waiting for Claude")}</td><td class="small">${esc(q.result || "")}</td></tr>`;
    });
    return `<div class="ad">${tabsBar()}
      <div class="ad-head"><h2>Tweet plan</h2><div class="ad-chips"><button id="tp-reload">Refresh</button></div></div>
      ${TP.data.agent_configured ? "" : `<p class="pk-err small">Claude's task isn't connected yet (no agent token set), so submitted changes will wait. See the end of supabase/015_tweet_plan.sql.</p>`}
      <p class="muted small ad-note">Change a post time, status, topic, note or the tweet text, then press Submit changes. Claude picks it up (about every 15 minutes), carries it out in X, and the result shows below. "Scheduled on X for" is only updated by Claude after it has actually done it.</p>
      <div class="tp-bar"><button id="tp-submit" class="gchip on" ${n && !TP.sending ? "" : "disabled"}>${TP.sending ? "Sending…" : `Submit changes${n ? ` (${n})` : ""}`}</button><button id="tp-discard" ${n ? "" : "disabled"}>Discard edits</button><span id="tp-msg" class="small ${/^Couldn't|^Not/.test(TP.msg) ? "pk-err" : "muted"}">${esc(TP.msg)}</span></div>
      <div class="panel"><div class="body"><div class="ad-tw"><table class="ad-t tp-t"><thead><tr><th>Slot</th><th>Tweet about</th><th>Data first available</th><th>Draft run</th><th>Post time</th><th>Status</th><th>Scheduled on X for</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>
      <div class="panel"><h3>Requests to Claude</h3><div class="body">${table(["Sent", "What", "State", "Claude's result"], reqRows)}</div></div>
    </div>`;
  }
  function tpUpdateBar() {
    const n = tpChangeCount(), b = document.getElementById("tp-submit"), d = document.getElementById("tp-discard");
    if (b) { b.disabled = !n || TP.sending; b.textContent = `Submit changes${n ? ` (${n})` : ""}`; }
    if (d) d.disabled = !n;
  }
  function tweetsBind() {
    document.querySelectorAll("[data-tpk]").forEach((el) => {
      const on = () => {
        const k = el.dataset.tpk, f = el.dataset.tpf, row = (TP.data.plan || []).find((x) => x.slot_key === k); if (!row) return;
        const base = row[f] ?? "";
        if (el.value === base) { if (TP.edits[k]) { delete TP.edits[k][f]; if (!Object.keys(TP.edits[k]).length) delete TP.edits[k]; } }
        else { (TP.edits[k] = TP.edits[k] || {})[f] = el.value; }
        el.classList.toggle("dirty", el.value !== base); TP.msg = ""; const m = document.getElementById("tp-msg"); if (m) m.textContent = "";
        tpUpdateBar();
      };
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", on);
    });
    document.querySelectorAll("[data-tptext]").forEach((b) => b.addEventListener("click", () => { TP.openText[b.dataset.tptext] = !TP.openText[b.dataset.tptext]; rerender(); }));
    const rl = document.getElementById("tp-reload"); if (rl) rl.addEventListener("click", () => { TP.data = null; TP.err = ""; TP.msg = ""; loadTweets(); });
    const dc = document.getElementById("tp-discard"); if (dc) dc.addEventListener("click", () => { TP.edits = {}; TP.msg = ""; rerender(); });
    const sb = document.getElementById("tp-submit");
    if (sb) sb.addEventListener("click", async () => {
      const changes = Object.entries(TP.edits).map(([slot_key, fields]) => ({ slot_key, fields }));
      if (!changes.length || TP.sending) return;
      TP.sending = true; TP.msg = ""; rerender();
      const r = await ACC().db("/rest/v1/rpc/admin_tweet_submit", { method: "POST", body: { p_changes: changes } });
      TP.sending = false;
      if (r.ok) { TP.edits = {}; TP.msg = "Sent. Claude will pick it up within about 15 minutes."; TP.data = null; loadTweets(); }
      else { TP.msg = `Couldn't send: ${r.error || "try again"}`; rerender(); }
    });
  }

  function view() {
    if (!ACC()) return `<p class="pad">Admin page didn't load. Try refreshing.</p>`;
    if (!ACC().signedIn()) {
      return `<div class="panel ac"><h3>Stix admin</h3><div class="body"><p class="small">Sign in with your admin account.</p>${ACC().googleBlock("ad")}</div></div>`;
    }
    const key = `${ACC().user().id}|${AD.days}|${AD.incl}`;
    if (AD.loadedFor !== key && !AD.loading) setTimeout(load, 0);
    if (AD.loading || AD.loadedFor !== key) return `<p class="muted pad">Loading admin data…</p>`;
    if (AD.denied) return `<div class="panel ac"><h3>Stix admin</h3><div class="body"><p class="small">This page is only for Stix admins. You're signed in as <b>${esc(ACC().user().email)}</b>.</p></div></div>`;
    if (AD.err) return `<div class="panel ac"><h3>Stix admin</h3><div class="body"><p class="small pk-err">${esc(AD.err)}</p><button id="ad-refresh">Try again</button></div></div>`;
    return AD.tab === "tweets" ? tweetsPage() : dashboard();
  }
  function bind() {
    document.querySelectorAll("[data-adtab]").forEach((b) => b.addEventListener("click", () => { AD.tab = b.dataset.adtab; rerender(); }));
    if (AD.tab === "tweets") { tweetsBind(); return; }
    if (document.getElementById("ad-gis")) ACC().bindGoogle("ad");
    document.querySelectorAll("[data-addays]").forEach((b) => b.addEventListener("click", () => { AD.days = Number(b.dataset.addays); AD.sel = null; load(); }));
    const inc = document.getElementById("ad-incl");
    if (inc) inc.addEventListener("change", () => { AD.incl = inc.checked; try { localStorage.setItem(inclKey, AD.incl ? "1" : "0"); } catch { /* ignore */ } AD.sel = null; load(); });
    const r = document.getElementById("ad-refresh"); if (r) r.addEventListener("click", () => { AD.loadedFor = null; load(); });
    document.querySelectorAll("[data-aduser]").forEach((tr) => {
      const go = () => loadActivity(tr.dataset.aduser);
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    const x = document.getElementById("ad-close"); if (x) x.addEventListener("click", () => { AD.sel = null; AD.activity = null; rerender(); });
  }
  if (ACC()) ACC().onChange(() => { AD.loadedFor = null; AD.traffic = null; AD.users = null; AD.sel = null; RA.userId=null; RA.checked=false; RA.allowed=false; rerender(); });
  // Fresh numbers every time the admin page is opened (not the ones loaded on an earlier visit).
  window.addEventListener("hashchange", (e) => {
    const was = (e.oldURL || "").includes("#/admin"), now = (location.hash || "").startsWith("#/admin");
    if (now && !was) { AD.loadedFor = null; AD.sel = null; AD.activity = null; }
  });
  // Coming back to the app (or tab) while the admin page is open: reload so the numbers aren't from earlier.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (location.hash || "").startsWith("#/admin") && ACC() && ACC().signedIn()) { AD.loadedFor = null; load(); }
  });
  window.STIX_ADMIN = { view, bind, isResearchAdmin };
})();
