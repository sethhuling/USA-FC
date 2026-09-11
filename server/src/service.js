const fs = require('fs');
const path = require('path');
const cache = require('./cache');
const provider = require('../adapters/providers');
const streaming = require('../adapters/streaming');

const TTL = {
  profile: 7 * 24 * 60 * 60 * 1000, // bio/career: weekly
  injury: 12 * 60 * 60 * 1000, // injury/availability reports: twice a day

  stats: 24 * 60 * 60 * 1000, // player season stats: daily
  schedule: 60 * 60 * 1000,   // fixtures: hourly
  live: 60 * 1000,            // live matches: 60s
  finished: 30 * 24 * 60 * 60 * 1000, // finished match detail: the result never changes
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
    // Reconcile: a match the cache thinks is live (or should have kicked off)
    // that's absent from the live feed has probably finished — re-check it so it
    // doesn't sit frozen at a stale minute until the hourly schedule refresh.
    // Detail-derived rows also carry squad statuses, so badges survive full time.
    const stale = matches.filter((m) =>
      !byId.has(m.id) && (
        m.status === 'live' ||
        (m.status === 'scheduled' && Date.now() - new Date(m.kickoff) > 5 * 60 * 1000)
      )
    ).slice(0, 8);
    for (const m of stale) {
      try {
        const det = await getMatchDetail(m.id);
        if (det) {
          const { lineups, events, stats, venue, referee, ...light } = det;
          const idx = matches.findIndex((x) => x.id === m.id);
          if (idx >= 0) matches[idx] = light;
        }
      } catch { /* keep the cached row */ }
    }
  }
  // Backfill badges on finished matches served from the schedule cache.
  // Cached details are applied every request (in-memory, cheap); UNCACHED ones
  // are only queued for the background drain — never fetched inline. Fetching
  // them here used to add ~5s to every /api/matches response (15 throttled
  // upstream calls) until a month's backlog drained after each restart, and
  // the loading splash waits on this endpoint.
  const lacking = matches.filter((m) =>
    m.status === 'finished' &&
    m.trackedPlayers.length > 0 &&
    m.trackedPlayers.every((tp) => tp.squadStatus == null)
  ).sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));
  const uncached = [];
  for (const m of lacking) {
    const det = cache.peek(`match-final:${m.id}`);
    if (det === undefined) { uncached.push(m.id); continue; }
    if (det?.status === 'finished') {
      const { lineups, events, stats, venue, referee, ...light } = det;
      const idx = matches.findIndex((x) => x.id === m.id);
      if (idx >= 0) matches[idx] = light;
    }
  }
  scheduleBadgeBackfill(uncached);
  const withStreaming = await Promise.all(
    matches.map(async (m) => ({ ...m, streaming: await streaming.forMatch(m) }))
  );
  await annotateSquadStatus(withStreaming);
  return { source: provider.name, matches: withStreaming };
}

