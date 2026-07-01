/**
 * Reproduction test for issue #1956:
 * Push notification click unconditionally opens a new window
 * instead of focusing an existing client.
 *
 * Run: bun run test -- packages/web/src/sw.repro.test.ts
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Simulates the current (buggy) notificationclick handler from sw.ts lines 64-71.
 * Unconditionally calls openWindow even when a client already exists.
 * Takes clients object directly (in SW it's self.clients).
 */
function currentBuggyHandler(
  url: string,
  clients: {
    matchAll: (opts: { type: string; includeUncontrolled?: boolean }) => Promise<Array<{ url: string; focused: boolean; focus: () => Promise<void>; navigate: (url: string) => Promise<void> }>>;
    openWindow: (url: string) => Promise<Window | null>;
    claim?: () => Promise<void>;
  },
): Promise<void> {
  // This mirrors the exact logic from sw.ts lines 64-71:
  //   event.waitUntil(self.clients.openWindow(url));
  return Promise.resolve(clients.openWindow(url) as unknown as void);
}

/**
 * The expected fix: focus an existing client if available,
 * fall back to openWindow only if no client is found.
 * Also resolve relative URLs against self.location.origin.
 */
function expectedFixedHandler(
  url: string,
  clients: {
    matchAll: (opts: { type: string; includeUncontrolled?: boolean }) => Promise<Array<{ url: string; focused: boolean; focus: () => Promise<void>; navigate: (url: string) => Promise<void> }>>;
    openWindow: (url: string) => Promise<Window | null>;
  },
  locationOrigin: string,
): Promise<void> {
  return (async () => {
    // Resolve relative URLs against the SW's origin
    const resolvedUrl = url.startsWith('/') ? `${locationOrigin}${url}` : url;

    // Try to find an existing client and focus/navigate it
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url && !client.focused) {
        await client.focus();
        await client.navigate(resolvedUrl);
        return;
      }
    }

    // Fallback: open a new window
    await clients.openWindow(resolvedUrl);
  })();
}

describe('sw.ts notificationclick - issue #1956 reproduction', () => {
  // We'll use declare global to access mock self
  beforeAll(() => {
    // Set up a minimal self-like global for the buggy handler
    (globalThis as Record<string, unknown>).self = globalThis;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[BUG] current handler always calls openWindow even when a client exists', async () => {
    const openWindow = vi.fn().mockResolvedValue(null);
    const focusFn = vi.fn().mockResolvedValue(undefined);
    const navigateFn = vi.fn().mockResolvedValue(undefined);

    // Simulate an existing open client (the PWA)
    const mockClients = {
      matchAll: vi.fn().mockResolvedValue([
        { url: 'http://localhost:3001/', focused: false, focus: focusFn, navigate: navigateFn },
      ]),
      openWindow,
    };

    // The buggy handler doesn't look for existing clients at all
    await currentBuggyHandler('/?session=abc123', mockClients);

    // BUG: openWindow is called even though a client already exists
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith('/?session=abc123');

    // BUG: The existing client was never focused or navigated
    expect(focusFn).not.toHaveBeenCalled();
    expect(navigateFn).not.toHaveBeenCalled();
  });

  it('[EXPECTED] fixed handler focuses existing client instead of opening new window', async () => {
    const openWindow = vi.fn().mockResolvedValue(null);
    const focusFn = vi.fn().mockResolvedValue(undefined);
    const navigateFn = vi.fn().mockResolvedValue(undefined);

    const mockClients = {
      matchAll: vi.fn().mockResolvedValue([
        { url: 'http://localhost:3001/', focused: false, focus: focusFn, navigate: navigateFn },
      ]),
      openWindow,
    };

    await expectedFixedHandler('/?session=abc123', mockClients, 'http://localhost:3001');

    // Expected: existing client is focused and navigated
    expect(focusFn).toHaveBeenCalledTimes(1);
    expect(navigateFn).toHaveBeenCalledWith('http://localhost:3001/?session=abc123');

    // Expected: openWindow is NOT called because a client exists
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('[EXPECTED] fixed handler opens new window when no client exists (fallback)', async () => {
    const openWindow = vi.fn().mockResolvedValue(null);

    const mockClients = {
      matchAll: vi.fn().mockResolvedValue([]), // No existing clients
      openWindow,
    };

    await expectedFixedHandler('/?session=abc123', mockClients, 'http://localhost:3001');

    // Expected: openWindow is called as fallback
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(openWindow).toHaveBeenCalledWith('http://localhost:3001/?session=abc123');
  });

  it('[BUG] current handler does not resolve relative URLs', async () => {
    const openWindow = vi.fn().mockResolvedValue(null);

    const mockClients = {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    };

    await currentBuggyHandler('/?session=abc123', mockClients);

    // BUG: The relative URL is passed as-is to openWindow
    // In a service worker context, openWindow resolves it, but the issue notes
    // it should be explicitly resolved for clarity and correctness
    expect(openWindow).toHaveBeenCalledWith('/?session=abc123');
  });

  it('[EXPECTED] fixed handler resolves relative URLs against origin', async () => {
    const openWindow = vi.fn().mockResolvedValue(null);
    const focusFn = vi.fn().mockResolvedValue(undefined);
    const navigateFn = vi.fn().mockResolvedValue(undefined);

    const mockClients = {
      matchAll: vi.fn().mockResolvedValue([
        { url: 'http://localhost:3001/', focused: false, focus: focusFn, navigate: navigateFn },
      ]),
      openWindow,
    };

    await expectedFixedHandler('/?session=abc123', mockClients, 'http://localhost:3001');

    // Expected: URL is resolved against origin before navigating
    expect(navigateFn).toHaveBeenCalledWith('http://localhost:3001/?session=abc123');
  });
});
