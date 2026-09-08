async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

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
const matchDetailCache = new Map();
export async function fetchMatchDetail(id) {
  const hit = matchDetailCache.get(id);
  if (hit && Date.now() - hit.t < 60_000) return hit.p;
  const p = get(`/api/match/${encodeURIComponent(id)}`);
  matchDetailCache.set(id, { t: Date.now(), p });
  try { return await p; } catch (e) { matchDetailCache.delete(id); throw e; }
}

export const fetchLeagues = () => get('/api/leagues');
