import React, { useMemo, useState } from 'react';
import { PlayerLink } from './PlayerProfile.jsx';
import { TeamLink } from './TeamSheet.jsx';
import { MatchRow } from './ScheduleTab.jsx';
import MatchSheet from './MatchSheet.jsx';
import FavoriteStar from './FavoriteStar.jsx';
import { useFavorites } from '../favorites.js';

// The Favorites tab: the user's favorited players, plus their live and upcoming
// games (same cards as the Schedule tab). Notifications, account, and display
// settings live in SettingsSheet.jsx (the topbar gear).
export default function FavoritesTab({ players, matches }) {
  const favs = useFavorites();
  const [selectedMatch, setSelectedMatch] = useState(null);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const favPlayers = useMemo(
    () => players.filter((p) => favs.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [players, favs]
  );

  // Live first (they kicked off earliest), then upcoming by kickoff.
  const favMatches = useMemo(
    () => matches
      .filter((m) => m.status !== 'finished' &&
        m.trackedPlayers.some((tp) => favs.has(tp.playerId)))
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)),
    [matches, favs]
  );

  return (
    <div className="favorites-tab">
      <section className="p-section">
        <h4 className="profile-h">Players</h4>
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
      </section>

      {favPlayers.length > 0 && (
        <section>
          <h2>Schedule</h2>
          {favMatches.length === 0 ? (
            <p className="empty">No live or upcoming games for your players right now.</p>
          ) : (
            favMatches.map((m) => (
              <MatchRow key={m.id} m={m} playersById={playersById} onOpen={setSelectedMatch} />
            ))
          )}
        </section>
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
