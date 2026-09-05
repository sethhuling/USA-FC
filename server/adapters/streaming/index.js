// Streaming lookup: try the automatic source first, fall back to the
// league -> US broadcaster config file. Result always says which source it came from.
const auto = require('./liveSoccerTv');
const config = require('./configFallback');

async function forMatch(match) {
  try {
    const hit = await auto.forMatch(match);
    if (hit) return { service: hit, source: 'livesoccertv' };
  } catch (e) {
    console.warn(`[streaming] auto lookup failed for ${match.home} v ${match.away}: ${e.message}`);
  }
  const fallback = config.forCompetition(match.competition);
  if (fallback) return { service: fallback, source: 'league-config' };
  return { service: 'Unknown — check LiveSoccerTV', source: 'none' };
}

module.exports = { forMatch };
