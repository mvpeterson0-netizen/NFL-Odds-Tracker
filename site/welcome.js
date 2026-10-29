"use strict";
// "Welcome to Stix" page (#/welcome; Michael, 2026-10-27): a short tour of the six main parts of the app, with real
// screenshots of the built site (site/welcome/, captured 10/27 from Week 7–8 data).
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
  // Photo spots in the screenshots (CSS px in a 390 × 620 frame, from the capture).
  const FACES = {
    board: [{ pid: "00-0039150", x: 25, y: 354.8, s: 40 }, { pid: "00-0036555", x: 25, y: 588.2, s: 40 }],
    player: [{ pid: "00-0038543", x: 12, y: 69.4, s: 64 }],
  };
  function faces(key) {
    let players = [];
    try { players = (typeof D !== "undefined" && D && D.players) || []; } catch (e) { return ""; }
    return (FACES[key] || []).map((f) => {
      const p = players.find((x) => x.id === f.pid);
      if (!p || !p.img) return "";
      return `<img class="wl-face" src="${esc(p.img)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()"
        style="left:${(f.x / 390) * 100}%;top:${(f.y / 620) * 100}%;width:${(f.s / 390) * 100}%">`;
    }).join("");
  }
  const shot = (file, alt, key, cls) => `<div class="wl-shot ${cls || ""}"><img src="welcome/${file}" alt="${esc(alt)}" loading="lazy">${key ? faces(key) : ""}</div>`;

  const SECTIONS = [
    { id: "board", title: "The Board", link: "#/board", go: "Open the Board",
      text: "Every starter's pre-game lines for the week (passing, rushing and receiving), next to his average, how the defense ranks against his position, and the trend. Filter by game, team, position or name.",
      img: () => shot("board.jpg", "The Board on a phone: Bryce Young and Chuba Hubbard with their Week 8 lines", "board") },
    { id: "player", title: "Player pages", link: "#/player/00-0038543", go: "See Jaxon Smith-Njigba",
      text: "Tap any player for his week-by-week results against the line, the current line with FanDuel odds, how the line has moved, and his game log with snaps and targets.",
      img: () => shot("player.jpg", "Jaxon Smith-Njigba's player page: receptions line, average, opponent rank and a week-by-week chart", "player") },
    { id: "script", title: "Game script", link: "#/player/00-0038543", go: "Try it on a game log",
      text: "Tap an opponent in a game log to see how that game went: who led, by how much and for how long, and how pass-heavy each team was. A blowout can explain a big or small stat line.",
      img: () => shot("script.jpg", "Game script pop-up for Seattle's Week 7 win over Kansas City", "", "wl-pop") },
    { id: "research", title: "Research & Leads", link: "#/search", go: "Open Research",
      text: "Leads apply 8 rules picked from weeks 1–7 (for example TE1 receiving yards Under, or a 7+ point underdog's QB passing yards Over) to this week's lines. They're candidates, not proven, and are tracked from week 8 on.",
      img: () => shot("research.jpg", "Research tab: lead filters and the largest line moves from the previous week") },
    { id: "results", title: "Results", link: "#/leads", go: "Open Results",
      text: "How every graded pre-game line finished this season, over or under, by market, position and week.",
      img: () => shot("results.jpg", "Results tab: graded lines over and under by market") },
    { id: "picks", title: "My picks", link: "#/picks", go: "Open My picks",
      text: "Tap Over or Under on a player page to save a pick at that line and price. Picks lock at kickoff, are graded automatically once stats are in, and add up to your record and profit in units. Free with a Google sign-in; only you see your picks.",
      img: () => `<div class="wl-ex"><span class="wl-badge">Example</span>${shot("picks-record.jpg", "Example record: 16–9, 64% hit rate, +5.69 units")}${shot("picks-list.jpg", "Example graded picks with Hit and Miss labels")}
        <p class="small muted wl-excap">Example picks to show how tracking works, not real results. They use real Week 7 lines, odds and outcomes, graded by Stix.</p></div>` },
  ];

  function view() {
    return `<div class="wl">
      <section class="wl-hero">
        <h1>Welcome to Stix</h1>
        <p class="wl-lead">Research NFL player props: every starter's pre-game line from DraftKings and FanDuel, what actually happened, and leads on lines that may be off.</p>
        <a class="wl-cta" href="#/board">Get started</a>
      </section>
      <nav class="wl-toc">${SECTIONS.map((s, i) => `<a href="#/welcome" data-wl="${s.id}">${i + 1}. ${esc(s.title)}</a>`).join("")}</nav>
      ${SECTIONS.map((s, i) => `<section class="wl-sec" id="wl-${s.id}">
        <div class="wl-txt"><span class="wl-n">${i + 1}</span><h2>${esc(s.title)}</h2><p>${esc(s.text)}</p><a href="${s.link}">${esc(s.go)} ›</a></div>
        <div class="wl-pic">${s.img()}</div>
      </section>`).join("")}
      <section class="wl-end">
        <a class="wl-cta" href="#/board">Get started</a>
        <p class="small muted">Lines are captured about 3 hours before kickoff. Stix is a research tool for adults 21 and over; leads are not predictions. <a href="about.html">About</a> · <a href="privacy.html">Privacy</a></p>
      </section>
    </div>`;
  }
  // The contents links scroll to a section without changing the address.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-wl]"); if (!a) return;
    e.preventDefault();
    const el = document.getElementById("wl-" + a.dataset.wl); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.STIX_WELCOME = { view, firstVisit: () => firstVisit };
})();
