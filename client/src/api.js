async function get(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export const fetchMeta = () => get('/api/meta');
export const fetchPlayers = () => get('/api/players');
export const fetchMatches = () => get('/api/matches');
