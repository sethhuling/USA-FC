import React, {
  createContext, useCallback, useContext, useEffect, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { fetchTeamOverview } from '../api.js';
import { PlayerLink } from './PlayerProfile.jsx';

const TeamContext = createContext(() => {});
export const useOpenTeam = () => useContext(TeamContext);

// A clickable team name. Renders plain text when no team id is known (demo mode).
export function TeamLink({ id, name, className, children }) {
  const open = useOpenTeam();
  if (!id) return <>{children ?? name}</>;
  const go = (e) => { e.stopPropagation(); open({ id, name }); };
  return (
    <span
      className={`team-link ${className || ''}`}
      role="button" tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === 'Enter') go(e); }}
    >{children ?? name}</span>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function FixtureLine({ m, teamId }) {
  const home = m.homeId === teamId;
  const oppName = home ? m.away : m.home;
  const oppId = home ? m.awayId : m.homeId;
  const d = new Date(m.kickoff);
  let result = null;
  if (m.status === 'finished') {
    const us = home ? m.homeScore : m.awayScore;
    const them = home ? m.awayScore : m.homeScore;
    result = us > them ? 'W' : us < them ? 'L' : 'D';
  }
  return (
    <li className="fixture-line">
      {result && <span className={`wdl ${result}`}>{result}</span>}
      <span className="fx-date">
        {dayFmt.format(d)}{m.status === 'scheduled' ? `, ${clockFmt.format(d)}` : ''}
      </span>
      <span className="fx-opp">{home ? 'vs' : '@'} <TeamLink id={oppId} name={oppName} /></span>
      {m.status !== 'scheduled' && <span className="fx-score">{m.homeScore}–{m.awayScore}</span>}
      <span className="fx-comp">{m.competition}</span>
    </li>
  );
}

function TeamSheet({ team, playersById, onClose }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setData(null); setFailed(false);
    fetchTeamOverview(team.id).then(setData).catch(() => setFailed(true));
  }, [team.id]);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div className="profile-id">
            {data?.logo
              ? <img src={data.logo} alt="" className="team-logo" />
              : <div className="team-logo placeholder">🛡️</div>}
            <div>
              <h3>{data?.name || team.name}</h3>
              <p className="sheet-sub">
                {[data?.country, data?.founded && `est. ${data.founded}`].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!data && !failed && <p className="empty">Loading team overview…</p>}
        {failed && <p className="empty">Couldn’t load this team right now.</p>}

        {data?.venue && (
          <div className="match-meta">
            <div>🏟 {data.venue.name}{data.venue.city ? `, ${data.venue.city}` : ''}
              {data.venue.capacity ? ` (${data.venue.capacity.toLocaleString()} seats)` : ''}</div>
          </div>
        )}

        {data?.standings?.length > 0 && (
          <>
            <h4 className="profile-h">Standings</h4>
            {data.standings.map((st, i) => (
              <div key={i} className="standing-line">
                <div>
                  <strong>{st.competition}</strong>: {st.rank}{['st','nd','rd'][((st.rank+90)%100-10)%10-1] || 'th'},{' '}
                  {st.points} pts ({st.win}W {st.draw}D {st.lose}L, {st.goalsFor}:{st.goalsAgainst})
                </div>
                {st.form && (
                  <div className="form-run">
                    {st.form.split('').slice(-5).map((c, j) => <span key={j} className={`wdl ${c}`}>{c}</span>)}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {data?.americans?.length > 0 && (
          <>
            <h4 className="profile-h">Americans at the club</h4>
            <div className="chips">
              {data.americans.map((a) => {
                const full = playersById.get(a.playerId);
                return (
                  <span key={a.playerId} className="chip">
                    {full ? <PlayerLink player={full}>{a.name} · {a.position}</PlayerLink> : `${a.name} · ${a.position}`}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {data?.recent?.length > 0 && (
          <>
            <h4 className="profile-h">Recent results</h4>
            <ul className="fixture-list">
              {data.recent.map((m) => <FixtureLine key={m.id} m={m} teamId={data.id} />)}
            </ul>
          </>
        )}

        {data?.upcoming?.length > 0 && (
          <>
            <h4 className="profile-h">Upcoming schedule</h4>
            <ul className="fixture-list">
              {data.upcoming.map((m) => <FixtureLine key={m.id} m={m} teamId={data.id} />)}
            </ul>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export function TeamProvider({ playersById, children }) {
  const [team, setTeam] = useState(null);
  const open = useCallback((t) => setTeam(t), []);
  return (
    <TeamContext.Provider value={open}>
      {children}
      {team && <TeamSheet team={team} playersById={playersById} onClose={() => setTeam(null)} />}
    </TeamContext.Provider>
  );
}
