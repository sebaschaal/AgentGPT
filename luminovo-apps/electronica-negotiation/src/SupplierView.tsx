import { useEffect, useMemo, useState } from 'react';
import { useNotify } from '@luminovo/widget-sdk';
import { Copy, MessageSquareQuote, Sparkles, X } from 'lucide-react';
import { call, describeError } from './api';
import { ConcessionChart, GapBuckets, MoveBar } from './charts';
import { initials, money, pct, qty, signedPct, unit } from './format';
import {
    analyse,
    bestStart,
    blockerSummary,
    buckets,
    curve,
    simulate,
    sweetSpot,
    withinVolume,
    type CompLine,
    type Line,
    type Mode,
    type PortfolioEntry,
    type SupplierSpend,
} from './model';
import type { RouteStop } from './FloorPlan';
import { Headlines, NewsTicker, OpenerCard, type NewsState } from './news';
export type { NewsState } from './news';

interface Brief {
    stance: string;
    goals: string[];
    asks: { title: string; detail: string; value: string }[];
    leverage: string[];
    give: string[];
    walkaway: string;
}

interface Props {
    supplier: SupplierSpend;
    lines: Line[];
    comp: Map<string, CompLine>;
    compProgress: { done: number; total: number };
    portfolio?: PortfolioEntry;
    portfolioProgress: { done: number; total: number };
    projectName: string;
    projectTotal: number;
    stop?: RouteStop & { index: number };
    news: NewsState | undefined;
    loadNews: () => void;
    onClose: () => void;
}

type LineFilter = 'all' | 'held' | 'contest' | 'match' | 'none';

