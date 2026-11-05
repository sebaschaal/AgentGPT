// Runs the built worker.js inside a Code Mode sandbox (code_mode_exec with app: 'electronica-negotiation').
// The worker's fetch calls are mapped onto api.http / api.llm / api.fetch, so its handlers run against real data.
// Usage inside the sandbox:
//   const h = await import('data:text/javascript;base64,' + btoa(harnessSource));
//   return await h.run(api, workerSource, [{ handler: 'project', input: { rfqId } }]);

const ROUTES = [
    [/^\/api\/rfqs\/([^/]+)$/, 'GET', (m) => ['GET /rfqs/:rfqId', { pathParams: { rfqId: m[1] } }]],
    [/^\/api\/sourcing-scenarios\/bulk$/, 'POST', () => ['POST /sourcing-scenarios/bulk', {}]],
    [/^\/api\/sourcing\/calculation\/read-selection$/, 'POST', () => ['POST /sourcing/calculation/read-selection', {}]],
    [/^\/api\/sourcing-line-item\/([^/]+)\/solutions$/, 'GET', (m) => ['GET /sourcing-line-item/:id/solutions', { pathParams: { id: m[1] } }]],
    [/^\/api\/sourcing\/calculation\/line-items\/([^/]+)$/, 'GET', (m) => ['GET /sourcing/calculation/line-items/:id', { pathParams: { id: m[1] } }]],
    [/^\/api\/sourcing-line-item$/, 'PATCH', () => ['PATCH /sourcing-line-item', {}]],
];

function respond(body, status = 200, type = 'application/json') {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
}

export function makeFetch(api, log) {
    return async (url, init = {}) => {
        const u = new URL(url);
        const method = (init.method ?? 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : undefined;
        const t0 = Date.now();
        try {
            if (u.host === 'mcp.luminovo.com' && u.pathname.startsWith('/api/')) {
                for (const [re, m, map] of ROUTES) {
                    const match = u.pathname.match(re);
                    if (match && m === method) {
                        const [key, opts] = map(match);
                        const r = await api.http(key, { ...opts, ...(body ? { requestBody: body } : {}) });
                        log.push(`${key} ${Date.now() - t0}ms`);
                        return respond(r);
                    }
                }
                return respond({ error: 'harness_unmapped', path: u.pathname }, 404);
            }
            if (u.host === 'mcp.luminovo.com' && /\/llm\/complete$/.test(u.pathname)) {
                const r = await api.llm.complete(body);
                log.push(`llm ${body.model} ${Date.now() - t0}ms`);
                return respond(r);
            }
            if (u.host === 'mcp.luminovo.com' && u.pathname === '/apps/_api/warehouse/query') {
                return respond({ error: 'harness_no_warehouse' }, 501);
            }
            if (u.host === 'api.luminovo.com' && u.pathname === '/offers/bulk') {
                const r = await api.http('POST /offers/bulk', { requestBody: body });
                log.push(`offers/bulk ${body.ids.length} ${Date.now() - t0}ms`);
                return respond(r);
            }
            const r = await api.fetch(url, { headers: init.headers ?? {} });
            log.push(`external ${u.host} ${r.status} ${Date.now() - t0}ms`);
            return respond(r.text, r.status, 'text/plain');
        } catch (e) {
            log.push(`ERR ${u.pathname}: ${String(e.message).slice(0, 200)}`);
            return respond({ error: 'harness_error', message: String(e.message).slice(0, 300) }, 500);
        }
    };
}

export async function run(api, workerSource, calls) {
    const log = [];
    globalThis.fetch = makeFetch(api, log);
    const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'))).default;
    const results = [];
    for (const c of calls) {
        const t0 = Date.now();
        const res = await worker.fetch(new Request('https://worker.local/', { method: 'POST', body: JSON.stringify({ handler: c.handler, input: c.input ?? {} }) }));
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = text.slice(0, 500);
        }
        results.push({ handler: c.handler, status: res.status, ms: Date.now() - t0, body: c.pick ? c.pick(json) : json });
    }
    return { results, log: log.slice(-60) };
}
