// Optional sign-in via Supabase Auth (Google OAuth or an emailed magic link).
// Signing in doesn't replace the device profile — it LINKS this device to the
// account so favorites sync across devices. Configured entirely by build-time
// env vars; when they're absent (demo mode, local builds) every export
// degrades and the Favorites tab hides its sign-in section.
//
// supabase-js is loaded with a dynamic import so the auth bundle is only
// fetched on configured deployments.
import { setAuthToken, linkDevice, unlinkDevice } from './api.js';
import { syncFavorites } from './favorites.js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authConfigured = () => Boolean(URL_ && ANON);

let clientPromise = null;
function client() {
  if (!authConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(URL_, ANON));
  }
  return clientPromise;
}

const listeners = new Set();
let currentUser = null; // { id, email } | null

export const getUser = () => currentUser;
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Called once at app boot. Creating the client here (not on tab open) matters:
// it's what catches the magic-link / OAuth redirect tokens in the URL and
// completes sign-in. After any sign-in, link this device and re-sync favorites.
export async function initAuth() {
  const sb = await client();
  if (!sb) return;
  sb.auth.onAuthStateChange((_event, session) => {
    setAuthToken(session?.access_token);
    const user = session?.user ? { id: session.user.id, email: session.user.email } : null;
    const changed = (user?.id || null) !== (currentUser?.id || null);
    currentUser = user;
    if (user && changed) {
      linkDevice().then(() => syncFavorites()).catch(() => {});
    }
    listeners.forEach((l) => l(currentUser));
  });
}

export async function signInWithEmail(email) {
  const sb = await client();
  if (!sb) throw new Error('Sign-in isn’t configured.');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle() {
  const sb = await client();
  if (!sb) throw new Error('Sign-in isn’t configured.');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  const sb = await client();
  if (!sb) return;
  await unlinkDevice().catch(() => {});
  await sb.auth.signOut();
}
