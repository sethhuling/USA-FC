// Web Push sender (VAPID via the `web-push` package — no Firebase). Reads a
// device's subscriptions from Supabase, sends, and prunes subscriptions the
// push service reports dead (404/410). Configured by VAPID_* env vars; when
// they're missing `enabled` is false and nothing sends.
const webpush = require('web-push');
const { enabled: dbEnabled, db } = require('./supabase');
const metrics = require('../metrics');

const pub = process.env.VAPID_PUBLIC_KEY;
const priv = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:UncleSamFCapp@gmail.com';
const enabled = Boolean(dbEnabled && pub && priv);

if (enabled) webpush.setVapidDetails(subject, pub, priv);

// payload: { title, body, tag, url } — rendered by the sw.js push handler.
// Returns how many notifications were actually handed to a push service.
async function sendToSubscriptions(subs, payload) {
  let sent = 0;
  const body = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 } // an hour-old goal alert is stale; let the service drop it
      );
      sent++;
      metrics.recordPushSent?.();
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription is gone (app removed, permission revoked) — prune it.
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        console.log('[push] pruned dead subscription');
      } else {
        metrics.recordPushError?.();
        console.log(`[push] send failed: ${err.statusCode || err.message}`);
      }
    }
  }
  return sent;
}

async function sendToDevice(deviceId, payload) {
  if (!enabled) return 0;
  const { data: subs, error } = await db.from('push_subscriptions')
    .select('endpoint,p256dh,auth').eq('device_id', deviceId);
  if (error || !subs?.length) return 0;
  return sendToSubscriptions(subs, payload);
}

module.exports = { enabled, publicKey: pub || null, sendToDevice, sendToSubscriptions };
