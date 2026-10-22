"use strict";
// Stix Search: type a thesis in plain English, get the players who fit.
//
// Two steps, kept separate on purpose:
//   1. parse(text) -> spec   (this file's rule-based parser; an AI translator could produce the same spec later)
//   2. run(spec)   -> rows   (deterministic filter engine over the site data)
//
// Spec format:
//   { pos: ["RB", ...],                       // empty = all positions
//     groups: [ [cond, cond], [cond] ],       // every group must pass (AND); inside a group any condition may pass (OR)
//     notes: ["assumed ..."], ignored: ["words not understood"] }
//   cond kinds:
//     { kind: "avg",  stat, op, val }                 season average over STARTS (STARTER_SLOTS) before this week
//     { kind: "avgN", stat, op, val, n }              average over his last n games played
//     { kind: "each", stat, op, val, n }              every one of his last n games played
//     { kind: "opp",  stat, pos?, lo, hi }            this week's opponent's season rank vs the position in that stat (1 = fewest allowed)
//     { kind: "line", stat, op, val }                 this week's line (graded pre-game line, else latest snapshot) vs a number
//     { kind: "lineAvg", stat, op }                   this week's line vs his season average (starts)
//   op: "<", "<=", ">", ">=", "=", or "between" with val = [lo, hi]
(function () {
  // ---------- vocabulary ----------
  const STATS = {
    rec:      { label: "receptions", get: (r) => r.m.rec?.act, market: "rec" },
    tgt:      { label: "targets", get: (r) => r.tgt, market: null },
    rec_yds:  { label: "receiving yards", get: (r) => r.m.rec_yds?.act, market: "rec_yds" },
    rush_yds: { label: "rushing yards", get: (r) => r.m.rush_yds?.act, market: "rush_yds" },
    rush_att: { label: "carries", get: (r) => (r.m.rush_att?.act ?? r.car), market: "rush_att" },
    pass_yds: { label: "passing yards", get: (r) => r.m.pass_yds?.act, market: "pass_yds" },
    pass_att: { label: "pass attempts", get: (r) => r.m.pass_att?.act, market: "pass_att" },
    pass_cmp: { label: "completions", get: (r) => r.m.pass_cmp?.act, market: "pass_cmp" },
    snap:     { label: "snap %", get: (r) => r.snap, market: null },
    tshare:   { label: "target share %", get: (r) => (r.tshare == null ? null : r.tshare * 100), market: null },
  };
  // longest phrases first
  const STAT_WORDS = [
    ["target share", "tshare"], ["targets share", "tshare"], ["snap share", "snap"], ["snap percentage", "snap"], ["snap %", "snap"], ["snaps", "snap"],
    ["receiving yards", "rec_yds"], ["receiving yds", "rec_yds"], ["rec yards", "rec_yds"], ["rec yds", "rec_yds"],
    ["rushing yards", "rush_yds"], ["rushing yds", "rush_yds"], ["rush yards", "rush_yds"], ["rush yds", "rush_yds"],
    ["passing yards", "pass_yds"], ["passing yds", "pass_yds"], ["pass yards", "pass_yds"], ["pass yds", "pass_yds"],
    ["pass attempts", "pass_att"], ["passing attempts", "pass_att"], ["attempts", "pass_att"],
    ["rush attempts", "rush_att"], ["rushing attempts", "rush_att"], ["carries", "rush_att"], ["carry", "rush_att"], ["rushes", "rush_att"],
    ["completions", "pass_cmp"], ["completion", "pass_cmp"],
    ["receptions", "rec"], ["reception", "rec"], ["catches", "rec"], ["catch", "rec"], ["recs", "rec"],
    ["targets", "tgt"], ["target", "tgt"], ["tgts", "tgt"], ["tgt", "tgt"],
    ["yards", "_yds"], ["yds", "_yds"],
  ];
  const POS_WORDS = [
    [/\b(qbs?|quarterbacks?)\b/, "QB"], [/\b(rbs?|running ?backs?|backs)\b/, "RB"],
    [/\b(wrs?|wide ?receivers?|receivers?)\b/, "WR"], [/\b(tes?|tight ?ends?)\b/, "TE"],
  ];
  const DEFAULT_YDS = { QB: "pass_yds", RB: "rush_yds", WR: "rec_yds", TE: "rec_yds" };

  const esc2 = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function findStat(seg, pos) {
    for (const [w, k] of STAT_WORDS) {
      const re = new RegExp(`(^|[^a-z])${esc2(w)}([^a-z]|$)`);
      if (re.test(seg)) {
        if (k === "_yds") return { stat: pos.length === 1 ? DEFAULT_YDS[pos[0]] : null, guessed: true };
        return { stat: k };
      }
    }
    return null;
  }
  function findOp(seg) {
    const tests = [
      [/\bbetween\s+(\d+(?:\.\d+)?)\s*(?:-|to|and)\s*(\d+(?:\.\d+)?)/, "between"],
      [/(at most|no more than|or_(?:fewer|less|lower)|<=|≤|maximum of|max of|up to)/, "<="],
      [/(at least|or_(?:more|greater|higher)|>=|≥|minimum of|min of|no less than|no fewer than)/, ">="],
      [/(less than|fewer than|under|below|lower than|<|only had less than|only)/, "<"],
      [/(more than|greater than|over|above|higher than|>|exceed)/, ">"],
      [/\b(exactly|equal to|=)\b/, "="],
    ];
    for (const [re, op] of tests) {
      const m = seg.match(re);
      if (m) return op === "between" ? { op, val: [Number(m[1]), Number(m[2])] } : { op };
    }
    return null;
  }

  function parseSegment(seg, ctx) {
    const out = { cond: null, note: null };
    // defense rank: "bottom 10 defense", "top 5 defense", "defense ranked 20th or worse/better"
    let m = seg.match(/\b(top|bottom|worst|best)\s+(\d+)\b[^.]*?\b(defen[cs]es?|d|defensive|matchups?)\b/) ||
            seg.match(/\b(defen[cs]es?|d|opponents?)\b[^.]*?\b(top|bottom|worst|best)\s+(\d+)\b/);
    const rk = seg.match(/\b(?:defen[cs]e|opponent|d)\b[^.]*?\branked\s+(\d+)(?:st|nd|rd|th)?\s+or_(worse|lower|better|higher)/) ||
               seg.match(/\branked\s+(\d+)(?:st|nd|rd|th)?\s+or_(worse|lower|better|higher)\b[^.]*?\b(?:defen[cs]e|d)\b/);
    if (m || rk) {
      const st = findStat(seg, ctx.pos);
      const posIn = POS_WORDS.map(([re, p]) => (seg.match(re) ? p : null)).filter(Boolean);
      if (!st || !st.stat) { out.note = `defense rank needs a stat (e.g. "vs RB receptions"): "${seg.trim()}"`; return out; }
      if (!STATS[st.stat].market) { out.note = `defense ranks aren't available for ${STATS[st.stat].label}: "${seg.trim()}"`; return out; }
      let lo, hi, of = 32;
      if (m) {
        const word = m[1] === "top" || m[1] === "bottom" || m[1] === "worst" || m[1] === "best" ? m[1] : m[2];
        const n = Number(m[1] === word ? m[2] : m[3]);
        // "top"/"best" = toughest (fewest allowed); "bottom"/"worst" = most allowed
        if (word === "top" || word === "best") { lo = 1; hi = n; } else { lo = of - n + 1; hi = of; }
      } else {
        const n = Number(rk[1]);
        if (rk[2] === "worse" || rk[2] === "lower") { lo = n; hi = of; } else { lo = 1; hi = n; }
      }
      out.cond = { kind: "opp", stat: st.stat, pos: posIn.length === 1 ? posIn[0] : null, lo, hi };
      return out;
    }
    const st = findStat(seg, ctx.pos);
    // line vs average: "line below his average", "line is under his season average"
    if (/\bline\b/.test(seg)) {
      const op = findOp(seg);
      if (!st || !st.stat) { out.note = `which stat's line? "${seg.trim()}"`; return out; }
      if (!STATS[st.stat].market) { out.note = `there are no lines for ${STATS[st.stat].label}: "${seg.trim()}"`; return out; }
      if (/\baverage|avg\b/.test(seg)) { out.cond = { kind: "lineAvg", stat: st.stat, op: op ? op.op : "<" }; return out; }
      const num = seg.replace(/\b(last|past)\s+\d+\b/g, "").match(/(\d+(?:\.\d+)?)/);
      if (num && op) { out.cond = { kind: "line", stat: st.stat, op: op.op, val: op.op === "between" ? op.val : Number(num[1]) }; return out; }
      out.note = `couldn't read the line condition: "${seg.trim()}"`; return out;
    }
    if (!st) return out; // no stat: filler words ("show me", positions only)
    if (!st.stat) { out.note = `"yards" is ambiguous here; say receiving, rushing or passing yards: "${seg.trim()}"`; return out; }
    if (st.guessed) out.note = `read "yards" as ${STATS[st.stat].label}`;
    const lastN = seg.match(/\b(?:last|past|previous|recent)\s+(\d+)\s*(?:games?|weeks?|starts?)?\b/) || seg.match(/\b(?:last|past)\s+(two|three|four|five|six)\b/);
    const words = { two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = lastN ? Number(words[lastN[1]] || lastN[1]) : null;
    const opm = findOp(seg);
    const nums = seg.replace(/\b(?:last|past|previous|recent)\s+\d+\b/g, " ").replace(/\b(top|bottom)\s+\d+\b/g, " ").match(/(\d+(?:\.\d+)?)/g);
    const val = opm && opm.op === "between" ? opm.val : nums ? Number(nums[0]) : null;
    const isEach = /\b(each|every|all of|in all|every one|each one|straight|consecutive)\b/.test(seg);
    const isAvg = /\b(averag\w*|avg|per game|a game|per week)\b/.test(seg);
    let kind = null;
    if (n && isEach) kind = "each"; else if (n && isAvg) kind = "avgN"; else if (n) kind = "each"; else if (isAvg) kind = "avg";
    out.partial = { stat: st.stat, kind, op: opm ? opm.op : null, val, n };
    if (n && !isEach && !isAvg) out.note = (out.note ? out.note + "; " : "") + `read "last ${n}" as every one of the last ${n} games`;
    return out;
  }

  const FILLER = /\b(show|me|find|list|give|get|all|any|anyone|players?|guys|the|a|an|are|is|be|been|this|upcoming|next|week|weeks|have|has|had|only|facing|faces|face|playing|play|who|whose|that|with|those|them|of|in|on|for|games?|season|please|i|want|looking|look|see)\b/g;
  function leftover(seg) {
    let x = " " + seg + " ";
    for (const [re] of POS_WORDS) x = x.replace(new RegExp(re.source, "g"), " ");
    return x.replace(FILLER, " ").replace(/[^a-z]+/g, " ").trim().length > 2;
  }

  function parse(text) {
    const spec = { pos: [], groups: [], notes: [], ignored: [], text };
    let t = " " + String(text || "").toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ") + " ";
    for (const [re, p] of POS_WORDS) if (re.test(t.split(/\b(?:defen[cs]e|vs\.?|against|to)\b/)[0])) spec.pos.push(p);
    // positions only from the part that describes the players (before any defense phrase)
    spec.pos = [...new Set(spec.pos)];
    t = t.replace(/\bbetween\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/g, "between $1-$2");
    // keep "4 or more", "25th or worse" together so they aren't read as OR
    t = t.replace(/\bor\s+(more|fewer|less|better|worse|higher|lower|greater)\b/g, "or_$1");
    const ctx = { pos: spec.pos };
    // AND boundaries: joining words, punctuation, and the start of a matchup phrase ("facing ...", "against ...")
    const andParts = t.split(/\b(?:but|and|while|also|plus|with|who|whose|that)\b|[,;]|(?=\b(?:facing|faces|face|playing against|going against|against|matched up)\b)/)
      .map((s) => (s || "").trim()).filter(Boolean);
    for (const part of andParts) {
      const orParts = part.split(/\bor\b/).map((s) => s.trim()).filter(Boolean);
      const group = [];
      let prev = null;
      for (const seg of orParts) {
        const r = parseSegment(" " + seg + " ", ctx);
        if (r.note) spec.notes.push(r.note);
        let c = r.cond;
        if (!c && r.partial) {
          const p = r.partial;
          // inherit missing pieces from the previous condition in the same OR group ("1 catch per game OR 3 targets")
          if (prev && prev.kind !== "opp") { p.kind = p.kind || prev.kind; p.op = p.op || prev.op; p.n = p.n || prev.n; }
          if (!p.kind) p.kind = "avg";
          if (!p.op) { p.op = ">="; spec.notes.push(`read "${STATS[p.stat].label} ${p.val ?? ""}" as at least ${p.val ?? ""}`); }
          if (p.val == null) { spec.notes.push(`no number found for ${STATS[p.stat].label}: "${seg}"`); continue; }
          c = { kind: p.kind, stat: p.stat, op: p.op, val: p.val };
          if (p.kind === "each" || p.kind === "avgN") c.n = p.n;
        }
        if (c) { group.push(c); prev = c; }
        else if (!r.note && leftover(seg)) spec.ignored.push(seg);
      }
      if (group.length) spec.groups.push(group);
    }
    return spec;
  }

  // ---------- engine ----------
  const cmp = (v, op, x) => op === "<" ? v < x : op === "<=" ? v <= x : op === ">" ? v > x : op === ">=" ? v >= x : op === "=" ? v === x : op === "between" ? v >= x[0] && v <= x[1] : false;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const opTxt = { "<": "<", "<=": "≤", ">": ">", ">=": "≥", "=": "=" };
  const valTxt = (c) => (c.op === "between" ? `${c.val[0]}–${c.val[1]}` : `${opTxt[c.op]} ${c.val}`);

  function describe(c) {
    const s = STATS[c.stat].label;
    if (c.kind === "avg") return `season avg ${s} ${valTxt(c)} (starts)`;
    if (c.kind === "avgN") return `avg ${s} ${valTxt(c)} over last ${c.n} games`;
    if (c.kind === "each") return `${s} ${valTxt(c)} in each of last ${c.n} games`;
    if (c.kind === "opp") return `opponent ranked ${c.lo}–${c.hi} vs ${c.pos || "his position"} ${s} (1 = fewest allowed)`;
    if (c.kind === "line") return `this week's ${s} line ${valTxt(c)}`;
    if (c.kind === "lineAvg") return `this week's ${s} line ${opTxt[c.op]} his season avg`;
    return JSON.stringify(c);
  }

  function evalCond(c, ctx) {
    const st = STATS[c.stat];
    const { prior, starts, cur, pos } = ctx;
    if (c.kind === "avg" || c.kind === "lineAvg") {
      const vals = starts.map((r) => st.get(r)).filter((v) => v != null);
      if (!vals.length) return { ok: false, show: "no starts" };
      const a = mean(vals);
      if (c.kind === "avg") return { ok: cmp(a, c.op, c.val), show: `${num(a)} avg (${vals.length} st)` };
      const ln = lineOf(cur, c.stat);
      if (ln == null) return { ok: false, show: "no line yet" };
      return { ok: cmp(ln.v, c.op, a), show: `${num(ln.v)} ${ln.lab} vs ${num(a)} avg` };
    }
    if (c.kind === "avgN" || c.kind === "each") {
      const last = prior.slice(-c.n);
      const vals = last.map((r) => st.get(r));
      if (last.length < c.n || vals.some((v) => v == null)) return { ok: false, show: `only ${last.length} games` };
      if (c.kind === "avgN") { const a = mean(vals); return { ok: cmp(a, c.op, c.val), show: `${num(a)} avg (${vals.map((v) => num(v, 0)).join(", ")})` }; }
      return { ok: vals.every((v) => cmp(v, c.op, c.val)), show: vals.map((v) => num(v, 0)).join(", ") };
    }
    if (c.kind === "opp") {
      if (!cur) return { ok: false, show: "no game" };
      const p = c.pos || pos;
      const v = (((D.defrank || {})[p] || {})[st.market] || {})[cur.opp];
      if (!v) return { ok: false, show: `no ${p} rank` };
      return { ok: v[0] >= c.lo && v[0] <= c.hi, show: `${cur.opp} ${ordinal(v[0])} (${num(v[1])}/g)` };
    }
    if (c.kind === "line") {
      const ln = lineOf(cur, c.stat);
      if (ln == null) return { ok: false, show: "no line yet" };
      return { ok: cmp(ln.v, c.op, c.val), show: `${num(ln.v)} ${ln.lab}` };
    }
    return { ok: false, show: "?" };
  }
  function lineOf(cur, stat) {
    const m = cur && cur.m[STATS[stat].market];
    if (!m) return null;
    if (m.lstat === "ok" && m.line != null) return { v: m.line, lab: "Pre" };
    const sn = m.snaps && m.snaps.length ? m.snaps[m.snaps.length - 1] : null;
    return sn && sn.line != null ? { v: sn.line, lab: sn.label } : null;
  }

  function run(spec, near = false) {
    const wk = D.current_week;
    const out = [];
    for (const s of D.slots.filter((x) => x.wk === wk)) {
      const pos = s.slot.slice(0, 2);
      if (spec.pos.length && !spec.pos.includes(pos)) continue;
      const rows = D.rows[s.pid] || [];
      const cur = rows.find((r) => r.wk === wk);
      const prior = rows.filter((r) => r.wk < wk && r.final && r.played === true);
      const starts = prior.filter((r) => STARTER_SLOTS.includes(r.slot));
      const ctx = { prior, starts, cur, pos };
      const results = spec.groups.map((g) => g.map((c) => evalCond(c, ctx)));
      const misses = results.filter((g) => !g.some((x) => x.ok)).length;
      if (misses === 0 || (near && misses === 1 && spec.groups.length > 1)) out.push({ s, cur, results, misses });
    }
    out.sort((a, b) => (a.cur ? a.cur.ko : "").localeCompare(b.cur ? b.cur.ko : "") || a.s.team.localeCompare(b.s.team) || SLOT_ORDER.indexOf(a.s.slot) - SLOT_ORDER.indexOf(b.s.slot));
    return out;
  }

  // ---------- view ----------
  const EXAMPLES = [
    "RBs who average 1.0 reception per game or 3 targets per game but had less than 2 catches in each of the last 3 games and are facing a bottom 10 defense vs RB receptions",
    "WRs averaging at least 6 targets per game facing a bottom 8 defense vs WR receiving yards",
    "TEs with 4 or more receptions in each of the last 3 games",
    "RBs averaging 15 carries per game whose rushing yards line is below their average",
    "QBs facing a top 5 defense vs QB passing yards",
    "WRs with a target share over 25 averaged over the last 3 games",
  ];
  let LAST = { text: "", spec: null, rows: [] };
  function view(arg, edited) {
    const text = arg ? decodeURIComponent(arg) : "";
    let h = `<div class="srch"><form id="s-form"><input type="search" id="s-q" placeholder="Describe the players you want, e.g. RBs averaging 3 targets per game facing a bottom 10 defense vs RB receptions" value="${esc(text)}" autocomplete="off"><button type="submit">Search</button></form>`;
    if (!text) {
      h += `<p class="callout">Type a thesis in plain English. Stix turns it into exact filters (shown below the box so you can check how it read you) and lists every player in this week's games who passes them all.</p>
        <div class="panel"><h3>Try one</h3><div class="body sx">${EXAMPLES.map((e) => `<a href="#/search/${encodeURIComponent(e)}">${esc(e)}</a>`).join("")}</div></div>
        ${helpPanel()}</div>`;
      return h;
    }
    const spec = edited || parse(text);
    const all = spec.groups.length ? run(spec, true) : [];
    const rows = all.filter((x) => x.misses === 0);
    const nearRows = all.filter((x) => x.misses === 1);
    LAST = { text, spec, rows };
    h += `<div class="schips">${spec.pos.length ? `<span class="schip pos">${spec.pos.join(" or ")}</span>` : `<span class="schip pos">all positions</span>`}`;
    spec.groups.forEach((g, gi) => {
      h += (gi || spec.pos.length || true ? `<span class="sand">AND</span>` : "") + `<span class="sgroup">` +
        g.map((c, ci) => `<span class="schip" title="${esc(JSON.stringify(c))}">${esc(describe(c))} <button class="sx-rm" data-g="${gi}" data-c="${ci}" title="Remove this filter">×</button></span>`).join(`<span class="sor">OR</span>`) + `</span>`;
    });
    h += `</div>`;
    if (spec.notes.length) h += `<p class="snote">How I read it: ${spec.notes.map(esc).join(" · ")}</p>`;
    if (spec.ignored.length) h += `<p class="snote warn">Not understood (ignored): ${spec.ignored.map((x) => `“${esc(x)}”`).join(" · ")}. Try rewording; see the examples below.</p>`;
    if (!spec.groups.length) return h + `<p class="muted">No filters recognized. ${helpLink()}</p>${helpPanel()}</div>`;
    h += `<p class="muted small">${rows.length} player${rows.length === 1 ? "" : "s"} in week ${D.current_week} match every filter. Values shown are what each player was checked on. ${helpLink()}</p>`;
    const flat = spec.groups.flat();
    const table = (list) => {
      let t = `<div class="panel scroll"><table class="stable"><thead><tr><th>Player</th><th>Game</th>${flat.map((c) => `<th title="${esc(describe(c))}">${esc(shortHead(c))}</th>`).join("")}</tr></thead><tbody>`;
      for (const { s, cur, results } of list) {
        const cells = results.flat();
        t += `<tr><td><a class="pname" href="#/player/${s.pid}">${headshot(s.pid, 28)}${esc(s.name)}</a> <span class="muted small">${esc(s.team)} · ${s.slot}</span></td>
        <td>${cur ? `${cur.ha === "home" ? "vs." : "@"} ${esc(cur.opp)} <span class="muted small">${fmtTime(cur.ko)}</span>` : ""}</td>
        ${cells.map((x, i) => `<td class="${x.ok ? "sok" : "sno"}" data-label="${esc(shortHead(flat[i]))}">${x.ok ? "✓" : "✗"} ${esc(x.show)}</td>`).join("")}</tr>`;
      }
      return t + `</tbody></table></div>`;
    };
    if (rows.length) h += table(rows);
    if (!rows.length && nearRows.length) {
      h += `<h3 class="snear">Closest: ${nearRows.length} player${nearRows.length === 1 ? "" : "s"} who pass every filter but one</h3>
        <p class="muted small">✗ marks the filter each one missed.</p>` + table(nearRows.slice(0, 40));
    }
    return h + `${helpPanel()}</div>`;
  }
  function shortHead(c) {
    const s = STATS[c.stat].label;
    return c.kind === "avg" ? `Avg ${s}` : c.kind === "avgN" ? `Last ${c.n} avg ${s}` : c.kind === "each" ? `Last ${c.n} ${s}` :
      c.kind === "opp" ? `Opp vs ${c.pos || ""} ${s}` : c.kind === "lineAvg" ? `${s} line vs avg` : `${s} line`;
  }
  const helpLink = () => `<a href="#/search">Examples &amp; what it understands</a>`;
  function helpPanel() {
    return `<div class="panel"><h3>What Search understands</h3><div class="body small">
      <p><b>Positions:</b> QB, RB, WR, TE (or quarterbacks, running backs, receivers, tight ends).</p>
      <p><b>Stats:</b> receptions/catches, targets, receiving yards, rushing yards, carries/rush attempts, passing yards, pass attempts, completions, snap share, target share.</p>
      <p><b>Season average</b> ("averages 3 targets per game"): over his <b>starts</b> this season, same as AVG elsewhere. <b>Last N</b> ("in each of the last 3 games", "averaging 5 over the last 4 games"): his last N games <b>played</b>.</p>
      <p><b>Comparisons:</b> at least / or more, at most / or fewer, more than / over, less than / under, between X and Y, exactly. No comparison means "at least".</p>
      <p><b>Defense:</b> "facing a bottom 10 defense vs RB receptions" (most allowed: ranks 23–32), "top 5 defense vs WR receiving yards" (toughest: ranks 1–5), "defense ranked 20th or worse vs TE receptions". Uses this week's opponent and its current-season rank (the Defense tab).</p>
      <p><b>Lines:</b> "receiving yards line under 50", "rushing yards line below his average". Uses the pre-game line if captured, otherwise the latest Mon/Thu/Sun AM snapshot.</p>
      <p><b>Combining:</b> "and", "but", "while", commas = all must be true; "or" = either is enough within that part.</p>
      <p class="muted">The parser is rule-based: it never guesses silently. Anything it reads with an assumption is listed under "How I read it", and anything it can't read is listed as ignored.</p>
    </div></div>`;
  }
  function bind() {
    const f = document.getElementById("s-form");
    if (f) f.addEventListener("submit", (e) => { e.preventDefault(); const q = document.getElementById("s-q").value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/search"; });
    document.querySelectorAll(".sx-rm").forEach((b) => b.addEventListener("click", () => {
      // Removing a chip re-runs the search without that filter (the box keeps your original text).
      const spec = JSON.parse(JSON.stringify(LAST.spec));
      const g = +b.dataset.g, c = +b.dataset.c;
      spec.groups[g].splice(c, 1);
      if (!spec.groups[g].length) spec.groups.splice(g, 1);
      document.getElementById("app").innerHTML = view(encodeURIComponent(LAST.text), spec);
      bind();
    }));
  }
  window.STIX_SEARCH = { parse, run, describe, view, bind, STATS };
})();
