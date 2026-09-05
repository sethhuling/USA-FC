import React, { useMemo, useState } from 'react';
import { leagueCountry, leagueCountryCode } from '../leagues.js';

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

function PlayerSheet({ player, onClose }) {
  if (!player) return null;
  const s = player.stats;
  const rows = s ? [
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
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <div>
            <h3>{player.name}</h3>
            <p className="sheet-sub">
              {player.position} · {player.club}
              {leagueCountry(player.league) && ` (${leagueCountry(player.league)})`} · {player.league}
            </p>
          </div>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {s ? (
          <table className="statline">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="empty">No season stats available for this player.</p>}
      </div>
    </div>
  );
}

export default function StatsTab({ players }) {
  const [sortKey, setSortKey] = useState('goals');
  const [league, setLeague] = useState('all');
  const [pos, setPos] = useState('all');
  const [selected, setSelected] = useState(null);

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
              <tr key={p.id} onClick={() => setSelected(p)}>
                <td className="sticky-col">
                  <div className="cell-name">{p.name}</div>
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
      <PlayerSheet player={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
