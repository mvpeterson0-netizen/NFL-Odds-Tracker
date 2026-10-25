"use strict";
// Player updates: a notes icon next to a player's name (Board, player page). Tap it for a pop-up of that player's
// updates: official injury report / practice status, roster reserve/inactive status, slot or depth chart changes,
// and big role changes in snap or target share (built in pipeline/build.py -> data.json "updates").
// The icon is red when something was first seen by Stix in the last 48 hours, gray otherwise.
(function () {
  const FRESH_MS = 48 * 3600 * 1000;
  const ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
  const items = (pid) => ((D && D.updates) || {})[pid] || [];
  const fresh = (it) => it.t && Date.now() - new Date(it.t).getTime() < FRESH_MS;
  function icon(pid) {
    const its = items(pid);
    if (!its.length) return "";
    const hot = its.some(fresh);
    return `<span class="newsbtn ${hot ? "hot" : ""}" role="button" tabindex="0" data-upd="${esc(pid)}" title="${hot ? "New player updates" : "Player updates"}" aria-label="${hot ? "New player updates" : "Player updates"}">${ICON}</span>`;
  }
  // When the source data behind an item was last published (nflverse timestamp.json, e.g. "2026-10-25 02:01:17 EDT").
  const SRC_KEY = (src) => /injury report/i.test(src) ? "injuries" : /roster/i.test(src) ? "rosters"
    : /slots/i.test(src) ? "depth" : /snap/i.test(src) ? "snaps" : /player stats/i.test(src) ? "stats" : null;
  function srcTime(src) {
    const k = SRC_KEY(src || ""), v = k && D && D.sources && D.sources[k];
    const s = v && v.last_updated;
    if (!s) return "";
    const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (EDT|EST|UTC)$/.exec(s);
    if (!m) return esc(s);
    const off = { EDT: "-04:00", EST: "-05:00", UTC: "Z" }[m[3]];
    return fmtTime(`${m[1]}T${m[2]}${off}`);
  }
  function close() { const o = document.getElementById("news-ov"); if (o) o.remove(); }
  function open(pid) {
    close();
    const p = playerById[pid]; if (!p) return;
    const its = items(pid);
    const row = (it) => { const asof = it.at ? fmtTime(it.at) : srcTime(it.src);
      const src = it.url && /^https:\/\//.test(it.url) ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.src)} ›</a>` : esc(it.src);
      return `<div class="nw-item ${fresh(it) ? "new" : ""}"><div><span class="chip nw-kind">${esc(it.kind)}</span>${fresh(it) ? ' <span class="nw-new">New</span>' : ""}</div>
      <div class="nw-text">${esc(it.text)}</div>
      ${asof ? `<div class="small"><b>Info as of ${asof}</b></div>` : ""}
      <div class="muted small">${src}</div></div>`; };
    const ov = document.createElement("div");
    ov.id = "news-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box nw-box" role="dialog" aria-label="Updates for ${esc(p.name)}">
      <div class="nw-h"><b>${esc(p.name)}</b> <span class="muted">${esc(p.team)} · ${esc(p.pos)}</span><button class="nw-x" aria-label="Close">✕</button></div>
      ${its.length ? its.map(row).join("") : `<p class="muted">No updates this week.</p>`}
      <a class="nw-open" href="#/player/${esc(pid)}">Open player page ›</a></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest(".nw-x")) close(); });
  }
  // Capture phase so a tap on the icon inside a Board card doesn't also open the player page.
  const handler = (e) => {
    const b = e.target.closest && e.target.closest("[data-upd]");
    if (!b) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation();
    try { open(b.dataset.upd); } catch (err) { console.error("updates pop-up failed", err); }
  };
  document.addEventListener("click", handler, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); else handler(e); }, true);
  window.addEventListener("hashchange", close);
  window.STIX_NEWS = { icon, open };
})();
