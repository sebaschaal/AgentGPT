// electronica 2026, Messe München, 10–13 November 2026.
// The hall plan is schematic (relative positions of the halls, not to scale).
// Booth data comes from each exhibitor's own electronica 2026 announcement.
// `confirmed: false` marks a booth carried over from an earlier edition.

export const FAIR = {
    name: 'electronica 2026',
    venue: 'Messe München',
    dates: '10–13 Nov 2026',
    start: '2026-11-10',
};

export interface Hall {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    topic: string;
}

// Floor plane is 1000 × 520 units.
const COL_X = (i: number) => 175 + (i - 1) * 135;
const W = 122;
const H = 96;
const ROW_Y = { A: 70, B: 212, C: 354 } as const;

export const HALLS: Hall[] = [
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
        id: `A${i}`,
        x: COL_X(i),
        y: ROW_Y.A,
        w: W,
        h: H,
        topic: ['Electronic manufacturing services', 'PCB & EMS', 'Power & connectors', 'Test & measurement', 'Power supplies', 'Passive components'][i - 1],
    })),
    { id: 'B0', x: 40, y: ROW_Y.B, w: 110, h: H, topic: 'SEMICON Europa' },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
        id: `B${i}`,
        x: COL_X(i),
        y: ROW_Y.B,
        w: W,
        h: H,
        topic: ['SEMICON Europa', 'SEMICON Europa', 'Electromechanics', 'Sensors, MEMS & automotive', 'Semiconductors & distribution', 'Passives & displays'][i - 1],
    })),
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
        id: `C${i}`,
        x: COL_X(i),
        y: ROW_Y.C,
        w: W,
        h: H,
        topic: ['SEMICON Europa', 'Wireless & embedded', 'Semiconductors & distribution', 'Semiconductors & distribution', 'Embedded & distribution', 'Distribution & embedded'][i - 1],
    })),
];

export const ENTRANCES = [
    { id: 'west', label: 'Entrance West', x: 92, y: 189 },
    { id: 'north', label: 'Entrance North', x: COL_X(4) - 7, y: 36 },
    { id: 'east', label: 'Entrance East', x: 988, y: 189 },
];

export type BoothKind = 'distributor' | 'manufacturer';

export interface Booth {
    kind?: BoothKind;
    company: string;
    hall: string;
    stand: string;
    confirmed: boolean;
    note?: string;
    source: string;
    match: RegExp;
}

export const BOOTHS: Booth[] = [
    { company: 'Mouser Electronics', hall: 'C3', stand: '578', confirmed: true, note: 'Shared with parent TTI', source: 'mouser.com newsroom', match: /\bmouser\b/i },
    { company: 'TTI', hall: 'C3', stand: '578', confirmed: true, note: 'Shared with Mouser', source: 'mouser.com newsroom', match: /^tti\b|\btti (inc|europe)/i },
    { company: 'Future Electronics', hall: 'C3', stand: '321', confirmed: true, source: 'futureelectronics.com', match: /future electronics/i },
    { company: 'Avnet (Avnet City)', hall: 'B5', stand: '103', confirmed: true, note: 'Avnet Silica, Abacus, EBV and Farnell share Avnet City', source: 'avnet.com electronica 2026', match: /\bavnet\b|\bebv\b|\bsilica\b/i },
    { company: 'Farnell', hall: 'B5', stand: '103', confirmed: true, note: 'Inside Avnet City', source: 'farnell.com electronica 2026', match: /farnell|element ?14|newark/i },
    { company: 'DigiKey', hall: 'C5', stand: '401', confirmed: true, note: 'DigiKey café in B4', source: 'DigiKey press release', match: /digi-?key/i },
    { company: 'Rutronik', hall: 'C6', stand: '379', confirmed: true, source: 'rutronik.com electronica 2026', match: /rutronik/i },
    { company: 'RS Components', hall: 'C6', stand: '279', confirmed: true, source: 'rs-online.com electronica 2026', match: /\brs (components|online|group)\b|^rs$|allied electronics/i },
    { company: 'TME', hall: 'B5', stand: '361', confirmed: true, source: 'tme.com events', match: /\btme\b|transfer multisort/i },
    { company: 'Würth Elektronik', hall: 'B6', stand: '101', confirmed: true, note: 'CBT in B6.102, ICS in A3.334', source: 'we-online.com electronica', match: /w(ü|u|ue)rth/i },
    { company: 'Arrow Electronics', hall: 'C4', stand: '420', confirmed: false, note: 'Stand of the 2022 and 2024 editions', source: 'Arrow electronica 2024', match: /\barrow\b/i },
    { company: 'Verical (Arrow)', hall: 'C4', stand: '420', confirmed: false, note: 'Arrow company, meet at the Arrow stand', source: 'Arrow electronica 2024', match: /verical/i },
    { company: 'JLCPCB', hall: 'A2', stand: '169', confirmed: true, source: 'jlcpcb.com events', match: /jlc/i },
    { company: 'STMicroelectronics', hall: 'C3', stand: '101', confirmed: true, source: 'st.com events', match: /stmicro|^st$/i },
    { company: 'Phoenix Contact', hall: 'B3', stand: '103', confirmed: true, source: 'phoenixcontact.com', match: /phoenix contact/i },
];

