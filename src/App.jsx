import React, { useState, useEffect, useRef, useMemo } from 'react';
import { courseData } from './courseData';
import { greenData } from './greenData';
import { calculateDistanceInMeters, calculateBearing, getElevation } from './utils';
import { MapContainer, Marker, useMapEvents, Polyline, Polygon, Circle, useMap, TileLayer } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { Navigation, Flag, Crosshair, Moon, Sun, Eye, EyeOff, X, Backpack } from 'lucide-react';

import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';
import easterEggImg from './assets/easter-egg.png';

// Draws the traced green polygons so trace accuracy can be checked on the phone.
// Verification only — flip to false for the final product. The polygon DATA is
// still used for front/back calculations regardless of this flag.
const SHOW_GREEN_OUTLINES = false;

// --- DESIGN TOKENS ---
const baseTheme = {
  darkGreen: '#0a4d2a',
  softWhite: 'rgba(255, 255, 255, 0.95)',
  frostedWhite: 'rgba(255, 255, 255, 0.85)',
  glassBorder: '1px solid rgba(9, 82, 40, 0.15)',
  shadow: '0 4px 12px rgba(0,0,0,0.15)',
  radius: '4px',
  ink: '#0a4d2a',
  panelShadow: '0 2px 14px rgba(0,0,0,0.28)',
  sans: "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  num: "'Barlow Condensed', 'Barlow', 'Helvetica Neue', sans-serif",
};

// Mode-dependent tokens merged over the base. The whole HUD + scorecard read
// from these, so flipping `dark` re-themes everything (sc* = scorecard screen).
const makeTheme = (dark) => ({
  ...baseTheme,
  ...(dark ? {
    panel: 'rgba(9, 26, 21, 0.68)', panelText: '#eef3ea', hairLight: 'rgba(255,255,255,0.22)', accent: '#f0d28c',
    scBg: '#0f211a', scText: '#e7efe6', scLine: 'rgba(255,255,255,0.20)', scHead: '#0b1813', scCell: '#12251c', scAccent: '#17392b', scShape: '#e7efe6',
    chip: { bg: 'rgba(10,26,20,0.94)', fg: '#ffffff', border: 'rgba(255,255,255,0.55)' },
  } : {
    panel: 'rgba(255,255,255,0.93)', panelText: '#16241d', hairLight: 'rgba(10,40,28,0.18)', accent: '#9a6f1e',
    scBg: '#f5f8f5', scText: '#0a4d2a', scLine: 'rgba(10,77,42,0.65)', scHead: '#eef3f0', scCell: '#ffffff', scAccent: '#dff0e4', scShape: '#0a4d2a',
    chip: { bg: 'rgba(255,255,255,0.97)', fg: '#16241d', border: 'rgba(10,40,28,0.5)' },
  }),
});

const microLabel = {
  fontSize: '0.52rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
  opacity: 0.62, fontFamily: baseTheme.sans,
};

// Move a lat/lng `dist` metres along a compass `bearingDeg` (geodesic).
const offsetLatLng = (lat, lng, bearingDeg, dist) => {
  const R = 6378137;
  const d = dist / R, t = bearingDeg * Math.PI / 180;
  const p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * 180 / Math.PI, lng: l2 * 180 / Math.PI };
};

// --- FRAMING TUNING KNOBS (tweak by number; no code knowledge needed) ---
const RAIL_SKEW_PX = 44;     // how far the hole slides left (px). Smaller = more centered.
const FRAME_TOP_PX = 6;      // extra gap between the top pills and the back of green (px).
const FRAME_BOTTOM_PX = 4;   // extra gap between the player/tee and the bottom UI (px).

// --- MAP HELPER COMPONENTS ---
function MapCameraTracker({ startLoc, greenLoc, polygon, centerTrigger, currentHoleIndex, isTeeView, topInsetPx, bottomInsetPx }) {
  const map = useMap();
  // Latest geometry via refs so the camera only re-solves on the trigger deps
  // below (recenter / hole / view / inset / resize), never on every GPS tick.
  const startRef = useRef(startLoc); startRef.current = startLoc;
  const greenRef = useRef(greenLoc); greenRef.current = greenLoc;
  const polyRef = useRef(polygon); polyRef.current = polygon;

  useEffect(() => {
    const updateView = () => {
      const start = startRef.current, green = greenRef.current, poly = polyRef.current;
      if (!start || !green) return;
      const mapSize = map.getSize();
      if (mapSize.y === 0) return;

      const playBearing = calculateBearing(start.lat, start.lng, green.lat, green.lng);
      // Local metre projection around the green; unit vector along the play line.
      const mx = 111320 * Math.cos(green.lat * Math.PI / 180), my = 110540;
      const toXY = (p) => ({ x: (p.lng - green.lng) * mx, y: (p.lat - green.lat) * my });
      const S = toXY(start);
      const dlen = Math.hypot(S.x, S.y) || 1;
      const ux = -S.x / dlen, uy = -S.y / dlen; // points start -> green

      // Back edge of the green: the polygon vertex farthest along the play line.
      let backPoint, spanMeters;
      if (poly && poly.length) {
        let maxProj = -Infinity, bx = 0, by = 0;
        for (const p of poly) {
          const q = toXY(p);
          const proj = (q.x - S.x) * ux + (q.y - S.y) * uy;
          if (proj > maxProj) { maxProj = proj; bx = q.x; by = q.y; }
        }
        spanMeters = maxProj;
        backPoint = { lat: green.lat + by / my, lng: green.lng + bx / mx };
      } else {
        backPoint = offsetLatLng(green.lat, green.lng, playBearing, 12);
        const bq = toXY(backPoint);
        spanMeters = (bq.x - S.x) * ux + (bq.y - S.y) * uy;
      }
      if (!(spanMeters > 0)) return;

      const usablePx = Math.max(50, mapSize.y - topInsetPx - bottomInsetPx);
      const mpp = spanMeters / usablePx;
      const centerLatRad = green.lat * Math.PI / 180;
      let zoom = Math.log2((156543.03392 * Math.cos(centerLatRad)) / mpp);
      zoom = Math.max(5, Math.min(21, zoom));

      // Screen centre lies on the play line, fraction f from backPoint -> start,
      // so the back edge lands at topInsetPx and the player/tee at the bottom inset.
      const f = (mapSize.y / 2 - topInsetPx) / usablePx;
      const center = {
        lat: backPoint.lat + f * (start.lat - backPoint.lat),
        lng: backPoint.lng + f * (start.lng - backPoint.lng),
      };
      const c = offsetLatLng(center.lat, center.lng, playBearing + 90, RAIL_SKEW_PX * mpp);
      map.setView([c.lat, c.lng], zoom, { animate: false });
    };

    updateView();
    // Re-solve on container resize (replaces the old 500ms invalidateSize hack).
    const ro = new ResizeObserver(() => { map.invalidateSize(); updateView(); });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, centerTrigger, currentHoleIndex, isTeeView, topInsetPx, bottomInsetPx]);

  return null;
}

// A white play-line segment with a gap around its midpoint so a distance label
// sits in a clean break. Falls back to a single line for very short segments.
function BrokenPolyline({ a, b, meters }) {
  if (!a || !b) return null;
  const opts = { color: 'white', weight: 2 };
  const gap = Math.min(30, Math.max(12, (meters || 0) * 0.20));
  const hf = meters > 0 ? (gap / 2) / meters : 0;
  if (hf >= 0.45) return <Polyline positions={[[a.lat, a.lng], [b.lat, b.lng]]} pathOptions={opts} />;
  const lerp = (t) => [a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t];
  return (
    <>
      <Polyline positions={[[a.lat, a.lng], lerp(0.5 - hf)]} pathOptions={opts} />
      <Polyline positions={[lerp(0.5 + hf), [b.lat, b.lng]]} pathOptions={opts} />
    </>
  );
}

function MapRotationManager({ bearing, centerTrigger, currentHoleIndex, isTeeView }) {
  const map = useMap();
  // Rotation should only update on recenter / hole / view changes, not on every
  // bearing tick — so read the latest bearing from a ref instead of depending on it.
  const bearingRef = useRef(bearing);
  bearingRef.current = bearing;
  useEffect(() => {
    if (typeof map.setBearing === 'function') map.setBearing(bearingRef.current);
  }, [map, centerTrigger, currentHoleIndex, isTeeView]);
  return null;
}

