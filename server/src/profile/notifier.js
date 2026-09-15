// The notification engine. One 60s timer (same single-timer pattern as
// service.js's watchedLive) that turns match state into pushes for favorited
// players: kickoff reminders, live goals/assists, subbed-on, full-time
// summaries, and injury notes.
//
// Design rule: the sent_notifications table IS the state. Event keys are
// deterministic (goal:<match>:<player>:<n>, ft:<match>, …) and re-derived from
// the CURRENT snapshot every tick; a row insert with ignore-duplicates decides
// "already sent?" — so the frequent Render restarts can neither re-send nor
// drop notifications, with no tick-to-tick diffing at all.
//
// API cost: each tick calls service.getMatches(), which is exactly what one
// browser tab polling the app costs — cache hits except the hourly schedule
// refresh and the shared 60s 'live' overlay during live tracked matches. With
// zero push-subscribed devices the tick exits before touching any of it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { enabled: dbEnabled, db } = require('./supabase');
const push = require('./push');
const service = require('../service');

const TICK_MS = 60 * 1000;
const AUDIENCE_TTL_MS = 5 * 60 * 1000;
const WINDOW_PAST_MS = 5 * 60 * 60 * 1000;   // matches that kicked off < 5h ago
const WINDOW_AHEAD_MS = 40 * 60 * 1000;      // or kick off < 40min from now
const KICKOFF_LEAD_MS = 30 * 60 * 1000;      // reminder lands ≤ 30min before
const KICKOFF_STALE_MS = 5 * 60 * 1000;      // don't remind after kickoff+5min
const INJURY_FRESH_DAYS = 7;

const DEFAULT_PREFS = { goals: true, kickoff: true, subbedOn: true, fullTime: true, injury: true };

const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
});

/* ---------- Audience: push-subscribed devices with their favorites ---------- */
let audienceCache = { at: 0, value: null };
async function getAudience() {
  if (Date.now() - audienceCache.at < AUDIENCE_TTL_MS) return audienceCache.value;
  const { data, error } = await db.from('devices')
    .select('id,user_id,prefs,favorites(player_id),push_subscriptions(endpoint,p256dh,auth)');
  if (error) throw new Error(error.message);
  // A linked device sees the UNION of favorites across the user's devices —
  // including devices with no push subscription of their own.
  const userFavs = new Map();
  for (const d of data || []) {
    if (!d.user_id) continue;
    if (!userFavs.has(d.user_id)) userFavs.set(d.user_id, new Set());
    for (const f of d.favorites || []) userFavs.get(d.user_id).add(f.player_id);
  }
  const devices = (data || [])
    .filter((d) => d.push_subscriptions?.length > 0)
    .map((d) => ({
      id: d.id,
      subs: d.push_subscriptions,
      prefs: { ...DEFAULT_PREFS, ...(d.prefs || {}) },
      favs: new Set([
        ...(d.favorites || []).map((f) => f.player_id),
        ...(d.user_id ? userFavs.get(d.user_id) || [] : []),
      ]),
    }))
    .filter((d) => d.favs.size > 0);
  const allFavs = new Set(devices.flatMap((d) => [...d.favs]));
  audienceCache = { at: Date.now(), value: { devices, allFavs } };
  return audienceCache.value;
}

/* ---------- Dedupe: sent_notifications insert decides "send?" ---------- */
const sentMemo = new Set(); // `${eventKey}|${deviceId}` — saves DB churn within a process

// pending: Map "key|device" -> { device, payload }
async function deliver(pending) {
  if (!pending.size) return 0;
  const rows = [...pending.keys()].slice(0, 500).map((k) => {
    const [event_key, device_id] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)];
    return { event_key, device_id };
  });
  const { data: inserted, error } = await db.from('sent_notifications')
    .upsert(rows, { onConflict: 'event_key,device_id', ignoreDuplicates: true })
    .select('event_key,device_id');
  if (error) throw new Error(error.message);
  for (const k of pending.keys()) sentMemo.add(k); // inserted or pre-existing: never retry
  let sent = 0;
  for (const row of inserted || []) {
    const entry = pending.get(`${row.event_key}|${row.device_id}`);
    if (entry) sent += await push.sendToSubscriptions(entry.device.subs, entry.payload);
  }
  return sent;
}

const queue = (pending, device, eventKey, payload) => {
  const k = `${eventKey}|${device.id}`;
  if (!sentMemo.has(k) && !pending.has(k)) pending.set(k, { device, payload });
};

