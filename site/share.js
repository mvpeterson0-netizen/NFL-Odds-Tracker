"use strict";
// Share a player page as an image (for iMessage etc.).
// The share button on a player page draws a card for the market being viewed: upcoming game (line, opponent
// defense rank, weather), season / last-3 averages and trend, a chart of recent weeks and a table of the last games.
// Everything on the card comes from data.json; nothing is estimated. Drawn on a canvas so no outside service is used.
(function () {
  const W = 1080, H = 1350, PAD = 56;
  const C = { bg: "#ffffff", ink: "#1c1d1f", muted: "#6b6f76", line: "#e3e3df", accent: "#1f5fbf",
    over: "#1e7a46", under: "#b3261e", push: "#7a6a12", warnBg: "#fff4d6", warnInk: "#6a4b00", chip: "#eef1f6", tough: "#b3261e", easy: "#1e7a46" };
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  const f = (px, w = 400) => `${w} ${px}px ${FONT}`;
  const n1 = (v) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
  const oddsT = (v) => (v == null ? "" : v > 0 ? `+${v}` : String(v));

  // Same AVG / trend rules as the phone card (mobile.js); falls back to a plain average if that file didn't load.
  function form(pid, mid, pos, wk) {
    if (window.STIX_MOBILE && window.STIX_MOBILE.form) return window.STIX_MOBILE.form(pid, mid, pos, wk);
    return { n: 0, avg: null, trend: null };
  }
  function currentLine(m) {
    if (!m) return null;
    if (m.lstat === "ok" && m.line != null) return { line: m.line, op: m.op, up: m.up, book: m.book, src: "Pre-game line" };
    if (m.lstat === "pending") { const s = latestSnap(m); if (s && s.line != null) return { line: s.line, op: s.op, up: s.up, book: s.book, src: `${s.label} snapshot` }; }
    return null;
  }
  function wxText(gid) {
    const g = D.games[gid]; if (!g) return "";
    const w = g.wx || {};
    if (w.roof === "dome") return "Dome";
    const s = wxSummary(w); if (!s) return "";
    const v = wxValues(w);
    return `${s.label} · ${v.t}°F · ${v.wind} mph${s.kind === "fc" ? " (forecast)" : ""}`;
  }
  function koText(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }

  function cardData(pid, mid) {
    const p = playerById[pid], mk = mkt[mid];
    const rows = (D.rows[pid] || []).slice().sort((a, b) => a.wk - b.wk);
    const up = rows.find((r) => !r.final && new Date(r.ko) > new Date()) || null;
    const past = rows.filter((r) => r.final);
    const slot = up && up.slot ? up.slot : (rows.length && rows[rows.length - 1].slot) || p.pos;
    const fm = form(pid, mid, p.pos, up ? up.wk : 99);
    const played = past.filter((r) => r.played === true && r.m[mid] && r.m[mid].act != null);
    const last3 = played.slice(-3).map((r) => r.m[mid].act);
    return { p, mk, mid, slot, up, upM: up ? up.m[mid] : null, past, fm,
      last3: last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null, n3: last3.length,
      chartRows: rows.filter((r) => r.final || r === up) };
  }

  // ---------- headshot ----------
  // Loaded with CORS so the canvas stays exportable. If NFL's image server is slow, refuses cross-origin use, or the player has
  // no photo, this resolves null and the card is drawn without it (the export never fails because of the photo).
  function loadHeadshot(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      const t = setTimeout(() => resolve(null), 2500);
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth ? img : null); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.crossOrigin = "anonymous"; img.referrerPolicy = "no-referrer";
      img.src = url;
    });
  }
  function drawHeadshot(ctx, img, cx, cy, r) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = C.chip; ctx.fill(); ctx.clip();
    const k = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight); // fill the circle, keep the top (face) in frame
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, cx - w / 2, cy - r, w, h);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke();
  }

  // ---------- drawing ----------
  function roundRect(ctx, X, Y, w, h, r, fill, stroke) {
    ctx.beginPath(); ctx.moveTo(X + r, Y); ctx.arcTo(X + w, Y, X + w, Y + h, r); ctx.arcTo(X + w, Y + h, X, Y + h, r);
    ctx.arcTo(X, Y + h, X, Y, r); ctx.arcTo(X, Y, X + w, Y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  function text(ctx, s, x, y, font, color, align = "left") { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); return ctx.measureText(s).width; }
  function fit(ctx, s, font, maxW) { ctx.font = font; if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1); return s + "…"; }

  function drawChart(ctx, d, X, Y, w, h) {
    const pts = d.chartRows.map((r) => {
      const m = r.m[d.mid] || {};
      const sn = r === d.up ? currentLine(m) : null;
      return { wk: r.wk, act: r.final && r.played === true ? m.act : null, line: m.lstat === "ok" ? m.line : null, proj: sn ? sn.line : null, res: m.res };
    });
    const vals = pts.flatMap((p) => [p.act, p.line, p.proj]).filter((v) => v != null);
    text(ctx, `${d.mk.label} by week`, X, Y - 18, f(28, 600), C.ink);
    if (!vals.length) { text(ctx, "No games yet", X, Y + 60, f(28), C.muted); return; }
    const L = X + 70, R = X + w - 30, T = Y + 10, B = Y + h - 40;
    const IL = L + 40, IR = R - 40; // keep points and their labels off the axis numbers
    const top = Math.max(...vals) * 1.12 || 1;
    const step = niceStep(top);
    const max = Math.ceil(top / step) * step;
    const xs = (i) => (pts.length === 1 ? (IL + IR) / 2 : IL + (i * (IR - IL)) / (pts.length - 1));
    const ys = (v) => B - ((B - T) * v) / max;
    ctx.lineWidth = 1.5;
    for (let v = 0; v <= max + 1e-9; v += step) {
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(L, ys(v)); ctx.lineTo(R, ys(v)); ctx.stroke();
      text(ctx, n1(Math.round(v * 10) / 10), L - 12, ys(v) + 8, f(22), C.muted, "right");
    }
    pts.forEach((p, i) => text(ctx, `W${p.wk}`, xs(i), B + 34, f(pts.length > 12 ? 17 : 22), C.muted, "center"));
    // pre-game lines (short bars), snapshot for the upcoming game (dashed amber)
    // many weeks: shrink labels/bars so they still fit side by side
    const fs = pts.length > 12 ? 17 : pts.length > 9 ? 20 : 24, bw = pts.length > 12 ? 14 : pts.length > 9 ? 17 : 22;
    pts.forEach((p, i) => {
      if (p.line != null) {
        ctx.strokeStyle = C.ink; ctx.lineWidth = 5; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(xs(i) - bw, ys(p.line)); ctx.lineTo(xs(i) + bw, ys(p.line)); ctx.stroke();
        // line label goes on the side away from the actual point so the two never collide
        const below = p.act == null || p.act >= p.line;
        text(ctx, n1(p.line), xs(i), below ? ys(p.line) + fs + 12 : ys(p.line) - 14, f(fs, 700), C.ink, "center");
      }
      if (p.proj != null) {
        ctx.strokeStyle = C.warnInk; ctx.lineWidth = 5; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(xs(i) - 26, ys(p.proj)); ctx.lineTo(xs(i) + 26, ys(p.proj)); ctx.stroke(); ctx.setLineDash([]);
        text(ctx, n1(p.proj), xs(i), ys(p.proj) - 16, f(fs, 700), C.warnInk, "center");
      }
    });
    // actuals
    ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.beginPath();
    let started = false;
    pts.forEach((p, i) => { if (p.act == null) return; if (!started) { ctx.moveTo(xs(i), ys(p.act)); started = true; } else ctx.lineTo(xs(i), ys(p.act)); });
    ctx.stroke();
    pts.forEach((p, i) => {
      if (p.act == null) return;
      const col = p.res === "over" ? C.over : p.res === "under" ? C.under : C.accent;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(xs(i), ys(p.act), 9, 0, Math.PI * 2); ctx.fill();
      const lowAct = p.line != null && p.act < p.line; // point under its line: label goes below the point
      if (lowAct && ys(p.act) + fs + 16 > B - 2) text(ctx, n1(p.act), xs(i) + 16, ys(p.act) + 8, f(fs, 600), col, "left"); // near the axis: label beside the point
      else text(ctx, n1(p.act), xs(i), lowAct ? ys(p.act) + fs + 16 : ys(p.act) - 18, f(fs, 600), col, "center");
    });
  }

  // shot: a loaded, CORS-clean headshot <img> (or null). The card is complete without it.
  function draw(d, shot) {
    const H = Math.max(1350, 1188 + d.past.length * 40); // taller card when the table lists every week
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    // header
    text(ctx, "STIX", PAD, 70, f(30, 800), C.accent);
    text(ctx, "NFL props · 2026", PAD + 92, 70, f(26), C.muted);
    const SH = 150; // headshot diameter
    if (shot) drawHeadshot(ctx, shot, W - PAD - SH / 2, 44 + SH / 2, SH / 2);
    text(ctx, fit(ctx, d.p.name, f(66, 800), W - 2 * PAD - (shot ? SH + 24 : 0)), PAD, 150, f(66, 800), C.ink);
    text(ctx, `${d.p.team} · ${d.slot} · ${d.mk.label}`, PAD, 198, f(34, 500), C.muted);

    // upcoming game box: three columns (line / opponent defense rank / weather) so the whole width is used
    let y = 230;
    roundRect(ctx, PAD, y, W - 2 * PAD, 200, 20, "#f7f7f5", C.line);
    const bx = PAD + 28;
    if (d.up) {
      text(ctx, `Week ${d.up.wk} ${d.up.ha === "home" ? "vs" : "@"} ${d.up.opp}`, bx, y + 54, f(36, 700), C.ink);
      const ln = currentLine(d.upM);
      text(ctx, "LINE", bx, y + 104, f(22, 600), C.muted);
      if (ln) {
        const lw = text(ctx, n1(ln.line), bx, y + 152, f(52, 800), C.ink);
        text(ctx, `O ${oddsT(ln.op)} / U ${oddsT(ln.up)}`, bx + lw + 16, y + 152, f(24), C.muted);
      } else text(ctx, "Not posted yet", bx, y + 150, f(34, 600), C.muted);
      const m = d.upM || {};
      const cx = PAD + 410;
      text(ctx, "OPP D RANK", cx, y + 104, f(22, 600), C.muted);
      if (m.drk != null) {
        const q = Math.round((m.dof || 32) / 4);
        const col = m.dn < 3 ? C.ink : m.drk <= q ? C.tough : m.drk > (m.dof || 32) - q ? C.easy : C.ink;
        text(ctx, ordinal(m.drk), cx, y + 152, f(48, 800), col);
      } else text(ctx, "no data", cx, y + 150, f(32), C.muted);
      const wx = wxText(d.up.gid), wxx = PAD + 600, wxw = W - PAD - 28 - wxx;
      text(ctx, "WEATHER", wxx, y + 104, f(22, 600), C.muted);
      if (wx) {
        const parts = wx.split(" · ");
        text(ctx, fit(ctx, parts[0], f(40, 800), wxw), wxx, y + 148, f(40, 800), C.ink);
        if (parts.length > 1) text(ctx, fit(ctx, parts.slice(1).join(" · "), f(22), wxw), wxx, y + 178, f(22), C.muted);
      } else text(ctx, "no data", wxx, y + 150, f(32), C.muted);
    } else {
      text(ctx, "No upcoming game", bx, y + 70, f(36, 700), C.ink);
    }

    // averages strip
    y = 470;
    const fm = d.fm || {};
    const trend = fm.trend == null ? "—" : fm.trend > 0 ? "↑ Rising" : fm.trend < 0 ? "↓ Falling" : "→ Steady";
    const stats = [
      ["SEASON AVG", fm.avg == null ? "—" : n1(Math.round(fm.avg * 10) / 10), fm.n ? `${fm.n} start${fm.n === 1 ? "" : "s"}` : "no starts"],
      ["LAST 3 AVG", d.last3 == null ? "—" : n1(Math.round(d.last3 * 10) / 10), `${d.n3} game${d.n3 === 1 ? "" : "s"} played`],
      ["TREND", trend, fm.usage || `last ${TREND_RULES.lastN} starts vs season`],
    ];
    const sw = (W - 2 * PAD - 2 * 20) / 3;
    stats.forEach((s, i) => {
      const x = PAD + i * (sw + 20);
      roundRect(ctx, x, y, sw, 120, 16, C.bg, C.line);
      text(ctx, s[0], x + 22, y + 36, f(20, 600), C.muted);
      const col = s[0] === "TREND" && fm.trend ? (fm.trend > 0 ? C.over : C.under) : C.ink;
      text(ctx, s[1], x + 22, y + 82, f(40, 800), col);
      text(ctx, fit(ctx, s[2], f(20), sw - 44), x + 22, y + 108, f(20), C.muted);
    });

    // chart
    drawChart(ctx, d, PAD, 660, W - 2 * PAD, 360);

    // recent games table (newest first)
    y = 1060;
    const recent = d.past.slice().reverse(); // every finished week, newest first
    const cols = [PAD, PAD + 100, PAD + 350, PAD + 520, PAD + 690];
    ["WK", "OPP (D RANK)", "LINE", "ACTUAL", "RESULT"].forEach((h, i) => text(ctx, h, cols[i], y, f(20, 600), C.muted));
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(PAD, y + 14); ctx.lineTo(W - PAD, y + 14); ctx.stroke();
    let anyNC = false;
    recent.forEach((r, i) => {
      const yy = y + 50 + i * 40, m = r.m[d.mid] || {};
      text(ctx, String(r.wk), cols[0], yy, f(26), C.ink);
      const ow = text(ctx, `${r.ha === "home" ? "vs" : "@"} ${r.opp}`, cols[1], yy, f(26), C.ink);
      if (m.drk != null) text(ctx, `(${ordinal(m.drk)})`, cols[1] + ow + 10, yy, f(22), C.muted);
      let lt = "—"; if (m.lstat === "ok") lt = n1(m.line); else if (m.lstat === "not_collected") { lt = "—"; anyNC = true; } else if (m.lstat) lt = "none";
      text(ctx, lt, cols[2], yy, f(26, m.lstat === "ok" ? 700 : 400), m.lstat === "ok" ? C.ink : C.muted);
      text(ctx, r.played === false ? "DNP" : m.act == null ? "—" : n1(m.act), cols[3], yy, f(26, 700), C.ink);
      const res = m.res && m.res !== "pending" ? m.res.toUpperCase() : "";
      text(ctx, res, cols[4], yy, f(24, 700), res === "OVER" ? C.over : res === "UNDER" ? C.under : C.muted);
    });
    if (!recent.length) text(ctx, "No finished games yet", PAD, y + 52, f(26), C.muted);

    // footer
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(PAD, H - 100); ctx.lineTo(W - PAD, H - 100); ctx.stroke();
    const note = (anyNC ? "— = no line collected (tracking began week 7) · " : "") +
      "Lines: DraftKings / FanDuel (The Odds API) · Stats: nflverse";
    text(ctx, fit(ctx, note, f(18), W - 2 * PAD), PAD, H - 70, f(18), C.muted);
    text(ctx, `Research tool, not betting advice · shared ${new Date().toLocaleDateString()}`, PAD, H - 42, f(20), C.muted);
    return cv;
  }

  // ---------- preview + share ----------
  let FILE = null, URLX = null;
  function close() { const o = document.getElementById("share-ov"); if (o) o.remove(); if (URLX) { URL.revokeObjectURL(URLX); URLX = null; } FILE = null; }
  async function open(pid, mid) {
    const d = cardData(pid, mid);
    const shot = await loadHeadshot(d.p.img);
    present(draw(d, shot), { label: "Share player", alt: `Share image for ${d.p.name}, ${d.mk.label}`,
      save: `stix-${d.p.name.replace(/\W+/g, "-").toLowerCase()}-${mid}.png`, file: `stix-${pid}-${mid}.png`,
      link: `${location.origin}${location.pathname}#/player/${pid}` });
  }
  // Preview overlay with Share… / Save image / Copy link / Close for a drawn canvas (player card or picks card).
  function present(cv, o) {
    close();
    const link = o.link;
    const ov = document.createElement("div");
    ov.id = "share-ov"; ov.className = "share-ov";
    ov.innerHTML = `<div class="share-box" role="dialog" aria-label="${esc(o.label)}">
      <img alt="${esc(o.alt)}">
      <div class="share-btns"><button id="sh-send" class="sh-main">Share…</button><a id="sh-save" download="${esc(o.save)}">Save image</a>
      <button id="sh-copy">Copy link</button><button id="sh-close">Close</button></div><p id="sh-msg" class="small muted"></p></div>`;
    document.body.appendChild(ov);
    const img = ov.querySelector("img"), msgEl = ov.querySelector("#sh-msg");
    cv.toBlob((blob) => {
      if (!blob) { msgEl.textContent = "Couldn't make the image on this device."; return; }
      FILE = new File([blob], o.file, { type: "image/png" });
      URLX = URL.createObjectURL(blob);
      img.src = URLX; ov.querySelector("#sh-save").href = URLX;
    }, "image/png");
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector("#sh-close").addEventListener("click", close);
    ov.querySelector("#sh-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); msgEl.textContent = "Link copied."; } catch { msgEl.textContent = link; }
    });
    ov.querySelector("#sh-send").addEventListener("click", async () => {
      if (!FILE) { msgEl.textContent = "Still making the image… try again in a second."; return; }
      // Image + link only: the link on its own becomes the page preview in Messages (no separate text bubble).
      const withFile = { files: [FILE], text: link };
      try {
        if (navigator.canShare && navigator.canShare({ files: [FILE] })) await navigator.share(withFile);
        else if (navigator.share) { await navigator.share({ url: link }); msgEl.textContent = "This browser can't share images; shared the link. Use Save image for the picture."; }
        else msgEl.textContent = "Sharing isn't supported in this browser. Use Save image or Copy link.";
      } catch (e) { if (e && e.name !== "AbortError") msgEl.textContent = "Share didn't go through. Try Save image instead."; }
    });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("hashchange", close);
  // Share buttons are drawn by the player pages (app.js / mobile.js) with data-share="<player id>".
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-share]");
    if (!b) return;
    e.preventDefault();
    const pid = b.dataset.share, p = playerById[pid]; if (!p) return;
    const ms = marketsFor(p.pos);
    const mid = S.market[pid] && ms.some((m) => m.id === S.market[pid]) ? S.market[pid] : ms[0].id;
    open(pid, mid).catch((err) => console.error("share failed", err));
  });
  // ---------- this week's picks card (Picks tab) ----------
  // picks: open + locked picks in the picks.js shape ({ name, pid, pos, gid, wk, mid, side, line, odds, book, src, ko, locked }).
  // Shows only what was saved with each pick; no results (these games haven't been graded).
  function drawPicks(picks) {
    const MAX = 30, shown = picks.slice(0, MAX), RH = 112, TOP = 250;
    const h = TOP + shown.length * RH + (picks.length > MAX ? 50 : 0) + 130;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, h);
    ctx.textBaseline = "alphabetic";
    const wks = [...new Set(picks.map((p) => p.wk))].sort((a, b) => a - b);
    const wkTxt = wks.length === 1 ? `Week ${wks[0]}` : `Weeks ${wks[0]}–${wks[wks.length - 1]}`;
    text(ctx, "STIX", PAD, 70, f(30, 800), C.accent);
    text(ctx, "NFL props · 2026", PAD + 92, 70, f(26), C.muted);
    text(ctx, `My picks · ${wkTxt}`, PAD, 150, f(62, 800), C.ink);
    const nl = picks.filter((p) => p.locked).length;
    text(ctx, `${picks.length} pick${picks.length === 1 ? "" : "s"}${nl ? ` · ${nl} locked (game started)` : ""}`, PAD, 198, f(32, 500), C.muted);
    let y = TOP;
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    shown.forEach((p) => {
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
      const pl = playerById[p.pid], mk = mkt[p.mid], g = D.games[p.gid];
      const right = W - PAD;
      // right side: side + line, then odds · book
      const sideCol = p.side === "o" ? C.over : C.under;
      const big = `${p.side === "o" ? "Over" : "Under"} ${n1(p.line)}`;
      ctx.font = f(42, 800); const bw = ctx.measureText(big).width;
      text(ctx, big, right, y + 52, f(42, 800), sideCol, "right");
      const sub = [oddsT(p.odds), p.src, p.book].filter(Boolean).join(" · ");
      text(ctx, sub, right, y + 90, f(24), C.muted, "right");
      const leftW = right - Math.max(bw, 260) - PAD - 30;
      text(ctx, fit(ctx, `${p.name}${p.locked ? "  🔒" : ""}`, f(36, 700), leftW), PAD, y + 50, f(36, 700), C.ink);
      const gm = g ? `${g.away} @ ${g.home}` : "";
      const meta = [pl ? `${pl.team} ${p.pos || pl.pos}` : p.pos, mk ? mk.label : p.mid, gm, p.ko ? koText(p.ko) : ""].filter(Boolean).join(" · ");
      text(ctx, fit(ctx, meta, f(24), leftW), PAD, y + 90, f(24), C.muted);
      y += RH;
    });
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    if (picks.length > MAX) { text(ctx, `+ ${picks.length - MAX} more picks not shown`, PAD, y + 38, f(26), C.muted); y += 50; }
    text(ctx, fit(ctx, "Line and odds saved when each pick was made · Lines: DraftKings / FanDuel (The Odds API)", f(20), W - 2 * PAD), PAD, h - 70, f(20), C.muted);
    text(ctx, `Research tool, not betting advice · shared ${new Date().toLocaleDateString()}`, PAD, h - 42, f(20), C.muted);
    return cv;
  }
  function openPicks(picks) {
    if (!picks || !picks.length) return;
    const wk = Math.max(...picks.map((p) => p.wk));
    present(drawPicks(picks), { label: "Share this week's picks", alt: `My picks, week ${wk}: ${picks.length} picks`,
      save: `stix-picks-week-${wk}.png`, file: `stix-picks-week-${wk}.png`, link: `${location.origin}${location.pathname}` });
  }
  window.STIX_SHARE = { open, draw, cardData, openPicks, drawPicks };
})();
