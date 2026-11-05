// src/fair.ts
var COL_X = (i) => 175 + (i - 1) * 135;
var W = 122;
var H = 96;
var ROW_Y = { A: 70, B: 212, C: 354 };
var HALLS = [
  ...[1, 2, 3, 4, 5, 6].map((i) => ({
    id: `A${i}`,
    x: COL_X(i),
    y: ROW_Y.A,
    w: W,
    h: H,
    topic: ["Electronic manufacturing services", "PCB & EMS", "Power & connectors", "Test & measurement", "Power supplies", "Passive components"][i - 1]
  })),
  { id: "B0", x: 40, y: ROW_Y.B, w: 110, h: H, topic: "SEMICON Europa" },
  ...[1, 2, 3, 4, 5, 6].map((i) => ({
    id: `B${i}`,
    x: COL_X(i),
    y: ROW_Y.B,
    w: W,
    h: H,
    topic: ["SEMICON Europa", "SEMICON Europa", "Electromechanics", "Sensors, MEMS & automotive", "Semiconductors & distribution", "Passives & displays"][i - 1]
  })),
  ...[1, 2, 3, 4, 5, 6].map((i) => ({
    id: `C${i}`,
    x: COL_X(i),
    y: ROW_Y.C,
    w: W,
    h: H,
    topic: ["SEMICON Europa", "Wireless & embedded", "Semiconductors & distribution", "Semiconductors & distribution", "Embedded & distribution", "Distribution & embedded"][i - 1]
  }))
];
var ENTRANCES = [
  { id: "west", label: "Entrance West", x: 92, y: 189 },
  { id: "north", label: "Entrance North", x: COL_X(4) - 7, y: 36 },
  { id: "east", label: "Entrance East", x: 988, y: 189 }
];
var BOOTHS = [
  { company: "Mouser Electronics", hall: "C3", stand: "578", confirmed: true, note: "Shared with parent TTI", source: "mouser.com newsroom", match: /\bmouser\b/i },
  { company: "TTI", hall: "C3", stand: "578", confirmed: true, note: "Shared with Mouser", source: "mouser.com newsroom", match: /^tti\b|\btti (inc|europe)/i },
  { company: "Future Electronics", hall: "C3", stand: "321", confirmed: true, source: "futureelectronics.com", match: /future electronics/i },
  { company: "Avnet (Avnet City)", hall: "B5", stand: "103", confirmed: true, note: "Avnet Silica, Abacus, EBV and Farnell share Avnet City", source: "avnet.com electronica 2026", match: /\bavnet\b|\bebv\b|\bsilica\b/i },
  { company: "Farnell", hall: "B5", stand: "103", confirmed: true, note: "Inside Avnet City", source: "farnell.com electronica 2026", match: /farnell|element ?14|newark/i },
  { company: "DigiKey", hall: "C5", stand: "401", confirmed: true, note: "DigiKey caf\xE9 in B4", source: "DigiKey press release", match: /digi-?key/i },
  { company: "Rutronik", hall: "C6", stand: "379", confirmed: true, source: "rutronik.com electronica 2026", match: /rutronik/i },
  { company: "RS Components", hall: "C6", stand: "279", confirmed: true, source: "rs-online.com electronica 2026", match: /\brs (components|online|group)\b|^rs$|allied electronics/i },
  { company: "TME", hall: "B5", stand: "361", confirmed: true, source: "tme.com events", match: /\btme\b|transfer multisort/i },
  { company: "W\xFCrth Elektronik", hall: "B6", stand: "101", confirmed: true, note: "CBT in B6.102, ICS in A3.334", source: "we-online.com electronica", match: /w(ü|u|ue)rth/i },
  { company: "Arrow Electronics", hall: "C4", stand: "420", confirmed: false, note: "Stand of the 2022 and 2024 editions", source: "Arrow electronica 2024", match: /\barrow\b/i },
  { company: "Verical (Arrow)", hall: "C4", stand: "420", confirmed: false, note: "Arrow company, meet at the Arrow stand", source: "Arrow electronica 2024", match: /verical/i },
  { company: "JLCPCB", hall: "A2", stand: "169", confirmed: true, source: "jlcpcb.com events", match: /jlc/i },
  { company: "STMicroelectronics", hall: "C3", stand: "101", confirmed: true, source: "st.com events", match: /stmicro|^st$/i },
  { company: "Phoenix Contact", hall: "B3", stand: "103", confirmed: true, source: "phoenixcontact.com", match: /phoenix contact/i }
];
function boothFor(supplier) {
  return BOOTHS.find((b) => b.match.test(supplier));
}

