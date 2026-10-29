"use strict";
// "What's new" release pop-up (2026-10-29, Michael): shown once on the next app open, for everyone (signed in or not).
// Separate from whatsnew.js, which is now the sign-in pop-up (window.STIX_WHATSNEW). Closing this one (✕, Got it, the
// Research button, tapping outside, or Escape) saves RELEASE_ID in this browser so it doesn't show again.
// Not shown over a sign-in link, the Welcome page (waits until the visitor leaves it), the admin page, or an open sign-in
// pop-up. The screenshot in site/whatsnew/ comes from the real built site.
// Numbers: frozen theses baseline (claude/frozen-theses.md), weeks 1–7, in-sample. To announce a future release: change
// RELEASE_ID and ITEMS.
(function () {
  const RELEASE_ID = "2026-10-29-season-signals";
  const KEY = "stix_release";
  const ITEMS = [
    { title: "Lines for the whole season",
      text: "Every game this season now has its real DraftKings / FanDuel pre-game lines, back to week 1. Charts, game logs and Results now cover weeks 1–7, not just the weeks since Stix started collecting." },
    { title: "8 signals to watch",
      text: "We tested more than 1,900 conditions on weeks 1–7 and kept 8. One of them:",
      stat: { rule: "WR2 who went over his line last week → bet the Under (same stat)",
              rec: "99–54 · 64.7% hit · +34.1 units · <b>+22.3% ROI</b>" },
      after: "Not financial advice, additional data may prove or disprove thesis",
      imgs: [["whatsnew/signals.jpg", 640, 720, "Research tab Leads showing rule 1, WR2 went over, with its weeks 1–7 record"]],
      go: ["#/search", "See all 8 on the Research tab"] },
  ];

  function seen() { try { return localStorage.getItem(KEY) === RELEASE_ID; } catch (e) { return !!window.__stixRelSeen; } }
  function markSeen() { window.__stixRelSeen = true; try { localStorage.setItem(KEY, RELEASE_ID); } catch (e) { /* storage blocked: once per page load */ } }

  function close() {
    const ov = document.getElementById("wn-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
  }
  function open() {
    if (document.getElementById("wn-ov") || document.getElementById("su-ov")) return;
    const card = (it, i) => `<section class="wn-card">
      <h3><span class="wn-num" aria-hidden="true">${i + 1}</span>${it.title}</h3><p>${it.text}</p>
      ${it.stat ? `<div class="wn-stat"><div class="wn-stat-r">${it.stat.rule}</div><div class="wn-stat-n">${it.stat.rec}</div><div class="small muted">Weeks 1–7, 1 unit per bet at the saved odds</div></div>` : ""}
      ${it.after ? `<p class="small muted">${it.after}</p>` : ""}
      ${(it.imgs || []).map(([src, w, h, alt]) => `<img src="${src}" width="${w}"${h ? ` height="${h}"` : ""} alt="${alt}" loading="lazy">`).join("")}
      ${it.go ? `<a class="wn-go wn-go-btn" href="${it.go[0]}">${it.go[1]} ›</a>` : ""}</section>`;
    const ov = document.createElement("div");
    ov.id = "wn-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box wn-box" role="dialog" aria-modal="true" aria-labelledby="wn-title">
      <div class="wn-h"><b id="wn-title">What's new in Stix</b><button type="button" class="nw-x wn-x" aria-label="Close">✕</button></div>
      ${ITEMS.map(card).join("")}
      <button type="button" class="wn-ok">Got it</button></div>`;
    document.body.appendChild(ov); document.body.classList.add("wn-lock");
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest(".wn-x") || e.target.closest(".wn-ok") || e.target.closest(".wn-go")) close();
    });
    const x = ov.querySelector(".wn-x"); if (x) x.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function okNow() {
    const h = location.hash || "";
    if (/access_token|sign-in|error_description/i.test(h + location.search)) return false; // a sign-in link
    if (h.startsWith("#/welcome") || h.startsWith("#/admin")) return false;
    return true;
  }
  function maybeShow() {
    try {
      if (seen()) return;
      if (!okNow()) { window.addEventListener("hashchange", maybeShowSoon, { once: true }); return; }
      open();
    } catch (e) { console.error("what's new pop-up failed", e); }
  }
  function maybeShowSoon() { setTimeout(maybeShow, 600); }
  if (document.readyState === "complete") maybeShowSoon();
  else window.addEventListener("load", maybeShowSoon);
  window.STIX_RELEASE = { open, close };
})();
