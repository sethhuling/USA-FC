import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { fetchPlayerProfile } from '../api.js';
import { leagueCountry } from '../leagues.js';

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
  return [bio.birth.place, bio.birth.country].filter(Boolean).join(', ');
}

function seasonLabel(y) {
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
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
  const s = profile?.player?.stats || player.stats;
  const statRows = s ? [
    ['Appearances', s.appearances], ['Minutes', s.minutes], ['Goals', s.goals],
    ['Assists', s.assists], ['Tackles', s.tackles], ['Interceptions', s.interceptions],
    ['Clearances/blocks', s.clearances],
    ['Defensive actions', (s.tackles || 0) + (s.interceptions || 0) + (s.clearances || 0)],
    ['Passes completed', s.passesCompleted],
    ['Pass accuracy', s.passAccuracy != null ? `${s.passAccuracy}%` : '—'],
    ['Yellow cards', s.yellow], ['Red cards', s.red],
  ] : [];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
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

        {!profile && !failed && <p className="empty">Loading full profile…</p>}
        {failed && <p className="empty">Couldn’t load the extended profile right now.</p>}
        {profile?.demo && (
          <p className="empty">Demo mode — photos, hometowns and career history need an API key.</p>
        )}

        {bio && (
          <div className="bio-grid">
            {bio.birth?.date && (
              <div><span className="bio-label">Born</span>
                {new Date(bio.birth.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                {` (${ageFrom(bio.birth.date)})`}</div>
            )}
            {hometown(bio) && <div><span className="bio-label">Hometown</span>{hometown(bio)}</div>}
            {bio.height && <div><span className="bio-label">Height</span>{/^\d+$/.test(String(bio.height)) ? `${bio.height} cm` : bio.height}</div>}
            {bio.weight && <div><span className="bio-label">Weight</span>{/^\d+$/.test(String(bio.weight)) ? `${bio.weight} kg` : bio.weight}</div>}
            <div><span className="bio-label">Nationality</span>{player.nationality}</div>
          </div>
        )}

        {s && (
          <>
            <h4 className="profile-h">This season</h4>
            <table className="statline">
              <tbody>
                {statRows.map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td className="num">{v ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {profile?.career?.length > 0 && (
          <>
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
          </>
        )}

        {profile?.national?.length > 0 && (
          <>
            <h4 className="profile-h">USA national team</h4>
            <div className="table-wrap">
              <table className="career">
                <tbody>
                  {profile.national.map((r, i) => (
                    <tr key={i}>
                      <td>{r.season}</td>
                      <td title={r.leagues}>{r.leagues || 'USA'}</td>
                      <td className="num">{r.apps} caps</td>
                      <td className="num">{r.goals} G</td>
                      <td className="num">{r.assists} A</td>
                      <td className="num">{r.minutes}′</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {profile?.transfers?.length > 0 && (
          <>
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
          </>
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
