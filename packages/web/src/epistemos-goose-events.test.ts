// EPISTEMOS (Plan 1-PRO §2/§3/§8): the synthetic events the goose adapter
// feeds into the donor pipeline MUST match the SDK Event payload shapes that
// `normalizeEventType` (event-pipeline.ts) consumes — message.updated,
// message.part.updated, session.idle, session.updated. A drift here (e.g. an
// upstream SDK bump renaming a property) silently breaks goose streaming, so
// these lock the contract at the shape level.
import { describe, expect, it } from 'vitest';
import {
    gooseAssistantMessageInfo,
    gooseMessageUpdatedEvent,
    goosePartUpdatedEvent,
    gooseSessionIdleEvent,
    gooseSessionToSdkSession,
    gooseSessionUpdatedEvent,
    gooseTextPart,
} from '@/epistemos/gooseSdkMapping';

describe('synthetic pipeline event shapes', () => {
    it('message.updated carries {sessionID, info}', () => {
        const info = gooseAssistantMessageInfo('sess', 'msg', '/tmp');
        const event = gooseMessageUpdatedEvent('sess', info);
        expect(event.type).toBe('message.updated');
        expect(event.properties).toMatchObject({ sessionID: 'sess', info });
        expect(typeof event.id).toBe('string');
    });

    it('message.part.updated carries {sessionID, part, time}', () => {
        const part = gooseTextPart('sess', 'msg', 'hello');
        const event = goosePartUpdatedEvent('sess', part);
        expect(event.type).toBe('message.part.updated');
        const props = event.properties as { sessionID: string; part: unknown; time: number };
        expect(props.sessionID).toBe('sess');
        expect(props.part).toBe(part);
        expect(typeof props.time).toBe('number');
    });

    it('session.idle carries just {sessionID}', () => {
        const event = gooseSessionIdleEvent('sess');
        expect(event.type).toBe('session.idle');
        expect(event.properties).toEqual({ sessionID: 'sess' });
    });

    it('session.updated carries {sessionID, info}', () => {
        const info = gooseSessionToSdkSession(undefined, {
            id: 'gs1',
            title: 't',
            workingDir: '/d',
            createdAt: 1,
            updatedAt: 2,
        });
        const event = gooseSessionUpdatedEvent('gs1', info);
        expect(event.type).toBe('session.updated');
        expect(event.properties).toMatchObject({ sessionID: 'gs1', info });
    });

    it('every synthetic event has a unique id', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 50; i += 1) {
            ids.add(gooseSessionIdleEvent('s').id);
        }
        expect(ids.size).toBe(50);
    });
});
