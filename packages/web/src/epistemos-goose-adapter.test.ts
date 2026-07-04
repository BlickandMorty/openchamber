// EPISTEMOS (Plan 1-PRO §3/§8): unit coverage for the High-risk streaming row —
// the whole-Message -> synthetic-delta synthesizer and the goose->SDK
// conversation mapping the transcript renders from.
import { describe, expect, it } from 'vitest';
import { GooseDeltaSynthesizer } from '@/epistemos/gooseClient';
import {
    gooseConversationToSdkMessages,
    goosePartDeltaEvent,
    gooseSessionToSdkSession,
    gooseTextPartId,
} from '@/epistemos/gooseSdkMapping';

describe('GooseDeltaSynthesizer', () => {
    const FB = 'fb-live';
    it('emits appended text across successive whole-message payloads', () => {
        const synth = new GooseDeltaSynthesizer();
        const first = synth.consume({ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hel' }] }, FB);
        expect(first).toEqual({ messageId: 'm1', appendedText: 'Hel', fullText: 'Hel' });
        const second = synth.consume({ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello wor' }] }, FB);
        expect(second).toEqual({ messageId: 'm1', appendedText: 'lo wor', fullText: 'Hello wor' });
        const third = synth.consume({ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }, FB);
        expect(third?.appendedText).toBe('ld');
    });

    it('treats rewritten content as a full update with no delta', () => {
        const synth = new GooseDeltaSynthesizer();
        synth.consume({ id: 'm1', content: [{ type: 'text', text: 'draft answer' }] }, FB);
        const rewrite = synth.consume({ id: 'm1', content: [{ type: 'text', text: 'final' }] }, FB);
        expect(rewrite).toEqual({ messageId: 'm1', appendedText: '', fullText: 'final' });
    });

    it('tracks messages independently; id-less payloads use the fallback id (NOT dropped)', () => {
        const synth = new GooseDeltaSynthesizer();
        // goosed sends id:null on the reply — must render via the fallback, not vanish.
        expect(synth.consume({ content: [{ type: 'text', text: 'no id' }] }, FB))
            .toEqual({ messageId: FB, appendedText: 'no id', fullText: 'no id' });
        synth.consume({ id: 'a', content: [{ type: 'text', text: 'A1' }] }, FB);
        synth.consume({ id: 'b', content: [{ type: 'text', text: 'B1' }] }, FB);
        const a2 = synth.consume({ id: 'a', content: [{ type: 'text', text: 'A1A2' }] }, FB);
        expect(a2?.appendedText).toBe('A2');
    });

    it('concatenates multiple text content items', () => {
        const synth = new GooseDeltaSynthesizer();
        const result = synth.consume({
            id: 'm1',
            content: [
                { type: 'text', text: 'part one ' },
                { type: 'toolConfirmationRequest', id: 'c1' },
                { type: 'text', text: 'part two' },
            ],
        }, FB);
        expect(result?.fullText).toBe('part one part two');
    });
});

describe('gooseConversationToSdkMessages', () => {
    it('maps roles, threads parentID, and synthesizes stable ids', () => {
        const rows = gooseConversationToSdkMessages('sess-1', '/tmp/proj', [
            { role: 'user', content: [{ type: 'text', text: 'hi' }] },
            { id: 'as-1', role: 'assistant', created: 1_700_000_000, content: [{ type: 'text', text: 'hello' }] },
            { role: 'user', content: [{ type: 'text', text: 'again' }] },
        ]);
        expect(rows).toHaveLength(3);
        expect(rows[0].info.role).toBe('user');
        expect(rows[0].info.id).toBe('sess-1-user-0');
        expect(rows[1].info.role).toBe('assistant');
        expect(rows[1].info.id).toBe('as-1');
        // Assistant threads to the PRECEDING user message.
        expect((rows[1].info as { parentID?: string }).parentID).toBe('sess-1-user-0');
        expect(rows[1].parts).toHaveLength(1);
        expect(rows[1].parts[0]).toMatchObject({
            type: 'text',
            text: 'hello',
            id: gooseTextPartId('as-1'),
            sessionID: 'sess-1',
            messageID: 'as-1',
        });
        // Assistant placeholders are honest zeros, engine-tagged.
        expect((rows[1].info as { providerID?: string }).providerID).toBe('goose');
        expect((rows[1].info as { cost?: number }).cost).toBe(0);
    });

    it('drops empty-text parts and tolerates a missing conversation', () => {
        expect(gooseConversationToSdkMessages('s', '/d', undefined)).toEqual([]);
        const rows = gooseConversationToSdkMessages('s', '/d', [{ role: 'assistant', content: [] }]);
        expect(rows[0].parts).toEqual([]);
    });
});

describe('gooseSessionToSdkSession / events', () => {
    it('produces a directory-grouped, engine-tagged session', () => {
        const session = gooseSessionToSdkSession(undefined, {
            id: 'gs1',
            title: 'my goose chat',
            workingDir: '/tmp/proj',
            createdAt: 1_000,
            updatedAt: 2_000,
        });
        expect(session).toMatchObject({
            id: 'gs1',
            projectID: 'goose:/tmp/proj',
            directory: '/tmp/proj',
            title: 'my goose chat',
            version: 'goose',
        });
        expect(session.metadata).toMatchObject({ epistemosEngine: 'goose' });
    });

    it('emits exact SDK delta payload shape', () => {
        const event = goosePartDeltaEvent('sess', 'msg', 'abc');
        expect(event.type).toBe('message.part.delta');
        expect(event.properties).toMatchObject({
            sessionID: 'sess',
            messageID: 'msg',
            partID: gooseTextPartId('msg'),
            field: 'text',
            delta: 'abc',
        });
    });
});
