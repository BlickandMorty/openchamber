// EPISTEMOS (Plan 1-PRO §3/§8): the engine-dispatch seam is the single most
// safety-critical overlay — it wraps the opencodeClient singleton EVERY
// opencode user touches. The invariant under test: with no goose session in
// the adapter index, the wrapper is fully INERT (zero behavior change), and
// the per-conversation engine intent is a clean one-shot.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    engineForSession,
    getNextSessionEngine,
    setNextSessionEngine,
    wrapWithEngineDispatch,
} from '@/epistemos/engineDispatch';

describe('engineForSession (empty index = pure opencode)', () => {
    it('classifies unknown / null / undefined sessions as opencode', () => {
        expect(engineForSession(null)).toBe('opencode');
        expect(engineForSession(undefined)).toBe('opencode');
        expect(engineForSession('nonexistent-session')).toBe('opencode');
    });
});

describe('per-conversation engine intent (one-shot)', () => {
    beforeEach(() => setNextSessionEngine('opencode'));

    it('defaults to opencode', () => {
        expect(getNextSessionEngine()).toBe('opencode');
    });

    it('records a goose intent for the next draft', () => {
        setNextSessionEngine('goose');
        expect(getNextSessionEngine()).toBe('goose');
        setNextSessionEngine('opencode');
        expect(getNextSessionEngine()).toBe('opencode');
    });
});

describe('wrapWithEngineDispatch inertness (no goose sessions)', () => {
    const makeService = () => ({
        marker: 'service-identity',
        // A method NOT in the goose route table — must pass through verbatim.
        getConfig: vi.fn((key: string) => `config:${key}`),
        // A ROUTED method — but with an opencode session it must still
        // pass through to the original (index is empty here).
        abortSession: vi.fn((id: string) => `aborted:${id}`),
        deleteSession: vi.fn((id: string) => `deleted:${id}`),
        getDirectory: () => '/tmp/project',
    });

    it('passes non-routed methods through unchanged', () => {
        const service = makeService();
        const wrapped = wrapWithEngineDispatch(service);
        expect(wrapped.getConfig('theme')).toBe('config:theme');
        expect(service.getConfig).toHaveBeenCalledWith('theme');
    });

    it('passes routed methods through when the session is not goose', async () => {
        const service = makeService();
        const wrapped = wrapWithEngineDispatch(service);
        // Empty index => engineForSession('s1') === 'opencode' => passthrough.
        expect(await wrapped.abortSession('s1')).toBe('aborted:s1');
        expect(service.abortSession).toHaveBeenCalledWith('s1');
    });

    it('preserves non-function properties', () => {
        const service = makeService();
        const wrapped = wrapWithEngineDispatch(service);
        expect(wrapped.marker).toBe('service-identity');
    });

    it('keeps method identity stable (Proxy returns a callable per access)', () => {
        const service = makeService();
        const wrapped = wrapWithEngineDispatch(service);
        expect(typeof wrapped.abortSession).toBe('function');
        expect(typeof wrapped.getConfig).toBe('function');
    });
});
