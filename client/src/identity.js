// Anonymous per-device identity. A random UUID minted on first open and kept in
// localStorage — it's what ties this browser/PWA install to its favorites and
// push subscription on the server. No sign-in required; signing in later LINKS
// this device id to the account rather than replacing it. Unguessable, and the
// /api/me endpoints only ever touch the calling device's own rows.
const KEY = 'unclesamfc-device-id';

let cached = null;

export function getDeviceId() {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    cached = id;
  } catch {
    // Storage blocked (private browsing): a per-session id still lets the app
    // run; favorites just won't persist server-side under a stable identity.
    cached = crypto.randomUUID();
  }
  return cached;
}
