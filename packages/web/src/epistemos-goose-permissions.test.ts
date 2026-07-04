// EPISTEMOS (Plan 1-PRO §3/§8): the permissions row is rated High-risk (goose
// shim). These lock the goose->donor permission-event mapping: a goosed
// toolConfirmationRequest must surface through the donor's permission.asked
// path, and a reply must round-trip through permission.replied.
import { describe, expect, it } from 'vitest';
import {
    goosePermissionAskedEvent,
    goosePermissionRepliedEvent,
} from '@/epistemos/gooseSdkMapping';

describe('goosePermissionAskedEvent', () => {
    it('maps a tool-confirmation request to the donor permission.asked shape', () => {
        const event = goosePermissionAskedEvent('sess-1', {
            id: 'confirm-42',
            toolName: 'shell',
            arguments: { command: 'ls -la' },
            prompt: 'Run a shell command?',
        });
        expect(event.type).toBe('permission.asked');
        const props = event.properties as {
            id: string;
            sessionID: string;
            permission: string;
            patterns: string[];
            always: string[];
            metadata: Record<string, unknown>;
        };
        // The confirmation id becomes the permission request id (so the reply
        // routes back to the same goosed confirmation).
        expect(props.id).toBe('confirm-42');
        expect(props.sessionID).toBe('sess-1');
        expect(props.permission).toBe('shell');
        expect(props.patterns).toEqual([]);
        expect(props.always).toEqual([]);
        expect(props.metadata.epistemosEngine).toBe('goose');
        expect(props.metadata.prompt).toBe('Run a shell command?');
        expect(props.metadata.arguments).toEqual({ command: 'ls -la' });
    });

    it('falls back to a generic permission label and omits absent optional fields', () => {
        const event = goosePermissionAskedEvent('s', { id: 'c1' });
        const props = event.properties as { permission: string; metadata: Record<string, unknown> };
        expect(props.permission).toBe('tool');
        expect('prompt' in props.metadata).toBe(false);
        expect('arguments' in props.metadata).toBe(false);
    });
});

describe('goosePermissionRepliedEvent', () => {
    it('round-trips each reply decision', () => {
        for (const reply of ['once', 'always', 'reject'] as const) {
            const event = goosePermissionRepliedEvent('sess-1', 'confirm-42', reply);
            expect(event.type).toBe('permission.replied');
            expect(event.properties).toMatchObject({
                sessionID: 'sess-1',
                requestID: 'confirm-42',
                reply,
            });
        }
    });
});
