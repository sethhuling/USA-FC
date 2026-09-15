// Backup fixture sources for check-schedule.js, for competitions ESPN's feeds
// don't carry. Each source returns fixtures as
//   { home, away, kickoff: ISO-8601 UTC, timeValid: boolean }
// where timeValid=false means the source has a date but no kickoff time yet
// (rounds the league hasn't timed), so a kickoff difference isn't a finding.
//
// Source policy (Sept 2026): only sites whose robots.txt doesn't shut out AI
// agents — this check runs inside a Claude cloud routine. ekstraklasa.org,
// oefb.at (and the Austrian alternatives ligaportal.at /
// fussballoesterreich.at) disallow Claude, so they are NOT used: Ekstraklasa
// falls back to 90minut.pl and the Austrian Cup stays unverifiable. Official
// sources' terms (K League, TFF) restrict republishing their data — this is
// internal verification only; never display or store what these return.
//
// Season-specific ids below (90minut league pages, RBFA series) change every
// summer. A stale id shows up as an empty feed in the report — update it then.

const SEASON_IDS = {
  // 90minut.pl league pages, 2026/2027
  ekstraklasa90: 14675,
  polishCup90: 14679,
  // RBFA "Croky Cup" series, 2026/2027
  rbfaCup: 'CUP_3726',
};

// Local wall-clock time in an IANA zone -> UTC ISO string (DST-safe).
function zonedToUtc(y, mo, d, h, mi, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const offset = (t) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t).toISOString();
}

async function getText(url, { encoding = 'utf-8', ...init } = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) return new TextDecoder(encoding).decode(Buffer.from(await r.arrayBuffer()));
      if (r.status < 500 && r.status !== 429) return null; // blocked / not found: retrying won't help
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  return null;
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- 90minut.pl (Polish results site; no robots.txt restrictions) ---------- */
const PL_MONTHS = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
  lipca: 7, sierpnia: 8, września: 9, października: 10, listopada: 11, grudnia: 12,
};

async function from90minut(leagueId) {
  const html = await getText(`http://www.90minut.pl/liga/1/liga${leagueId}.html`, { encoding: 'iso-8859-2' });
  if (!html) return null;
  const season = html.match(/(20\d\d)\/(20\d\d)/); // "2026/2027" in the title
  if (!season) return null;
  const yearFor = (month) => (month >= 7 ? +season[1] : +season[2]);
  const out = [];
  let roundDate = null; // first date in the round header, for untimed rows
  // Walk round headers and fixture rows in page order.
  const re = /<b><u>([^<]*)<\/u><\/b>\s*<\/td>\s*<\/tr>\s*<\/table>|<tr align="left">\s*<td nowrap valign="top" width="180">([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td nowrap valign="top" width="180">([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      const hd = m[1].match(/(\d{1,2})(?:-\d{1,2})?\s+([a-ząćęłńóśźż]+)/i);
      roundDate = hd && PL_MONTHS[hd[2].toLowerCase()] ? { d: +hd[1], mo: PL_MONTHS[hd[2].toLowerCase()] } : null;
      continue;
    }
    const home = stripTags(m[2]), away = stripTags(m[4]), when = stripTags(m[5]);
    if (!home || !away) continue;
    const dm = when.match(/(\d{1,2})\s+([a-ząćęłńóśźż]+)(?:,\s*(\d{1,2}):(\d{2}))?/i);
    const mo = dm && PL_MONTHS[dm[2].toLowerCase()];
    if (mo) {
      const timed = dm[3] !== undefined;
      out.push({ home, away, kickoff: zonedToUtc(yearFor(mo), mo, +dm[1], timed ? +dm[3] : 12, timed ? +dm[4] : 0, 'Europe/Warsaw'), timeValid: timed });
    } else if (roundDate) {
      out.push({ home, away, kickoff: zonedToUtc(yearFor(roundDate.mo), roundDate.mo, roundDate.d, 12, 0, 'Europe/Warsaw'), timeValid: false });
    }
  }
  return out;
}

/* ---------- K League (official: kleague.com schedule JSON) ---------- */
async function kLeague1(from, to) {
  // changeLang.do TOGGLES the session language, so flip until it reports English.
  let cookie = '';
  for (let i = 0; i < 2; i++) {
    const r = await fetch('https://www.kleague.com/changeLang.do', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: '{}',
    }).catch(() => null);
    if (!r?.ok) break;
    const set = r.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = [...new Map([...cookie.split('; ').filter(Boolean), ...set].map((c) => [c.split('=')[0], c])).values()].join('; ');
    const lang = (await r.json().catch(() => ({})))?.data?.lang;
    if (lang === 'en') break;
  }
  const months = new Set();
  for (let t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); t <= to; t.setUTCMonth(t.getUTCMonth() + 1)) {
    months.add(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const out = [];
  for (const ym of months) {
    const [year, month] = ym.split('-');
    const r = await fetch('https://www.kleague.com/getScheduleList.do', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
      body: JSON.stringify({ leagueId: '1', year, month }),
    }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (!j) return null;
    for (const g of j.data?.scheduleList || []) {
      const [y, mo, d] = String(g.gameDate).split('.').map(Number);
      const tm = String(g.gameTime || '').match(/^(\d{1,2}):(\d{2})$/);
      out.push({
        home: g.homeTeamName, away: g.awayTeamName,
        kickoff: zonedToUtc(y, mo, d, tm ? +tm[1] : 12, tm ? +tm[2] : 0, 'Asia/Seoul'), timeValid: Boolean(tm),
      });
    }
  }
  return out;
}

/* ---------- Belgian Cup (official: RBFA GraphQL) ---------- */
async function belgianCup(from, to) {
  const day = (d) => d.toISOString().slice(0, 10);
  const r = await fetch('https://datalake-prod2018.rbfa.be/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query($seriesId:ID!,$startDate:String!,$endDate:String!,$language:Language!){seriesCalendar(seriesId:$seriesId,startDate:$startDate,endDate:$endDate,language:$language){id startTime homeTeam{name} awayTeam{name}}}',
      variables: { seriesId: SEASON_IDS.rbfaCup, startDate: day(from), endDate: day(to), language: 'nl' },
    }),
  }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (!j?.data?.seriesCalendar) return null;
  return j.data.seriesCalendar.map((g) => {
    const m = String(g.startTime).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); // Brussels local, no offset
    return m && {
      home: g.homeTeam?.name, away: g.awayTeam?.name,
      kickoff: zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], 'Europe/Brussels'), timeValid: !(m[4] === '00' && m[5] === '00'),
    };
  }).filter((g) => g?.home && g.away);
}

