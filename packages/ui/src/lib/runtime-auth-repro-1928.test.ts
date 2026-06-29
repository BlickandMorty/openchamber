/**
 * Reproduction for issue #1928: FilesView asset previews remount on URL auth
 * token refresh.
 *
 * The bug: When the proactive URL auth token refresher replaces the shared
 * `oc_url_token`, the `useAssetAuthRefresh` hook in FilesView.tsx bumps a
 * nonce that is used as the React `key` for image/HTML/PDF preview elements.
 * This causes React to unmount and remount the entire preview DOM, producing
 * a visible flicker even though the file content hasn't changed.
 *
 * Root cause located in the `useAssetAuthRefresh` hook (FilesView.tsx line 711-715):
 *   subscribeRuntimeUrlAuthToken(() => {
 *     setNonce((n) => n + 1);       // <-- forces remount via key change
 *   });
 *
 * And the nonce is used as key (e.g. line 3763 & 3832 & 2986):
 *   <img key={imagePreviewNonce} … />
 *   <iframe key={htmlPreviewNonce} … />
 *   <iframe key={pdfPreviewNonce} … />
 *
 * Meanwhile, `subscribeRuntimeUrlAuthToken` fires on every token replacement
 * (runtime-auth.ts line 91-92), which occurs on the proactive refresh cadence
 * — not just when the file changes.
 */

import { describe, expect, test } from 'bun:test';

/**
 * Import the runtime-auth module functions involved in the bug.
 */
import {
  setRuntimeUrlAuthToken,
  subscribeRuntimeUrlAuthToken,
  acquireRuntimeUrlAuthToken,
  clearRuntimeUrlAuthToken,
} from './runtime-auth';

/**
 * Import the relevant functions from FilesView to demonstrate the buggy key usage.
 * Since useAssetAuthRefresh is a React hook, we simulate its nonce logic inline.
 */

