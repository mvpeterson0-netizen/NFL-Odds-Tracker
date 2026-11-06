"use strict";
// "Hello Brian" pop-up (2026-11-05, Michael's request, NFL side only): shown once on the next app open for everyone
// (signed in or not). Closing it (✕, Got it, tapping outside, Escape) saves HELLO_ID in this browser so it doesn't
// show again. To show it again to everyone, change HELLO_ID.
// Not shown on the CFB side (it waits until the visitor is on an NFL screen), over a sign-in link, the Welcome page
// (waits until the visitor leaves it), the admin page, or another open pop-up (What's new / sign-in).
(function () {
  const HELLO_ID = "2026-11-05-hello-brian";
  const KEY = "stix_hello";
  function seen() { try { return localStorage.getItem(KEY) === HELLO_ID; } catch (e) { return !!window.__stixHelloSeen; } }
  function markSeen() { window.__stixHelloSeen = true; try { localStorage.setItem(KEY, HELLO_ID); } catch (e) { /* storage blocked: once per page load */ } }
  function close() {
    const ov = document.getElementById("hello-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
  }
  function open() {
    if (document.getElementById("hello-ov") || document.getElementById("wn-ov") || document.getElementById("su-ov")) return;
    const ov = document.createElement("div");
    ov.id = "hello-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box wn-box hello-box" role="dialog" aria-modal="true" aria-labelledby="hello-title">
      <div class="wn-h"><b id="hello-title">Hello Brian</b><button type="button" class="nw-x wn-x" aria-label="Close">✕</button></div>
      <p class="hello-msg">Hello Brian</p>
      <button type="button" class="wn-ok">Got it</button></div>`;
    document.body.appendChild(ov); document.body.classList.add("wn-lock");
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest(".wn-x") || e.target.closest(".wn-ok")) close();
    });
    const b = ov.querySelector(".wn-ok"); if (b) b.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function okNow() {
    const h = location.hash || "";
    if (/access_token|sign-in|error_description/i.test(h + location.search)) return false; // a sign-in link
    if (h.startsWith("#/welcome") || h.startsWith("#/admin") || h.startsWith("#/cfb")) return false; // NFL screens only
    return true;
  }
  function maybeShow() {
    try {
      if (seen()) return;
      if (!okNow()) { window.addEventListener("hashchange", maybeShowSoon, { once: true }); return; }
      if (document.getElementById("wn-ov") || document.getElementById("su-ov")) { setTimeout(maybeShow, 1000); return; } // another pop-up is open: go after it
      open();
    } catch (e) { console.error("hello pop-up failed", e); }
  }
  function maybeShowSoon() { setTimeout(maybeShow, 300); }
  if (document.readyState === "complete") maybeShowSoon();
  else window.addEventListener("load", maybeShowSoon);
  window.STIX_HELLO = { open, close };
})();
