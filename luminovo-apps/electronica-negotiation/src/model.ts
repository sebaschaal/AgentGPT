import { boothFor, makerBoothFor, type Booth } from './fair';

export interface Line {
    id: string;
    status: string | null;
    mpn: string;
    manufacturer: string;
    partId: string | null;
    qty: number;
    purchaseQty: number;
    unitPrice: number;
    total: number;
    currency: string | null;
    supplier: string | null;
    stockLocation: string | null;
    priceType: string | null;
    leadDays: number | null;
    manual: boolean;
    abc: string | null;
    notes?: string | null;
}

export interface Option {
    supplier: string;
    total: number;
    unit: number;
    selected: boolean;
    leadDays: number | null;
    tags: string[];
}

export interface CompLine {
    id: string;
    options: Option[];
    count: number;
}

export interface ProjectData {
    project: { id: string; name: string; customer: string; currency: string; number: string | null };
    scenarios: { id: string; name: string }[];
    scenarioId: string | null;
    lines: Line[];
}

export const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export interface SupplierSpend {
    supplier: string;
    spend: number;
    lines: number;
    share: number;
    booth?: Booth;
}

export function supplierSpend(lines: Line[]): { suppliers: SupplierSpend[]; total: number; unsourced: number } {
    const map = new Map<string, SupplierSpend>();
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

export interface MakerSpend extends SupplierSpend {
    via: { supplier: string; spend: number }[]; // which distributors the maker's parts are bought through
    topLines: Line[];
}

export function makerSpend(lines: Line[]): MakerSpend[] {
    const map = new Map<string, MakerSpend>();
    let total = 0;
    for (const l of lines) {
        if (!l.total || !l.manufacturer) continue;
        total += l.total;
        const k = key(l.manufacturer);
        const cur = map.get(k) ?? { supplier: l.manufacturer, spend: 0, lines: 0, share: 0, booth: makerBoothFor(l.manufacturer), via: [], topLines: [] };
        cur.spend += l.total;
        cur.lines += 1;
        cur.topLines.push(l);
        const v = cur.via.find((x) => x.supplier === (l.supplier ?? '—'));
        if (v) v.spend += l.total;
        else cur.via.push({ supplier: l.supplier ?? '—', spend: l.total });
        map.set(k, cur);
    }
    const out = [...map.values()].sort((a, b) => b.spend - a.spend);
    for (const m of out) {
        m.share = total ? m.spend / total : 0;
        m.via.sort((a, b) => b.spend - a.spend);
        m.topLines.sort((a, b) => b.total - a.total);
    }
    return out;
}

export interface HallSpend {
    hall: string;
    spend: number;
    suppliers: SupplierSpend[];
}

export function hallSpend(suppliers: SupplierSpend[]): HallSpend[] {
    const map = new Map<string, HallSpend>();
    for (const s of suppliers) {
        if (!s.booth) continue;
        const h = map.get(s.booth.hall) ?? { hall: s.booth.hall, spend: 0, suppliers: [] };
        h.spend += s.spend;
        h.suppliers.push(s);
        map.set(s.booth.hall, h);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
}

// ------------------------------------------------------------------ negotiation analysis

export interface Held {
    line: Line;
    award: number; // what we pay them today on this line
    alt?: Option; // best competing offer, approved suppliers first
    altApproved: boolean;
    cushion: number | null; // alt / award - 1; negative = a competitor is cheaper
}

const approved = (o: Option) => !o.tags.includes('SupplierNotApproved');

export interface Contestable {
    line: Line;
    theirs: Option;
    award: number; // current winning total
    winner: string | null;
    move: number; // price cut they need to win: 1 - award / theirs; <= 0 means they are already cheapest
    blocker: string | null; // why a cheaper offer was not awarded
}

// Why the cheapest offer did not win the line: the scenario's rules weigh more than price.
export function blockerOf(theirs: Option, line: Line): string | null {
    if (theirs.tags.includes('SupplierNotApproved')) return 'not an approved supplier';
    if (theirs.tags.includes('UnknownLeadTime') || theirs.leadDays === null) return 'lead time unknown';
    if (line.leadDays !== null && theirs.leadDays > line.leadDays + 7) return `lead time ${theirs.leadDays} vs ${line.leadDays} days`;
    if (theirs.tags.includes('LongLeadTime')) return 'long lead time';
    if (line.manual) return 'manual pick by the buyer';
    return 'scenario preference';
}

export interface NotQuoted {
    line: Line;
    award: number;
}

export interface SupplierAnalysis {
    supplier: string;
    covered: number; // lines with competition data
    held: Held[];
    contestable: Contestable[];
    notQuoted: NotQuoted[];
    heldVolume: number;
    matchAsks: Held[];
    matchSavings: number;
    defend: Held[];
}

export function analyse(supplier: string, lines: Line[], comp: Map<string, CompLine>): SupplierAnalysis {
    const k = key(supplier);
    const held: Held[] = [];
    const contestable: Contestable[] = [];
    const notQuoted: NotQuoted[] = [];
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
        if (theirs) {
            const move = 1 - line.total / theirs.total;
            contestable.push({ line, theirs, award: line.total, winner: line.supplier, move, blocker: move <= 0 ? blockerOf(theirs, line) : null });
        }
        else notQuoted.push({ line, award: line.total });
    }
    contestable.sort((a, b) => a.move - b.move);
    notQuoted.sort((a, b) => b.award - a.award);
    held.sort((a, b) => b.award - a.award);
    const matchAsks = held
        .filter((h) => h.cushion !== null && h.cushion < -0.001)
        .sort((a, b) => b.award - b.alt!.total - (a.award - a.alt!.total));
    const defend = held.filter((h) => h.cushion !== null && h.cushion >= -0.001 && h.cushion < 0.05);
    return {
        supplier,
        covered,
        held,
        contestable,
        notQuoted,
        heldVolume: held.reduce((s, h) => s + h.award, 0),
        matchAsks,
        matchSavings: matchAsks.reduce((s, h) => s + (h.award - h.alt!.total), 0),
        defend,
    };
}

export type Mode = 'across' | 'targeted';

export interface SimPoint {
    d: number;
    volume: number; // award volume after the move
    heldAfter: number;
    gained: number;
    giveBack: number;
    net: number; // volume - today's volume
    lines: number;
    wonLines: number;
}

// "We award a line to them as soon as they are the cheapest offer on it."
export function simulate(a: SupplierAnalysis, d: number, mode: Mode): SimPoint {
    const base = a.heldVolume;
    const heldAfter = mode === 'across' ? base * (1 - d) : base;
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

export function curve(a: SupplierAnalysis, mode: Mode, max = 0.3, step = 0.0025): SimPoint[] {
    const pts: SimPoint[] = [];
    for (let d = 0; d <= max + 1e-9; d += step) pts.push(simulate(a, Math.round(d * 10000) / 10000, mode));
    return pts;
}

export function bestStart(a: SupplierAnalysis): { mode: Mode; d: number } {
    const across = sweetSpot(curve(a, 'across'), 'across');
    if (across.net > 0 && across.d > 0) return { mode: 'across', d: across.d };
    const targeted = sweetSpot(curve(a, 'targeted'), 'targeted');
    if (targeted.net > 0 && targeted.d > 0) return { mode: 'targeted', d: targeted.d };
    return { mode: 'across', d: 0.05 };
}

// Across the board: the move that maximises their net revenue change.
// Targeted: net only grows with the discount, so mark the biggest jump: the move (up to 20%) that wins the most new volume
// compared with a move 2.5 points smaller. That is the price point worth putting on the table.
export function sweetSpot(points: SimPoint[], mode: Mode = 'across'): SimPoint {
    if (mode === 'targeted') {
        const byD = (d: number) => points.reduce((a, p) => (Math.abs(p.d - d) < Math.abs(a.d - d) ? p : a), points[0]);
        let best = points[0];
        let bestJump = 0;
        for (const p of points) {
            if (p.d < 0.01 || p.d > 0.2) continue;
            const jump = p.gained - byD(Math.max(0, p.d - 0.025)).gained;
            if (jump > bestJump * 1.05) {
                best = p;
                bestJump = jump;
            }
        }
        return best;
    }
    return points.reduce((best, p) => (p.net > best.net + 1e-6 ? p : best), points[0]);
}

export const BUCKETS = [
    { id: 'blocked', label: 'Cheapest, not awarded', test: (m: number) => m <= 0 },
    { id: 'b5', label: 'Within 5%', test: (m: number) => m > 0 && m <= 0.05 },
    { id: 'b10', label: '5–10%', test: (m: number) => m > 0.05 && m <= 0.1 },
    { id: 'b20', label: '10–20%', test: (m: number) => m > 0.1 && m <= 0.2 },
    { id: 'b99', label: 'Over 20%', test: (m: number) => m > 0.2 },
];

export function buckets(a: SupplierAnalysis) {
    return BUCKETS.map((b) => {
        const items = a.contestable.filter((c) => b.test(c.move));
        return { ...b, count: items.length, volume: items.reduce((s, c) => s + c.award, 0), items };
    });
}

export function blockerSummary(a: SupplierAnalysis) {
    const m = new Map<string, { reason: string; count: number; volume: number }>();
    for (const c of a.contestable) {
        if (c.move > 0 || !c.blocker) continue;
        const k = c.blocker.startsWith('lead time ') && /\d/.test(c.blocker) ? 'longer lead time' : c.blocker;
        const cur = m.get(k) ?? { reason: k, count: 0, volume: 0 };
        cur.count++;
        cur.volume += c.award;
        m.set(k, cur);
    }
    return [...m.values()].sort((x, y) => y.volume - x.volume);
}

export function withinVolume(a: SupplierAnalysis, limit: number) {
    return a.contestable.filter((c) => c.move > 0 && c.move <= limit).reduce((s, c) => s + c.award, 0);
}

// ------------------------------------------------------------------ cross-project spend

export interface PortfolioEntry {
    supplier: string;
    spend: number;
    lines: number;
    projects: number;
}

export function mergePortfolio(
    results: { currency?: string | null; suppliers: Record<string, { spend: number; lines: number }> }[],
    currency?: string,
): Map<string, PortfolioEntry> {
    const map = new Map<string, PortfolioEntry>();
    // Only add up scenarios priced in the project's currency; mixing EUR and USD totals would mislead.
    for (const r of results.filter((x) => !currency || !x.currency || x.currency === currency))
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
