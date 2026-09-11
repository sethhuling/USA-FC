import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchMeta, fetchPlayers, fetchMatches } from './api.js';
import ScheduleTab from './components/ScheduleTab.jsx';
import StatsTab from './components/StatsTab.jsx';
import PlayersTab from './components/PlayersTab.jsx';
import NewsTab from './components/NewsTab.jsx';
import { ProfileProvider } from './components/PlayerProfile.jsx';
import { TeamProvider } from './components/TeamSheet.jsx';

const TABS = [
  { key: 'schedule', label: 'Schedule', icon: '📅' },
  { key: 'stats', label: 'Stats', icon: '📊' },
  { key: 'players', label: 'Players', icon: '🇺🇸' },
  { key: 'news', label: 'News', icon: '📰' },
];

// Mirrors the static splash in index.html (same classes, styled by the inline
// <style> block there) so the handoff from static HTML to React is seamless.
function Splash({ out }) {
  return (
    <div className={out ? 'splash out' : 'splash'} aria-hidden={out}>
      <h1 className="splash-title">Uncle Sam <span className="t-fc">FC</span></h1>
      <div className="splash-motto">
        <span className="m-line">Oh when the</span>
        <span className="m-yanks">YANKS</span>
        <span className="m-line">go marching in</span>
      </div>
      <div className="splash-dots"><span /><span /><span /></div>
      <div className="splash-note">Warming up…</div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [meta, setMeta] = useState(null);
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  // Bumping this remounts ScheduleTab, resetting its view/filters/scroll —
  // the "just opened the app" state the topbar tap returns to.
  const [scheduleResetKey, setScheduleResetKey] = useState(0);
  const [booted, setBooted] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // Hysteresis: collapse past 24px, re-expand only near the top. A single
    // threshold oscillates — collapsing removes ~124px of header height, and
    // scroll clamping/anchoring feeds that straight back into scrollY.
    const onScroll = () =>
      setScrolled((prev) => (prev ? window.scrollY > 8 : window.scrollY > 24));
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
    const playersReady = fetchPlayers()
      .then((d) => setPlayers(d.players))
      .catch((e) => setError(e.message));
    // Keep the splash up until both initial fetches settle (success or error),
    // AND at least 3s from page open (user preference: let the splash land
    // now that the data loads near-instantly). performance.now() counts from
    // navigation start, so the static pre-React splash time counts too.
    Promise.allSettled([playersReady, loadMatches()]).then(() => {
      const wait = Math.max(0, 3000 - performance.now());
      setTimeout(() => setBooted(true), wait);
    });
  }, [loadMatches]);

  // Fade the splash, then unmount it once the transition has finished.
  useEffect(() => {
    if (!booted) return;
    const t = setTimeout(() => setSplashDone(true), 400);
    return () => clearTimeout(t);
  }, [booted]);

  // Poll every 60s while a match is live, every 5 min otherwise.
  const anyLive = matches.some((m) => m.status === 'live');
  useEffect(() => {
    const interval = setInterval(loadMatches, anyLive ? 60_000 : 300_000);
    const onVisible = () => { if (!document.hidden) loadMatches(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [anyLive, loadMatches]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  // Tapping the topbar wordmark: scroll to top if scrolled down; if already at
  // the top, go "home" — the Schedule tab in its freshly-opened state.
  const onBrandTap = useCallback(() => {
    if (window.scrollY > 8) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setTab('schedule');
      setScheduleResetKey((k) => k + 1);
    }
  }, []);

  return (
    <ProfileProvider>
    <TeamProvider playersById={playersById}>
    <div className="app">
      <header className={scrolled ? "topbar scrolled" : "topbar"} onClick={onBrandTap}>
        <h1>Uncle Sam <span className="wm-fc">FC</span></h1>
        <span className="motto">
          <span className="motto-line">Oh when the</span>
          <span className="motto-yanks">YANKS</span>
          <span className="motto-line">go marching in</span>
        </span>
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
          <ScheduleTab key={scheduleResetKey} matches={matches} players={players} lastUpdated={lastUpdated} />
        )}
        {tab === 'stats' && <StatsTab players={players} />}
        {tab === 'players' && <PlayersTab players={players} />}
        {tab === 'news' && <NewsTab players={players} />}
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

      {!splashDone && <Splash out={booted} />}
    </div>
    </TeamProvider>
    </ProfileProvider>
  );
}
