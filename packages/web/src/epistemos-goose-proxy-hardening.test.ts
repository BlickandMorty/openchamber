// EPISTEMOS (deep-hardening 2026-07-04): lock the /goose proxy's two
// security-critical pure functions — the header allowlist (a secret-injecting
// boundary must not leak the UI's Cookie/Authorization downstream to goosed)
// and the loopback-origin CSRF defense.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — JS overlay module, no types needed for a black-box test.
import { buildUpstreamHeaders, isLoopbackOriginAllowed } from '../server/lib/goose/proxy.js';

describe('buildUpstreamHeaders (allowlist)', () => {
    it('forwards only the allowlisted headers and attaches OUR secret', () => {
        const out = buildUpstreamHeaders(
            {
                'content-type': 'application/json',
                accept: 'text/event-stream',
                'last-event-id': '42',
                // none of these may pass to goosed:
                cookie: 'session=secret',
                authorization: 'Bearer leak',
                'x-secret-key': 'attacker-supplied',
                'x-openchamber-ui-token': 'ui-auth',
                host: 'evil',
            },
            'OUR-SECRET',
        );
        expect(out['content-type']).toBe('application/json');
        expect(out.accept).toBe('text/event-stream');
        expect(out['last-event-id']).toBe('42');
        // Leak-prevention: none of the sensitive/unlisted headers survive.
        expect(out.cookie).toBeUndefined();
        expect(out.authorization).toBeUndefined();
        expect(out['x-openchamber-ui-token']).toBeUndefined();
        expect(out.host).toBeUndefined();
        // OUR secret wins; a client-supplied one can never reach goosed.
        expect(out['x-secret-key']).toBe('OUR-SECRET');
    });

    it('omits the secret header when no secret is configured', () => {
        const out = buildUpstreamHeaders({ 'content-type': 'application/json' }, '');
        expect(out['x-secret-key']).toBeUndefined();
    });
});

describe('isLoopbackOriginAllowed (CSRF defense)', () => {
    const req = (origin?: string) => ({ headers: origin === undefined ? {} : { origin } });

    it('allows a request with NO Origin (same-origin GET)', () => {
        expect(isLoopbackOriginAllowed(req())).toBe(true);
    });

    it('allows loopback origins', () => {
        expect(isLoopbackOriginAllowed(req('http://127.0.0.1:52160'))).toBe(true);
        expect(isLoopbackOriginAllowed(req('http://localhost:3000'))).toBe(true);
        expect(isLoopbackOriginAllowed(req('http://[::1]:8080'))).toBe(true);
    });

    it('rejects cross-origin (non-loopback) requests', () => {
        expect(isLoopbackOriginAllowed(req('https://evil.example.com'))).toBe(false);
        expect(isLoopbackOriginAllowed(req('http://10.0.0.5'))).toBe(false);
        expect(isLoopbackOriginAllowed(req('null'))).toBe(false);
        // A garbage Origin that won't parse is treated as hostile.
        expect(isLoopbackOriginAllowed(req('not a url'))).toBe(false);
    });
});
