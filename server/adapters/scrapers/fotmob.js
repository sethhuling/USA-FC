// FotMob fallback scraper — DISABLED by default (ENABLE_FOTMOB_SCRAPER=1 to enable).
//
// Purpose: fill stat fields the primary API doesn't provide (e.g. true clearances,
// which API-Football lacks — it exposes blocks instead). Isolated behind this
// adapter so it can be swapped for another source or kept off entirely.
// FotMob's unofficial JSON endpoints can change or be blocked at any time; treat
// every field from here as best-effort.
async function playerStats(fotmobPlayerId) {
  if (process.env.ENABLE_FOTMOB_SCRAPER !== '1' || !fotmobPlayerId) return null;
  try {
    const res = await fetch(`https://www.fotmob.com/api/playerData?id=${fotmobPlayerId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (personal stats tracker)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Shape varies by season; extract defensively.
    const statList = data?.mainLeague?.stats || [];
    const find = (t) => statList.find((s) => (s.title || '').toLowerCase().includes(t))?.value ?? null;
    return {
      clearances: find('clearance'),
      interceptions: find('interception'),
    };
  } catch {
    return null;
  }
}

module.exports = { playerStats };
