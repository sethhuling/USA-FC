// Reactive favorites store. localStorage is the source of truth for instant,
// offline-safe UI (settings.js is deliberately non-reactive, so this is its own
// module); the server copy under this device's id is kept in sync best-effort
// whenever the profile API is configured. Components subscribe through
// useFavorites() (useSyncExternalStore), so a toggle re-renders every star.
import { useSyncExternalStore } from 'react';
import { fetchMe, addFavorite, removeFavorite } from './api.js';

const KEY = 'unclesamfc-favorites';

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    return new Set(Array.isArray(stored) ? stored.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

let favs = load();
let snapshot = favs; // stable reference between changes, for useSyncExternalStore
const listeners = new Set();

function emit() {
  snapshot = new Set(favs);
  try { localStorage.setItem(KEY, JSON.stringify([...favs])); } catch { /* won't persist */ }
  listeners.forEach((l) => l());
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

// Returns a Set of favorited player ids; a new Set instance on every change.
export function useFavorites() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// Whether the server-side profile API is available (Supabase configured). Until
// the boot sync says yes, toggles stay local-only.
let serverEnabled = false;
export const isProfileServerEnabled = () => serverEnabled;

export function toggleFavorite(id) {
  const nowFav = !favs.has(id);
  if (nowFav) favs.add(id); else favs.delete(id);
  emit();
  // Best-effort server sync; local state already updated. A failed call is
  // retried implicitly by the union on next boot (adds) or stays local (removes).
  if (serverEnabled) (nowFav ? addFavorite(id) : removeFavorite(id)).catch(() => {});
  return nowFav;
}

// Boot sync: merge the server's favorites for this device (union — signing in
// on another device contributes its picks) and push up any local-only ids.
// Safe to call more than once; also re-run after sign-in links the device.
export async function syncFavorites() {
  let data;
  try { data = await fetchMe(); } catch { return null; }
  if (!data?.enabled) { serverEnabled = false; return data; }
  serverEnabled = true;
  const server = new Set(data.favorites || []);
  const localOnly = [...favs].filter((id) => !server.has(id));
  for (const id of localOnly) addFavorite(id).catch(() => {});
  const union = new Set([...server, ...favs]);
  if (union.size !== favs.size) { favs = union; emit(); }
  return data;
}
