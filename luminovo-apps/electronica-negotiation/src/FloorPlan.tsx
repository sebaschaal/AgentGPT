import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Map as MapIcon, LayoutGrid, Play } from 'lucide-react';
import { ENTRANCES, FAIR, HALLS, boothPoint, hallById } from './fair';
import { money, initials } from './format';
import type { HallSpend, SupplierSpend } from './model';

export interface RouteStop {
    supplier: string;
    objective?: string;
    ask?: string;
    minutes?: number;
}

interface Camera {
    rx: number;
    rz: number;
    s: number;
    cx: number;
    cy: number;
}

const FLOOR_W = 1000;
const FLOOR_H = 520;
const START: Camera = { rx: 72, rz: -38, s: 0.42, cx: 520, cy: 300 };
const OVERVIEW: Camera = { rx: 54, rz: -16, s: 0.9, cx: 505, cy: 268 };
const TOP: Camera = { rx: 0, rz: 0, s: 0.86, cx: 505, cy: 262 };

interface Props {
    suppliers: SupplierSpend[];
    halls: HallSpend[];
    total: number;
    selected: string | null;
    onSelect: (supplier: string | null) => void;
    route: RouteStop[] | null;
    loading?: boolean;
}

export function FloorPlan({ suppliers, halls, total, selected, onSelect, route, loading }: Props) {
    const [cam, setCam] = useState<Camera>(START);
    const [view, setView] = useState<'overview' | 'top' | 'focus' | 'tour'>('overview');
    const [hoverHall, setHoverHall] = useState<string | null>(null);
    const [tourIdx, setTourIdx] = useState<number | null>(null);
    const tourTimer = useRef<number | null>(null);

    // Flyover on first paint, and again whenever the project changes.
    const signature = suppliers.map((s) => s.supplier).join('|');
    useEffect(() => {
        setCam(START);
        const t = window.setTimeout(() => setCam(OVERVIEW), 80);
        setView('overview');
        return () => window.clearTimeout(t);
    }, [signature]);

    const onFloor = useMemo(() => suppliers.filter((s) => s.booth), [suppliers]);
    const maxSpend = Math.max(1, ...onFloor.map((s) => s.spend));
    const maxHall = Math.max(1, ...halls.map((h) => h.spend));
    const hallMap = new Map(halls.map((h) => [h.hall, h]));

    // Several suppliers can share a stand (Avnet City, Mouser and TTI): fan them out.
    const placed = useMemo(() => {
        const seen = new Map<string, number>();
        return onFloor.map((s) => {
            const p = boothPoint(s.booth!);
            const k = `${s.booth!.hall}.${s.booth!.stand}`;
            const n = seen.get(k) ?? 0;
            seen.set(k, n + 1);
            return { s, x: p.x + n * 24, y: p.y + n * 8 };
        });
    }, [onFloor]);
    const pointOf = (supplier: string) => placed.find((p) => p.s.supplier === supplier);

    useEffect(() => {
        if (!selected) return;
        const p = pointOf(selected);
        if (p) {
            setCam({ rx: 50, rz: -12, s: 1.85, cx: p.x, cy: p.y });
            setView('focus');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);

    const routePts = useMemo(() => {
        if (!route?.length) return [];
        const west = ENTRANCES[0];
        const pts = [{ x: west.x, y: west.y, label: 'Start' }];
        route.forEach((r, i) => {
            const p = pointOf(r.supplier);
            if (p) pts.push({ x: p.x + 7, y: p.y + 7, label: String(i + 1) });
        });
        return pts;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route, placed]);

    // Walk the aisles: go along the mall between rows rather than through halls.
    const routePath = useMemo(() => {
        if (routePts.length < 2) return '';
        const malls = [189, 331];
        const nearestMall = (y: number) => malls.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
        let d = `M ${routePts[0].x} ${routePts[0].y}`;
        for (let i = 1; i < routePts.length; i++) {
            const a = routePts[i - 1];
            const b = routePts[i];
            const m1 = nearestMall(a.y);
            const m2 = nearestMall(b.y);
            d += ` L ${a.x} ${m1} L ${b.x} ${m1}`;
            if (m2 !== m1) d += ` L ${b.x} ${m2}`;
            d += ` L ${b.x} ${b.y}`;
        }
        return d;
    }, [routePts]);

    function stopTour() {
        if (tourTimer.current) window.clearTimeout(tourTimer.current);
        tourTimer.current = null;
        setTourIdx(null);
    }

    function playTour() {
        if (!route?.length) return;
        stopTour();
        setView('tour');
        const stops = route.filter((r) => pointOf(r.supplier));
        let i = 0;
        const step = () => {
            if (i >= stops.length) {
                setTourIdx(null);
                setCam(OVERVIEW);
                setView('overview');
                return;
            }
            const p = pointOf(stops[i].supplier)!;
            setTourIdx(route.indexOf(stops[i]));
            setCam({ rx: 52, rz: -14 + (i % 2 ? 8 : -6), s: 1.7, cx: p.x, cy: p.y });
            i++;
            tourTimer.current = window.setTimeout(step, 3200);
        };
        setCam({ rx: 60, rz: -24, s: 1.1, cx: ENTRANCES[0].x + 120, cy: ENTRANCES[0].y });
        tourTimer.current = window.setTimeout(step, 1300);
    }
    useEffect(() => stopTour, []);

    const floorTransform = `translate(-50%, -50%) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) scale(${cam.s}) translate(${FLOOR_W / 2 - cam.cx}px, ${FLOOR_H / 2 - cam.cy}px)`;
    const billboard = `rotateZ(${-cam.rz}deg) rotateX(${-cam.rx}deg)`;
    const tourStop = tourIdx !== null && route ? route[tourIdx] : null;
    const daysToFair = Math.ceil((new Date(FAIR.start).getTime() - Date.now()) / 86400000);
    const atFair = onFloor.reduce((s, x) => s + x.spend, 0);

    return (
        <div className="stage">
            <div className="stage-grid" />
            <div className="floor" style={{ transform: floorTransform, width: FLOOR_W, height: FLOOR_H }}>
                <div className="floor-ground" />
                {HALLS.map((h) => {
                    const hs = hallMap.get(h.id);
                    const heat = hs ? 0.25 + 0.75 * Math.sqrt(hs.spend / maxHall) : 0;
                    return (
                        <div
                            key={h.id}
                            className={`hall${hs ? ' hall--hot' : ''}${hoverHall === h.id ? ' hall--hover' : ''}`}
                            style={{ left: h.x, top: h.y, width: h.w, height: h.h, ['--heat' as any]: heat }}
                            onMouseEnter={() => setHoverHall(h.id)}
                            onMouseLeave={() => setHoverHall(null)}
                        >
                            <span className="hall-id">{h.id}</span>
                            {hs && <span className="hall-spend">{money(hs.spend)}</span>}
                        </div>
                    );
                })}
                {ENTRANCES.map((e) => (
                    <div key={e.id} className="entrance" style={{ left: e.x, top: e.y }}>
                        <span>{e.label}</span>
                    </div>
                ))}
                <svg className="route" viewBox={`0 0 ${FLOOR_W} ${FLOOR_H}`} width={FLOOR_W} height={FLOOR_H}>
                    {routePath && (
                        <>
                            <path d={routePath} className="route-glow" />
                            <path d={routePath} className="route-line" />
                        </>
                    )}
                    {routePts.slice(1).map((p, i) => (
                        <g key={i} transform={`translate(${p.x}, ${p.y})`}>
                            <circle r={11} className={`route-stop${tourIdx === i ? ' route-stop--active' : ''}`} />
                            <text className="route-num" dy={4}>
                                {p.label}
                            </text>
                        </g>
                    ))}
                </svg>
                {placed.map(({ s, x, y }) => {
                    const rank = onFloor.indexOf(s);
                    const h = 16 + 150 * Math.sqrt(s.spend / maxSpend);
                    const isSel = selected === s.supplier;
                    const dim = selected && !isSel;
                    return (
                        <div
                            key={s.supplier}
                            className={`pillar${isSel ? ' pillar--sel' : ''}${dim ? ' pillar--dim' : ''}${s.booth!.confirmed ? '' : ' pillar--est'}`}
                            style={{ left: x, top: y }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(isSel ? null : s.supplier);
                            }}
                            title={`${s.supplier} · ${s.booth!.hall}.${s.booth!.stand} · ${money(s.spend)}`}
                        >
                            <div className="pillar-face pillar-front" style={{ height: h }} />
                            <div className="pillar-face pillar-side" style={{ height: h }} />
                            <div className="pillar-cap" style={{ transform: `translateZ(${h}px)` }} />
                            <div className="pillar-label" style={{ transform: `translateZ(${h + 8}px) ${billboard}` }}>
                                <span className="pillar-logo">{initials(s.supplier)}</span>
                                <span className={`pillar-text${rank < 5 || isSel ? '' : ' pillar-text--hidden'}`}>
                                    <b>{s.supplier}</b>
                                    <em>{money(s.spend)}</em>
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="hud hud-tl">
                {selected && pointOf(selected) ? (
                    <>
                        <div className="hud-eyebrow">
                            Hall {pointOf(selected)!.s.booth!.hall} · Stand {pointOf(selected)!.s.booth!.stand}
                            {pointOf(selected)!.s.booth!.confirmed ? '' : ' · earlier edition'}
                        </div>
                        <div className="hud-big">{selected}</div>
                        <div className="hud-sub">
                            {money(pointOf(selected)!.s.spend)} selected spend · {(pointOf(selected)!.s.share * 100).toFixed(1)}% of this project
                        </div>
                    </>
                ) : (
                    <>
                        <div className="hud-eyebrow">
                            {FAIR.name} · {FAIR.venue} · {FAIR.dates}
                        </div>
                        <div className="hud-big">{money(atFair)}</div>
                        <div className="hud-sub">
                            of {money(total)} selected spend sits with {onFloor.length} supplier{onFloor.length === 1 ? '' : 's'} on the floor
                        </div>
                    </>
                )}
            </div>
            <div className="hud hud-tr">
                {daysToFair > 0 && (
                    <span className="badge">
                        <CalendarClock size={12} />
                        Doors open in {daysToFair} day{daysToFair === 1 ? '' : 's'}
                    </span>
                )}
                <div className="cam-buttons">
                    <button className={view === 'overview' ? 'on' : ''} onClick={() => (stopTour(), onSelect(null), setCam(OVERVIEW), setView('overview'))}>
                        <MapIcon />
                        Overview
                    </button>
                    <button className={view === 'top' ? 'on' : ''} onClick={() => (stopTour(), setCam(TOP), setView('top'))}>
                        <LayoutGrid />
                        Hall plan
                    </button>
                    <button className={view === 'tour' ? 'on' : ''} disabled={!route?.length} onClick={() => (onSelect(null), playTour())}>
                        <Play />
                        Walk the route
                    </button>
                </div>
            </div>
            {hoverHall && (
                <div className="hud hud-hall">
                    <b>Hall {hoverHall}</b> · {hallById(hoverHall)?.topic}
                    {hallMap.get(hoverHall) && (
                        <div>
                            {hallMap
                                .get(hoverHall)!
                                .suppliers.map((s) => `${s.supplier} ${money(s.spend)}`)
                                .join(' · ')}
                        </div>
                    )}
                </div>
            )}
            {tourStop && (
                <div className="hud tour-card" key={tourIdx}>
                    <div className="tour-num">{tourIdx! + 1}</div>
                    <div>
                        <div className="tour-name">
                            {tourStop.supplier}
                            {pointOf(tourStop.supplier) && (
                                <span>
                                    {' '}
                                    · {pointOf(tourStop.supplier)!.s.booth!.hall}.{pointOf(tourStop.supplier)!.s.booth!.stand}
                                </span>
                            )}
                        </div>
                        {tourStop.objective && <div className="tour-obj">{tourStop.objective}</div>}
                        {tourStop.ask && <div className="tour-ask">Ask: {tourStop.ask}</div>}
                    </div>
                </div>
            )}
            <div className="hud hud-bl">
                <span className="legend-pillar" /> Selected spend in this project
                <span className="legend-est" /> Stand of an earlier edition
                <span className="legend-note">Schematic hall plan, not to scale</span>
            </div>
            {loading && <div className="stage-loading">Loading sourcing selection…</div>}
        </div>
    );
}
