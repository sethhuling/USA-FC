import React, { useMemo, useState } from 'react';
import { leagueCountryCode } from '../leagues.js';
import { useOpenProfile, PlayerLink } from './PlayerProfile.jsx';

const PRESETS = [
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'passesCompleted', label: 'Passes' },
  { key: 'defensive', label: 'Def. actions' },
];

const COLUMNS = [
  { key: 'goals', label: 'G' },
  { key: 'assists', label: 'A' },
  { key: 'appearances', label: 'Apps' },
  { key: 'minutes', label: 'Min' },
  { key: 'tackles', label: 'Tkl' },
  { key: 'passesCompleted', label: 'Pass' },
  { key: 'defensive', label: 'Def' },
];

function statValue(p, key) {
  if (!p.stats) return -1;
  if (key === 'defensive') {
    return (p.stats.tackles || 0) + (p.stats.interceptions || 0) + (p.stats.clearances || 0);
  }
  return p.stats[key] ?? -1;
}

export default function StatsTab({ players }) {
  const [sortKey, setSortKey] = useState('goals');
  const [league, setLeague] = useState('all');
  const [pos, setPos] = useState('all');
  const openProfile = useOpenProfile();

  const leagues = useMemo(() => [...new Set(players.map((p) => p.league))].sort(), [players]);

  const rows = useMemo(() => players
    .filter((p) => (league === 'all' || p.league === league))
    .filter((p) => (pos === 'all' || p.positionGroup === pos))
    .sort((a, b) => statValue(b, sortKey) - statValue(a, sortKey)),
  [players, league, pos, sortKey]);

  return (
    <div>
      <div className="preset-row">
        {PRESETS.map((pr) => (
          <button
            key={pr.key}
            className={sortKey === pr.key ? 'preset active' : 'preset'}
            onClick={() => setSortKey(pr.key)}
          >{pr.label}</button>
        ))}
      </div>
      <div className="filters">
        <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="Filter by league">
          <option value="all">All leagues</option>
          {leagues.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={pos} onChange={(e) => setPos(e.target.value)} aria-label="Filter by position">
          <option value="all">All positions</option>
          <option value="DF">Defenders</option>
          <option value="MF">Midfielders</option>
          <option value="FW">Forwards</option>
          <option value="GK">Goalkeepers</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="leaderboard">
          <thead>
            <tr>
              <th className="sticky-col">Player</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={sortKey === c.key ? 'num sortable sorted' : 'num sortable'}
                  onClick={() => setSortKey(c.key)}
                >{c.label}{sortKey === c.key ? ' ▾' : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} onClick={() => openProfile(p)}>
                <td className="sticky-col">
                  <div className="cell-name"><PlayerLink player={p} /></div>
                  <div className="cell-sub">
                    {p.club}
                    {leagueCountryCode(p.league) && ` · ${leagueCountryCode(p.league)}`}
                  </div>
                </td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="num">
                    {statValue(p, c.key) >= 0 ? statValue(p, c.key) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">No players match this filter.</p>}
    </div>
  );
}
