// Cache warmer: keeps every cache a user can hit pre-filled so opening the app
// never waits on cold API-Football calls. Three triggers, all in-process (the
// caches are in-memory, so an external cron couldn't reach them):
//   1. startup   — fill everything (restart wipes the cache)
//   2. daily     — force-refresh at a fixed quiet hour (09:00 UTC: after South
//                  American late games end ~03:00, before European kickoffs)
//   3. post-match — after a contiguous block of tracked kickoffs ends, force-
//                  refresh stats plus the caches of the teams that played
// A fully cold warm is ~1,400 throttled calls (~6 min at api()'s 250ms spacing);
// the daily forced warm re-fetches only expired/forced keys, ~400 calls. Both
// are small against the Mega plan's 150,000/day — the per-minute burst limit,
// not the daily cap, is what the throttle is protecting.
const cache = require('./cache');
const { syncRoster } = require('./rosterSync');
const { getRoundup } = require('./news');
const {
  getPlayers, getMatches, getLeagues, getPlayerProfile, getTeamOverview, trackedPlayers,
} = require('./service');

const DAILY_UTC_HOUR = 9;
const CHECK_MS = 5 * 60 * 1000;
// A match window is over when no tracked match kicked off within this long —
// cup extra time + penalties can run ~2h40m past kickoff.
const WINDOW_OVER_MS = 3 * 60 * 60 * 1000;

let warming = false;
// Tracked-match kickoffs learned from the last warm's schedule: [{t, teamIds}].
let kickoffs = [];
// Kickoffs at/before this moment are already handled; start at boot so matches
// that finished before the server started don't trigger a phantom warm.
let lastHandledKickoff = Date.now();

function rememberKickoffs(matches, tracked) {
  const teamByPlayer = new Map(
    tracked.filter((p) => p.apiFootballTeamId).map((p) => [p.id, p.apiFootballTeamId])
  );
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  kickoffs = matches
    .filter((m) =>
      m.trackedPlayers.length > 0 &&
      ['scheduled', 'live', 'finished'].includes(m.status) &&
      new Date(m.kickoff).getTime() >= cutoff
    )
    .map((m) => ({
      t: new Date(m.kickoff).getTime(),
      teamIds: new Set(m.trackedPlayers.map((tp) => teamByPlayer.get(tp.playerId)).filter(Boolean)),
    }));
}

// Warm every user-facing cache. force drops keys first so unexpired-but-stale
// data (e.g. 24h stats right after a match) re-fetches; teamIds scopes the
// team/profile phases to just the clubs that played (post-match warms).
async function warmAll(reason, { force = false, teamIds = null } = {}) {
  if (warming) return false;
  warming = true;
  const t0 = Date.now();
  let failed = 0;
  try {
    const tracked = trackedPlayers();
    const allTeams = [...new Set(tracked.map((p) => p.apiFootballTeamId).filter(Boolean))];
    const teams = teamIds ? allTeams.filter((id) => teamIds.has(id)) : allTeams;
    const players = teamIds ? tracked.filter((p) => teamIds.has(p.apiFootballTeamId)) : tracked;
    console.log(`[warm] ${reason}: ${players.length} players, ${teams.length} teams${force ? ' (forced)' : ''}`);

    if (force) {
      for (const key of ['players', 'schedule', 'league-rounds', 'roundup', 'national-fixtures']) cache.del(key);
      for (const id of teams) { cache.del(`team:${id}`); cache.del(`team-upcoming:${id}`); }
    }
    // Players FIRST: stats resolve the club team ids fixture matching depends on.
    for (const [label, fn] of [['players', getPlayers], ['matches', getMatches], ['leagues', getLeagues]]) {
      try {
        const r = await fn();
        if (label === 'matches') rememberKickoffs(r.matches, trackedPlayers());
      } catch (e) { failed++; console.warn(`[warm] ${label} failed: ${e.message}`); }
    }
    for (const id of teams) {
      try { await getTeamOverview(id); }
      catch (e) { failed++; console.warn(`[warm] team ${id} failed: ${e.message}`); }
    }
    // Profiles are 7d-cached (cheap after the first fill); this also refills each
    // club's team-upcoming fixtures, which profile views read.
    for (const p of players) {
      try { await getPlayerProfile(p.id); }
      catch (e) { failed++; console.warn(`[warm] profile ${p.id} failed: ${e.message}`); }
    }
    // News roundup LAST: it reads every recent finished match's detail, which
    // the background badge backfill has usually cached by now — building it
    // earlier would race that drain and double-fetch the same details.
    try { await getRoundup(); }
    catch (e) { failed++; console.warn(`[warm] roundup failed: ${e.message}`); }
    console.log(`[warm] ${reason} done in ${Math.round((Date.now() - t0) / 1000)}s${failed ? `, ${failed} failed` : ''}`);
    return true;
  } finally {
    warming = false;
  }
}

// A block of kickoffs is "over" once no tracked match has kicked off for
// WINDOW_OVER_MS — staggered kickoff days (12:30, 15:00, 17:30…) coalesce into
// one warm per contiguous block instead of one per match.
function checkMatchWindow() {
  const now = Date.now();
  const past = kickoffs.filter((k) => k.t <= now);
  const pending = past.filter((k) => k.t > lastHandledKickoff);
  if (pending.length === 0) return;
  if (past.some((k) => now - k.t < WINDOW_OVER_MS)) return; // window still open
  const teamIds = new Set(pending.flatMap((k) => [...k.teamIds]));
  const newest = Math.max(...pending.map((k) => k.t));
  warmAll('post-match', { force: true, teamIds }).then((ran) => {
    if (ran) lastHandledKickoff = newest; // if skipped (warm in progress), retry next tick
  });
}

// Automatic roster discovery (rosterSync.js): scan every covered league for
// new tracked-nationality players — e.g. an American transferring into a
// league that had none — and append them to players.json. Add-only; a league
// with no tracked players shows nowhere in the app, so this is also what
// makes a newly covered league appear once someone plays there. players.json
// lives on Render's ephemeral disk, so runtime additions vanish on each
// deploy — the startup sync re-finds them within minutes of boot; commit
// players.json now and then to make them durable.
async function syncRosterSafe(reason) {
  try { return await syncRoster(); }
  catch (e) { console.warn(`[roster-sync] ${reason} failed: ${e.message}`); return { added: [] }; }
}

function scheduleDaily() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_UTC_HOUR));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const t = setTimeout(async () => {
    try {
      await syncRosterSafe('daily'); // before the warm, so it covers any new players
      await warmAll('daily', { force: true });
    } finally { scheduleDaily(); }
  }, next - now);
  t.unref?.(); // never hold the process open
}

function start() {
  warmAll('startup')
    .then(async () => {
      // After the warm so the app has data ASAP; a forced re-warm only runs
      // when the sync actually found someone new.
      const { added = [] } = await syncRosterSafe('startup');
      if (added.length) await warmAll(`roster-sync (${added.length} new)`, { force: true });
    })
    .catch((e) => console.warn(`[warm] startup failed: ${e.message}`));
  scheduleDaily();
  const t = setInterval(checkMatchWindow, CHECK_MS);
  t.unref?.();
}

module.exports = { start };
