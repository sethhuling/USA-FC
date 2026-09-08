import React, { useEffect, useMemo, useState } from 'react';
import { fetchLeagues } from '../api.js';
import { leagueCountryCode } from '../leagues.js';
import { useOpenProfile, PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';

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

// "Regular Season - 4" -> "Wk 4"; "Apertura - 8" -> "Ap 8"; else show as-is, shortened.
function roundLabel(round) {
  if (!round) return null;
  let m = round.match(/Regular Season\s*-\s*(\d+)/i);
  if (m) return `Wk ${m[1]}`;
  m = round.match(/(Apertura|Clausura)\s*-\s*(\d+)/i);
  if (m) return `${m[1].slice(0, 2)} ${m[2]}`;
  return round.length > 14 ? `${round.slice(0, 13)}…` : round;
}

function statValue(p, key) {
  if (!p.stats) return -1;
  if (key === 'defensive') {
    return (p.stats.tackles || 0) + (p.stats.interceptions || 0) + (p.stats.clearances || 0);
  }
  return p.stats[key] ?? -1;
}

export default function StatsTab({ players }) {
  const [sortKey, setSortKey] = useState('goals');
  const [pos, setPos] = useState('all');
  const [disabled, setDisabled] = useState(() => new Set());
  const [rounds, setRounds] = useState({});
  const openProfile = useOpenProfile();

  useEffect(() => {
    fetchLeagues()
      .then((d) => setRounds(Object.fromEntries(d.leagues.map((l) => [l.name, l.round]))))
      .catch(() => {});
  }, []);

  const leagues = useMemo(() => [...new Set(players.map((p) => p.league))].sort(), [players]);

  const toggleLeague = (name) => setDisabled((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const rows = useMemo(() => players
    .filter((p) => !disabled.has(p.league))
    .filter((p) => (pos === 'all' || p.positionGroup === pos))
    .sort((a, b) => statValue(b, sortKey) - statValue(a, sortKey)),
  [players, disabled, pos, sortKey]);

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
      <div className="league-row" role="group" aria-label="Toggle leagues">
        {leagues.map((l) => (
          <button
            key={l}
            className={disabled.has(l) ? 'league-toggle off' : 'league-toggle'}
            onClick={() => toggleLeague(l)}
            aria-pressed={!disabled.has(l)}
          >
            <span className="lt-name">{l}</span>
            {roundLabel(rounds[l]) && <span className="lt-round">{roundLabel(rounds[l])}</span>}
          </button>
        ))}
        {disabled.size > 0 && (
          <button className="league-toggle reset" onClick={() => setDisabled(new Set())}>
            <span className="lt-name">All on</span>
          </button>
        )}
      </div>
      <div className="filters">
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
                    <TeamLink id={p.apiFootballTeamId} name={p.club} />
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
