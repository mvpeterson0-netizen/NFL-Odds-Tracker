"use strict";
// "Add Stix to your Home Screen" guide (Michael, 2026-11-28). iPhone/iPad only; never shown inside the installed app.
// Apple gives websites no install button on iPhone, so this tells people exactly where to tap:
//  • A slim bar at the bottom names the first tap (iOS 26 Safari: ⋯ next to the address bar; older Safari: Share).
//    Tapping the bar opens a numbered step sheet for the browser they're in.
//  • In an app's built-in browser (X, Instagram, ...) Add to Home Screen doesn't exist, so the sheet offers
//    "Open in Safari" (x-safari-https link; some apps may block it) and "Copy link". The Safari link carries
//    ?install=1 so the guide opens by itself once Safari loads.
//  • The bar appears after SHOW_AFTER_S seconds on any page except the Welcome tour, and not while a pop-up is open.
//    ✕ hides it for HIDE_DAYS days in this browser. sharpstix.com/?install=1 opens the sheet right away (for posts, QR codes).
//  • A "Add to Home Screen" item is added under Guide in the More+ menu (iPhone/iPad, not installed).
(function () {
  const SHOW_AFTER_S = 15, HIDE_DAYS = 14, KEY = "stix_install_hide";
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  const forced = /[?&]install(=|&|$)/.test(location.search);
  if (standalone) return;
  if (!isIOS && !forced) return;

  // Which browser. In-app browsers are matched by name, or by an iOS web view that leaves "Safari/" out of its name.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Twitter|LinkedInApp|Snapchat|TikTok|musical_ly|Bytedance|Pinterest|Reddit|Discord|GSA\/|Line\//.test(ua)
    || (isIOS && !/Safari\//.test(ua));
  const chrome = !inApp && /CriOS/.test(ua);
  const otherBrowser = !inApp && !chrome && /FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave/.test(ua);
  const safari = isIOS && !inApp && !chrome && !otherBrowser;
  const ver = (() => { const m = ua.match(/Version\/(\d+)/) || ua.match(/OS (\d+)_/); return m ? Number(m[1]) : 0; })();
  const newSafari = safari && ver >= 26; // iOS 26: Share moved behind ⋯ next to the address bar
  const kind = !isIOS ? "desktop" : inApp ? "inapp" : chrome ? "chrome" : otherBrowser ? "other" : newSafari ? "safari26" : "safari";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Small drawn icons that look like the buttons people tap.
  const I = {
    dots: '<span class="ig-ic" aria-label="⋯"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span>',
    share: '<span class="ig-ic" aria-label="Share"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg></span>',
    plus: '<span class="ig-ic" aria-label="Add"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg></span>',
  };
  const logo = '<img src="icons/icon-64.png" alt="" width="34" height="34" class="ig-logo">';

  function hidden() { try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch (e) { return !!window.__stixIgHide; } }
  function hideForDays() { window.__stixIgHide = true; try { localStorage.setItem(KEY, String(Date.now() + HIDE_DAYS * 864e5)); } catch (e) { /* storage blocked: hidden for this page load */ } }
  const onWelcome = () => (location.hash || "").startsWith("#/welcome");
  const popupOpen = () => !!document.querySelector("#su-ov, #wn-ov, .share-ov, .rl-dkpop, #ig-ov");

  // ---------- the steps for each browser ----------
  function steps() {
    if (kind === "safari26") return [
      `Tap ${I.dots} at the bottom right, next to the address bar.`,
      `Tap ${I.share} <b>Share</b>.`,
      `Tap ${I.plus} <b>Add to Home Screen</b>. (Scroll down or tap <b>View More</b> if you don't see it.)`,
      `Tap <b>Add</b>. Stix opens from your Home Screen like an app.`,
    ];
    if (kind === "safari") return [
      `Tap ${I.share} <b>Share</b> at the bottom of the screen (at the top on iPad).`,
      `Scroll down and tap ${I.plus} <b>Add to Home Screen</b>.`,
      `Tap <b>Add</b>. Stix opens from your Home Screen like an app.`,
    ];
    if (kind === "chrome") return [
      `Tap ${I.share} <b>Share</b> in the address bar at the top.`,
      `Tap ${I.plus} <b>Add to Home Screen</b>. (Scroll down if you don't see it.)`,
      `Tap <b>Add</b>. If Chrome doesn't offer it, open sharpstix.com in Safari instead.`,
    ];
    return [];
  }
  function barLine() {
    if (kind === "safari26") return `Tap ${I.dots} below, then <b>Share</b> → <b>Add to Home Screen</b>`;
    if (kind === "safari") return `Tap ${I.share} below, then <b>Add to Home Screen</b>`;
    if (kind === "chrome") return `Tap ${I.share} at the top, then <b>Add to Home Screen</b>`;
    return "Open in Safari to add it. Tap here";
  }

  function sheetBody() {
    if (kind === "desktop") return `<p>Open <b>sharpstix.com</b> on your iPhone in Safari, then come back to this guide (<b>sharpstix.com/?install=1</b>).</p>`;
    if (kind === "inapp" || kind === "other") {
      const where = kind === "inapp" ? "this app's built-in browser" : "this browser";
      return `<p>Add to Home Screen isn't available in ${where}. Open Stix in <b>Safari</b> first — the steps will be waiting there.</p>
        <div class="ig-acts"><a class="ig-btn ig-main" id="ig-safari" href="${esc(safariLink())}">Open in Safari</a>
        <button type="button" class="ig-btn" id="ig-copy">Copy link</button></div>
        <p class="small muted" id="ig-copied">If Open in Safari does nothing, look for ${I.dots} or ${I.share} in this app and choose <b>Open in Safari</b> or <b>Open in browser</b>, or paste the copied link into Safari.</p>`;
    }
    return `<ol class="ig-steps">${steps().map((s, i) => `<li><span class="ig-n">${i + 1}</span><span>${s}</span></li>`).join("")}</ol>
      <p class="small muted">Free, nothing to download from the App Store. Remove it any time like any other app.</p>`;
  }
  function installUrl() {
    const u = new URL(location.href);
    u.searchParams.set("install", "1");
    return u.href;
  }
  const safariLink = () => installUrl().replace(/^https?:\/\//, "x-safari-https://");

  // ---------- bar ----------
  let bar = null;
  function showBar() {
    if (bar || hidden() || onWelcome() || popupOpen()) return;
    bar = document.createElement("div");
    bar.id = "ig-bar"; bar.className = `ig-bar ig-${kind}`;
    bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Add Stix to your Home Screen");
    bar.innerHTML = `<button type="button" class="ig-open" aria-label="Show how to add Stix to your Home Screen">${logo}
        <span class="ig-txt"><b>Add Stix to your Home Screen</b><span class="ig-sub">${barLine()}</span></span></button>
      <button type="button" class="ig-x" aria-label="Hide for now">✕</button>
      ${kind === "safari26" || kind === "safari" ? '<span class="ig-arrow" aria-hidden="true">↓</span>' : ""}`;
    document.body.appendChild(bar);
    document.body.classList.add("ig-has-bar");
  }
  function removeBar() { if (bar) { bar.remove(); bar = null; } document.body.classList.remove("ig-has-bar"); }

  // ---------- sheet ----------
  function openSheet() {
    if (document.getElementById("ig-ov")) return;
    const ov = document.createElement("div");
    ov.id = "ig-ov"; ov.className = "ig-ov";
    ov.innerHTML = `<div class="ig-sheet" role="dialog" aria-modal="true" aria-labelledby="ig-h">
      <div class="ig-hd">${logo}<h3 id="ig-h">Add Stix to your Home Screen</h3><button type="button" class="ig-close" aria-label="Close">✕</button></div>
      ${sheetBody()}
      <button type="button" class="ig-btn ig-done">Got it</button></div>`;
    document.body.appendChild(ov);
    if (bar) bar.hidden = true;
  }
  function closeSheet() {
    const ov = document.getElementById("ig-ov"); if (ov) ov.remove();
    if (bar) bar.hidden = false;
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.closest) return;
    if (t.closest("[data-install]")) { e.preventDefault(); closeMenu(); openSheet(); return; }
    if (t.closest("#ig-bar .ig-x")) { hideForDays(); removeBar(); return; }
    if (t.closest("#ig-bar .ig-open")) { openSheet(); return; }
    if (t.closest("#ig-copy")) {
      const done = () => { const b = document.getElementById("ig-copy"); if (b) b.textContent = "Link copied"; };
      const url = installUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy this link:", url));
      else window.prompt("Copy this link:", url);
      return;
    }
    if (t.closest(".ig-close, .ig-done") || t.id === "ig-ov") closeSheet();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  window.addEventListener("hashchange", () => { if (onWelcome()) removeBar(); });

  // More+ menu item under Guide.
  function closeMenu() {
    const m = document.getElementById("more-menu"), b = document.getElementById("more-btn");
    if (m && !m.hidden) { m.hidden = true; if (b) b.setAttribute("aria-expanded", "false"); }
  }
  function addMenuItem() {
    const m = document.getElementById("more-menu");
    if (!m || !isIOS || m.querySelector("[data-install]")) return;
    const a = document.createElement("a");
    a.href = "#"; a.setAttribute("role", "menuitem"); a.dataset.install = "1"; a.textContent = "Add to Home Screen";
    m.appendChild(a);
  }

  function start() {
    addMenuItem();
    if (forced) {
      // Drop ?install=1 from the address so the Home Screen icon (added from this page) opens the normal site.
      try { const u = new URL(location.href); u.searchParams.delete("install"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch (e) { /* keep address */ }
      setTimeout(openSheet, 400);
      return;
    }
    if (!isIOS || hidden()) return;
    // Visible seconds on a non-Welcome page; wait out any open pop-up.
    let secs = 0;
    const tick = setInterval(() => {
      if (document.hidden || onWelcome()) return;
      secs += 1;
      if (secs >= SHOW_AFTER_S && !popupOpen()) { clearInterval(tick); showBar(); }
    }, 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
