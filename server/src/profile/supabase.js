// Server-side Supabase access. ALL database reads/writes go through this
// service-role client — the browser never touches the database directly (RLS is
// enabled with zero policies, so the public anon key can do nothing). When the
// env vars are unset (demo mode, local dev without Supabase) `enabled` is false
// and every profile feature degrades gracefully.
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const enabled = Boolean(url && serviceKey);

const db = enabled
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Resolve a user's Supabase access token (JWT) to their user id. Uses the auth
// server (no extra deps, trivial volume here); memoized per token for 5 min so
// a signed-in session costs ~1 auth call per device per window.
const tokenCache = new Map(); // token -> { user, expires }
async function getUserFromToken(jwt) {
  if (!enabled || !jwt) return null;
  const hit = tokenCache.get(jwt);
  if (hit && hit.expires > Date.now()) return hit.user;
  try {
    const { data, error } = await db.auth.getUser(jwt);
    const user = error ? null : { id: data.user.id, email: data.user.email };
    tokenCache.set(jwt, { user, expires: Date.now() + 5 * 60 * 1000 });
    if (tokenCache.size > 500) {
      for (const [k, v] of tokenCache) if (v.expires < Date.now()) tokenCache.delete(k);
    }
    return user;
  } catch {
    return null;
  }
}

module.exports = { enabled, db, getUserFromToken };
