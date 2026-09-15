// Cross-checks the app's schedule against independent fixture sources
// (schedule-sources.js) and reports fixtures whose kickoff, home/away order, or
// opponent disagree, plus tracked-club fixtures a source has that the app lacks.
// Spends ZERO API-Football requests: it reads the app's own /api/matches.
//
// ESPN was REMOVED (Sept 15, 2026): espn.com's robots.txt disallows
// anthropic-ai, and the Disney Terms of Use that cover ESPN forbid automated
// access/data mining and any commercial use. Don't re-add it. Competitions
// without an allowed source are listed as unverifiable; a licensed second data
// provider is the intended replacement.
//
//   node server/scripts/check-schedule.js [appBaseUrl] [--days=N] [--back=N] [--teams] [--json]
//
// Default app URL is production. Exit code 1 when any mismatch is found.

// Record every request's outcome per host, so a blocked or failing source is
// reported as exactly that — not silently counted as "no fixtures". Cloud
// routines sit behind a network allowlist; a blocked host answers 403 with a
// proxy message, which the report quotes. Installed before the sources module
// loads so its requests are recorded too.
const access = new Map(); // host -> { ok, failures: Map(detail -> count) }
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const host = new URL(typeof input === 'string' ? input : input.url).host;
  const rec = access.get(host) || { ok: 0, failures: new Map() };
  access.set(host, rec);
  const fail = (detail) => rec.failures.set(detail, (rec.failures.get(detail) || 0) + 1);
  try {
    const res = await realFetch(input, init);
    if (res.ok) rec.ok++;
    else {
      const body = await res.clone().text().catch(() => '');
      fail(`HTTP ${res.status}${body ? `: ${body.replace(/\s+/g, ' ').slice(0, 100)}` : ''}`);
    }
    return res;
  } catch (e) {
    fail(`network error: ${e.cause?.code || e.cause?.message || e.message}`);
    throw e;
  }
};
const hostFailed = (host) => { const r = access.get(host); return Boolean(r && r.failures.size && !r.ok); };

const { BACKUP_SOURCES, NO_SOURCE_REASONS } = require('./schedule-sources');

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

