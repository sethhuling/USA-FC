#!/usr/bin/env node
// Auto-discover tracked-nationality players and merge into data/players.json.
// The nationality and league list come from server/config/coverage.json.
// The discovery + merge logic lives in server/src/rosterSync.js, shared with
// the automatic in-process sync (warm.js runs it daily on the server).
//
// With API_FOOTBALL_KEY set: pages through /players for each configured league
// and keeps players matching the configured nationality. Costs roughly
// (pages x leagues) requests — expect around a thousand calls; fine on paid
// tiers, not on the free 100/day quota.
// Without a key (demo mode): regenerates players.json from the bundled demo roster.
//
// Existing hand-edits are preserved: players already in players.json are kept
// (club/league refreshed, API id backfilled), discovered players are appended.
require('../src/env');
const fs = require('fs');
const path = require('path');
const { discoverFromApi, mergeIntoRoster } = require('../src/rosterSync');

async function main() {
  let discovered;
  if (process.env.API_FOOTBALL_KEY) {
    console.log('Discovering via API-Football…');
    discovered = await discoverFromApi(console.log);
  } else {
    console.log('No API_FOOTBALL_KEY set — seeding from bundled demo roster.');
    discovered = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'demo', 'roster.json'), 'utf8')
    );
  }
  const { added, total } = mergeIntoRoster(discovered, { refreshExisting: true });
  for (const p of added) console.log(`  + ${p.name} — ${p.club} (${p.league})`);
  console.log(`players.json: ${total} players (${added.length} added).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
