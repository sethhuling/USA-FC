// Cross-checks the app's schedule against ESPN's public scoreboard feeds — an
// independent source — and reports fixtures whose kickoff, home/away order, or
// opponent disagree, plus tracked-club fixtures ESPN has that the app lacks.
// Spends ZERO API-Football requests: it reads the app's own /api/matches.
//
// For finished matches in the window it also compares every tracked American's
// start / sub / bench / out status against ESPN's lineup.
//
//   node server/scripts/check-schedule.js [appBaseUrl] [--days=N] [--back=N] [--teams] [--json]
//
// Default app URL is production. Exit code 1 when any mismatch is found.

const APP = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'https://uncle-sam-fc.onrender.com').replace(/\/$/, '');
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : def;
};
const DAYS_AHEAD = arg('days', 8);
const DAYS_BACK = arg('back', 1);
const AS_JSON = process.argv.includes('--json');
// --teams also checks the further-out fixtures on every tracked club's team
// page (the same list player profiles show), not just the Schedule tab.
const WITH_TEAMS = process.argv.includes('--teams');

// App competition label (coverage.json) → ESPN league slug. Competitions with
// no working ESPN feed are listed as null and reported as "unverifiable".
const ESPN_SLUG = {
  'Premier League': 'eng.1', Championship: 'eng.2', 'League One': 'eng.3',
  'La Liga': 'esp.1', 'La Liga 2': 'esp.2', 'Serie A': 'ita.1', 'Serie B': 'ita.2',
  Bundesliga: 'ger.1', 'Bundesliga 2': 'ger.2', 'Ligue 1': 'fra.1', 'Ligue 2': 'fra.2',
  'Liga MX': 'mex.1', Eredivisie: 'ned.1', 'Scottish Premiership': 'sco.1',
  'Primeira Liga': 'por.1', 'Belgian Pro League': 'bel.1', 'Süper Lig': 'tur.1',
  'Brasileirão': 'bra.1', 'Liga Profesional (Argentina)': 'arg.1',
  'Austrian Bundesliga': 'aut.1', 'J. League': 'jpn.1', 'A-League': 'aus.1',
  'Super League': 'sui.1', Eliteserien: 'nor.1', 'K League 1': null, Ekstraklasa: null,
  'Champions League': 'uefa.champions', 'Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa.conf', 'FA Cup': 'eng.fa', 'EFL Cup': 'eng.league_cup',
  'Copa del Rey': 'esp.copa_del_rey', 'Coppa Italia': 'ita.coppa_italia',
  'DFB Pokal': 'ger.dfb_pokal', 'Coupe de France': 'fra.coupe_de_france',
  'KNVB Beker': 'ned.cup', 'Taça de Portugal': 'por.taca.portugal',
  'Copa do Brasil': 'bra.copa_do_brazil', 'Copa Argentina': 'arg.copa',
  'Scottish Cup': 'sco.tennents', 'Scottish League Cup': 'sco.cis',
  'Belgian Cup': null, 'Turkish Cup': null, 'Austrian Cup': null, 'Polish Cup': null,
};

// Names the two feeds spell too differently for token matching.
const ALIASES = {
  'wolves': 'wolverhampton wanderers', 'qpr': 'queens park rangers',
  'sheffield utd': 'sheffield united', 'man utd': 'manchester united',
  'bayern munchen': 'bayern munich', 'inter': 'internazionale', 'as roma': 'roma',
  'psv eindhoven': 'psv', 'paris saint germain': 'paris saint-germain',
  'u.n.a.m. - pumas': 'pumas unam', 'guadalajara chivas': 'guadalajara',
  'club america': 'america', 'atletico san luis': 'san luis', 'fc juarez': 'juarez',
  'heart of midlothian': 'hearts', 'st johnstone': 'st. johnstone',
  'lask linz': 'lask', 'wsg wattens': 'wsg tirol', 'rapid vienna': 'rapid wien',
  'austria vienna': 'austria wien', 'ferencvarosi tc': 'ferencvaros',
  'fsv mainz 05': 'mainz', '1899 hoffenheim': 'tsg hoffenheim',
  'borussia monchengladbach': 'monchengladbach', 'fc koln': 'cologne',
  'raal la louviere': 'la louviere', 'oh leuven': 'oud-heverlee leuven',
  'kristiansund bk': 'kristiansund', 'sarpsborg 08 ff': 'sarpsborg 08',
  'valerenga': 'valerenga', 'celje': 'nk celje', 'rennes': 'stade rennais', 'lech poznan': 'lech poznan',
  'argentinos jrs': 'argentinos juniors', 'gimnasia l.p.': 'gimnasia la plata',
  'newells old boys': "newell's old boys", 'sarmiento junin': 'sarmiento',
  'fc anyang': 'anyang', 'ham-kam': 'hamarkameratene', 'estudiantes l.p.': 'estudiantes la plata',
  'celta de vigo ii': 'celta fortuna', 'ulsan hyundai fc': 'ulsan hd',
};

