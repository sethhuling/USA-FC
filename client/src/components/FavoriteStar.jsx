import React from 'react';
import { useFavorites, toggleFavorite } from '../favorites.js';

// Shared favorite toggle. Lives inside clickable cards and sheet headers, so it
// always stops propagation — starring a player must never also open a sheet.
export default function FavoriteStar({ playerId, className }) {
  const favs = useFavorites();
  const active = favs.has(playerId);
  return (
    <button
      className={`fav-star${active ? ' active' : ''} ${className || ''}`}
      aria-pressed={active}
      aria-label={active ? 'Remove from favorites' : 'Add to favorites'}
      title={active ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(e) => { e.stopPropagation(); toggleFavorite(playerId); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
