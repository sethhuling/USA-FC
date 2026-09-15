import { getDeviceId } from './identity.js';

async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/* ---------- /api/me: per-device profile (favorites, prefs, push) ---------- */
// Every call carries the anonymous device id; a Supabase access token rides
// along when signed in (set by auth.js on session changes) so the server can
// link the device to the account.
let authToken = null;
export function setAuthToken(token) { authToken = token || null; }

async function me(path, { method = 'GET', body } = {}) {
  const headers = { 'x-device-id': getDeviceId() };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method, headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchMe = () => me('/api/me');
export const addFavorite = (id) => me(`/api/me/favorites/${encodeURIComponent(id)}`, { method: 'PUT' });
export const removeFavorite = (id) => me(`/api/me/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const savePrefs = (prefs) => me('/api/me/prefs', { method: 'PUT', body: prefs });
export const savePlayerPrefs = (playerId, prefs) =>
  me(`/api/me/prefs/players/${encodeURIComponent(playerId)}`, { method: 'PUT', body: prefs });
export const savePushSubscription = (sub) => me('/api/me/push', { method: 'POST', body: sub });
export const deletePushSubscription = () => me('/api/me/push', { method: 'DELETE' });
export const sendTestPush = () => me('/api/me/push/test', { method: 'POST' });
export const linkDevice = () => me('/api/me/link', { method: 'POST' });
export const unlinkDevice = () => me('/api/me/unlink', { method: 'POST' });

export const fetchMeta = () => get('/api/meta');
export const fetchPlayers = () => get('/api/players');
export const fetchMatches = () => get('/api/matches');

// Player profiles: cache + in-flight dedupe so hover previews don't spam the API.
const profileCache = new Map();
export function fetchPlayerProfile(id) {
  if (!profileCache.has(id)) {
    const p = get(`/api/player/${encodeURIComponent(id)}`)
      .catch((e) => { profileCache.delete(id); throw e; });
    profileCache.set(id, p);
  }
  return profileCache.get(id);
}

// Match details refresh fast during live games; short client-side memo only.
// { fresh: true } skips the memo read (live re-polls) but still updates it.
const matchDetailCache = new Map();
export async function fetchMatchDetail(id, { fresh = false } = {}) {
  const hit = matchDetailCache.get(id);
  if (!fresh && hit && Date.now() - hit.t < 60_000) return hit.p;
  const p = get(`/api/match/${encodeURIComponent(id)}`);
  matchDetailCache.set(id, { t: Date.now(), p });
  try { return await p; } catch (e) { matchDetailCache.delete(id); throw e; }
}

export const fetchLeagues = () => get('/api/leagues');
export const fetchNews = () => get('/api/news');

const teamCache = new Map();
export function fetchTeamOverview(id) {
  if (!teamCache.has(id)) {
    const p = get(`/api/team/${encodeURIComponent(id)}`)
      .catch((e) => { teamCache.delete(id); throw e; });
    teamCache.set(id, p);
  }
  return teamCache.get(id);
}
