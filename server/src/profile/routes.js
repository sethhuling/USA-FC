// /api/me — per-device profiles: favorites, notification prefs, push
// subscriptions, optional account linking. Identity is the anonymous device
// UUID the client mints (x-device-id header): unguessable, and every endpoint
// only reads/writes that device's own rows, so it needs no password. Signing in
// (Supabase JWT in Authorization) links the device to a user; a linked device's
// favorites are the UNION across the user's devices, which is what makes
// merge-on-sign-in automatic.
const express = require('express');
const { enabled, db, getUserFromToken } = require('./supabase');
const push = require('./push');
const { trackedPlayers } = require('../service');

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREF_KEYS = ['goals', 'kickoff', 'subbedOn', 'fullTime', 'injury'];
const DEFAULT_PREFS = { goals: true, kickoff: true, subbedOn: true, fullTime: true, injury: true };
const MAX_FAVORITES = 200;
const MAX_SUBSCRIPTIONS = 3;

// Device-row upsert (bump last_seen_at), memoized so it costs one write per
// device per 10 min rather than one per request.
const deviceSeen = new Map(); // deviceId -> ms of last upsert
async function ensureDevice(id) {
  const last = deviceSeen.get(id);
  if (last && Date.now() - last < 10 * 60 * 1000) return;
  deviceSeen.set(id, Date.now());
  if (deviceSeen.size > 5000) {
    for (const [k, v] of deviceSeen) if (Date.now() - v > 60 * 60 * 1000) deviceSeen.delete(k);
  }
  const { error } = await db.from('devices')
    .upsert({ id, last_seen_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) { deviceSeen.delete(id); throw new Error(error.message); }
}

router.use(async (req, res, next) => {
  if (!enabled) {
    if (req.method === 'GET') return res.json({ enabled: false, vapidPublicKey: null });
    return res.status(503).json({ error: 'profiles not configured' });
  }
  const id = String(req.headers['x-device-id'] || '');
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'missing or invalid x-device-id' });
  req.deviceId = id.toLowerCase();
  try { await ensureDevice(req.deviceId); next(); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

const fail = (res, e) => res.status(502).json({ error: e.message || 'database error' });
const throwIf = (error) => { if (error) throw new Error(error.message); };

async function getDeviceRow(deviceId) {
  const { data, error } = await db.from('devices')
    .select('id,user_id,prefs').eq('id', deviceId).single();
  throwIf(error);
  return data;
}

// The device ids whose favorites this device sees: its own, plus — when linked
// to a user — every other device of that user.
async function visibleDeviceIds(device) {
  if (!device.user_id) return [device.id];
  const { data, error } = await db.from('devices').select('id').eq('user_id', device.user_id);
  throwIf(error);
  const ids = new Set((data || []).map((d) => d.id));
  ids.add(device.id);
  return [...ids];
}

async function favoritesFor(device) {
  const ids = await visibleDeviceIds(device);
  const { data, error } = await db.from('favorites').select('player_id').in('device_id', ids);
  throwIf(error);
  return [...new Set((data || []).map((f) => f.player_id))];
}

router.get('/', async (req, res) => {
  try {
    const device = await getDeviceRow(req.deviceId);
    const favorites = await favoritesFor(device);
    const { count } = await db.from('push_subscriptions')
      .select('endpoint', { count: 'exact', head: true }).eq('device_id', req.deviceId);
    res.json({
      enabled: true,
      deviceId: req.deviceId,
      user: device.user_id ? { id: device.user_id } : null,
      favorites,
      prefs: { ...DEFAULT_PREFS, ...(device.prefs || {}) },
      pushSubscribed: (count || 0) > 0,
      vapidPublicKey: push.publicKey,
    });
  } catch (e) { fail(res, e); }
});

router.put('/favorites/:playerId', async (req, res) => {
  try {
    const playerId = String(req.params.playerId);
    if (!trackedPlayers().some((p) => p.id === playerId)) {
      return res.status(404).json({ error: 'unknown player' });
    }
    const { count } = await db.from('favorites')
      .select('player_id', { count: 'exact', head: true }).eq('device_id', req.deviceId);
    if ((count || 0) >= MAX_FAVORITES) return res.status(429).json({ error: 'favorite limit reached' });
    const { error } = await db.from('favorites')
      .upsert({ device_id: req.deviceId, player_id: playerId },
        { onConflict: 'device_id,player_id', ignoreDuplicates: true });
    throwIf(error);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.delete('/favorites/:playerId', async (req, res) => {
  try {
    const playerId = String(req.params.playerId);
    // Delete across the user's devices when linked — the union would otherwise
    // resurrect the favorite on the next sync.
    const device = await getDeviceRow(req.deviceId);
    const ids = await visibleDeviceIds(device);
    const { error } = await db.from('favorites')
      .delete().in('device_id', ids).eq('player_id', playerId);
    throwIf(error);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.put('/prefs', async (req, res) => {
  try {
    const patch = {};
    for (const k of PREF_KEYS) {
      if (typeof req.body?.[k] === 'boolean') patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'no valid prefs' });
    const device = await getDeviceRow(req.deviceId);
    const prefs = { ...DEFAULT_PREFS, ...(device.prefs || {}), ...patch };
    const { error } = await db.from('devices').update({ prefs }).eq('id', req.deviceId);
    throwIf(error);
    res.json({ ok: true, prefs });
  } catch (e) { fail(res, e); }
});

router.post('/push', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 ||
        typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string' ||
        keys.p256dh.length > 300 || keys.auth.length > 100) {
      return res.status(400).json({ error: 'invalid subscription' });
    }
    const { error } = await db.from('push_subscriptions')
      .upsert({ endpoint, device_id: req.deviceId, p256dh: keys.p256dh, auth: keys.auth },
        { onConflict: 'endpoint' });
    throwIf(error);
    // A device's endpoint rotates on resubscribe — keep only the newest few.
    const { data: subs } = await db.from('push_subscriptions')
      .select('endpoint,created_at').eq('device_id', req.deviceId)
      .order('created_at', { ascending: false });
    for (const s of (subs || []).slice(MAX_SUBSCRIPTIONS)) {
      await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.delete('/push', async (req, res) => {
  try {
    const { error } = await db.from('push_subscriptions').delete().eq('device_id', req.deviceId);
    throwIf(error);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

router.post('/push/test', async (req, res) => {
  try {
    if (!push.enabled) return res.status(503).json({ error: 'push not configured' });
    const sent = await push.sendToDevice(req.deviceId, {
      title: 'Uncle Sam FC',
      body: 'Test notification — you’re all set! 🇺🇸',
      tag: 'test',
      url: '/',
    });
    if (!sent) return res.status(404).json({ error: 'no subscription on this device' });
    res.json({ ok: true, sent });
  } catch (e) { fail(res, e); }
});

router.post('/link', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = await getUserFromToken(jwt);
    if (!user) return res.status(401).json({ error: 'invalid or missing token' });
    const { error } = await db.from('devices').update({ user_id: user.id }).eq('id', req.deviceId);
    throwIf(error);
    res.json({ ok: true, user: { id: user.id } });
  } catch (e) { fail(res, e); }
});

router.post('/unlink', async (req, res) => {
  try {
    const { error } = await db.from('devices').update({ user_id: null }).eq('id', req.deviceId);
    throwIf(error);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

module.exports = router;
