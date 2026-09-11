// API-Football (api-sports.io) provider. Active when API_FOOTBALL_KEY is set.
// Docs: https://www.api-football.com/documentation-v3
// NOTE: current-season data requires a paid plan; the free tier serves 2021-2023 only.
const BASE = 'https://v3.football.api-sports.io';

// Covered leagues/cups and tracked nationality come from server/config/coverage.json.
// Cup competitions are fetched for fixtures but excluded from player discovery
// and the league directory.
const { LEAGUE_IDS, CUP_IDS, NATIONALITY, NATIONAL_TEAM_RE } = require('../../src/coverage');

// The API reuses names across countries (Brazil's league is literally "Serie A",
// Austria's is "Bundesliga"), so always label fixtures with our canonical name.
const ID_TO_NAME = Object.fromEntries(
  [...Object.entries(LEAGUE_IDS), ...Object.entries(CUP_IDS)].map(([name, id]) => [id, name])
);

function season() {
  if (process.env.SEASON) return Number(process.env.SEASON);
  const d = new Date();
  return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; // Aug rollover
}

// Diagnostics: remember the most recent upstream failure so /api/meta can
// report it (message only — never the key).
const diag = { lastError: null, lastErrorAt: null, lastSuccessAt: null };

// Global throttle: space upstream calls out (the API enforces a per-minute burst
// limit even on paid plans). Retries with backoff when the limit still trips.
const MIN_INTERVAL_MS = Number(process.env.API_MIN_INTERVAL_MS || 250);
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// apiPaged returns the whole response body (response + paging) for callers
// that page through results; api returns just the response array.
async function apiPaged(path, params = {}, attempt = 0) {
  await throttle();
  require('../../src/metrics').recordApiCall();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
  });
  const retryable = res.status === 429;
  if (!res.ok && !retryable) {
    diag.lastError = `${path}: HTTP ${res.status}`;
    diag.lastErrorAt = new Date().toISOString();
    throw new Error(`api-football ${path}: HTTP ${res.status}`);
  }
  const body = retryable ? { errors: { rateLimit: 'HTTP 429' } } : await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    const msg = JSON.stringify(body.errors);
    if (/rate ?limit|too many requests|429/i.test(msg) && attempt < 3) {
      const backoff = 10_000 * (attempt + 1);
      console.warn(`[api-football] rate limited on ${path}, retrying in ${backoff / 1000}s`);
      await new Promise((r) => setTimeout(r, backoff));
      return apiPaged(path, params, attempt + 1);
    }
    diag.lastError = `${path}: ${msg}`;
    diag.lastErrorAt = new Date().toISOString();
    throw new Error(`api-football ${path}: ${msg}`);
  }
  diag.lastSuccessAt = new Date().toISOString();
  return body;
}

async function api(path, params = {}) {
  return (await apiPaged(path, params)).response;
}

// Limit concurrent upstream calls to stay polite on rate limits.
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
    })
  );
  return out;
}

function aggregateStats(entries) {
  // A player can have stat lines per competition; sum countables, weight pass accuracy.
  const s = { appearances: 0, starts: 0, minutes: 0, goals: 0, assists: 0, tackles: 0,
    interceptions: 0, clearances: 0, passesCompleted: 0, passAccuracy: null,
    yellow: 0, red: 0 };
  let accWeighted = 0, accWeight = 0;
  for (const e of entries) {
    const g = e.games || {}, gl = e.goals || {}, t = e.tackles || {}, pa = e.passes || {}, c = e.cards || {};
    s.appearances += g.appearences || 0;
    s.starts += g.lineups || 0;
    s.minutes += g.minutes || 0;
    s.goals += gl.total || 0;
    s.assists += gl.assists || 0;
    s.tackles += t.total || 0;
    s.interceptions += t.interceptions || 0;
    s.clearances += t.blocks || 0; // API-Football exposes blocks, not clearances; see README
    s.passesCompleted += pa.total || 0;
    s.yellow += c.yellow || 0;
    s.red += c.red || 0;
    const acc = parseFloat(pa.accuracy);
    if (!Number.isNaN(acc) && pa.total) { accWeighted += acc * pa.total; accWeight += pa.total; }
  }
  s.passAccuracy = accWeight ? Math.round((accWeighted / accWeight) * 10) / 10 : null;
  return s;
}

