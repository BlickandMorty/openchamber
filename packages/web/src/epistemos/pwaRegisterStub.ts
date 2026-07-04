// EPISTEMOS overlay (PATCH_LEDGER#R2b): build-time replacement for
// 'virtual:pwa-register' in the embedded build (VITE_EPISTEMOS_EMBED=1).
// The WKWebView agent surface must run with ZERO service workers; beyond not
// registering one, actively unregister anything a previous bundle left behind
// (the stale-bundle trap this app has already been bitten by once).

type RegisterSWOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
};

export function registerSW(_options: RegisterSWOptions = {}): (reloadPage?: boolean) => Promise<void> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {});
  }
  return async () => {};
}
