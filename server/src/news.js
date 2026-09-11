// News tab: two parts, both built to stay legally above board.
//
// 1. Headlines — hand-picked links to stories on publishers' own sites, read
//    from server/data/news.json (maintained by a daily scheduled Claude task;
//    see CLAUDE.md). We serve ONLY the headline, the publisher's name, the date
//    and the original URL — never story text, summaries, or images. Read fresh
//    each call like the other hand-maintained data files, so edits need no
//    restart. `blockedSources` in that file hides every link to a domain
//    (honors a publisher's removal request immediately).
//
// 2. Daily roundup — plain sentences about each day's action, written by fixed
//    rules from API-Football match data we already license (no AI, nothing
//    the data doesn't say). Facts only: started / came on / unused sub, goals,
//    assists, cards, substitution minutes, the result. If a match's goal events
//    don't add up to its final score, scoring details are left out rather than
//    risk stating a wrong one.
const fs = require('fs');
const path = require('path');
const cache = require('./cache');
const provider = require('../adapters/providers');
const { NATIONAL_TEAMS } = require('./coverage');
const { getMatches, getMatchDetail, trackedPlayers } = require('./service');

const NEWS_FILE = path.join(__dirname, '..', 'data', 'news.json');
const CATEGORIES = new Set(['abroad', 'usmnt', 'youth']);
const MAX_HEADLINES = 60;
const TZ = 'America/New_York'; // roundup days are US Eastern calendar days
const ROUNDUP_DAYS = 7;
const TTL = {
  roundup: 60 * 60 * 1000,            // rebuilt hourly (and after each match window)
  roundupIncomplete: 5 * 60 * 1000,   // retry soon when a match detail failed
  national: 60 * 60 * 1000,           // national-team fixture lists
};

// ---------- Headlines ----------

