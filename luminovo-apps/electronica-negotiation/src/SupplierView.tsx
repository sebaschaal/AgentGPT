import { useEffect, useMemo, useState } from 'react';
import { useOpenExternal, useNotify } from '@luminovo/widget-sdk';
import { call, describeError } from './api';
import { ConcessionChart, GapBuckets, MoveBar } from './charts';
import { ago, initials, money, pct, qty, signedPct, unit } from './format';
import {
    analyse,
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

export interface NewsState {
    loading: boolean;
    error?: string;
    items?: { title: string; url: string; source: string; date: string | null; snippet: string }[];
    via?: string | null;
    summary?: { ticker?: { index: number; takeaway: string; tone: string }[]; opener?: string; hook?: string; error?: string; hint?: string } | null;
}

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
    const openExternal = useOpenExternal();
    const notify = useNotify();
    const [tab, setTab] = useState<'negotiate' | 'talk' | 'lines'>('negotiate');
    const [mode, setMode] = useState<Mode>('across');
    const [d, setD] = useState(0.05);
    const [bucket, setBucket] = useState<string | null>(null);
    const [filter, setFilter] = useState<LineFilter>('all');
    const [brief, setBrief] = useState<{ loading: boolean; data?: Brief; error?: string }>({ loading: false });

    const a = useMemo(() => analyse(supplier.supplier, lines, comp), [supplier.supplier, lines, comp]);
    const points = useMemo(() => curve(a, mode), [a, mode]);
    const sweet = useMemo(() => sweetSpot(points), [points]);
    const sim = simulate(a, d, mode);
    const bks = useMemo(() => buckets(a), [a]);
    const within10 = withinVolume(a, 0.1);
    const scanning = p.compProgress.done < p.compProgress.total;

    useEffect(() => {
        setBrief({ loading: false });
        setBucket(null);
        setFilter('all');
    }, [supplier.supplier]);

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
                    .map((c) => ({ mpn: c.line.mpn, volume: Math.round(c.award), theirLeadDays: c.theirs.leadDays, winnerLeadDays: c.line.leadDays, tags: c.theirs.tags })),
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
        type Row = { id: string; line: Line; kind: 'held' | 'contest' | 'none'; award: number; theirUnit: number | null; ref: string; refUnit: number | null; move: number | null; cushion: number | null };
        const out: Row[] = [];
        for (const h of a.held)
            out.push({ id: h.line.id, line: h.line, kind: 'held', award: h.award, theirUnit: h.line.unitPrice, ref: h.alt?.supplier ?? '—', refUnit: h.alt?.unit ?? null, move: null, cushion: h.cushion });
        for (const c of a.contestable)
            out.push({ id: c.line.id, line: c.line, kind: 'contest', award: c.award, theirUnit: c.theirs.unit, ref: c.winner ?? '—', refUnit: c.line.unitPrice, move: c.move, cushion: null });
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

    const ticker = useMemo(() => {
        const items = p.news?.items ?? [];
        const notes = new Map((p.news?.summary?.ticker ?? []).map((t) => [t.index, t]));
        return items.slice(0, 8).map((n, i) => ({ ...n, note: notes.get(i) }));
    }, [p.news]);

    return (
        <section className="supplier">
            <header className="sup-head">
                <div className="sup-logo">{initials(supplier.supplier)}</div>
                <div className="sup-title">
                    <h2>{supplier.supplier}</h2>
                    <div className="sup-meta">
                        {booth ? (
                            <span className={`chip ${booth.confirmed ? 'chip--green' : 'chip--yellow'}`}>
                                Hall {booth.hall} · Stand {booth.stand}
                                {booth.confirmed ? '' : ' · earlier edition'}
                            </span>
                        ) : (
                            <span className="chip chip--neutral">No stand found, plan a call</span>
                        )}
                        {booth?.note && <span className="sup-note">{booth.note}</span>}
                        {p.stop && (
                            <span className="chip chip--primary">
                                Stop {p.stop.index + 1} on your route · {p.stop.minutes ?? 20} min
                            </span>
                        )}
                    </div>
                </div>
                <button className="lumi-btn lumi-btn--ghost close" onClick={p.onClose} aria-label="Back to the floor plan">
                    ✕
                </button>
            </header>

            <div className="kpis">
                <Kpi label="Spend in this project" value={money(supplier.spend)} sub={`${pct(supplier.share, 1)} of the project · ${supplier.lines} lines`} />
                <Kpi
                    label="Selected spend, all projects"
                    value={p.portfolio ? money(p.portfolio.spend) : '…'}
                    sub={
                        p.portfolio
                            ? `${p.portfolio.projects} projects · ${p.portfolio.lines} lines${p.portfolioProgress.done < p.portfolioProgress.total ? ' · still counting' : ''}`
                            : `Counting ${p.portfolioProgress.done}/${p.portfolioProgress.total} projects`
                    }
                />
                <Kpi label="Up for grabs within 10%" value={money(within10)} sub={`${a.contestable.filter((c) => c.move > 0 && c.move <= 0.1).length} lines they almost win`} tone="primary" />
                <Kpi label="Price-match asks" value={money(a.matchSavings)} sub={`${a.matchAsks.length} held lines where a competitor is cheaper`} tone={a.matchSavings > 0 ? 'green' : undefined} />
                <Kpi label="Not quoted" value={money(a.notQuoted.reduce((s, n) => s + n.award, 0))} sub={`${a.notQuoted.length} lines to ask them to quote`} />
            </div>

            <div className="ticker" aria-live="polite">
                <span className="ticker-tag">{p.news?.loading ? 'Reading the news…' : p.news?.via ? `Live · ${p.news.via}` : 'News'}</span>
                <div className="ticker-track">
                    {ticker.length ? (
                        <div className="ticker-move" style={{ animationDuration: `${Math.max(30, ticker.length * 9)}s` }}>
                            {[...ticker, ...ticker].map((t, i) => (
                                <button key={i} className="ticker-item" onClick={() => t.url && openExternal(t.url)}>
                                    <i className={`tone tone--${t.note?.tone ?? 'neutral'}`} />
                                    <b>{t.source || 'News'}</b> {t.title}
                                    {t.note && <em> — {t.note.takeaway}</em>}
                                    <span className="ticker-date">{ago(t.date)}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <span className="ticker-empty">{p.news?.loading ? 'Pulling recent headlines and summarizing them for your opener' : 'No recent headlines found'}</span>
                    )}
                </div>
            </div>

            <nav className="tabs">
                <button className={tab === 'negotiate' ? 'on' : ''} onClick={() => setTab('negotiate')}>
                    Negotiation
                </button>
                <button className={tab === 'talk' ? 'on' : ''} onClick={() => setTab('talk')}>
                    Conversation opener
                </button>
                <button className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>
                    Line items <span className="count">{a.held.length + a.contestable.length + a.notQuoted.length}</span>
                </button>
                {scanning && (
                    <span className="scan">
                        <span className="scan-bar">
                            <span style={{ width: `${(p.compProgress.done / Math.max(1, p.compProgress.total)) * 100}%` }} />
                        </span>
                        Scanning competing offers {p.compProgress.done}/{p.compProgress.total} lines
                    </span>
                )}
            </nav>

            {tab === 'talk' && (
                <div className="talk">
                    <div className="opener-card">
                        <div className="eyebrow">Open with</div>
                        {p.news?.loading && <p className="muted">Writing an opener from today's headlines…</p>}
                        {p.news?.error && <p className="error">{p.news.error}</p>}
                        {p.news?.summary?.opener && <blockquote>{p.news.summary.opener}</blockquote>}
                        {p.news?.summary?.hook && (
                            <p className="hook">
                                <b>Bridge to business:</b> {p.news.summary.hook}
                            </p>
                        )}
                        {p.news?.summary?.error && <p className="error">{p.news.summary.hint ?? 'The AI summary is unavailable right now.'}</p>}
                        <div className="opener-facts">
                            <span>
                                You buy <b>{money(supplier.spend)}</b> from them on this project
                                {p.portfolio ? (
                                    <>
                                        {' '}
                                        and <b>{money(p.portfolio.spend)}</b> across {p.portfolio.projects} projects
                                    </>
                                ) : null}
                                .
                            </span>
                        </div>
                        <button className="lumi-btn lumi-btn--secondary" onClick={p.loadNews} disabled={p.news?.loading}>
                            Refresh news
                        </button>
                    </div>
                    <div className="news-list">
                        <div className="eyebrow">Headlines</div>
                        {(p.news?.items ?? []).slice(0, 8).map((n, i) => (
                            <button key={i} className="news-item" onClick={() => n.url && openExternal(n.url)}>
                                <span className="news-src">
                                    {n.source} · {ago(n.date)}
                                </span>
                                <span className="news-title">{n.title}</span>
                                {n.snippet && <span className="news-snip">{n.snippet}</span>}
                            </button>
                        ))}
                        {!p.news?.loading && !(p.news?.items ?? []).length && <p className="muted">No recent headlines found for {supplier.supplier}.</p>}
                    </div>
                </div>
            )}

            {tab === 'negotiate' && (
                <div className="negotiate">
                    <div className="card sim">
                        <div className="card-head">
                            <div>
                                <h3>How far do they need to move?</h3>
                                <p className="muted">
                                    Award volume if {supplier.supplier} cuts prices by the amount on the axis and we award every line where they become cheapest.
                                </p>
                            </div>
                            <div className="seg">
                                <button className={mode === 'across' ? 'on' : ''} onClick={() => setMode('across')}>
                                    Across the board
                                </button>
                                <button className={mode === 'targeted' ? 'on' : ''} onClick={() => setMode('targeted')}>
                                    Only on lines they don't hold
                                </button>
                            </div>
                        </div>
                        {a.covered === 0 ? (
                            <div className="sim-empty">{scanning ? 'Scanning competing offers…' : 'No competing offers on this scenario.'}</div>
                        ) : (
                            <>
                                <ConcessionChart points={points} d={d} onChange={setD} sweet={sweet} base={a.heldVolume} max={0.3} />
                                <input className="slider" type="range" min={0} max={0.3} step={0.0025} value={d} onChange={(e) => setD(Number(e.target.value))} aria-label="Price concession" />
                                <div className="readout">
                                    <div className="readout-big">
                                        <span className="muted">Price move</span>
                                        <b>−{pct(d, 1)}</b>
                                    </div>
                                    <div className="readout-big">
                                        <span className="muted">Award volume</span>
                                        <b>{money(sim.volume)}</b>
                                        <em className={volumeUp >= 0 ? 'up' : 'down'}>{signedPct(volumeUp)}</em>
                                    </div>
                                    <div className="readout-big">
                                        <span className="muted">Lines</span>
                                        <b>
                                            {a.held.length} → {sim.lines}
                                        </b>
                                        <em className="up">+{sim.wonLines} won</em>
                                    </div>
                                    <div className="readout-big">
                                        <span className="muted">They give back</span>
                                        <b className="down">{money(sim.giveBack)}</b>
                                        <em>on lines they hold</em>
                                    </div>
                                    <div className="readout-big">
                                        <span className="muted">Net for them</span>
                                        <b className={sim.net >= 0 ? 'up' : 'down'}>
                                            {sim.net >= 0 ? '+' : '−'}
                                            {money(Math.abs(sim.net))}
                                        </b>
                                    </div>
                                </div>
                                <p className="sim-say">
                                    {sweet.net > 0 ? (
                                        <>
                                            Say it like this: “Move <b>{pct(sweet.d, 1)}</b>{mode === 'across' ? ' across the board' : ' on the lines you don’t have yet'} and you win <b>{sweet.wonLines} more lines</b>. Your volume with us goes from <b>{money(a.heldVolume)}</b> to <b>{money(sweet.volume)}</b>, net <b>+{money(sweet.net)}</b> for you.”
                                        </>
                                    ) : (
                                        <>No price move wins them net volume on this project. Use the price-match asks and the lines they have not quoted instead.</>
                                    )}
                                </p>
                            </>
                        )}
                    </div>

                    <div className="side-stack">
                        <div className="card">
                            <h3>Where they are close</h3>
                            <p className="muted">Lines they quoted but lost, by the price cut that would win them. Click a bar to see the lines.</p>
                            <GapBuckets
                                buckets={bks}
                                active={bucket}
                                onPick={(id) => {
                                    setBucket(id);
                                    if (id) setTab('lines');
                                }}
                            />
                        </div>
                        <div className="card">
                            <h3>Ask them to match</h3>
                            <p className="muted">They hold these lines, yet a competitor is cheaper.</p>
                            {a.matchAsks.length ? (
                                <ul className="asks">
                                    {a.matchAsks.slice(0, 5).map((h) => (
                                        <li key={h.line.id}>
                                            <span className="mpn">{h.line.mpn}</span>
                                            <span>
                                                {h.alt!.supplier} is {pct(-h.cushion!, 1)} lower
                                            </span>
                                            <b className="up">save {money(h.award - h.alt!.total)}</b>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="muted small">{scanning ? 'Still scanning…' : 'They are the cheapest on every line they hold.'}</p>
                            )}
                            {a.defend.length > 0 && (
                                <p className="small">
                                    <b>{a.defend.length}</b> held line{a.defend.length === 1 ? '' : 's'} where the next offer is less than 5% behind ({money(a.defend.reduce((s, h) => s + h.award, 0))}). They know they can lose these.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="card brief">
                        <div className="card-head">
                            <div>
                                <h3>Negotiation brief</h3>
                                <p className="muted">Goals, asks with numbers, leverage, what to give and a walk-away, built from the data above.</p>
                            </div>
                            <div className="row">
                                {brief.data && (
                                    <button className="lumi-btn lumi-btn--secondary" onClick={copyBrief}>
                                        Copy
                                    </button>
                                )}
                                <button className="lumi-btn" onClick={makeBrief} disabled={brief.loading || scanning}>
                                    {brief.loading ? 'Writing…' : brief.data ? 'Rewrite' : scanning ? 'Waiting for scan…' : 'Write the brief'}
                                </button>
                            </div>
                        </div>
                        {brief.error && <p className="error">{brief.error}</p>}
                        {brief.loading && <div className="shimmer" />}
                        {brief.data && (
                            <div className="brief-body">
                                <p className="stance">{brief.data.stance}</p>
                                <div className="brief-grid">
                                    <div>
                                        <div className="eyebrow">Goals</div>
                                        <ul>
                                            {brief.data.goals.map((g, i) => (
                                                <li key={i}>{g}</li>
                                            ))}
                                        </ul>
                                        <div className="eyebrow">Leverage</div>
                                        <ul>
                                            {brief.data.leverage.map((g, i) => (
                                                <li key={i}>{g}</li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div>
                                        <div className="eyebrow">Asks</div>
                                        {brief.data.asks.map((x, i) => (
                                            <div className="ask" key={i}>
                                                <div>
                                                    <b>{x.title}</b> <span className="chip chip--primary">{x.value}</span>
                                                </div>
                                                <div className="muted">{x.detail}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <div>
                                        <div className="eyebrow">What we can give</div>
                                        <ul>
                                            {brief.data.give.map((g, i) => (
                                                <li key={i}>{g}</li>
                                            ))}
                                        </ul>
                                        <div className="eyebrow">Walk away</div>
                                        <p>{brief.data.walkaway}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === 'lines' && (
                <div className="card lines">
                    <div className="filters">
                        {(
                            [
                                ['all', 'All'],
                                ['held', `They hold (${a.held.length})`],
                                ['contest', `They quoted, lost (${a.contestable.length})`],
                                ['match', `Competitor cheaper (${a.matchAsks.length})`],
                                ['none', `Not quoted (${a.notQuoted.length})`],
                            ] as [LineFilter, string][]
                        ).map(([id, label]) => (
                            <button key={id} className={`chip-btn${filter === id && !bucket ? ' on' : ''}`} onClick={() => (setBucket(null), setFilter(id))}>
                                {label}
                            </button>
                        ))}
                        {bucket && (
                            <button className="chip-btn on" onClick={() => setBucket(null)}>
                                {bks.find((b) => b.id === bucket)?.label} ✕
                            </button>
                        )}
                    </div>
                    <table className="lumi-table">
                        <thead>
                            <tr>
                                <th>Part</th>
                                <th className="num">Qty</th>
                                <th>Position</th>
                                <th className="num">Their unit price</th>
                                <th>Next best / winner</th>
                                <th className="num">Unit price</th>
                                <th>Gap</th>
                                <th className="num">Line value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.slice(0, 200).map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <div className="mpn">{r.line.mpn}</div>
                                        <div className="muted small">{r.line.manufacturer}</div>
                                    </td>
                                    <td className="num">{qty(r.line.qty)}</td>
                                    <td>
                                        {r.kind === 'held' && <span className="chip chip--green">Held</span>}
                                        {r.kind === 'contest' && <span className="chip chip--yellow">Lost to {r.ref}</span>}
                                        {r.kind === 'none' && <span className="chip chip--neutral">Not quoted</span>}
                                    </td>
                                    <td className="num">{r.theirUnit !== null ? unit(r.theirUnit) : '—'}</td>
                                    <td>{r.kind === 'held' ? r.ref : r.kind === 'contest' ? r.ref : r.ref}</td>
                                    <td className="num">{r.refUnit !== null ? unit(r.refUnit) : '—'}</td>
                                    <td>
                                        {r.kind === 'contest' && r.move !== null && <MoveBar move={r.move} />}
                                        {r.kind === 'held' &&
                                            (r.cushion === null ? (
                                                <span className="muted small">no alternative</span>
                                            ) : r.cushion < -0.001 ? (
                                                <span className="tag-match">competitor {pct(-r.cushion, 1)} lower</span>
                                            ) : (
                                                <span className={`tag-lead${r.cushion < 0.05 ? ' thin' : ''}`}>leads by {pct(r.cushion, 1)}</span>
                                            ))}
                                        {r.kind === 'none' && <span className="muted small">ask for a quote</span>}
                                    </td>
                                    <td className="num">{money(r.award)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {rows.length > 200 && <p className="muted small">Showing the first 200 of {rows.length} lines.</p>}
                    {!rows.length && <p className="muted">{scanning ? 'Scanning competing offers…' : 'No lines in this view.'}</p>}
                </div>
            )}
        </section>
    );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'primary' | 'green' }) {
    return (
        <div className={`kpi${tone ? ` kpi--${tone}` : ''}`}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{value}</div>
            {sub && <div className="kpi-sub">{sub}</div>}
        </div>
    );
}