// src/model.ts
var key = (s) => (s ?? "").trim().toLowerCase();
function supplierSpend(lines) {
  const map = /* @__PURE__ */ new Map();
  let total = 0;
  let unsourced = 0;
  for (const l of lines) {
    if (!l.supplier || !l.total) {
      unsourced++;
      continue;
    }
    total += l.total;
    const k = key(l.supplier);
    const cur = map.get(k) ?? { supplier: l.supplier, spend: 0, lines: 0, share: 0, booth: boothFor(l.supplier) };
    cur.spend += l.total;
    cur.lines += 1;
    map.set(k, cur);
  }
  const suppliers = [...map.values()].sort((a, b) => b.spend - a.spend);
  for (const s of suppliers) s.share = total ? s.spend / total : 0;
  return { suppliers, total, unsourced };
}
function hallSpend(suppliers) {
  const map = /* @__PURE__ */ new Map();
  for (const s of suppliers) {
    if (!s.booth) continue;
    const h = map.get(s.booth.hall) ?? { hall: s.booth.hall, spend: 0, suppliers: [] };
    h.spend += s.spend;
    h.suppliers.push(s);
    map.set(s.booth.hall, h);
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}
var approved = (o) => !o.tags.includes("SupplierNotApproved");
function analyse(supplier, lines, comp) {
  const k = key(supplier);
  const held = [];
  const contestable = [];
  const notQuoted = [];
  let covered = 0;
  for (const line of lines) {
    const c = comp.get(line.id);
    const isHeld = key(line.supplier) === k;
    if (!c) {
      if (isHeld && line.total) held.push({ line, award: line.total, cushion: null, altApproved: false });
      continue;
    }
    covered++;
    const opts = c.options;
    if (isHeld) {
      const others = opts.filter((o) => key(o.supplier) !== k).sort((a, b) => a.total - b.total);
      const alt = others.find(approved) ?? others[0];
      const award = line.total || opts.find((o) => key(o.supplier) === k)?.total || 0;
      if (!award) continue;
      held.push({ line, award, alt, altApproved: !!alt && approved(alt), cushion: alt ? alt.total / award - 1 : null });
      continue;
    }
    if (!line.total) continue;
    const theirs = opts.filter((o) => key(o.supplier) === k).sort((a, b) => a.total - b.total)[0];
    if (theirs) contestable.push({ line, theirs, award: line.total, winner: line.supplier, move: 1 - line.total / theirs.total });
    else notQuoted.push({ line, award: line.total });
  }
  contestable.sort((a, b) => a.move - b.move);
  notQuoted.sort((a, b) => b.award - a.award);
  held.sort((a, b) => b.award - a.award);
  const matchAsks = held.filter((h) => h.cushion !== null && h.cushion < -1e-3).sort((a, b) => b.award - b.alt.total - (a.award - a.alt.total));
  const defend = held.filter((h) => h.cushion !== null && h.cushion >= -1e-3 && h.cushion < 0.05);
  return {
    supplier,
    covered,
    held,
    contestable,
    notQuoted,
    heldVolume: held.reduce((s, h) => s + h.award, 0),
    matchAsks,
    matchSavings: matchAsks.reduce((s, h) => s + (h.award - h.alt.total), 0),
    defend
  };
}
function simulate(a, d, mode) {
  const base = a.heldVolume;
  const heldAfter = mode === "across" ? base * (1 - d) : base;
  let gained = 0;
  let wonLines = 0;
  for (const c of a.contestable) {
    if (c.move > 0 && c.move <= d + 1e-9) {
      gained += c.theirs.total * (1 - d);
      wonLines++;
    }
  }
  const volume = heldAfter + gained;
  return { d, volume, heldAfter, gained, giveBack: base - heldAfter, net: volume - base, lines: a.held.length + wonLines, wonLines };
}
function curve(a, mode, max = 0.3, step = 25e-4) {
  const pts = [];
  for (let d = 0; d <= max + 1e-9; d += step) pts.push(simulate(a, Math.round(d * 1e4) / 1e4, mode));
  return pts;
}
function bestStart(a) {
  const across = sweetSpot(curve(a, "across"), "across");
  if (across.net > 0 && across.d > 0) return { mode: "across", d: across.d };
  const targeted = sweetSpot(curve(a, "targeted"), "targeted");
  if (targeted.net > 0 && targeted.d > 0) return { mode: "targeted", d: targeted.d };
  return { mode: "across", d: 0.05 };
}
function sweetSpot(points, mode = "across") {
  if (mode === "targeted") {
    const cands = points.filter((p) => p.d >= 0.01 && p.d <= 0.2 && p.gained > 0);
    if (!cands.length) return points[0];
    return cands.reduce((best, p) => p.gained / p.d > best.gained / best.d + 1e-6 ? p : best, cands[0]);
  }
  return points.reduce((best, p) => p.net > best.net + 1e-6 ? p : best, points[0]);
}
var BUCKETS = [
  { id: "blocked", label: "Cheapest, not awarded", test: (m) => m <= 0 },
  { id: "b5", label: "Within 5%", test: (m) => m > 0 && m <= 0.05 },
  { id: "b10", label: "5\u201310%", test: (m) => m > 0.05 && m <= 0.1 },
  { id: "b20", label: "10\u201320%", test: (m) => m > 0.1 && m <= 0.2 },
  { id: "b99", label: "Over 20%", test: (m) => m > 0.2 }
];
function buckets(a) {
  return BUCKETS.map((b) => {
    const items = a.contestable.filter((c) => b.test(c.move));
    return { ...b, count: items.length, volume: items.reduce((s, c) => s + c.award, 0), items };
  });
}
function withinVolume(a, limit) {
  return a.contestable.filter((c) => c.move > 0 && c.move <= limit).reduce((s, c) => s + c.award, 0);
}
function mergePortfolio(results) {
  const map = /* @__PURE__ */ new Map();
  for (const r of results)
    for (const [name, v] of Object.entries(r.suppliers ?? {})) {
      const k = key(name);
      const cur = map.get(k) ?? { supplier: name, spend: 0, lines: 0, projects: 0 };
      cur.spend += v.spend;
      cur.lines += v.lines;
      cur.projects += 1;
      map.set(k, cur);
    }
  return map;
}
export {
  BOOTHS,
  BUCKETS,
  analyse,
  bestStart,
  boothFor,
  buckets,
  curve,
  hallSpend,
  key,
  mergePortfolio,
  simulate,
  supplierSpend,
  sweetSpot,
  withinVolume
};
