"use strict";
// Anonymous visit counts with GoatCounter (https://sharpstix.goatcounter.com): no cookies, no personal data.
// Counts only on the live site, never on a test copy on this computer.
// "Don't count me": open the site once with ?me=1 on each browser / home-screen app (stored in that browser only);
// ?me=0 turns counting back on. When off, the counting script isn't even loaded.
(function () {
  const CODE = "sharpstix", FLAG = "stix_notrack";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

  let note = "";
  try {
    const q = new URLSearchParams(location.search).get("me");
    if (q === "1") { set(FLAG, "1"); note = "Got it: visits from this browser won't be counted in visitor stats."; }
    else if (q === "0") { set(FLAG, null); note = "Visits from this browser will be counted again."; }
    if (q !== null) history.replaceState(null, "", location.pathname + location.hash);
  } catch { /* ignore */ }
  if (note) {
    const show = () => {
      const d = document.createElement("div");
      d.textContent = note; d.setAttribute("role", "status");
      d.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:50;max-width:calc(100% - 32px);" +
        "background:var(--ink);color:var(--bg);padding:10px 14px;border-radius:8px;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.25)";
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 5000);
    };
    if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  }

  const h = location.hostname;
  const live = h === "www.sharpstix.com" || h === "sharpstix.com" || h.endsWith(".github.io");
  if (!live || get(FLAG) === "1") return;

  // Page = the app's screen (#/board, #/player/<id>, ...). Anything that looks like sign-in data is never sent.
  const path = () => {
    const hash = location.hash || "#/board";
    return location.pathname + (/token|code=|error/i.test(hash) ? "#/sign-in-link" : hash.split("?")[0]);
  };
  const count = () => { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: path() }); } catch { /* ignore */ } };
  window.goatcounter = { no_onload: true };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  s.onload = count;
  document.head.appendChild(s);
  window.addEventListener("hashchange", count);
})();
