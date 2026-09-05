// Automatic match-level US broadcast lookup.
//
// LiveSoccerTV has no public API and its terms prohibit automated scraping, so this
// adapter is DISABLED by default and ships as a stub. If you have permission or a
// licensed broadcast-data source (e.g. API-Football's /odds-adjacent "tv" data on
// some plans, or a commercial provider), implement forMatch() here and set
// ENABLE_STREAMING_AUTO=1 in .env. Returning null hands over to the config fallback.
async function forMatch(match) {
  if (process.env.ENABLE_STREAMING_AUTO !== '1') return null;
  // Implement your licensed lookup here. Must return a string like "Peacock" or null.
  return null;
}

module.exports = { forMatch };
