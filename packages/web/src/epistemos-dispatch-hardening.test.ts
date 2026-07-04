// EPISTEMOS (deep-hardening 2026-07-04): lock two dispatch-seam hardening
// fixes — stable wrapped-method identity (memoized get trap) and the
// engine-intent TTL that stops a stale 'goose' intent from leaking to an
// unrelated createSession.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getNextSessionEngine,
    setNextSessionEngine,
    wrapWithEngineDispatch,
} from '@/epistemos/engineDispatch';

afterEach(() => {
    vi.useRealTimers();
    setNextSessionEngine('opencode');
});

describe('wrapWithEngineDispatch — stable method identity (#8)', () => {
    it('returns the same function reference across property reads', () => {
        const service = {
            marker: 1,
            // a routed method and an unrouted method
            abortSession: (_id: string) => 'aborted',
            getConfig: () => 'cfg',
        };
        const wrapped = wrapWithEngineDispatch(service);
        expect(wrapped.abortSession).toBe(wrapped.abortSession); // routed
        expect(wrapped.getConfig).toBe(wrapped.getConfig); // unrouted
        expect(wrapped.marker).toBe(1); // non-function passthrough
    });

    it('unrouted methods still execute against the target', () => {
        const service = { value: 7, read() { return this.value; } };
        const wrapped = wrapWithEngineDispatch(service);
        expect(wrapped.read()).toBe(7);
    });
});

describe('per-conversation engine intent TTL (#4)', () => {
    it('honors a fresh goose intent', () => {
        setNextSessionEngine('goose');
        expect(getNextSessionEngine()).toBe('goose');
    });

    it('reverts to opencode after the TTL so a stale intent cannot leak', () => {
        vi.useFakeTimers();
        setNextSessionEngine('goose');
        expect(getNextSessionEngine()).toBe('goose');
        vi.advanceTimersByTime(31_000); // > 30s TTL
        expect(getNextSessionEngine()).toBe('opencode');
    });
});
