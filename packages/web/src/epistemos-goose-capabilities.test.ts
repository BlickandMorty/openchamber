// EPISTEMOS (Plan 1-PRO §7 Phase 4 / §8 goose-only row): lock the adapter's
// goose-reserved-capability methods to the CORRECTED goosed endpoints
// (/recipes/list, /schedule/list, /config/extensions — the bare paths 404).
// A future upstream goose bump that renames these is caught here instead of
// silently breaking the eventual badge-gated UI.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

vi.mock('@/lib/runtime-fetch', () => ({
    runtimeFetch: (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return Promise.resolve(
            new Response(JSON.stringify({ manifests: [], jobs: [], extensions: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
    },
}));

const importClient = async () => (await import('@/epistemos/gooseClient')).gooseEngineClient;

beforeEach(() => {
    fetchCalls.length = 0;
});
afterEach(() => {
    vi.clearAllMocks();
});

describe('goose reserved-capability adapter methods', () => {
    it('listExtensions -> GET /goose/config/extensions', async () => {
        const client = await importClient();
        await client.listExtensions();
        expect(fetchCalls.some((c) => c.url === '/goose/config/extensions')).toBe(true);
    });

    it('listRecipes -> /goose/recipes/list (NOT bare /recipes)', async () => {
        const client = await importClient();
        await client.listRecipes();
        expect(fetchCalls.some((c) => c.url === '/goose/recipes/list')).toBe(true);
        expect(fetchCalls.some((c) => c.url === '/goose/recipes')).toBe(false);
    });

    it('listSchedules -> /goose/schedule/list (NOT bare /schedule)', async () => {
        const client = await importClient();
        await client.listSchedules();
        expect(fetchCalls.some((c) => c.url === '/goose/schedule/list')).toBe(true);
        expect(fetchCalls.some((c) => c.url === '/goose/schedule')).toBe(false);
    });

    it('addExtension / removeExtension -> the agent extension routes', async () => {
        const client = await importClient();
        await client.addExtension({ name: 'x', type: 'builtin' });
        await client.removeExtension('x');
        expect(fetchCalls.some((c) => c.url === '/goose/agent/add_extension' && c.init?.method === 'POST')).toBe(true);
        expect(fetchCalls.some((c) => c.url === '/goose/agent/remove_extension' && c.init?.method === 'POST')).toBe(true);
    });

    it('runScheduleNow -> /goose/schedule/{id}/run_now (id encoded)', async () => {
        const client = await importClient();
        await client.runScheduleNow('job a/b');
        expect(fetchCalls.some((c) => c.url === '/goose/schedule/job%20a%2Fb/run_now' && c.init?.method === 'POST')).toBe(true);
    });
});