/* ---------- Event derivation ---------- */
// Does this device want a `type` alert about this player? Only favorites ever
// notify. A per-player choice (prefs.players[playerId][type], set in the
// settings sheet's Players list) wins; a type the user never touched for that
// player follows the device's global toggle for the type.
function wants(device, playerId, type) {
  if (!device.favs.has(playerId)) return false;
  const own = device.prefs.players?.[playerId]?.[type];
  return typeof own === 'boolean' ? own : device.prefs[type] !== false;
}

const score = (m) => `${m.home} ${m.homeScore ?? 0}–${m.awayScore ?? 0} ${m.away}`;

function playerLine(tp, stats) {
  const bits = [];
  const mins = stats?.minutes ?? tp.minutes;
  if (mins != null) bits.push(`${mins}′`);
  const g = stats?.goals ?? tp.goals?.length ?? 0;
  const a = stats?.assists ?? tp.assists?.length ?? 0;
  if (g) bits.push(`${g}G`);
  if (a) bits.push(`${a}A`);
  if (stats?.yellow) bits.push('🟨');
  if (stats?.red) bits.push('🟥');
  return `${tp.name}: ${bits.length ? bits.join(', ') : 'played'}`;
}

async function collectEvents(pending, audience, matches) {
  const now = Date.now();
  const relevant = matches.filter((m) => {
    const ko = new Date(m.kickoff).getTime();
    return now - ko < WINDOW_PAST_MS && ko - now < WINDOW_AHEAD_MS &&
      (m.trackedPlayers || []).some((tp) => audience.allFavs.has(tp.playerId));
  });

  for (const m of relevant) {
    const ko = new Date(m.kickoff).getTime();
    const favTracked = (m.trackedPlayers || []).filter((tp) => audience.allFavs.has(tp.playerId));

    // Kickoff reminders (per device: names its own favorites in the match that
    // have kickoff reminders on — one reminder per match, never one per player).
    if (m.status === 'scheduled' && ko - now <= KICKOFF_LEAD_MS && now - ko < KICKOFF_STALE_MS) {
      for (const device of audience.devices) {
        const mine = favTracked.filter((tp) => wants(device, tp.playerId, 'kickoff'));
        if (!mine.length) continue;
        const names = mine.map((tp) => tp.name).join(' and ');
        const where = m.streaming?.service ? ` on ${m.streaming.service}` : '';
        queue(pending, device, `kickoff:${m.id}`, {
          title: `${names} play${mine.length === 1 ? 's' : ''} soon`,
          body: `${m.home} vs ${m.away} · ${timeFmt.format(new Date(m.kickoff))} ET${where}`,
          tag: `kickoff:${m.id}`, url: '/',
        });
      }
    }

    if (m.status !== 'live' && m.status !== 'finished') continue;

    // Live (and just-finished) goals / assists / subbed on. Keys are
    // state-based (goal count n), so a restart mid-match can't double-send.
    for (const tp of favTracked) {
      (tp.goals || []).forEach((minute, i) => {
        for (const device of audience.devices) {
          if (!wants(device, tp.playerId, 'goals')) continue;
          queue(pending, device, `goal:${m.id}:${tp.playerId}:${i + 1}`, {
            title: `⚽ ${tp.name} scores!`,
            body: `${score(m)} · ${minute}′`,
            tag: `goal:${m.id}:${tp.playerId}`, url: '/',
          });
        }
      });
      (tp.assists || []).forEach((minute, i) => {
        for (const device of audience.devices) {
          if (!wants(device, tp.playerId, 'goals')) continue;
          queue(pending, device, `assist:${m.id}:${tp.playerId}:${i + 1}`, {
            title: `${tp.name} with an assist`,
            body: `${score(m)} · ${minute}′`,
            tag: `assist:${m.id}:${tp.playerId}`, url: '/',
          });
        }
      });
      if (m.status === 'live' && tp.squadStatus === 'on') {
        for (const device of audience.devices) {
          if (!wants(device, tp.playerId, 'subbedOn')) continue;
          queue(pending, device, `subon:${m.id}:${tp.playerId}`, {
            title: `${tp.name} is coming on`,
            body: `${score(m)}${m.minute ? ` · ${m.minute}′` : ''}`,
            tag: `subon:${m.id}:${tp.playerId}`, url: '/',
          });
        }
      }
    }

    // Full-time summary — one per match per device, with a line for each
    // favorite in the match whose full-time summaries are on.
    if (m.status === 'finished') {
      const targets = audience.devices.filter((d) =>
        favTracked.some((tp) => wants(d, tp.playerId, 'fullTime')) &&
        !sentMemo.has(`ft:${m.id}|${d.id}`));
      if (targets.length) {
        let stats = {};
        try { stats = (await service.getMatchDetail(m.id))?.trackedStats || {}; }
        catch { /* fall back to event-derived lines */ }
        for (const device of targets) {
          const lines = favTracked.filter((tp) => wants(device, tp.playerId, 'fullTime'))
            .map((tp) => playerLine(tp, stats[tp.playerId]));
          queue(pending, device, `ft:${m.id}`, {
            title: `FT: ${score(m)}`,
            body: lines.join(' · '),
            tag: `ft:${m.id}`, url: '/',
          });
        }
      }
    }
  }
}

