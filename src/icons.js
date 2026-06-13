// Leaflet divIcons — module scope (or memoised at the call site for chips),
// NEVER created inline in JSX: marker DOM must not churn on re-renders.
import { divIcon } from 'leaflet';
import { baseTheme } from './theme';

// Pin-accurate flag: a small hollow white ring whose CENTRE sits exactly on
// greenLocation; the stick and rectangular flag rise upward only.
export const greenIcon = divIcon({
  className: '',
  html: `<svg width="20" height="28" viewBox="0 0 20 28" style="display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));">
      <line x1="10" y1="23" x2="10" y2="4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
      <rect x="10" y="4" width="9" height="6" fill="${baseTheme.ink}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round" />
      <circle cx="10" cy="23" r="3" fill="none" stroke="#ffffff" stroke-width="2" />
    </svg>`,
  iconSize: [20, 28], iconAnchor: [10, 23]
});

export const userIcon = divIcon({
  className: '',
  html: `<div style="background-color: #4A90E2; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9]
});

// Aiming marker: a hollow white ring with a small white centre dot (distances
// live on the line midpoints as chips). Drop-shadow keeps it readable on imagery.
export const targetIcon = divIcon({
  className: '',
  html: `<svg width="20" height="20" viewBox="0 0 20 20" style="display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));">
      <circle cx="10" cy="10" r="7" fill="none" stroke="#ffffff" stroke-width="2" />
      <circle cx="10" cy="10" r="2" fill="#ffffff" />
    </svg>`,
  iconSize: [20, 20], iconAnchor: [10, 10]
});

// Boxless distance label centred on a point (green front/back + line midpoints).
// Theme-independent: always white bold numerals with a dark halo for legibility
// over the satellite imagery — no background/border. faint = shot-trail labels.
export const createChip = (distance, size = 13, faint = false) => divIcon({
  className: '',
  html: `<div style="display: inline-block; transform: translate(-50%, -50%); opacity: ${faint ? 0.7 : 1}; color: #fff; font-family: ${baseTheme.num}; font-size: ${size}px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 0 3px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.9);">${distance}</div>`,
  iconSize: [0, 0], iconAnchor: [0, 0]
});

// Small white dot for a recorded shot position (Snjallskrá).
export const markDotIcon = divIcon({
  className: '',
  html: `<svg width="12" height="12" viewBox="0 0 12 12" style="display:block; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.6));">
      <circle cx="6" cy="6" r="4" fill="none" stroke="#ffffff" stroke-width="2" />
    </svg>`,
  iconSize: [12, 12], iconAnchor: [6, 6]
});

// Relief/drop position after a penalty — small white triangle.
export const dropMarkIcon = divIcon({
  className: '',
  html: `<svg width="14" height="13" viewBox="0 0 14 13" style="display:block; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.6));">
      <path d="M7 2 L12.5 11 L1.5 11 Z" fill="none" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
    </svg>`,
  iconSize: [14, 13], iconAnchor: [7, 7]
});
