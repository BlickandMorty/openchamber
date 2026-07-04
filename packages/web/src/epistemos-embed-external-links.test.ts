// EPISTEMOS (PRO-EXTLINK-1): lock the external-URL classifier that decides which
// window.open() calls get rerouted through a main-frame nav (so the native
// decider opens them in the system browser). External http(s) → reroute;
// loopback/same-origin/non-http → leave to native window.open.
import { describe, expect, it } from 'vitest';
import { isExternalHttpUrl } from '@/epistemos/embedExternalLinks';

const base = 'http://127.0.0.1:52345/';

describe('isExternalHttpUrl', () => {
    it('classifies real external http(s) as external (reroute)', () => {
        expect(isExternalHttpUrl('https://console.anthropic.com/oauth', base)).toBe(true);
        expect(isExternalHttpUrl('https://github.com/login/device', base)).toBe(true);
        expect(isExternalHttpUrl('http://example.com/docs', base)).toBe(true);
    });

    it('leaves loopback / same-origin http alone (native window.open)', () => {
        expect(isExternalHttpUrl('http://127.0.0.1:52345/api/x', base)).toBe(false);
        expect(isExternalHttpUrl('http://localhost:9999/', base)).toBe(false);
        expect(isExternalHttpUrl('http://[::1]:8080/', base)).toBe(false);
        expect(isExternalHttpUrl('/relative/path', base)).toBe(false); // resolves to loopback base
    });

    it('leaves non-http(s) schemes alone (mailto/blob/data/etc.)', () => {
        expect(isExternalHttpUrl('mailto:x@y.com', base)).toBe(false);
        expect(isExternalHttpUrl('blob:http://127.0.0.1/abc', base)).toBe(false);
        expect(isExternalHttpUrl('data:text/plain,hi', base)).toBe(false);
        expect(isExternalHttpUrl('about:blank', base)).toBe(false);
    });

    it('never throws on garbage input (returns false)', () => {
        expect(isExternalHttpUrl('', base)).toBe(false);
        expect(isExternalHttpUrl('::::not a url', base)).toBe(false);
    });
});
