"use strict";
// Sign-in pop-up: invites people who aren't signed in to create a free Stix account (Google sign-in).
// Replaced the "What's new" pop-up (Michael, 2026-10-27). It opens only:
//  • when a visitor taps Over or Under on a player page (picks.js remembers that pick and saves it after sign-in + 21+), or
//  • once, after more than 1 minute in total on the site (visible time, added up across visits in this browser).
// The 1-minute pop-up shows once per browser: closing it (✕, Not now, tapping outside, Escape) or signing in saves PROMPT_ID.
// A pick tap always opens it (they asked to save a pick). Never shown to someone signed in, over a sign-in link, on the
// Welcome page, or on the Picks tab (which already shows the sign-in screen). To show the 1-minute pop-up again, change PROMPT_ID.
// (The old What's new screenshots stay in site/whatsnew/ but aren't used.)
(function () {
  const PROMPT_ID = "2026-10-28-signin";
  const KEY = "stix_signin_prompt";
  const SECS_KEY = "stix_site_secs", AFTER_SECS = 60, TICK = 5;
  const ACC = () => window.STIX_ACCOUNT;
  const PICKS = () => window.STIX_PICKS;
  let forPick = false;

  function seen() { try { return localStorage.getItem(KEY) === PROMPT_ID; } catch (e) { return !!window.__stixSuSeen; } }
  function markSeen() { window.__stixSuSeen = true; try { localStorage.setItem(KEY, PROMPT_ID); } catch (e) { /* storage blocked: once per page load */ } }
  function secs() { try { return Number(localStorage.getItem(SECS_KEY)) || 0; } catch (e) { return window.__stixSecs || 0; } }
  function addSecs(n) { const v = secs() + n; window.__stixSecs = v; try { localStorage.setItem(SECS_KEY, String(v)); } catch (e) { /* ignore */ } return v; }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // signedInNow = closing because sign-in worked (keep the remembered pick so it can be saved).
  function close(signedInNow) {
    const ov = document.getElementById("su-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
    if (forPick && !signedInNow && PICKS() && PICKS().clearWanted) PICKS().clearWanted();
    forPick = false;
  }
  function open(opts) {
    if (document.getElementById("su-ov") || !ACC()) return;
    const pick = opts && opts.pick ? String(opts.pick) : "";
    forPick = !!(opts && opts.pick !== undefined);
    const ov = document.createElement("div");
    ov.id = "su-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box wn-box su-box" role="dialog" aria-modal="true" aria-labelledby="su-title">
      <div class="wn-h"><b id="su-title">${forPick ? "Sign in to save your pick" : "Save your picks with a free Stix account"}</b><button type="button" class="nw-x wn-x" aria-label="Close">✕</button></div>
      ${forPick && pick ? `<p class="su-pick">Your pick: <b>${esc(pick)}</b>. It's saved as soon as you sign in and confirm you're 21+.</p>` : ""}
      <ul class="su-list">
        ${forPick ? "" : "<li>Tap <b>Over</b> or <b>Under</b> on any player page to save a pick.</li>"}
        <li>Picks lock at kickoff and are graded automatically.</li>
        <li>Track your record and profit in units, on every device.</li>
        <li>Only you can see your picks.</li>
      </ul>
      ${ACC().googleBlock("su")}
      <p id="su-err" class="small pk-err" role="alert" hidden></p>
      <button type="button" class="su-later">Not now</button>
      <p class="small muted su-fine">Stix is for adults 21 and over. ${ACC().helpLine()} · <a href="privacy.html">Privacy</a></p>
    </div>`;
    document.body.appendChild(ov); document.body.classList.add("wn-lock");
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.closest(".wn-x") || e.target.closest(".su-later")) close(false);
    });
    ACC().bindGoogle("su");
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });

  // Signed in from the pop-up: close it and go to Picks, where the 21+ step comes next (if already done, picks.js saves the
  // remembered pick and goes back to the player page). A failed attempt shows its reason.
  function watch() {
    if (!ACC()) return;
    ACC().onChange(() => {
      if (!document.getElementById("su-ov")) return;
      if (ACC().signedIn()) { close(true); location.hash = "#/picks"; return; }
      const err = ACC().error(), box = document.getElementById("su-err");
      if (box) { box.textContent = err || ""; box.hidden = !err; }
    });
  }

  // The 1-minute pop-up: only when nothing would be covered that shouldn't be.
  function okToShowNow() {
    const h = location.hash || "";
    if (/access_token|sign-in|error_description/i.test(h + location.search)) return false; // a sign-in link
    if (h.startsWith("#/welcome") || h.startsWith("#/picks") || h.startsWith("#/admin")) return false;
    return true;
  }
  function wanted() { return !seen() && ACC() && !ACC().signedIn(); }
  function tick() {
    try {
      if (!wanted()) { clearInterval(timer); return; }
      if (document.visibilityState !== "visible") return;
      if (addSecs(TICK) > AFTER_SECS && okToShowNow() && !document.getElementById("su-ov")) open();
    } catch (e) { console.error("sign-in pop-up failed", e); }
  }
  watch();
  const timer = setInterval(tick, TICK * 1000);
  window.STIX_WHATSNEW = { open, close };
})();