function mapFixture(fx, tracked, playerEvents = new Map()) {
  const teams = fx.teams || {};
  const short = fx.fixture.status?.short || 'NS';
  const status = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(short) ? 'live'
    : ['FT', 'AET', 'PEN'].includes(short) ? 'finished' : 'scheduled';
  const inMatch = tracked.filter((p) => playerInFixture(p, fx));
  const leagueName = ID_TO_NAME[fx.league?.id] || fx.league?.name;
  return {
    id: String(fx.fixture.id),
    competition: leagueName,
    league: leagueName,
    kickoff: fx.fixture.date,
    home: teams.home?.name, away: teams.away?.name,
    homeId: teams.home?.id ?? null, awayId: teams.away?.id ?? null,
    status,
    statusShort: short, // FT / AET / PEN distinguish how a finished match ended
    round: fx.league?.round || null,
    minute: status === 'live' ? fx.fixture.status?.elapsed ?? null : null,
    homeScore: fx.goals?.home ?? null,
    awayScore: fx.goals?.away ?? null,
    penalties: short === 'PEN'
      ? { home: fx.score?.penalty?.home ?? null, away: fx.score?.penalty?.away ?? null }
      : null,
    trackedPlayers: inMatch.map((p) => {
      const pe = playerEvents.get(fx.fixture.id);
      const squadStatus = pe?.hasLineups
        ? (pe.start.has(p.apiFootballId) ? 'start'
          : pe.bench.has(p.apiFootballId)
            ? (pe.played?.has(p.apiFootballId) ? 'on' : 'bench')
            : 'out')
        : null;
      return {
        playerId: p.id, name: p.name, club: p.club,
        squadStatus,
        outInjured: squadStatus === 'out' && !!pe?.injured?.has(p.apiFootballId),
        inSquad: squadStatus === null ? null : squadStatus !== 'out',
        goals: pe?.goals?.get(p.apiFootballId) || [],
        assists: pe?.assists?.get(p.apiFootballId) || [],
        minutes: pe?.minutes?.get(p.apiFootballId) ?? null,
      };
    }),
  };
}

const fs = require('fs');
const path = require('path');
const PLAYERS_FILE = path.join(__dirname, '..', '..', 'data', 'players.json');

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Player ids reported injured/missing for a fixture.
async function fetchInjuredSet(fixtureId) {
  const resp = await api('/injuries', { fixture: fixtureId }).catch(() => []);
  return new Set(resp.map((x) => x.player?.id).filter(Boolean));
}

function trackedOutExists(tracked, fx, pe) {
  if (!pe.hasLineups) return false;
  return tracked.some((p) => p.apiFootballId && playerInFixture(p, fx) &&
    !pe.start.has(p.apiFootballId) && !pe.bench.has(p.apiFootballId));
}

