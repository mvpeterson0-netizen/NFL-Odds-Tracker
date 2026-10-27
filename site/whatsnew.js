"use strict";
// "What's new" pop-up: shown once per release on the next app open, for everyone (signed in or not).
// Closing it (✕, Got it, a "Go to" button, tapping outside, or Escape) saves WHATS_NEW_ID in this browser
// so it doesn't show again. Screenshots in site/whatsnew/ come from the real built site.
// To announce a future release: change WHATS_NEW_ID and ITEMS.
(function () {
  const WHATS_NEW_ID = "2026-10-27";
  const KEY = "stix_whatsnew";
  const ITEMS = [
    { title: "Line alerts",
      text: "Get a notification when a game's player lines go up. Turn it on at the top of the <b>Guide</b> tab. On iPhone, open Stix from your Home Screen first.",
      imgs: [["whatsnew/alerts.jpg", 640, 343, "Alerts panel on the Guide tab with a Turn on alerts button"]],
      go: ["#/guide", "Go to Guide"] },
    { title: "Game flow & game script",
      text: "On any player page, tap an opponent in the game log (or a <b>Led big</b> / <b>Trailed big</b> tag) to see how that game played out: the score margin all game, how long a team led or trailed big, and pass rates.",
      imgs: [["whatsnew/log.jpg", 640, 151, "Player game log rows with a Led big tag"],
             ["whatsnew/script.jpg", 640, 773, "Game script pop-up with a game-flow chart and neutral pass rates"]] },
    { title: "Research Leads",
      text: "The <b>Research</b> tab now opens with 6 ready-made filters: line moves, last 3 vs line, usage up or down with a flat line, and good or bad game scripts.",
      imgs: [["whatsnew/leads.jpg", 640, 638, "Research tab Leads with six filter buttons and a Line move result"]],
      go: ["#/search", "Open Research"] },
  ];

  function seen() { try { return localStorage.getItem(KEY) === WHATS_NEW_ID; } catch (e) { return !!window.__stixWnSeen; } }
  function markSeen() { window.__stixWnSeen = true; try { localStorage.setItem(KEY, WHATS_NEW_ID); } catch (e) { /* storage blocked: show once per page load */ } }

  function close() {
    const ov = document.getElementById("wn-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
  }
  function open() {
    if (document.getElementById("wn-ov")) return;
    const card = (it, i) => `<section class="wn-card">
      <h3><span class="wn-num" aria-hidden="true">${i + 1}</span>${it.title}</h3><p>${it.text}</p>
      ${it.imgs.map(([src, w, h, alt]) => `<img src="${src}" width="${w}" height="${h}" alt="${alt}" loading="lazy">`).join("")}
      ${it.go ? `<a class="wn-go" href="${it.go[0]}">${it.go[1]} ›</a>` : ""}</section>`;
    const ov = document.createElement("div");
    ov.id = "wn-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box wn-box" role="dialog" aria-modal="true" aria-labelledby="wn-title">
      <div class="wn-h"><b id="wn-title">What's new in Stix</b><button type="button" class="nw-x wn-x" aria-label="Close">✕</button></div>
      ${ITEMS.map(card).join("")}
      <button type="button" class="wn-ok on">Got it</button></div>`;
    document.body.appendChild(ov); document.body.classList.add("wn-lock");
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest(".wn-x") || e.target.closest(".wn-ok") || e.target.closest(".wn-go")) close();
    });
    const x = ov.querySelector(".wn-x"); if (x) x.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  function maybeShow() {
    try {
      if (seen()) return;
      if (/access_token|sign-in/i.test(location.hash)) return; // don't cover a sign-in link
      open();
    } catch (e) { console.error("what's new pop-up failed", e); }
  }
  if (document.readyState === "complete") setTimeout(maybeShow, 600);
  else window.addEventListener("load", () => setTimeout(maybeShow, 600));
  window.STIX_WHATSNEW = { open, close };
})();