function MapEvents({ setTargetPoint }) {
  const map = useMapEvents({
    click(e) {
      setTargetPoint((prev) => {
        // Tapping (roughly) the same spot again clears the waypoint.
        if (prev) {
          const a = map.latLngToContainerPoint(e.latlng);
          const b = map.latLngToContainerPoint([prev.lat, prev.lng]);
          if (a.distanceTo(b) < 25) return null;
        }
        return { lat: e.latlng.lat, lng: e.latlng.lng };
      });
    },
    dblclick() { setTargetPoint(null); }
  });
  return null;
}

// --- ICONS ---
// Pin-accurate flag: a small hollow white ring whose CENTRE sits exactly on
// greenLocation; the stick and rectangular flag rise upward only.
const greenIcon = divIcon({
  className: '',
  html: `<svg width="20" height="28" viewBox="0 0 20 28" style="display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));">
      <line x1="10" y1="23" x2="10" y2="4" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
      <rect x="10" y="4" width="9" height="6" fill="${baseTheme.ink}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round" />
      <circle cx="10" cy="23" r="3" fill="none" stroke="#ffffff" stroke-width="2" />
    </svg>`,
  iconSize: [20, 28], iconAnchor: [10, 23]
});

const userIcon = divIcon({
  className: '', 
  html: `<div style="background-color: #4A90E2; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9]
});

// Aiming marker: a hollow white ring with a small white centre dot (distances
// live on the line midpoints as chips). Drop-shadow keeps it readable on imagery.
const targetIcon = divIcon({
  className: '',
  html: `<svg width="20" height="20" viewBox="0 0 20 20" style="display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));">
      <circle cx="10" cy="10" r="7" fill="none" stroke="#ffffff" stroke-width="2" />
      <circle cx="10" cy="10" r="2" fill="#ffffff" />
    </svg>`,
  iconSize: [20, 20], iconAnchor: [10, 10]
});

// Boxless distance label centred on a point (green front/back + line midpoints).
// Theme-independent: always white bold numerals with a dark halo for legibility
// over the satellite imagery — no background/border.
const createChip = (distance, size = 13) => divIcon({
  className: '',
  html: `<div style="display: inline-block; transform: translate(-50%, -50%); color: #fff; font-family: ${baseTheme.num}; font-size: ${size}px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; text-shadow: 0 0 3px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95), 0 1px 2px rgba(0,0,0,.9);">${distance}</div>`,
  iconSize: [0, 0], iconAnchor: [0, 0]
});

// --- FRONT/BACK OF GREEN ---
// Beyond this distance the green is too far to bother showing front/back.
const MAX_FB_DISTANCE = 300;
// Where the play line (from `from` through `green`) crosses the green polygon:
// front = nearest crossing, back = farthest. Returns the crossing points (lat/lng)
// and the unrounded distances from `from`. Falls back to nearest/farthest polygon
// vertex when the ray gives fewer than two crossings (e.g. measured from inside).
const frontBackOnLine = (from, green, polygon) => {
  if (!from || !green || !polygon || polygon.length < 2) return null;
  const mx = 111320 * Math.cos(green.lat * Math.PI / 180), my = 110540;
  const toXY = (p) => ({ x: (p.lng - green.lng) * mx, y: (p.lat - green.lat) * my });
  const toLL = (x, y) => ({ lat: green.lat + y / my, lng: green.lng + x / mx });

  const F = toXY(from);
  const rx = -F.x, ry = -F.y; // ray direction: from `from` toward the green centre (origin)
  const hits = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const A = toXY(polygon[i]);
    const B = toXY(polygon[(i + 1) % n]); // wrap to close the ring
    const ex = B.x - A.x, ey = B.y - A.y;
    const denom = rx * ey - ry * ex;
    if (denom === 0) continue;
    const afx = A.x - F.x, afy = A.y - F.y;
    const t = (afx * ey - afy * ex) / denom; // ray param (>0 ahead of `from`)
    const s = (afx * ry - afy * rx) / denom; // edge param (0..1 on the edge)
    if (t > 1e-9 && s >= 0 && s <= 1) {
      const px = F.x + t * rx, py = F.y + t * ry;
      hits.push({ t, dist: Math.hypot(px - F.x, py - F.y), pt: toLL(px, py) });
    }
  }
  if (hits.length >= 2) {
    hits.sort((a, b) => a.t - b.t);
    const f = hits[0], b = hits[hits.length - 1];
    return { frontPt: f.pt, backPt: b.pt, front: f.dist, back: b.dist };
  }

  // Fallback: nearest / farthest polygon vertex from `from`.
  let frontPt = null, backPt = null, front = Infinity, back = -Infinity;
  for (const p of polygon) {
    const d = calculateDistanceInMeters(from.lat, from.lng, p.lat, p.lng);
    if (d < front) { front = d; frontPt = p; }
    if (d > back) { back = d; backPt = p; }
  }
  if (!frontPt) return null;
  return { frontPt, backPt, front, back };
};

// --- SCORECARD HELPER COMPONENTS ---
const getScoreStyles = (score, par, col) => {
  if (!score || score === 0) return { shape: null, textColor: col };
  const diff = score - par;
  if (diff <= -2) return { shape: 'double-circle', textColor: col };
  if (diff === -1) return { shape: 'circle', textColor: col };
  if (diff === 0) return { shape: null, textColor: col };
  if (diff === 1) return { shape: 'square', textColor: col };
  if (diff === 2) return { shape: 'double-square', textColor: col };
  return { shape: 'red-square', textColor: '#fff' };
};

const renderScoreShape = (shape, col) => {
  const base = { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (shape === 'circle') return <div style={{ ...base, border: `1.5px solid ${col}`, borderRadius: '50%' }} />;
  if (shape === 'double-circle') return (
    <div style={{ ...base, border: `1.5px solid ${col}`, borderRadius: '50%', padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${col}`, borderRadius: '50%' }} />
    </div>
  );
  if (shape === 'square') return <div style={{ ...base, border: `1.5px solid ${col}` }} />;
  if (shape === 'double-square') return (
    <div style={{ ...base, border: `1.5px solid ${col}`, padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${col}` }} />
    </div>
  );
  if (shape === 'red-square') return <div style={{ ...base, backgroundColor: '#d32f2f' }} />;
  return null;
};

const ToggleBtn = ({ label, checked, onChange, theme }) => (
  <div
    onClick={() => onChange(!checked)}
    style={{
      padding: '7px 11px', borderRadius: theme.radius, cursor: 'pointer', fontSize: '0.78rem',
      backgroundColor: checked ? theme.scText : 'transparent',
      color: checked ? theme.scBg : theme.scText,
      border: `1px solid ${checked ? theme.scText : theme.scLine}`,
      fontWeight: 'bold',
      transition: 'all 0.1s ease',
      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap'
    }}
  >
    {label}
  </div>
);

const MatchToggleBtn = ({ label, value, selected, onClick, theme }) => (
  <div
    onClick={() => onClick(value)}
    style={{
      padding: '7px 4px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
      borderRadius: theme.radius, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
      backgroundColor: selected ? theme.panelText : 'transparent',
      color: selected ? theme.scBg : theme.panelText,
      border: `1px solid ${selected ? theme.panelText : theme.hairLight}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: 1, textAlign: 'center', boxSizing: 'border-box',
      transition: 'all 0.15s ease', textTransform: 'uppercase', letterSpacing: '0.08em'
    }}
  >
    {label}
  </div>
);

// Safe localStorage read: parses JSON, returns fallback on missing/invalid.
const loadJSON = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
// A valid 18-length round array, else the given empty round.
const loadRound = (key, fill) => {
  const v = loadJSON(key, null);
  return (Array.isArray(v) && v.length === 18) ? v : Array(18).fill(fill);
};