// Pull tracked-player-relevant sets out of a full fixture detail payload.
function extractPlayerEvents(d) {
  const goals = new Map(), assists = new Map();
  for (const ev of d.events || []) {
    // A player's goals exclude missed penalties, own goals (the event names
    // the player who put it in his own net) and penalty-shootout kicks.
    if (ev.type === 'Goal' && !/Missed Penalty|Own Goal/i.test(ev.detail || '') &&
      !/shootout/i.test(ev.comments || '')) {
      if (ev.player?.id) {
        if (!goals.has(ev.player.id)) goals.set(ev.player.id, []);
        goals.get(ev.player.id).push(ev.time?.elapsed);
      }
      if (ev.assist?.id) {
        if (!assists.has(ev.assist.id)) assists.set(ev.assist.id, []);
        assists.get(ev.assist.id).push(ev.time?.elapsed);
      }
    }
  }
  const start = new Set(), bench = new Set(), played = new Set();
  const minutes = new Map();
  for (const lineup of d.lineups || []) {
    for (const x of lineup.startXI || []) if (x.player?.id) start.add(x.player.id);
    for (const x of lineup.substitutes || []) if (x.player?.id) bench.add(x.player.id);
  }
  // A bench player with minutes on the board has been subbed on.
  for (const teamBlock of d.players || []) {
    for (const pp of teamBlock.players || []) {
      const mins = pp.statistics?.[0]?.games?.minutes;
      if (pp.player?.id && Number.isFinite(mins)) minutes.set(pp.player.id, mins);
      if (pp.player?.id && (mins || 0) > 0) played.add(pp.player.id);
    }
  }
  return { goals, assists, start, bench, played, minutes, hasLineups: (d.lineups || []).length > 0 };
}

