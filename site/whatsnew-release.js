"use strict";
// "What's new" release pop-up (2026-10-29, Michael): shown once on the next app open, for everyone (signed in or not).
// Separate from whatsnew.js, which is now the sign-in pop-up (window.STIX_WHATSNEW). Closing this one (✕, Got it, the
// Research button, tapping outside, or Escape) saves RELEASE_ID in this browser so it doesn't show again.
// Not shown over a sign-in link, the Welcome page (waits until the visitor leaves it), the admin page, or an open sign-in
// pop-up. The screenshot in site/whatsnew/ comes from the real built site.
// Numbers: frozen theses baseline (claude/frozen-theses.md), weeks 1–7, in-sample. To announce a future release: change
// ITEMS — any content change shows the pop-up once more to everyone (see fingerprint below).
(function () {
  const RELEASE_ID = "2026-11-13-signals-visual";
  const KEY = "stix_release";
  // One-screen visual (Michael 2026-11-13: less words, more pictures, less technical). Win counts = the 6 signals that passed
  // the audit's multiplicity check (claude/thesis-audit-research-ledger-2026-11-12; 2025 wk 1–18 + 2026 wk 1–9 replay,
  // wins / bets). SC2 and QB-R4 did not pass. Break-even ~53% = typical price -112 (ledger). Scale 40–80%.
  const BARS = [["QB-R2", 19, 26], ["CM1-TE", 32, 46], ["QB-R1", 62, 90], ["CM1-20", 67, 103], ["QBCH", 182, 308], ["SC1", 187, 319]];
  const BE = 52.8, LO = 40, HI = 80, pos = (v) => Math.max(0, Math.min(100, (v - LO) / (HI - LO) * 100));
  const VISUAL = `<div class="wn-steps"><div><span>🔍</span>Spot a pattern</div><i>›</i><div><span>🧪</span>Test on past games</div><i>›</i><div><span>✅</span>Keep what beats luck</div></div>
    <div class="wn-chart"><div class="wn-ct">How often each signal won</div>
    ${BARS.map(([n, w, t]) => { const v = w / t * 100; return `<div class="wn-bar"><b>${n}</b><div class="wn-trk"><div class="wn-fill" style="width:${pos(v).toFixed(1)}%"><em>${w}–${t - w}</em></div><div class="wn-be" style="left:${pos(BE).toFixed(1)}%"></div></div><span>${Math.round(v)}%</span></div>`; }).join("")}
    <div class="wn-bel" style="margin-left:calc(62px + (100% - 62px - 40px) * ${(pos(BE) / 100).toFixed(3)})">▲ break-even</div></div>
    <div class="wn-fd"><div class="wn-fd-t">One tap puts every qualified player on your FanDuel slip</div>
    <div class="wn-fd-row"><div class="wn-fd-a"><span>📋</span>Pick a signal</div><i>›</i><div class="wn-fd-b">Add all to FanDuel slip</div><i>›</i><div class="wn-fd-a"><span>🎟️</span>Bets ready</div></div></div>`;
  const ITEMS = [
    { title: "Discovered +EV Signals", visual: VISUAL,
      text: "6 of 8 signals beat chance in past games. SC2 and QB-R4 haven't yet.",
      after: "Past games, not a promise.",
      go: ["#/search", "See the Signals"] },
  ];

  // 2026-10-29 (Michael): the pop-up shows again automatically whenever its content changes. The saved value is a
  // fingerprint of RELEASE_ID + ITEMS (text, stats, image paths, buttons), so editing any of them re-shows it once.
  // Not covered: replacing an image file under the same name — rename it or change RELEASE_ID to force a re-show.
  // Fixing a typo also re-shows it to everyone.
  function fingerprint(s) { // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  const VERSION = "c-" + fingerprint(RELEASE_ID + "\n" + JSON.stringify(ITEMS));
  // Browsers that closed the 2026-10-29 pop-up before fingerprints existed saved RELEASE_ID itself. Count that as seen
  // only while the content is still exactly what they saw (fingerprint LEGACY_VERSION).
  const LEGACY_VERSION = "c-9q2e2j";
  function seen() {
    try {
      const v = localStorage.getItem(KEY);
      return v === VERSION || (v === "2026-10-29-season-signals" && VERSION === LEGACY_VERSION);
    } catch (e) { return !!window.__stixRelSeen; }
  }
  function markSeen() { window.__stixRelSeen = true; try { localStorage.setItem(KEY, VERSION); } catch (e) { /* storage blocked: once per page load */ } }

  function close() {
    const ov = document.getElementById("wn-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
  }
  function open() {
    if (document.getElementById("wn-ov") || document.getElementById("su-ov")) return;
    const card = (it, i) => `<section class="wn-card">
      <h3>${ITEMS.length > 1 ? `<span class="wn-num" aria-hidden="true">${i + 1}</span>` : ""}${it.title}</h3>${it.visual || ""}<p>${it.text}</p>
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
