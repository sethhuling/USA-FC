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
  return { source: provider.name, matches: withStreaming };
}

async function getPlayerProfile(id) {
  const p = trackedPlayers().find((x) => x.id === id);
  if (!p) return null;
  const profile = await cache.wrap(`profile:${id}`, TTL.profile, () => provider.playerProfile(p));
  // Current-season stats come from the (fresher) players cache when available.
  try {
    const { players } = await getPlayers();
    const cur = players.find((x) => x.id === id);
    if (cur?.stats) return { ...profile, player: { ...profile.player, stats: cur.stats } };
  } catch { /* fall through with profile as-is */ }
  return profile;
}

module.exports = { getPlayers, getMatches, getMeta, getPlayerProfile };
