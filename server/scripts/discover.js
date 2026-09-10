#!/usr/bin/env node
// Auto-discover tracked-nationality players and merge into data/players.json.
// The nationality and league list come from server/config/coverage.json.
//
// With API_FOOTBALL_KEY set: pages through /players for each configured league and
// keeps players matching the configured nationality. Costs roughly (pages x leagues)
// requests — expect a
// few hundred calls; fine on paid tiers, not on the free 100/day quota.
// Without a key (demo mode): regenerates players.json from the bundled demo roster.
//
// Existing hand-edits are preserved: players already in players.json are kept as-is,
// discovered players are appended.
require('../src/env');
const fs = require('fs');
const path = require('path');
const { NATIONALITY } = require('../src/coverage');

const OUT = path.join(__dirname, '..', 'data', 'players.json');
const EXCLUDED = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'excluded.json'), 'utf8')).excluded
);

function slug(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '').trim().split(/\s+/).reverse().join('-');
}

const POSITION_GROUPS = {
  Goalkeeper: 'GK', Defender: 'DF', Midfielder: 'MF', Attacker: 'FW',
};

async function apiPage(leagueId, season, page, attempt = 0) {
  const url = new URL('https://v3.football.api-sports.io/players');
  url.searchParams.set('league', leagueId);
  url.searchParams.set('season', season);
  url.searchParams.set('page', page);
  const res = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } });
  const body = res.status === 429 ? { errors: { rateLimit: '429' } } : await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    const msg = JSON.stringify(body.errors);
    if (/rate ?limit|too many|429/i.test(msg) && attempt < 3) {
      console.log(`  rate limited, waiting ${15 * (attempt + 1)}s…`);
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
      return apiPage(leagueId, season, page, attempt + 1);
    }
    throw new Error(msg);
  }
  return body;
}

// The API abbreviates display names ("C. Pulisic"); build a full name from the
// firstname/lastname fields so slugs are stable and readable.
function fullName(pl) {
  const first = (pl.firstname || '').trim().split(/\s+/)[0];
  const last = (pl.lastname || '').trim();
  return first && last ? `${first} ${last}` : pl.name;
}

async function discoverFromApi() {
  const provider = require('../adapters/providers/apiFootball');
  const found = [];
  for (const [leagueName, leagueId] of Object.entries(provider.LEAGUE_IDS)) {
    let page = 1, totalPages = 1;
    while (page <= totalPages) {
      let body;
      try { body = await apiPage(leagueId, provider.season(), page); }
      catch (e) { console.warn(`${leagueName} page ${page} failed: ${e.message}`); break; }
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
      if (page === 1 || page === totalPages) {
        console.log(`${leagueName}: ${totalPages} pages — ${found.length} ${NATIONALITY} players so far`);
      }
      page++;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return found;
}

async function main() {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  const byApiId = new Map(existing.filter((p) => p.apiFootballId).map((p) => [p.apiFootballId, p]));
  let discovered;
  if (process.env.API_FOOTBALL_KEY) {
    console.log('Discovering via API-Football…');
    discovered = await discoverFromApi();
  } else {
    console.log('No API_FOOTBALL_KEY set — seeding from bundled demo roster.');
    discovered = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'demo', 'roster.json'), 'utf8')
    );
  }
  let added = 0;
  for (const p of discovered) {
    if (EXCLUDED.has(p.id)) continue; // chose another national team
    const existing = (p.apiFootballId && byApiId.get(p.apiFootballId)) || byId.get(p.id);
    if (existing) {
      // Keep hand edits but refresh club/league and backfill the API id.
      existing.club = p.club || existing.club;
      existing.league = p.league || existing.league;
      if (p.apiFootballId) existing.apiFootballId = p.apiFootballId;
    } else {
      byId.set(p.id, p); added++;
    }
  }
  const merged = [...byId.values()].sort((a, b) =>
    a.league.localeCompare(b.league) || a.name.localeCompare(b.name));
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`players.json: ${merged.length} players (${added} added, ${existing.length} kept).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