describe('issue #1928 — preview remount on auth token refresh', () => {
  /**
   * This test demonstrates the core trigger:
   * subscribeRuntimeUrlAuthToken listeners fire when the token is replaced,
   * which is equivalent to the nonce bump in useAssetAuthRefresh.
   */
  test('subscriber fires on token replacement (the nonce-triggering event)', () => {
    // Start clean
    clearRuntimeUrlAuthToken();

    // Simulate first mint: set an initial token
    setRuntimeUrlAuthToken('initial-token', Date.now() + 60_000);

    // Register listener (like useAssetAuthRefresh does)
    let listenerCallCount = 0;
    const unsubscribe = subscribeRuntimeUrlAuthToken(() => {
      listenerCallCount += 1;
    });

    // Also acquire a consumer so proactive refresh would be scheduled
    // (not strictly needed for the listener call, but part of the real flow)
    const release = acquireRuntimeUrlAuthToken('http://localhost:4096');

    // ---- Token replacement (simulates proactive refresh) ----
    // The real flow: mintRuntimeUrlAuthToken → setRuntimeUrlAuthToken(new, expiry)
    // → previous !== normalized → notifyRuntimeUrlAuthListeners()
    setRuntimeUrlAuthToken('replacement-token', Date.now() + 120_000);

    // Listener should have fired, simulating the nonce bump
    expect(listenerCallCount).toBe(1);
    // In FilesView, this would cause setNonce((n) => n + 1), changing the React key

    // Cleanup
    unsubscribe();
    release();
    clearRuntimeUrlAuthToken();
  });

  /**
   * This test demonstrates that the initial mint does NOT fire the listener
   * (intentional by design — see runtime-auth.ts line 88-90). Only subsequent
   * replacements trigger it, but those happen on every proactive refresh cycle.
   */
  test('initial token mint does not fire subscriber (only replacements do)', () => {
    clearRuntimeUrlAuthToken();

    let listenerCallCount = 0;
    const unsubscribe = subscribeRuntimeUrlAuthToken(() => {
      listenerCallCount += 1;
    });

    // First call: no previous token, so listener does NOT fire
    setRuntimeUrlAuthToken('first-token', Date.now() + 60_000);
    expect(listenerCallCount).toBe(0);

    // Second call: previous exists and differs, so listener fires
    setRuntimeUrlAuthToken('second-token', Date.now() + 120_000);
    expect(listenerCallCount).toBe(1);

    unsubscribe();
    clearRuntimeUrlAuthToken();
  });

  /**
   * This test demonstrates the full chain:
   * token replacement → listener fires → nonce bumps → key changes → React remounts.
   * We simulate the useAssetAuthRefresh hook's nonce logic inline.
   */
  test('token replacement causes nonce change (simulating useAssetAuthRefresh)', () => {
    clearRuntimeUrlAuthToken();

    // Simulate the state from useAssetAuthRefresh
    let nonce = 0;

    // Subscribe like useAssetAuthRefresh does
    const unsubscribe = subscribeRuntimeUrlAuthToken(() => {
      // This is the exact line from FilesView.tsx line 715:
      // setNonce((n) => n + 1);
      nonce += 1;
    });

    // Initial mint (no fire)
    setRuntimeUrlAuthToken('token-A', Date.now() + 60_000);
    expect(nonce).toBe(0);

    const nonceBefore = nonce;

    // Token replacement (simulating proactive refresh)
    setRuntimeUrlAuthToken('token-B', Date.now() + 120_000);

    // Nonce has changed — in production, this would change the React key
    expect(nonce).toBe(nonceBefore + 1);

    // The key used for <img key={nonce}> just changed, forcing a full remount
    // of the preview element. This is the bug: the key shouldn't change when
    // only the auth token changes.

    unsubscribe();
    clearRuntimeUrlAuthToken();
  });

  /**
   * This test demonstrates that even a same-value token (if it could happen)
   * would NOT trigger the listener. But in practice the proactive refresh
   * always mints a new opaque token, so the guard doesn't help.
   */
  test('same token value does not fire listener (edge case of runtime-auth.ts line 91)', () => {
    clearRuntimeUrlAuthToken();

    let listenerCallCount = 0;
    const unsubscribe = subscribeRuntimeUrlAuthToken(() => {
      listenerCallCount += 1;
    });

    setRuntimeUrlAuthToken('same-token', Date.now() + 60_000);
    expect(listenerCallCount).toBe(0);

    // Setting the same token value again does not fire (previous === normalized)
    setRuntimeUrlAuthToken('same-token', Date.now() + 120_000);
    expect(listenerCallCount).toBe(0);

    // But a real token refresh always produces a new opaque value
    setRuntimeUrlAuthToken('different-token', Date.now() + 180_000);
    expect(listenerCallCount).toBe(1);

    unsubscribe();
    clearRuntimeUrlAuthToken();
  });

  /**
   * Demonstrate the visual consequence: if a React element uses the nonce as key,
   * the DOM elements are destroyed and recreated on every token refresh.
   */
  test('nonce-as-key forces remount simulation', () => {
    // This simulates what FilesView does:
    //   const [nonce, setNonce] = useState(0);
    //   ...
    //   subscribeRuntimeUrlAuthToken(() => { setNonce(n => n + 1); });
    //   ...
    //   <img key={nonce} src={assetUrl} />
    //
    // The React key changes from 0 → 1 → 2 → ... on every token refresh.
    // Changing the key tells React the old element is different from the new
    // one, so it unmounts the old <img> and mounts a fresh one.
    //
    // In a non-React test environment, we simulate by tracking the key:

    clearRuntimeUrlAuthToken();

    let previewNonce = 0; // simulates useState(0)
    const initialKey = previewNonce;

    // Subscribe (as useAssetAuthRefresh does)
    const unsubscribe = subscribeRuntimeUrlAuthToken(() => {
      previewNonce += 1; // simulates setNonce(n => n + 1)
    });

    // Initial token mint
    setRuntimeUrlAuthToken('token1', Date.now() + 60_000);
    expect(previewNonce).toBe(initialKey);
    // No key change on first mint ✓

    // Simulate proactive refresh #1
    setRuntimeUrlAuthToken('token2', Date.now() + 120_000);
    expect(previewNonce).toBe(initialKey + 1);
    // Key changed → React remounts! ✗

    // Simulate proactive refresh #2
    setRuntimeUrlAuthToken('token3', Date.now() + 180_000);
    expect(previewNonce).toBe(initialKey + 2);
    // Key changed again → React remounts again! ✗

    // This pattern means every proactive token refresh forces the preview
    // to unmount and remount, causing flicker.

    unsubscribe();
    clearRuntimeUrlAuthToken();
  });
});
