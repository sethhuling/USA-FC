import React, { useMemo, useState } from 'react';

const timeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

function MatchRow({ m }) {
  const kickoff = new Date(m.kickoff);
  const scorers = m.trackedPlayers.filter((p) => p.goals?.length > 0);
  return (
    <div className={`match ${m.status}`}>
      <div className="match-top">
        <span className="competition">
          {m.competition}
          {m.demo && <span className="demo-badge">DEMO</span>}
        </span>
        {m.status === 'live' && <span className="minute">{m.minute}′ LIVE</span>}
        {m.status === 'finished' && <span className="ft">FT</span>}
        {m.status === 'scheduled' && <span className="kickoff">{timeFmt.format(kickoff)}</span>}
      </div>
      <div className="match-teams">
        <span className="team home">{m.home}</span>
        <span className="score">
          {m.status === 'scheduled' ? 'vs' : `${m.homeScore} – ${m.awayScore}`}
        </span>
        <span className="team away">{m.away}</span>
      </div>
      {m.trackedPlayers.length > 0 && (
        <div className="chips">
          {m.trackedPlayers.map((p) => (
            <span key={p.playerId} className={p.goals?.length ? 'chip scored' : 'chip'}>
              {p.name}
              {p.goals?.length > 0 && ` ⚽ ${p.goals.map((g) => `${g}′`).join(' ')}`}
            </span>
          ))}
        </div>
      )}
      <div className="match-bottom">
        <span className="stream">
          📺 {m.streaming?.service || 'Unknown'}
          <span className="stream-source">
            {m.streaming?.source === 'league-config' ? ' (league default)'
              : m.streaming?.source === 'livesoccertv' ? ' (LiveSoccerTV)' : ''}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function ScheduleTab({ matches, players, lastUpdated }) {
  const [league, setLeague] = useState('all');
  const [playerId, setPlayerId] = useState('all');

  const leagues = useMemo(
    () => [...new Set(matches.map((m) => m.league))].sort(), [matches]);

  const filtered = useMemo(() => matches.filter((m) => {
    if (league !== 'all' && m.league !== league) return false;
    if (playerId !== 'all' && !m.trackedPlayers.some((p) => p.playerId === playerId)) return false;
    return true;
  }), [matches, league, playerId]);

  const live = filtered.filter((m) => m.status === 'live');
  const upcoming = filtered.filter((m) => m.status === 'scheduled')
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const finished = filtered.filter((m) => m.status === 'finished')
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff));

  return (
    <div>
      <div className="filters">
        <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="Filter by league">
          <option value="all">All leagues</option>
          {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} aria-label="Filter by player">
          <option value="all">All players</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {live.length > 0 && (
        <section>
          <h2 className="section-live">Live now</h2>
          {live.map((m) => <MatchRow key={m.id} m={m} />)}
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <h2>Upcoming</h2>
          {upcoming.map((m) => <MatchRow key={m.id} m={m} />)}
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <h2>Results</h2>
          {finished.map((m) => <MatchRow key={m.id} m={m} />)}
        </section>
      )}
      {filtered.length === 0 && <p className="empty">No matches for this filter.</p>}
      {lastUpdated && (
        <p className="updated">Updated {lastUpdated.toLocaleTimeString()}</p>
      )}
    </div>
  );
}
