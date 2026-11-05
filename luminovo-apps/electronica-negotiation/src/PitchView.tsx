import { useMemo } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { ConcessionChart } from './charts';
import { money, pct, qty, signedPct, unit } from './format';
import { curve, simulate, sweetSpot, type Mode, type SupplierAnalysis } from './model';

interface Props {
    supplier: string;
    projectName: string;
    a: SupplierAnalysis;
    mode: Mode;
    d: number;
    onMode: (m: Mode) => void;
    onMove: (d: number) => void;
    onClose: () => void;
}

// Blockers in words a supplier can act on; the internal wording stays in the buyer's view.
function forSupplier(blocker: string | null) {
    if (!blocker) return 'not awarded yet';
    const lead = blocker.match(/^lead time (\d+) vs (\d+) days$/);
    if (lead) return `your lead time is ${lead[1]} days, this line needs ${lead[2]}`;
    if (blocker === 'lead time unknown') return 'no confirmed lead time from you';
    if (blocker === 'long lead time') return 'your lead time is too long';
    if (blocker === 'not an approved supplier') return 'you are not approved for this part yet';
    return 'our supplier preferences for this project';
}

// The screen a buyer turns toward the supplier at the stand. It shows their own position and the upside of a
// price move, and never a competitor's name or price: only the price that would win each line.
export function PitchView({ supplier, projectName, a, mode, d, onMode, onMove, onClose }: Props) {
    const points = useMemo(() => curve(a, mode), [a, mode]);
    const sweet = useMemo(() => sweetSpot(points, mode), [points, mode]);
    const sim = simulate(a, d, mode);
    const up = a.heldVolume ? sim.volume / a.heldVolume - 1 : 0;
    const close = a.contestable.filter((c) => c.move > 0 && c.move <= 0.25).slice(0, 12);
    const blocked = a.contestable.filter((c) => c.move <= 0).sort((x, y) => y.award - x.award).slice(0, 6);
    const reachable = close.filter((c) => c.move <= d + 1e-9);

    return (
        <section className="pitch" aria-label={`Presentation for ${supplier}`}>
            <header className="pitch-head">
                <div>
                    <div className="pitch-eyebrow">{projectName}</div>
                    <h2>Your business with us, {supplier}</h2>
                </div>
                <button className="btn btn-secondary" onClick={onClose}>
                    <X />
                    Exit presentation
                </button>
            </header>

            <div className="pitch-hero">
                <div className="pitch-num">
                    <span className="label">Today</span>
                    <span className="big">{money(a.heldVolume)}</span>
                    <span className="sub">{a.held.length} lines awarded to you</span>
                </div>
                <ArrowRight className="pitch-arrow" />
                <div className="pitch-num pitch-num--after">
                    <span className="label">If you move {pct(d, 1)}</span>
                    <span className="big">{money(sim.volume)}</span>
                    <span className="sub">
                        {sim.lines} lines · <b>{signedPct(up, 0)} award volume</b>
                    </span>
                </div>
            </div>

            <div className="pitch-chart">
                <div className="pitch-chart-head">
                    <span>What a price move earns you, if we award every line where you become the best offer</span>
                    <div className="segmented" role="group" aria-label="Where the price move applies">
                        <button aria-pressed={mode === 'across'} onClick={() => onMode('across')}>
                            All lines
                        </button>
                        <button aria-pressed={mode === 'targeted'} onClick={() => onMode('targeted')}>
                            Only new lines
                        </button>
                    </div>
                </div>
                <ConcessionChart points={points} d={d} onChange={onMove} sweet={sweet} max={0.3} sweetLabel={mode === 'across' ? 'Best net for you' : 'Biggest jump'} />
                <input className="slider" type="range" min={0} max={0.3} step={0.0025} value={d} onChange={(e) => onMove(Number(e.target.value))} aria-label="Price move" />
                <div className="pitch-legend">
                    <span>
                        <i className="lg-win" />
                        Volume you win
                    </span>
                    {mode === 'across' && (
                        <span>
                            <i className="lg-give" />
                            Price given back on lines you already have
                        </span>
                    )}
                    <span>
                        <i className="lg-net" />
                        Net change for you
                    </span>
                </div>
            </div>

            <div className="pitch-cols">
                <div className="pitch-card">
                    <div className="subhead">
                        <h3>Lines within reach</h3>
                        <span className="meta">
                            {reachable.length} of {close.length} at −{pct(d, 1)}
                        </span>
                    </div>
                    <table className="table pitch-table">
                        <thead>
                            <tr>
                                <th>Part</th>
                                <th className="num">Qty</th>
                                <th className="num">Your price</th>
                                <th className="num">Price that wins</th>
                                <th className="num">Volume</th>
                            </tr>
                        </thead>
                        <tbody>
                            {close.map((c) => (
                                <tr key={c.line.id} className={c.move <= d + 1e-9 ? 'won' : ''}>
                                    <td>
                                        <div className="text-label-md">{c.line.mpn}</div>
                                        <div className="text-body-sm text-subtle">{c.line.manufacturer}</div>
                                    </td>
                                    <td className="num">{qty(c.line.qty)}</td>
                                    <td className="num">{unit(c.theirs.unit)}</td>
                                    <td className="num">
                                        <b>≤ {unit(c.theirs.unit * (1 - c.move - 0.005))}</b>
                                        <div className="text-body-sm text-subtle">−{pct(c.move, 1)}</div>
                                    </td>
                                    <td className="num">{money(c.award)}</td>
                                </tr>
                            ))}
                            {!close.length && (
                                <tr>
                                    <td colSpan={5} className="text-body-md text-muted">
                                        No lost lines within 25% on this project.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {blocked.length > 0 && (
                    <div className="pitch-card">
                        <div className="subhead">
                            <h3>Already the best price, not yet awarded</h3>
                            <span className="meta">{money(blocked.reduce((s, c) => s + c.award, 0))}</span>
                        </div>
                        <p className="text-body-md text-muted" style={{ margin: '4px 0 8px' }}>
                            Your price wins these lines. Fix what holds them back and they are yours.
                        </p>
                        <ul className="pitch-blocked">
                            {blocked.map((c) => (
                                <li key={c.line.id}>
                                    <span className="text-label-md">{c.line.mpn}</span>
                                    <span className="text-body-sm text-muted">{forSupplier(c.blocker)}</span>
                                    <b>{money(c.award)}</b>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </section>
    );
}
