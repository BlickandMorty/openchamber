// EPISTEMOS (deep-hardening / Plan §14.4): the proxy->goosed circuit breaker
// must be a RING BUFFER (not a sticky counter) and require N CONSECUTIVE
// successes to close from half-open (a partial recovery must not re-close it).
import { describe, expect, it } from 'vitest';
// @ts-expect-error — JS overlay module, black-box test.
import { createGooseCircuitBreaker } from '../server/lib/goose/proxy.js';

describe('goose circuit breaker', () => {
    it('stays closed under the trip threshold and allows requests', () => {
        const b = createGooseCircuitBreaker({ window: 20, tripThreshold: 10 });
        for (let i = 0; i < 9; i += 1) b.recordFailure();
        expect(b.state()).toBe('closed');
        expect(b.allowRequest()).toBe(true);
    });

    it('opens at the threshold and fast-fails until the cooldown', () => {
        let t = 1000;
        const b = createGooseCircuitBreaker({ tripThreshold: 10, cooldownMs: 5000, now: () => t });
        for (let i = 0; i < 10; i += 1) b.recordFailure();
        expect(b.state()).toBe('open');
        expect(b.allowRequest()).toBe(false); // fast-fail
        t += 4999;
        expect(b.allowRequest()).toBe(false); // still cooling down
        t += 2;
        expect(b.allowRequest()).toBe(true); // half-open probe allowed
        expect(b.state()).toBe('half-open');
    });

    it('needs N consecutive successes to close; one failed probe re-opens', () => {
        let t = 0;
        const b = createGooseCircuitBreaker({ tripThreshold: 3, cooldownMs: 100, successesToClose: 2, now: () => t });
        b.recordFailure(); b.recordFailure(); b.recordFailure();
        expect(b.state()).toBe('open');
        t += 101;
        expect(b.allowRequest()).toBe(true); // -> half-open
        b.recordSuccess(); // 1 of 2
        expect(b.state()).toBe('half-open');
        b.recordFailure(); // probe failed -> re-open, NOT closed
        expect(b.state()).toBe('open');
        t += 101;
        expect(b.allowRequest()).toBe(true); // half-open again
        b.recordSuccess();
        b.recordSuccess(); // 2 consecutive -> close
        expect(b.state()).toBe('closed');
        expect(b.allowRequest()).toBe(true);
    });

    it('is a ring buffer — old failures age out so a slow trickle never trips', () => {
        const b = createGooseCircuitBreaker({ window: 10, tripThreshold: 6 });
        // 5 failures then 10 successes push the failures out of the window.
        for (let i = 0; i < 5; i += 1) b.recordFailure();
        for (let i = 0; i < 10; i += 1) b.recordSuccess();
        for (let i = 0; i < 5; i += 1) b.recordFailure();
        // Only the last 5 failures are in the 10-wide window (<6) -> still closed.
        expect(b.state()).toBe('closed');
    });
});
