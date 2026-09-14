import React, { useMemo } from 'react';
import { PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';
import FavoriteStar from './FavoriteStar.jsx';
import { useFavorites } from '../favorites.js';

// The MVPs tab: just the user's favorited players. Notifications, account,
// and display settings live in SettingsSheet.jsx (the topbar gear).
export default function MvpsTab({ players }) {
  const favs = useFavorites();

  const favPlayers = useMemo(
    () => players.filter((p) => favs.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [players, favs]
  );

  return (
    <div className="mvps-tab">
      <section className="p-section">
        <h4 className="profile-h">Favorites</h4>
        {favPlayers.length === 0 ? (
          <p className="club-note">
            No favorites yet. Tap the ☆ on any player — in the Players tab or on a
            profile — to follow them here and in your notifications.
          </p>
        ) : (
          <ul className="fav-list">
            {favPlayers.map((p) => (
              <li key={p.id} className="fav-row">
                <div className="fav-row-main">
                  <div className="cell-name"><PlayerLink player={p} /></div>
                  <div className="cell-sub">{p.position} · <TeamLink id={p.apiFootballTeamId} name={p.club} /> · {p.league}</div>
                </div>
                <FavoriteStar playerId={p.id} />
              </li>
            ))}
          </ul>
        )}
        <p className="club-note">
          Notification and account settings are behind the ⚙ gear at the top of the app.
        </p>
      </section>
    </div>
  );
}
