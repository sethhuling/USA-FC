// TTL cache. In-flight de-duplication so concurrent requests share one upstream call.
const metrics = require('./metrics');
const store = new Map();
const inflight = new Map();

async function wrap(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) { metrics.recordCacheHit(); return hit.value; }
  if (inflight.has(key)) { metrics.recordCacheHit(); return inflight.get(key); }
  metrics.recordCacheMiss();
  const p = Promise.resolve()
    .then(fn)
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      // Serve stale data on upstream failure if we have any.
      if (hit) return hit.value;
      throw err;
    });
  inflight.set(key, p);
  return p;
}

// Non-fetching read: value if fresh, undefined on miss/expiry.
function peek(key) {
  const hit = store.get(key);
  return hit && hit.expires > Date.now() ? hit.value : undefined;
}

// Store a value directly — for cases where the TTL depends on the fetched result.
function set(key, ttlMs, value) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Drop a key so the next wrap() call fetches fresh — used by the warmer to
// force-refresh caches whose TTL hasn't expired (e.g. stats right after a match).
function del(key) {
  store.delete(key);
}

module.exports = { wrap, peek, set, del };
