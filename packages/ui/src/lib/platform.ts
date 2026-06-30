/** True when running inside the native Capacitor shell (iOS/Android app), not the web/PWA. */
export const isCapacitorApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true || window.location.protocol === 'capacitor:';
};