export function SupplierView(p: Props) {
    const { supplier, lines, comp } = p;
    const notify = useNotify();
    const [tab, setTab] = useState<'negotiate' | 'talk' | 'lines'>('negotiate');
    const [mode, setMode] = useState<Mode>('across');
    const [d, setD] = useState(0.05);
    const [bucket, setBucket] = useState<string | null>(null);
    const [filter, setFilter] = useState<LineFilter>('all');
    const [brief, setBrief] = useState<{ loading: boolean; data?: Brief; error?: string }>({ loading: false });

    const a = useMemo(() => analyse(supplier.supplier, lines, comp), [supplier.supplier, lines, comp]);
    const points = useMemo(() => curve(a, mode), [a, mode]);
    const sweet = useMemo(() => sweetSpot(points, mode), [points, mode]);
    const [touched, setTouched] = useState(false);
    const sim = simulate(a, d, mode);
    const bks = useMemo(() => buckets(a), [a]);
    const within10 = withinVolume(a, 0.1);
    const blockers = useMemo(() => blockerSummary(a), [a]);
    const scanning = p.compProgress.done < p.compProgress.total;

    useEffect(() => {
        setBrief({ loading: false });
        setBucket(null);
        setFilter('all');
        setTouched(false);
    }, [supplier.supplier]);

    // Start the simulator on the supplier's best move; refine it while the scan fills in, until the user takes over.
    useEffect(() => {
        if (touched || a.covered === 0) return;
        const start = bestStart(a);
        setMode(start.mode);
        setD(start.d);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [a, touched]);
    const moveTo = (v: number) => {
        setTouched(true);
        setD(v);
    };
    const checkpoints = [0.03, 0.05, 0.1, 0.15, 0.2].map((c) => ({ c, p: simulate(a, c, mode) }));

    useEffect(() => {
        if (!p.news) p.loadNews();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supplier.supplier]);

    const booth = supplier.booth;
    const volumeUp = a.heldVolume ? sim.volume / a.heldVolume - 1 : 0;

    async function makeBrief() {
        setBrief({ loading: true });
        try {
            const res = await call<{ brief: Brief | null }>('brief', {
                supplier: supplier.supplier,
                project: p.projectName,
                meeting: booth ? `Their stand at electronica 2026, hall ${booth.hall}, stand ${booth.stand}` : 'Call or video meeting',
                projectSpend: Math.round(supplier.spend),
                shareOfProject: pct(supplier.share, 1),
                linesHeld: a.held.length,
                crossProjectSpend: p.portfolio ? Math.round(p.portfolio.spend) : null,
                crossProjectProjects: p.portfolio?.projects ?? null,
                buckets: bks.map((b) => ({ bucket: b.label, lines: b.count, volumeAtStake: Math.round(b.volume) })),
                closestLinesToWin: a.contestable
                    .filter((c) => c.move > 0)
                    .slice(0, 8)
                    .map((c) => ({ mpn: c.line.mpn, manufacturer: c.line.manufacturer, qty: c.line.qty, priceCutNeeded: pct(c.move, 1), volume: Math.round(c.award), currentWinner: c.winner, targetUnitPrice: +(c.line.unitPrice * 0.995).toPrecision(4) })),
                alreadyCheapestButNotAwarded: a.contestable
                    .filter((c) => c.move <= 0)
                    .slice(0, 5)
                    .map((c) => ({ mpn: c.line.mpn, volume: Math.round(c.award), whyNotAwarded: c.blocker, theirLeadDays: c.theirs.leadDays, winnerLeadDays: c.line.leadDays })),
                cheapestButNotAwardedSummary: blockers.map((b) => ({ reason: b.reason, lines: b.count, volume: Math.round(b.volume) })),
                priceMatchAsks: a.matchAsks.slice(0, 8).map((h) => ({ mpn: h.line.mpn, volume: Math.round(h.award), cheaperCompetitor: h.alt?.supplier, competitorBelowBy: pct(-h.cushion!, 1), savings: Math.round(h.award - h.alt!.total) })),
                linesToDefend: a.defend.slice(0, 5).map((h) => ({ mpn: h.line.mpn, volume: Math.round(h.award), nextBest: h.alt?.supplier, lead: pct(h.cushion!, 1) })),
                notQuoted: { lines: a.notQuoted.length, volume: Math.round(a.notQuoted.reduce((s, n) => s + n.award, 0)), top: a.notQuoted.slice(0, 5).map((n) => ({ mpn: n.line.mpn, volume: Math.round(n.award), currentSupplier: n.line.supplier })) },
                bestUniformMoveForThem: sweet.net > 0 ? { discount: pct(sweet.d, 1), volumeAfter: Math.round(sweet.volume), linesWon: sweet.wonLines, netRevenueChange: Math.round(sweet.net) } : null,
                news: (p.news?.items ?? []).slice(0, 5).map((n) => n.title),
            });
            setBrief({ loading: false, data: res.brief ?? undefined, error: res.brief ? undefined : 'The model returned no brief. Try again.' });
        } catch (e) {
            setBrief({ loading: false, error: describeError(e) });
        }
    }

    function copyBrief() {
        if (!brief.data) return;
        const b = brief.data;
        const text = [
            `${supplier.supplier} · ${p.projectName}`,
            '',
            b.stance,
            '',
            'Goals',
            ...b.goals.map((g) => `- ${g}`),
            '',
            'Asks',
            ...b.asks.map((x) => `- ${x.title} (${x.value}): ${x.detail}`),
            '',
            'Leverage',
            ...b.leverage.map((g) => `- ${g}`),
            '',
            'What we can give',
            ...b.give.map((g) => `- ${g}`),
            '',
            `Walk away: ${b.walkaway}`,
        ].join('\n');
        navigator.clipboard.writeText(text).then(
            () => notify('Brief copied'),
            () => notify('Could not copy the brief', 'warning'),
        );
    }

    const rows = useMemo(() => {
        type Row = { id: string; line: Line; kind: 'held' | 'contest' | 'none'; award: number; theirUnit: number | null; ref: string; refUnit: number | null; move: number | null; cushion: number | null; blocker?: string | null; altApproved?: boolean };
        const out: Row[] = [];
        for (const h of a.held)
            out.push({ id: h.line.id, line: h.line, kind: 'held', award: h.award, theirUnit: h.line.unitPrice, ref: h.alt?.supplier ?? '—', refUnit: h.alt?.unit ?? null, move: null, cushion: h.cushion, altApproved: h.altApproved });
        for (const c of a.contestable)
            out.push({ id: c.line.id, line: c.line, kind: 'contest', award: c.award, theirUnit: c.theirs.unit, ref: c.winner ?? '—', refUnit: c.line.unitPrice, move: c.move, cushion: null, blocker: c.blocker });
        for (const n of a.notQuoted)
            out.push({ id: n.line.id, line: n.line, kind: 'none', award: n.award, theirUnit: null, ref: n.line.supplier ?? '—', refUnit: n.line.unitPrice, move: null, cushion: null });
        const bk = bks.find((b) => b.id === bucket);
        return out.filter((r) => {
            if (bk) return r.kind === 'contest' && bk.items.some((i) => i.line.id === r.id);
            if (filter === 'all') return true;
            if (filter === 'match') return r.kind === 'held' && r.cushion !== null && r.cushion < -0.001;
            return r.kind === filter;
        });
    }, [a, bks, bucket, filter]);


    const notQuotedVolume = a.notQuoted.reduce((s, n) => s + n.award, 0);
    const nearLines = a.contestable.filter((c) => c.move > 0 && c.move <= 0.1).length;

    return (
        <section className="supplier">
            <header className="sup-head">
                <div className="sup-logo">{initials(supplier.supplier)}</div>
                <div className="sup-title">
                    <div className="sup-meta">
                        {booth ? (
                            <span className="badge">
                                <span className={`dot ${booth.confirmed ? 'dot-good' : 'dot-warning'}`} />
                                Hall {booth.hall} · Stand {booth.stand}
                                {booth.confirmed ? '' : ' · earlier edition'}
                            </span>
                        ) : (
                            <span className="badge">
                                <span className="dot dot-neutral" />
                                No stand found, plan a call
                            </span>
                        )}
                        {p.stop && (
                            <span className="badge badge-outline brand">
                                Stop {p.stop.index + 1} on your route · {p.stop.minutes ?? 20} min
                            </span>
                        )}
                        {booth?.note && <span className="text-body-sm text-subtle">{booth.note}</span>}
                    </div>
                    <h2>{supplier.supplier}</h2>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={p.onClose} aria-label="Back to the floor plan" title="Back to the floor plan">
                    <X />
                </button>
            </header>

            <div className="card">
                <div className="kpis">
                    <Kpi label="Spend in this project" value={money(supplier.spend)} sub={`${pct(supplier.share, 1)} of the project · ${supplier.lines} lines`} />
                    <Kpi
                        label="Selected spend, last 60 projects"
                        value={p.portfolio ? money(p.portfolio.spend) : '…'}
                        sub={
                            p.portfolio
                                ? `${p.portfolio.projects} projects · ${p.portfolio.lines} lines${p.portfolioProgress.done < p.portfolioProgress.total ? ' · still counting' : ''}`
                                : `Counting ${p.portfolioProgress.done}/${p.portfolioProgress.total} projects`
                        }
                        loading={!p.portfolio}
                    />
                    <Kpi label="Up for grabs within 10%" value={money(within10)} sub={`${nearLines} line${nearLines === 1 ? '' : 's'} they almost win`} />
                    <Kpi label="Price-match asks" value={money(a.matchSavings)} sub={`${a.matchAsks.length} held lines where a competitor is cheaper`} />
                    <Kpi label="Not quoted" value={money(notQuotedVolume)} sub={`${a.notQuoted.length} lines to ask them to quote`} />
                </div>
            </div>

            <NewsTicker news={p.news} />

            <div className="tabs-row">
                <div className="tabs tabs-line" role="tablist">
                    <button className="tab" role="tab" aria-selected={tab === 'negotiate'} onClick={() => setTab('negotiate')}>
                        Negotiation
                    </button>
                    <button className="tab" role="tab" aria-selected={tab === 'talk'} onClick={() => setTab('talk')}>
                        Conversation opener
                    </button>
                    <button className="tab" role="tab" aria-selected={tab === 'lines'} onClick={() => setTab('lines')}>
                        Line items <span className="count">{a.held.length + a.contestable.length + a.notQuoted.length}</span>
                    </button>
                </div>
                {scanning && (
                    <span className="scan">
                        <span className="bar">
                            <span style={{ width: `${(p.compProgress.done / Math.max(1, p.compProgress.total)) * 100}%` }} />
                        </span>
                        Scanning competing offers {p.compProgress.done}/{p.compProgress.total} lines
                    </span>
                )}
            </div>

            {tab === 'talk' && (
                <div className="talk">
                    <OpenerCard
                        news={p.news}
                        onRefresh={p.loadNews}
                        facts={
                            <>
                                You buy <b>{money(supplier.spend)}</b> from them on this project
                                {p.portfolio ? (
                                    <>
                                        {' '}
                                        and <b>{money(p.portfolio.spend)}</b> across {p.portfolio.projects} projects
                                    </>
                                ) : null}
                                .
                            </>
                        }
                    />
                    <Headlines news={p.news} name={supplier.supplier} />
                </div>
            )}

            {tab === 'negotiate' && (
                <div className="negotiate">
                    <div className="card pad sim">
                        <div className="card-head">
                            <div className="left">
                                <div className="subhead">
                                    <h3>How far do they need to move?</h3>
                                </div>
                                <p className="text-body-md text-muted">
                                    What {supplier.supplier} wins and gives back if they cut prices by the amount on the axis, assuming we award every line where they become cheapest.
                                </p>
                            </div>
                            <div className="segmented" role="group" aria-label="Where the price move applies">
                                <button aria-pressed={mode === 'across'} onClick={() => (setTouched(true), setMode('across'))}>
                                    All lines
                                </button>
                                <button aria-pressed={mode === 'targeted'} onClick={() => (setTouched(true), setMode('targeted'))}>
                                    Lines they don't hold
                                </button>
                            </div>
                        </div>
                        {a.covered === 0 ? (
                            <div className="sim-empty">{scanning ? 'Scanning competing offers…' : 'No competing offers on this scenario.'}</div>
                        ) : (
                            <>
                                <div className="legend-row">
                                    <span>
                                        <i className="lg-win" />
                                        Volume they win
                                    </span>
                                    {mode === 'across' && (
                                        <span>
                                            <i className="lg-give" />
                                            Given back on lines they hold
                                        </span>
                                    )}
                                    <span>
                                        <i className="lg-net" />
                                        Net change for them
                                    </span>
                                </div>
                                <ConcessionChart points={points} d={d} onChange={moveTo} sweet={sweet} max={0.3} sweetLabel={mode === 'across' ? 'Best net for them' : 'Biggest jump'} />
                                <input className="slider" type="range" min={0} max={0.3} step={0.0025} value={d} onChange={(e) => moveTo(Number(e.target.value))} aria-label="Price move" />
                                <div className="checkpoints">
                                    {checkpoints.map(({ c, p: cp }) => {
                                        const up = a.heldVolume ? cp.volume / a.heldVolume - 1 : 0;
                                        return (
                                            <button key={c} className={`checkpoint${Math.abs(c - d) < 0.001 ? ' on' : ''}`} onClick={() => moveTo(c)}>
                                                <b>−{pct(c)}</b>
                                                <span>
                                                    <span className={up >= 0 ? 'sig-good' : 'sig-crit'}>
                                                        {up >= 0 ? '↑' : '↓'} {signedPct(up, 0).replace(/^[+−]/, '')}
                                                    </span>{' '}
                                                    volume · +{cp.wonLines} lines
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="readout">
                                    <Kpi label="Price move" value={`−${pct(d, 1)}`} sub={mode === 'across' ? 'on every line' : 'on lines they don’t hold'} />
                                    <Kpi
                                        label="Award volume"
                                        value={money(sim.volume)}
                                        subNode={
                                            <>
                                                <span className={volumeUp >= 0 ? 'sig-good' : 'sig-crit'}>
                                                    {volumeUp >= 0 ? '↑' : '↓'} {signedPct(volumeUp).replace(/^[+−]/, '')}
                                                </span>{' '}
                                                vs. {money(a.heldVolume)} today
                                            </>
                                        }
                                    />
                                    <Kpi
                                        label="Lines"
                                        value={`${sim.lines}`}
                                        subNode={
                                            <>
                                                <span className="sig-good">↑ {sim.wonLines}</span> vs. {a.held.length} today
                                            </>
                                        }
                                    />
                                    <Kpi label="They give back" value={money(sim.giveBack)} sub={mode === 'across' ? 'on the lines they hold' : 'nothing on held lines'} />
                                    <Kpi
                                        label="Net change for them"
                                        value={`${sim.net >= 0 ? '+' : '−'}${money(Math.abs(sim.net))}`}
                                        subNode={<span className={sim.net >= 0 ? 'sig-good' : 'sig-crit'}>{sim.net >= 0 ? 'they come out ahead' : 'they lose revenue'}</span>}
                                    />
                                </div>
                                <div className="message sim-say" role="note">
                                    <MessageSquareQuote />
                                    <div className="content">
                                        <span className="text">
                                            {sim.wonLines > 0 && sim.net > 0 ? (
                                                <>
                                                    Say it like this: “Move <b>{pct(d, 1)}</b>
                                                    {mode === 'across' ? ' across the board' : ' on the lines you don’t have yet'} and you win <b>{sim.wonLines} more line{sim.wonLines === 1 ? '' : 's'}</b>. Your volume with us goes from <b>{money(a.heldVolume)}</b> to <b>{money(sim.volume)}</b>.”
                                                </>
                                            ) : sweet.d > 0 && sweet.net > 0 ? (
                                                <>
                                                    At this move they don’t gain. Their best point is <b>−{pct(sweet.d, 1)}</b>: {sweet.wonLines} more lines and {money(sweet.volume)} award volume.
                                                </>
                                            ) : (
                                                <>No price move wins them net volume on this project. Use the price-match asks and the lines they have not quoted instead.</>
                                            )}
                                        </span>
                                    </div>
                                    {sim.net <= 0 && sweet.d > 0 && sweet.net > 0 && (
                                        <button className="btn btn-ghost btn-sm inline-action" onClick={() => moveTo(sweet.d)}>
                                            Jump to −{pct(sweet.d, 1)}
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="side-stack">
                        <div className="card pad">
                            <div className="subhead">
                                <h3>Where they are close</h3>
                                <span className="meta">{a.contestable.length} lost lines</span>
                            </div>
                            <p className="text-body-sm text-muted" style={{ margin: '4px 0 12px' }}>
                                Lines they quoted but lost, by the price cut that would win them. Click a row to see the lines.
                            </p>
                            <GapBuckets
                                buckets={bks}
                                active={bucket}
                                onPick={(id) => {
                                    setBucket(id);
                                    if (id) setTab('lines');
                                }}
                            />
                            {blockers.length > 0 && (
                                <div className="blockers">
                                    <div className="subhead">
                                        <h3>Cheapest, yet not awarded</h3>
                                    </div>
                                    {blockers.map((b) => (
                                        <div key={b.reason} className="blocker">
                                            <span>{b.reason}</span>
                                            <b>{money(b.volume)}</b>
                                            <em>
                                                {b.count} line{b.count === 1 ? '' : 's'}
                                            </em>
                                        </div>
                                    ))}
                                    <p className="text-body-sm text-muted" style={{ margin: 0 }}>
                                        Fix these and they win on price alone: ask for stock, a shorter lead time or the approval paperwork.
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="card pad">
                            <div className="subhead">
                                <h3>Ask them to match</h3>
                                <span className="meta">{money(a.matchSavings)}</span>
                            </div>
                            <p className="text-body-sm text-muted" style={{ margin: '4px 0 8px' }}>
                                They hold these lines, yet a competitor is cheaper.
                            </p>
                            {a.matchAsks.length ? (
                                <ul className="asks">
                                    {a.matchAsks.slice(0, 5).map((h) => (
                                        <li key={h.line.id}>
                                            <span className="mpn">{h.line.mpn}</span>
                                            <span className="why">
                                                {h.alt!.supplier} is {pct(-h.cushion!, 1)} lower{h.altApproved ? '' : ', not approved'}
                                            </span>
                                            <b>save {money(h.award - h.alt!.total)}</b>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-body-md text-muted">{scanning ? 'Still scanning…' : 'They are the cheapest on every line they hold.'}</p>
                            )}
                            {a.defend.length > 0 && (
                                <p className="text-body-sm" style={{ margin: '8px 0 0' }}>
                                    <b>{a.defend.length}</b> held line{a.defend.length === 1 ? '' : 's'} where the next offer is less than 5% behind ({money(a.defend.reduce((s, h) => s + h.award, 0))}). They know they can lose these.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="card pad brief">
                        <div className="card-head">
                            <div className="left">
                                <div className="subhead">
                                    <h3>Negotiation brief</h3>
                                </div>
                                <p className="text-body-md text-muted">Goals, asks with numbers, leverage, what to give and a walk-away, written from the data above.</p>
                            </div>
                            <div className="row-actions">
                                {brief.data && (
                                    <button className="btn btn-secondary" onClick={copyBrief}>
                                        <Copy />
                                        Copy
                                    </button>
                                )}
                                <button className="btn btn-ink" onClick={makeBrief} disabled={brief.loading || scanning} aria-busy={brief.loading}>
                                    <Sparkles style={{ color: 'var(--highlight)' }} />
                                    {brief.loading ? 'Writing' : brief.data ? 'Write again' : scanning ? 'Waiting for the scan' : 'Write the brief'}
                                </button>
                            </div>
                        </div>
                        {brief.error && <p className="error text-body-md">{brief.error}</p>}
                        {brief.loading && <div className="shimmer" />}
                        {brief.data && (
                            <div className="brief-body">
                                <p className="stance">{brief.data.stance}</p>
                                <div className="brief-grid text-body-md">
                                    <div className="subsections">
                                        <div className="subsection">
                                            <div className="subhead">
                                                <h3>Goals</h3>
                                            </div>
                                            <ul>
                                                {brief.data.goals.map((g, i) => (
                                                    <li key={i}>{g}</li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div className="subsection">
                                            <div className="subhead">
                                                <h3>Leverage</h3>
                                            </div>
                                            <ul>
                                                {brief.data.leverage.map((g, i) => (
                                                    <li key={i}>{g}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                    <div className="subsection">
                                        <div className="subhead">
                                            <h3>Asks</h3>
                                            <span className="meta">{brief.data.asks.length}</span>
                                        </div>
                                        {brief.data.asks.map((x, i) => (
                                            <div className="ask" key={i}>
                                                <div className="top">
                                                    <b>{x.title}</b>
                                                    <span className="badge badge-outline brand">{x.value}</span>
                                                </div>
                                                <div>{x.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="subsections">
                                        <div className="subsection">
                                            <div className="subhead">
                                                <h3>What we can give</h3>
                                            </div>
                                            <ul>
                                                {brief.data.give.map((g, i) => (
                                                    <li key={i}>{g}</li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div className="subsection">
                                            <div className="subhead">
                                                <h3>Walk away</h3>
                                            </div>
                                            <p style={{ margin: 0 }}>{brief.data.walkaway}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === 'lines' && (
                <div className="group">
                    <div className="filters">
                        {(
                            [
                                ['all', 'All', a.held.length + a.contestable.length + a.notQuoted.length],
                                ['held', 'They hold', a.held.length],
                                ['contest', 'They quoted, lost', a.contestable.length],
                                ['match', 'Competitor cheaper', a.matchAsks.length],
                                ['none', 'Not quoted', a.notQuoted.length],
                            ] as [LineFilter, string, number][]
                        ).map(([id, label, n]) => (
                            <button key={id} className="fchip" aria-pressed={filter === id && !bucket} onClick={() => (setBucket(null), setFilter(id))}>
                                {label} <span className="n">{n}</span>
                            </button>
                        ))}
                        {bucket && (
                            <span className="fchip selected has-clear">
                                <span className="label">{bks.find((b) => b.id === bucket)?.label}</span>
                                <button className="clear" aria-label="Clear the gap filter" onClick={() => setBucket(null)}>
                                    <X />
                                </button>
                            </span>
                        )}
                    </div>
                    <div className="table-card">
                        <div className="table-scroll">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Part</th>
                                        <th className="num">Qty</th>
                                        <th>Position</th>
                                        <th className="num">Their unit price</th>
                                        <th>Next best or winner</th>
                                        <th className="num">Unit price</th>
                                        <th>Gap</th>
                                        <th className="num">Ask for</th>
                                        <th className="num">Line value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.slice(0, 200).map((r) => (
                                        <tr key={r.id}>
                                            <td>
                                                <div className="text-label-md">{r.line.mpn}</div>
                                                <div className="text-body-sm text-subtle">{r.line.manufacturer}</div>
                                            </td>
                                            <td className="num">{qty(r.line.qty)}</td>
                                            <td>
                                                {r.kind === 'held' && (
                                                    <span className="badge">
                                                        <span className="dot dot-good" />
                                                        Held
                                                    </span>
                                                )}
                                                {r.kind === 'contest' && (
                                                    <span className="badge">
                                                        <span className="dot dot-warning" />
                                                        Lost
                                                    </span>
                                                )}
                                                {r.kind === 'none' && (
                                                    <span className="badge">
                                                        <span className="dot dot-neutral" />
                                                        Not quoted
                                                    </span>
                                                )}
                                            </td>
                                            <td className="num">{r.theirUnit !== null ? unit(r.theirUnit) : '–'}</td>
                                            <td>
                                                <span className="entity-link">{r.ref}</span>
                                                {r.kind === 'held' && r.ref !== '—' && !r.altApproved && <div className="text-body-sm text-subtle">not approved</div>}
                                            </td>
                                            <td className="num">{r.refUnit !== null ? unit(r.refUnit) : '–'}</td>
                                            <td>
                                                {r.kind === 'contest' && r.move !== null && <MoveBar move={r.move} />}
                                                {r.kind === 'contest' && r.blocker && <div className="text-body-sm text-subtle">{r.blocker}</div>}
                                                {r.kind === 'held' &&
                                                    (r.cushion === null ? (
                                                        <span className="text-body-sm text-subtle">no alternative</span>
                                                    ) : r.cushion < -0.001 ? (
                                                        <span className="text-body-sm">
                                                            <span className="sig-good">↓ {pct(-r.cushion, 1)}</span> competitor cheaper
                                                        </span>
                                                    ) : (
                                                        <span className="text-body-sm">
                                                            <span className={r.cushion < 0.05 ? 'sig-warn' : 'sig-neutral'}>leads by {pct(r.cushion, 1)}</span>
                                                        </span>
                                                    ))}
                                                {r.kind === 'none' && <span className="text-body-sm text-subtle">ask for a quote</span>}
                                            </td>
                                            <td className="num target">
                                                {r.kind === 'held' && r.cushion !== null && r.cushion < -0.001 && r.refUnit !== null && <span title="Match the cheaper competitor">{unit(r.refUnit)}</span>}
                                                {r.kind === 'contest' && r.move !== null && r.theirUnit !== null && (
                                                    <span title="Unit price at which they win the line">{r.move <= 0 ? 'award terms' : `≤ ${unit(r.theirUnit * (1 - r.move - 0.005))}`}</span>
                                                )}
                                            </td>
                                            <td className="num">{money(r.award)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {rows.length > 200 && <div className="table-foot">Showing the first 200 of {rows.length} lines.</div>}
                        {!rows.length && <div className="table-foot">{scanning ? 'Scanning competing offers…' : 'No lines in this view.'}</div>}
                    </div>
                </div>
            )}
        </section>
    );
}

function Kpi({ label, value, sub, subNode, loading }: { label: string; value: string; sub?: string; subNode?: React.ReactNode; loading?: boolean }) {
    return (
        <div className={`kpi${loading ? ' loading' : ''}`}>
            <span className="label">{label}</span>
            <span className="value">{value}</span>
            {(subNode || sub) && <span className="sub">{subNode ?? sub}</span>}
        </div>
    );
}
