import React from 'react';

// Goal marker: a classic pentagon-panel soccer ball in brand colors —
// red center pentagon, navy panels/seams on white.
export function UsaBall({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="goal" role="img">
      <circle cx="12" cy="12" r="10.5" fill="#fff" />
      {/* seams: center-pentagon vertices out to the rim */}
      <g stroke="#0A3161" strokeWidth="1.4" strokeLinecap="round">
        <line x1="12" y1="7.7" x2="12" y2="1.6" />
        <line x1="16.09" y1="10.67" x2="21.89" y2="8.79" />
        <line x1="14.53" y1="15.48" x2="18.11" y2="20.41" />
        <line x1="9.47" y1="15.48" x2="5.89" y2="20.41" />
        <line x1="7.91" y1="10.67" x2="2.11" y2="8.79" />
      </g>
      {/* half-panels along the rim between the seams */}
      <g fill="#0A3161">
        <path d="M15.59 2.13 L20.27 5.53 L16.12 6.34 Z" />
        <path d="M22.49 12.37 L20.70 17.87 L18.66 14.16 Z" />
        <path d="M14.90 22.09 L9.10 22.09 L12 19 Z" />
        <path d="M1.51 12.37 L3.30 17.87 L5.34 14.16 Z" />
        <path d="M8.41 2.13 L3.73 5.53 L7.88 6.34 Z" />
      </g>
      {/* center pentagon — the one red panel */}
      <path d="M12 7.7 L16.09 10.67 L14.53 15.48 L9.47 15.48 L7.91 10.67 Z" fill="#B31942" />
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="#0A3161" strokeWidth="1.6" />
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
