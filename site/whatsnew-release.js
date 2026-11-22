"use strict";
// "What's new" release pop-up (2026-10-29, Michael): shown once on the next app open, for everyone (signed in or not).
// Separate from whatsnew.js, which is now the sign-in pop-up (window.STIX_WHATSNEW). Closing this one (✕, Got it, the
// Research button, tapping outside, or Escape) saves RELEASE_ID in this browser so it doesn't show again.
// Not shown over a sign-in link, the Welcome page (waits until the visitor leaves it), the admin page, or an open sign-in
// pop-up. The screenshot in site/whatsnew/ comes from the real built site.
// Numbers: frozen theses baseline (claude/frozen-theses.md), weeks 1–7, in-sample. To announce a future release: change
// ITEMS — any content change shows the pop-up once more to everyone (see fingerprint below).
(function () {
  const RELEASE_ID = "2026-11-22-signals-tiles";
  const KEY = "stix_release";
  // 2026-11-22 (Michael): new release, same topic (Signals). Chart = each Signals tile (group) and its toggles (rows): ROI bar plus
  // this season's (2026) W–L, read from the running app's own tiles on 2026-11-22 (Signals page, default scope, one toggle selected
  // at a time; Big Beat has no toggle). Static snapshot, so the title says "as of Nov 22". Names/one-liners from site/research.js.
  // Toggles were picked on earlier games, so the footer says so; no signal has a forward verdict yet.
  const GROUPS = [
    ["Short yd", "Short-yardage receiver after a big Over", [["+25%", 53.6, "22–5"], ["No Long", 37.0, "42–16"], ["Fluke", 29.3, "13–6"]]],
    ["QB Rush", "QB rush yards Under", [["Line 25", 26.9, "41–20"], ["Avg 25", 46.6, "21–6"], ["Line +5", 41.3, "9–3"]]],
    ["Line Lag", "QB line drops, receivers' lines don't follow", [["TE", 44.2, "16–5"], ["All", 11.4, "23–16"]]],
    ["Prev Scr", "Over after a lopsided game", [["RB", 35.0, "20–8"], ["WR/TE", 27.5, "68–33"]]],
    ["1st Half", "First-half Over, line raised", [["+30%", 30.5, "36–16"], ["No Long", 26.1, "82–41"]]],
    ["Big Beat", "Beat his line by 200%+", [["All", 23.0, "56–30"]]],
  ];
  const LO = Math.min(0, ...GROUPS.flatMap((g) => g[2].map((r) => r[1]))), HI = 60, lbl = (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%", rpos = (v) => Math.max(0, Math.min(100, (v - LO) / (HI - LO) * 100));
  const VISUAL = `<div class="wn-res">
    ${GROUPS.map(([n, d, rows]) => `<div class="wn-grp"><div class="wn-gh"><b>${n}</b><span>${d}</span></div>
      ${rows.map(([sub, roi, rec]) => `<div class="wn-row"><span class="wn-sub">${sub}</span><span class="wn-trk"><span class="wn-fill" style="width:${rpos(roi).toFixed(1)}%"></span></span><b class="wn-roi">${lbl(roi)}</b><span class="wn-rec">${rec}</span></div>`).join("")}</div>`).join("")}
    <div class="wn-note">2026 season through Nov 22. ROI is profit per unit bet; the record is wins–losses.</div></div>`;
  const ITEMS = [
    { title: "How the Signals are doing", plain: true, visual: VISUAL,
      text: "Over and Under buttons can now go to whichever of FanDuel or DraftKings has the better number. Tap (i) on any signal to see the checks a pick must pass.",
      after: "Toggles were picked on earlier games and samples are small. Past results, not a promise.",
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
    const card = (it, i) => `<section class="wn-card${it.plain ? " wn-plain" : ""}">
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
