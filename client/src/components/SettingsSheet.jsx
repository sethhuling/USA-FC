import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getSetting, setSetting } from '../settings.js';
import { fetchMe, savePrefs } from '../api.js';
import {
  pushSupported, isIOS, isStandalone, getExistingSubscription, enablePush, disablePush,
} from '../push.js';
import {
  authConfigured, getUser, onAuthChange, signInWithEmail, signInWithGoogle, signOut,
} from '../auth.js';

// The app's control center, opened from the gear in the topbar's left corner:
// notification settings, the optional account, and display settings. Same
// portal/backdrop pattern as the player/match/team sheets. The MVPs tab keeps
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

function NotificationsSection({ me, refreshMe }) {
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
            Only players you’ve starred in the MVPs tab trigger notifications.
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
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthChange(setUser), []);

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
  const sendLink = async () => {
    setBusy(true); setErr(null);
    try { await signInWithEmail(email.trim()); setSent(true); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <p className="club-note">
        Optional — sign in to use the same favorites on your phone and tablet.
      </p>
      {sent ? (
        <p className="club-note"><strong>Check your email</strong> — tap the sign-in link we sent to {email.trim()}.</p>
      ) : (
        <div className="signin">
          <button className="btn-primary" onClick={() => signInWithGoogle().catch((e) => setErr(e.message))}>
            Continue with Google
          </button>
          <div className="signin-or">or</div>
          <div className="signin-row">
            <input
              className="search signin-input" type="email" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
              onKeyDown={(e) => { if (e.key === 'Enter' && email.includes('@')) sendLink(); }}
            />
            <button className="btn-ghost" disabled={busy || !email.includes('@')} onClick={sendLink}>
              Email me a link
            </button>
          </div>
        </div>
      )}
      {err && <p className="club-note error-note">{err}</p>}
    </>
  );
}

export default function SettingsSheet({ onClose }) {
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
          <NotificationsSection me={me} refreshMe={refreshMe} />
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
