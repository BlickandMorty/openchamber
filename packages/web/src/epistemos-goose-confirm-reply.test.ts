// EPISTEMOS (deep-hardening / GAP #10): the tool-confirmation REPLY body must
// use camelCase `sessionId` — goosed's ConfirmToolActionRequest is
// #[serde(rename_all = "camelCase")] with session_id a REQUIRED field (no
// default), so a snake_case `session_id` key fails deserialization and the
// reply is dropped (user clicks Allow, the tool hangs). The `action` VALUES are
// snake_case (Permission enum, rename_all=snake_case). Lock both.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const runtimeFetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
vi.mock('@/lib/runtime-fetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...args),
}));

import { gooseEngineClient } from '@/epistemos/gooseClient';

describe('confirmToolAction reply body (GAP #10)', () => {
    beforeEach(() => runtimeFetchMock.mockClear());

    it('posts {id, action, sessionId} — camelCase sessionId, NOT session_id', async () => {
        await gooseEngineClient.confirmToolAction('sess-1', 'confirm-9', 'allow_once');
        expect(runtimeFetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = runtimeFetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/goose/action-required/tool-confirmation');
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ id: 'confirm-9', action: 'allow_once', sessionId: 'sess-1' });
        expect(body).not.toHaveProperty('session_id');
    });

    it('forwards each snake_case Permission action value verbatim', async () => {
        for (const action of ['always_allow', 'deny_once', 'always_deny', 'cancel'] as const) {
            runtimeFetchMock.mockClear();
            await gooseEngineClient.confirmToolAction('s', 'c', action);
            const body = JSON.parse((runtimeFetchMock.mock.calls[0][1] as RequestInit).body as string);
            expect(body.action).toBe(action);
        }
    });
});
