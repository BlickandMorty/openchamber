// EPISTEMOS (deep-hardening / GAP #11): goosed's AddExtensionRequest /
// RemoveExtensionRequest (goose-server/src/routes/agent.rs:101/107) have NO
// rename_all -> snake_case, and BOTH REQUIRE session_id. The adapter previously
// sent a raw config (no session_id) / {name} (no session_id) -> 422. Lock the
// corrected body shapes.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const runtimeFetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
vi.mock('@/lib/runtime-fetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));

import { gooseEngineClient } from '@/epistemos/gooseClient';

const bodyOf = (): Record<string, unknown> =>
    JSON.parse((runtimeFetchMock.mock.calls[0][1] as RequestInit).body as string);

describe('goose extension mutation bodies (GAP #11)', () => {
    beforeEach(() => runtimeFetchMock.mockClear());

    it('addExtension nests config under {session_id, config}', async () => {
        await gooseEngineClient.addExtension('sess-1', { type: 'builtin', name: 'developer' });
        expect(runtimeFetchMock.mock.calls[0][0]).toBe('/goose/agent/add_extension');
        expect(bodyOf()).toEqual({ session_id: 'sess-1', config: { type: 'builtin', name: 'developer' } });
    });

    it('removeExtension sends {name, session_id} (session_id required)', async () => {
        await gooseEngineClient.removeExtension('sess-2', 'developer');
        expect(runtimeFetchMock.mock.calls[0][0]).toBe('/goose/agent/remove_extension');
        expect(bodyOf()).toEqual({ name: 'developer', session_id: 'sess-2' });
    });
});
