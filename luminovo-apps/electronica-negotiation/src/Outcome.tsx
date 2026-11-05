import { useEffect, useMemo, useState } from 'react';
import { useNotify } from '@luminovo/widget-sdk';
import { CircleCheck, NotebookPen } from 'lucide-react';
import { call, describeError } from './api';
import { money } from './format';
import type { SupplierAnalysis } from './model';

type Outcome = 'agreed' | 'requote' | 'none';
type Scope = 'reach' | 'match' | 'held' | 'all';

interface Props {
    supplier: string;
    a: SupplierAnalysis;
    d: number;
}

// What was agreed at the stand goes back into Luminovo as a note on every sourcing line it covers,
// so the sourcing team sees it next to the offer, and nothing lives only in a notebook.
export function OutcomeCard({ supplier, a, d }: Props) {
    const notify = useNotify();
    const [outcome, setOutcome] = useState<Outcome>('agreed');
    const [move, setMove] = useState((d * 100).toFixed(1));
    const [typed, setTyped] = useState(false);
    // Follow the simulator's price move until the buyer types their own number.
    useEffect(() => {
        if (!typed) setMove((d * 100).toFixed(1));
    }, [d, typed]);
    const [scope, setScope] = useState<Scope>('reach');
    const [text, setText] = useState('');
    const [step, setStep] = useState<'edit' | 'confirm' | 'writing' | 'done'>('edit');
    const [error, setError] = useState<string | null>(null);
    const [written, setWritten] = useState(0);

    const moveNum = Math.max(0, Math.min(50, Number(move.replace(',', '.')) || 0));
    const scopes = useMemo(() => {
        const reach = a.contestable.filter((c) => c.move > 0 && c.move <= moveNum / 100 + 1e-9).map((c) => ({ id: c.line.id, value: c.award }));
        const match = a.matchAsks.map((h) => ({ id: h.line.id, value: h.award }));
        const held = a.held.map((h) => ({ id: h.line.id, value: h.award }));
        return {
            reach: { label: `Lines they win at −${moveNum.toFixed(1)}%`, lines: reach },
            match: { label: 'Lines to match a cheaper offer', lines: match },
            held: { label: 'Lines they hold', lines: held },
            all: { label: 'All their lines', lines: [...held, ...a.contestable.map((c) => ({ id: c.line.id, value: c.award }))] },
        };
    }, [a, moveNum]);
    const target = scopes[scope].lines;
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const what =
        outcome === 'agreed'
            ? `agreed −${moveNum.toFixed(1)}%${scope === 'match' ? ' to match the cheaper offer' : ''}.`
            : outcome === 'requote'
              ? `will requote${moveNum > 0 ? ` at −${moveNum.toFixed(1)}%` : ''}.`
              : 'no price move.';
    const note = `electronica 2026 · ${supplier} · ${date}: ${what}${text.trim() ? ` ${text.trim()}` : ''}`;

    async function write() {
        setStep('writing');
        setError(null);
        try {
            const r = await call<{ written: number }>('logOutcome', { lineIds: target.map((t) => t.id), note });
            setWritten(r.written);
            setStep('done');
            notify(`Note added to ${r.written} sourcing line${r.written === 1 ? '' : 's'}`);
        } catch (e) {
            setError(describeError(e));
            setStep('confirm');
        }
    }

    return (
        <div className="card pad outcome">
            <div className="card-head">
                <div className="left">
                    <div className="subhead">
                        <h3>Log what you agreed</h3>
                    </div>
                    <p className="text-body-md text-muted">Adds a dated note to each sourcing line it covers, so the deal is on the line when you are back at your desk.</p>
                </div>
                <NotebookPen className="outcome-icon" />
            </div>

            {step === 'done' ? (
                <div className="message good" role="status">
                    <CircleCheck />
                    <div className="content">
                        <span className="text">
                            Note added to {written} sourcing line{written === 1 ? '' : 's'}: “{note}”
                        </span>
                    </div>
                    <button className="btn btn-ghost btn-sm inline-action" onClick={() => setStep('edit')}>
                        Log another
                    </button>
                </div>
            ) : (
                <div className="outcome-form">
                    <div className="field">
                        <span className="label-sm">Outcome</span>
                        <div className="segmented" role="group" aria-label="Outcome">
                            <button aria-pressed={outcome === 'agreed'} onClick={() => setOutcome('agreed')}>
                                Agreed
                            </button>
                            <button aria-pressed={outcome === 'requote'} onClick={() => setOutcome('requote')}>
                                Will requote
                            </button>
                            <button aria-pressed={outcome === 'none'} onClick={() => setOutcome('none')}>
                                No move
                            </button>
                        </div>
                    </div>
                    <label className="field">
                        <span className="label-sm">Price move</span>
                        <span className="input outcome-move">
                            <span className="prefix">−</span>
                            <input value={move} onChange={(e) => (setTyped(true), setMove(e.target.value))} inputMode="decimal" aria-label="Price move in percent" disabled={outcome === 'none'} />
                            <span className="suffix">%</span>
                        </span>
                    </label>
                    <label className="field">
                        <span className="label-sm">Lines</span>
                        <select className="input" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                            {(Object.keys(scopes) as Scope[]).map((k) => (
                                <option key={k} value={k}>
                                    {scopes[k].label} ({scopes[k].lines.length})
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="field outcome-text">
                        <span className="label-sm">Note</span>
                        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Requote by Friday, contact Anna Weber" maxLength={240} />
                    </label>
                    <div className="outcome-preview">
                        <span className="label-sm">
                            Goes on {target.length} line{target.length === 1 ? '' : 's'} worth {money(target.reduce((s, t) => s + t.value, 0))}
                        </span>
                        <span className="text-body-md">{note}</span>
                    </div>
                    {error && <p className="error text-body-md">{error}</p>}
                    <div className="outcome-actions">
                        {step === 'edit' ? (
                            <button className="btn btn-primary" disabled={!target.length} onClick={() => setStep('confirm')}>
                                Add note to {target.length} line{target.length === 1 ? '' : 's'}
                            </button>
                        ) : (
                            <>
                                <span className="text-body-md">This writes to the sourcing scenario. Go ahead?</span>
                                <button className="btn btn-secondary" onClick={() => setStep('edit')} disabled={step === 'writing'}>
                                    Cancel
                                </button>
                                <button className="btn btn-primary" onClick={write} disabled={step === 'writing'} aria-busy={step === 'writing'}>
                                    {step === 'writing' ? 'Adding notes' : `Add note to ${target.length} lines`}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
