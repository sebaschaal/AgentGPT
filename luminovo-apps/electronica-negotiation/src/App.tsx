import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useNotify, useWidgetContext } from '@luminovo/widget-sdk';
import { ChevronDown, CircleAlert, Copy, Sparkles } from 'lucide-react';
import { call, describeError } from './api';
import { FloorPlan, type RouteStop } from './FloorPlan';
import { SupplierView, type NewsState } from './SupplierView';
import { MakerView } from './MakerView';
import { FAIR, hallById } from './fair';
import { ago, initials, money, pct } from './format';
import { setCurrency } from './format';
import {
    analyse,
    blockerSummary,
    curve,
    hallSpend,
    makerSpend,
    key,
    mergePortfolio,
    supplierSpend,
    sweetSpot,
    withinVolume,
    type CompLine,
    type PortfolioEntry,
    type ProjectData,
} from './model';

interface ProjectRow {
    id: string;
    name: string;
    customer: string;
    scenarios: number;
    updated: string;
    lines?: number | null;
}

interface Plan {
    headline: string;
    route: (RouteStop & { why: string; ask: string; objective: string; minutes: number })[];
    remote: { supplier: string; action: string }[];
}

const LS_PROJECT = 'electronica-negotiation.project';
const LS_PLAN = (scenarioId: string) => `electronica-negotiation.plan.${scenarioId}`;
const read = (k: string) => {
    try {
        return localStorage.getItem(k);
    } catch {
        return null;
    }
};
const write = (k: string, v: string) => {
    try {
        localStorage.setItem(k, v);
    } catch {}
};

