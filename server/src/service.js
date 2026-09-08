const fs = require('fs');
const path = require('path');
const cache = require('./cache');
const provider = require('../adapters/providers');
const streaming = require('../adapters/streaming');

const TTL = {
  profile: 7 * 24 * 60 * 60 * 1000, // bio/career: weekly

  stats: 24 * 60 * 60 * 1000, // player season stats: daily
  schedule: 60 * 60 * 1000,   // fixtures: hourly
  live: 60 * 1000,            // live matches: 60s
};

function trackedPlayers() {
  // Read fresh each call so hand-edits to players.json apply without restart.
  const file = path.join(__dirname, '..', 'data', 'players.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function getMeta() {
  return {
    provider: provider.name,
    demo: provider.name === 'demo',
    trackedCount: trackedPlayers().length,
    upstream: provider.diag || null,
  };
}

async function getPlayers() {
  const tracked = trackedPlayers();
  const players = await cache.wrap('players', TTL.stats, () => provider.seasonStats(tracked));
  return { source: provider.name, players };
}

async function getMatches() {
  const tracked = trackedPlayers();
  const schedule = await cache.wrap('schedule', TTL.schedule, () => provider.getFixtures(tracked));
  const anyLive = schedule.some((m) => m.status === 'live') ||
    schedule.some((m) => m.status === 'scheduled' && new Date(m.kickoff) <= new Date());
  let matches = schedule;
  if (anyLive) {
    // Overlay fresh live state (60s TTL) on the hourly schedule cache.
    const live = await cache.wrap('live', TTL.live, () => provider.getLive(tracked));
    const byId = new Map(live.map((m) => [m.id, m]));
    matches = schedule.map((m) => byId.get(m.id) || m);
  }
  const withStreaming = await Promise.all(
    matches.map(async (m) => ({ ...m, streaming: await streaming.forMatch(m) }))
  );
  await annotateSquadStatus(withStreaming);
  return { source: provider.name, matches: withStreaming };
}

// Lineups publish ~an hour before kickoff: for scheduled matches close to kickoff,
// pull match detail (cached) and mark each tracked player start/bench/out.
// Live matches already carry this from the live-overlay path.
async function annotateSquadStatus(matches) {
  if (!provider.matchDetail) return;
  const soon = matches.filter((m) =>
    m.status === 'scheduled' &&
    new Date(m.kickoff) - Date.now() < 90 * 60 * 1000 &&
    new Date(m.kickoff) - Date.now() > -30 * 60 * 1000
  ).slice(0, 6); // cap upstream cost
  for (const m of soon) {
    try {
      const det = await getMatchDetail(m.id);
      if (!det?.lineups) continue;
      const start = new Set(), bench = new Set();
      for (const side of [det.lineups.home, det.lineups.away]) {
        for (const pl of side?.startXI || []) if (pl.trackedId) start.add(pl.trackedId);
        for (const pl of side?.substitutes || []) if (pl.trackedId) bench.add(pl.trackedId);
      }
      m.trackedPlayers = m.trackedPlayers.map((tp) => {
        const squadStatus = start.has(tp.playerId) ? 'start'
          : bench.has(tp.playerId) ? 'bench' : 'out';
        return { ...tp, squadStatus, inSquad: squadStatus !== 'out' };
      });
    } catch { /* leave un-annotated */ }
  }
}

async function getLeagues() {
  const names = [...new Set(trackedPlayers().map((p) => p.league))].sort();
  const rounds = provider.leagueRounds
    ? await cache.wrap('league-rounds', 6 * 60 * 60 * 1000, () => provider.leagueRounds(names))
    : {};
  return { leagues: names.map((n) => ({ name: n, round: rounds[n] ?? null })) };
}

async function getTeamOverview(teamId) {
  if (!provider.teamOverview) return null;
  const tracked = trackedPlayers();
  return cache.wrap(`team:${teamId}`, 6 * 60 * 60 * 1000, () => provider.teamOverview(teamId, tracked));
}

async function getMatchDetail(id) {
  const tracked = trackedPlayers();
  const detail = await cache.wrap(`match:${id}`, TTL.live, () => provider.matchDetail(id, tracked));
  if (!detail) return null;
  return { ...detail, streaming: await streaming.forMatch(detail) };
}

async function getPlayerProfile(id) {
  const p = trackedPlayers().find((x) => x.id === id);
  if (!p) return null;
  let profile = await cache.wrap(`profile:${id}`, TTL.profile, () => provider.playerProfile(p));
  // Upcoming club fixtures live outside the long-lived profile cache (they change
  // hourly) and are shared by teammates via the team-keyed cache entry.
  if (provider.teamUpcoming && p.apiFootballTeamId) {
    try {
      const upcoming = await cache.wrap(
        `team-upcoming:${p.apiFootballTeamId}`, TTL.schedule,
        () => provider.teamUpcoming(p.apiFootballTeamId, trackedPlayers())
      );
      profile = { ...profile, upcoming };
    } catch { /* profile still useful without fixtures */ }
  }
  // Current-season stats come from the (fresher) players cache when available.
  try {
    const { players } = await getPlayers();
    const cur = players.find((x) => x.id === id);
    if (cur?.stats) return { ...profile, player: { ...profile.player, stats: cur.stats } };
  } catch { /* fall through with profile as-is */ }
  return profile;
}

module.exports = { getPlayers, getMatches, getMeta, getPlayerProfile, getMatchDetail, getLeagues, getTeamOverview };
