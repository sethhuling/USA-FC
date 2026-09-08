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