// The last battle plan per scenario, on this device only, so reopening the app does not pay for a new plan.
function readPlan(scenarioId: string): { at: string; data: Plan } | null {
    try {
        const raw = read(LS_PLAN(scenarioId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
function savePlan(scenarioId: string, data: Plan) {
    write(LS_PLAN(scenarioId), JSON.stringify({ at: new Date().toISOString(), data }));
}

export function App() {
    const { slotToken } = useWidgetContext();
    const navigate = useNavigate();
    const notify = useNotify();
    const params = (slotToken?.params ?? {}) as Record<string, string | undefined>;

    const [projects, setProjects] = useState<ProjectRow[] | null>(null);
    const [projectsError, setProjectsError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const [rfqId, setRfqId] = useState<string | null>(null);
    const [scenarioId, setScenarioId] = useState<string | null>(null);
    const [data, setData] = useState<ProjectData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [layer, setLayer] = useState<'distributors' | 'manufacturers'>('distributors');
    const [comp, setComp] = useState<Map<string, CompLine>>(new Map());
    const [compProgress, setCompProgress] = useState({ done: 0, total: 0 });
    const [portfolioRaw, setPortfolioRaw] = useState<any[]>([]);
    const [portfolioProgress, setPortfolioProgress] = useState({ done: 0, total: 0 });
    const [plan, setPlan] = useState<{ loading: boolean; data?: Plan; error?: string; at?: string }>({ loading: false });
    const [news, setNews] = useState<Record<string, NewsState>>({});
    const initialised = useRef(false);

    // ------------------------------------------------------------ boot
    useEffect(() => {
        if (!slotToken || initialised.current) return;
        initialised.current = true;
        const fromUrl = params.project;
        const remembered = read(LS_PROJECT);
        if (fromUrl) setRfqId(fromUrl);
        if (params.scenario) setScenarioId(params.scenario);
        if (params.supplier) setSelected(params.supplier);
        call<{ projects: ProjectRow[] }>('projects', {})
            .then((r) => {
                setProjects(r.projects);
                // Remembered project first, then the most recent one with a real BOM, so the demo never opens on a test stub.
                if (!fromUrl)
                    setRfqId(r.projects.find((p) => p.id === remembered)?.id ?? r.projects.find((p) => (p.lines ?? 0) >= 30)?.id ?? r.projects[0]?.id ?? null);
            })
            .catch((e) => setProjectsError(describeError(e)));
        loadPortfolio();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotToken]);

    // project search
    useEffect(() => {
        if (!initialised.current || !pickerOpen) return;
        const t = window.setTimeout(() => {
            call<{ projects: ProjectRow[] }>('projects', { q: query })
                .then((r) => setProjects(r.projects))
                .catch((e) => setProjectsError(describeError(e)));
        }, 300);
        return () => window.clearTimeout(t);
    }, [query, pickerOpen]);

    // ------------------------------------------------------------ project + scenario
    // The first load learns the scenario from the response; setting it must not trigger a second load.
    const ctrlRef = useRef<AbortController | null>(null);
    const adoptedScenario = useRef<string | null>(null);
    useEffect(() => {
        if (!rfqId) return;
        if (adoptedScenario.current !== null && adoptedScenario.current === scenarioId) {
            adoptedScenario.current = null;
            return;
        }
        ctrlRef.current?.abort();
        const ctrl = new AbortController();
        ctrlRef.current = ctrl;
        setLoading(true);
        setError(null);
        setPlan({ loading: false });
        setComp(new Map());
        setCompProgress({ done: 0, total: 0 });
        call<ProjectData>('project', { rfqId, scenarioId }, ctrl.signal)
            .then((d) => {
                setCurrency(d.project.currency);
                setData(d);
                if (d.scenarioId !== scenarioId) {
                    adoptedScenario.current = d.scenarioId;
                    setScenarioId(d.scenarioId);
                }
                write(LS_PROJECT, rfqId);
                const cached = d.scenarioId ? readPlan(d.scenarioId) : null;
                if (cached) setPlan({ loading: false, data: cached.data, at: cached.at });
                scanCompetition(d, ctrl.signal);
            })
            .catch((e) => {
                if ((e as Error).name !== 'AbortError') setError(describeError(e));
            })
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rfqId, scenarioId]);
    useEffect(() => () => ctrlRef.current?.abort(), []);

    // keep the URL shareable
    useEffect(() => {
        if (!slotToken || !rfqId) return;
        const q = new URLSearchParams();
        q.set('project', rfqId);
        if (scenarioId) q.set('scenario', scenarioId);
        if (selected) q.set('supplier', selected);
        try {
            navigate(`/apps/electronica-negotiation?${q.toString()}`, { replace: true });
        } catch {}
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rfqId, scenarioId, selected]);

    async function scanCompetition(d: ProjectData, signal: AbortSignal) {
        const ids = d.lines.filter((l) => l.total > 0 || l.supplier).map((l) => l.id);
        // Biggest lines first, so the analysis is useful before the scan finishes.
        const byValue = new Map(d.lines.map((l) => [l.id, l.total]));
        ids.sort((a, b) => (byValue.get(b) ?? 0) - (byValue.get(a) ?? 0));
        const batches: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) batches.push(ids.slice(i, i + 10));
        setCompProgress({ done: 0, total: ids.length });
        let next = 0;
        const run = async () => {
            while (next < batches.length && !signal.aborted) {
                const batch = batches[next++];
                try {
                    const r = await call<{ lines: CompLine[] }>('competition', { lineIds: batch }, signal);
                    setComp((prev) => {
                        const m = new Map(prev);
                        for (const l of r.lines) m.set(l.id, l);
                        return m;
                    });
                } catch (e) {
                    if ((e as Error).name === 'AbortError') return;
                }
                setCompProgress((p) => ({ ...p, done: Math.min(p.total, p.done + batch.length) }));
            }
        };
        await Promise.all([run(), run(), run(), run()]);
    }

    async function loadPortfolio() {
        try {
            const { scenarios } = await call<{ scenarios: { scenarioId: string }[] }>('portfolioScenarios', {});
            const ids = scenarios.map((s) => s.scenarioId);
            setPortfolioProgress({ done: 0, total: ids.length });
            const batches: string[][] = [];
            for (let i = 0; i < ids.length; i += 6) batches.push(ids.slice(i, i + 6));
            const results: any[] = [];
            let next = 0;
            const run = async () => {
                while (next < batches.length) {
                    const b = batches[next++];
                    try {
                        const r = await call<{ results: any[] }>('portfolio', { scenarioIds: b });
                        results.push(...r.results);
                        setPortfolioRaw([...results]);
                    } catch {}
                    setPortfolioProgress((p) => ({ ...p, done: Math.min(p.total, p.done + b.length) }));
                }
            };
            await Promise.all([run(), run()]);
        } catch {
            setPortfolioProgress({ done: 0, total: 0 });
        }
    }

    // ------------------------------------------------------------ derived
    const spend = useMemo(() => (data ? supplierSpend(data.lines) : { suppliers: [], total: 0, unsourced: 0 }), [data]);
    const makers = useMemo(() => (data ? makerSpend(data.lines) : []), [data]);
    // The map shows one layer at a time; the route can mix distributors and manufacturers.
    const entities = layer === 'distributors' ? spend.suppliers : makers;
    const halls = useMemo(() => hallSpend(entities), [entities]);
    const onFloor = spend.suppliers.filter((s) => s.booth);
    const offFloor = spend.suppliers.filter((s) => !s.booth);
    const makersOnFloor = makers.filter((m) => m.booth);
    const sel = layer === 'distributors' ? spend.suppliers.find((s) => s.supplier === selected) ?? null : null;
    const selMaker = layer === 'manufacturers' ? makers.find((m) => m.supplier === selected) ?? null : null;
    const compDone = compProgress.total > 0 && compProgress.done >= compProgress.total;
    const portfolio = useMemo(() => mergePortfolio(portfolioRaw, data?.project.currency), [portfolioRaw, data?.project.currency]);

    const analyses = useMemo(() => {
        const m = new Map<string, ReturnType<typeof analyse>>();
        if (!data) return m;
        for (const s of spend.suppliers) m.set(s.supplier, analyse(s.supplier, data.lines, comp));
        return m;
    }, [data, comp, spend]);

    const newsKey = (kind: 'distributors' | 'manufacturers', name: string) => `${kind}:${name}`;
    const loadNews = useCallback(
        (kind: 'distributors' | 'manufacturers', name: string) => {
            const k = newsKey(kind, name);
            const ent = kind === 'distributors' ? spend.suppliers.find((x) => x.supplier === name) : makers.find((x) => x.supplier === name);
            const a = kind === 'distributors' ? analyses.get(name) : undefined;
            const pf = kind === 'distributors' ? portfolio.get(key(name)) : undefined;
            setNews((n) => ({ ...n, [k]: { loading: true } }));
            call('news', {
                supplier: name,
                query: ent?.booth?.company.replace(/\s*\(.*\)/, '') ?? name,
                facts: {
                    role: kind === 'distributors' ? 'distributor' : 'component manufacturer',
                    project: data?.project.name,
                    projectSpend: ent ? Math.round(ent.spend) : null,
                    shareOfProject: ent ? pct(ent.share, 1) : null,
                    linesHeld: a?.held.length ?? ent?.lines,
                    crossProjectSpend: pf ? Math.round(pf.spend) : null,
                    stand: ent?.booth ? `${ent.booth.hall}.${ent.booth.stand}` : null,
                    currency: data?.project.currency,
                },
            })
                .then((r: any) => setNews((n) => ({ ...n, [k]: { loading: false, items: r.items, via: r.via, summary: r.summary } })))
                .catch((e) => setNews((n) => ({ ...n, [k]: { loading: false, error: describeError(e) } })));
        },
        [spend, makers, analyses, portfolio, data],
    );

    async function makePlan() {
        if (!data) return;
        setPlan({ loading: true });
        try {
            const stops: any[] = onFloor.map((s) => {
                const a = analyses.get(s.supplier)!;
                const sw = sweetSpot(curve(a, 'across'));
                const pf = portfolio.get(key(s.supplier));
                const nb = a.contestable.filter((c) => c.move <= 0);
                return {
                    supplier: s.supplier,
                    type: 'distributor',
                    hall: s.booth!.hall,
                    stand: s.booth!.stand,
                    standConfirmed: s.booth!.confirmed,
                    projectSpend: Math.round(s.spend),
                    shareOfProject: pct(s.share, 1),
                    linesHeld: s.lines,
                    crossProjectSpend: pf ? Math.round(pf.spend) : null,
                    crossProjects: pf?.projects ?? null,
                    lostLinesWithin10pct: { lines: a.contestable.filter((c) => c.move > 0 && c.move <= 0.1).length, volume: Math.round(withinVolume(a, 0.1)) },
                    cheapestButNotAwarded: nb.length ? { lines: nb.length, volume: Math.round(nb.reduce((x, c) => x + c.award, 0)), reasons: blockerSummary(a).map((b) => `${b.reason} (${b.count})`) } : null,
                    priceMatchSavings: Math.round(a.matchSavings),
                    notQuotedVolume: Math.round(a.notQuoted.reduce((x, n) => x + n.award, 0)),
                    bestMoveForThem: sw.net > 0 ? { discount: pct(sw.d, 1), linesWon: sw.wonLines, netGain: Math.round(sw.net) } : null,
                };
            });
            // The three biggest manufacturers with a stand: project pricing and allocation talks.
            for (const m of makersOnFloor.slice(0, 3))
                stops.push({
                    supplier: m.supplier,
                    type: 'manufacturer',
                    hall: m.booth!.hall,
                    stand: m.booth!.stand,
                    standConfirmed: m.booth!.confirmed,
                    projectSpend: Math.round(m.spend),
                    shareOfProject: pct(m.share, 1),
                    lines: m.lines,
                    boughtThrough: m.via.slice(0, 3).map((v) => `${v.supplier} ${Math.round(v.spend)}`),
                    topParts: m.topLines.slice(0, 3).map((l) => l.mpn),
                });
            const res = await call<{ plan: Plan | null }>('plan', {
                project: { name: data.project.name, customer: data.project.customer, selectedSpend: Math.round(spend.total) },
                currency: data.project.currency,
                stops,
                offFloor: [
                    ...offFloor.slice(0, 10).map((s) => ({ supplier: s.supplier, type: 'distributor', projectSpend: Math.round(s.spend), shareOfProject: pct(s.share, 1) })),
                    ...makers
                        .filter((m) => !m.booth)
                        .slice(0, 3)
                        .map((m) => ({ supplier: m.supplier, type: 'manufacturer', projectSpend: Math.round(m.spend), shareOfProject: pct(m.share, 1), boughtThrough: m.via[0]?.supplier })),
                ],
            });
            const p = res.plan;
            if (!p) throw new Error('The model returned no plan. Try again.');
            const all = [
                ...onFloor.map((s) => ({ name: s.supplier, kind: 'distributor' as const, booth: s.booth })),
                ...makersOnFloor.map((m) => ({ name: m.supplier, kind: 'manufacturer' as const, booth: m.booth })),
            ];
            const resolve = (n: string) => all.find((x) => key(x.name) === key(n)) ?? all.find((x) => key(x.name).includes(key(n)) || key(n).includes(key(x.name)));
            const route = p.route
                .map((r) => {
                    const hit = resolve(r.supplier);
                    return { ...r, supplier: hit?.name ?? '', kind: hit?.kind, booth: hit?.booth };
                })
                .filter((r, i, arr) => r.supplier && arr.findIndex((x) => x.supplier === r.supplier) === i);
            const planned = { ...p, route } as Plan;
            setPlan({ loading: false, data: planned, at: new Date().toISOString() });
            if (data.scenarioId) savePlan(data.scenarioId, planned);
        } catch (e) {
            setPlan({ loading: false, error: describeError(e) });
        }
    }

    const routeStops: RouteStop[] | null = plan.data?.route ?? null;
    const stopFor = (s: string) => {
        const i = plan.data?.route.findIndex((r) => r.supplier === s) ?? -1;
        return i >= 0 ? { ...plan.data!.route[i], index: i } : undefined;
    };
    const currentProject = projects?.find((p) => p.id === rfqId);
    const maxSup = Math.max(1, ...entities.map((s) => s.spend));
    function copyRoute() {
        if (!plan.data || !data) return;
        const lines = [
            `${FAIR.name}: ${data.project.name}`,
            plan.data.headline,
            '',
            ...plan.data.route.map((r, i) => {
                const b = r.booth ?? [...onFloor, ...makers].find((x) => x.supplier === r.supplier)?.booth;
                return `${i + 1}. ${r.supplier}${b ? ` (hall ${b.hall}, stand ${b.stand})` : ''}, ${r.minutes} min\n   ${r.objective}\n   Ask: ${r.ask}`;
            }),
            ...(plan.data.remote.length ? ['', 'Off the floor', ...plan.data.remote.map((r) => `- ${r.supplier}: ${r.action}`)] : []),
        ];
        navigator.clipboard.writeText(lines.join('\n')).then(
            () => notify('Route copied'),
            () => notify('Could not copy the route', 'warning'),
        );
    }

    const openStop = (r: RouteStop) => {
        const want = r.kind === 'manufacturer' ? 'manufacturers' : 'distributors';
        if (want !== layer) setLayer(want);
        setSelected(r.supplier);
    };

    if (!slotToken) return <div className="boot">Loading…</div>;

    return (
        <div className="ds-v2 app">
            <header className="ph">
                <div className="ph-top">
                    <div className="ph-title">
                        <h1>electronica negotiation</h1>
                        <p className="desc">
                            Where this project's spend stands at {FAIR.name}, who to see first, and how far each supplier has to move.
                        </p>
                    </div>
                    <div className="ph-right">
                        <div className="picker">
                            <span className="label-sm">Project</span>
                            <button className="btn btn-secondary picker-btn" onClick={() => setPickerOpen((o) => !o)} aria-expanded={pickerOpen}>
                                <span className="value">
                                    {data?.project.name ?? currentProject?.name ?? 'Choose a project'}
                                    {data?.project.customer ? <span className="text-subtle"> · {data.project.customer}</span> : null}
                                </span>
                                <ChevronDown />
                            </button>
                            {pickerOpen && (
                                <div className="picker-pop">
                                    <input className="input" autoFocus placeholder="Search projects or customers, or paste a project ID" value={query} onChange={(e) => setQuery(e.target.value)} />
                                    {projectsError && <p className="error text-body-sm">{projectsError}</p>}
                                    <div className="picker-list">
                                        {(projects ?? []).map((p) => (
                                            <button
                                                key={p.id}
                                                className={`picker-row${p.id === rfqId ? ' on' : ''}`}
                                                onClick={() => {
                                                    setPickerOpen(false);
                                                    setSelected(null);
                                                    setScenarioId(null);
                                                    setRfqId(p.id);
                                                }}
                                            >
                                                <span className="picker-row-name">{p.name}</span>
                                                <span className="picker-row-sub">
                                                    {p.customer || 'No customer'} · {p.lines != null ? `${p.lines} BOM lines · ` : ''}
                                                    {p.scenarios} scenario{p.scenarios === 1 ? '' : 's'} · {ago(p.updated)}
                                                </span>
                                            </button>
                                        ))}
                                        {projects && !projects.length && <p className="text-body-sm text-muted">No projects match.</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                        {data && data.scenarios.length > 0 && (
                            <label className="picker">
                                <span className="label-sm">Sourcing scenario</span>
                                <select
                                    className="input"
                                    value={scenarioId ?? ''}
                                    onChange={(e) => {
                                        setSelected(null);
                                        setScenarioId(e.target.value);
                                    }}
                                >
                                    {data.scenarios.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <button className="btn btn-ink" onClick={makePlan} disabled={plan.loading || !data || !onFloor.length} aria-busy={plan.loading}>
                            <Sparkles style={{ color: 'var(--highlight)' }} />
                            {plan.loading ? 'Planning your route' : plan.data ? 'Plan again' : 'Plan my route'}
                        </button>
                    </div>
                </div>
            </header>

            {error && (
                <div className="message critical" role="alert">
                    <CircleAlert />
                    <div className="content">
                        <span className="text">{error}</span>
                    </div>
                </div>
            )}

            <FloorPlan
                suppliers={entities}
                halls={halls}
                total={spend.total}
                selected={selected}
                onSelect={setSelected}
                route={routeStops}
                loading={loading}
                layer={layer}
                onLayer={(l) => {
                    setSelected(null);
                    setLayer(l);
                }}
            />

            {sel && data ? (
                <SupplierView
                    supplier={sel}
                    lines={data.lines}
                    comp={comp}
                    compProgress={compProgress}
                    portfolio={portfolio.get(key(sel.supplier))}
                    portfolioProgress={portfolioProgress}
                    projectName={data.project.name}
                    projectTotal={spend.total}
                    stop={stopFor(sel.supplier)}
                    news={news[newsKey('distributors', sel.supplier)]}
                    loadNews={() => loadNews('distributors', sel.supplier)}
                    onClose={() => setSelected(null)}
                />
            ) : selMaker && data ? (
                <MakerView
                    maker={selMaker}
                    comp={comp}
                    compProgress={compProgress}
                    projectName={data.project.name}
                    stop={stopFor(selMaker.supplier)}
                    news={news[newsKey('manufacturers', selMaker.supplier)]}
                    loadNews={() => loadNews('manufacturers', selMaker.supplier)}
                    onClose={() => setSelected(null)}
                />
            ) : (
                <div className="below">
                    <section className="card pad plan">
                        <div className="card-head">
                            <div className="left">
                                <div className="subhead">
                                    <h3>Battle plan</h3>
                                </div>
                                <p className="text-body-md">
                                    {plan.data?.headline ?? 'An AI-ranked walking route with one battle card per stand: what to walk away with, why it matters, and the ask.'}
                                </p>
                            </div>
                            {plan.data && (
                                <div className="row-actions">
                                    <span className="text-body-sm text-subtle plan-meta">
                                        {plan.data.route.reduce((m, r) => m + (r.minutes || 0), 0)} min on the floor{plan.at ? ` · planned ${ago(plan.at)}` : ''}
                                    </span>
                                    <button className="btn btn-secondary btn-sm" onClick={copyRoute}>
                                        <Copy />
                                        Copy route
                                    </button>
                                </div>
                            )}
                        </div>
                        {plan.error && (
                            <div className="message critical" role="alert">
                                <CircleAlert />
                                <div className="content">
                                    <span className="text">{plan.error}</span>
                                </div>
                            </div>
                        )}
                        {plan.loading && (
                            <div className="cards">
                                {[0, 1, 2].map((i) => (
                                    <div key={i} className="battle shimmer-card" />
                                ))}
                            </div>
                        )}
                        {plan.data && (
                            <>
                                <div className="cards">
                                    {plan.data.route.map((r, i) => {
                                        const isMaker = r.kind === 'manufacturer';
                                        const s = isMaker ? makers.find((x) => x.supplier === r.supplier) : onFloor.find((x) => x.supplier === r.supplier);
                                        if (!s) return null;
                                        const a = isMaker ? undefined : analyses.get(r.supplier);
                                        return (
                                            <button key={r.supplier} className="battle" onClick={() => openStop(r)} style={{ animationDelay: `${i * 90}ms` }}>
                                                <div className="battle-top">
                                                    <span className="battle-num">{i + 1}</span>
                                                    <span className="battle-where">
                                                        Hall {s.booth!.hall} · {s.booth!.stand}
                                                    </span>
                                                    {isMaker && <span className="badge badge-outline neutral">Manufacturer</span>}
                                                    <span className="battle-min">{r.minutes} min</span>
                                                </div>
                                                <div className="battle-name">{r.supplier}</div>
                                                <div className="battle-obj">{r.objective}</div>
                                                <div className="battle-why">{r.why}</div>
                                                <div className="battle-ask">
                                                    <span>The ask</span>
                                                    {r.ask}
                                                </div>
                                                <div className="battle-stats">
                                                    <span>
                                                        <b>{money(s.spend)}</b> {isMaker ? 'of their parts' : 'project'}
                                                    </span>
                                                    {a && withinVolume(a, 0.1) > 0 && (
                                                        <span>
                                                            <b>{money(withinVolume(a, 0.1))}</b> within 10%
                                                        </span>
                                                    )}
                                                    {a && a.matchSavings > 0 && (
                                                        <span>
                                                            <b>{money(a.matchSavings)}</b> to match
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {plan.data.remote.length > 0 && (
                                    <div className="remote">
                                        <div className="subhead">
                                            <h3>Off the floor</h3>
                                            <span className="meta">{plan.data.remote.length}</span>
                                        </div>
                                        {plan.data.remote.map((r) => (
                                            <div key={r.supplier} className="remote-row">
                                                <b>{r.supplier}</b> {r.action}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                        {!plan.data && !plan.loading && (
                            <div className="steps-grid text-body-md">
                                <div className={data ? 'done' : ''}>
                                    <b>1</b> Spend by stand from the selected offers
                                </div>
                                <div className={compDone ? 'done' : ''}>
                                    <b>2</b> Competing offers on every line ({compProgress.done}/{compProgress.total})
                                </div>
                                <div className={portfolioProgress.total > 0 && portfolioProgress.done >= portfolioProgress.total ? 'done' : ''}>
                                    <b>3</b> Selected spend across the last {portfolioProgress.total || 60} active projects ({portfolioProgress.done}/{portfolioProgress.total || '…'})
                                </div>
                                <div>
                                    <b>4</b> Plan my route: the AI ranks the stands and orders the walk
                                </div>
                            </div>
                        )}
                    </section>

                    <aside className="side">
                        <section className="card pad group">
                            <div className="subhead">
                                <h3>Spend by hall</h3>
                                <span className="meta">{halls.length} halls</span>
                            </div>
                            {halls.length ? (
                                <div className="halls">
                                    {halls.map((h) => (
                                        <div key={h.hall} className="hall-row">
                                            <span className="hall-chip">{h.hall}</span>
                                            <div className="hall-info">
                                                <div className="bar">
                                                    <span style={{ width: `${(h.spend / (halls[0]?.spend || 1)) * 100}%` }} />
                                                </div>
                                                <div className="text-body-sm text-muted">
                                                    {hallById(h.hall)?.topic} · {h.suppliers.map((s) => s.supplier).join(', ')}
                                                </div>
                                            </div>
                                            <b>{money(h.spend)}</b>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-body-md text-muted">{loading ? 'Loading…' : 'None of the selected suppliers has a known stand.'}</p>
                            )}
                        </section>
                        <section className="card pad group">
                            <div className="subhead">
                                <h3>{layer === 'distributors' ? 'Distributors in this project' : 'Manufacturers in this project'}</h3>
                                <span className="meta">{entities.length}</span>
                            </div>
                            <div className="sup-list">
                                {entities.slice(0, 25).map((s) => {
                                    const pf = layer === 'distributors' ? portfolio.get(key(s.supplier)) : undefined;
                                    return (
                                        <button key={s.supplier} className="sup-row" onClick={() => setSelected(s.supplier)}>
                                            <span className={`sup-dot${s.booth ? '' : ' off'}`}>{initials(s.supplier)}</span>
                                            <span className="sup-row-main">
                                                <span className="sup-row-name">
                                                    {s.supplier}
                                                    <em>{s.booth ? `${s.booth.hall}.${s.booth.stand}` : 'not at the fair'}</em>
                                                </span>
                                                <span className="bar">
                                                    <span style={{ width: `${(s.spend / maxSup) * 100}%` }} />
                                                </span>
                                            </span>
                                            <span className="sup-row-val">
                                                {money(s.spend)}
                                                <em>{pf ? `${money(pf.spend)} across projects` : `${pct(s.share, 1)} of the project`}</em>
                                            </span>
                                        </button>
                                    );
                                })}
                                {!spend.suppliers.length && !loading && <p className="text-body-md text-muted">No offers are selected in this scenario yet.</p>}
                            </div>
                            {spend.unsourced > 0 && <p className="text-body-sm text-subtle">{spend.unsourced} lines have no selected offer.</p>}
                        </section>
                    </aside>
                </div>
            )}
        </div>
    );
}
