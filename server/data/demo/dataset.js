// DEMO DATASET — illustrative numbers only, clearly labeled as demo in the UI.
// Player names/clubs are a snapshot of Americans abroad as of early 2026 and may be
// stale; run `npm run discover` with a real API key for current data.
//
// Fixtures are generated relative to server start so the app always shows a mix of
// finished, LIVE (simulated, advancing in real time), and upcoming matches.

const EPOCH = Date.now();
const MIN = 60 * 1000;

// Season stat lines (demo values, early-season scale). Keyed by player id.
const STATS = {
  'pulisic-christian':   { appearances: 3, minutes: 262, goals: 2, assists: 1, tackles: 2, interceptions: 1, clearances: 0, passesCompleted: 84,  passAccuracy: 86.9, yellow: 0, red: 0 },
  'mckennie-weston':     { appearances: 3, minutes: 244, goals: 0, assists: 1, tackles: 7, interceptions: 4, clearances: 5, passesCompleted: 131, passAccuracy: 88.4, yellow: 1, red: 0 },
  'musah-yunus':         { appearances: 2, minutes: 149, goals: 0, assists: 0, tackles: 5, interceptions: 3, clearances: 2, passesCompleted: 78,  passAccuracy: 90.1, yellow: 0, red: 0 },
  'cremaschi-benjamin':  { appearances: 3, minutes: 178, goals: 1, assists: 0, tackles: 4, interceptions: 2, clearances: 1, passesCompleted: 92,  passAccuracy: 84.7, yellow: 1, red: 0 },
  'robinson-antonee':    { appearances: 3, minutes: 270, goals: 0, assists: 2, tackles: 9, interceptions: 5, clearances: 11, passesCompleted: 118, passAccuracy: 81.2, yellow: 1, red: 0 },
  'adams-tyler':         { appearances: 3, minutes: 255, goals: 0, assists: 0, tackles: 12, interceptions: 7, clearances: 6, passesCompleted: 142, passAccuracy: 87.5, yellow: 2, red: 0 },
  'richards-chris':      { appearances: 3, minutes: 270, goals: 1, assists: 0, tackles: 5, interceptions: 6, clearances: 19, passesCompleted: 156, passAccuracy: 89.3, yellow: 0, red: 0 },
  'aaronson-brenden':    { appearances: 3, minutes: 208, goals: 1, assists: 0, tackles: 6, interceptions: 3, clearances: 2, passesCompleted: 74,  passAccuracy: 79.8, yellow: 1, red: 0 },
  'tillman-malik':       { appearances: 3, minutes: 231, goals: 2, assists: 1, tackles: 3, interceptions: 2, clearances: 1, passesCompleted: 102, passAccuracy: 85.6, yellow: 0, red: 0 },
  'scally-joe':          { appearances: 3, minutes: 270, goals: 0, assists: 1, tackles: 8, interceptions: 6, clearances: 9, passesCompleted: 121, passAccuracy: 83.9, yellow: 1, red: 0 },
  'reyna-gio':           { appearances: 2, minutes: 84,  goals: 0, assists: 1, tackles: 1, interceptions: 0, clearances: 0, passesCompleted: 41,  passAccuracy: 88.2, yellow: 0, red: 0 },
  'banks-noahkai':       { appearances: 2, minutes: 180, goals: 0, assists: 0, tackles: 4, interceptions: 5, clearances: 14, passesCompleted: 89,  passAccuracy: 86.1, yellow: 1, red: 0 },
  'balogun-folarin':     { appearances: 3, minutes: 214, goals: 3, assists: 0, tackles: 1, interceptions: 0, clearances: 1, passesCompleted: 45,  passAccuracy: 77.4, yellow: 0, red: 0 },
  'weah-timothy':        { appearances: 3, minutes: 247, goals: 1, assists: 2, tackles: 6, interceptions: 3, clearances: 4, passesCompleted: 97,  passAccuracy: 84.3, yellow: 1, red: 0 },
  'tessmann-tanner':     { appearances: 3, minutes: 262, goals: 0, assists: 0, tackles: 10, interceptions: 6, clearances: 4, passesCompleted: 148, passAccuracy: 89.9, yellow: 1, red: 0 },
  'mckenzie-mark':       { appearances: 3, minutes: 270, goals: 0, assists: 0, tackles: 4, interceptions: 7, clearances: 16, passesCompleted: 134, passAccuracy: 88.7, yellow: 1, red: 0 },
  'cardoso-johnny':      { appearances: 3, minutes: 236, goals: 0, assists: 1, tackles: 11, interceptions: 8, clearances: 5, passesCompleted: 152, passAccuracy: 91.2, yellow: 1, red: 0 },
  'dest-sergino':        { appearances: 3, minutes: 251, goals: 1, assists: 1, tackles: 7, interceptions: 4, clearances: 6, passesCompleted: 163, passAccuracy: 90.4, yellow: 0, red: 0 },
  'pepi-ricardo':        { appearances: 3, minutes: 203, goals: 3, assists: 1, tackles: 1, interceptions: 1, clearances: 2, passesCompleted: 52,  passAccuracy: 80.1, yellow: 0, red: 0 },
  'zendejas-alejandro':  { appearances: 4, minutes: 312, goals: 2, assists: 2, tackles: 4, interceptions: 2, clearances: 1, passesCompleted: 129, passAccuracy: 84.8, yellow: 1, red: 0 },
  'wright-haji':         { appearances: 4, minutes: 298, goals: 2, assists: 0, tackles: 2, interceptions: 1, clearances: 2, passesCompleted: 64,  passAccuracy: 74.2, yellow: 1, red: 0 },
  'morris-aidan':        { appearances: 4, minutes: 360, goals: 0, assists: 1, tackles: 13, interceptions: 8, clearances: 5, passesCompleted: 187, passAccuracy: 87.8, yellow: 2, red: 0 },
  'agyemang-patrick':    { appearances: 4, minutes: 289, goals: 2, assists: 1, tackles: 2, interceptions: 1, clearances: 4, passesCompleted: 55,  passAccuracy: 72.8, yellow: 1, red: 0 },
  'carter-vickers-cameron': { appearances: 4, minutes: 360, goals: 0, assists: 0, tackles: 6, interceptions: 9, clearances: 22, passesCompleted: 241, passAccuracy: 92.1, yellow: 1, red: 0 },
  'trusty-auston':       { appearances: 3, minutes: 270, goals: 1, assists: 0, tackles: 5, interceptions: 6, clearances: 17, passesCompleted: 198, passAccuracy: 91.5, yellow: 0, red: 0 },
};