// --- BAG / CLUB RECOMMENDATION ---
// max = full-swing carry in metres.
const DEFAULT_BAG = [
  { id: 'dr', label: 'Dræver', max: 300 },
  { id: '3w', label: '3-tré', max: 200 },
  { id: 'i4', label: '4-járn', max: 160 },
  { id: 'i5', label: '5-járn', max: 150 },
  { id: 'i6', label: '6-járn', max: 140 },
  { id: 'i7', label: '7-járn', max: 130 },
  { id: 'i8', label: '8-járn', max: 125 },
  { id: 'i9', label: '9-járn', max: 115 },
  { id: 'pw', label: 'PW', max: 110 },
  { id: 'w56', label: '56°', max: 95 },
];
const freshBag = () => DEFAULT_BAG.map((c) => ({ ...c, enabled: true }));
const loadBag = () => {
  const v = loadJSON('myBag', null);
  if (Array.isArray(v) && v.length && v.every((c) => c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.max === 'number')) {
    return v.map((c) => ({ id: c.id, label: c.label, max: c.max, enabled: c.enabled !== false }));
  }
  return freshBag();
};

// Recommend a club for a plays-like target distance (metres). Returns
// { label, pct } where pct is null for a full swing (>=95%) or out-of-range.
const recommendClub = (target, bag) => {
  if (target == null || !(target > 0)) return null;
  const enabled = bag.filter((c) => c.enabled).slice().sort((a, b) => a.max - b.max);
  if (enabled.length === 0) return null;
  const longest = enabled[enabled.length - 1];
  let idx = enabled.findIndex((c) => c.max >= target);
  if (idx === -1) return target <= longest.max * 1.05 ? { label: longest.label, pct: null } : null;
  // Swinging near a club's max (but not exactly at it) → step up one club for margin.
  if (target / enabled[idx].max > 0.93 && target < enabled[idx].max && idx < enabled.length - 1) idx += 1;
  const chosen = enabled[idx];
  const pct = Math.round((target / chosen.max) * 100 / 5) * 5;
  return { label: chosen.label, pct: pct < 95 ? pct : null };
};

// "Plays like" model (returns adjusted metres, or null when out of range / no dist):
//  • SLOPE: rise / tan(descent angle); descentDeg = max(36, 52 - 0.06·dist) so short
//    shots (steep landing) care less about elevation, long shots more.
//  • WIND: along-shot component only (crosswind cancels via cosine). Headwind
//    lengthens ~1.5%/(m·s⁻¹), mildly superlinear; tailwind shortens ~0.75%/(m·s⁻¹).
//  • TEMPERATURE (air density): cold air plays longer, ~0.12%/°C from a 20°C baseline.
// Each term is independently optional (no NaN when wind/temp/elevation is missing).
const playsLikeFor = (distM, elevDiff, w, relAngleDeg) => {
  if (distM === null || distM > MAX_FB_DISTANCE) return null;
  let adj = 0;
  if (elevDiff !== null) {
    const descentDeg = Math.max(36, 52 - 0.06 * distM);
    adj += elevDiff / Math.tan(descentDeg * Math.PI / 180);
  }
  if (w && relAngleDeg !== null) {
    const tail = w.speed * Math.cos(relAngleDeg * Math.PI / 180); // + tailwind, - headwind
    adj += tail >= 0 ? -distM * tail * 0.0075 : -distM * tail * (0.015 + 0.0004 * w.speed);
  }
  if (w && w.tempC != null) {
    const t = Math.max(-15, Math.min(30, w.tempC));
    adj += distM * (20 - t) * 0.0012;
  }
  return Math.round(distM + adj);
};