// Loose club-name comparison: the API's names differ from ours in accents and
// suffixes ("Club America" vs "Club América", "PSV Eindhoven" vs "PSV").
function clubMatches(a, b) {
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

// Is this tracked player's club in the fixture? Prefer exact team-id matching
// (cup draws are full of similarly named small clubs — "Racing Club Warwick" is
// not Racing Club of Avellaneda); fall back to loose names until an id is known.
function playerInFixture(p, fx) {
  const hid = fx.teams?.home?.id, aid = fx.teams?.away?.id;
  if (p.apiFootballTeamId && (hid || aid)) {
    return p.apiFootballTeamId === hid || p.apiFootballTeamId === aid;
  }
  return clubMatches(fx.teams?.home?.name, p.club) || clubMatches(fx.teams?.away?.name, p.club);
}

// Find a tracked player's API-Football id via /players/profiles (season-independent,
// so it also finds players with zero league minutes). Same-name candidates are
// disambiguated by probing their stats for the expected club.
async function resolveId(p) {
  const tokens = p.name.trim().split(/\s+/);
  const last = norm(tokens[tokens.length - 1]);
  const firstInitial = norm(tokens[0]).charAt(0);
  // The search endpoint only accepts alphanumerics and spaces (no hyphens).
  const terms = [...new Set([last.replace(/[^a-z0-9 ]/g, ' ').trim(), last.split('-').pop()])]
    .filter((t) => t.length >= 3);
  for (const term of terms) {
    let resp;
    try { resp = await api('/players/profiles', { search: term }); }
    catch (e) { console.warn(`[api-football] search '${term}' failed: ${e.message}`); continue; }
    let cands = resp.filter((it) => {
      const pl = it.player || {};
      return norm(pl.lastname).includes(term) || norm(pl.name).includes(term);
    });
    const natMatch = cands.filter((it) => it.player?.nationality === NATIONALITY);
    if (natMatch.length) cands = natMatch;
    const fi = cands.filter(
      (it) => norm(it.player?.firstname || it.player?.name || '').charAt(0) === firstInitial
    );
    if (fi.length) cands = fi;
    if (cands.length === 1) return cands[0].player.id;
    for (const c of cands.slice(0, 4)) {
      for (const yr of [season(), season() - 1]) {
        const st = await api('/players', { id: c.player.id, season: yr }).catch(() => []);
        const teams = (st[0]?.statistics || []).map((x) => x.team?.name);
        if (teams.some((t) => clubMatches(t, p.club))) return c.player.id;
      }
    }
  }
  return null;
}

// Current round/matchweek per league, e.g. "Regular Season - 4".
async function leagueRounds(leagueNames) {
  const out = {};
  const known = leagueNames.filter((n) => LEAGUE_IDS[n]);
  await mapLimit(known, 3, async (name) => {
    try {
      const resp = await api('/fixtures/rounds', {
        league: LEAGUE_IDS[name], season: season(), current: 'true',
      });
      out[name] = resp[0] || null;
    } catch (e) {
      console.warn(`[api-football] rounds failed for ${name}: ${e.message}`);
      out[name] = null;
    }
  });
  return out;
}

// Team overview: club info + venue, standings across competitions, tracked
// Americans, recent results, and upcoming schedule. 4 upstream calls, cached.
async function teamOverview(teamId, tracked) {
  const infoResp = await api('/teams', { id: teamId }).catch(() => []);
  const info = infoResp[0];
  if (!info) return null;
  const standingsResp = await api('/standings', { season: season(), team: teamId }).catch(() => []);
  const next = await api('/fixtures', { team: teamId, next: 7 }).catch(() => []);
  const last = await api('/fixtures', { team: teamId, last: 5 }).catch(() => []);

  const standings = [];
  for (const entry of standingsResp) {
    for (const group of entry.league?.standings || []) {
      const row = group.find((r) => r.team?.id === teamId);
      if (row) {
        standings.push({
          competition: ID_TO_NAME[entry.league?.id] || entry.league?.name,
          rank: row.rank, points: row.points, played: row.all?.played,
          win: row.all?.win, draw: row.all?.draw, lose: row.all?.lose,
          goalsFor: row.all?.goals?.for, goalsAgainst: row.all?.goals?.against,
          form: row.form || null,
        });
      }
    }
  }

  return {
    id: teamId,
    name: info.team?.name, logo: info.team?.logo || null,
    country: info.team?.country || null, founded: info.team?.founded || null,
    venue: info.venue?.name
      ? {
        name: info.venue.name, city: info.venue.city || null,
        country: info.team?.country || null, // a club's stadium is in the club's country
        capacity: info.venue.capacity || null,
      }
      : null,
    standings,
    americans: tracked
      .filter((p) => p.apiFootballTeamId === teamId)
      .map((p) => ({ playerId: p.id, name: p.name, position: p.position })),
    recent: last.map((fx) => mapFixture(fx, tracked)),
    upcoming: next.map((fx) => mapFixture(fx, tracked)),
  };
}

// Next N fixtures for a club (used by player profiles; team pages fetch their own).
async function teamUpcoming(teamId, tracked, n = 5) {
  const resp = await api('/fixtures', { team: teamId, next: n });
  return resp.map((fx) => mapFixture(fx, tracked));
}

// Recent national-team fixtures (first team + youth) for the News roundup.
// `last` is season-independent — national teams play across calendar-year
// "seasons" (friendlies, youth tournaments). One call per team.
async function nationalFixtures(teamIds, tracked, n = 10) {
  const out = [];
  for (const id of teamIds) {
    const resp = await api('/fixtures', { team: id, last: n }).catch((e) => {
      console.warn(`[api-football] national fixtures ${id}: ${e.message}`);
      return [];
    });
    out.push(...resp.map((fx) => mapFixture(fx, tracked)));
  }
  return out;
}

// Full player profile: bio + photo, per-season career rows, transfer history.
// Costs up to ~15 throttled calls the first time; the service layer caches it.
async function playerProfile(p) {
  const id = p.apiFootballId;
  if (!id) return { player: p, bio: null, career: [], national: [], transfers: [] };

  const [profResp, seasonsResp, transfersResp] = [
    await api('/players/profiles', { player: id }).catch(() => []),
    await api('/players/seasons', { player: id }).catch(() => []),
    await api('/transfers', { player: id }).catch(() => []),
  ];

  const bio = profResp[0]?.player || null;

  const years = (seasonsResp || []).filter((y) => Number.isInteger(y)).sort((a, b) => b - a).slice(0, 12);
  const career = [];
  const national = [];
  for (const year of years) {
    const resp = await api('/players', { id, season: year }).catch(() => []);
    const byTeam = new Map();
    for (const st of resp[0]?.statistics || []) {
      const team = st.team?.name || '?';
      const row = byTeam.get(team) || { season: year, team, leagues: new Set(),
        apps: 0, goals: 0, assists: 0, minutes: 0 };
      row.leagues.add(st.league?.name);
      row.apps += st.games?.appearences || 0;
      row.goals += st.goals?.total || 0;
      row.assists += st.goals?.assists || 0;
      row.minutes += st.games?.minutes || 0;
      byTeam.set(team, row);
    }
    for (const row of byTeam.values()) {
      row.leagues = [...row.leagues].filter(Boolean).join(', ');
      (NATIONAL_TEAM_RE.test(norm(row.team)) ? national : career).push(row);
    }
  }

  const transfers = (transfersResp[0]?.transfers || [])
    .map((t) => ({ date: t.date, from: t.teams?.out?.name, to: t.teams?.in?.name, type: t.type }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { player: p, bio, career, national, transfers };
}

// Current availability from the API's fixture-level injury reports
// (/injuries?player&season): dated fixtures the player is listed as missing or
// questionable for — including upcoming ones — each with a reason. That's what
// we report, verbatim. The /sidelined endpoint is NOT used for "injured now":
// its open-ended entries never get closed (a year-old "Ankle Injury" persists
// on players who start every week). The API publishes no expected-return date,
// so none is shown — only fixture dates the report actually names.
async function playerInjuryStatus(p) {
  const id = p.apiFootballId;
  if (!id) return null;
  const resp = await api('/injuries', { player: id, season: season() });
  // The same absence appears once per competition — dedupe by fixture date.
  const rows = [];
  const seen = new Set();
  for (const r of resp || []) {
    const date = r.fixture?.date?.slice(0, 10);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    rows.push({ date, type: r.player?.type || null, reason: r.player?.reason || null });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  // Only a report within the last 10 days (or for an upcoming fixture) counts
  // as current — older rows are history, the player may long since be back.
  const current = rows.filter((r) => r.date >= cutoff);
  if (!current.length) return null;
  const latest = current[current.length - 1];
  // Walk back through the contiguous same-reason run so "since" spans the whole
  // absence even where it started before the 10-day window.
  let since = latest.date;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].reason === latest.reason) since = rows[i].date;
    else break;
  }
  return {
    reason: latest.reason,
    status: /questionable/i.test(latest.type || '') ? 'doubtful' : 'out',
    since,                                                  // first fixture of the run
    lastListed: latest.date,                                // most recent fixture named
    upcomingRuledOut: latest.date > today ? latest.date : null,
    missedCount: rows.filter((r) => r.reason === latest.reason && r.date >= since && r.date <= today).length,
    expectedReturn: null, // API-Football does not publish one
  };
}

// Fixture payloads name the venue and city but not its country; /venues has it.
// Stadiums don't move, so one lookup per venue for the life of the process.
const venueLocations = new Map();
async function venueLocation(venueId) {
  if (!venueId) return null;
  if (!venueLocations.has(venueId)) {
    const resp = await api('/venues', { id: venueId }).catch(() => []);
    venueLocations.set(venueId, resp[0]
      ? { city: resp[0].city || null, country: resp[0].country || null } : null);
  }
  return venueLocations.get(venueId);
}

// Full match detail: score, venue, lineups, events, team stats — one API call.
async function matchDetail(fixtureId, tracked) {
  const resp = await api('/fixtures', { id: fixtureId });
  const d = resp[0];
  if (!d) return null;
  const trackedByApiId = new Map(
    tracked.filter((p) => p.apiFootballId).map((p) => [p.apiFootballId, p])
  );
  function mkPlayer(pl) {
    return {
      apiId: pl?.id ?? null, name: pl?.name, number: pl?.number ?? null,
      pos: pl?.pos ?? null,
      trackedId: trackedByApiId.get(pl?.id)?.id || null,
    };
  }
  function mapLineup(lu) {
    if (!lu) return null;
    return {
      team: lu.team?.name, formation: lu.formation || null, coach: lu.coach?.name || null,
      startXI: (lu.startXI || []).map((x) => mkPlayer(x.player)),
      substitutes: (lu.substitutes || []).map((x) => mkPlayer(x.player)),
    };
  }
  const lus = d.lineups || [];
  const homeLu = lus.find((l) => l.team?.name === d.teams?.home?.name) || lus[0] || null;
  const awayLu = lus.find((l) => l !== homeLu) || null;
  const pe = extractPlayerEvents(d);
  if (trackedOutExists(tracked, d, pe)) {
    pe.injured = await fetchInjuredSet(d.fixture.id);
  }
  const playerEvents = new Map([[d.fixture.id, pe]]);
  const base = mapFixture(d, tracked, playerEvents);
  // Per-match stat lines for tracked players only (the News roundup picks each
  // one's best stat). NOTE: in /fixtures payloads passes.accuracy is the COUNT
  // of accurate passes ("39" of 43), not a percentage as in season stats. And
  // goals.conceded comes back null even for keepers who conceded — derive clean
  // sheets from the score, never from this field.
  const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const trackedStats = {};
  for (const teamBlock of d.players || []) {
    for (const pp of teamBlock.players || []) {
      const t = trackedByApiId.get(pp.player?.id);
      const s = pp.statistics?.[0];
      if (!t || !s) continue;
      trackedStats[t.id] = {
        minutes: num(s.games?.minutes), position: s.games?.position || null,
        passes: num(s.passes?.total), passesAccurate: num(s.passes?.accuracy), keyPasses: num(s.passes?.key),
        tackles: num(s.tackles?.total), interceptions: num(s.tackles?.interceptions), blocks: num(s.tackles?.blocks),
        duels: num(s.duels?.total), duelsWon: num(s.duels?.won),
        dribbles: num(s.dribbles?.attempts), dribblesWon: num(s.dribbles?.success),
        shots: num(s.shots?.total), shotsOn: num(s.shots?.on),
        saves: num(s.goals?.saves), foulsDrawn: num(s.fouls?.drawn),
        penWon: num(s.penalty?.won), penSaved: num(s.penalty?.saved),
      };
    }
  }
  let venue = null;
  if (d.fixture?.venue?.name) {
    const loc = await venueLocation(d.fixture.venue.id).catch(() => null);
    venue = {
      name: d.fixture.venue.name,
      city: d.fixture.venue.city || loc?.city || null,
      // Domestic league country is a safe fallback; "World" (UEFA etc.) is not.
      country: loc?.country
        || (d.league?.country && d.league.country !== 'World' ? d.league.country : null),
    };
  }
  return {
    ...base,
    venue,
    referee: d.fixture?.referee || null,
    lineups: homeLu || awayLu ? { home: mapLineup(homeLu), away: mapLineup(awayLu) } : null,
    events: (d.events || []).map((e) => ({
      minute: e.time?.elapsed ?? null, extra: e.time?.extra ?? null,
      team: e.team?.name, player: e.player?.name, assist: e.assist?.name || null,
      type: e.type, detail: e.detail,
      comments: e.comments || null, // e.g. "Penalty Shootout" on shootout kicks
      trackedId: trackedByApiId.get(e.player?.id)?.id || null,
      // The event's second name — a goal's assister, or the player coming ON in
      // a substitution — is tracked separately so the UI can flag him too.
      assistTrackedId: trackedByApiId.get(e.assist?.id)?.id || null,
    })),
    trackedStats,
    stats: (d.statistics || []).map((st) => ({
      team: st.team?.name,
      items: (st.statistics || []).map((x) => ({ type: x.type, value: x.value })),
    })),
  };
}

module.exports = {
  name: 'api-football',
  LEAGUE_IDS,
  season,
  apiPaged,
  diag,
  playerProfile,
  playerInjuryStatus,
  matchDetail,
  nationalFixtures,
  leagueRounds,
  teamOverview,
  teamUpcoming,

  async seasonStats(tracked) {
    const resolved = new Map();
    const resolvedTeams = new Map();
    const out = await mapLimit(tracked, 2, async (p) => {
      let id = p.apiFootballId;
      if (!id) {
        try {
          id = await resolveId(p);
          if (id) resolved.set(p.id, id);
          else console.warn(`[api-football] could not resolve id for ${p.name} (${p.league})`);
        } catch (e) {
          console.warn(`[api-football] id lookup failed for ${p.name}: ${e.message}`);
        }
      }
      if (!id) return { ...p, stats: null };
      try {
        const resp = await api('/players', { id, season: season() });
        // Current-club stats only. This drops national-team lines (World Cup,
        // friendlies) AND stats from a prior club in the same season — e.g. a
        // summer signing from MLS would otherwise bring their MLS numbers along.
        const entries = (resp[0]?.statistics || []).filter(
          (st) => clubMatches(st.team?.name, p.club)
        );
        const teamId = entries.find((st) => st.team?.id)?.team?.id ?? null;
        if (teamId && teamId !== p.apiFootballTeamId) resolvedTeams.set(p.id, teamId);
        return { ...p, apiFootballId: id,
          apiFootballTeamId: teamId ?? p.apiFootballTeamId ?? null,
          age: resp[0]?.player?.age ?? null,
          stats: aggregateStats(entries) };
      } catch (e) {
        console.warn(`[api-football] stats failed for ${p.name}: ${e.message}`);
        return { ...p, apiFootballId: id, stats: null };
      }
    });
    // Persist resolved player/team ids so lookups are a one-time cost.
    if (resolved.size || resolvedTeams.size) {
      try {
        const cur = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
        for (const entry of cur) {
          if (resolved.has(entry.id)) entry.apiFootballId = resolved.get(entry.id);
          if (resolvedTeams.has(entry.id)) entry.apiFootballTeamId = resolvedTeams.get(entry.id);
        }
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(cur, null, 2) + '\n');
        console.log(`[api-football] saved ${resolved.size} player ids, ${resolvedTeams.size} team ids to players.json`);
      } catch (e) {
        console.warn(`[api-football] could not persist resolved ids: ${e.message}`);
      }
    }
    return out;
  },

  async getFixtures(tracked) {
    const leagues = [...new Set(tracked.map((p) => p.league))]
      .map((l) => LEAGUE_IDS[l]).filter(Boolean);
    const cupIds = Object.values(CUP_IDS);
    const now = new Date();
    const from = new Date(now - 30 * 864e5).toISOString().slice(0, 10); // a month of results
    const to = new Date(+now + 7 * 864e5).toISOString().slice(0, 10);
    let failures = 0;
    const ids = [...leagues, ...cupIds];
    const all = await mapLimit(ids, 3, (id) =>
      api('/fixtures', { league: id, season: season(), from, to })
        .catch((e) => { failures++; console.warn(`[api-football] fixtures league ${id}: ${e.message}`); return []; })
    );
    if (failures === ids.length) {
      // Total upstream failure: throw so the cache serves stale data instead
      // of storing an empty schedule for an hour.
      throw new Error('all fixture requests failed — see /api/meta diagnostics');
    }
    return all.flat()
      .filter((fx) => tracked.some((p) => playerInFixture(p, fx)))
      .map((fx) => mapFixture(fx, tracked));
  },

  async getLive(tracked) {
    const live = await api('/fixtures', { live: 'all' });
    const relevant = live.filter((fx) => tracked.some((p) => playerInFixture(p, fx)));
    // Fetch events + lineups per relevant live fixture for tracked-player goals/squad.
    const playerEvents = new Map();
    await mapLimit(relevant, 3, async (fx) => {
      try {
        const detail = await api('/fixtures', { id: fx.fixture.id });
        const d = detail[0] || {};
        const pe = extractPlayerEvents(d);
        if (trackedOutExists(tracked, fx, pe)) {
          pe.injured = await fetchInjuredSet(fx.fixture.id);
        }
        playerEvents.set(fx.fixture.id, pe);
      } catch (e) {
        console.warn(`[api-football] live detail ${fx.fixture.id}: ${e.message}`);
      }
    });
    return relevant.map((fx) => mapFixture(fx, tracked, playerEvents));
  },
};
