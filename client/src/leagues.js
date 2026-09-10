// League metadata and tracked nationality come from the shared deployment
// config (server/config/coverage.json) — one source of truth for server and
// client. Vite bundles the JSON at build time, so a coverage edit needs
// `npm run build` before the UI reflects it.
import coverage from '../../server/config/coverage.json';

export const NATIONALITY = coverage.nationality;

const NATIONAL_TEAM_RE = new RegExp(coverage.nationalTeamPattern, 'i');

// True for career rows that belong to the tracked national team (e.g. "USA").
export function isNationalTeam(teamName) {
  return NATIONAL_TEAM_RE.test(teamName || '');
}

export function leagueCountry(league) {
  return coverage.leagues[league]?.country || null;
}

export function leagueCountryCode(league) {
  return coverage.leagues[league]?.code || null;
}