// --- MAIN APP ---
export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(() => {
    const saved = localStorage.getItem('currentHoleIndex');
    const n = saved !== null ? parseInt(saved, 10) : 0;
    return Number.isNaN(n) ? 0 : Math.min(17, Math.max(0, n));
  });

  const [scores, setScores] = useState(() => loadRound('myScores', 0));
  const [putts, setPutts] = useState(() => loadRound('myPutts', 0));
  const [matchPlay, setMatchPlay] = useState(() => loadRound('myMatch', ''));
  
  const [gbUser, setGbUser] = useState(() => localStorage.getItem('gbUser') || '');
  const [gbPass, setGbPass] = useState(() => localStorage.getItem('gbPass') || '');
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [trackScore, setTrackScore] = useState(() => loadJSON('trackScore', true));
  const [trackPutts, setTrackPutts] = useState(() => loadJSON('trackPutts', false));
  const [trackGame, setTrackGame] = useState(() => loadJSON('trackGame', false));

  // Simple view: map shows only the centre distance (no elevation, wind, F/B).
  const [simpleView, setSimpleView] = useState(() => loadJSON('simpleView', false));

  // Club bag + whether the club recommendation ("KYLFA") is shown.
  const [bag, setBag] = useState(loadBag);
  const [showClubRec, setShowClubRec] = useState(() => loadJSON('showClubRec', true));
  // Bag editor lives on its own screen (opened from the bottom of the scorecard).
  const [showBag, setShowBag] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [newClubMax, setNewClubMax] = useState('');

  // Dark / light theme for the whole app (HUD + scorecard). Defaults to dark.
  const [darkMode, setDarkMode] = useState(() => loadJSON('darkMode', true));
  const theme = useMemo(() => makeTheme(darkMode), [darkMode]);
  const cardStyle = useMemo(() => ({
    background: theme.panel, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${theme.hairLight}`, boxShadow: theme.panelShadow, color: theme.panelText,
  }), [theme]);

  const [hideEasterEgg, setHideEasterEgg] = useState(false);

  const [gpsLocation, setGpsLocation] = useState(null);
  const [gpsError, setGpsError] = useState(false);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [centerTrigger, setCenterTrigger] = useState(0);
  // Auto-frame bookkeeping — refs (not state) so GPS ticks don't re-render or reset timers.
  const autoCenter = useRef({ done: false, firstFixAt: 0, timer: null });

  // --- WIND STATE (Open-Meteo, free/keyless; the only feature needing network) ---
  // { speed: m/s, fromDeg: meteorological direction the wind blows FROM } or null.
  const [wind, setWind] = useState(null);

  const scorecardRef = useRef(null);
  const videoRef = useRef(null);
  const loginFormRef = useRef(null);

  // Cached club recommendation (anti-flicker; see below).
  const recRef = useRef({ target: null, rec: null, bag: null });

  // Measured UI insets (px) so the camera frames exactly above/below the chrome.
  const topPillRef = useRef(null);
  const footerRef = useRef(null);
  const navRef = useRef(null);
  const [insets, setInsets] = useState({ top: 64, bottom: 56 });

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  // --- ELEVATION ---
  // greenElevation - originElevation (origin = tee in tee view, player in live
  // view). Positive = uphill. Pure local DEM math, so deriving it is cheap.
  const elevationDiff = useMemo(() => {
    const origin = isTeeView ? currentHole.teeLocation : gpsLocation;
    if (!origin) return null;
    const originElev = getElevation(origin.lat, origin.lng);
    const greenElev = getElevation(currentHole.greenLocation.lat, currentHole.greenLocation.lng);
    return (originElev !== null && greenElev !== null) ? greenElev - originElev : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeeView, currentHoleIndex, gpsLocation]);

  // --- WIND FETCH ---
  // One request for the course (wind is ~uniform over 1.5km); refresh every 10 min.
  useEffect(() => {
    let cancelled = false;
    const fetchWind = async () => {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=64.1678&longitude=-21.7357&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=ms');
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.current) setWind({ speed: j.current.wind_speed_10m, fromDeg: j.current.wind_direction_10m, gust: j.current.wind_gusts_10m, tempC: j.current.temperature_2m });
      } catch { /* wind is non-critical; ignore failures (e.g. offline) */ }
    };
    fetchWind();
    const id = setInterval(fetchWind, 10 * 60 * 1000);
    // Refresh when the app returns to foreground (e.g. phone unlocked mid-round).
    const onVisible = () => { if (document.visibilityState === 'visible') fetchWind(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    localStorage.setItem('currentHoleIndex', currentHoleIndex);
    localStorage.setItem('myScores', JSON.stringify(scores));
    localStorage.setItem('myPutts', JSON.stringify(putts));
    localStorage.setItem('myMatch', JSON.stringify(matchPlay));
    localStorage.setItem('trackScore', JSON.stringify(trackScore));
    localStorage.setItem('trackPutts', JSON.stringify(trackPutts));
    localStorage.setItem('trackGame', JSON.stringify(trackGame));
    localStorage.setItem('simpleView', JSON.stringify(simpleView));
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    localStorage.setItem('myBag', JSON.stringify(bag));
    localStorage.setItem('showClubRec', JSON.stringify(showClubRec));
  }, [currentHoleIndex, scores, putts, matchPlay, trackScore, trackPutts, trackGame, simpleView, darkMode, bag, showClubRec]);

  // Match the browser/PWA status-bar colour to the theme (fixes the green top border).
  useEffect(() => {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = darkMode ? '#0b1813' : '#0a4d2a';
  }, [darkMode]);

  const matchPlayResult = useMemo(() => {
    if (!trackGame) return '';
    let aWins = 0, bWins = 0, holesLogged = 0;
    matchPlay.forEach(val => {
      if (val === 'A') aWins++;
      else if (val === 'B') bWins++;
      if (val !== '') holesLogged++;
    });
    const diff = aWins - bWins;
    const absDiff = Math.abs(diff);
    const strokeWord = absDiff === 1 ? 'höggi' : 'höggum';
    const verb = holesLogged === 18 ? 'vann' : 'er að vinna';
    if (diff > 0) return `Halli ${verb} með ${absDiff} ${strokeWord}`;
    if (diff < 0) return `Hinir ${verb} með ${absDiff} ${strokeWord}`;
    return 'Jafntefli';
  }, [matchPlay, trackGame]);

  useEffect(() => {
    if (isTeeView) return;
    setGpsError(false);
    if (!("geolocation" in navigator)) { setGpsError(true); return; }

    let lastAccepted = null; // last accepted { lat, lng }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGpsError(false); // a successful callback means GPS works, even if we skip this fix
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        // Accept the first fix immediately; afterwards drop noisy/tiny moves.
        if (lastAccepted) {
          if (accuracy > 25) return;
          if (calculateDistanceInMeters(lastAccepted.lat, lastAccepted.lng, lat, lng) < 2) return;
        }
        lastAccepted = { lat, lng };
        setGpsLocation({ lat, lng, accuracy });
      },
      (error) => {
        console.error("GPS Error:", error.message);
        setGpsError(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTeeView]);

  // Reset auto-frame bookkeeping when the hole or view changes.
  useEffect(() => {
    const ac = autoCenter.current;
    ac.done = false;
    ac.firstFixAt = 0;
    if (ac.timer) { clearTimeout(ac.timer); ac.timer = null; }
  }, [currentHoleIndex, isTeeView]);

  // Auto-frame the hole once per hole/view: as soon as an accepted fix is
  // accurate (<=30 m), or 6 s after the first fix if it never gets that good.
  useEffect(() => {
    if (isTeeView || !gpsLocation) return;
    const ac = autoCenter.current;
    if (ac.done) return;
    const center = () => {
      if (ac.done) return;
      ac.done = true;
      if (ac.timer) { clearTimeout(ac.timer); ac.timer = null; }
      setCenterTrigger(c => c + 1);
    };
    if (ac.firstFixAt === 0) {
      ac.firstFixAt = Date.now();
      ac.timer = setTimeout(center, 6000); // fallback; set ONCE (not reset by later fixes)
    }
    if (gpsLocation.accuracy != null && gpsLocation.accuracy <= 30) center();
  }, [gpsLocation, isTeeView, currentHoleIndex]);

  // Clear any pending auto-frame timer on unmount.
  useEffect(() => () => { if (autoCenter.current.timer) clearTimeout(autoCenter.current.timer); }, []);

  useEffect(() => { setTargetPoint(null); }, [currentHoleIndex]);

  const adjustScore = (amount) => {
    const newScores = [...scores];
    const currentVal = newScores[currentHoleIndex] || 0;
    newScores[currentHoleIndex] = currentVal === 0 ? currentHole.par : Math.max(0, currentVal + amount);
    setScores(newScores);
  };

  const adjustPutts = (amount) => {
    const newPutts = [...putts];
    const currentVal = newPutts[currentHoleIndex] || 0;
    newPutts[currentHoleIndex] = currentVal === 0 ? 1 : Math.max(0, currentVal + amount);
    setPutts(newPutts);
  };

  const toggleMatchPlay = (teamValue) => {
    const newMatch = [...matchPlay];
    newMatch[currentHoleIndex] = newMatch[currentHoleIndex] === teamValue ? '' : teamValue;
    setMatchPlay(newMatch);
  };

  const handleScoreChange = (val, index = currentHoleIndex) => {
    const parsed = parseInt(val, 10);
    const newScores = [...scores];
    newScores[index] = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setScores(newScores);
  };

  const handlePuttsChange = (val, index = currentHoleIndex) => {
    const parsed = parseInt(val, 10);
    const newPutts = [...putts];
    newPutts[index] = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setPutts(newPutts);
  };

  const updateMatch = (val, index = currentHoleIndex) => {
    const newMatch = [...matchPlay];
    newMatch[index] = val;
    setMatchPlay(newMatch);
  };

  const saveScorecardImage = async () => {
    setIsExporting(true);
    setTimeout(async () => {
      if (!scorecardRef.current) { setIsExporting(false); return; }
      try {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(scorecardRef.current, { backgroundColor: theme.scBg, scale: 2 });
        const link = document.createElement('a');
        const dateString = new Date().toISOString().split('T')[0];
        link.download = `Mosgolf_Skorkort_${dateString}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch { /* export failed; just reset */ }
      setIsExporting(false);
    }, 150);
  };

  const handleGolfBoxLogin = () => {
    localStorage.setItem('gbUser', gbUser);
    localStorage.setItem('gbPass', gbPass);
    setShowLoginModal(false);
    openGolfBox();
  };

  const startPiP = async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 450; 
      const ctx = canvas.getContext('2d');
      const drawCanvas = () => {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, 800, 450);
        const cols = 9, rows = 2, cellW = 800 / cols, cellH = 450 / rows;
        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        for (let i = 0; i < 18; i++) {
          const col = i % cols, row = Math.floor(i / cols), x = col * cellW, y = row * cellH;
          ctx.strokeRect(x, y, cellW, cellH);
          ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.lineTo(x + cellW, y + 30); ctx.stroke();
          ctx.fillStyle = '#AAAAAA'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(i + 1, x + cellW / 2, y + 15);
          const scoreVal = scores[i], scoreText = (scoreVal && scoreVal !== 0) ? scoreVal : ''; 
          ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 80px sans-serif'; 
          ctx.fillText(scoreText, x + cellW / 2, y + 30 + (cellH - 30) / 2);
        }
        ctx.fillStyle = Date.now() % 1000 < 500 ? theme.darkGreen : '#111111';
        ctx.beginPath(); ctx.arc(785, 435, 6, 0, Math.PI * 2); ctx.fill();
      };
      drawCanvas();
      const intervalId = setInterval(drawCanvas, 500);
      const stream = canvas.captureStream(30);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await videoRef.current.requestPictureInPicture();
        videoRef.current.addEventListener('leavepictureinpicture', () => clearInterval(intervalId), { once: true });
      }
    } catch (err) {
      alert("Gat ekki opnað PiP. Vafrinn þinn gæti lokað á það.");
    }
  };

  const openGolfBox = () => {
    if (!gbUser || !gbPass) { setShowLoginModal(true); return; }
    if (loginFormRef.current) {
      const gbWindow = window.open('', 'golfbox_window');
      if (!gbWindow) { alert("Sprettigluggi lokaður. Vinsamlegast leyfðu sprettiglugga."); return; }
      loginFormRef.current.target = 'golfbox_window';
      loginFormRef.current.submit();
      setTimeout(() => {
        if (gbWindow && !gbWindow.closed) gbWindow.location.href = 'https://www.golfbox.dk/site/my_golfbox/score/whs/newWHSScore.asp';
      }, 2000);
    }
  };

  const clearRound = () => {
    if (window.confirm("Þurrka út allt?")) {
      setScores(Array(18).fill(0));
      setPutts(Array(18).fill(0));
      setMatchPlay(Array(18).fill(''));
      setShowScorecard(false);
      setCurrentHoleIndex(0);
    }
  };

  const adjustClubMax = (id, delta) =>
    setBag((prev) => prev.map((c) => c.id === id ? { ...c, max: Math.min(350, Math.max(20, c.max + delta)) } : c));
  const toggleClub = (id) =>
    setBag((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  const resetBag = () => { if (window.confirm('Endurstilla pokann?')) setBag(freshBag()); };
  const deleteClub = (id) => setBag((prev) => prev.filter((c) => c.id !== id));
  // Add a club from the name + max fields; insert it where its max distance
  // belongs in the list (longest first, like the default bag).
  const addClub = () => {
    const label = newClubName.trim();
    const max = Math.round(Number(newClubMax));
    if (!label || !Number.isFinite(max) || max < 20 || max > 350) return;
    const club = { id: 'c' + Date.now().toString(36), label, max, enabled: true };
    setBag((prev) => {
      const idx = prev.findIndex((c) => c.max < max);
      const next = [...prev];
      next.splice(idx === -1 ? next.length : idx, 0, club);
      return next;
    });
    setNewClubName('');
    setNewClubMax('');
  };

  const userLocation = isTeeView ? currentHole.teeLocation : gpsLocation;
  const activeLocation = userLocation || currentHole.teeLocation; 
  let distanceUserToGreen = null, distanceUserToTarget = null, distanceTargetToGreen = null, mapBearing = 0, initialBounds = null;

  if (userLocation) distanceUserToGreen = calculateDistanceInMeters(userLocation.lat, userLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  if (userLocation && targetPoint) distanceUserToTarget = calculateDistanceInMeters(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
  if (targetPoint) distanceTargetToGreen = calculateDistanceInMeters(targetPoint.lat, targetPoint.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  if (activeLocation) mapBearing = -calculateBearing(activeLocation.lat, activeLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);

  // Current hole's traced green (polygon + aim point).
  const greenInfo = greenData[currentHoleIndex] || null;
  const holePolygon = greenInfo ? greenInfo.polygon : null;
  // Front/back chips sit where the play line crosses the green edge, measured
  // from the aimed-at waypoint if one is placed, otherwise the player/tee.
  // Complex view only, <=300m.
  const fbFrom = targetPoint || userLocation;
  const fbDist = targetPoint ? distanceTargetToGreen : distanceUserToGreen;
  const greenFB = (!simpleView && fbFrom && fbDist !== null && fbDist <= MAX_FB_DISTANCE)
    ? frontBackOnLine(fbFrom, currentHole.greenLocation, holePolygon) : null;

  // Wind direction relative to the line of play: 0° = tailwind (blows toward green),
  // 180° = headwind. Used to rotate the wind arrow in the play-up map frame.
  let windRelAngle = null;
  if (wind && activeLocation) {
    const holeBearing = calculateBearing(activeLocation.lat, activeLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
    windRelAngle = ((wind.fromDeg + 180 - holeBearing) % 360 + 360) % 360;
  }

  // Elevation + wind share one pill (complex view only).
  const elevRounded = elevationDiff !== null ? Math.round(elevationDiff) : null;
  const showWind = !simpleView && wind && windRelAngle !== null;
  const showElev = !simpleView && elevRounded !== null;

  // "Plays like" to the green (player/tee → green). Model lives in playsLikeFor.
  const playsLike = playsLikeFor(distanceUserToGreen, elevationDiff, wind, windRelAngle);
  const showPlaysLike = !simpleView && playsLike !== null;

  // Plays-like for the player→target leg when a tap target is placed (same model,
  // its own elevation/wind/temperature). The Spilast display stays green-based.
  let targetPlaysLike = null;
  if (targetPoint && userLocation && distanceUserToTarget !== null) {
    const oElev = getElevation(userLocation.lat, userLocation.lng);
    const tElev = getElevation(targetPoint.lat, targetPoint.lng);
    const tElevDiff = (oElev !== null && tElev !== null) ? tElev - oElev : null;
    const tBearing = calculateBearing(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
    const tWindRel = wind ? ((wind.fromDeg + 180 - tBearing) % 360 + 360) % 360 : null;
    targetPlaysLike = playsLikeFor(distanceUserToTarget, tElevDiff, wind, tWindRel);
  }

  // Club recommendation keys on the shot in front of you: the target leg if a tap
  // target is placed, otherwise the green. Cached in a ref; only re-evaluated when
  // the target distance moves >= 2 m (or the bag changes) so it doesn't flicker.
  const recTarget = targetPoint ? targetPlaysLike : playsLike;
  let recommendation = null;
  if (recTarget != null) {
    const r = recRef.current;
    if (r.target == null || r.bag !== bag || Math.abs(recTarget - r.target) >= 2) {
      recommendation = recommendClub(recTarget, bag);
      recRef.current = { target: recTarget, rec: recommendation, bag };
    } else {
      recommendation = r.rec;
    }
  }
  const showClubLine = showClubRec && !simpleView && recommendation;

  // Memoised label divIcons — rebuilt only when their displayed number changes,
  // so standing still doesn't churn marker DOM. (Labels are theme-independent.)
  const fbFront = greenFB ? Math.round(greenFB.front) : null;
  const fbBack = greenFB ? Math.round(greenFB.back) : null;
  const greenFrontChip = useMemo(() => (fbFront !== null ? createChip(fbFront) : null), [fbFront]);
  const greenBackChip = useMemo(() => (fbBack !== null ? createChip(fbBack) : null), [fbBack]);
  const toTargetChip = useMemo(() => (distanceUserToTarget !== null ? createChip(distanceUserToTarget, 18) : null), [distanceUserToTarget]);
  const targetToGreenChip = useMemo(() => (distanceTargetToGreen !== null ? createChip(distanceTargetToGreen, 18) : null), [distanceTargetToGreen]);

  if (activeLocation && currentHole.greenLocation) {
    initialBounds = [
      [activeLocation.lat, activeLocation.lng],
      [currentHole.greenLocation.lat, currentHole.greenLocation.lng]
    ];
  }

  const calculateTotal = (arr, start, end) => arr.slice(start, end).reduce((a, b) => a + b, 0);

  const SQUARE_CELL_SIZE = '44px';
  const cellStyle = {
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: SQUARE_CELL_SIZE,
    borderBottom: `1px solid ${theme.scLine}`, borderRight: `1px solid ${theme.scLine}`, boxSizing: 'border-box', position: 'relative',
    color: theme.scText
  };
  const summaryCellStyle = { ...cellStyle, fontWeight: 'bold', backgroundColor: theme.scAccent, color: theme.scText };
  
  const getGridCols = () => {
    const cols = ['40px', '40px'];
    if (trackScore) cols.push('1fr');
    if (trackPutts) cols.push('1fr');
    if (trackGame) cols.push('75px');
    return cols.join(' ');
  };

  const topPillStyle = {
    position: 'absolute', top: 'max(env(safe-area-inset-top, 15px), 15px)', zIndex: 1000,
    ...cardStyle, padding: '0 12px', borderRadius: theme.radius, boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: '34px'
  };

  const stepperBtnStyle = {
    width: '40px', height: '40px', border: 'none', background: 'transparent',
    color: theme.panelText, fontSize: '2.5rem', fontWeight: '300', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    outline: 'none', touchAction: 'manipulation'
  };

  const invisibleInputStyle = { 
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
    boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', 
    border: 'none', background: 'transparent', outline: 'none', margin: 0, padding: 0, zIndex: 2 
  };

  const renderRow = (holeData, index) => {
    const scoreVal = scores[index] || 0;
    const { shape, textColor } = getScoreStyles(scoreVal, holeData.par, theme.scText);
    return (
      <React.Fragment key={index}>
        <div
          onClick={() => { setCurrentHoleIndex(index); setShowScorecard(false); }}
          style={{ ...cellStyle, fontWeight: 'bold', cursor: 'pointer', backgroundColor: theme.scHead }}
          title={`Fara á holu ${holeData.hole}`}
        >
          {holeData.hole}
        </div>
        <div style={{ ...cellStyle, fontWeight: 'normal' }}>{holeData.par}</div>
        
        {trackScore && (
          <div style={{ ...cellStyle }}>
            <div style={{ position: 'absolute', zIndex: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {renderScoreShape(shape, theme.scShape)}
            </div>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textColor, fontWeight: 'bold' }}>
                {scoreVal || ''}
              </div>
            ) : (
              <input 
                type="number" inputMode="numeric" className="no-spinners"
                value={scoreVal || ''} onChange={(e) => handleScoreChange(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: textColor, fontWeight: 'bold' }} 
              />
            )}
          </div>
        )}
        
        {trackPutts && (
          <div style={{ ...cellStyle }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.scText, fontWeight: 'bold' }}>
                {putts[index] || ''}
              </div>
            ) : (
              <input 
                type="number" inputMode="numeric" className="no-spinners"
                value={putts[index] || ''} onChange={(e) => handlePuttsChange(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: theme.scText, fontWeight: 'bold' }} 
              />
            )}
          </div>
        )}
        
        {trackGame && (
          <div style={{ ...cellStyle, padding: '0' }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.scText, fontWeight: 'normal', fontSize: '0.9rem' }}>
                {matchPlay[index] === 'A' ? 'Halli' : matchPlay[index] === 'B' ? 'Hinir' : matchPlay[index] === 'H' ? 'Féll' : ''}
              </div>
            ) : (
              <select 
                value={matchPlay[index]} onChange={(e) => updateMatch(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: theme.scText, appearance: 'none', textAlignLast: 'center', fontWeight: 'bold', fontSize: '0.95rem' }}
              >
                <option value=""></option>
                <option value="A">Halli</option>
                <option value="B">Hinir</option>
                <option value="H">Féll</option>
              </select>
            )}
          </div>
        )}
      </React.Fragment>
    );
  };

  const showFooter = trackScore || trackPutts || trackGame;

  // Measure the real UI insets so framing is exact, not estimated. Top inset =
  // the top pill's offset + height + margin. Bottom inset = the gap from the
  // viewport bottom up to the highest of the footer / prev-next button row.
  useEffect(() => {
    const measure = () => {
      const pill = topPillRef.current;
      const top = pill ? pill.offsetTop + pill.offsetHeight + FRAME_TOP_PX : 64;
      const vh = window.innerHeight;
      let obstructionTop = Infinity;
      if (footerRef.current) obstructionTop = Math.min(obstructionTop, footerRef.current.getBoundingClientRect().top);
      if (navRef.current) obstructionTop = Math.min(obstructionTop, navRef.current.getBoundingClientRect().top);
      const bottom = obstructionTop === Infinity ? 0 : Math.max(0, vh - obstructionTop + FRAME_BOTTOM_PX);
      setInsets((prev) => (prev.top === top && prev.bottom === bottom) ? prev : { top, bottom });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (footerRef.current) ro.observe(footerRef.current);
    if (navRef.current) ro.observe(navRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [showFooter, trackScore, trackPutts, trackGame]);

  const actionBtnStyle = {
    flex: 1, padding: '15px 5px', background: 'transparent', border: `2px solid ${theme.scLine}`, borderRadius: theme.radius,
    fontWeight: 'bold', fontSize: '0.95rem', color: theme.scText, cursor: 'pointer',
    textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center'
  };

  // Small stepper for the bag editor (scorecard-themed, smaller than the footer steppers).
  const clubStepBtnStyle = {
    width: '24px', height: '24px', border: 'none', background: 'transparent', color: theme.scText,
    fontSize: '1.4rem', fontWeight: 300, cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 0, lineHeight: 1, touchAction: 'manipulation'
  };
  // Section heading inside the scorecard (smallcaps, left-aligned).
  const sectionHeadingStyle = { ...microLabel, fontSize: '0.62rem', opacity: 0.55, margin: '0 0 12px 2px' };
  // Text fields on the bag screen (add-club form).
  const bagInputStyle = {
    minWidth: 0, flex: 1, padding: '10px', borderRadius: theme.radius,
    border: `1px solid ${theme.scLine}`, background: 'transparent', color: theme.scText,
    fontSize: '1rem', boxSizing: 'border-box', outline: 'none', fontFamily: theme.sans
  };

  const clearBtnStyle = {
    width: '100%', background: '#fff', color: '#d32f2f', padding: '15px', border: '2px solid #d32f2f', 
    borderRadius: theme.radius, fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer', 
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)',
    boxShadow: theme.shadow
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100dvh', width: '100vw',
      fontFamily: theme.sans, backgroundColor: '#e2e8e4',
      position: 'relative', overflow: 'hidden'
    }}>
      <style>{`
        .no-spinners::-webkit-inner-spin-button,
        .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinners { -moz-appearance: textfield; }
        .punchy-map-tiles { filter: contrast(1.05) saturate(1.2) brightness(1.0); }
        .num { font-family: ${theme.num}; font-feature-settings: 'tnum' 1; font-variant-numeric: tabular-nums; }
      `}</style>
      
      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
      <form ref={loginFormRef} method="POST" action="https://www.golfbox.dk/login.asp?lcid=1039" style={{ display: 'none' }}>
        <input type="hidden" name="loginform.submitted" value="true" />
        <input type="hidden" name="command" value="login" />
        <input type="hidden" name="loginform.username" value={gbUser} />
        <input type="hidden" name="loginform.password" value={gbPass} />
        <input type="hidden" name="loginform.submit" value="LOGIN" />
      </form>

      {/* LOGIN MODAL OVERLAY */}
      {showLoginModal && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.softWhite, padding: '30px', borderRadius: theme.radius, width: '90%', maxWidth: '400px', textAlign: 'center', border: `1px solid ${theme.darkGreen}` }}>
            <h3 style={{ marginTop: 0, color: theme.darkGreen, fontSize: '1.4rem', textTransform: 'uppercase' }}>Tengja við GolfBox</h3>
            <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '20px' }}>Skráðu þig inn til að opna GolfBox í sér glugga á meðan skorkortið er opið í PiP.</p>
            <input type="text" placeholder="Notendanafn" value={gbUser} onChange={(e) => setGbUser(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: theme.radius, border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box' }} />
            <input type="password" placeholder="Lykilorð" value={gbPass} onChange={(e) => setGbPass(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '25px', borderRadius: theme.radius, border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowLoginModal(false)} style={{ flex: 1, padding: '12px', background: 'transparent', color: theme.darkGreen, border: `1px solid ${theme.darkGreen}`, borderRadius: theme.radius, fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Hætta við</button>
              <button onClick={handleGolfBoxLogin} style={{ flex: 1, padding: '12px', background: theme.darkGreen, color: '#fff', border: 'none', borderRadius: theme.radius, fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Vista & Skrá</button>
            </div>
          </div>
        </div>
      )}

      {/* FULL-SCREEN MAP WITH LAYER STACKING */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <MapContainer bounds={initialBounds} doubleClickZoom={false} zoomControl={false} rotateControl={false} zoomSnap={0} maxZoom={22} rotate={true} style={{ width: '100%', height: '100%' }}>
          <MapCameraTracker startLoc={activeLocation} greenLoc={currentHole.greenLocation} polygon={holePolygon} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} topInsetPx={insets.top} bottomInsetPx={insets.bottom} />
          <MapRotationManager bearing={mapBearing} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} />
          <MapEvents setTargetPoint={setTargetPoint} />

          <TileLayer
            url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&v=2"
            attribution="&copy; Google"
            maxZoom={22}
            maxNativeZoom={21}
            className="punchy-map-tiles"
          />

          {/* Traced green outline — verification only (SHOW_GREEN_OUTLINES).
              Under markers; non-interactive so taps pass through. */}
          {SHOW_GREEN_OUTLINES && holePolygon && (
            <Polygon positions={holePolygon} interactive={false}
              pathOptions={{ color: 'white', weight: 1.5, opacity: 0.75, fill: true, fillColor: 'white', fillOpacity: 0.05 }} />
          )}
          {/* Largest-inscribed-circle "safe aim" — faint dashed outline, complex view only */}
          {!simpleView && greenInfo && greenInfo.aim && (
            <Circle center={[greenInfo.aim.lat, greenInfo.aim.lng]} radius={greenInfo.aimRadius} interactive={false}
              pathOptions={{ color: 'white', weight: 1, opacity: 0.5, fillOpacity: 0, dashArray: '4 6' }} />
          )}

          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={greenIcon} rotateWithView={false} />
          {/* Front/back chips on the green (from waypoint if aiming, else player) */}
          {greenFB && greenFrontChip && <Marker position={[greenFB.frontPt.lat, greenFB.frontPt.lng]} icon={greenFrontChip} rotateWithView={false} />}
          {greenFB && greenBackChip && <Marker position={[greenFB.backPt.lat, greenFB.backPt.lng]} icon={greenBackChip} rotateWithView={false} />}
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} rotateWithView={false} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={targetIcon} rotateWithView={false} />}
          {/* Distances on the line midpoints: player→mark and mark→hole */}
          {userLocation && targetPoint && toTargetChip && (
            <Marker position={[(userLocation.lat + targetPoint.lat) / 2, (userLocation.lng + targetPoint.lng) / 2]} icon={toTargetChip} rotateWithView={false} />
          )}
          {targetPoint && targetToGreenChip && (
            <Marker position={[(targetPoint.lat + currentHole.greenLocation.lat) / 2, (targetPoint.lng + currentHole.greenLocation.lng) / 2]} icon={targetToGreenChip} rotateWithView={false} />
          )}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <BrokenPolyline a={userLocation} b={targetPoint} meters={distanceUserToTarget} />}
          {targetPoint && <BrokenPolyline a={targetPoint} b={currentHole.greenLocation} meters={distanceTargetToGreen} />}
        </MapContainer>
      </div>

      {/* FLOATING TOP BAR - LEFT PILL */}
      <div ref={topPillRef} style={{ ...topPillStyle, left: '15px', gap: '8px' }}>
        <span style={{ ...microLabel }}>Hola</span>
        <span className="num" style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1 }}>{currentHole.hole}</span>
        <span style={{ width: '1px', height: '16px', background: theme.hairLight }} />
        <span style={{ ...microLabel }}>Par</span>
        <span className="num" style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1 }}>{currentHole.par}</span>
      </div>

      {/* FLOATING TOP BAR - RIGHT PILL (same width as the info rail) */}
      <button onClick={() => setShowScorecard(true)} style={{ ...topPillStyle, right: '15px', width: '104px', cursor: 'pointer' }}>
        <span style={{ ...microLabel, fontSize: '0.68rem', opacity: 0.9, letterSpacing: '0.12em' }}>Skorkort</span>
      </button>

      {/* FLOATING TOOLS LEFT */}
      <div style={{ position: 'absolute', top: 'calc(max(env(safe-area-inset-top, 15px), 15px) + 54px)', left: '15px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1000 }}>
        <div onClick={() => setIsTeeView(!isTeeView)} style={{ ...cardStyle,padding: '11px', borderRadius: theme.radius, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
        </div>
        {!isTeeView && (
          <div onClick={() => setCenterTrigger(c => c + 1)} style={{ ...cardStyle,padding: '11px', borderRadius: theme.radius, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Crosshair size={20} />
          </div>
        )}
      </div>

      {/* RIGHT INFO RAIL — distance + conditions, aligned with the left tools */}
      <div style={{
        position: 'absolute', top: 'calc(max(env(safe-area-inset-top, 15px), 15px) + 54px)', right: '15px', zIndex: 1000,
        width: '104px', display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none'
      }}>
        <div style={{
          ...cardStyle, borderRadius: theme.radius, padding: '8px 6px',
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
            <span className="num" style={{ fontSize: distanceUserToGreen !== null ? '2.6rem' : '1.05rem', fontWeight: 700, lineHeight: 0.82 }}>
              {distanceUserToGreen !== null ? distanceUserToGreen : gpsError ? 'Engin GPS' : 'Leitar...'}
            </span>
            {distanceUserToGreen !== null && <span style={{ ...microLabel, fontSize: '0.5rem' }}>m</span>}
          </div>
          {showPlaysLike && (
            <>
              <span style={{ width: '78%', height: '1px', background: theme.hairLight, margin: '5px 0 3px' }} />
              <span style={{ ...microLabel, fontSize: '0.46rem' }}>Spilast</span>
              <span className="num" style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 0.92, color: theme.accent }}>{playsLike}</span>
            </>
          )}
          {showClubLine && (
            <>
              <span style={{ width: '78%', height: '1px', background: theme.hairLight, margin: '5px 0 3px' }} />
              <span style={{ ...microLabel, fontSize: '0.46rem' }}>Kylfa</span>
              <span className="num" style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 0.95 }}>
                {recommendation.label}
                {recommendation.pct != null && <span style={{ fontSize: '0.75em', opacity: 0.7 }}> {recommendation.pct}%</span>}
              </span>
            </>
          )}
        </div>

        {/* Conditions — wind | slope side by side, same width as the distance box */}
        {(showWind || showElev) && (
          <div style={{
            ...cardStyle, borderRadius: theme.radius, padding: '7px 6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}>
            {showWind && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '18px', height: '18px', borderRadius: '50%', border: `1.5px solid ${theme.panelText}`
                }}>
                  <span style={{ display: 'inline-block', transform: `rotate(${windRelAngle}deg)`, fontSize: '0.72rem', lineHeight: 1 }}>↑</span>
                </span>
                <span className="num" style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 0.85 }}>{Math.round(wind.speed)}</span>
                {/* Gust as a smaller secondary number, only when meaningfully gustier */}
                {wind.gust != null && (wind.gust - wind.speed) >= 4 && (
                  <span className="num" style={{ fontSize: '0.8em', fontWeight: 700, lineHeight: 0.85, opacity: 0.75 }}>/{Math.round(wind.gust)}</span>
                )}
              </div>
            )}
            {showWind && showElev && <span style={{ width: '1px', alignSelf: 'stretch', background: theme.hairLight }} />}
            {showElev && (
              <span className="num" style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 0.85 }}>
                {elevRounded > 0 ? '▲' : elevRounded < 0 ? '▼' : '–'}{Math.abs(elevRounded)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* MAP CONTROLS - PREV / NEXT */}
      <div ref={navRef} style={{ position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', left: '15px', zIndex: 1000, transition: 'bottom 0.3s ease' }}>
        <button onClick={() => setCurrentHoleIndex(Math.max(0, currentHoleIndex - 1))} style={{ ...cardStyle,padding: '11px 18px', borderRadius: theme.radius, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Fyrri
        </button>
      </div>
      <div style={{ position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', right: '15px', zIndex: 1000, transition: 'bottom 0.3s ease' }}>
        <button onClick={() => setCurrentHoleIndex(Math.min(17, currentHoleIndex + 1))} style={{ ...cardStyle,padding: '11px 18px', borderRadius: theme.radius, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Næsta
        </button>
      </div>

      {/* UNIFIED SCORING & LEIKUR FOOTER */}
      {showFooter && (
        <div ref={footerRef} style={{
          position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 15px) + 15px)', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, width: '92%', maxWidth: '380px', display: 'flex', flexDirection: 'column',
          ...cardStyle, borderRadius: theme.radius,
          overflow: 'hidden'
        }}>
          {(trackScore || trackPutts) && (
            <div style={{ display: 'flex', flexDirection: 'row', width: '100%' }}>
              {trackScore && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
                  <button onClick={() => adjustScore(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span className="num" style={{ fontSize: '1.7rem', fontWeight: 700, color: theme.panelText, lineHeight: '1' }}>
                      {scores[currentHoleIndex] || 0}
                    </span>
                    <span style={{ ...microLabel, marginTop: '3px' }}>Högg</span>
                  </div>
                  <button onClick={() => adjustScore(1)} style={stepperBtnStyle}>+</button>
                </div>
              )}
              {trackPutts && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderLeft: trackScore ? `1px solid ${theme.hairLight}` : 'none' }}>
                  <button onClick={() => adjustPutts(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span className="num" style={{ fontSize: '1.7rem', fontWeight: 700, color: theme.panelText, lineHeight: '1' }}>
                      {putts[currentHoleIndex] || 0}
                    </span>
                    <span style={{ ...microLabel, marginTop: '3px' }}>Pútt</span>
                  </div>
                  <button onClick={() => adjustPutts(1)} style={stepperBtnStyle}>+</button>
                </div>
              )}
            </div>
          )}

          {trackGame && (
            <div style={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', 
              width: '100%', padding: '8px', 
              borderTop: (trackScore || trackPutts) ? `1px solid ${theme.hairLight}` : 'none',
              boxSizing: 'border-box'
            }}>
              <MatchToggleBtn label="Halli" value="A" selected={matchPlay[currentHoleIndex] === 'A'} onClick={toggleMatchPlay} theme={theme} />
              <MatchToggleBtn label="Hinir" value="B" selected={matchPlay[currentHoleIndex] === 'B'} onClick={toggleMatchPlay} theme={theme} />
              <MatchToggleBtn label="Féll" value="H" selected={matchPlay[currentHoleIndex] === 'H'} onClick={toggleMatchPlay} theme={theme} />
            </div>
          )}
        </div>
      )}

      {/* SCORECARD OVERLAY */}
      {showScorecard && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex: 9999, display: 'flex', flexDirection: 'column', color: theme.scText }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifySelf: 'start' }}>
              <div onClick={() => setSimpleView((s) => !s)} title="Einfalt / Ítarlegt yfirlit" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center' }}>
                {simpleView ? <Eye size={19} /> : <EyeOff size={19} />}
              </div>
              <div onClick={() => setDarkMode((d) => !d)} title="Ljóst / Dökkt þema" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center' }}>
                {darkMode ? <Sun size={19} /> : <Moon size={19} />}
              </div>
              <div onClick={() => setShowClubRec((v) => !v)} title="Kylfuráðgjöf af/á" style={{ cursor: 'pointer', color: 'white', opacity: showClubRec ? 0.85 : 0.4, display: 'flex', alignItems: 'center' }}>
                <Backpack size={19} />
              </div>
            </div>
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Skorkort</h2>
            <div onClick={() => setShowScorecard(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '25px' }}>
              <ToggleBtn label="Skor" checked={trackScore} onChange={setTrackScore} theme={theme} />
              <ToggleBtn label="Pútt" checked={trackPutts} onChange={setTrackPutts} theme={theme} />
              <ToggleBtn label="Leikur" checked={trackGame} onChange={setTrackGame} theme={theme} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <div ref={scorecardRef} style={{ background: theme.scCell, borderRadius: '0', border: `2px solid ${theme.scLine}`, overflow: 'hidden', marginBottom: '25px', width: '100%', boxShadow: theme.shadow }}>
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.8rem', backgroundColor: theme.scHead, borderBottom: `2px solid ${theme.scLine}`, color: theme.scText }}>
                  <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>H</strong>
                  <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>P</strong>
                  {trackScore && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>SKOR</strong>}
                  {trackPutts && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>PÚTT</strong>}
                  {trackGame && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>LEIKUR</strong>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '1.1rem', backgroundColor: theme.scCell, color: theme.scText }}>
                  {courseData.slice(0, 9).map((hole, i) => renderRow(hole, i))}
                  <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>ÚT</div>
                  <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{courseData.slice(0, 9).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{calculateTotal(scores, 0, 9)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{calculateTotal(putts, 0, 9)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}></div>}
                  {courseData.slice(9, 18).map((hole, i) => renderRow(hole, i + 9))}
                  <div style={{ ...summaryCellStyle }}>INN</div>
                  <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>}
                  {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle }}></div>}
                  <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>TOT</div>
                  <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(scores, 0, 18)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(putts, 0, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}></div>}
                </div>
              </div>
            </div>

            {trackGame && matchPlayResult && (
              <div style={{ padding: '20px', background: 'transparent', border: `2px solid ${theme.scLine}`, borderRadius: theme.radius, marginBottom: '25px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: theme.scText }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: theme.scText, textTransform: 'uppercase', letterSpacing: '1px' }}>Niðurstaða leiks</h3>
                {matchPlayResult}
              </div>
            )}

            {/* AÐGERÐIR — export / submit */}
            <div style={sectionHeadingStyle}>Aðgerðir</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%' }}>
              <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
                <button onClick={saveScorecardImage} style={actionBtnStyle}>Vista mynd</button>
                <button onClick={startPiP} style={{ ...actionBtnStyle, color: '#4A90E2', border: '2px solid #4A90E2' }}>Opna í PiP</button>
              </div>
              <button onClick={openGolfBox} style={{ ...actionBtnStyle, background: theme.darkGreen, color: '#fff', border: `2px solid ${theme.darkGreen}`, width: '100%', flex: 'none' }}>
                Skrá skor í GolfBox
              </button>
            </div>

            <button onClick={clearRound} style={{ ...clearBtnStyle, marginTop: '25px', marginBottom: '15px' }}>Þurrka út skorkort</button>

            {/* Bag editor opens as its own screen so it doesn't take scorecard space */}
            <button onClick={() => setShowBag(true)} style={{
              ...actionBtnStyle, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box',
              marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
            }}>Pokinn</button>
          </div>
        </div>
      )}

      {/* BAG SCREEN OVERLAY — sits above the scorecard */}
      {showBag && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex: 10000, display: 'flex', flexDirection: 'column', color: theme.scText }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div />
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Pokinn</h2>
            <div onClick={() => setShowBag(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: '28px' }}>
              {bag.map((c) => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                  border: `1px solid ${theme.scLine}`, borderRadius: theme.radius, padding: '4px 6px',
                  opacity: c.enabled ? 1 : 0.4
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                    <button onClick={() => deleteClub(c.id)} title="Eyða kylfu" style={{ ...clubStepBtnStyle, width: '20px', height: '20px', opacity: 0.65 }}>
                      <X size={13} />
                    </button>
                    <span onClick={() => toggleClub(c.id)} title="Smelltu til að taka úr/í pokann" style={{
                      cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem',
                      textDecoration: c.enabled ? 'none' : 'line-through',
                      minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                    }}>{c.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                    <button onClick={() => adjustClubMax(c.id, -5)} style={clubStepBtnStyle}>{"−"}</button>
                    <span className="num" style={{ fontSize: '0.95rem', fontWeight: 700, minWidth: '36px', textAlign: 'center' }}>
                      {c.max}<span style={{ fontSize: '0.6em', opacity: 0.7 }}>m</span>
                    </span>
                    <button onClick={() => adjustClubMax(c.id, 5)} style={clubStepBtnStyle}>+</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add a club: name + max distance, inserted sorted by distance */}
            <div style={sectionHeadingStyle}>Bæta við kylfu</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '28px' }}>
              <input
                type="text" value={newClubName} onChange={(e) => setNewClubName(e.target.value)}
                placeholder="Nafn" style={bagInputStyle}
              />
              <input
                type="number" inputMode="numeric" className="no-spinners"
                value={newClubMax} onChange={(e) => setNewClubMax(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addClub(); }}
                placeholder="Metrar" style={{ ...bagInputStyle, flex: '0 0 90px' }}
              />
              <button onClick={addClub} style={{
                padding: '0 14px', background: theme.scText, color: theme.scBg, border: 'none',
                borderRadius: theme.radius, fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '0.5px'
              }}>Bæta við</button>
            </div>

            <button onClick={resetBag} style={{
              background: 'transparent', color: theme.scText, border: `1px solid ${theme.scLine}`,
              borderRadius: theme.radius, padding: '12px 14px', fontWeight: 'bold', fontSize: '0.8rem',
              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100%',
              marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
            }}>Sjálfgefinn poki</button>
          </div>
        </div>
      )}

      {/* EASTER EGG */}
      {scores[5] === 7 && !hideEasterEgg && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 99999, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <img src={easterEggImg} alt="Easter Egg" style={{ maxWidth: '80%', maxHeight: '60%', borderRadius: theme.radius, boxShadow: '0 10px 30px rgba(0,0,0,0.8)', border: '4px solid white' }} />
          <button onClick={() => setHideEasterEgg(true)} style={{ marginTop: '30px', background: theme.darkGreen, color: 'white', padding: '12px 30px', border: 'none', borderRadius: theme.radius, fontSize: '1.2rem', fontWeight: '900', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Loka
          </button>
        </div>
      )}
    </div>
  );
}