const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '..', 'config', 'streaming.json');

function load() {
  return JSON.parse(fs.readFileSync(file, 'utf8')); // read fresh: hand-edits apply live
}

function forCompetition(competition) {
  if (!competition) return null;
  const map = load();
  if (map[competition]) return map[competition];
  // Loose match both ways: "UEFA Champions League" -> "Champions League",
  // and the API's "Premiership" -> config "Scottish Premiership".
  const c = competition.toLowerCase();
  const key = Object.keys(map).find(
    (k) => c.includes(k.toLowerCase()) || k.toLowerCase().includes(c)
  );
  return key ? map[key] : null;
}

module.exports = { forCompetition };
