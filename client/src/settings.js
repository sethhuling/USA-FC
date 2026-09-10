// Per-user display preferences. Stored in this browser's localStorage, so each
// person (device) keeps their own — nothing here touches the shared server
// caches. Reads always fall back to DEFAULTS when storage is empty or blocked
// (e.g. private browsing). There is no settings screen yet; build one on top of
// getSettings/setSetting, or flip a value from the browser console:
//   setSetting('units', 'metric')
const KEY = 'unclesamfc-settings';
const OLD_KEY = 'usafc-settings'; // pre-rename key, read as a fallback

export const DEFAULTS = {
  units: 'imperial', // 'imperial' | 'metric' — player height/weight display
};

export function getSettings() {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    return { ...DEFAULTS, ...(JSON.parse(stored) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSetting(name) {
  return getSettings()[name];
}

export function setSetting(name, value) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSettings(), [name]: value }));
  } catch {
    // Storage unavailable — the preference just won't persist.
  }
}