// Background badge backfill: fetches the finished-match details the schedule
// cache lacks and stores them (30d), so the NEXT /api/matches request can
// apply the badges — the request itself never waits on upstream calls. One
// drain loop at a time; each getMatches call REPLACES the queue (newest-first,
// no duplicates), so a match whose fetch failed or isn't final yet is retried
// no more often than requests arrive. Only genuinely finished details enter
// the long-lived cache (the invariant match-final relies on).
let backfillQueue = [];
let backfillRunning = false;
function scheduleBadgeBackfill(ids) {
  if (!provider.matchDetail) return;
  backfillQueue = ids;
  if (backfillRunning || ids.length === 0) return;
  backfillRunning = true;
  (async () => {
    let fetched = 0;
    try {
      while (backfillQueue.length > 0) {
        const id = backfillQueue.shift();
        if (cache.peek(`match-final:${id}`) !== undefined) continue;
        try {
          const det = await provider.matchDetail(id, trackedPlayers());
          fetched++;
          if (det?.status === 'finished') cache.set(`match-final:${id}`, TTL.finished, det);
        } catch { /* retried when a later request re-queues it */ }
      }
      if (fetched > 0) console.log(`[backfill] fetched ${fetched} finished-match detail(s) in background`);
    } finally {
      backfillRunning = false;
    }
  })();
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

// While a live match is being viewed, ONE server-side timer refreshes its detail
// every TTL.live — viewer requests are pure cache reads, so N concurrent viewers
// still cost exactly one upstream call per interval and none of them wait on the
// (throttled) upstream. The timer stops when the match finishes or when no viewer
// has asked for it in WATCH_IDLE_MS.
const watchedLive = new Map(); // match id -> last viewer request (ms epoch)
const WATCH_IDLE_MS = 3 * 60 * 1000;
let liveRefreshTimer = null;

function markLiveViewed(id) {
  watchedLive.set(id, Date.now());
  if (!liveRefreshTimer) {
    liveRefreshTimer = setInterval(refreshWatchedLive, TTL.live);
    liveRefreshTimer.unref?.(); // never hold the process open
  }
}

async function refreshWatchedLive() {
  const tracked = trackedPlayers();
  for (const [id, lastViewed] of watchedLive) {
    if (Date.now() - lastViewed > WATCH_IDLE_MS) { watchedLive.delete(id); continue; }
    try {
      const detail = await provider.matchDetail(id, tracked);
      if (!detail) continue; // keep the last cached copy; retry next tick
      // TTL slack past the timer interval so viewer reads between ticks never
      // expire and trigger their own upstream fetch.
      cache.set(`match:${id}`, TTL.live + 30 * 1000, detail);
      if (detail.status !== 'live') {
        watchedLive.delete(id);
        if (detail.status === 'finished') cache.set(`match-final:${id}`, TTL.finished, detail);
      }
    } catch { /* keep the last cached copy; wrap() re-fetches after expiry */ }
  }
  console.log(`[live-detail] refreshed ${watchedLive.size} watched match(es)`);
  if (watchedLive.size === 0) { clearInterval(liveRefreshTimer); liveRefreshTimer = null; }
}

async function getMatchDetail(id) {
  // Finished matches never change: serve the long-lived copy when we have one
  // (shared with the badge-backfill cache in getMatches).
  let detail = cache.peek(`match-final:${id}`);
  if (detail === undefined) {
    const tracked = trackedPlayers();
    detail = await cache.wrap(`match:${id}`, TTL.live, () => provider.matchDetail(id, tracked));
    if (detail?.status === 'finished') cache.set(`match-final:${id}`, TTL.finished, detail);
    else if (detail?.status === 'live') markLiveViewed(id);
  }
  if (!detail) return null;
  return { ...detail, streaming: await streaming.forMatch(detail) };
}

// API-Football birth places carry no US state; merge hand-verified ones
// (server/data/hometowns.json) into the bio. Read fresh each call so
// hand-edits apply without a restart, like players.json.
function withHometown(profile, id) {
  if (!profile?.bio?.birth) return profile;
  let entry;
  try {
    const file = path.join(__dirname, '..', 'data', 'hometowns.json');
    entry = JSON.parse(fs.readFileSync(file, 'utf8'))[id];
  } catch { return profile; }
  if (!entry?.state && !entry?.country) return profile;
  return {
    ...profile,
    bio: {
      ...profile.bio,
      birth: {
        ...profile.bio.birth,
        ...(entry.state ? { state: entry.state } : {}),
        ...(entry.country ? { country: entry.country } : {}),
      },
    },
  };
}

// Hand-verified injury notes (server/data/injury-notes.json): press/club-sourced
// expected-return text and more specific injury names than the API's labels.
// Applied only to an ACTIVE API injury report, so a stale note self-cleans the
// moment the API stops flagging the player. Read fresh each call, like
// hometowns.json, so hand-edits apply without a restart.
function withInjuryNote(injury, id) {
  if (!injury) return injury;
  let entry;
  try {
    const file = path.join(__dirname, '..', 'data', 'injury-notes.json');
    entry = JSON.parse(fs.readFileSync(file, 'utf8'))[id];
  } catch { return injury; }
  if (!entry) return injury;
  return {
    ...injury,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.expectedReturn ? { expectedReturn: entry.expectedReturn } : {}),
  };
}

async function getPlayerProfile(id) {
  const p = trackedPlayers().find((x) => x.id === id);
  if (!p) return null;
  let profile = await cache.wrap(`profile:${id}`, TTL.profile, () => provider.playerProfile(p));
  profile = withHometown(profile, id);
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
  // Injury/availability report lives outside the 7d profile cache — it changes
  // week to week. null (fit) is cached too, so fit players cost one call per TTL.
  if (provider.playerInjuryStatus) {
    try {
      const injury = await cache.wrap(`injury:${id}`, TTL.injury, () => provider.playerInjuryStatus(p));
      profile = { ...profile, injury: withInjuryNote(injury, id) };
    } catch { /* profile still useful without it */ }
  }
  // Current-season stats come from the (fresher) players cache when available.
  try {
    const { players } = await getPlayers();
    const cur = players.find((x) => x.id === id);
    if (cur?.stats) return { ...profile, player: { ...profile.player, stats: cur.stats } };
  } catch { /* fall through with profile as-is */ }
  return profile;
}

module.exports = { getPlayers, getMatches, getMeta, getPlayerProfile, getMatchDetail, getLeagues, getTeamOverview, trackedPlayers };
