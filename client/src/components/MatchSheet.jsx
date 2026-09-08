import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMatchDetail } from '../api.js';
import { PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';

const kickoffFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const EVENT_ICONS = { Goal: '⚽', Card: '🟨', subst: '🔁' };
function eventIcon(ev) {
  if (ev.type === 'Card') return ev.detail?.includes('Red') ? '🟥' : '🟨';
  return EVENT_ICONS[ev.type] || '•';
}

function LineupSide({ side, playersById }) {
  if (!side) return null;
  const renderPlayer = (pl) => {
    const tracked = pl.trackedId ? playersById.get(pl.trackedId) : null;
    const label = (
      <>
        <span className="shirt-no">{pl.number ?? '–'}</span>
        <span className="lineup-name">{pl.name}{tracked ? ' 🇺🇸' : ''}</span>
      </>
    );
    return (
      <li key={`${pl.apiId ?? pl.name}`} className={tracked ? 'lineup-player american' : 'lineup-player'}>
        {tracked ? <PlayerLink player={tracked}>{label}</PlayerLink> : label}
      </li>
    );
  };
  return (
    <div className="lineup-col">
      <h5>{side.team}{side.formation ? ` · ${side.formation}` : ''}</h5>
      {side.coach && <p className="coach">{side.coach}</p>}
      <ul>{side.startXI.map(renderPlayer)}</ul>
      {side.substitutes?.length > 0 && (
        <>
          <h6>Bench</h6>
          <ul className="bench">{side.substitutes.map(renderPlayer)}</ul>
        </>
      )}
    </div>
  );
}

const STAT_ORDER = [
  'Ball Possession', 'Total Shots', 'Shots on Goal', 'expected_goals',
  'Corner Kicks', 'Fouls', 'Yellow Cards', 'Red Cards', 'Offsides', 'Total passes',
];
const STAT_LABELS = { expected_goals: 'Expected goals (xG)', 'Total passes': 'Passes' };

export default function MatchSheet({ match, playersById, onClose }) {
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDetail(null); setFailed(false);
    fetchMatchDetail(match.id).then(setDetail).catch(() => setFailed(true));
  }, [match.id]);

  const m = detail || match;
  const kickoff = new Date(m.kickoff);
  const events = (detail?.events || []).filter((e) => ['Goal', 'Card', 'subst'].includes(e.type));

  let statRows = [];
  if (detail?.stats?.length === 2) {
    const homeStats = detail.stats.find((s) => s.team === m.home) || detail.stats[0];
    const awayStats = detail.stats.find((s) => s !== homeStats);
    statRows = STAT_ORDER.map((type) => {
      const h = homeStats.items.find((x) => x.type === type);
      const a = awayStats.items.find((x) => x.type === type);
      if (!h && !a) return null;
      return { label: STAT_LABELS[type] || type, home: h?.value ?? '–', away: a?.value ?? '–' };
    }).filter(Boolean);
  }

  const ticketUrl = 'https://www.google.com/search?q=' +
    encodeURIComponent(`${m.home} vs ${m.away} ${kickoff.toLocaleDateString()} tickets`);

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <h3>{m.competition}</h3>
            <p className="sheet-sub">
              {m.status === 'live' ? `${m.minute}′ LIVE` : m.status === 'finished' ? 'Full time' : kickoffFmt.format(kickoff)}
            </p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="score-block">
          <span className="team-name"><TeamLink id={m.homeId} name={m.home} /></span>
          <span className={m.status === 'live' ? 'big-score live' : 'big-score'}>
            {m.status === 'scheduled' ? 'vs' : `${m.homeScore} – ${m.awayScore}`}
          </span>
          <span className="team-name"><TeamLink id={m.awayId} name={m.away} /></span>
        </div>

        <div className="match-meta">
          {detail?.venue && (
            <div>📍 {detail.venue.name}{detail.venue.city ? `, ${detail.venue.city}` : ''}</div>
          )}
          {detail?.referee && <div>🧑‍⚖️ {detail.referee}</div>}
          {m.streaming?.service && <div>📺 {m.streaming.service}</div>}
          {m.status === 'scheduled' && (
            <div><a className="ticket-link" href={ticketUrl} target="_blank" rel="noreferrer">🎟 Find tickets</a></div>
          )}
        </div>

        {!detail && !failed && <p className="empty">Loading match details…</p>}
        {failed && <p className="empty">Couldn’t load match details right now.</p>}
        {detail?.demo && <p className="empty">Demo mode — lineups and match stats need an API key.</p>}

        {events.length > 0 && (
          <>
            <h4 className="profile-h">Events</h4>
            <ul className="event-list">
              {events.map((e, i) => (
                <li key={i} className={e.trackedId ? 'american' : ''}>
                  <span className="event-min">{e.minute}{e.extra ? `+${e.extra}` : ''}′</span>
                  {eventIcon(e)} {e.player}
                  {e.type === 'Goal' && e.assist && <span className="event-sub"> (assist: {e.assist})</span>}
                  {e.type === 'subst' && e.assist && <span className="event-sub"> ⇄ {e.assist}</span>}
                  <span className="event-team"> — {e.team}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {detail?.lineups ? (
          <>
            <h4 className="profile-h">Lineups</h4>
            <div className="lineups">
              <LineupSide side={detail.lineups.home} playersById={playersById} />
              <LineupSide side={detail.lineups.away} playersById={playersById} />
            </div>
          </>
        ) : detail && !detail.demo && m.status === 'scheduled' ? (
          <p className="empty">Lineups not announced yet — usually ~1 hour before kickoff.</p>
        ) : null}

        {statRows.length > 0 && (
          <>
            <h4 className="profile-h">Match stats</h4>
            <table className="match-stats">
              <tbody>
                {statRows.map((r) => (
                  <tr key={r.label}>
                    <td className="num">{r.home}</td>
                    <td className="stat-label">{r.label}</td>
                    <td className="num">{r.away}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
