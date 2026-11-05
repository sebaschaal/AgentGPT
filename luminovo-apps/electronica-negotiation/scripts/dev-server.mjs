// Local preview: a fake product host (port 5174) framing the widget (port 5173) with mocked worker handlers.
// Synthetic data only, shaped like a real sourcing scenario. Run `npx vite build` first.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'electronica-negotiation';

// ---------------------------------------------------------------- deterministic synthetic data
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const SUPPLIERS = [
    ['Mouser', 0.42],
    ['Rutronik', 0.12],
    ['Future Electronics', 0.1],
    ['Arrow', 0.08],
    ['WinSource', 0.07],
    ['Avnet Abacus', 0.06],
    ['DigiKey', 0.05],
    ['LCSC', 0.04],
    ['Farnell', 0.03],
    ['icHub', 0.03],
];
const MFR = ['Infineon Technologies', 'Texas Instruments', 'STMicroelectronics', 'NXP', 'Murata', 'Yageo', 'TDK', 'onsemi', 'Vishay', 'Würth Elektronik'];
const pickSupplier = () => {
    let r = rnd();
    for (const [s, w] of SUPPLIERS) if ((r -= w) <= 0) return s;
    return 'Mouser';
};
const lines = [];
const comp = {};
for (let i = 0; i < 96; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const qty = Math.round(1000 * Math.pow(10, rnd() * 3));
    const unitPrice = +(0.01 * Math.pow(10, rnd() * 3.3)).toFixed(4);
    const unsourced = rnd() < 0.05;
    const supplier = unsourced ? null : pickSupplier();
    const total = unsourced ? 0 : +(qty * unitPrice).toFixed(2);
    lines.push({
        id,
        status: unsourced ? 'Error' : 'Ok',
        mpn: `${pick(['TPS', 'STM32', 'GRM', 'RC0603', 'BSC', 'LM', 'IAUA', 'MCP', 'TLE', 'CRCW'])}${Math.floor(rnd() * 90000 + 1000)}${pick(['RGR', 'FKT', 'XUMA2', 'Q1', 'ABG', ''])}`,
        manufacturer: pick(MFR),
        partId: null,
        qty,
        purchaseQty: qty,
        unitPrice: unsourced ? 0 : unitPrice,
        total,
        currency: 'EUR',
        supplier,
        stockLocation: null,
        priceType: 'ListPrice',
        leadDays: Math.floor(rnd() * 120),
        manual: false,
        abc: pick(['A', 'B', 'C']),
    });
    const options = [];
    if (supplier) options.push({ supplier, total, unit: unitPrice, selected: true, leadDays: 30, tags: ['Selected', 'SupplierApproved'] });
    for (const [s] of SUPPLIERS) {
        if (s === supplier || rnd() < 0.45) continue;
        const f = 0.82 + rnd() * 0.6; // some competitors are cheaper
        options.push({ supplier: s, total: +(total * f || qty * unitPrice * f).toFixed(2), unit: +(unitPrice * f).toFixed(4), selected: false, leadDays: Math.floor(rnd() * 160), tags: [rnd() < 0.2 ? 'SupplierNotApproved' : 'SupplierApproved'] });
    }
    options.sort((a, b) => a.total - b.total);
    comp[id] = { id, options, count: options.length + 3 };
}

