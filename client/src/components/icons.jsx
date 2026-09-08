import React from 'react';

// American-flag-themed soccer ball (goal marker).
export function UsaBall({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="goal" role="img">
      <defs><clipPath id="usaball-c"><circle cx="12" cy="12" r="10.5" /></clipPath></defs>
      <circle cx="12" cy="12" r="10.5" fill="#fff" />
      <g clipPath="url(#usaball-c)">
        <rect x="0" y="10" width="24" height="3.4" fill="#B31942" />
        <rect x="0" y="16.8" width="24" height="3.4" fill="#B31942" />
        <rect x="0" y="0" width="24" height="3.4" fill="#B31942" />
        <rect x="0" y="0" width="13" height="10" fill="#0A3161" />
        <circle cx="3.6" cy="3.2" r="1.1" fill="#fff" />
        <circle cx="8.2" cy="3.2" r="1.1" fill="#fff" />
        <circle cx="5.9" cy="6.7" r="1.1" fill="#fff" />
      </g>
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