const TOKEN_ALIASES = { utd: 'united', koln: 'cologne', olympiakos: 'olympiacos', piraeus: '', 'l.p.': '', kulubu: '' };
const STOP = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'sv', 'vfl', 'vfb', 'tsv', 'fk', 'bk', 'sk', 'cd', 'ud', 'rc', 'club', 'de', 'the', '1.', 'ssc', 'us', 'as', 'rcd', 'sd', 'ca', 'cp', 'kv', 'krc', 'nk', 'if', 'ff', 'tc', 'jk']);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/ı/g, 'i')
  .replace(/[’']/g, '').trim();
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
      if (r.status < 500 && r.status !== 429) return null; // blocked / not found: retrying won't help
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

const fmtET = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function main() {
  const now = Date.now();
  const from = new Date(now - DAYS_BACK * 864e5), to = new Date(now + DAYS_AHEAD * 864e5);
  const appData = await getJson(`${APP}/api/matches`);
  if (!appData) throw new Error(`could not load ${APP}/api/matches`);
  // The Schedule tab only reaches ~a week ahead; source fixtures past its last
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
    // Pad the source window two days each way so date-shifted fixtures still pair up.
    const padFrom = new Date(from.getTime() - 2 * 864e5), padTo = new Date(to.getTime() + 2 * 864e5);
    let events = null;
    let source = null;
    let reason = NO_SOURCE_REASONS[comp] ? `no allowed source (${NO_SOURCE_REASONS[comp]})` : 'no allowed source';
    if (BACKUP_SOURCES[comp]) {
      const backup = BACKUP_SOURCES[comp];
      source = backup.label;
      events = await backup.fetch(padFrom, padTo).catch(() => null);
      if (events) events = events.filter((e) => Date.parse(e.kickoff) >= padFrom.getTime() && Date.parse(e.kickoff) <= padTo.getTime());
      reason = `${backup.label} ${events ? 'has no fixtures in this window' : 'could not be loaded (see Source access problems)'}`;
    }
    if (!events || !events.length) {
      for (const m of list) unverifiable.push({ comp, match: m, reason });
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
        findings.push({ ...tag, source, type: 'NOT_FOUND', detail: `no ${source} fixture with either team in this competition` });
        continue;
      }
      const { e } = best;
      const ref = `${e.home} vs ${e.away} — ${fmtET(e.kickoff)}${e.timeValid ? '' : ' (time TBD)'}`;
      if (Math.max(best.straight, best.swapped) < 0.5) {
        findings.push({ ...tag, source, ref, type: 'OPPONENT', detail: `${source} has a different opponent for this club` });
      } else if (best.swapped > best.straight) {
        findings.push({ ...tag, source, ref, type: 'HOME_AWAY', detail: 'home/away reversed' });
      } else if (best.dt >= 0.25 && e.timeValid) {
        findings.push({ ...tag, source, ref, type: 'KICKOFF', detail: `kickoff differs by ${best.dt.toFixed(2)}h` });
      } else if (best.dt >= 36 && !e.timeValid) {
        // Untimed on the source side: only a different DAY is a finding.
        findings.push({ ...tag, source, ref, type: 'DATE', detail: `date differs (source has no kickoff time yet)` });
      } else {
        ok.push({ ...tag, source, ref });
      }
      e.matched = true;
    }
    // Source fixtures for a tracked club in the window that the app doesn't have.
    const appTeams = new Set(list.flatMap((m) => m.trackedPlayers.map((p) => p.club)));
    for (const e of events) {
      const t = Date.parse(e.kickoff);
      if (e.matched || t < from.getTime() || t > Math.min(to.getTime(), scheduleEnd)) continue;
      const same = (a, b) => sim(a, b) >= 0.99 && tokens(a).size === tokens(b).size;
      const club = [...appTeams].find((c) => same(c, e.home) || same(c, e.away));
      if (club) findings.push({ comp, source, type: 'MISSING', app: '—', ref: `${e.home} vs ${e.away} — ${fmtET(e.kickoff)}`, detail: `${source} lists a ${club} fixture the app doesn't show` });
    }
  }

  const accessProblems = [...access].filter(([, r]) => r.failures.size)
    .map(([host, r]) => ({ host, okRequests: r.ok, failures: Object.fromEntries(r.failures), blocked: !r.ok }));
  if (AS_JSON) {
    console.log(JSON.stringify({ accessProblems, checked: matches.length, ok: ok.length, pairs: ok, findings, unverifiable: unverifiable.map((u) => ({ comp: u.comp, reason: u.reason, fixture: `${u.match.home} vs ${u.match.away} — ${fmtET(u.match.kickoff)}` })) }, null, 2));
  } else {
    const bySource = {};
    for (const o of ok) bySource[o.source] = (bySource[o.source] || 0) + 1;
    console.log(`Checked ${matches.length} app fixtures (${fmtET(from.toISOString())} → ${fmtET(to.toISOString())}): ${ok.length} agree (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}), ${findings.length} findings, ${unverifiable.length} unverifiable.\n`);
    for (const f of findings) {
      console.log(`[${f.type}] ${f.comp} (#${f.id ?? '-'}) ${f.detail}\n   app:    ${f.app}\n   source: ${f.ref ?? '—'} [${f.source}]${f.players ? `\n   players: ${f.players}` : ''}`);
    }
    if (accessProblems.length) {
      console.log('\nSource access problems (a host with 0 successful requests was unreachable — in a cloud routine usually the network allowlist):');
      for (const a of accessProblems) {
        console.log(`   ${a.host}: ${a.okRequests} ok; ${Object.entries(a.failures).map(([d, n]) => `${n}× ${d}`).join('; ')}`);
      }
    }
    if (unverifiable.length) {
      console.log('\nUnverifiable (no independent feed):');
      for (const u of unverifiable) console.log(`   ${u.comp}: ${u.match.home} vs ${u.match.away} — ${fmtET(u.match.kickoff)} (${u.reason})`);
    }
  }
  process.exitCode = findings.length ? 1 : 0;
}

main().catch((e) => { console.error(e.message); process.exitCode = 2; });
