import { useEffect, useMemo } from 'react';
import { MessageSquareQuote, X } from 'lucide-react';
import { initials, money, pct, qty, unit } from './format';
import { key, type CompLine, type MakerSpend } from './model';
import type { RouteStop } from './FloorPlan';
import { Headlines, NewsTicker, OpenerCard, type NewsState } from './news';

interface Props {
    maker: MakerSpend;
    comp: Map<string, CompLine>;
    compProgress: { done: number; total: number };
    projectName: string;
    stop?: RouteStop & { index: number };
    news: NewsState | undefined;
    loadNews: () => void;
    onClose: () => void;
}

// A manufacturer meeting is about project pricing (SPR), allocation and lifecycle, not about who distributes the part.
// The lever we bring: how much we buy of them, and where a cheaper distributor shows the price is soft.
export function MakerView(p: Props) {
    const { maker, comp } = p;
    const booth = maker.booth;

    useEffect(() => {
        if (!p.news) p.loadNews();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [maker.supplier]);

    const rows = useMemo(
        () =>
            maker.topLines.map((l) => {
                const opts = comp.get(l.id)?.options ?? [];
                const cheapest = opts.filter((o) => key(o.supplier) !== key(l.supplier)).sort((a, b) => a.total - b.total)[0];
                const saving = cheapest && cheapest.total < l.total ? l.total - cheapest.total : 0;
                return { l, cheapest, saving, distributors: new Set(opts.map((o) => o.supplier)).size };
            }),
        [maker, comp],
    );
    const arbitrage = rows.filter((r) => r.saving > 0);
    const arbitrageVolume = arbitrage.reduce((s, r) => s + r.saving, 0);
    const top = rows.slice(0, 8);
    const topValue = top.reduce((s, r) => s + r.l.total, 0);
    const maxVia = Math.max(1, ...maker.via.map((v) => v.spend));

    return (
        <section className="supplier">
            <header className="sup-head">
                <div className="sup-logo">{initials(maker.supplier)}</div>
                <div className="sup-title">
                    <div className="sup-meta">
                        <span className="badge badge-outline neutral">Manufacturer</span>
                        {booth ? (
                            <span className="badge">
                                <span className={`dot ${booth.confirmed ? 'dot-good' : 'dot-warning'}`} />
                                Hall {booth.hall} · Stand {booth.stand}
                                {booth.confirmed ? '' : ' · to be confirmed'}
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
                    <h2>{maker.supplier}</h2>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={p.onClose} aria-label="Back to the floor plan" title="Back to the floor plan">
                    <X />
                </button>
            </header>

            <div className="card">
                <div className="kpis">
                    <div className="kpi">
                        <span className="label">Their parts in this project</span>
                        <span className="value">{money(maker.spend)}</span>
                        <span className="sub">
                            {pct(maker.share, 1)} of the project · {maker.lines} lines
                        </span>
                    </div>
                    <div className="kpi">
                        <span className="label">Bought through</span>
                        <span className="value">{maker.via.length}</span>
                        <span className="sub">distributor{maker.via.length === 1 ? '' : 's'}, mostly {maker.via[0]?.supplier}</span>
                    </div>
                    <div className="kpi">
                        <span className="label">Top {top.length} parts</span>
                        <span className="value">{money(topValue)}</span>
                        <span className="sub">{pct(maker.spend ? topValue / maker.spend : 0)} of their spend here</span>
                    </div>
                    <div className="kpi">
                        <span className="label">Cheaper distributor available</span>
                        <span className="value">{money(arbitrageVolume)}</span>
                        <span className="sub">
                            on {arbitrage.length} line{arbitrage.length === 1 ? '' : 's'}
                            {p.compProgress.done < p.compProgress.total ? ' · still scanning' : ''}
                        </span>
                    </div>
                </div>
            </div>

            <NewsTicker news={p.news} />

            <div className="negotiate">
                <div className="group">
                    <div className="message" role="note">
                        <MessageSquareQuote />
                        <div className="content">
                            <span className="text">
                                Ask for a project price on the top {top.length} parts, worth <b>{money(topValue)}</b>, registered through <b>{maker.via[0]?.supplier ?? 'your distributor'}</b>.
                                {arbitrage.length > 0 && (
                                    <>
                                        {' '}
                                        Distributors already undercut each other by <b>{money(arbitrageVolume)}</b> on {arbitrage.length} of their parts, so list price has room.
                                    </>
                                )}
                            </span>
                        </div>
                    </div>
                    <div className="table-card">
                        <div className="table-scroll">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Part</th>
                                        <th className="num">Qty</th>
                                        <th>Bought through</th>
                                        <th className="num">Unit price</th>
                                        <th>Cheapest other distributor</th>
                                        <th className="num">Unit price</th>
                                        <th className="num">Line value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.slice(0, 30).map(({ l, cheapest, saving }) => (
                                        <tr key={l.id}>
                                            <td className="text-label-md">{l.mpn}</td>
                                            <td className="num">{qty(l.qty)}</td>
                                            <td>
                                                <span className="entity-link">{l.supplier}</span>
                                            </td>
                                            <td className="num">{unit(l.unitPrice)}</td>
                                            <td>
                                                {cheapest ? (
                                                    <>
                                                        <span className="entity-link">{cheapest.supplier}</span>
                                                        {saving > 0 && (
                                                            <div className="text-body-sm">
                                                                <span className="sig-good">↓ {money(saving)}</span> cheaper
                                                            </div>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="text-body-sm text-subtle">–</span>
                                                )}
                                            </td>
                                            <td className="num">{cheapest ? unit(cheapest.unit) : '–'}</td>
                                            <td className="num">{money(l.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {rows.length > 30 && <div className="table-foot">Showing the 30 largest of {rows.length} lines.</div>}
                    </div>
                </div>
                <div className="side-stack">
                    <div className="card pad group">
                        <div className="subhead">
                            <h3>Bought through</h3>
                            <span className="meta">{maker.via.length}</span>
                        </div>
                        <div className="halls">
                            {maker.via.map((v) => (
                                <div key={v.supplier} className="hall-row via-row">
                                    <div className="hall-info">
                                        <div className="text-body-md">{v.supplier}</div>
                                        <div className="bar">
                                            <span style={{ width: `${(v.spend / maxVia) * 100}%` }} />
                                        </div>
                                    </div>
                                    <b className="num">{money(v.spend)}</b>
                                </div>
                            ))}
                        </div>
                    </div>
                    <OpenerCard
                        news={p.news}
                        onRefresh={p.loadNews}
                        facts={
                            <>
                                Their parts carry <b>{money(maker.spend)}</b> of {p.projectName}, across {maker.lines} lines.
                            </>
                        }
                    />
                    <Headlines news={p.news} name={maker.supplier} />
                </div>
            </div>
        </section>
    );
}
