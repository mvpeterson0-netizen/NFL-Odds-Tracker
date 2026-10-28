"use strict";
// First-open pop-up: invites people who aren't signed in to create a free Stix account (Google sign-in).
// Replaced the "What's new" pop-up (Michael, 2026-10-27). Shown once per browser; closing it (✕, Not now, tapping
// outside, or Escape) or signing in saves PROMPT_ID in this browser so it doesn't show again. Never shown to someone
// already signed in, or over a sign-in link. To show it to everyone again, change PROMPT_ID.
// (The old What's new screenshots stay in site/whatsnew/ but aren't used.)
(function () {
  const PROMPT_ID = "2026-10-28-signin";
  const KEY = "stix_signin_prompt";
  const ACC = () => window.STIX_ACCOUNT;

  function seen() { try { return localStorage.getItem(KEY) === PROMPT_ID; } catch (e) { return !!window.__stixSuSeen; } }
  function markSeen() { window.__stixSuSeen = true; try { localStorage.setItem(KEY, PROMPT_ID); } catch (e) { /* storage blocked: show once per page load */ } }

  function close() {
    const ov = document.getElementById("su-ov");
    if (!ov) return;
    ov.remove(); document.body.classList.remove("wn-lock"); markSeen();
  }
  function open() {
    if (document.getElementById("su-ov") || !ACC()) return;
    const ov = document.createElement("div");
    ov.id = "su-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box wn-box su-box" role="dialog" aria-modal="true" aria-labelledby="su-title">
      <div class="wn-h"><b id="su-title">Save your picks with a free Stix account</b><button type="button" class="nw-x wn-x" aria-label="Close">✕</button></div>
      <ul class="su-list">
        <li>Tap <b>Over</b> or <b>Under</b> on any player page to save a pick.</li>
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
      if (e.target === ov || e.target.closest(".wn-x") || e.target.closest(".su-later")) close();
    });
    ACC().bindGoogle("su");
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // Signed in from the pop-up: close it and go to Picks, where the 21+ step comes next. A failed attempt shows its reason.
  function watch() {
    if (!ACC()) return;
    ACC().onChange(() => {
      if (!document.getElementById("su-ov")) return;
      if (ACC().signedIn()) { close(); location.hash = "#/picks"; return; }
      const err = ACC().error(), box = document.getElementById("su-err");
      if (box) { box.textContent = err || ""; box.hidden = !err; }
    });
  }

  function maybeShow() {
    try {
      if (seen() || !ACC() || ACC().signedIn()) return;
      if (/access_token|sign-in|error_description/i.test(location.hash + location.search)) return; // don't cover a sign-in link
      if ((location.hash || "").startsWith("#/welcome")) { // don't cover the Welcome page; offer it once they move on
        window.addEventListener("hashchange", () => setTimeout(maybeShow, 600), { once: true }); return;
      }
      open();
    } catch (e) { console.error("sign-in pop-up failed", e); }
  }
  watch();
  if (document.readyState === "complete") setTimeout(maybeShow, 600);
  else window.addEventListener("load", () => setTimeout(maybeShow, 600));
  window.STIX_WHATSNEW = { open, close };
})();
