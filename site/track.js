"use strict";
// Stix usage tracking (Michael, 2026-10-27; database: supabase/005_usage_tracking.sql).
// Records which screens are opened and for how long (visible time only), plus a fixed set of button taps, under a
// random device id kept in this browser. When this browser signs in, the device is linked to the account
// (link_device), so its history belongs to that account. Never records typed text or sign-in data.
// Runs only on the live site (and on this computer when testing against a local stand-in). "?me=1" (analytics.js)
// turns it off for this browser, like GoatCounter. Raw events are kept 6 months (database rule).
(function () {
  const ACC = () => window.STIX_ACCOUNT;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const h = location.hostname;
  const live = h === "www.sharpstix.com" || h === "sharpstix.com" || h.endsWith(".github.io");
  const localTest = (h === "localhost" || h === "127.0.0.1") && !!get("stix_supa_test_url");
  if ((!live && !localTest) || get("stix_notrack") === "1" || !ACC() || !ACC().beacon) return;

  let device = get("stix_device");
  if (!/^[0-9a-f-]{36}$/.test(device || "")) {
    device = (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
    set("stix_device", device);
  }
  const ua = navigator.userAgent || "";
  const platform = /iPhone|iPod/.test(ua) ? "iphone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ipad" : /Android/.test(ua) ? "android" : "desktop";
  const standalone = !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone);

  const clean = (s) => String(s ?? "").replace(/[^A-Za-z0-9 ._:|/=+-]/g, "").slice(0, 60);
  const NAME = /^[a-z_]{2,24}$/;
  let queue = [];
  function push(k, n, d, s) {
    if (!NAME.test(n)) return;
    const e = { k, n, t: Date.now() };
    const dd = clean(d); if (dd) e.d = dd;
    if (s != null) e.s = Math.max(0, Math.min(86400, Math.round(s)));
    queue.push(e);
    if (queue.length >= 20) flush(false);
  }
  function flush(closing) {
    if (!queue.length) return;
    const now = Date.now(), batch = queue.splice(0, 50);
    const events = batch.map(({ t, ...e }) => Object.assign(e, { ago: Math.round((now - t) / 1000) }));
    ACC().beacon("/rest/v1/rpc/log_events", { p_device: device, p_events: events, p_platform: platform, p_standalone: standalone }, closing);
    if (queue.length) flush(closing);
  }

  // ---------- screen views (seconds counted only while the page is visible) ----------
  function screen() {
    const [, tab, arg] = (location.hash || "#/board").split("/");
    if (/access_token|error/.test(location.hash)) return null;
    const n = (tab || "board").split("?")[0].toLowerCase().replace(/[^a-z_]/g, "") || "board";
    return { n: n.length >= 2 ? n : "other", d: n === "player" ? arg : "" };
  }
  let cur = null;
  function closeView() {
    if (!cur) return;
    if (cur.since) { cur.ms += Date.now() - cur.since; cur.since = 0; }
    push("view", cur.n, cur.d, cur.ms / 1000);
    cur = null;
  }
  function openView() {
    const s = screen();
    cur = s ? { n: s.n, d: s.d, ms: 0, since: document.visibilityState === "hidden" ? 0 : Date.now() } : null;
  }
  window.addEventListener("hashchange", () => { closeView(); openView(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Close the view so its time is saved even if the app is never reopened; a new view starts on return.
      closeView(); flush(true);
    } else if (!cur) openView();
  });
  window.addEventListener("pagehide", () => { closeView(); flush(true); });
  setInterval(() => flush(false), 20000);

  // ---------- taps (fixed list; details are ids or option values, never typed text) ----------
  document.addEventListener("click", (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    const m = (sel) => t.closest(sel);
    let b;
    if ((b = m("[data-bet]"))) push("tap", "bet_fd", `${b.dataset.bet}|${b.dataset.bmid || ""}|${b.dataset.pid || ""}`);
    else if ((b = m("[data-pick]"))) push("tap", "pick", `${b.dataset.pick}|${b.dataset.pmid || ""}|${b.dataset.pid || ""}`);
    else if ((b = m("[data-del]"))) push("tap", "pick_remove", b.dataset.del);
    else if ((b = m("[data-share]"))) push("tap", "share", b.dataset.share);
    else if ((b = m("[data-upd]"))) push("tap", "updates", b.dataset.upd);
    else if ((b = m("[data-scr]"))) push("tap", "game_script", b.dataset.scr);
    else if ((b = m("[data-rtab]"))) push("tap", "research_lead", b.dataset.rtab);
    else if (m("#alerts-on")) push("tap", "alerts_on");
    else if (m("#alerts-off")) push("tap", "alerts_off");
    else if (m(".su-later")) push("tap", "signin_later");
    else if (m("#ac-google, #su-google, #ac-google-alt, #su-google-alt")) push("tap", "signin_start", "redirect");
  }, true);
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t || !t.matches) return;
    if (t.matches("[data-k]")) push("tap", "filter", `${t.dataset.k}=${t.value}`);
    else if (t.matches("#b-team, #b-game, #b-sort")) push("tap", "board_filter", `${t.id}=${t.value}`);
  }, true);
  document.addEventListener("submit", (ev) => { if (ev.target && ev.target.id === "s-form") push("tap", "search_run"); }, true);

  // ---------- funnels: what was shown vs. what was tapped (Michael, 2026-11-16) ----------
  // "Shown" events fire once per screen view the first time an element appears; taps are the matching clicks. The admin page
  // compares devices per event name, so a feature nobody taps shows up as a low or zero reach. Names only, never typed text.
  const TOUR = { "The Board": "tour_board", "Player pages": "tour_player", "Signal players": "tour_slip", "My picks": "tour_picks" };
  const tourName = () => { const h = document.querySelector(".wl-pg .wl-top h2"); return h ? TOUR[h.textContent.trim()] || "" : ""; };
  const signinVariant = () => { const x = (document.getElementById("su-title") || {}).textContent || ""; return /save your pick/i.test(x) ? "pick" : /see all/i.test(x) ? "signals" : "time"; };
  // [selector, event name (or function), only on these screens]
  const SHOWN = [
    [".wl-pg", tourName],
    ["#su-ov", () => "signin_shown_" + signinVariant()],
    ["#wn-ov", "whatsnew_shown"],
    [".sg-tile[data-sig]", "signals_shown"],
    ["[data-fdall]", "slip_shown"],
    ["[data-pick]", "pick_shown", ["player"]],
    ["[data-bet]", "bet_shown", ["player"]],
    ["[data-scr]", "script_shown", ["player"]],
    ["[data-share]", "share_shown"],
    ["#alerts-on", "alerts_shown"],
  ];
  function scanShown() {
    if (!cur) return;
    cur.shown = cur.shown || new Set();
    for (const [sel, nm, only] of SHOWN) {
      if (only && !only.includes(cur.n)) continue;
      if (!document.querySelector(sel)) continue;
      const name = typeof nm === "function" ? nm() : nm;
      if (!name || cur.shown.has(name)) continue;
      cur.shown.add(name); push("tap", name);
    }
  }
  let scanTimer = 0;
  new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scanShown, 500); }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => { clearTimeout(scanTimer); scanTimer = setTimeout(scanShown, 800); });
  setTimeout(scanShown, 1500);

  document.addEventListener("click", (ev) => {
    const t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    const m = (sel) => t.closest(sel);
    let b;
    if ((b = m("#tabs a[data-tab]"))) push("tap", "tab_" + String(b.dataset.tab).replace(/[^a-z]/g, "").slice(0, 18));
    else if ((b = m("[data-wkpick]"))) push("tap", "week_pick", b.dataset.wkpick);
    else if (m("[data-gid]")) push("tap", "game_chip");
    else if (m("#f-qx")) push("tap", "search_clear");
    else if ((b = m(".sg-tile[data-sig]"))) push("tap", "signal_tile", b.dataset.sig);
    else if ((b = m("[data-rscope]"))) push("tap", "signal_scope", b.dataset.rscope);
    else if ((b = m("[data-fdall]"))) push("tap", "slip_tap", b.dataset.fdall);
    else if (m("[data-rlall]")) push("tap", "signal_checkall");
    else if (m(".intro-links a[href='#/welcome'], .foot a[href='#/welcome']")) push("tap", "tour_open");
    else if ((b = m(".wl-skip"))) { const n = tourName(); if (n) push("tap", n.replace("tour_", "tour_skip_")); }
    else if (m(".wl-cta")) push("tap", "tour_start");
    else if (m("#wn-ov .wn-ok")) push("tap", "whatsnew_ok");
    else if (m("#wn-ov .wn-go")) push("tap", "whatsnew_go");
    else if (m("#wn-ov .wn-x") || t.id === "wn-ov") push("tap", "whatsnew_closed");
    else if (m("#su-ov .wn-x") || t.id === "su-ov") push("tap", "signin_closed");
    else if ((b = m('a[href^="#/player/"]')) && cur) {
      const pid = (b.getAttribute("href").split("/")[2] || "").replace(/[^A-Za-z0-9-]/g, "");
      push("tap", cur.n === "board" ? "open_board" : cur.n === "search" ? "open_signals" : "open_other", pid);
    }
  }, true);
  document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches("[data-rlck]")) push("tap", "signal_check");
  }, true);
  document.addEventListener("input", (ev) => {
    if (ev.target && ev.target.id === "f-q" && cur && !cur.typed) { cur.typed = true; push("tap", "board_search"); }
  }, true);

  // ---------- link this device to the account when signed in ----------
  let linkedFor = null, wasIn = ACC().signedIn();
  function link() {
    const u = ACC().user();
    if (!ACC().signedIn() || !u || linkedFor === u.id) return;
    linkedFor = u.id;
    flush(false);  // anonymous events so far get linked too
    ACC().beacon("/rest/v1/rpc/link_device", { p_device: device }, false);
  }
  ACC().onChange(() => {
    const now = ACC().signedIn();
    if (now && !wasIn) push("tap", "signin_done");
    if (!now) linkedFor = null;
    wasIn = now;
    link();
  });

  openView();
  link();
  window.STIX_TRACK = { device: () => device, flush: () => flush(false) };
})();
