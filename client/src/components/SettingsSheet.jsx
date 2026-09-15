import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSetting, setSetting } from '../settings.js';
import { fetchMe, savePrefs, savePlayerPrefs } from '../api.js';
import { useFavorites } from '../favorites.js';
import {
  pushSupported, isIOS, isStandalone, getExistingSubscription, enablePush, disablePush,
} from '../push.js';
import {
  authConfigured, getUser, onAuthChange, signInWithEmail, verifyEmailCode,
  signInWithGoogle, signOut,
} from '../auth.js';

// The app's control center, opened from the gear in the topbar's left corner:
// notification settings, the optional account, and display settings. Same
// portal/backdrop pattern as the player/match/team sheets. The Favorites tab keeps
// only the favorites themselves.

const PREFS = [
  ['goals', 'Goals & assists', 'The moment a favorite scores or assists'],
  ['subbedOn', 'Subbed on', 'When a favorite comes off the bench'],
  ['kickoff', 'Kickoff reminders', '30 minutes before a favorite plays, with where to watch'],
  ['fullTime', 'Full-time summary', 'Result and your player’s stat line after the match'],
  ['injury', 'Injury news', 'When a verified injury note is added for a favorite'],
];

function Toggle({ on, onChange, label }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

// "Players" dropdown under the global toggles: every favorite, each opening its
// own set of the same five toggles. A type the user hasn't touched for a player
// shows (and follows) the global toggle; flipping it stores a choice for that
// player alone, which "Use my default settings" clears again.
function PlayerNotifications({ players, prefs, setPrefs }) {
  const favs = useFavorites();
  const [open, setOpen] = useState(false);
  const [openPlayer, setOpenPlayer] = useState(null);
  const favorites = useMemo(
    () => (players || []).filter((p) => favs.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [players, favs],
  );

  const choicesFor = (id) => prefs.players?.[id] || {};
  const apply = (id, nextChoices, body) => {
    const nextPlayers = { ...(prefs.players || {}) };
    if (Object.keys(nextChoices).length) nextPlayers[id] = nextChoices;
    else delete nextPlayers[id];
    setPrefs({ ...prefs, players: nextPlayers });
    savePlayerPrefs(id, body).catch(() => {});
  };
  const setChoice = (id, key, value) => apply(id, { ...choicesFor(id), [key]: value }, { [key]: value });
  const reset = (id) => apply(id, {}, { reset: true });

  return (
    <div className={`pp${open ? ' open' : ''}`}>
      <button className="pp-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="spell-caret">▸</span>
        <span className="pref-label">Players</span>
        <span className="pp-count">{favorites.length}</span>
      </button>
      {open && (
        favorites.length === 0 ? (
          <p className="club-note">
            Star players to fine-tune their notifications one by one.
          </p>
        ) : (
          <ul className="pp-list">
            {favorites.map((p) => {
              const choices = choicesFor(p.id);
              const custom = PREFS.some(([key]) => typeof choices[key] === 'boolean');
              const isOpen = openPlayer === p.id;
              return (
                <li key={p.id} className={`pp-player${isOpen ? ' open' : ''}`}>
                  <button
                    className="pp-player-toggle" aria-expanded={isOpen}
                    onClick={() => setOpenPlayer(isOpen ? null : p.id)}
                  >
                    <span className="spell-caret">▸</span>
                    <span className="pp-name">
                      <span className="pref-label">{p.name}</span>
                      <span className="pref-sub">{p.club} · {custom ? 'Custom' : 'Your defaults'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <>
                      <ul className="pref-list pp-prefs">
                        {PREFS.map(([key, label]) => {
                          const on = typeof choices[key] === 'boolean' ? choices[key] : prefs[key] !== false;
                          return (
                            <li key={key} className="pref-row">
                              <div className="pref-label">{label}</div>
                              <Toggle on={on} onChange={(v) => setChoice(p.id, key, v)} label={`${label} for ${p.name}`} />
                            </li>
                          );
                        })}
                      </ul>
                      {custom && (
                        <button className="btn-ghost pp-reset" onClick={() => reset(p.id)}>
                          Use my default settings
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}

function NotificationsSection({ me, refreshMe, players }) {
  const [subscribed, setSubscribed] = useState(null); // null = still checking
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    getExistingSubscription().then((s) => setSubscribed(Boolean(s))).catch(() => setSubscribed(false));
  }, []);
  useEffect(() => { if (me?.prefs) setPrefs(me.prefs); }, [me]);

  const serverReady = me?.enabled && me?.vapidPublicKey;

  if (!pushSupported()) {
    if (isIOS() && !isStandalone()) {
      return (
        <p className="club-note">
          To get notifications on iPhone or iPad, first add Uncle Sam FC to your Home
          Screen: tap the Share button in Safari, choose <strong>Add to Home Screen</strong>,
          then open the app from its icon and come back here.
        </p>
      );
    }
    return <p className="club-note">Push notifications aren’t supported in this browser.</p>;
  }
  if (me && !serverReady) {
    return <p className="club-note">Notifications aren’t set up on this server yet.</p>;
  }

  const onEnable = async () => {
    setBusy(true); setNote(null);
    try {
      await enablePush(me.vapidPublicKey);
      setSubscribed(true);
      setNote('Notifications are on for this device. 🇺🇸');
      refreshMe();
    } catch (e) { setNote(e.message); }
    setBusy(false);
  };
  const onDisable = async () => {
    setBusy(true); setNote(null);
    try { await disablePush(); setSubscribed(false); } catch { /* best effort */ }
    setBusy(false);
  };
  const setPref = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs({ [key]: value }).catch(() => {});
  };

  return (
    <>
      {!subscribed && (
        <>
          <p className="club-note">
            Get a push when your favorite players score, start, or make headlines.
            Only players you’ve starred in the Favorites tab trigger notifications.
          </p>
          <button className="btn-primary" disabled={busy || subscribed === null || !me} onClick={onEnable}>
            Enable notifications
          </button>
        </>
      )}
      {subscribed && prefs && (
        <>
          <ul className="pref-list">
            {PREFS.map(([key, label, sub]) => (
              <li key={key} className="pref-row">
                <div>
                  <div className="pref-label">{label}</div>
                  <div className="pref-sub">{sub}</div>
                </div>
                <Toggle on={prefs[key] !== false} onChange={(v) => setPref(key, v)} label={label} />
              </li>
            ))}
          </ul>
          <PlayerNotifications players={players} prefs={prefs} setPrefs={setPrefs} />
          <div className="club-actions">
            <button className="btn-ghost danger" disabled={busy} onClick={onDisable}>Turn off on this device</button>
          </div>
        </>
      )}
      {note && <p className="club-note">{note}</p>}
    </>
  );
}

function AccountSection({ me }) {
  const [user, setUser] = useState(getUser());
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthChange(setUser), []);

  // Inside the installed iOS app, OAuth (and magic-link taps) complete in a
  // separate browser context whose session iOS won't share with the app — the
  // typed email code is the only flow that lands here. Hide Google there.
  const inIOSApp = isIOS() && isStandalone();

  if (!authConfigured() || !me?.enabled) {
    return (
      <p className="club-note">
        Favorites are saved on this device{me?.enabled ? '' : ' (sync isn’t set up on this server)'}.
      </p>
    );
  }
  if (user) {
    return (
      <>
        <p className="club-note">
          Signed in as <strong>{user.email}</strong>. Favorites sync across your signed-in devices.
        </p>
        <button className="btn-ghost" onClick={() => signOut()}>Sign out</button>
      </>
    );
  }
  const sendCode = async () => {
    setBusy(true); setErr(null);
    try { await signInWithEmail(email.trim()); setSent(true); setCode(''); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const submitCode = async () => {
    setBusy(true); setErr(null);
    try { await verifyEmailCode(email.trim(), code); } // success fires onAuthChange
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <p className="club-note">
        Optional — sign in to use the same favorites on your phone and tablet.
      </p>
      {sent ? (
        <div className="signin">
          <p className="club-note">
            <strong>Check your email</strong> — enter the 6-digit code we sent
            to {email.trim()}.{!inIOSApp && ' (The link in the email works too.)'}
          </p>
          <div className="signin-row">
            <input
              className="search signin-input code-input" type="text" inputMode="numeric"
              autoComplete="one-time-code" maxLength={6} placeholder="123456"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label="6-digit sign-in code"
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submitCode(); }}
            />
            <button className="btn-ghost" disabled={busy || code.length !== 6} onClick={submitCode}>
              Sign in
            </button>
          </div>
          <button className="btn-ghost resend" disabled={busy} onClick={sendCode}>Resend email</button>
        </div>
      ) : (
        <div className="signin">
          {!inIOSApp && (
            <>
              <button className="btn-primary" onClick={() => signInWithGoogle().catch((e) => setErr(e.message))}>
                Continue with Google
              </button>
              <div className="signin-or">or</div>
            </>
          )}
          <div className="signin-row">
            <input
              className="search signin-input" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
              onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@')) sendCode(); }}
            />
            <button className="btn-ghost" disabled={busy || !email.includes('@')} onClick={sendCode}>
              Email me a code
            </button>
          </div>
        </div>
      )}
      {err && <p className="club-note error-note">{err}</p>}
    </>
  );
}

export default function SettingsSheet({ players, onClose }) {
  const [units, setUnits] = useState(() => getSetting('units'));
  const [me, setMe] = useState(null);

  const refreshMe = () => fetchMe().then(setMe).catch(() => setMe({ enabled: false }));
  useEffect(() => { refreshMe(); }, []);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet settings-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h3>Settings</h3>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <section className="p-section">
          <h4 className="profile-h">Notifications</h4>
          <NotificationsSection me={me} refreshMe={refreshMe} players={players} />
        </section>

        <section className="p-section">
          <h4 className="profile-h">Account</h4>
          <AccountSection me={me} />
        </section>

        <section className="p-section">
          <h4 className="profile-h">Display</h4>
          <div className="pref-row">
            <div>
              <div className="pref-label">Height & weight units</div>
              <div className="pref-sub">How player measurements are shown</div>
            </div>
            <div className="fchips">
              {[['imperial', 'ft / lbs'], ['metric', 'cm / kg']].map(([val, label]) => (
                <button key={val}
                  className={units === val ? 'fchip active' : 'fchip'}
                  onClick={() => { setSetting('units', val); setUnits(val); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <footer className="news-footer">
          <p>
            Uncle Sam FC is an independent fan app, not affiliated with or endorsed by
            U.S. Soccer or any club, league, or publisher.
          </p>
          <p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a></p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