const TOKEN_ALIASES = { utd: 'united', koln: 'cologne', olympiakos: 'olympiacos', piraeus: '', 'l.p.': '' };
const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'sv', 'vfl', 'vfb', 'tsv', 'fk', 'bk', 'sk', 'cd', 'ud', 'rc', 'club', 'de', 'the', '1.', 'ssc', 'us', 'as', 'rcd', 'sd', 'ca', 'cp', 'kv', 'krc', 'nk', 'if', 'ff', 'tc', 'jk']);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/[’']/g, '').trim();
const tokens = (s) => {
  const n = norm(s);
  return new Set((ALIASES[n] || n).split(/[\s\-./()]+/).map((t) => TOKEN_ALIASES[t] || t).filter((t) => t && !STOP.has(t)));
};
function sim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if ([...B].some((u) => u === t || (t.length >= 5 && (u.startsWith(t) || t.startsWith(u))))) hit++;
  return hit / Math.min(A.size, B.size);
}

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

async function espnEvents(slug, from, to) {
  const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd(from)}-${ymd(to)}&limit=1000`);
  if (!d) return null;
  return (d.events || []).map((e) => {
    const comp = e.competitions?.[0] || {};
    const home = comp.competitors?.find((c) => c.homeAway === 'home')?.team?.displayName;
    const away = comp.competitors?.find((c) => c.homeAway === 'away')?.team?.displayName;
    return { id: e.id, kickoff: e.date, home, away, status: e.status?.type?.name, timeValid: comp.timeValid !== false };
  }).filter((e) => e.home && e.away);
}

// For a finished match, compares each tracked American's squad status in the
// app (start / on / played / bench / out) with ESPN's lineup for his side.
// A player ESPN doesn't list at all is "out" there; an ESPN lineup with no
// players (lower-division cup ties) proves nothing, so it is skipped.
// Surname tokens: everything after the first name, minus suffixes — Latin
// American double surnames ("Gómez Mendoza") often appear on ESPN with only
// the first of the two, so ANY surname token counts as a hit.
const surnames = (name) => norm(name).replace(/\b(jr|sr|ii|iii)\b\.?/g, '').split(/\s+/).filter(Boolean).slice(1).flatMap((w) => w.split('-')).filter((t) => t.length > 2 && !['de', 'la', 'del', 'van', 'von'].includes(t));
// Players ESPN lists under a different surname than the roster does.
const OTHER_SURNAMES = { 'siebatcheu-theosonjordan': ['pefok'] };

async function lineupFindings(slug, e, m, tag) {
  const s = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/summary?event=${e.id}`);
  const sides = s?.rosters || [];
  if (sides.length < 2 || sides.some((r) => !r.roster?.length)) return [];
  const out = [];
  for (const p of m.trackedPlayers) {
    const appSide = p.club === m.home ? 'home' : p.club === m.away ? 'away' : null;
    const side = sides.find((r) => r.homeAway === appSide);
    if (!side) continue;
    const keys = [...surnames(p.name), ...(OTHER_SURNAMES[p.playerId] || [])];
    const hits = side.roster.filter((r) => norm(r.athlete?.displayName || '').split(/[\s-]+/).some((t) => keys.includes(t)));
    if (hits.length > 1) continue; // two players share the surname — can't tell them apart safely
    const r = hits[0];
    const espnStatus = !r ? 'out' : r.starter ? 'start' : r.subbedIn ? 'on' : 'bench';
    const appStatus = p.squadStatus === 'played' ? 'on' : p.squadStatus;
    if (!appStatus) continue;
    if (process.env.DEBUG_LINEUPS) console.error(`${p.name} → ${r ? r.athlete.displayName : '(none)'}: app ${p.squadStatus}, espn ${espnStatus}`);
    if (appStatus !== espnStatus && !(p.squadStatus === 'played' && espnStatus === 'start')) {
      out.push({ ...tag, type: 'LINEUP', espn: `${e.home} vs ${e.away}`, players: p.name, detail: `${p.name}: app says ${p.squadStatus}, ESPN says ${espnStatus}${r ? ` (${r.athlete.displayName})` : ''}` });
    }
  }
  return out;
}

