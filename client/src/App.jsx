import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchMeta, fetchPlayers, fetchMatches } from './api.js';
import ScheduleTab from './components/ScheduleTab.jsx';
import StatsTab from './components/StatsTab.jsx';
import PlayersTab from './components/PlayersTab.jsx';

const TABS = [
  { key: 'schedule', label: 'Schedule', icon: '📅' },
  { key: 'stats', label: 'Stats', icon: '📊' },
  { key: 'players', label: 'Players', icon: '🇺🇸' },
];

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [meta, setMeta] = useState(null);
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadMatches = useCallback(async () => {
    try {
      const data = await fetchMatches();
      setMatches(data.matches);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => {});
    fetchPlayers().then((d) => setPlayers(d.players)).catch((e) => setError(e.message));
    loadMatches();
  }, [loadMatches]);

  // Poll every 60s while a match is live, every 5 min otherwise.
  const anyLive = matches.some((m) => m.status === 'live');
  useEffect(() => {
    const interval = setInterval(loadMatches, anyLive ? 60_000 : 300_000);
    const onVisible = () => { if (!document.hidden) loadMatches(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [anyLive, loadMatches]);

  return (
    <div className="app">
      <header className="topbar">
        <img src="/crest.svg" alt="USA FC crest" className="crest" />
        <h1>USA FC</h1>
        {anyLive && <span className="live-dot" title="Live matches in progress">● LIVE</span>}
      </header>

      {meta?.demo && (
        <div className="banner">
          <strong>Demo mode</strong> — the matches and stats shown are simulated examples,
          not real fixtures. No game marked DEMO is actually happening. Add
          <code>API_FOOTBALL_KEY</code> to <code>.env</code> for real data.
        </div>
      )}
      {error && <div className="banner error">Couldn’t reach the server: {error}</div>}

      <main className="content">
        {tab === 'schedule' && (
          <ScheduleTab matches={matches} players={players} lastUpdated={lastUpdated} />
        )}
        {tab === 'stats' && <StatsTab players={players} />}
        {tab === 'players' && <PlayersTab players={players} />}
      </main>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