/* ---------- Turkish Cup (official: tff.org, current round only) ---------- */
const TR_MONTHS = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 };
async function turkishCup() {
  const html = await getText('https://www.tff.org/default.aspx?pageID=598', { encoding: 'windows-1254' });
  if (!html) return null;
  const rows = new Map(); // "ctlNN" -> { tarih, t1, t2 }
  for (const m of html.matchAll(/id="[^"]*kupaMaclari_(ctl\d+)_(lblTarih|lblTakim1|lblTakim2)"[^>]*>([^<]*)</g)) {
    if (!rows.has(m[1])) rows.set(m[1], {});
    rows.get(m[1])[m[2]] = m[3].trim();
  }
  const out = [];
  for (const r of rows.values()) {
    const dm = (r.lblTarih || '').match(/(\d{1,2})\s+(\S+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    const mo = dm && TR_MONTHS[dm[2].toLocaleLowerCase('tr')];
    if (!mo || !r.lblTakim1 || !r.lblTakim2) continue;
    const timed = dm[4] !== undefined;
    out.push({
      home: r.lblTakim1, away: r.lblTakim2,
      kickoff: zonedToUtc(+dm[3], mo, +dm[1], timed ? +dm[4] : 12, timed ? +dm[5] : 0, 'Europe/Istanbul'), timeValid: timed,
    });
  }
  return out;
}

// Competition (coverage.json name) -> { label, official, fetch(from, to) }.
const BACKUP_SOURCES = {
  Ekstraklasa: { label: '90minut.pl', official: false, fetch: () => from90minut(SEASON_IDS.ekstraklasa90) },
  'Polish Cup': { label: '90minut.pl', official: false, fetch: () => from90minut(SEASON_IDS.polishCup90) },
  'K League 1': { label: 'kleague.com (official)', official: true, fetch: kLeague1 },
  'Belgian Cup': { label: 'RBFA (official)', official: true, fetch: belgianCup },
  'Turkish Cup': { label: 'TFF (official, current round only)', official: true, fetch: turkishCup },
};

// Competitions with no usable second source, and why (shown in the report).
const NO_SOURCE_REASONS = {
  'Austrian Cup': 'ÖFB and the Austrian alternatives (ligaportal.at, fussballoesterreich.at) block AI agents in robots.txt',
};

module.exports = { BACKUP_SOURCES, NO_SOURCE_REASONS, zonedToUtc, _test: { from90minut, kLeague1, belgianCup, turkishCup } };
