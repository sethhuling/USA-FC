import React, { useMemo, useState } from 'react';
import { PlayerLink } from './PlayerProfile.jsx';
import MatchSheet from './MatchSheet.jsx';
import { TeamLink } from './TeamSheet.jsx';
import { UsaBall, UsaBoot } from './icons.jsx';

const timeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

const SQUAD_BADGES = { start: 'XI', on: 'ON', bench: 'SUB', out: 'OUT' };
const SQUAD_RANK = { start: 0, on: 1, bench: 2, out: 3 };
const byStatus = (a, b) => (SQUAD_RANK[a.squadStatus] ?? 4) - (SQUAD_RANK[b.squadStatus] ?? 4);

const norm = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const sameClub = (a, b) => {
  const na = norm(a), nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
};

function MatchRow({ m, playersById, onOpen }) {
  const kickoff = new Date(m.kickoff);
  const scorers = m.trackedPlayers.filter((p) => p.goals?.length > 0);
  return (
    <div className={`match ${m.status}`} onClick={() => onOpen(m)} role="button" tabIndex={0}>
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
        <span className="team home"><TeamLink id={m.homeId} name={m.home} /></span>
        <span className="score">
          {m.status === 'scheduled' ? 'vs' : `${m.homeScore} – ${m.awayScore}`}
        </span>
        <span className="team away"><TeamLink id={m.awayId} name={m.away} /></span>
      </div>
      {m.trackedPlayers.length > 0 && (() => {
        const renderChip = (p) => {
          const full = playersById.get(p.playerId);
          const feats = (p.goals?.length || 0) + (p.assists?.length || 0) > 0;
          const label = <>
            <span className="chip-name">
              {p.squadStatus && (
                <span className={`squad-badge ${p.squadStatus}`}>{SQUAD_BADGES[p.squadStatus]}</span>
              )}
              {p.name}
            </span>
            {feats && (
              <span className="chip-feats">
                {(p.goals || []).map((g, i) => (
                  <span key={`g${i}`} className="feat"><UsaBall /> {g}′</span>
                ))}
                {(p.assists || []).map((a, i) => (
                  <span key={`a${i}`} className="feat"><UsaBoot /> {a}′</span>
                ))}
              </span>
            )}
          </>;
          return (
            <span
              key={p.playerId}
              className={`chip${p.goals?.length ? ' scored' : ''}${p.squadStatus === 'out' ? ' benched-out' : ''}`}
            >
              {full ? <PlayerLink player={full}>{label}</PlayerLink> : label}
            </span>
          );
        };
        const home = m.trackedPlayers.filter((p) => sameClub(p.club, m.home)).sort(byStatus);
        const away = m.trackedPlayers.filter((p) => !home.includes(p) && sameClub(p.club, m.away)).sort(byStatus);
        const rest = m.trackedPlayers.filter((p) => !home.includes(p) && !away.includes(p)).sort(byStatus);
        return (
          <div className="chips-split">
            <div className="chips side home">{home.map(renderChip)}</div>
            <div className="chips side away">{away.map(renderChip)}</div>
            {rest.length > 0 && <div className="chips side rest">{rest.map(renderChip)}</div>}
          </div>
        );
      })()}
      <div className="match-bottom">
        <span className="stream">
          📺 {m.streaming?.service || 'Unknown'}
        </span>
      </div>
    </div>
  );
}

export default function ScheduleTab({ matches, players, lastUpdated }) {
  const [league, setLeague] = useState('all');
  const [playerId, setPlayerId] = useState('all');
  const [selectedMatch, setSelectedMatch] = useState(null);

  const leagues = useMemo(
    () => [...new Set(matches.map((m) => m.league))].sort(), [matches]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

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
          {live.map((m) => <MatchRow key={m.id} m={m} playersById={playersById} onOpen={setSelectedMatch} />)}
        </section>
      )}
      {upcoming.length > 0 && (
        <section>
          <h2>Upcoming</h2>
          {upcoming.map((m) => <MatchRow key={m.id} m={m} playersById={playersById} onOpen={setSelectedMatch} />)}
        </section>
      )}
      {finished.length > 0 && (
        <section>
          <h2>Results</h2>
          {finished.map((m) => <MatchRow key={m.id} m={m} playersById={playersById} onOpen={setSelectedMatch} />)}
        </section>
      )}
      {filtered.length === 0 && <p className="empty">No matches for this filter.</p>}
      {lastUpdated && (
        <p className="updated">Updated {lastUpdated.toLocaleTimeString()}</p>
      )}
      {selectedMatch && (
        <MatchSheet
          match={selectedMatch}
          playersById={playersById}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </div>
  );
}