const fmtET = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function main() {
  const now = Date.now();
  const from = new Date(now - DAYS_BACK * 864e5), to = new Date(now + DAYS_AHEAD * 864e5);
  const appData = await getJson(`${APP}/api/matches`);
  if (!appData) throw new Error(`could not load ${APP}/api/matches`);
  // The Schedule tab only reaches ~a week ahead; ESPN fixtures past its last
  // kickoff aren't "missing" from it.
  const scheduleEnd = Math.max(...appData.matches.map((m) => Date.parse(m.kickoff)));
  const all = [...appData.matches];
  if (WITH_TEAMS) {
    const seen = new Set(all.map((m) => m.id));
    const teamIds = [...new Set(appData.matches.flatMap((m) => m.trackedPlayers.map((p) => (p.club === m.home ? m.homeId : p.club === m.away ? m.awayId : null))).filter(Boolean))];
    for (const id of teamIds) {
      const team = await getJson(`${APP}/api/team/${id}`);
      for (const m of team?.upcoming || []) if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
    }
  }
  const matches = all.filter((m) => {
    const t = Date.parse(m.kickoff);
    return t >= from.getTime() && t <= to.getTime();
  });

  const byComp = new Map();
  for (const m of matches) byComp.set(m.competition, [...(byComp.get(m.competition) || []), m]);

  const findings = [], unverifiable = [], ok = [];

  for (const [comp, list] of byComp) {
    const slug = ESPN_SLUG[comp];
    // Pad the ESPN window a day each way so date-shifted fixtures still pair up.
    const events = slug ? await espnEvents(slug, new Date(from.getTime() - 2 * 864e5), new Date(to.getTime() + 2 * 864e5)) : null;
    if (!events || !events.length) {
      for (const m of list) unverifiable.push({ comp, match: m, reason: slug ? 'ESPN feed empty' : 'no ESPN feed' });
      continue;
    }
    for (const m of list) {
      let best = null;
      for (const e of events) {
        const straight = Math.min(sim(m.home, e.home), sim(m.away, e.away));
        const swapped = Math.min(sim(m.home, e.away), sim(m.away, e.home));
        const one = Math.max(sim(m.home, e.home), sim(m.away, e.away), sim(m.home, e.away), sim(m.away, e.home));
        const dt = Math.abs(Date.parse(e.kickoff) - Date.parse(m.kickoff)) / 36e5;
        const score = Math.max(straight, swapped) * 2 + one - dt / 1000;
        if (!best || score > best.score) best = { e, score, straight, swapped, one, dt };
      }
      const tag = { comp, id: m.id, app: `${m.home} vs ${m.away} — ${fmtET(m.kickoff)}`, players: m.trackedPlayers.map((p) => p.name).join(', ') };
      if (!best || best.one < 0.5) {
        findings.push({ ...tag, type: 'NOT_FOUND', detail: 'no ESPN fixture with either team in this competition' });
        continue;
      }
      const { e } = best;
      const espn = `${e.home} vs ${e.away} — ${fmtET(e.kickoff)}${e.timeValid ? '' : ' (time TBD)'}`;
      if (Math.max(best.straight, best.swapped) < 0.5) {
        findings.push({ ...tag, espn, type: 'OPPONENT', detail: 'ESPN has a different opponent for this club' });
      } else if (best.swapped > best.straight) {
        findings.push({ ...tag, espn, type: 'HOME_AWAY', detail: 'home/away reversed' });
      } else if (best.dt >= 0.25 && e.timeValid) {
        findings.push({ ...tag, espn, type: 'KICKOFF', detail: `kickoff differs by ${best.dt.toFixed(2)}h` });
      } else {
        ok.push({ ...tag, espn });
      }
      e.matched = true;
      if (m.status === 'finished' && best.straight >= 0.5) findings.push(...await lineupFindings(slug, e, m, tag));
    }
    // ESPN fixtures for a tracked club in the window that the app doesn't have.
    const appTeams = new Set(list.flatMap((m) => m.trackedPlayers.map((p) => p.club)));
    for (const e of events) {
      const t = Date.parse(e.kickoff);
      if (e.matched || t < from.getTime() || t > Math.min(to.getTime(), scheduleEnd)) continue;
      const same = (a, b) => sim(a, b) >= 0.99 && tokens(a).size === tokens(b).size;
      const club = [...appTeams].find((c) => same(c, e.home) || same(c, e.away));
      if (club) findings.push({ comp, type: 'MISSING', app: '—', espn: `${e.home} vs ${e.away} — ${fmtET(e.kickoff)}`, detail: `ESPN lists a ${club} fixture the app doesn't show` });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ checked: matches.length, ok: ok.length, pairs: ok, findings, unverifiable: unverifiable.map((u) => ({ comp: u.comp, reason: u.reason, fixture: `${u.match.home} vs ${u.match.away} — ${fmtET(u.match.kickoff)}` })) }, null, 2));
  } else {
    console.log(`Checked ${matches.length} app fixtures (${fmtET(from.toISOString())} → ${fmtET(to.toISOString())}) against ESPN: ${ok.length} agree, ${findings.length} findings, ${unverifiable.length} unverifiable.\n`);
    for (const f of findings) {
      console.log(`[${f.type}] ${f.comp} (#${f.id ?? '-'}) ${f.detail}\n   app:  ${f.app}\n   espn: ${f.espn ?? '—'}${f.players ? `\n   players: ${f.players}` : ''}`);
    }
    if (unverifiable.length) {
      console.log('\nUnverifiable (no independent feed):');
      for (const u of unverifiable) console.log(`   ${u.comp}: ${u.match.home} vs ${u.match.away} — ${fmtET(u.match.kickoff)} (${u.reason})`);
    }
  }
  process.exitCode = findings.length ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exitCode = 2; });
