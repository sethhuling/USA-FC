import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { fetchPlayerProfile } from '../api.js';
import { leagueCountry, NATIONALITY, isNationalTeam } from '../leagues.js';
import { getSetting } from '../settings.js';
import { FixtureLine } from './TeamSheet.jsx';

const ProfileContext = createContext(() => {});
export const useOpenProfile = () => useContext(ProfileContext);

const CAN_HOVER = typeof window !== 'undefined'
  && window.matchMedia?.('(hover: hover)').matches;

function ageFrom(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

function hometown(bio) {
  if (!bio?.birth) return null;
  return [bio.birth.place, bio.birth.state, bio.birth.country].filter(Boolean).join(', ');
}

// API values are metric (cm / kg, sometimes with units attached). Display
// follows the per-user "units" setting (imperial by default).
function formatHeight(h) {
  const cm = parseInt(String(h), 10);
  if (!cm || Number.isNaN(cm)) return String(h);
  if (getSetting('units') === 'metric') return `${cm} cm`;
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}

function formatWeight(w) {
  const kg = parseInt(String(w), 10);
  if (!kg || Number.isNaN(kg)) return String(w);
  if (getSetting('units') === 'metric') return `${kg} kg`;
  return `${Math.round(kg * 2.20462)} lbs`;
}

function seasonLabel(y) {
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

/* ---------- Injury / availability (server: API-Football injury reports) ---------- */
// Noon anchor so a bare YYYY-MM-DD never shifts a day in US timezones.
function fmtDay(d) {
  return new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The report's reason is shown verbatim, but the headline distinguishes real
// injuries from suspensions and squad omissions the same feed reports.
function injuryLabel(inj) {
  if (/suspend/i.test(inj.reason || '')) return 'Suspended';
  if (inj.status === 'doubtful') return 'Doubtful';
  if (inj.reason && !/inactive|coach|national|international|personal|rest/i.test(inj.reason)) {
    return 'Injured';
  }
  return 'Unavailable';
}

// Headline is the injury itself ("Hamstring Injury"); the classifying label
// stands in when the API's reason is missing or just the bare word "Injury".
function injuryTitle(inj) {
  const reason = (inj.reason || '').trim();
  if (!reason || /^injur(y|ed)$/i.test(reason)) return injuryLabel(inj);
  return reason;
}

// expectedReturn is either an API date (never happens today — the API has no
// such field) or hand-verified free text from injury-notes.json ("late October").
function fmtReturn(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDay(v) : v;
}

function InjuryBanner({ inj }) {
  const label = injuryLabel(inj);
  const when = label === 'Doubtful'
    ? (inj.upcomingRuledOut ? `Doubtful for the ${fmtDay(inj.upcomingRuledOut)} fixture` : 'Doubtful')
    : `${label === 'Injured' ? 'Injured' : 'Out since'} ${fmtDay(inj.since)}`;
  const ret = `Expected return ${inj.expectedReturn ? fmtReturn(inj.expectedReturn) : 'unknown'}`;
  return (
    <div className="injury-banner">
      <span className="inj-cross banner-cross">✚</span>
      <div>
        <div className="injury-title">{injuryTitle(inj)}</div>
        <div className="injury-detail">{when} · {ret}</div>
      </div>
    </div>
  );
}

/* ---------- Hover preview card ---------- */
function HoverCard({ player, profile, pos }) {
  const bio = profile?.bio;
  const s = player.stats;
  const style = {
    left: Math.min(pos.x, window.innerWidth - 280),
    top: pos.y + 14 + 220 > window.innerHeight ? pos.y - 234 : pos.y + 14,
  };
  return (
    <div className="hovercard" style={style}>
      <div className="hovercard-top">
        {bio?.photo
          ? <img src={bio.photo} alt="" className="hovercard-photo" />
          : <div className="hovercard-photo placeholder">👤</div>}
        <div>
          <div className="hovercard-name">{player.name}</div>
          <div className="hovercard-sub">
            {player.position} · {player.club}
            {leagueCountry(player.league) && ` (${leagueCountry(player.league)})`}
          </div>
          <div className="hovercard-sub">
            {bio ? [
              bio.birth?.date && `${ageFrom(bio.birth.date)} yrs`,
              hometown(bio),
            ].filter(Boolean).join(' · ') : 'Loading profile…'}
          </div>
          {profile?.injury && (
            <div className="hovercard-sub hovercard-injury">
              <span className="inj-cross">✚</span>
              {injuryTitle(profile.injury)}
            </div>
          )}
        </div>
      </div>
      {s && (
        <div className="hovercard-stats">
          {[['Apps', s.appearances], ['Goals', s.goals], ['Assists', s.assists], ['Min', s.minutes]]
            .map(([k, v]) => (
              <div key={k}><span className="mini-num">{v ?? '—'}</span><span className="mini-label">{k}</span></div>
            ))}
        </div>
      )}
      <div className="hovercard-hint">Click for full profile</div>
    </div>
  );
}

/* ---------- Clickable / hoverable player name ---------- */
export function PlayerLink({ player, className, children }) {
  const open = useOpenProfile();
  const [hover, setHover] = useState(null); // {x, y}
  const [profile, setProfile] = useState(null);
  const timer = useRef(null);

  const onEnter = (e) => {
    if (!CAN_HOVER) return;
    const rect = e.currentTarget.getBoundingClientRect();
    timer.current = setTimeout(() => {
      setHover({ x: rect.left, y: rect.bottom });
      fetchPlayerProfile(player.id).then(setProfile).catch(() => {});
    }, 250);
  };
  const onLeave = () => { clearTimeout(timer.current); setHover(null); };

  return (
    <span
      className={`player-link ${className || ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => { e.stopPropagation(); onLeave(); open(player); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') open(player); }}
    >
      {children ?? player.name}
      {hover && createPortal(
        <HoverCard player={player} profile={profile} pos={hover} />, document.body)}
    </span>
  );
}

/* ---------- Full profile sheet ---------- */
function ProfileSheet({ player, onClose }) {
  const [profile, setProfile] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setProfile(null); setFailed(false);
    fetchPlayerProfile(player.id).then(setProfile).catch(() => setFailed(true));
  }, [player.id]);

  const bio = profile?.bio;
  // Hand-verified roster data (players.json): other national teams the player
  // could still represent. Shown only here in the profile view.
  const elig = profile?.player?.otherEligibility || player.otherEligibility;
  const s = profile?.player?.stats || player.stats;
  const statRows = s ? [
    ['Apps', s.appearances], ['Starts', s.starts], ['Minutes', s.minutes], ['Goals', s.goals],
    ['Assists', s.assists], ['Tackles', s.tackles], ['Intercepts', s.interceptions],
    // API-Football provides blocks, not clearances (the server's `clearances`
    // field carries blocks) — label it honestly.
    ['Blocks', s.clearances],
    ['Def. actions', (s.tackles || 0) + (s.interceptions || 0) + (s.clearances || 0)],
    ['Passes', s.passesCompleted],
    ['Pass %', s.passAccuracy != null ? `${s.passAccuracy}%` : '—'],
    ['Yellows', s.yellow], ['Reds', s.red],
  ] : [];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header player-hero">
          <div className="profile-id">
            {bio?.photo
              ? <img src={bio.photo} alt="" className="profile-photo" />
              : <div className="profile-photo placeholder">👤</div>}
            <div>
              <h3>{player.name}</h3>
              <p className="sheet-sub">
                {player.position} · {player.club}
                {leagueCountry(player.league) && ` (${leagueCountry(player.league)})`} · {player.league}
              </p>
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {profile?.injury && <InjuryBanner inj={profile.injury} />}

        {!profile && !failed && <p className="empty">Loading full profile…</p>}
        {failed && <p className="empty">Couldn’t load the extended profile right now.</p>}
        {profile?.demo && (
          <p className="empty">Demo mode — photos, hometowns and career history need an API key.</p>
        )}

        {(bio || elig?.length > 0) && (
          <section className="p-section">
          <h4 className="profile-h">Profile</h4>
          <div className="bio-grid">
            {bio?.birth?.date && (
              <div><span className="bio-label">Born</span>
                {new Date(bio.birth.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                {` (${ageFrom(bio.birth.date)})`}</div>
            )}
            {hometown(bio) && <div><span className="bio-label">Hometown</span>{hometown(bio)}</div>}
            {bio?.height && <div><span className="bio-label">Height</span>{formatHeight(bio.height)}</div>}
            {bio?.weight && <div><span className="bio-label">Weight</span>{formatWeight(bio.weight)}</div>}
            <div><span className="bio-label">Nationality</span>{player.nationality}</div>
            {elig?.length > 0 && (
              <div><span className="bio-label">Also eligible</span>{elig.join(', ')}</div>
            )}
          </div>
          </section>
        )}

        {s && (
          <section className="p-section">
            <h4 className="profile-h">This season</h4>
            <div className="stat-tiles">
              {statRows.map(([k, v]) => (
                <div key={k} className="stat-tile">
                  <span className="val">{v ?? '—'}</span>
                  <span className="lab">{k}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {profile?.upcoming?.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">Upcoming games · {player.club}</h4>
            <ul className="fixture-list">
              {profile.upcoming.map((mm) => (
                <FixtureLine key={mm.id} m={mm} teamId={profile.player?.apiFootballTeamId} />
              ))}
            </ul>
          </section>
        )}

        {profile?.career?.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">Career</h4>
            <div className="table-wrap">
              <table className="career">
                <thead>
                  <tr><th>Season</th><th>Team</th><th className="num">Apps</th>
                    <th className="num">G</th><th className="num">A</th><th className="num">Min</th></tr>
                </thead>
                <tbody>
                  {profile.career.map((r, i) => (
                    <tr key={i}>
                      <td>{seasonLabel(r.season)}</td>
                      <td title={r.leagues}>{r.team}</td>
                      <td className="num">{r.apps}</td>
                      <td className="num">{r.goals}</td>
                      <td className="num">{r.assists}</td>
                      <td className="num">{r.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {profile?.national?.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">{NATIONALITY} national team</h4>
            <div className="table-wrap">
              <table className="career">
                <tbody>
                  {profile.national.map((r, i) => (
                    <tr key={i}>
                      <td>{r.season}</td>
                      <td title={r.leagues}>{isNationalTeam(r.team) ? (r.leagues || r.team) : r.team}</td>
                      <td className="num">{r.apps} caps</td>
                      <td className="num">{r.goals} G</td>
                      <td className="num">{r.assists} A</td>
                      <td className="num">{r.minutes}′</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {profile?.transfers?.length > 0 && (
          <section className="p-section">
            <h4 className="profile-h">Transfers</h4>
            <ul className="transfer-list">
              {profile.transfers.map((t, i) => (
                <li key={i}>
                  <span className="transfer-date">
                    {t.date ? new Date(t.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—'}
                  </span>
                  {t.from} → <strong>{t.to}</strong>
                  {t.type && <span className="transfer-type"> · {t.type}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export function ProfileProvider({ children }) {
  const [selected, setSelected] = useState(null);
  const open = useCallback((p) => setSelected(p), []);
  return (
    <ProfileContext.Provider value={open}>
      {children}
      {selected && createPortal(
        <ProfileSheet player={selected} onClose={() => setSelected(null)} />, document.body)}
    </ProfileContext.Provider>
  );
}
