// Web Push plumbing. Standard VAPID push through the app's own service worker —
// no Firebase. On iOS this only works when the app is installed to the Home
// Screen (iOS 16.4+), and the permission request must happen inside a user
// gesture, so enablePush() is called straight from a button's onClick.
import { savePushSubscription, deletePushSubscription } from './api.js';

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// The push service wants the VAPID public key as a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Must run inside a user gesture. Throws with a human-readable message the
// MVPs tab shows verbatim.
export async function enablePush(vapidPublicKey) {
  if (!pushSupported()) throw new Error('Push notifications aren’t supported in this browser.');
  if (!vapidPublicKey) throw new Error('Notifications aren’t configured on the server yet.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in your device settings and try again.');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  await savePushSubscription(sub.toJSON());
  return sub;
}

export async function disablePush() {
  const sub = await getExistingSubscription();
  if (sub) await sub.unsubscribe().catch(() => {});
  await deletePushSubscription().catch(() => {});
}
