import React, { useMemo, useState } from 'react';
import { useOpenProfile, PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';
import FavoriteStar from './FavoriteStar.jsx';
import { useFavorites } from '../favorites.js';

function PlayerCard({ p, openProfile }) {
  return (
    <div className="player-card clickable" onClick={() => openProfile(p)}>
      <FavoriteStar playerId={p.id} className="card-star" />
      <div className="cell-name"><PlayerLink player={p} /></div>
      <div className="cell-sub">{p.position} · <TeamLink id={p.apiFootballTeamId} name={p.club} /></div>
    </div>
  );
}

export default function PlayersTab({ players }) {
  const [q, setQ] = useState('');
  const openProfile = useOpenProfile();
  const favs = useFavorites();

  const { favorites, grouped } = useMemo(() => {
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
    return {
      favorites: filtered.filter((p) => favs.has(p.id)),
      grouped: [...map.entries()].sort((a, b) => b[1].length - a[1].length),
    };
  }, [players, q, favs]);

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
      {favorites.length > 0 && (
        <section>
          <h2>⭐ Favorites <span className="count">({favorites.length})</span></h2>
          <div className="player-grid">
            {favorites.map((p) => <PlayerCard key={p.id} p={p} openProfile={openProfile} />)}
          </div>
        </section>
      )}
      {grouped.map(([league, list]) => (
        <section key={league}>
          <h2>{league} <span className="count">({list.length})</span></h2>
          <div className="player-grid">
            {list.map((p) => <PlayerCard key={p.id} p={p} openProfile={openProfile} />)}
          </div>
        </section>
      ))}
      {grouped.length === 0 && <p className="empty">No players found.</p>}
    </div>
  );
}