// Fixture templates. offsetMin = kickoff relative to server start.
// script = timed events for live simulation. finalScore used for finished matches.
const FIXTURES = [
  // LIVE — simulated, advances in real time from server start.
  { id: 'demo-live-1', competition: 'Serie A', league: 'Serie A', offsetMin: -38,
    home: 'AC Milan', away: 'Bologna',
    script: [ { min: 27, team: 'home', type: 'goal', playerId: 'pulisic-christian', player: 'Christian Pulisic' },
              { min: 55, team: 'away', type: 'goal' },
              { min: 78, team: 'home', type: 'goal', playerId: 'pulisic-christian', player: 'Christian Pulisic' } ] },
  { id: 'demo-live-2', competition: 'Eredivisie', league: 'Eredivisie', offsetMin: -71,
    home: 'PSV', away: 'Ajax',
    script: [ { min: 12, team: 'home', type: 'goal', playerId: 'pepi-ricardo', player: 'Ricardo Pepi' },
              { min: 44, team: 'away', type: 'goal' },
              { min: 63, team: 'home', type: 'goal', playerId: 'dest-sergino', player: 'Sergiño Dest' } ] },
  // FINISHED
  { id: 'demo-fin-1', competition: 'Premier League', league: 'Premier League', offsetMin: -1560,
    home: 'Fulham', away: 'Brentford', finalScore: [2, 1],
    script: [ { min: 34, team: 'home', type: 'goal' }, { min: 58, team: 'away', type: 'goal' },
              { min: 81, team: 'home', type: 'goal' } ] },
  { id: 'demo-fin-2', competition: 'Serie A', league: 'Serie A', offsetMin: -2940,
    home: 'Juventus', away: 'Inter', finalScore: [1, 1],
    script: [ { min: 22, team: 'away', type: 'goal' }, { min: 70, team: 'home', type: 'goal' } ] },
  { id: 'demo-fin-3', competition: 'Ligue 1', league: 'Ligue 1', offsetMin: -4380,
    home: 'Monaco', away: 'Nantes', finalScore: [3, 0],
    script: [ { min: 15, team: 'home', type: 'goal', playerId: 'balogun-folarin', player: 'Folarin Balogun' },
              { min: 49, team: 'home', type: 'goal', playerId: 'balogun-folarin', player: 'Folarin Balogun' },
              { min: 88, team: 'home', type: 'goal' } ] },
  { id: 'demo-fin-4', competition: 'Liga MX', league: 'Liga MX', offsetMin: -3050,
    home: 'Club América', away: 'Guadalajara', finalScore: [2, 2],
    script: [ { min: 9, team: 'home', type: 'goal', playerId: 'zendejas-alejandro', player: 'Alejandro Zendejas' },
              { min: 31, team: 'away', type: 'goal' },
              { min: 66, team: 'away', type: 'goal' }, { min: 90, team: 'home', type: 'goal' } ] },
  // UPCOMING
  { id: 'demo-up-1', competition: 'Premier League', league: 'Premier League', offsetMin: 26 * 60,
    home: 'Bournemouth', away: 'Newcastle' },
  { id: 'demo-up-2', competition: 'Bundesliga', league: 'Bundesliga', offsetMin: 44 * 60,
    home: 'Bayer Leverkusen', away: 'Bayern München' },
  { id: 'demo-up-3', competition: 'La Liga', league: 'La Liga', offsetMin: 49 * 60,
    home: 'Atlético Madrid', away: 'Sevilla' },
  { id: 'demo-up-4', competition: 'Ligue 1', league: 'Ligue 1', offsetMin: 70 * 60,
    home: 'Marseille', away: 'Lyon' },
  { id: 'demo-up-5', competition: 'Premier League', league: 'Premier League', offsetMin: 95 * 60,
    home: 'Crystal Palace', away: 'Liverpool' },
  { id: 'demo-up-6', competition: 'Bundesliga', league: 'Bundesliga', offsetMin: 118 * 60,
    home: 'Borussia Mönchengladbach', away: 'Borussia Dortmund' },
  { id: 'demo-up-7', competition: 'Champions League', league: 'Champions League', offsetMin: 130 * 60,
    home: 'Juventus', away: 'Chelsea' },
  { id: 'demo-up-11', competition: 'Ligue 1', league: 'Ligue 1', offsetMin: 51 * 60,
    home: 'Strasbourg', away: 'Rennes' },
];

module.exports = { EPOCH, MIN, STATS, FIXTURES };