const handlers = {
    projects: () => ({
        projects: [
            { id: 'p-1', name: 'Demo BRS (synthetic)', customer: 'Brose', scenarios: 4, updated: new Date(Date.now() - 86400000 * 3).toISOString() },
            { id: 'p-2', name: 'Demo Vanguard Telematics Gateway TG-90', customer: 'Vanguard Mobility Systems', scenarios: 1, updated: new Date(Date.now() - 86400000 * 40).toISOString() },
        ],
    }),
    project: () => ({
        project: { id: 'p-1', name: 'Demo BRS (synthetic)', customer: 'Brose', currency: 'EUR', number: '2026-10723' },
        scenarios: [
            { id: 's-1', name: 'API Best Price' },
            { id: 's-2', name: 'Best Lead Time' },
        ],
        scenarioId: 's-1',
        lines,
    }),
    competition: (input) => ({ lines: input.lineIds.map((id) => comp[id]).filter(Boolean) }),
    portfolioScenarios: () => ({ scenarios: Array.from({ length: 24 }, (_, i) => ({ scenarioId: `ps-${i}`, rfqId: `pr-${i}`, name: `Project ${i}` })) }),
    portfolio: (input) => ({
        results: input.scenarioIds.map((sid) => ({
            scenarioId: sid,
            currency: 'EUR',
            suppliers: Object.fromEntries(SUPPLIERS.filter(() => rnd() < 0.7).map(([s, w]) => [s, { spend: Math.round(w * 4e6 * (0.5 + rnd())), lines: Math.round(5 + rnd() * 40) }])),
        })),
    }),
    news: (input) => ({
        via: 'Bing News',
        items: [
            { title: `${input.supplier} expands European distribution center to cut delivery times`, url: 'https://example.com/a', source: 'EE Times Europe', date: new Date(Date.now() - 86400000).toISOString(), snippet: 'The distributor said the new capacity will serve customers across the EU.' },
            { title: `${input.supplier} reports record quarter on industrial and automotive demand`, url: 'https://example.com/b', source: 'Electronics Weekly', date: new Date(Date.now() - 86400000 * 4).toISOString(), snippet: '' },
            { title: `${input.supplier} to showcase robotics demos at electronica 2026`, url: 'https://example.com/c', source: 'Elektor', date: new Date(Date.now() - 86400000 * 9).toISOString(), snippet: '' },
        ],
        summary: {
            ticker: [
                { index: 0, takeaway: 'More EU stock means shorter lead times to ask for', tone: 'positive' },
                { index: 1, takeaway: 'Strong quarter: room to give on price', tone: 'watch' },
                { index: 2, takeaway: 'They want visibility at the show', tone: 'neutral' },
            ],
            opener: `Congratulations on the new European distribution center. We noticed it right away, and it fits well with where our volumes are heading next year.`,
            hook: 'Shorter EU lead times only help us if the pricing holds at series volumes; that is what we want to talk about.',
        },
    }),
    plan: (input) => ({
        plan: {
            headline: 'Start in C3 with Mouser, where most of the spend sits, then work east to Arrow and Rutronik.',
            route: input.stops.slice(0, 5).map((s, i) => ({
                supplier: s.supplier,
                objective: ['Lock in a 4% move on the near-miss lines', 'Price match on the lines they hold', 'Win the power stage with a 6% move', 'Defend the connectors', 'Quote the open lines'][i % 5],
                why: `${s.shareOfProject} of the project and ${s.lostLinesWithin10pct.lines} lost lines within 10%.`,
                ask: 'Match the lowest approved competitor on the five largest lines.',
                minutes: 30 - i * 5,
            })),
            remote: (input.offFloor ?? []).slice(0, 3).map((s) => ({ supplier: s.supplier, action: 'Send the open lines for a quote after the show.' })),
        },
    }),
    logOutcome: (input) => ({ written: input.lineIds.length }),
    brief: () => ({
        brief: {
            stance: 'We hold the volume; they are within reach on a third of the lines they lost.',
            goals: ['A 4% move on the near-miss lines', 'Price match on the three lines where a competitor is cheaper', 'Quotes for the open lines by Friday'],
            asks: [
                { title: 'Near-miss lines', detail: 'Cut 4% on the 6 lines within 5% and we award them.', value: '€1.2M volume' },
                { title: 'Price match', detail: 'Match Arrow on the three held lines.', value: '€84k savings' },
            ],
            leverage: ['Cross-project spend of €38M', 'Approved alternatives on most held lines'],
            give: ['Forecast visibility for 2027', 'Faster payment terms'],
            walkaway: 'No price move: we move the three price-match lines to Arrow.',
        },
    }),
};

// ---------------------------------------------------------------- servers
const type = (f) => ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(f)] ?? 'application/octet-stream';
http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith(`/apps/_app/${APP}/call/`)) {
        const handler = url.pathname.split('/').pop();
        let body = '';
        for await (const chunk of req) body += chunk;
        const input = body ? JSON.parse(body) : {};
        const delay = { competition: 350, portfolio: 300, news: 1200, plan: 1800, brief: 1600 }[handler] ?? 150;
        await new Promise((r) => setTimeout(r, delay));
        const out = handlers[handler]?.(input);
        res.writeHead(out ? 200 : 404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out ?? { error: 'unknown_handler' }));
    }
    if (url.pathname === `/apps/_app/${APP}/widgets/floor`) {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(fs.readFileSync(path.join(root, 'widgets/floor.html')));
    }
    if (url.pathname.startsWith(`/apps/_app/${APP}/assets/`)) {
        const f = path.join(root, 'dist-web/assets', path.basename(url.pathname));
        if (fs.existsSync(f)) {
            res.writeHead(200, { 'content-type': type(f) });
            return res.end(fs.readFileSync(f));
        }
    }
    res.writeHead(404);
    res.end('not found');
}).listen(5173);

const host = `<!doctype html><html><head><meta charset="utf-8"><title>Host</title>
<style>body{margin:0;background:#F5F6FA;font-family:system-ui} header{height:48px;background:#fff;border-bottom:1px solid #D8DEEE;display:flex;align-items:center;padding:0 16px;font-weight:600} iframe{border:0;width:100%;display:block}</style></head>
<body><header>Luminovo · Design › electronica negotiation</header>
<iframe id="w" src="http://localhost:5173/apps/_app/${APP}/widgets/floor?lumi_parent_origin=${encodeURIComponent('http://localhost:5174')}"></iframe>
<script>
const f = document.getElementById('w');
f.style.height = '800px';
addEventListener('message', (e) => {
  if (e.origin !== 'http://localhost:5173') return;
  const m = e.data || {};
  if (m.type === 'widget.ready') f.contentWindow.postMessage({ protocol: 1, type: 'slot.token', appId: '${APP}', params: {}, tenant: 'demo', locale: 'en' }, 'http://localhost:5173');
  if (m.type === 'widget.resize') f.style.height = Math.ceil(m.height) + 'px';
  if (m.type === 'widget.notify') console.log('notify', m.message);
});
</script></body></html>`;
http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(host);
}).listen(5174);
console.log('host http://localhost:5174  widget http://localhost:5173');
