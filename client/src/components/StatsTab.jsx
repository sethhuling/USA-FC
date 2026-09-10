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

const POSITIONS = [
  { key: 'all', label: 'All' },
  { key: 'GK', label: 'GK' },
  { key: 'DF', label: 'DF' },
  { key: 'MF', label: 'MF' },
  { key: 'FW', label: 'FW' },
];

const AGE_RANGES = [
  { key: 'all', label: 'All ages' },
  { key: 'u20', label: '20 & under', min: 0, max: 20 },
  { key: '21-23', label: '21–23', min: 21, max: 23 },
  { key: '24-27', label: '24–27', min: 24, max: 27 },
  { key: '28+', label: '28+', min: 28, max: 99 },
];

const CAP_TIED = [
  { key: 'include', label: 'Include' },
  { key: 'hide', label: 'Hide' },
];

const ELIGIBILITY = [
  { key: 'all', label: 'All' },
  { key: 'yes', label: 'Eligible' },
  { key: 'no', label: 'Not eligible' },
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

function Chips({ options, value, onChange, label }) {
  return (
    <div className="fchips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          className={value === o.key ? 'fchip active' : 'fchip'}
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
        >{o.label}</button>
      ))}
    </div>
  );
}

// Multi-select chips. An empty selection means "everything" and lights the
// 'all' chip; selecting every individual option collapses back to that state.
function MultiChips({ options, selected, onToggle, label }) {
  return (
    <div className="fchips" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.key === 'all' ? selected.size === 0 : selected.has(o.key);
        return (
          <button
            key={o.key}
            className={active ? 'fchip active' : 'fchip'}
            onClick={() => onToggle(o.key)}
            aria-pressed={active}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

function toggleMulti(setter, allKeys) {
  return (key) => setter((prev) => {
    if (key === 'all') return new Set();
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    // Every individual option picked = no filter: switch back to the All chip.
    if (next.size === allKeys.length) return new Set();
    return next;
  });
}

export default function StatsTab({ players }) {
  const [sortKey, setSortKey] = useState('goals');
  const [showFilters, setShowFilters] = useState(false);
  const [posSel, setPosSel] = useState(() => new Set());
  const [disabled, setDisabled] = useState(() => new Set());
  const [capTied, setCapTied] = useState('include');
  const [eligibility, setEligibility] = useState('all');
  const [ageSel, setAgeSel] = useState(() => new Set());
  const [minMinutes, setMinMinutes] = useState(0);
  const [rounds, setRounds] = useState({});
  const openProfile = useOpenProfile();

  useEffect(() => {
    fetchLeagues()
      .then((d) => setRounds(Object.fromEntries(d.leagues.map((l) => [l.name, l.round]))))
      .catch(() => {});
  }, []);

  const leagues = useMemo(() => [...new Set(players.map((p) => p.league))].sort(), [players]);

  // Slider top end: the highest minutes total in the data, rounded up to a
  // full match, so the scale grows with the season.
  const sliderMax = useMemo(() => {
    const most = Math.max(0, ...players.map((p) => p.stats?.minutes || 0));
    return Math.max(90, Math.ceil(most / 90) * 90);
  }, [players]);

  const toggleLeague = (name) => setDisabled((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const rows = useMemo(() => {
    const ars = AGE_RANGES.filter((r) => ageSel.has(r.key));
    return players
      .filter((p) => !disabled.has(p.league))
      .filter((p) => (posSel.size === 0 || posSel.has(p.positionGroup)))
      .filter((p) => (capTied === 'include' || !p.capTied))
      .filter((p) => (eligibility === 'all' ||
        (eligibility === 'yes') === (p.otherEligibility?.length > 0)))
      .filter((p) => (ageSel.size === 0 ||
        (p.age != null && ars.some((r) => p.age >= r.min && p.age <= r.max))))
      .filter((p) => (minMinutes === 0 || (p.stats?.minutes || 0) >= minMinutes))
      .sort((a, b) => statValue(b, sortKey) - statValue(a, sortKey));
  }, [players, disabled, posSel, capTied, eligibility, ageSel, minMinutes, sortKey]);

  const activeCount =
    (disabled.size > 0 ? 1 : 0) +
    (posSel.size > 0 ? 1 : 0) +
    (capTied !== 'include' ? 1 : 0) +
    (eligibility !== 'all' ? 1 : 0) +
    (ageSel.size > 0 ? 1 : 0) +
    (minMinutes !== 0 ? 1 : 0);

  const resetFilters = () => {
    setDisabled(new Set());
    setPosSel(new Set());
    setCapTied('include');
    setEligibility('all');
    setAgeSel(new Set());
    setMinMinutes(0);
  };

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
      <button
        className={showFilters || activeCount > 0 ? 'filter-btn active' : 'filter-btn'}
        onClick={() => setShowFilters((v) => !v)}
        aria-expanded={showFilters}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
        </svg>
        Filters
        {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
        <span className="filter-caret">{showFilters ? '▴' : '▾'}</span>
      </button>
      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <div className="filter-label">Leagues</div>
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
          </div>
          <div className="filter-group">
            <div className="filter-label">Position</div>
            <MultiChips
              options={POSITIONS}
              selected={posSel}
              onToggle={toggleMulti(setPosSel, POSITIONS.filter((o) => o.key !== 'all').map((o) => o.key))}
              label="Filter by position"
            />
          </div>
          <div className="filter-group">
            <div className="filter-label">Age</div>
            <MultiChips
              options={AGE_RANGES}
              selected={ageSel}
              onToggle={toggleMulti(setAgeSel, AGE_RANGES.filter((o) => o.key !== 'all').map((o) => o.key))}
              label="Filter by age"
            />
          </div>
          <div className="filter-group">
            <div className="filter-label">
              Minimum minutes
              <span className="filter-value">{minMinutes === 0 ? 'Any' : `≥ ${minMinutes}`}</span>
            </div>
            <input
              type="range"
              className="filter-slider"
              min={0}
              max={sliderMax}
              step={30}
              value={Math.min(minMinutes, sliderMax)}
              onChange={(e) => setMinMinutes(Number(e.target.value))}
              aria-label="Minimum minutes played"
            />
          </div>
          <div className="filter-group">
            <div className="filter-label">Cap-tied players</div>
            <Chips options={CAP_TIED} value={capTied} onChange={setCapTied} label="Cap-tied players" />
          </div>
          <div className="filter-group">
            <div className="filter-label">Eligible for other countries</div>
            <Chips options={ELIGIBILITY} value={eligibility} onChange={setEligibility} label="Eligible for other countries" />
          </div>
          {activeCount > 0 && (
            <button className="filter-reset" onClick={resetFilters}>Reset all filters</button>
          )}
        </div>
      )}
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
