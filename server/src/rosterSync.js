// Roster discovery: find tracked-nationality players across every league in
// coverage.json and merge them into data/players.json. Shared by the manual
// `npm run discover` script and the automatic in-process sync (warm.js).
//
// A league with no tracked players shows nowhere in the app — schedule,
// stats filters, and league rounds all derive from the roster — so adding a
// league to coverage.json takes visible effect only once discovery finds a
// player there.
//
// The automatic sync is add-only: it never rewrites an existing entry's
// club/league (those are hand-maintained and the club string drives the
// current-club-only stats filter). The manual script passes
// refreshExisting: true to keep its historical refresh behavior.
const fs = require('fs');
const path = require('path');
const { NATIONALITY } = require('./coverage');

const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');
const EXCLUDED_FILE = path.join(__dirname, '..', 'data', 'excluded.json');

function slug(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '').trim().split(/\s+/).reverse().join('-');
}

const POSITION_GROUPS = {
  Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW',
};

// The API abbreviates display names ("C. Pulisic"); build a full name from the
// firstname/lastname fields so slugs are stable and readable.
function fullName(pl) {
  const first = (pl.firstname || '').trim().split(/\s+/)[0];
  const last = (pl.lastname || '').trim();
  return first && last ? `${first} ${last}` : pl.name;
}

// Pages through /players for each configured league, keeping players of the
// tracked nationality. Goes through the provider's throttled apiPaged, so it
// shares the global 250ms spacing (and burst-limit retry) with all other
// upstream traffic. Cost: roughly one call per 20 league players — on the
// order of 1,000 calls for the current coverage.
async function discoverFromApi(log = () => {}) {
  const provider = require('../adapters/providers/apiFootball');
  const found = [];
  for (const [leagueName, leagueId] of Object.entries(provider.LEAGUE_IDS)) {
    let page = 1, totalPages = 1;
    while (page <= totalPages) {
      let body;
      try {
        body = await provider.apiPaged('/players', {
          league: leagueId, season: provider.season(), page,
        });
      } catch (e) { log(`${leagueName} page ${page} failed: ${e.message}`); break; }
      totalPages = body.paging?.total || 1;
      for (const item of body.response || []) {
        if (item.player?.nationality !== NATIONALITY) continue;
        const stat = item.statistics?.[0] || {};
        const name = fullName(item.player);
        const group = POSITION_GROUPS[stat.games?.position] || 'MF';
        found.push({
          id: slug(name),
          name,
          club: stat.team?.name || 'Unknown',
          league: leagueName,
          position: group,
          positionGroup: group,
          nationality: NATIONALITY,
          apiFootballId: item.player.id,
        });
      }
      if (page === totalPages) {
        log(`${leagueName}: ${totalPages} pages — ${found.length} ${NATIONALITY} players so far`);
      }
      page++;
    }
  }
  return found;
}

// Merge discovered players into players.json. Hand edits and excluded players
// (chose another national team) are always preserved; existing entries only
// have club/league refreshed when refreshExisting is set (manual script).
// Returns { added, total } where added lists the newly appended players.
function mergeIntoRoster(discovered, { refreshExisting = false } = {}) {
  const excluded = new Set(JSON.parse(fs.readFileSync(EXCLUDED_FILE, 'utf8')).excluded);
  const existing = fs.existsSync(PLAYERS_FILE)
    ? JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')) : [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byApiId = new Map(existing.filter((p) => p.apiFootballId).map((p) => [p.apiFootballId, p]));
  const added = [];
  for (const p of discovered) {
    if (excluded.has(p.id)) continue;
    const cur = (p.apiFootballId && byApiId.get(p.apiFootballId)) || byId.get(p.id);
    if (cur) {
      if (refreshExisting) {
        cur.club = p.club || cur.club;
        cur.league = p.league || cur.league;
      }
      if (p.apiFootballId && !cur.apiFootballId) cur.apiFootballId = p.apiFootballId;
    } else {
      byId.set(p.id, p);
      if (p.apiFootballId) byApiId.set(p.apiFootballId, p);
      added.push(p);
    }
  }
  const merged = [...byId.values()].sort((a, b) =>
    a.league.localeCompare(b.league) || a.name.localeCompare(b.name));
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(merged, null, 2) + '\n');
  return { added, total: merged.length };
}

// Full automatic pipeline for the in-process sync. Skips silently without an
// API key (demo mode). Add-only — see module comment.
async function syncRoster(log = console.log) {
  if (!process.env.API_FOOTBALL_KEY) return { added: [], total: 0, skipped: true };
  const discovered = await discoverFromApi(() => {});
  const { added, total } = mergeIntoRoster(discovered);
  if (added.length) {
    log(`[roster-sync] added ${added.map((p) => `${p.name} (${p.club}, ${p.league})`).join(', ')}`);
  }
  log(`[roster-sync] done: ${total} players, ${added.length} new`);
  return { added, total };
}

module.exports = { discoverFromApi, mergeIntoRoster, syncRoster };