function readHeadlines() {
  let file;
  try { file = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')); }
  catch (e) { console.warn(`[news] could not read news.json: ${e.message}`); return []; }
  const blocked = (file.blockedSources || []).map((d) => String(d).toLowerCase().replace(/^www\./, ''));
  const roster = new Set(trackedPlayers().map((p) => p.id));
  const seen = new Set();
  const out = [];
  for (const h of file.headlines || []) {
    let url;
    try { url = new URL(h.url); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    // Plain http is allowed only because a few small outlets (American Soccer
    // Now) serve no https — it's a link out, nothing is loaded from it.
    const valid = ['https:', 'http:'].includes(url.protocol) &&
      typeof h.title === 'string' && h.title.trim() &&
      typeof h.source === 'string' && h.source.trim() &&
      /^\d{4}-\d{2}-\d{2}$/.test(h.published || '') &&
      CATEGORIES.has(h.category);
    if (!valid) { console.warn(`[news] skipping malformed headline: ${h.url}`); continue; }
    if (blocked.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    out.push({
      title: h.title.trim(),
      source: h.source.trim(),
      url: url.href,
      published: h.published,
      category: h.category,
      players: (h.players || []).filter((id) => roster.has(id)),
      paywall: h.paywall === true,
    });
  }
  out.sort((a, b) => b.published.localeCompare(a.published));
  return out.slice(0, MAX_HEADLINES);
}

// ---------- Roundup sentence helpers ----------

const etDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const etDate = (iso) => etDateFmt.format(new Date(iso)); // YYYY-MM-DD

function recentDates(n) {
  const out = new Set();
  for (let i = 0; i < n; i++) out.add(etDate(new Date(Date.now() - i * 864e5).toISOString()));
  return out;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

// "in the 67th minute" / "in second-half stoppage time"; '' when unknown.
function whenPhrase(ev) {
  if (!ev || !Number.isFinite(ev.minute)) return '';
  if (ev.extra) {
    if (ev.minute === 45) return 'in first-half stoppage time';
    if (ev.minute === 90) return 'in second-half stoppage time';
    return 'in stoppage time';
  }
  return `in the ${ordinal(ev.minute)} minute`;
}

const minuteMark = (ev) => `${ev.minute}${ev.extra ? `+${ev.extra}` : ''}′`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function joinParts(parts) {
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const isShootout = (e) => /shootout/i.test(e.comments || '');
const isMissedPen = (e) => /missed penalty/i.test(e.detail || '');
const isOwnGoal = (e) => /own goal/i.test(e.detail || '');
const isCancelled = (e) => e.type === 'Var' && /goal (cancel|disallow)/i.test(e.detail || '');
const byClock = (a, b) => (a.minute - b.minute) || ((a.extra || 0) - (b.extra || 0));

// True when the goal events add up to the final score. If they don't (data
// still settling, a VAR decision recorded oddly), we say nothing about goals.
function scoringConsistent(d) {
  if (d.homeScore == null || d.awayScore == null) return false;
  const ev = d.events || [];
  const goals = ev.filter((e) => e.type === 'Goal' && !isShootout(e) && !isMissedPen(e)).length;
  return goals - ev.filter(isCancelled).length === d.homeScore + d.awayScore;
}

function playerFacts(d, tp) {
  const ev = d.events || [];
  const pid = tp.playerId;
  const mine = (e) => e.trackedId === pid;
  const goalEvents = ev.filter((e) => e.type === 'Goal' && mine(e) && !isShootout(e));
  const scored = goalEvents.filter((e) => !isMissedPen(e) && !isOwnGoal(e));
  const cancelled = ev.filter((e) => isCancelled(e) && mine(e)).length;
  const goals = Math.max(0, scored.length - cancelled);
  const pens = Math.min(goals, scored.filter((e) => /penalty/i.test(e.detail || '')).length);
  const assists = ev.filter((e) => e.type === 'Goal' && e.assistTrackedId === pid &&
    !isShootout(e) && !isMissedPen(e) && !isOwnGoal(e)).length;
  const cards = ev.filter((e) => e.type === 'Card' && mine(e));
  const red = cards.find((e) => /red|second yellow/i.test(e.detail || '')) || null;
  const yellow = cards.some((e) => /yellow/i.test(e.detail || '') && !/second/i.test(e.detail || ''));
  // The API's in/out slot order is unreliable, so match either slot and infer
  // direction from the squad status: a starter's first sub is going OFF; a
  // bench player's first is coming ON (and a second, if any, going off).
  const subs = ev.filter((e) => e.type === 'subst' && (e.trackedId === pid || e.assistTrackedId === pid))
    .sort(byClock);
  const subOn = tp.squadStatus === 'on' ? subs[0] || null : null;
  const subOff = tp.squadStatus === 'start' ? subs[0] || null
    : tp.squadStatus === 'on' ? subs[1] || null : null;
  return {
    goals, pens, assists,
    ownGoals: goalEvents.filter(isOwnGoal).length,
    missedPens: goalEvents.filter((e) => isMissedPen(e)).length,
    yellow, red, subOn, subOff,
  };
}

// Short name for a second mention: the surname, but ONLY for plain two-word
// names — "Konrad de La Fuente" or a double Hispanic surname can't be split
// reliably, so those keep the full name rather than risk a wrong one.
function shortNameOf(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length === 2 ? parts[1] : name;
}

// Which side a tracked player's club is on: exact team id, loose name fallback.
function sideOf(p, d) {
  if (p?.apiFootballTeamId) {
    if (p.apiFootballTeamId === d.homeId) return 'home';
    if (p.apiFootballTeamId === d.awayId) return 'away';
  }
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const club = norm(p?.club);
  const hit = (team) => { const t = norm(team); return !!t && !!club && (t === club || t.includes(club) || club.includes(t)); };
  if (hit(d.home)) return 'home';
  if (hit(d.away)) return 'away';
  return null;
}

function resultSentence(d) {
  const h = d.homeScore, a = d.awayScore;
  if (h == null || a == null) return null;
  if (d.statusShort === 'PEN' && d.penalties?.home != null && d.penalties?.away != null) {
    const homeWon = d.penalties.home > d.penalties.away;
    const [hi, lo] = homeWon ? [d.penalties.home, d.penalties.away] : [d.penalties.away, d.penalties.home];
    return `The match finished ${h}–${a}, and ${homeWon ? d.home : d.away} won ${hi}–${lo} on penalties.`;
  }
  if (h === a) return `The match ended ${h}–${a}.`;
  const aet = d.statusShort === 'AET' ? ' after extra time' : '';
  return h > a ? `${d.home} won ${h}–${a}${aet}.` : `${d.away} won ${a}–${h}${aet}.`;
}

const STATUS_ORDER = { start: 0, on: 1, bench: 2 };

// The single most positive thing in a player's stat line for this match (user
// request: "if a player had a 96% pass rate but only made 1 defensive
// contribution, mention the pass rate"). Goals and assists are stated on their
// own, so they aren't candidates. Each candidate gets a rough "how far above an
// ordinary game" score (~1 decent, ~3 excellent); the top one wins if it
// clears a minimum, otherwise nothing is added — a weak number said out loud
// reads as a knock, not a positive. Every phrase states the raw counts.
const HIGHLIGHT_MIN = 0.6;
function bestStat(s, { cleanSheet }) {
  if (!s || !(s.minutes > 0)) return null;
  const c = [];
  const add = (score, text) => { if (score > 0) c.push({ score, text }); };
  if (s.passes >= 10 && s.passesAccurate != null && s.passesAccurate <= s.passes) {
    const pct = Math.round((100 * s.passesAccurate) / s.passes);
    // Volume matters: 49 of 51 beats 9 of 10.
    if (pct >= 80) add(((pct - 78) / 6) * Math.min(1, s.passes / 30), `completed ${s.passesAccurate} of ${s.passes} passes (${pct}%)`);
  }
  if (s.keyPasses >= 2) add(s.keyPasses / 1.5, `made ${s.keyPasses} key passes`);
  const def = [[s.tackles, 'tackle'], [s.interceptions, 'interception'], [s.blocks, 'block']]
    .filter(([n]) => n > 0);
  const defTotal = def.reduce((t, [n]) => t + n, 0);
  // Parenthesized list, not "4 tackles and 2 interceptions" — the phrase is
  // itself joined with "and" into the sentence.
  if (def.length > 1 && defTotal >= 4) {
    add(defTotal / 3, `made ${defTotal} defensive contributions (${def.map(([n, w]) => plural(n, w)).join(', ')})`);
  }
  if (s.tackles >= 2) add(s.tackles / 2, `made ${plural(s.tackles, 'tackle')}`);
  if (s.interceptions >= 2) add(s.interceptions / 1.5, `made ${plural(s.interceptions, 'interception')}`);
  if (s.blocks >= 2) add(s.blocks / 1.5, `made ${plural(s.blocks, 'block')}`);
  if (s.duels > 0 && s.duelsWon >= 5 && s.duelsWon / s.duels >= 0.6) {
    add((s.duelsWon / 4) * (s.duelsWon / s.duels / 0.6), `won ${s.duelsWon} of ${s.duels} duels`);
  }
  if (s.dribblesWon >= 2 && s.dribbles >= s.dribblesWon) add(s.dribblesWon / 1.5, `completed ${s.dribblesWon} of ${s.dribbles} dribbles`);
  if (s.shotsOn >= 2) add(s.shotsOn / 1.5, `put ${plural(s.shotsOn, 'shot')} on target`);
  if (s.foulsDrawn >= 3) add(s.foulsDrawn / 2.5, `drew ${plural(s.foulsDrawn, 'foul')}`);
  if (s.position === 'G') {
    if (s.saves >= 2) add(s.saves / 2, `made ${plural(s.saves, 'save')}`);
    if (cleanSheet) add(3, 'kept a clean sheet');
  }
  if (s.penSaved >= 1) add(4, s.penSaved === 1 ? 'saved a penalty' : `saved ${s.penSaved} penalties`);
  if (s.penWon >= 1) add(2.5, s.penWon === 1 ? 'won a penalty' : `won ${s.penWon} penalties`);
  c.sort((a, b) => b.score - a.score);
  return c[0] && c[0].score >= HIGHLIGHT_MIN ? c[0].text : null;
}

// One club match → sentences about every tracked American who started, came
// on, or sat unused on the bench. Players left out of the squad aren't mentioned.
function clubEntry(d, rosterById) {
  const involved = (d.trackedPlayers || []).filter((tp) => tp.squadStatus in STATUS_ORDER);
  if (!involved.length) return null;
  const scoringOk = scoringConsistent(d);
  const neutral = /^final$/i.test(d.round || '');
  const shorts = involved.map((tp) => shortNameOf(tp.name));
  // Two Americans sharing a surname in one match both keep their full names.
  const shortName = (tp) => {
    const s = shortNameOf(tp.name);
    return shorts.filter((x) => x === s).length > 1 ? tp.name : s;
  };
  const facts = new Map(involved.map((tp) => [tp.playerId, playerFacts(d, tp)]));
  const onMinute = (tp) => facts.get(tp.playerId).subOn?.minute ?? 999;

  const sentences = [];
  const scorers = [];
  let contextGiven = false;
  for (const side of ['home', 'away']) {
    const list = involved
      .filter((tp) => sideOf(rosterById.get(tp.playerId) || tp, d) === side)
      // Starters, then subs in the order they came on, then unused subs.
      .sort((a, b) => (STATUS_ORDER[a.squadStatus] - STATUS_ORDER[b.squadStatus]) ||
        (a.squadStatus === 'on' ? onMinute(a) - onMinute(b) : 0));
    const team = d[side];
    const opp = d[side === 'home' ? 'away' : 'home'];
    const context = neutral ? `as they faced ${opp}`
      : side === 'home' ? `as they hosted ${opp}` : `as they visited ${opp}`;
    list.forEach((tp, i) => {
      const f = facts.get(tp.playerId);
      const also = i > 0 && list[i - 1].squadStatus === tp.squadStatus ? 'also ' : '';
      const ctx = contextGiven ? '' : ` ${context}`;
      const onWhen = whenPhrase(f.subOn);
      if (tp.squadStatus === 'start') {
        sentences.push(`${tp.name} ${also}started for ${team}${ctx}.`);
      } else if (tp.squadStatus === 'on') {
        sentences.push(`${tp.name} ${also}came off the bench for ${team}${onWhen ? ` ${onWhen}` : ''}${ctx}.`);
      } else {
        sentences.push(`${tp.name} was ${also}an unused substitute for ${team}${ctx}.`);
      }
      contextGiven = true;
      if (tp.squadStatus === 'bench') return;

      const parts = [];
      if (tp.squadStatus === 'start' && !f.subOff && !f.red) {
        // Only claim a full match when the minutes back it up — a sub event
        // can be missing its player (seen in real data).
        if (tp.minutes != null && tp.minutes >= 90) parts.push('played the full match');
        else if (tp.minutes != null && tp.minutes > 0) parts.push(`played ${tp.minutes} minutes`);
      }
      if (scoringOk) {
        if (f.goals) {
          const pens = !f.pens ? ''
            : f.pens === f.goals ? (f.goals === 1 ? ' from the penalty spot' : ', all from the penalty spot')
            : ` (${f.pens} from the penalty spot)`;
          parts.push(`scored ${plural(f.goals, 'goal')}${pens}`);
        }
        if (f.assists) parts.push(`had ${plural(f.assists, 'assist')}`);
        if (f.goals || f.assists) scorers.push({ id: tp.playerId, name: tp.name, short: shortNameOf(tp.name), team, goals: f.goals, assists: f.assists });
      }
      // A keeper's clean sheet: the whole match played and the opponent
      // scored nothing (from the final score — the API's conceded field is null).
      const oppScore = side === 'home' ? d.awayScore : d.homeScore;
      const stats = d.trackedStats?.[tp.playerId];
      const highlight = bestStat(stats, {
        cleanSheet: oppScore === 0 && stats?.minutes >= 90 && !f.subOff && !f.red,
      });
      if (highlight) parts.push(highlight);
      if (scoringOk) {
        if (f.ownGoals) parts.push(f.ownGoals === 1 ? 'scored an own goal' : `scored ${f.ownGoals} own goals`);
        if (f.missedPens) parts.push(f.missedPens === 1 ? 'missed a penalty' : `missed ${f.missedPens} penalties`);
      }
      if (f.yellow && !f.red) parts.push('was shown a yellow card');
      if (f.red) parts.push(`was sent off${whenPhrase(f.red) ? ` ${whenPhrase(f.red)}` : ''}`);
      else if (f.subOff) parts.push(`was subbed off${whenPhrase(f.subOff) ? ` ${whenPhrase(f.subOff)}` : ''}`);
      if (parts.length) sentences.push(`${shortName(tp)} ${joinParts(parts)}.`);
    });
  }
  // The article subhead already shows the score, so the result sentence is
  // left out (user request) — except when extra time or a shootout decided it,
  // which the score line alone doesn't say.
  const result = ['AET', 'PEN'].includes(d.statusShort) ? resultSentence(d) : null;
  if (result) sentences.push(result);
  return {
    id: d.id, kind: 'club', category: 'abroad', status: 'finished',
    competition: d.competition, kickoff: d.kickoff,
    home: d.home, away: d.away, homeId: d.homeId, awayId: d.awayId,
    homeScore: d.homeScore, awayScore: d.awayScore,
    sentences,
    players: involved.map((tp) => tp.playerId),
    // For the article's headline/summary and story order.
    played: involved.filter((tp) => tp.squadStatus !== 'bench').map((tp) => tp.playerId),
    scorers,
  };
}

// One national-team match (first team or youth) → result, U.S. scorers, and
// any U.S. red card. Names come from the match data (youth rosters are often
// abbreviated there, e.g. "J. Terry"); tracked players get their full name.
function nationalEntry(d, nt, usSide, rosterById) {
  const us = d[usSide];
  // Youth opponents carry an age tag in the data ("Mexico U20") that the
  // label already implies — "the U.S. U-20s lost 2–0 to Mexico".
  const opp = (d[usSide === 'home' ? 'away' : 'home'] || '').replace(/\s+U-?\d{2}(\s+W)?$/i, '');
  const u = usSide === 'home' ? d.homeScore : d.awayScore;
  const o = usSide === 'home' ? d.awayScore : d.homeScore;
  if (u == null || o == null) return null;
  const Label = nt.label.charAt(0).toUpperCase() + nt.label.slice(1);
  const aet = d.statusShort === 'AET' ? ' after extra time' : '';
  const sentences = [];
  if (d.statusShort === 'PEN' && d.penalties?.home != null && d.penalties?.away != null) {
    const up = usSide === 'home' ? d.penalties.home : d.penalties.away;
    const op = usSide === 'home' ? d.penalties.away : d.penalties.home;
    sentences.push(`${Label} drew ${u}–${o} with ${opp} and ${up > op ? 'won' : 'lost'} ${Math.max(up, op)}–${Math.min(up, op)} on penalties.`);
  } else if (u > o) sentences.push(`${Label} beat ${opp} ${u}–${o}${aet}.`);
  else if (u < o) sentences.push(`${Label} lost ${o}–${u} to ${opp}${aet}.`);
  else sentences.push(`${Label} drew ${u}–${o} with ${opp}.`);

  const nameOf = (e) => (e.trackedId && rosterById.get(e.trackedId)?.name) || e.player;
  const ev = d.events || [];
  if (scoringConsistent(d)) {
    const scorers = new Map();
    for (const e of ev.filter((x) => x.type === 'Goal' && x.team === us && x.player &&
      !isShootout(x) && !isMissedPen(x) && !isOwnGoal(x)).sort(byClock)) {
      const n = nameOf(e);
      if (!scorers.has(n)) scorers.set(n, []);
      scorers.get(n).push(minuteMark(e));
    }
    const list = [...scorers].map(([n, mins]) => `${n} (${mins.join(', ')})`);
    const total = [...scorers.values()].reduce((s, m) => s + m.length, 0);
    if (list.length) sentences.push(`The U.S. ${total === 1 ? 'goal' : 'goals'} came from ${joinParts(list)}.`);
  }
  for (const e of ev.filter((x) => x.type === 'Card' && x.team === us && x.player &&
    /red|second yellow/i.test(x.detail || ''))) {
    const when = whenPhrase(e);
    sentences.push(`${nameOf(e)} was sent off${when ? ` ${when}` : ''}.`);
  }
  const players = [...new Set(ev.map((e) => e.trackedId).filter(Boolean))];
  return {
    id: d.id, kind: 'national', category: nt.category, team: nt.key, status: 'finished',
    competition: d.competition, kickoff: d.kickoff,
    home: d.home, away: d.away, homeId: d.homeId, awayId: d.awayId,
    homeScore: d.homeScore, awayScore: d.awayScore,
    sentences, players,
    // Headline form of the result: "USMNT beat Chile 2–1".
    summary: sentences[0].replace(/^The /, '').replace(/\.$/, ''),
  };
}

// ---------- Daily article: headline, summary, story order ----------

const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' });
// Midday UTC on that date is the same calendar day in US Eastern.
const weekdayOf = (date) => weekdayFmt.format(new Date(`${date}T17:00:00Z`));

const namesList = (names, max = 3) => (names.length <= max
  ? joinParts(names)
  : `${names.slice(0, max - 1).join(', ')} and ${names.length - (max - 1)} others`);

// Everything here is derived from the day's entries — counts and names only.
function dayArticle(date, entries) {
  const club = entries.filter((e) => e.kind === 'club');
  const national = entries.filter((e) => e.kind === 'national');
  const played = new Set(club.flatMap((e) => e.played)).size;
  const scorers = club.flatMap((e) => e.scorers).filter((s) => s.goals > 0)
    .sort((a, b) => b.goals - a.goals);
  const americans = `${played} American${played === 1 ? '' : 's'}`;
  const see = played === 1 ? 'sees' : 'see';

  let title;
  if (national.length) {
    title = national[0].summary;
  } else if (scorers.length === 1) {
    const s = scorers[0];
    title = `${s.short} scores${s.goals > 1 ? ` ${s.goals === 2 ? 'twice' : `${s.goals} goals`}` : ''} for ${s.team}` +
      (played > 1 ? ` as ${americans} ${see} action` : '');
  } else if (scorers.length > 1) {
    title = `${namesList(scorers.map((s) => s.short))} score as ${americans} ${see} action`;
  } else if (played > 0) {
    title = `${americans} ${see} action on ${weekdayOf(date)}`;
  } else {
    title = `${weekdayOf(date)}'s Americans abroad roundup`;
  }

  const dek = [];
  for (const n of national) dek.push(n.sentences[0]);
  if (played > 0) {
    dek.push(`${americans} played for ${played === 1 ? 'a club' : 'their clubs'} abroad` +
      (scorers.length ? `, and ${namesList(scorers.map((s) => s.name))} scored.` : '.'));
  }

  // Story order: national teams, then matches where Americans scored or
  // assisted (biggest contributions first), then everything else by kickoff.
  const weight = (e) => (e.scorers || []).reduce((t, s) => t + 3 * s.goals + 2 * s.assists, 0);
  const matches = [...entries].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === 'national' ? -1 : 1) ||
    weight(b) - weight(a) ||
    new Date(a.kickoff) - new Date(b.kickoff));

  return {
    date,
    title,
    dek: dek.join(' '),
    categories: [...new Set(entries.map((e) => e.category))],
    matches,
  };
}

// ---------- Roundup build + cache ----------

async function buildRoundup() {
  const dates = recentDates(ROUNDUP_DAYS);
  const tracked = trackedPlayers();
  const rosterById = new Map(tracked.map((p) => [p.id, p]));
  let incomplete = false;
  const entries = [];

  const detailFor = async (id) => {
    try {
      const d = await getMatchDetail(id);
      if (d?.status === 'finished') return d;
    } catch { /* fall through */ }
    incomplete = true;
    return null;
  };

  const { matches } = await getMatches();
  const club = matches.filter((m) =>
    m.status === 'finished' && m.trackedPlayers.length > 0 && dates.has(etDate(m.kickoff)));
  for (const m of club) {
    const d = await detailFor(m.id);
    const entry = d && clubEntry(d, rosterById);
    if (entry) entries.push(entry);
  }

  if (provider.nationalFixtures && NATIONAL_TEAMS.size) {
    const national = await cache.wrap('national-fixtures', TTL.national,
      () => provider.nationalFixtures([...NATIONAL_TEAMS.keys()], tracked));
    const seen = new Set(entries.map((e) => e.id));
    for (const m of national) {
      if (m.status !== 'finished' || seen.has(m.id) || !dates.has(etDate(m.kickoff))) continue;
      seen.add(m.id);
      const d = await detailFor(m.id);
      if (!d) continue;
      const usSide = NATIONAL_TEAMS.has(d.homeId) ? 'home' : NATIONAL_TEAMS.has(d.awayId) ? 'away' : null;
      const nt = NATIONAL_TEAMS.get(usSide === 'home' ? d.homeId : d.awayId);
      const entry = usSide && nationalEntry(d, nt, usSide, rosterById);
      if (entry) entries.push(entry);
    }
  }

  const byDay = new Map();
  for (const e of entries) {
    const day = etDate(e.kickoff);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const days = [...byDay]
    .sort(([a], [b]) => b.localeCompare(a)) // newest day first
    .map(([date, list]) => dayArticle(date, list));
  return { days, generatedAt: new Date().toISOString(), incomplete };
}

let building = null;
function getRoundup() {
  const hit = cache.peek('roundup');
  if (hit) return Promise.resolve(hit);
  if (!building) {
    building = buildRoundup()
      .then((r) => {
        cache.set('roundup', r.incomplete ? TTL.roundupIncomplete : TTL.roundup, r);
        return r;
      })
      .finally(() => { building = null; });
  }
  return building;
}

async function getNews() {
  let roundup = null;
  try { roundup = await getRoundup(); }
  catch (e) { console.warn(`[news] roundup failed: ${e.message}`); }
  return {
    headlines: readHeadlines(),
    roundup: roundup?.days || [],
    roundupGeneratedAt: roundup?.generatedAt || null,
  };
}

module.exports = { getNews, getRoundup, buildRoundup, clubEntry, nationalEntry };
