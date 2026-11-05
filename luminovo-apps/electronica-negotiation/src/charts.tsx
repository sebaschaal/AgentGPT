import { useRef } from 'react';
import { money, pct } from './format';
import type { SimPoint } from './model';

interface ConcessionProps {
    points: SimPoint[];
    d: number;
    onChange: (d: number) => void;
    sweet: SimPoint;
    base: number;
    max: number;
}

const W = 680;
const H = 280;
const PAD = { l: 64, r: 18, t: 18, b: 34 };

export function ConcessionChart({ points, d, onChange, sweet, base, max }: ConcessionProps) {
    const ref = useRef<SVGSVGElement>(null);
    const top = Math.max(base, ...points.map((p) => p.volume)) * 1.12 || 1;
    const x = (v: number) => PAD.l + (v / max) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
    const area = (get: (p: SimPoint) => [number, number]) => {
        const upper = points.map((p) => `${x(p.d)},${y(get(p)[1])}`);
        const lower = [...points].reverse().map((p) => `${x(p.d)},${y(get(p)[0])}`);
        return `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
    };
    const line = (get: (p: SimPoint) => number) => `M ${points.map((p) => `${x(p.d)},${y(get(p))}`).join(' L ')}`;
    const cur = points.reduce((a, p) => (Math.abs(p.d - d) < Math.abs(a.d - d) ? p : a), points[0]);
    const ticksX = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].filter((t) => t <= max + 1e-9);
    const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

    function onMove(e: React.PointerEvent) {
        if (e.buttons !== 1 && e.type !== 'pointerdown') return;
        const r = ref.current!.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        const v = Math.min(max, Math.max(0, ((px - PAD.l) / (W - PAD.l - PAD.r)) * max));
        onChange(Math.round(v * 400) / 400);
    }

    return (
        <svg
            ref={ref}
            className="chart concession"
            viewBox={`0 0 ${W} ${H}`}
            onPointerDown={onMove}
            onPointerMove={onMove}
            role="img"
            aria-label="Award volume by price concession"
        >
            {ticksY.map((t, i) => (
                <g key={i}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
                    <text x={PAD.l - 8} y={y(t) + 4} className="axis" textAnchor="end">
                        {money(t, { compact: true })}
                    </text>
                </g>
            ))}
            {ticksX.map((t) => (
                <text key={t} x={x(t)} y={H - 10} className="axis" textAnchor="middle">
                    {t === 0 ? 'today' : `−${pct(t)}`}
                </text>
            ))}
            <path d={area((p) => [0, p.heldAfter])} className="area-held" />
            <path d={area((p) => [p.heldAfter, p.volume])} className="area-gained" />
            <path d={line((p) => p.volume)} className="line-volume" />
            <line x1={PAD.l} x2={W - PAD.r} y1={y(base)} y2={y(base)} className="line-base" />
            <text x={W - PAD.r} y={y(base) - 6} className="label-base" textAnchor="end">
                Today {money(base)}
            </text>
            {sweet.d > 0 && sweet.net > 0 && (
                <g>
                    <line x1={x(sweet.d)} x2={x(sweet.d)} y1={PAD.t} y2={H - PAD.b} className="line-sweet" />
                    <text x={x(sweet.d) + 6} y={PAD.t + 12} className="label-sweet">
                        Best for them: −{pct(sweet.d, 1)}
                    </text>
                </g>
            )}
            <line x1={x(cur.d)} x2={x(cur.d)} y1={PAD.t} y2={H - PAD.b} className="line-cursor" />
            <circle cx={x(cur.d)} cy={y(cur.volume)} r={6} className="dot-cursor" />
        </svg>
    );
}

interface Bucket {
    id: string;
    label: string;
    count: number;
    volume: number;
}

export function GapBuckets({ buckets, active, onPick }: { buckets: Bucket[]; active: string | null; onPick: (id: string | null) => void }) {
    const max = Math.max(1, ...buckets.map((b) => b.volume));
    return (
        <div className="buckets">
            {buckets.map((b) => (
                <button
                    key={b.id}
                    className={`bucket bucket--${b.id}${active === b.id ? ' bucket--on' : ''}`}
                    onClick={() => onPick(active === b.id ? null : b.id)}
                    disabled={!b.count}
                >
                    <span className="bucket-label">{b.label}</span>
                    <span className="bucket-bar">
                        <span style={{ width: `${(b.volume / max) * 100}%` }} />
                    </span>
                    <span className="bucket-val">
                        {money(b.volume)}
                        <em>
                            {b.count} line{b.count === 1 ? '' : 's'}
                        </em>
                    </span>
                </button>
            ))}
        </div>
    );
}

export function MoveBar({ move, max = 0.3 }: { move: number; max?: number }) {
    const w = Math.min(1, Math.max(0, move) / max) * 100;
    const cls = move <= 0 ? 'blocked' : move <= 0.05 ? 'b5' : move <= 0.1 ? 'b10' : move <= 0.2 ? 'b20' : 'b99';
    return (
        <span className={`movebar movebar--${cls}`}>
            <span style={{ width: `${move <= 0 ? 100 : w}%` }} />
            <em>{move <= 0 ? 'cheapest' : `−${pct(move, 1)}`}</em>
        </span>
    );
}

export function Spark({ values, w = 120, h = 28 }: { values: number[]; w?: number; h?: number }) {
    const max = Math.max(1, ...values);
    const bw = w / Math.max(1, values.length);
    return (
        <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            {values.map((v, i) => (
                <rect key={i} x={i * bw + 1} y={h - (v / max) * h} width={Math.max(1, bw - 2)} height={(v / max) * h} rx={1.5} />
            ))}
        </svg>
    );
}
