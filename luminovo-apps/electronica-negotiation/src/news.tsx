import { useMemo } from 'react';
import { useOpenExternal } from '@luminovo/widget-sdk';
import { Newspaper } from 'lucide-react';
import { ago } from './format';

export interface NewsState {
    loading: boolean;
    error?: string;
    items?: { title: string; url: string; source: string; date: string | null; snippet: string }[];
    via?: string | null;
    summary?: { ticker?: { index: number; takeaway: string; tone: string }[]; opener?: string; hook?: string; error?: string; hint?: string } | null;
}

export function NewsTicker({ news }: { news: NewsState | undefined }) {
    const openExternal = useOpenExternal();
    const ticker = useMemo(() => {
        const items = news?.items ?? [];
        const notes = new Map((news?.summary?.ticker ?? []).map((t) => [t.index, t]));
        return items.slice(0, 8).map((n, i) => ({ ...n, note: notes.get(i) }));
    }, [news]);
    return (
        <div className="ticker" aria-live="polite">
            <span className="ticker-tag">
                <Newspaper />
                {news?.loading ? 'Reading the news' : news?.via ? `Live from ${news.via}` : 'News'}
            </span>
            <div className="ticker-track">
                {ticker.length ? (
                    <div className="ticker-move" style={{ animationDuration: `${Math.max(30, ticker.length * 9)}s` }}>
                        {[...ticker, ...ticker].map((t, i) => (
                            <button key={i} className="ticker-item" onClick={() => t.url && openExternal(t.url)}>
                                <i className={`tone tone--${t.note?.tone ?? 'neutral'}`} />
                                <b>{t.source || 'News'}</b> {t.title}
                                {t.note && <em> · {t.note.takeaway}</em>}
                                <span className="ticker-date">{ago(t.date)}</span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <span className="ticker-empty">{news?.loading ? 'Pulling recent headlines and summarizing them for your opener' : 'No recent headlines found'}</span>
                )}
            </div>
        </div>
    );
}

export function OpenerCard({ news, onRefresh, facts }: { news: NewsState | undefined; onRefresh: () => void; facts: React.ReactNode }) {
    return (
        <div className="card pad group opener-card">
            <div className="subhead">
                <h3>Open with</h3>
                <button className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={news?.loading}>
                    Refresh
                </button>
            </div>
            {news?.loading && <div className="shimmer" />}
            {news?.error && <p className="error text-body-md">{news.error}</p>}
            {news?.summary?.opener && <blockquote>{news.summary.opener}</blockquote>}
            {news?.summary?.hook && (
                <p className="text-body-md">
                    <b>Bridge to business:</b> {news.summary.hook}
                </p>
            )}
            {news?.summary?.error && <p className="error text-body-md">{news.summary.hint ?? 'The AI summary is unavailable right now.'}</p>}
            <p className="text-body-md text-muted">{facts}</p>
        </div>
    );
}

export function Headlines({ news, name }: { news: NewsState | undefined; name: string }) {
    const openExternal = useOpenExternal();
    return (
        <div className="card pad">
            <div className="subhead">
                <h3>Headlines</h3>
                <span className="meta">{news?.via ?? ''}</span>
            </div>
            <div className="news-list">
                {(news?.items ?? []).slice(0, 8).map((n, i) => (
                    <button key={i} className="news-item" onClick={() => n.url && openExternal(n.url)}>
                        <span className="news-src">
                            {n.source} · {ago(n.date)}
                        </span>
                        <span className="news-title">{n.title}</span>
                        {n.snippet && <span>{n.snippet}</span>}
                    </button>
                ))}
                {!news?.loading && !(news?.items ?? []).length && <p className="text-body-md text-muted">No recent headlines found for {name}.</p>}
            </div>
        </div>
    );
}
