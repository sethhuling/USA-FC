// Coverage config: which leagues/cups this deployment tracks and the player
// nationality it follows. Everything comes from server/config/coverage.json —
// edit that file to change coverage, no code changes needed. The client imports
// the same JSON at build time (client/src/leagues.js), so a coverage edit
// needs `npm run build` before the UI reflects it.
//
// League/cup canonical names are ours, not the API's — the API reuses names
// across countries (Brazil's league is literally "Serie A", Austria's is
// "Bundesliga", and Belgium's and Austria's cups are both just "Cup").
const coverage = require('../config/coverage.json');

// name -> API-Football league id (leagues are also scanned for player discovery;
// cups are fixtures-only).
const LEAGUE_IDS = Object.fromEntries(
  Object.entries(coverage.leagues).map(([name, l]) => [name, l.id])
);
const CUP_IDS = Object.fromEntries(
  Object.entries(coverage.cups).map(([name, c]) => [name, c.id])
);

// Nationality string as API-Football reports it (e.g. "USA").
const NATIONALITY = coverage.nationality;
// Matches national-team entries in career stats (tested against lowercased names).
const NATIONAL_TEAM_RE = new RegExp(coverage.nationalTeamPattern, 'i');

// The tracked nationality's national teams (first team + youth), keyed by
// API-Football team id: { label: "the USMNT", category: "usmnt" | "youth" }.
// Used only by the News tab's daily roundup — national-team matches never feed
// season stats (current-club-only rule).
const NATIONAL_TEAMS = new Map(
  Object.entries(coverage.nationalTeams || {}).map(([key, t]) => [t.id, { key, ...t }])
);

module.exports = { coverage, LEAGUE_IDS, CUP_IDS, NATIONALITY, NATIONAL_TEAM_RE, NATIONAL_TEAMS };
