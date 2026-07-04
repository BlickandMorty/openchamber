// EPISTEMOS (engine-reactive model picker): listConfiguredProviders is the goose
// model control's data source — it filters goose's /config/providers to the
// is_configured ones and maps each to {name, displayName, defaultModel, models}
// from its metadata. Lock the transform (field names verified vs live goosed:
// name, is_configured, metadata.display_name/default_model/known_models[].name).
import { describe, expect, it, vi, beforeEach } from 'vitest';

const providersFixture = [
    {
        name: 'cursor-agent',
        is_configured: true,
        provider_type: 'cli',
        metadata: {
            display_name: 'Cursor Agent',
            default_model: 'auto',
            known_models: [{ name: 'auto' }, { name: 'composer-2' }],
        },
    },
    // is_configured false → must be dropped
    { name: 'openai', is_configured: false, metadata: { display_name: 'OpenAI', default_model: 'gpt', known_models: [] } },
    // missing metadata → displayName falls back to name; defaultModel '' ; models []
    { name: 'local', is_configured: true },
];

const runtimeFetchMock = vi.fn((path?: string) =>
    Promise.resolve(
        new Response(
            JSON.stringify(typeof path === 'string' && path.includes('/config/providers') ? providersFixture : {}),
            { status: 200 },
        ),
    ),
);
vi.mock('@/lib/runtime-fetch', () => ({
    runtimeFetch: (...args: unknown[]) => runtimeFetchMock(...(args as [string])),
}));

import { gooseEngineClient } from '@/epistemos/gooseClient';

describe('listConfiguredProviders', () => {
    beforeEach(() => runtimeFetchMock.mockClear());

    it('keeps only is_configured providers and maps their metadata', async () => {
        const result = await gooseEngineClient.listConfiguredProviders();
        expect(result).toEqual([
            { name: 'cursor-agent', displayName: 'Cursor Agent', defaultModel: 'auto', models: ['auto', 'composer-2'] },
            { name: 'local', displayName: 'local', defaultModel: '', models: [] },
        ]);
        // openai (is_configured:false) dropped
        expect(result.find((p) => p.name === 'openai')).toBeUndefined();
    });

    it('returns [] on a non-array response (never throws to the picker)', async () => {
        runtimeFetchMock.mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 200 })));
        expect(await gooseEngineClient.listConfiguredProviders()).toEqual([]);
    });
});
