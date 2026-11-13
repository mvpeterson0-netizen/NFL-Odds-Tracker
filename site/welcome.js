"use strict";
// "Welcome to Stix" page (#/welcome; Michael, 2026-10-27): a short tour of the six main parts of the app, with real
// screenshots of the built site (site/welcome/). Board and Player pages images retaken 11/11 from Week 10 data; Signals is two steps since 11/12 (signed-in tiles; a picked signal's players with the FanDuel slip button), real signed-in screenshots;
// copy trimmed the same day (Michael: let the pictures carry it, make the tour fast).
// Shown automatically only on a browser's first-ever visit: no Stix setting saved in this browser yet, nobody signed
// in, and the visit opens on the Board (a shared player link or a sign-in link opens as usual). Returning browsers
// never see it again unless they open #/welcome themselves (link in the Guide footer).
// The My picks screenshots are the one labeled exception to "real data only" (Michael, 2026-10-27): 25 example picks
// made up from real Week 7 pre-game lines, odds and results, graded by the app itself, shown with an "Example" badge.
// Player photos are not in the screenshots (the capture computer can't reach NFL's image server); the real photo is
// placed over the photo spot when the page loads, the same image the app shows.
(function () {
  // ---------- first visit: decide before the rest of the app starts (this file loads first) ----------
  let firstVisit = false;
  try {
    const keys = Object.keys(localStorage);
    const known = keys.some((k) => k.startsWith("stix_") || k.startsWith("sb-"));
    const h = location.hash || "";
    const opensBoard = h === "" || h === "#" || h === "#/" || h.startsWith("#/board");
    if (!known && opensBoard && !/access_token|error/.test(h + location.search)) firstVisit = true;
    localStorage.setItem("stix_seen_before", "1");
  } catch (e) { firstVisit = false; } // storage blocked: never force the page, since we couldn't remember it was seen
  if (firstVisit) history.replaceState(null, "", location.pathname + location.search + "#/welcome");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Photo spots in the screenshots (CSS px in a 390-wide frame of height h, from the capture).
  const FACES = {
    board: [{ pid: "00-0034857", x: 25, y: 230.5, s: 40, h: 620 }, { pid: "00-0037248", x: 25, y: 472.6, s: 40, h: 620 }],
    player: [{ pid: "00-0038543", x: 12, y: 81.1, s: 56, h: 614 }],
  };
  function faces(key) {
    let players = [];
    try { players = (typeof D !== "undefined" && D && D.players) || []; } catch (e) { return ""; }
    return (FACES[key] || []).map((f) => {
      const p = players.find((x) => x.id === f.pid);
      if (!p || !p.img) return "";
      return `<img class="wl-face" src="${esc(p.img)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()"
        style="left:${(f.x / 390) * 100}%;top:${(f.y / f.h) * 100}%;width:${(f.s / 390) * 100}%">`;
    }).join("");
  }
  const shot = (file, alt, key, cls) => `<div class="wl-shot ${cls || ""}"><img src="welcome/${file}" alt="${esc(alt)}">${key ? faces(key) : ""}</div>`;

  // Tap-through tour (Michael, 2026-11-11): one page at a time; tap Next to move on. The first page is Board with the welcome heading on top.
  const SECTIONS = [
    { id: "board", title: "The Board", text: "This week's lines for every starter.",
      img: () => shot("board-w10.jpg", "The Board on a phone: Josh Allen and James Cook III with their Week 10 lines", "board") },
    { id: "player", title: "Player pages", text: "Every week's line next to the actual result.",
      img: () => shot("player-w10.jpg", "Jaxon Smith-Njigba's player page: FanDuel odds and a chart of his receptions against the line, weeks 1 to 9", "player") },
    { id: "script", title: "Game script", text: "Tap an opponent in a game log to see how the game went.",
      img: () => shot("script.jpg", "Game script pop-up for Seattle's Week 7 win over Kansas City", "", "wl-pop") },
    { id: "signals", title: "Signals", text: "Top signals by ROI. Sign in with Google to see them all.",
      img: () => shot("signals-in.jpg", "Signals tab signed in: eight signal tiles with season ROI, record, players this week and a weekly ROI chart") },
    { id: "signals2", title: "Signal players", text: "Tap a signal to see this week's players. Add them to your FanDuel slip in one tap.",
      img: () => shot("signals-pick.jpg", "A selected signal, SC1, with its three players this week checked and an Add 3 checked Unders to FanDuel slip button") },
    { id: "results", title: "Results", text: "How every graded line finished.",
      img: () => shot("results.jpg", "Results tab: graded lines over and under by market") },
    { id: "picks", title: "My picks", text: "Tap Over or Under to save a pick. It's graded for you. Free sign-in.",
      img: () => `<div class="wl-ex"><span class="wl-badge">Example</span>${shot("picks-record.jpg", "Example record: 16–9, 64% hit rate, +5.69 units")}${shot("picks-list.jpg", "Example graded picks with Hit and Miss labels")}</div>`,
      cap: '<p class="small muted wl-excap">Example picks to show how tracking works, not real results.</p>' },
  ];
  let page = 1; // 1..N = SECTIONS[page - 1]; page 1 also carries the welcome heading

  function view() {
    const n = SECTIONS.length, last = page === n;
    const s = SECTIONS[page - 1];
    return `<div class="wl wl-pg">
      ${page === 1 ? '<h1 class="wl-h1">Welcome to Stix</h1>' : ""}
      <div class="wl-top"><span class="wl-n">${page}</span><h2>${esc(s.title)}</h2>${last ? "" : '<a class="wl-skip" href="#/board">Skip</a>'}</div>
      <p class="wl-line">${esc(s.text)}</p>
      <div class="wl-pic" data-wl-go="${last ? "" : page + 1}"><div class="wl-fit"${s.id === "script" ? ' data-max="300"' : ""}>${s.img()}</div>${s.cap || ""}</div>
      <div class="wl-nav">
        ${last ? '<p class="small muted wl-fine">For adults 21+. A research tool, not predictions. <a href="about.html">About</a> · <a href="privacy.html">Privacy</a></p>' : ""}
        <div class="wl-row">
          <button class="wl-back" data-wl-go="${page - 1}" aria-label="Back"${page === 1 ? ' style="visibility:hidden"' : ""}>‹ Back</button>
          <span class="wl-dots">${SECTIONS.map((_, i) => `<i class="${i + 1 === page ? "on" : ""}"></i>`).join("")}</span>
          ${last ? '<a class="wl-cta" href="#/board">Get started</a>' : `<button class="wl-cta" data-wl-go="${page + 1}">Next ›</button>`}
        </div>
      </div>
    </div>`;
  }
  // Fit each page on one screen with no scrolling (Michael, 2026-11-12): the screenshot is scaled down to the space left
  // between the heading and the fixed Back/Next bar. Runs after each page draw, when an image finishes loading, and on resize.
  function fit() {
    const el = document.querySelector(".wl-pg"); if (!el) return;
    const f = el.querySelector(".wl-fit"), box = el.querySelector(".wl-pic"), nav = el.querySelector(".wl-nav"); if (!f || !box || !nav) return;
    const cap = el.querySelector(".wl-excap");
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const avail = vh - f.getBoundingClientRect().top - nav.offsetHeight - (cap ? cap.offsetHeight + 8 : 0) - 10;
    const base = Math.min(box.clientWidth, Number(f.dataset.max) || box.clientWidth);
    f.style.width = base + "px";
    const h = f.offsetHeight;
    if (h > avail && avail > 120) f.style.width = Math.floor((base * avail) / h) + "px";
  }
  const draw = () => { const el = document.querySelector(".wl"); if (!el) return; el.outerHTML = view(); window.scrollTo(0, 0); fit(); };
  document.addEventListener("load", (e) => { if (e.target && e.target.closest && e.target.closest(".wl-fit")) fit(); }, true);
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  // app.js puts the page in with innerHTML: fit once it is in the document.
  new MutationObserver(() => { if (document.querySelector(".wl-pg") && !document.querySelector(".wl-fit[style]")) fit(); })
    .observe(document.documentElement, { childList: true, subtree: true });

  // Taps move between pages in place (the address stays #/welcome).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-wl-go]"); if (!a) return;
    const to = a.dataset.wlGo; if (to === "") return;
    e.preventDefault();
    const el = document.querySelector(".wl"); if (!el) return;
    page = Math.max(1, Math.min(SECTIONS.length, Number(to)));
    draw();
  });
  window.addEventListener("hashchange", () => { if (!/^#\/welcome/.test(location.hash)) page = 1; });

  window.STIX_WELCOME = { view, firstVisit: () => firstVisit };
})();
