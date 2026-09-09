// In-memory counters behind /api/admin/stats. Upstream request timestamps are
// kept for 24h (7,500/day cap makes the array small); cache counters run since
// boot — like the caches themselves, everything resets on restart.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const startedAt = new Date().toISOString();
const apiCallTimes = []; // ms timestamps of API-Football requests, oldest first
let cacheHits = 0;
let cacheMisses = 0;

function prune() {
  const cutoff = Date.now() - DAY_MS;
  while (apiCallTimes.length && apiCallTimes[0] < cutoff) apiCallTimes.shift();
}

// One call per real HTTP request to API-Football (retries count separately).
function recordApiCall() {
  apiCallTimes.push(Date.now());
  prune();
}

function recordCacheHit() { cacheHits++; }
function recordCacheMiss() { cacheMisses++; }

function snapshot() {
  prune();
  const now = Date.now();
  const hourAgo = now - HOUR_MS;
  let lastHour = 0;
  for (let i = apiCallTimes.length - 1; i >= 0 && apiCallTimes[i] > hourAgo; i--) lastHour++;
  const total = cacheHits + cacheMisses;
  return {
    serverStartedAt: startedAt,
    apiFootball: {
      requestsLastHour: lastHour,
      requestsLast24h: apiCallTimes.length,
    },
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: total ? Number((cacheHits / total).toFixed(4)) : null,
    },
  };
}

module.exports = { recordApiCall, recordCacheHit, recordCacheMiss, snapshot };
