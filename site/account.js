"use strict";
// Stix accounts: sign in with just an email (a link or a 6-digit code is emailed; no password), confirm 21+,
// unit size, sign out, delete account. Talks to Supabase's sign-in and database endpoints directly (no library).
// The publishable key below is meant to be public; the database's own rules decide what each user can read or change.
(function () {
  const PROD_URL = "https://hewbbugkbycdkazlwspq.supabase.co";
  const KEY = "sb_publishable_a_CTgL6PKT4kcUCc6CyJwg_AihMMe3G";
  const LS_SESSION = "stix_session", LS_PENDING = "stix_signin_email";
  // Google sign-in key for sharpstix.com (Google Cloud project stix-513001). A Client ID is public by design; the secret is only in Supabase.
  const GOOGLE_CLIENT_ID = "37075527814-nfibome9bgopush7u6uhcbuh00nt2prt.apps.googleusercontent.com";
  // Email sign-in stays in the code but is hidden: Supabase's built-in email only reaches the project team until an
  // email-sending service is set up (Michael, 2026-10-27: Google only for now). Set to true to show it again.
  const EMAIL_SIGNIN = false;
  const HELP = { name: "1-800-MY-RESET", tel: "+18006973738", url: "https://www.ncpgambling.org/1-800-my-reset-national-problem-gambling-helpline-faq/" };

  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  // Testing only: on this computer (localhost), ?supa=<url> points the app at a local stand-in instead of the real database.
  const BASE = (() => {
    try {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        const q = new URLSearchParams(location.search).get("supa");
        if (q) localStorage.setItem("stix_supa_test_url", q);
        return localStorage.getItem("stix_supa_test_url") || PROD_URL;
      }
    } catch { /* ignore */ }
    return PROD_URL;
  })();

  const A = { session: lsGet(LS_SESSION), profile: null, pending: lsGet(LS_PENDING), msg: "", err: "", busy: false, confirmDelete: false, listeners: [] };
  const signedIn = () => !!(A.session && A.session.access_token);
  const user = () => (A.session ? A.session.user : null);
  const changed = () => A.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

  function jwtPayload(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return {}; }
  }
  function saveSession(s) {
    if (!s || !s.access_token) { A.session = null; lsSet(LS_SESSION, null); return; }
    const p = jwtPayload(s.access_token);
    A.session = {
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: Number(s.expires_at) || (p.exp || 0),
      user: { id: (s.user && s.user.id) || p.sub, email: (s.user && s.user.email) || p.email || "" },
    };
    lsSet(LS_SESSION, A.session);
  }

  // A sign-in link from the email lands here with the session in the address (#access_token=...).
  // "Continue with Google" comes back the same way (Supabase sends the session in the address after Google).
  (function landing() {
    const h = location.hash || "", qs = location.search || "";
    const inHash = /access_token=|error_description=/.test(h), inQuery = /error_description=/.test(qs);
    if (!inHash && !inQuery) return;
    const q = new URLSearchParams(inHash ? h.slice(1) : qs.slice(1));
    if (q.get("access_token")) {
      saveSession({ access_token: q.get("access_token"), refresh_token: q.get("refresh_token"), expires_at: q.get("expires_at") });
      lsSet(LS_PENDING, null); A.pending = null;
    } else {
      A.err = q.get("error_description") ? `Sign-in didn't work: ${q.get("error_description").replace(/\+/g, " ")}. Please try again.` : "";
    }
    try { history.replaceState(null, "", location.pathname + (inQuery ? "" : location.search) + "#/picks"); } catch { location.hash = "#/picks"; }
  })();

  // ---------- requests ----------
  async function raw(path, { method = "GET", body, prefer, auth = true } = {}) {
    const headers = { apikey: KEY };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers.Prefer = prefer;
    if (auth && signedIn()) headers.Authorization = `Bearer ${A.session.access_token}`;
    let r;
    try { r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" }); }
    catch { return { ok: false, status: 0, data: null, error: "No connection. Check your internet and try again." }; }
    let data = null;
    const txt = await r.text();
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    const error = r.ok ? "" : ((data && (data.msg || data.message || data.error_description || data.error)) || `Error ${r.status}`);
    return { ok: r.ok, status: r.status, data, error };
  }
  let refreshing = null;
  async function fresh() {
    if (!signedIn()) return false;
    if (A.session.expires_at && A.session.expires_at - 60 > Date.now() / 1000) return true;
    if (!refreshing) refreshing = (async () => {
      const r = await raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: A.session.refresh_token }, auth: false });
      if (r.ok) saveSession(r.data);
      else if (r.status >= 400 && r.status < 500) { saveSession(null); A.profile = null; A.err = "You were signed out. Sign in again to see your picks."; changed(); }
      return r.ok;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  // Database request as the signed-in user. Signs out cleanly if the session is no longer valid.
  async function db(path, opts = {}) {
    if (!(await fresh())) return { ok: false, status: 401, data: null, error: "Not signed in." };
    const r = await raw(path, opts);
    if (r.status === 401) { saveSession(null); A.profile = null; A.err = "You were signed out. Sign in again to see your picks."; changed(); }
    return r;
  }

  // ---------- sign in / out ----------
  async function sendCode(email) {
    email = (email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { A.err = "Enter a valid email address."; changed(); return; }
    A.lastEmail = email; A.busy = true; A.err = ""; changed();
    const back = encodeURIComponent(location.origin + location.pathname);
    const r = await raw(`/auth/v1/otp?redirect_to=${back}`, { method: "POST", body: { email, create_user: true }, auth: false });
    A.busy = false;
    if (r.ok) { A.pending = { email, at: Date.now() }; lsSet(LS_PENDING, A.pending); A.msg = ""; }
    else A.err = r.status === 429 ? "Too many sign-in emails just now. Wait a minute and try again." : `Couldn't send the email: ${r.error}`;
    changed();
  }
  async function verify(code) {
    code = (code || "").replace(/\D/g, "");
    if (code.length < 6) { A.err = "Enter the code from the email."; changed(); return; }
    A.busy = true; A.err = ""; changed();
    const r = await raw("/auth/v1/verify", { method: "POST", body: { type: "email", email: A.pending.email, token: code }, auth: false });
    A.busy = false;
    if (r.ok) { saveSession(r.data); A.pending = null; lsSet(LS_PENDING, null); await loadProfile(); }
    else A.err = /expired|invalid/i.test(r.error) ? "That code is wrong or expired. Check the newest email, or send a new one." : `Couldn't sign in: ${r.error}`;
    changed();
  }
  // Sign in with Google, main way: Google's own button runs on sharpstix.com, so Google's screen names sharpstix.com
  // (not the Supabase address). Google hands the page a signed ID token; Supabase checks it (audience = our Client ID,
  // nonce = the hash we gave Google) and signs the person in. No redirect, no email.
  const G = { load: null, raw: "", hash: "", failed: false };
  function loadGoogle() {
    if (G.load) return G.load;
    G.load = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      const t = setTimeout(() => reject(new Error("timeout")), 8000);
      s.onload = () => { clearTimeout(t); window.google && window.google.accounts && window.google.accounts.id ? resolve() : reject(new Error("no gis")); };
      s.onerror = () => { clearTimeout(t); reject(new Error("load")); };
      document.head.appendChild(s);
    }).catch((e) => { G.failed = true; throw e; });
    return G.load;
  }
  async function newNonce() {
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    G.raw = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(G.raw)));
    G.hash = Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function onGoogleCredential(resp) {
    if (!resp || !resp.credential) return;
    A.busy = true; A.err = ""; changed();
    const r = await raw("/auth/v1/token?grant_type=id_token", { method: "POST", body: { provider: "google", id_token: resp.credential, nonce: G.raw }, auth: false });
    A.busy = false; G.raw = ""; G.hash = "";
    if (r.ok) { saveSession(r.data); A.pending = null; lsSet(LS_PENDING, null); await loadProfile(); }
    else A.err = `Google sign-in didn't work: ${r.error}. Please try again.`;
    changed();
  }
  // Puts Google's button into #<p>-gis (p = "ac" on the Picks tab, "su" in the first-open pop-up). If Google's script
  // can't load (blocked, offline), the backup button shows instead.
  function googleBlock(p) {
    return `<div id="${p}-gis" class="ac-gis" aria-label="Continue with Google"></div>
      <p id="${p}-google-wrap" hidden><button id="${p}-google" class="ac-google" type="button" ${A.busy ? "disabled" : ""}>Continue with Google</button></p>
      <p id="${p}-google-alt-wrap" class="small muted" hidden>Google button not working? <button id="${p}-google-alt" class="ac-link" type="button">Try the other way</button></p>`;
  }
  function bindGoogle(p) {
    const b = document.getElementById(`${p}-google`), alt = document.getElementById(`${p}-google-alt`);
    if (b) b.addEventListener("click", googleSignIn);
    if (alt) alt.addEventListener("click", googleSignIn);
    mountGoogle(p);
  }
  async function mountGoogle(p = "ac") {
    const el = document.getElementById(`${p}-gis`), alt = document.getElementById(`${p}-google-wrap`), hint = document.getElementById(`${p}-google-alt-wrap`);
    if (!el) return;
    const fallback = () => { el.hidden = true; if (alt) alt.hidden = false; if (hint) hint.hidden = true; };
    if (G.failed) return fallback();
    try {
      await loadGoogle();
      if (!G.hash) await newNonce();
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential, nonce: G.hash, ux_mode: "popup", itp_support: true });
      if (!document.body.contains(el)) return;
      el.innerHTML = "";
      window.google.accounts.id.renderButton(el, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "center", width: Math.min(360, Math.max(200, el.clientWidth || 320)) });
      if (hint) hint.hidden = false;
    } catch { fallback(); }
  }
  // Backup way: Supabase sends the person to Google and back to this page with the session in the address
  // (handled by landing() above). Google's screen names the Supabase address here. Used if Google's button can't load.
  function googleSignIn() {
    const back = encodeURIComponent(location.origin + location.pathname);
    location.href = `${BASE}/auth/v1/authorize?provider=google&redirect_to=${back}`;
  }
  function restart() { A.pending = null; lsSet(LS_PENDING, null); A.err = ""; changed(); }
  async function signOut() {
    if (signedIn()) await raw("/auth/v1/logout", { method: "POST" });
    saveSession(null); A.profile = null; A.confirmDelete = false; A.msg = "Signed out."; changed();
  }

  // ---------- profile ----------
  async function loadProfile() {
    if (!signedIn()) return;
    const r = await db(`/rest/v1/profiles?select=unit_size,age_confirmed_at&id=eq.${encodeURIComponent(user().id)}`);
    if (r.ok && Array.isArray(r.data)) A.profile = r.data[0] || { unit_size: 10, age_confirmed_at: null };
    else if (signedIn()) A.err = `Couldn't load your account: ${r.error}`;
    changed();
  }
  async function patchProfile(fields) {
    const r = await db(`/rest/v1/profiles?id=eq.${encodeURIComponent(user().id)}`, { method: "PATCH", body: fields, prefer: "return=representation" });
    if (r.ok && Array.isArray(r.data) && r.data[0]) { A.profile = r.data[0]; A.err = ""; }
    else A.err = `Couldn't save: ${r.error || "no change saved"}`;
    changed();
    return r.ok;
  }
  const confirmAge = () => patchProfile({ age_confirmed_at: new Date().toISOString() });
  async function setUnit(v) {
    const n = Math.round(Number(v) * 100) / 100;
    if (!isFinite(n) || n <= 0 || n > 100000) { A.err = "Unit size must be between $0.01 and $100,000."; changed(); return; }
    if (await patchProfile({ unit_size: n })) A.msg = `Unit size saved: $${n.toFixed(2)}.`;
    changed();
  }
  async function deleteAccount() {
    A.busy = true; changed();
    const r = await db("/rest/v1/rpc/delete_my_account", { method: "POST", body: {} });
    A.busy = false;
    if (r.ok) { saveSession(null); A.profile = null; A.confirmDelete = false; A.msg = "Your account and all its picks were deleted."; }
    else A.err = `Couldn't delete the account: ${r.error}`;
    changed();
  }
  const unitSize = () => (A.profile && Number(A.profile.unit_size)) || 10;
  const ready = () => signedIn() && A.profile && !!A.profile.age_confirmed_at;

  // ---------- screens (shown inside the Picks tab) ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const helpLine = () => `Gambling problem? Call or text <a href="tel:${HELP.tel}">${HELP.name}</a> (1-800-697-3738), free and confidential. <a href="${HELP.url}" target="_blank" rel="noopener">More help</a>`;
  const note = () => `${A.err ? `<p class="small pk-err" role="alert">${esc(A.err)}</p>` : ""}${A.msg ? `<p class="small ac-ok" role="status">${esc(A.msg)}</p>` : ""}`;
  function privacy() {
    return `<details class="ac-priv"><summary class="small">What we store (privacy)</summary><p class="small muted">
      Your email (to sign you in), your unit size, when you confirmed you're 21+, and the picks you make, with the line, odds and time.
      No password, phone number or payment details. If you use Google, Google shares your email, name and profile picture with our sign-in service (Supabase); Stix uses only your email. We don't sell or share your data. Delete your account any time from this page;
      that removes your email, every pick and your usage history. Stix also records which screens you open, for how long, and which
      buttons you tap (never what you type), linked to your account once you sign in and kept 6 months. Separately,
      <a href="https://www.goatcounter.com" target="_blank" rel="noopener">GoatCounter</a> counts visits anonymously (no cookies). <a href="privacy.html">Full privacy policy</a></p></details>`;
  }
  function signInView() {
    if (A.pending) {
      return `<div class="panel ac"><h3>Check your email</h3><div class="body">
        <p class="small">We sent a sign-in email to <b>${esc(A.pending.email)}</b>. Tap the link in it to finish signing in on this device.</p>
        <form id="ac-code" class="ac-form"><label class="small">Or, if the email shows a 6-digit code, enter it here
          <input id="ac-code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
          <button type="submit" ${A.busy ? "disabled" : ""}>${A.busy ? "Checking…" : "Sign in"}</button></form>
        ${note()}
        <p class="small"><button id="ac-resend" ${A.busy ? "disabled" : ""}>Send a new email</button> <button id="ac-other">Use a different email</button></p>
        <p class="small muted">Can't find it? Check spam or promotions. The email comes from Supabase, our sign-in service.</p>
        </div></div>`;
    }
    return `<div class="panel ac"><h3>Sign in to save your picks</h3><div class="body">
      <p class="small">Free. Your picks are saved to your account, locked at kickoff, and only you can see them.</p>
      ${googleBlock("ac")}
      ${EMAIL_SIGNIN ? `<p class="small muted ac-or">or use your email</p>
      <p class="small">Just your email. No password: we email you a sign-in link.</p>
      <form id="ac-email" class="ac-form" novalidate><label class="small">Email <input id="ac-email-in" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com"></label>
        <button type="submit" ${A.busy ? "disabled" : ""}>${A.busy ? "Sending…" : "Email me a sign-in link"}</button></form>` : ""}
      ${note()}
      <p class="small muted">Stix is for adults 21 and over. ${helpLine()}</p>
      ${privacy()}</div></div>`;
  }
  function ageView() {
    return `<div class="panel ac"><h3>One more step</h3><div class="body">
      <p class="small">Stix is a research tool for sports betting, for adults <b>21 and over</b>.</p>
      <form id="ac-age" class="ac-form"><label class="ac-check"><input type="checkbox" id="ac-age-in"> I am 21 or older.</label>
        <button type="submit" id="ac-age-go" disabled>Continue</button></form>
      ${note()}
      <p class="small muted">${helpLine()}</p>
      <p class="small"><button id="ac-out">Sign out</button></p></div></div>`;
  }
  function loadingView() { return `<div class="panel ac"><div class="body"><p class="muted small">Loading your account…</p>${note()}</div></div>`; }
  // Account box at the bottom of the Picks tab when signed in.
  function accountBox() {
    if (!ready()) return "";
    const del = A.confirmDelete
      ? `<div class="ac-del"><p class="small"><b>Delete your account?</b> This permanently removes your email and every pick. It can't be undone.</p>
          <button id="ac-del-yes" class="ac-danger" ${A.busy ? "disabled" : ""}>${A.busy ? "Deleting…" : "Yes, delete everything"}</button> <button id="ac-del-no">Cancel</button></div>`
      : `<button id="ac-del" class="ac-link">Delete my account</button>`;
    return `<div class="panel ac"><h3>Account</h3><div class="body">
      <p class="small">Signed in as <b>${esc(user().email)}</b> <button id="ac-out">Sign out</button></p>
      <form id="ac-unit" class="ac-form"><label class="small">Unit size ($ per pick) <input id="ac-unit-in" type="number" inputmode="decimal" min="0.01" step="0.01" value="${unitSize()}"></label>
        <button type="submit">Save</button></form>
      <p class="small muted">Every pick counts as 1 unit. Results are tracked in units; dollars = units × your unit size, so changing it rescales your whole record.</p>
      ${note()}
      <p class="small muted">${helpLine()}</p>
      ${privacy()}
      ${del}</div></div>`;
  }
  // What the Picks tab shows before picks: sign in, 21+ step, or nothing (ready).
  function gate() {
    if (!signedIn()) return signInView();
    if (!A.profile) return loadingView();
    if (!A.profile.age_confirmed_at) return ageView();
    return null;
  }

  function bind() {
    const $ = (id) => document.getElementById(id);
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    if (document.getElementById("ac-gis")) bindGoogle("ac");
    on("ac-email", "submit", (e) => { e.preventDefault(); sendCode($("ac-email-in").value); });
    on("ac-code", "submit", (e) => { e.preventDefault(); verify($("ac-code-in").value); });
    on("ac-resend", "click", () => sendCode(A.pending && A.pending.email));
    on("ac-other", "click", restart);
    on("ac-out", "click", signOut);
    on("ac-age-in", "change", () => { $("ac-age-go").disabled = !$("ac-age-in").checked; });
    on("ac-age", "submit", (e) => { e.preventDefault(); if ($("ac-age-in").checked) confirmAge(); });
    on("ac-unit", "submit", (e) => { e.preventDefault(); setUnit($("ac-unit-in").value); });
    on("ac-del", "click", () => { A.confirmDelete = true; A.err = ""; A.msg = ""; changed(); });
    on("ac-del-no", "click", () => { A.confirmDelete = false; changed(); });
    on("ac-del-yes", "click", deleteAccount);
    const ei = $("ac-email-in"); if (ei && A.lastEmail) ei.value = A.lastEmail;
  }
  function onChange(f) { A.listeners.push(f); }

  // Fire-and-forget POST used by usage tracking (track.js). keepalive lets it finish while the page is closing.
  // Sends the sign-in token only while it's still valid, so an expired token never loses the events.
  function beacon(path, body, keepalive) {
    const headers = { apikey: KEY, "Content-Type": "application/json" };
    if (signedIn() && (A.session.expires_at || 0) * 1000 > Date.now() + 60000) headers.Authorization = `Bearer ${A.session.access_token}`;
    try { return fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body), keepalive: !!keepalive, cache: "no-store" }).catch(() => null); }
    catch { return Promise.resolve(null); }
  }

  window.STIX_ACCOUNT = { signedIn, ready, user, unitSize, gate, accountBox, bind, onChange, db, loadProfile, googleBlock, bindGoogle, helpLine, beacon,
    error: () => A.err, clearNotes: () => { A.msg = ""; A.err = ""; } };
  if (signedIn()) loadProfile();
})();
