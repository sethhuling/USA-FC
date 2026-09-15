const fs = require('fs');
const path = require('path');
const { LEAGUE_IDS, CUP_IDS } = require('../../src/coverage');
const file = path.join(__dirname, '..', '..', 'config', 'streaming.json');

// Our own canonical competition names (coverage.json). Fixtures are labeled
// with these, so they must match streaming.json EXACTLY: a loose match made
// "Bundesliga 2" and "Austrian Bundesliga" inherit the Bundesliga's carrier
// (fixed Sept 15, 2026) — a covered competition with no entry is "Unknown".
const COVERED = new Set([...Object.keys(LEAGUE_IDS), ...Object.keys(CUP_IDS)]);

function load() {
  return JSON.parse(fs.readFileSync(file, 'utf8')); // read fresh: hand-edits apply live
}

function forCompetition(competition) {
  if (!competition) return null;
  const map = load();
  if (map[competition]) return map[competition];
  if (COVERED.has(competition)) return null;
  // Loose match both ways: "UEFA Champions League" -> "Champions League",
  // and the API's "Premiership" -> config "Scottish Premiership".
  const c = competition.toLowerCase();
  const key = Object.keys(map).find(
    (k) => c.includes(k.toLowerCase()) || k.toLowerCase().includes(c)
  );
  return key ? map[key] : null;
}

module.exports = { forCompetition };
