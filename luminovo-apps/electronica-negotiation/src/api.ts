const APP = 'electronica-negotiation';

export class CallError extends Error {
    constructor(public code: string, public status: number, public hint?: string) {
        super(hint || code);
    }
}

export async function call<T = any>(handler: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`/apps/_app/${APP}/call/${handler}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        });
    } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new CallError('network', 0, 'The request did not go through. Check your connection and try again.');
    }
    const text = await res.text();
    let body: any = {};
    try {
        body = text ? JSON.parse(text) : {};
    } catch {}
    if (res.status === 401) throw new CallError('session_expired', 401, 'Your session expired. Reload the page.');
    if (!res.ok) throw new CallError(body.error ?? 'request_failed', res.status, body.hint);
    return body as T;
}

export const describeError = (e: unknown) => {
    if (e instanceof CallError) {
        if (e.code === 'cap_exhausted') return e.hint ?? 'The AI budget for this month is used up.';
        if (e.code === 'rate_limited') return 'Luminovo is busy. Try again in a minute.';
        return e.hint ?? `Something went wrong (${e.code}).`;
    }
    return (e as Error)?.message ?? 'Something went wrong.';
};
