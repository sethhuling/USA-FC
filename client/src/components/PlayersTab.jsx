import React, { useMemo, useState } from 'react';
import { useOpenProfile, PlayerLink } from './PlayerProfile.jsx';

export default function PlayersTab({ players }) {
  const [q, setQ] = useState('');
  const openProfile = useOpenProfile();

  const grouped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = players.filter((p) =>
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.club.toLowerCase().includes(query) ||
      p.league.toLowerCase().includes(query)
    );
    const map = new Map();
    for (const p of filtered) {
      if (!map.has(p.league)) map.set(p.league, []);
      map.get(p.league).push(p);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [players, q]);

  return (
    <div>
      <input
        className="search"
        type="search"
        placeholder="Search players, clubs, leagues…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search players"
      />
      {grouped.map(([league, list]) => (
        <section key={league}>
          <h2>{league} <span className="count">({list.length})</span></h2>
          <div className="player-grid">
            {list.map((p) => (
              <div key={p.id} className="player-card clickable" onClick={() => openProfile(p)}>
                <div className="cell-name"><PlayerLink player={p} /></div>
                <div className="cell-sub">{p.position} · {p.club}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {grouped.length === 0 && <p className="empty">No players found.</p>}
    </div>
  );
}
