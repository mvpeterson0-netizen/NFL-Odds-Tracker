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
    // stat vs his line: "last 3 games average is less than his current prop line"
    if (/\b(line|prop)\b/.test(seg)) {
      const ln = seg.match(/\b(?:last|past|previous|recent)\s+(\d+)\b/);
      const avgW = /\b(averag\w*|avg|per game)\b/.test(seg), eachW = /\b(each|every)\b/.test(seg);
      if ((ln || avgW) && /\b(than|to|vs\.?|versus|below|above|under|over)\b[^.]{0,40}?\b(line|prop)\b/.test(seg)) {
        let stat = st && st.stat;
        if (!stat) {
          stat = ctx.pos.length === 1 ? DEFAULT_YDS[ctx.pos[0]] : null;
          if (!stat) { out.note = `which stat should be compared to the line? Pick it in the row: "${seg.trim()}"`; return out; }
          out.note = `no stat named; assumed ${STATS[stat].label} (change it in the row)`;
        }
        if (!STATS[stat].market) { out.note = `there are no lines for ${STATS[stat].label}: "${seg.trim()}"`; return out; }
        const opm = findOp(seg);
        const n = ln ? Number(ln[1]) : null;
        out.cond = { row: true, m: n ? (eachW ? "each" : "avgN") : "avg", stat, n: n || 3, op: opm && opm.op !== "between" ? opm.op : "<", cmp: "line", pct: 100 };
        return out;
      }
    }
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

  // ---------- rows (the builder's model) ----------
  // row = { m, stat, n, op, cmp, val, val2, cn, pct }
  //   m   (what to measure): "avg" season avg over starts | "avgN" last n games avg | "each" each of last n games
  //                          | "line" his current line | "move" line move this week | "opp" opponent defense rank
  //   op  : "<" "<=" ">" ">=" "=" "between"
  //   cmp (compare to): "num" (val, or val..val2 for between) | "line" | "avg" | "avgN" (cn games); scaled by pct %
  const MEASURES = [["avg", "Season avg (starts)"], ["avgN", "Last N games avg"], ["each", "Each of last N games"],
    ["line", "Current line"], ["move", "Line move this week"], ["opp", "Opp D rank"]];
  const CMPS = [["num", "a number"], ["line", "his current line"], ["avg", "his season avg"], ["avgN", "his last N avg"]];
  const OPS = [["<", "<"], ["<=", "≤"], [">", ">"], [">=", "≥"], ["=", "="], ["between", "between"]];
  const MARKET_STATS = Object.keys(STATS).filter((k) => STATS[k].market);
  const needsMarket = (m) => m === "line" || m === "move" || m === "opp";
  const newRow = () => ({ m: "avgN", stat: "rec", n: 3, op: "<", cmp: "line", val: 0, val2: 0, cn: 3, pct: 100 });

  function toRow(c) {
    if (c.row) { const r = { ...newRow(), ...c }; delete r.row; return r; }
    const base = { ...newRow(), stat: c.stat, op: c.op, pct: 100 };
    const num = (r) => (c.op === "between" ? { ...r, op: "between", cmp: "num", val: c.val[0], val2: c.val[1] } : { ...r, cmp: "num", val: c.val });
    if (c.kind === "avg") return num({ ...base, m: "avg" });
    if (c.kind === "avgN") return num({ ...base, m: "avgN", n: c.n });
    if (c.kind === "each") return num({ ...base, m: "each", n: c.n });
    if (c.kind === "line") return num({ ...base, m: "line" });
    if (c.kind === "lineAvg") return { ...base, m: "line", cmp: "avg" };
    if (c.kind === "opp") return { ...base, m: "opp", op: "between", cmp: "num", val: c.lo, val2: c.hi, oppPos: c.pos || null };
    return base;
  }

  // ---------- engine ----------
  const cmp = (v, op, x, x2) => op === "<" ? v < x : op === "<=" ? v <= x : op === ">" ? v > x : op === ">=" ? v >= x : op === "=" ? v === x : op === "between" ? v >= Math.min(x, x2) && v <= Math.max(x, x2) : false;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const opTxt = Object.fromEntries(OPS);
  function lineOf(cur, stat) {
    const m = cur && STATS[stat].market && cur.m[STATS[stat].market];
    if (!m) return null;
    if (m.lstat === "ok" && m.line != null) return { v: m.line, lab: "Pre", m };
    const sn = m.snaps && m.snaps.length ? m.snaps[m.snaps.length - 1] : null;
    return sn && sn.line != null ? { v: sn.line, lab: sn.label, m } : null;
  }
  function seasonAvg(stat, ctx) { const v = ctx.starts.map((r) => STATS[stat].get(r)).filter((x) => x != null); return v.length ? { v: mean(v), n: v.length } : null; }
  function lastN(stat, n, ctx) {
    const last = ctx.prior.slice(-n); const v = last.map((r) => STATS[stat].get(r));
    return last.length < n || v.some((x) => x == null) ? null : v;
  }
  // the right-hand side as a number (or null if unknown)
  function rhs(row, ctx) {
    const k = (row.pct ?? 100) / 100;
    if (row.cmp === "num") return { v: Number(row.val), v2: Number(row.val2), txt: row.op === "between" ? `${row.val}–${row.val2}` : `${row.val}` };
    if (row.cmp === "line") { const l = lineOf(ctx.cur, row.stat); return l ? { v: l.v * k, base: l.v, txt: `${pf(row)}line ${num(l.v)} ${l.lab}` } : null; }
    if (row.cmp === "avg") { const a = seasonAvg(row.stat, ctx); return a ? { v: a.v * k, base: a.v, txt: `${pf(row)}avg ${num(a.v)}` } : null; }
    if (row.cmp === "avgN") { const v = lastN(row.stat, row.cn, ctx); return v ? { v: mean(v) * k, base: mean(v), txt: `${pf(row)}last ${row.cn} avg ${num(mean(v))}` } : null; }
    return null;
  }
  // target counts are followed by target share in parentheses, e.g. "7 (24%)"
  const shareFor = (stat, r) => (stat === "tgt" && r && r.tshare != null ? ` (${Math.round(r.tshare * 100)}%)` : "");
  const shareAvg = (stat, rs) => { if (stat !== "tgt") return ""; const v = rs.map((r) => r.tshare).filter((x) => x != null); return v.length ? ` (${Math.round(mean(v) * 100)}%)` : ""; };
  const pf = (row) => ((row.pct ?? 100) !== 100 ? `${row.pct}% of ` : "");
  const gapTxt = (a, b) => (b ? ` (${a - b >= 0 ? "+" : ""}${Math.round(((a - b) / Math.abs(b)) * 100)}%)` : "");

  function evalRow(row, ctx) {
    const st = STATS[row.stat];
    if (!st) return { ok: false, show: "pick a stat" };
    if (needsMarket(row.m) && !st.market) return { ok: false, show: `no lines for ${st.label}` };
    const R = row.m === "opp" ? { v: Number(row.val), v2: Number(row.val2), txt: row.op === "between" ? `${row.val}–${row.val2}` : `${row.val}` } : rhs(row, ctx);
    if (!R) return { ok: false, show: row.cmp === "line" ? "no line yet" : "not enough games" };
    const test = (x) => cmp(x, row.op, R.v, R.v2);
    if (row.m === "each") {
      const v = lastN(row.stat, row.n, ctx);
      if (!v) return { ok: false, show: `fewer than ${row.n} games` };
      return { ok: v.every(test), show: `${v.map((x, i) => num(x, 0) + shareFor(row.stat, ctx.prior.slice(-row.n)[i])).join(", ")} vs ${R.txt}` };
    }
    let L, lt;
    if (row.m === "avg") { const a = seasonAvg(row.stat, ctx); if (!a) return { ok: false, show: "no starts" }; L = a.v; lt = `${num(a.v)}${shareAvg(row.stat, ctx.starts)} avg (${a.n} st)`; }
    else if (row.m === "avgN") { const v = lastN(row.stat, row.n, ctx); if (!v) return { ok: false, show: `fewer than ${row.n} games` }; L = mean(v); const lr = ctx.prior.slice(-row.n); const games = v.map((x, i) => num(x, 0) + shareFor(row.stat, lr[i])).join(", ");
      lt = row.stat === "tgt" ? `${num(L)}${shareAvg(row.stat, lr)} · ${games}` : `${num(L)} (${games})`; } // avoid nested ( ) when shares are shown
    else if (row.m === "line") { const l = lineOf(ctx.cur, row.stat); if (!l) return { ok: false, show: "no line yet" }; L = l.v; lt = `${num(l.v)} ${l.lab}`; }
    else if (row.m === "move") {
      const l = lineOf(ctx.cur, row.stat); const first = l && l.m.snaps && l.m.snaps.length ? l.m.snaps[0] : null;
      if (!l || !first || (l.lab !== "Pre" && l.m.snaps.length < 2)) return { ok: false, show: "needs 2 lines this week" };
      L = l.v - first.line; lt = `${L > 0 ? "+" : ""}${num(L)} (${first.label} ${num(first.line)} → ${l.lab} ${num(l.v)})`;
    }
    else if (row.m === "opp") {
      if (!ctx.cur) return { ok: false, show: "no game" };
      const p = row.oppPos || ctx.pos; const v = (((D.defrank || {})[p] || {})[st.market] || {})[ctx.cur.opp];
      if (!v) return { ok: false, show: `no ${p} rank` };
      L = v[0]; lt = `${ctx.cur.opp} ${ordinal(v[0])} (${num(v[1])}/g)`;
    }
    // gap is always shown against the line/average itself (not the % threshold), e.g. 25.7 vs line 31.5 = -18%
    const gap = row.cmp !== "num" ? gapTxt(L, R.base) : "";
    return { ok: test(L), show: `${lt} vs ${R.txt}${gap}`, gap: row.cmp !== "num" && R.base ? (L - R.base) / Math.abs(R.base) : null };
  }

  function run(spec, near = false) {
    const wk = D.current_week, out = [];
    for (const s of slotsShown(wk)) { // includes extra players when the "All players" switch is on
      const pos = s.slot.slice(0, 2);
      if (spec.pos.length && !spec.pos.includes(pos)) continue;
      if (spec.team && s.team !== spec.team) continue;
      const rows = D.rows[s.pid] || [];
      const cur = rows.find((r) => r.wk === wk);
      if (spec.game && (!cur || cur.gid !== spec.game)) continue;
      const prior = rows.filter((r) => r.wk < wk && r.final && r.played === true);
      const ctx = { prior, starts: prior.filter((r) => STARTER_SLOTS.includes(r.slot)), cur, pos };
      const results = spec.groups.map((g) => g.map((row) => evalRow(row, ctx)));
      const misses = results.filter((g) => !g.some((x) => x.ok)).length;
      if (misses === 0 || (near && misses === 1 && spec.groups.length > 1)) out.push({ s, cur, results, misses });
    }
    return out;
  }

  // ---------- builder UI ----------
  let SPEC = null, TEXT = "", NOTES = [], IGN = [], SORT = "time";
  const opt = (pairs, v) => pairs.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
  const statOpts = (row) => opt((needsMarket(row.m) ? MARKET_STATS : Object.keys(STATS)).map((k) => [k, STATS[k].label]), row.stat);
  function rowHtml(row, gi, ri) {
    const id = `${gi}.${ri}`;
    const nIn = (key, v) => `<input type="number" min="1" max="17" class="bn" data-k="${key}" value="${v}" title="games">`;
    let h = `<div class="brow" data-id="${id}">`;
    h += `<select data-k="m">${opt(MEASURES, row.m)}</select>`;
    if (row.m === "avgN" || row.m === "each") h += `<label class="bw"><span class="bl">last</span>${nIn("n", row.n)}<span class="bl">games</span></label>`;
    h += `<select data-k="stat">${statOpts(row)}</select>`;
    h += `<select data-k="op">${opt(OPS, row.op)}</select>`;
    if (row.m === "opp" || row.m === "move") row.cmp = "num";
    if (row.m !== "opp" && row.m !== "move") h += `<select data-k="cmp">${opt(row.m === "line" ? CMPS.filter(([k]) => k !== "line") : CMPS, row.cmp)}</select>`;
    if (row.cmp === "num") {
      h += `<input type="number" step="0.5" class="bv" data-k="val" value="${row.val}">`;
      if (row.op === "between") h += `<label class="bw"><span class="bl">and</span><input type="number" step="0.5" class="bv" data-k="val2" value="${row.val2}"></label>`;
    } else {
      if (row.cmp === "avgN") h += `<label class="bw"><span class="bl">last</span>${nIn("cn", row.cn)}<span class="bl">games</span></label>`;
      h += `<label class="bw" title="percent of the value on the left, e.g. 90 = 90% of his line"><input type="number" step="5" min="1" class="bp" data-k="pct" value="${row.pct ?? 100}"><span class="bl">% of it</span></label>`;
    }
    if (row.m === "opp") h += `<span class="bl muted">1 = fewest allowed</span>`;
    return h + `<button type="button" class="brm" data-rm="${id}" title="Remove this row">×</button></div>`;
  }
  function builderHtml() {
    const teams = [...new Set(D.slots.filter((x) => x.wk === D.current_week).map((x) => x.team))].sort();
    const games = gamesFor(D.current_week);
    let h = `<div class="builder"><div class="btop">
      <span class="bpos">${["QB", "RB", "WR", "TE"].map((p) => `<label><input type="checkbox" data-pos="${p}" ${SPEC.pos.includes(p) ? "checked" : ""}> ${p}</label>`).join("")}</span>
      <select id="b-team"><option value="">All teams</option>${teams.map((t) => `<option ${t === SPEC.team ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select id="b-game"><option value="">All games</option>${games.map(([gid, g]) => `<option value="${gid}" ${gid === SPEC.game ? "selected" : ""}>${esc(g.away)} @ ${esc(g.home)}</option>`).join("")}</select></div>`;
    SPEC.groups.forEach((g, gi) => {
      h += `${gi ? `<div class="band">AND</div>` : ""}<div class="bgroup">` + g.map((row, ri) => (ri ? `<div class="bor">OR</div>` : "") + rowHtml(row, gi, ri)).join("") +
        `<button type="button" class="badd" data-or="${gi}">+ OR</button></div>`;
    });
    return h + `<div class="bbtns"><button type="button" class="badd" id="b-and">+ AND condition</button></div></div>`;
  }
  function resultsHtml() {
    if (!SPEC.groups.length) return `<p class="muted">Add a condition to see players.</p>`;
    const all = run(SPEC, true);
    let rows = all.filter((x) => x.misses === 0);
    const nearRows = all.filter((x) => x.misses === 1);
    const gapOf = (x) => { for (const g of x.results) for (const r of g) if (r.gap != null) return r.gap; return null; };
    const sorter = (list) => list.sort((a, b) => {
      if (SORT !== "time") { const ga = gapOf(a), gb = gapOf(b); if (ga != null || gb != null) return SORT === "gapUp" ? (gb ?? -1e9) - (ga ?? -1e9) : (ga ?? 1e9) - (gb ?? 1e9); }
      return (a.cur ? a.cur.ko : "").localeCompare(b.cur ? b.cur.ko : "") || a.s.team.localeCompare(b.s.team) || slotRank(a.s.slot) - slotRank(b.s.slot);
    });
    rows = sorter(rows);
    const flat = SPEC.groups.flat();
    const head = (r) => { const mL = Object.fromEntries(MEASURES)[r.m]; return `${r.m === "avgN" || r.m === "each" ? mL.replace("N", r.n) : mL} ${STATS[r.stat] ? STATS[r.stat].label : ""}`; };
    const named = [...new Set(flat.map((r) => STATS[r.stat] && STATS[r.stat].market).filter(Boolean))];
    const lineCell = (cur, mid) => { const l = lineOf(cur, Object.keys(STATS).find((k) => STATS[k].market === mid)); const label = mkt[mid] ? mkt[mid].label : mid;
      if (!cur || !cur.m[mid]) return `<div class="sline"><span class="muted">${esc(label)}:</span> <span class="na">not tracked</span></div>`;
      if (!l) return `<div class="sline"><span class="muted">${esc(label)}:</span> <span class="na">no line yet</span></div>`;
      const m = l.m, src = l.lab === "Pre" ? { op: m.op, up: m.up, book: m.book } : m.snaps[m.snaps.length - 1];
      return `<div class="sline"><span class="muted">${esc(label)}:</span> <b>${num(l.v)}</b> <span class="chip ${l.lab === "Pre" ? "" : "snapchip"}">${esc(l.lab)}</span> <span class="muted">${odds(src.op)} / ${odds(src.up)} · ${esc(BOOK_ABBR[src.book] || src.book)}</span></div>`; };
    const table = (list) => {
      let t = `<div class="panel scroll"><table class="stable"><thead><tr><th>Player</th><th>Game</th><th>Line</th>${flat.map((r) => `<th>${esc(head(r))}</th>`).join("")}</tr></thead><tbody>`;
      for (const { s, cur, results } of list) {
        const mids = named.length ? named : D.markets.filter((m) => m.pos.includes(s.slot.slice(0, 2))).map((m) => m.id);
        t += `<tr><td><a class="pname" href="#/player/${s.pid}">${headshot(s.pid, 28)}${esc(s.name)}</a> <span class="muted small">${esc(s.team)} · ${s.slot}</span></td>
          <td>${cur ? `${cur.ha === "home" ? "vs." : "@"} ${esc(cur.opp)} <span class="muted small">${fmtTime(cur.ko)}</span>` : ""}</td>
          <td class="slines">${mids.map((mid) => lineCell(cur, mid)).join("")}</td>
          ${results.flat().map((x, i) => `<td class="${x.ok ? "sok" : "sno"}" data-label="${esc(head(flat[i]))}">${x.ok ? "✓" : "✗"} ${esc(x.show)}</td>`).join("")}</tr>`;
      }
      return t + `</tbody></table></div>`;
    };
    let h = `<div class="sres"><span class="muted small">${rows.length} player${rows.length === 1 ? "" : "s"} in week ${D.current_week} match every condition.</span>
      <label class="small muted">Sort <select id="b-sort">${opt([["time", "Game time"], ["gapDown", "Biggest gap below"], ["gapUp", "Biggest gap above"]], SORT)}</select></label></div>`;
    if (rows.length) h += table(rows);
    else if (nearRows.length) h += `<h3 class="snear">Closest: ${nearRows.length} player${nearRows.length === 1 ? "" : "s"} who pass every condition but one</h3><p class="muted small">✗ marks the condition each one missed.</p>` + table(sorter(nearRows).slice(0, 40));
    return h;
  }
  function view(arg) {
    // state comes from the URL: #/search/b:<encoded spec> (builder) or #/search/<text> (typed shortcut)
    let incoming = arg ? decodeURIComponent(arg) : "";
    if (incoming.startsWith("b:")) {
      try { const o = JSON.parse(decodeURIComponent(escape(atob(incoming.slice(2))))); SPEC = o.spec; TEXT = o.text || ""; NOTES = o.notes || []; IGN = o.ign || []; } catch { SPEC = null; }
    } else if (incoming) {
      const p = parse(incoming);
      SPEC = { pos: p.pos, team: "", game: "", groups: p.groups.map((g) => g.map(toRow)) };
      TEXT = incoming; NOTES = p.notes; IGN = p.ignored;
    } else if (!SPEC) { SPEC = { pos: [], team: "", game: "", groups: [] }; TEXT = ""; NOTES = []; IGN = []; }
    if (!SPEC) SPEC = { pos: [], team: "", game: "", groups: [] };
    if (SPEC.team === "LA") SPEC.team = "LAR"; // older saved links used nflverse's "LA" for the Rams
    let h = `<div class="srch">${window.STIX_RESEARCH ? window.STIX_RESEARCH.html() : ""}<form id="s-form"><input type="search" id="s-q" placeholder="Optional: type a thesis to fill in the rows, e.g. RBs whose last 3 games average is below their rushing yards line" value="${esc(TEXT)}" autocomplete="off"><button type="submit">Fill rows</button>${SPEC.groups.length || TEXT ? `<button type="button" id="s-clear" class="sclear" title="Clear the search box and every condition">Clear all</button>` : ""}</form>`;
    if (NOTES.length) h += `<p class="snote">How I read it: ${NOTES.map(esc).join(" · ")}</p>`;
    if (IGN.length) h += `<p class="snote warn">Not understood (ignored): ${IGN.map((x) => `“${esc(x)}”`).join(" · ")}. Use the rows below instead.</p>`;
    h += builderHtml();
    h += `<div id="s-results">${resultsHtml()}</div>`;
    if (!SPEC.groups.length) h += `<div class="panel"><h3>Try one</h3><div class="body sx">${EXAMPLES.map((e) => `<a href="#/search/${encodeURIComponent(e)}">${esc(e)}</a>`).join("")}</div></div>`;
    return h + `</div>`;
  }
  function save() {
    // keep the builder state in the address so Back / refresh / sharing a link restore it
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify({ spec: SPEC, text: TEXT, notes: NOTES, ign: IGN }))));
    history.replaceState(null, "", `#/search/b:${encodeURIComponent(enc)}`);
  }
  function refresh(full) {
    save();
    const app = document.getElementById("app");
    if (full) { app.innerHTML = view(location.hash.split("/")[2]); bind(); return; }
    document.getElementById("s-results").innerHTML = resultsHtml();
    bindResults();
  }
  function bindResults() { const s = document.getElementById("b-sort"); if (s) s.addEventListener("change", (e) => { SORT = e.target.value; refresh(false); }); }
  function bind() {
    const f = document.getElementById("s-form");
    if (f) f.addEventListener("submit", (e) => { e.preventDefault(); const q = document.getElementById("s-q").value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/search"; });
    const clr = document.getElementById("s-clear");
    if (clr) clr.addEventListener("click", () => { SPEC = { pos: [], team: "", game: "", groups: [] }; TEXT = ""; NOTES = []; IGN = []; history.replaceState(null, "", "#/search"); document.getElementById("app").innerHTML = view(""); bind(); const q = document.getElementById("s-q"); if (q) q.focus(); });
    const B = document.querySelector(".builder");
    if (!B) return;
    B.querySelectorAll("[data-pos]").forEach((c) => c.addEventListener("change", () => { const p = c.dataset.pos; SPEC.pos = c.checked ? [...new Set([...SPEC.pos, p])] : SPEC.pos.filter((x) => x !== p); refresh(false); }));
    const bt = document.getElementById("b-team"), bg = document.getElementById("b-game");
    if (bt) bt.addEventListener("change", () => { SPEC.team = bt.value; refresh(false); });
    if (bg) bg.addEventListener("change", () => { SPEC.game = bg.value; refresh(false); });
    B.querySelectorAll(".brow").forEach((el) => {
      const [gi, ri] = el.dataset.id.split(".").map(Number);
      el.querySelectorAll("[data-k]").forEach((inp) => inp.addEventListener("change", () => {
        const row = SPEC.groups[gi][ri], k = inp.dataset.k;
        row[k] = inp.type === "number" ? Number(inp.value) : inp.value;
        if (k === "m" && needsMarket(row.m) && !STATS[row.stat].market) row.stat = "rec";
        if (k === "m" && row.m === "opp") { row.op = "between"; row.val = 23; row.val2 = 32; }
        // structure-changing fields redraw the builder; values just rerun the results
        refresh(["m", "op", "cmp"].includes(k));
      }));
    });
    B.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { const [gi, ri] = b.dataset.rm.split(".").map(Number); SPEC.groups[gi].splice(ri, 1); if (!SPEC.groups[gi].length) SPEC.groups.splice(gi, 1); refresh(true); }));
    B.querySelectorAll("[data-or]").forEach((b) => b.addEventListener("click", () => { SPEC.groups[+b.dataset.or].push(newRow()); refresh(true); }));
    const add = document.getElementById("b-and");
    if (add) add.addEventListener("click", () => { SPEC.groups.push([newRow()]); refresh(true); });
    bindResults();
  }
  const EXAMPLES = [
    "RBs whose last 3 games average is less than their rushing yards line",
    "RBs who average 1.0 reception per game or 3 targets per game but had less than 2 catches in each of the last 3 games and are facing a bottom 10 defense vs RB receptions",
    "WRs averaging at least 6 targets per game facing a bottom 8 defense vs WR receiving yards",
    "TEs with 4 or more receptions in each of the last 3 games",
    "QBs facing a top 5 defense vs QB passing yards",
  ];
  window.STIX_SEARCH = { parse, run, evalRow, toRow, view, bind, STATS };
})();