// Component manufacturers: buyers meet them for project pricing (SPR), allocation and lifecycle, whoever distributes the part.
export const MAKER_BOOTHS: Booth[] = [
    { kind: 'manufacturer', company: 'Infineon Technologies', hall: 'C3', stand: '502', confirmed: false, note: 'Double stand C3.501/502 per a trade-show guide', source: 'tradeshowintel.com', match: /infineon/i },
    { kind: 'manufacturer', company: 'STMicroelectronics', hall: 'C3', stand: '101', confirmed: true, source: 'st.com events', match: /stmicro|^st$/i },
    { kind: 'manufacturer', company: 'Bosch', hall: 'C3', stand: '316', confirmed: true, source: 'bosch-semiconductors.com', match: /\bbosch\b/i },
    { kind: 'manufacturer', company: 'Nexperia', hall: 'C3', stand: '319', confirmed: false, note: 'Stand of the 2022 and 2024 editions', source: 'Nexperia electronica 2024', match: /nexperia/i },
    { kind: 'manufacturer', company: 'Murata', hall: 'C4', stand: '179', confirmed: true, source: 'murata.com electronica 2026', match: /murata/i },
    { kind: 'manufacturer', company: 'Analog Devices', hall: 'C4', stand: '121', confirmed: false, note: 'Per a trade-show guide', source: 'tradeshowintel.com', match: /analog devices|\badi\b|linear tech|maxim/i },
    { kind: 'manufacturer', company: 'Monolithic Power Systems', hall: 'C4', stand: '241', confirmed: true, source: 'monolithicpower.com events', match: /monolithic power|\bmps\b/i },
    { kind: 'manufacturer', company: 'Vishay', hall: 'C4', stand: '478', confirmed: false, note: 'Stand of the 2024 edition', source: 'Vishay electronica 2024', match: /vishay/i },
    { kind: 'manufacturer', company: 'NXP', hall: 'C5', stand: '179', confirmed: true, source: 'nxp.com events', match: /\bnxp\b|freescale/i },
    { kind: 'manufacturer', company: 'Würth Elektronik', hall: 'B6', stand: '101', confirmed: true, source: 'we-online.com electronica', match: /w(ü|u|ue)rth/i },
    { kind: 'manufacturer', company: 'Phoenix Contact', hall: 'B3', stand: '103', confirmed: true, source: 'phoenixcontact.com', match: /phoenix contact/i },
];

export function boothFor(supplier: string): Booth | undefined {
    return BOOTHS.find((b) => b.match.test(supplier));
}

export function makerBoothFor(manufacturer: string): Booth | undefined {
    return MAKER_BOOTHS.find((b) => b.match.test(manufacturer));
}

export function hallById(id: string): Hall | undefined {
    return HALLS.find((h) => h.id === id);
}

// Stand numbers run front to back in hundreds and left to right within them.
// This places a stand inside its hall deterministically; it is an approximation.
export function boothPoint(b: Booth): { x: number; y: number } {
    const hall = hallById(b.hall)!;
    const n = parseInt(b.stand, 10) || 100;
    const row = Math.min(6, Math.max(1, Math.floor(n / 100)));
    const col = n % 100;
    return {
        x: hall.x + 16 + ((col % 90) / 90) * (hall.w - 32),
        y: hall.y + 14 + ((row - 1) / 5) * (hall.h - 28),
    };
}

export function hallCenter(id: string) {
    const h = hallById(id)!;
    return { x: h.x + h.w / 2, y: h.y + h.h / 2 };
}
