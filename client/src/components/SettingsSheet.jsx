import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { getSetting, setSetting } from '../settings.js';

// App settings, opened from the gear in the topbar's left corner. Same
// portal/backdrop pattern as the player/match/team sheets. Holds the display
// settings that used to live in the MVPs tab; per-player notification toggles
// stay in the MVPs tab where the favorites are.
export default function SettingsSheet({ onClose }) {
  const [units, setUnits] = useState(() => getSetting('units'));

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet settings-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h3>Settings</h3>
          <button className="close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <section className="p-section">
          <div className="pref-row">
            <div>
              <div className="pref-label">Height & weight units</div>
              <div className="pref-sub">How player measurements are shown</div>
            </div>
            <div className="fchips">
              {[['imperial', 'ft / lbs'], ['metric', 'cm / kg']].map(([val, label]) => (
                <button key={val}
                  className={units === val ? 'fchip active' : 'fchip'}
                  onClick={() => { setSetting('units', val); setUnits(val); }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <footer className="news-footer">
          <p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a></p>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
