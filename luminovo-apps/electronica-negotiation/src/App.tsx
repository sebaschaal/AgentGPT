import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useWidgetContext } from '@luminovo/widget-sdk';
import { call, describeError } from './api';
import { FloorPlan, type RouteStop } from './FloorPlan';
import { SupplierView, type NewsState } from './SupplierView';
import { FAIR, hallById } from './fair';
import { ago, initials, money, pct } from './format';
import { setCurrency } from './format';
import {
    analyse,
    curve,
    hallSpend,
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
}

interface Plan {
    headline: string;
    route: (RouteStop & { why: string; ask: string; objective: string; minutes: number })[];
    remote: { supplier: string; action: string }[];
}

const LS_PROJECT = 'electronica-negotiation.project';
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

export function App() {
    const { slotToken } = useWidgetContext();
    const navigate = useNavigate();
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
    const [comp, setComp] = useState<Map<string, CompLine>>(new Map());
    const [compProgress, setCompProgress] = useState({ done: 0, total: 0 });
    const [portfolio, setPortfolio] = useState<Map<string, PortfolioEntry>>(new Map());
    const [portfolioProgress, setPortfolioProgress] = useState({ done: 0, total: 0 });
    const [plan, setPlan] = useState<{ loading: boolean; data?: Plan; error?: string }>({ loading: false });
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
                if (!fromUrl) setRfqId(r.projects.find((p) => p.id === remembered)?.id ?? r.projects[0]?.id ?? null);
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
    useEffect(() => {
        if (!rfqId) return;
        const ctrl = new AbortController();
        setLoading(true);
        setError(null);
        setPlan({ loading: false });
        setComp(new Map());
        setCompProgress({ done: 0, total: 0 });
        call<ProjectData>('project', { rfqId, scenarioId }, ctrl.signal)
            .then((d) => {
                setCurrency(d.project.currency);
                setData(d);
                if (d.scenarioId !== scenarioId) setScenarioId(d.scenarioId);
                write(LS_PROJECT, rfqId);
                scanCompetition(d, ctrl.signal);
            })
            .catch((e) => {
                if ((e as Error).name !== 'AbortError') setError(describeError(e));
            })
            .finally(() => setLoading(false));
        return () => ctrl.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rfqId, scenarioId]);

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
        for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
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
        await Promise.all([run(), run(), run()]);
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
                        setPortfolio(mergePortfolio(results));
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
    const halls = useMemo(() => hallSpend(spend.suppliers), [spend]);
    const onFloor = spend.suppliers.filter((s) => s.booth);
    const offFloor = spend.suppliers.filter((s) => !s.booth);
    const sel = spend.suppliers.find((s) => s.supplier === selected) ?? null;
    const compDone = compProgress.total > 0 && compProgress.done >= compProgress.total;

    const analyses = useMemo(() => {
        const m = new Map<string, ReturnType<typeof analyse>>();
        if (!data) return m;
        for (const s of spend.suppliers) m.set(s.supplier, analyse(s.supplier, data.lines, comp));
        return m;
    }, [data, comp, spend]);

    const loadNews = useCallback(
        (supplier: string) => {
            const s = spend.suppliers.find((x) => x.supplier === supplier);
            const a = analyses.get(supplier);
            const pf = portfolio.get(key(supplier));
            setNews((n) => ({ ...n, [supplier]: { loading: true } }));
            call('news', {
                supplier,
                query: s?.booth?.company.replace(/\s*\(.*\)/, '') ?? supplier,
                facts: {
                    project: data?.project.name,
                    projectSpend: s ? Math.round(s.spend) : null,
                    shareOfProject: s ? pct(s.share, 1) : null,
                    linesHeld: a?.held.length,
                    crossProjectSpend: pf ? Math.round(pf.spend) : null,
                    stand: s?.booth ? `${s.booth.hall}.${s.booth.stand}` : null,
                    currency: data?.project.currency,
                },
            })
                .then((r: any) => setNews((n) => ({ ...n, [supplier]: { loading: false, items: r.items, via: r.via, summary: r.summary } })))
                .catch((e) => setNews((n) => ({ ...n, [supplier]: { loading: false, error: describeError(e) } })));
        },
        [spend, analyses, portfolio, data],
    );

    async function makePlan() {
        if (!data) return;
        setPlan({ loading: true });
        try {
            const stops = onFloor.map((s) => {
                const a = analyses.get(s.supplier)!;
                const sw = sweetSpot(curve(a, 'across'));
                const pf = portfolio.get(key(s.supplier));
                return {
                    supplier: s.supplier,
                    hall: s.booth!.hall,
                    stand: s.booth!.stand,
                    standConfirmed: s.booth!.confirmed,
                    projectSpend: Math.round(s.spend),
                    shareOfProject: pct(s.share, 1),
                    linesHeld: s.lines,
                    crossProjectSpend: pf ? Math.round(pf.spend) : null,
                    crossProjects: pf?.projects ?? null,
                    lostLinesWithin10pct: { lines: a.contestable.filter((c) => c.move > 0 && c.move <= 0.1).length, volume: Math.round(withinVolume(a, 0.1)) },
                    priceMatchSavings: Math.round(a.matchSavings),
                    notQuotedVolume: Math.round(a.notQuoted.reduce((x, n) => x + n.award, 0)),
                    bestMoveForThem: sw.net > 0 ? { discount: pct(sw.d, 1), linesWon: sw.wonLines, netGain: Math.round(sw.net) } : null,
                };
            });
            const res = await call<{ plan: Plan | null }>('plan', {
                project: { name: data.project.name, customer: data.project.customer, selectedSpend: Math.round(spend.total) },
                currency: data.project.currency,
                stops,
                offFloor: offFloor.slice(0, 12).map((s) => ({ supplier: s.supplier, projectSpend: Math.round(s.spend), shareOfProject: pct(s.share, 1) })),
            });
            const p = res.plan;
            if (!p) throw new Error('The model returned no plan. Try again.');
            const names = new Map(onFloor.map((s) => [key(s.supplier), s.supplier]));
            const route = p.route
                .map((r) => ({ ...r, supplier: names.get(key(r.supplier)) ?? onFloor.find((s) => key(s.supplier).includes(key(r.supplier)) || key(r.supplier).includes(key(s.supplier)))?.supplier ?? '' }))
                .filter((r, i, arr) => r.supplier && arr.findIndex((x) => x.supplier === r.supplier) === i);
            setPlan({ loading: false, data: { ...p, route } });
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
    const maxSup = Math.max(1, ...spend.suppliers.map((s) => s.spend));

    if (!slotToken) return <div className="boot">Loading…</div>;

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">e</span>
                    <div>
                        <div className="brand-name">electronica negotiation</div>
                        <div className="brand-sub">Face-to-face supplier negotiations at {FAIR.name}</div>
                    </div>
                </div>
                <div className="pickers">
                    <div className="picker">
                        <button className="picker-btn" onClick={() => setPickerOpen((o) => !o)}>
                            <span className="eyebrow">Project</span>
                            <span className="picker-val">{data?.project.name ?? currentProject?.name ?? 'Choose a project'}</span>
                            {data?.project.customer && <span className="picker-sub">{data.project.customer}</span>}
                        </button>
                        {pickerOpen && (
                            <div className="picker-pop">
                                <input className="lumi-input" autoFocus placeholder="Search projects or customers, or paste a project id" value={query} onChange={(e) => setQuery(e.target.value)} />
                                {projectsError && <p className="error">{projectsError}</p>}
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
                                                {p.customer || 'No customer'} · {p.scenarios} scenario{p.scenarios === 1 ? '' : 's'} · {ago(p.updated)}
                                            </span>
                                        </button>
                                    ))}
                                    {projects && !projects.length && <p className="muted">No projects match.</p>}
                                </div>
                            </div>
                        )}
                    </div>
                    {data && data.scenarios.length > 0 && (
                        <label className="picker scenario">
                            <span className="eyebrow">Sourcing scenario</span>
                            <select
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
                </div>
            </header>

            {error && <div className="banner error">{error}</div>}

            <FloorPlan suppliers={spend.suppliers} halls={halls} total={spend.total} selected={selected} onSelect={setSelected} route={routeStops} loading={loading} />

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
                    news={news[sel.supplier]}
                    loadNews={() => loadNews(sel.supplier)}
                    onClose={() => setSelected(null)}
                />
            ) : (
                <div className="below">
                    <section className="card plan">
                        <div className="card-head">
                            <div>
                                <h3>Battle plan</h3>
                                <p className="muted">
                                    {plan.data?.headline ??
                                        'An AI-ranked walking route with one battle card per stand: what to walk away with, why it matters, and the ask.'}
                                </p>
                            </div>
                            <button className="lumi-btn" onClick={makePlan} disabled={plan.loading || !data || !onFloor.length}>
                                {plan.loading ? 'Planning your route…' : plan.data ? 'Re-plan' : compDone ? 'Plan my route' : `Plan my route (scan ${Math.round((compProgress.done / Math.max(1, compProgress.total)) * 100)}%)`}
                            </button>
                        </div>
                        {plan.error && <p className="error">{plan.error}</p>}
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
                                        const s = onFloor.find((x) => x.supplier === r.supplier)!;
                                        const a = analyses.get(r.supplier);
                                        return (
                                            <button key={r.supplier} className="battle" onClick={() => setSelected(r.supplier)} style={{ animationDelay: `${i * 90}ms` }}>
                                                <div className="battle-top">
                                                    <span className="battle-num">{i + 1}</span>
                                                    <span className="battle-where">
                                                        Hall {s.booth!.hall} · {s.booth!.stand}
                                                    </span>
                                                    <span className="battle-min">{r.minutes} min</span>
                                                </div>
                                                <div className="battle-name">{r.supplier}</div>
                                                <div className="battle-obj">{r.objective}</div>
                                                <div className="battle-why">{r.why}</div>
                                                <div className="battle-ask">
                                                    <span>Ask</span>
                                                    {r.ask}
                                                </div>
                                                <div className="battle-stats">
                                                    <span>
                                                        <b>{money(s.spend)}</b> project
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
                                        <div className="eyebrow">Off the floor</div>
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
                            <div className="plan-empty">
                                <div className="steps">
                                    <div>
                                        <b>1</b> Spend by stand from the selected offers
                                    </div>
                                    <div>
                                        <b>2</b> Competing offers on every line ({compProgress.done}/{compProgress.total})
                                    </div>
                                    <div>
                                        <b>3</b> Spend across your last {portfolioProgress.total || 60} projects ({portfolioProgress.done}/{portfolioProgress.total || '…'})
                                    </div>
                                    <div>
                                        <b>4</b> The AI ranks the stands and orders the walk
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    <aside className="side">
                        <section className="card">
                            <h3>Spend by hall</h3>
                            {halls.length ? (
                                <div className="halls">
                                    {halls.map((h) => (
                                        <div key={h.hall} className="hall-row">
                                            <span className="hall-chip">{h.hall}</span>
                                            <div className="hall-info">
                                                <div className="hall-bar">
                                                    <span style={{ width: `${(h.spend / (halls[0]?.spend || 1)) * 100}%` }} />
                                                </div>
                                                <div className="muted small">
                                                    {hallById(h.hall)?.topic} · {h.suppliers.map((s) => s.supplier).join(', ')}
                                                </div>
                                            </div>
                                            <b>{money(h.spend)}</b>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="muted">{loading ? 'Loading…' : 'None of the selected suppliers has a known stand.'}</p>
                            )}
                        </section>
                        <section className="card">
                            <h3>Suppliers in this project</h3>
                            <div className="sup-list">
                                {spend.suppliers.map((s) => {
                                    const pf = portfolio.get(key(s.supplier));
                                    return (
                                        <button key={s.supplier} className="sup-row" onClick={() => setSelected(s.supplier)}>
                                            <span className={`sup-dot${s.booth ? '' : ' off'}`}>{initials(s.supplier)}</span>
                                            <span className="sup-row-main">
                                                <span className="sup-row-name">
                                                    {s.supplier}
                                                    <em>{s.booth ? `${s.booth.hall}.${s.booth.stand}` : 'not at the fair'}</em>
                                                </span>
                                                <span className="sup-row-bar">
                                                    <span style={{ width: `${(s.spend / maxSup) * 100}%` }} />
                                                </span>
                                            </span>
                                            <span className="sup-row-val">
                                                {money(s.spend)}
                                                <em>{pf ? `${money(pf.spend)} all projects` : pct(s.share, 1)}</em>
                                            </span>
                                        </button>
                                    );
                                })}
                                {!spend.suppliers.length && !loading && <p className="muted">No offers are selected in this scenario yet.</p>}
                            </div>
                            {spend.unsourced > 0 && <p className="muted small">{spend.unsourced} lines have no selected offer.</p>}
                        </section>
                    </aside>
                </div>
            )}
        </div>
    );
}