/* ---------- Injury notes (hand-verified, committed by the daily routine) ---------- */
// The routine's commit triggers a deploy → restart, so the startup pass is
// exactly when new notes appear; the hourly re-read covers hand edits.
const injuryBody = (note) => `${note.reason || 'Injured'} — expected return ${note.expectedReturn || 'unknown'}`;

// Keyed by WHAT THE ALERT SAYS, never by note.verified: the daily routine
// re-verifies unchanged notes and bumps that date, which used to re-send the
// same alert (user rule, Sept 2026: an injury push goes out again only when
// its information changed). Case/whitespace-only edits don't count as changes.
function injuryKey(playerId, note) {
  const text = injuryBody(note).toLowerCase().replace(/\s+/g, ' ').trim();
  return `injury:${playerId}:${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

function collectInjuries(pending, audience) {
  let notes;
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'injury-notes.json');
    notes = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return; }
  const players = service.trackedPlayers();
  for (const [playerId, note] of Object.entries(notes)) {
    if (playerId.startsWith('_') || !note?.verified) continue;
    const age = Date.now() - new Date(`${note.verified}T12:00:00Z`).getTime();
    if (age > INJURY_FRESH_DAYS * 24 * 60 * 60 * 1000 || age < 0) continue;
    const player = players.find((p) => p.id === playerId);
    if (!player) continue;
    for (const device of audience.devices) {
      if (!wants(device, playerId, 'injury')) continue;
      queue(pending, device, injuryKey(playerId, note), {
        title: `Injury update: ${player.name}`,
        body: injuryBody(note),
        tag: `injury:${playerId}`, url: '/',
      });
    }
  }
}

/* ---------- Housekeeping ---------- */
async function cleanup() {
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  // Match events are one-offs, so a month of dedupe rows is plenty. Injury rows
  // must outlive the injury: a long layoff's note stays fresh for months, and
  // dropping its row after 30 days would re-send the same unchanged alert.
  await db.from('sent_notifications').delete().lt('sent_at', monthAgo).not('event_key', 'like', 'injury:%');
  await db.from('sent_notifications').delete().lt('sent_at', yearAgo).like('event_key', 'injury:%');
  await db.from('devices').delete().lt('last_seen_at', yearAgo); // cascades favorites/subs
}

/* ---------- The tick ---------- */
let tickCount = 0;
let running = false;
async function tick() {
  if (running) return; // a slow upstream call must not stack ticks
  running = true;
  try {
    const audience = await getAudience();
    if (audience.devices.length > 0) {
      const pending = new Map();
      const { matches } = await service.getMatches();
      await collectEvents(pending, audience, matches);
      if (tickCount % 60 === 0) collectInjuries(pending, audience); // hourly + startup
      const sent = await deliver(pending);
      if (sent > 0) console.log(`[notify] sent ${sent} notification(s)`);
    }
    tickCount++;
  } catch (e) {
    console.log(`[notify] tick failed: ${e.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (!dbEnabled || !push.enabled) {
    console.log('[notify] disabled (Supabase and/or VAPID env vars not set)');
    return;
  }
  console.log('[notify] started — checking for notification events every 60s');
  setInterval(tick, TICK_MS).unref();
  const daily = setInterval(() => cleanup().catch(() => {}), 24 * 60 * 60 * 1000);
  daily.unref();
  // Startup pass after the warm has had a moment to fill the schedule cache.
  setTimeout(() => { tick(); cleanup().catch(() => {}); }, 15 * 1000).unref();
}

// _test: key-derivation internals for hand-built-snapshot checks (demo data
// carries no assists/squadStatus/trackedStats, so those paths are verified
// against fixtures — see CLAUDE.md "Testing against real data").
module.exports = { start, _test: { collectEvents, collectInjuries, injuryKey, playerLine, wants } };
