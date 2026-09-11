// Demo provider: bundled dataset with a real-time simulated live match, so the
// full app (including 60s live polling) works with no API key configured.
const { EPOCH, MIN, STATS, FIXTURES } = require('../../data/demo/dataset');

function playersByClub(tracked) {
  const map = new Map();
  for (const p of tracked) {
    if (!map.has(p.club)) map.set(p.club, []);
    map.get(p.club).push(p);
  }
  return map;
}

function materialize(fx, tracked, now) {
  const kickoff = new Date(EPOCH + fx.offsetMin * MIN);
  const elapsed = Math.floor((now - kickoff.getTime()) / MIN);
  let status = 'scheduled', minute = null, score = null, events = [];

  if (fx.finalScore || elapsed > 110) {
    status = 'finished';
    score = fx.finalScore || scoreFromScript(fx.script, 999);
    events = (fx.script || []).filter((e) => e.playerId);
  } else if (elapsed >= 0) {
    status = 'live';
    // Rough real-match clock: 15' halftime break after the 45th minute.
    minute = elapsed <= 45 ? elapsed : Math.max(45, Math.min(90, elapsed - 15));
    score = scoreFromScript(fx.script, minute);
    events = (fx.script || []).filter((e) => e.min <= minute && e.playerId);
    if (elapsed > 110) status = 'finished';
  }

  const byClub = playersByClub(tracked);
  const trackedInMatch = [...(byClub.get(fx.home) || []), ...(byClub.get(fx.away) || [])]
    .map((p) => ({
      playerId: p.id, name: p.name, club: p.club,
      inSquad: true, // demo: assume tracked players are in the squad
      goals: events.filter((e) => e.playerId === p.id).map((e) => e.min),
    }));

  return {
    id: fx.id,
    demo: true, // simulated match — not a real fixture
    competition: fx.competition,
    league: fx.league,
    kickoff: kickoff.toISOString(),
    home: fx.home, away: fx.away,
    status, minute,
    homeScore: score ? score[0] : null,
    awayScore: score ? score[1] : null,
    trackedPlayers: trackedInMatch,
  };
}

function scoreFromScript(script, upToMin) {
  const s = [0, 0];
  for (const e of script || []) {
    if (e.type === 'goal' && e.min <= upToMin) s[e.team === 'home' ? 0 : 1]++;
  }
  return s;
}

module.exports = {
  name: 'demo',
  async matchDetail(id, tracked) {
    const now = Date.now();
    const fx = FIXTURES.find((f) => f.id === id);
    if (!fx) return null;
    const base = materialize(fx, tracked, now);
    return { ...base, venue: null, referee: null, lineups: null, events: [], stats: [], demo: true };
  },
  async playerProfile(p) {
    return { player: { ...p, stats: STATS[p.id] || null }, bio: null,
      career: [], national: [], transfers: [], demo: true };
  },
  // One simulated ongoing injury (and one doubtful) so the profile's injury
  // banner can be exercised offline. Dates are relative to "now" like fixtures.
  async playerInjuryStatus(p) {
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    if (p.id === 'pulisic-christian') {
      return { reason: 'Hamstring Injury', status: 'out', since: day(-9),
        lastListed: day(3), upcomingRuledOut: day(3), missedCount: 2,
        expectedReturn: 'late October' };
    }
    if (p.id === 'cardoso-johnny') {
      return { reason: 'Knock', status: 'doubtful', since: day(2),
        lastListed: day(2), upcomingRuledOut: day(2), missedCount: 0, expectedReturn: null };
    }
    return null;
  },
  async seasonStats(tracked) {
    // Deterministic simulated age (18–32) so the Stats tab's age filter can be
    // exercised offline; real roster capTied flags pass through untouched.
    return tracked.map((p) => {
      let h = 0;
      for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) % 997;
      return { ...p, age: 18 + (h % 15), stats: STATS[p.id] || null };
    });
  },
  async getFixtures(tracked) {
    const now = Date.now();
    return FIXTURES.map((fx) => materialize(fx, tracked, now))
      .filter((m) => m.trackedPlayers.length > 0);
  },
  async getLive(tracked) {
    const now = Date.now();
    return FIXTURES.map((fx) => materialize(fx, tracked, now))
      .filter((m) => m.status === 'live' && m.trackedPlayers.length > 0);
  },
};
