import React from 'react';

// Goal marker: soccer ball drawn to match the ⚽ emoji used for non-American
// goals — slightly tilted center pentagon, five rim panels clipped by the
// circle, and the emoji's spherical shading (bright top-left, shadowed
// bottom-right rim, beveled panels with a soft edge — no hard outline) —
// but with navy panels (where a normal ball is black) and red seams.
export function UsaBall({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="goal" role="img">
      <defs>
        <clipPath id="usaball-c">
          <circle cx="12" cy="12" r="10.5" />
        </clipPath>
        <radialGradient id="usaball-b" cx="36%" cy="26%" r="90%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#f4f5f7" />
          <stop offset="100%" stopColor="#aab2bf" />
        </radialGradient>
        <radialGradient id="usaball-s" cx="36%" cy="26%" r="95%">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="60%" stopColor="#000" stopOpacity="0" />
          <stop offset="85%" stopColor="#000" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id="usaball-h" cx="40%" cy="20%" r="36%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="70%" stopColor="#fff" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* per-panel bevel: maps to each panel's own bounding box */}
        <linearGradient id="usaball-p" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor="#2d5f97" />
          <stop offset="45%" stopColor="#0A3161" />
          <stop offset="100%" stopColor="#041d3d" />
        </linearGradient>
        <filter id="usaball-f" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.35" stdDeviation="0.35" floodColor="#39445a" floodOpacity="0.55" />
        </filter>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="url(#usaball-b)" />
      <g clipPath="url(#usaball-c)">
        {/* seams: center-pentagon vertices out to the rim panels */}
        <g stroke="#B31942" strokeWidth="1.3" strokeLinecap="round">
          <line x1="10.59" y1="8.10" x2="9.94" y2="5.06" />
          <line x1="15.31" y1="10.20" x2="18.00" y2="8.65" />
          <line x1="14.77" y1="15.34" x2="17.07" y2="17.42" />
          <line x1="9.71" y1="16.42" x2="8.45" y2="19.25" />
          <line x1="7.12" y1="11.94" x2="4.04" y2="11.62" />
        </g>
        {/* panels: beveled fill, faint highlight edge, soft drop shadow */}
        <g
          fill="url(#usaball-p)"
          filter="url(#usaball-f)"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="0.35"
        >
          <path d="M9.94 5.06 L6.18 3.39 L6.61 -0.70 L10.64 -1.56 L12.69 2.01 Z" />
          <path d="M18.00 8.65 L18.43 4.56 L22.45 3.70 L24.51 7.27 L21.75 10.32 Z" />
          <path d="M17.07 17.42 L21.10 16.56 L23.16 20.13 L20.40 23.18 L16.64 21.51 Z" />
          <path d="M8.45 19.25 L10.51 22.81 L7.75 25.87 L3.99 24.20 L4.42 20.11 Z" />
          <path d="M4.04 11.62 L1.29 14.67 L-2.47 13.00 L-2.04 8.91 L1.98 8.05 Z" />
          <path d="M10.59 8.10 L15.31 10.20 L14.77 15.34 L9.71 16.42 L7.12 11.94 Z" />
        </g>
        {/* spherical shading: rim shadow, then top-left gloss */}
        <circle cx="12" cy="12" r="10.5" fill="url(#usaball-s)" />
        <circle cx="12" cy="12" r="10.5" fill="url(#usaball-h)" />
        {/* subtle edge, in place of a hard outline */}
        <circle cx="12" cy="12" r="10.3" fill="none" stroke="rgba(90,100,115,0.45)" strokeWidth="0.5" />
      </g>
    </svg>
  );
}

// American-flag-themed boot (assist marker).
export function UsaBoot({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="assist" role="img">
      <defs>
        <clipPath id="usaboot-c">
          <path d="M3 16 C3 9 5 5 8 5 L10 5 C11.5 5 11.5 7 13 9 L17 13 C19.5 14.5 21 15 21 16 Z" />
        </clipPath>
      </defs>
      <path d="M3 16 C3 9 5 5 8 5 L10 5 C11.5 5 11.5 7 13 9 L17 13 C19.5 14.5 21 15 21 16 Z" fill="#fff" />
      <g clipPath="url(#usaboot-c)">
        <rect x="0" y="7.2" width="24" height="2.6" fill="#B31942" />
        <rect x="0" y="12.4" width="24" height="2.6" fill="#B31942" />
        <rect x="2" y="4" width="8.5" height="6" fill="#0A3161" />
        <circle cx="4.6" cy="6" r="0.9" fill="#fff" />
        <circle cx="8" cy="6" r="0.9" fill="#fff" />
      </g>
      <path d="M3 16 C3 9 5 5 8 5 L10 5 C11.5 5 11.5 7 13 9 L17 13 C19.5 14.5 21 15 21 16 Z"
        fill="none" stroke="#0A3161" strokeWidth="1.4" />
      <path d="M2.5 16.5 h19 v1.2 a1.6 1.6 0 0 1 -1.6 1.6 H4.6 a2.1 2.1 0 0 1 -2.1 -2.1 z" fill="#0A3161" />
      <rect x="5" y="19.3" width="1.7" height="2" rx="0.6" fill="#0A3161" />
      <rect x="10" y="19.3" width="1.7" height="2" rx="0.6" fill="#0A3161" />
      <rect x="15" y="19.3" width="1.7" height="2" rx="0.6" fill="#0A3161" />
    </svg>
  );
}
