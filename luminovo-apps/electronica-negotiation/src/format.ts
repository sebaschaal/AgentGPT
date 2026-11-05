let currency = 'EUR';
export const setCurrency = (c: string | null | undefined) => {
    if (c) currency = c;
};

export function money(v: number, opts: { compact?: boolean; cur?: string } = {}) {
    const c = opts.cur ?? currency;
    const compact = opts.compact ?? Math.abs(v) >= 10000;
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: c,
            notation: compact ? 'compact' : 'standard',
            maximumFractionDigits: compact ? 1 : Math.abs(v) < 10 ? 2 : 0,
        }).format(v);
    } catch {
        return `${c} ${Math.round(v).toLocaleString('en-US')}`;
    }
}

export function unit(v: number, cur?: string) {
    const c = cur ?? currency;
    const digits = v < 0.01 ? 5 : v < 1 ? 4 : 2;
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: digits, minimumFractionDigits: 2 }).format(v);
    } catch {
        return `${c} ${v.toFixed(digits)}`;
    }
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const signedPct = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(digits)}%`;
export const qty = (v: number) => new Intl.NumberFormat('en-US', { notation: v >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v);

export function ago(iso: string | null) {
    if (!iso) return '';
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function initials(name: string) {
    const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}
