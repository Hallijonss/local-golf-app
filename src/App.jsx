import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { courseData, courseMeta } from './courseData';
import { greenData } from './greenData';
import { featureData } from './featureData';
import { calculateDistanceInMeters, calculateBearing, getElevation } from './utils';
import { MapContainer, Marker, useMapEvents, Polyline, Polygon, Circle, useMap, TileLayer } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { Navigation, Flag, Crosshair, X, Settings, ClipboardList } from 'lucide-react';

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

// --- SHOT MARKS (Snjallskrá) ---
// Small white dot for a recorded shot position (module scope — never inline).
const markDotIcon = divIcon({
  className: '',
  html: `<svg width="12" height="12" viewBox="0 0 12 12" style="display:block; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.6));">
      <circle cx="6" cy="6" r="4" fill="none" stroke="#ffffff" stroke-width="2" />
    </svg>`,
  iconSize: [12, 12], iconAnchor: [6, 6]
});

// Ray-cast point-in-polygon over a { lat, lng } ring.
const pointInPolygon = (lat, lng, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > lat) !== (b.lat > lat) && lng < (b.lng - a.lng) * (lat - a.lat) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
};

// What a marked shot position landed in: bunkers win over fairways (a bunker
// can sit inside a fairway outline); anything else is unknown — never guessed.
const surfaceAt = (lat, lng) => {
  for (const b of featureData.bunkers) if (pointInPolygon(lat, lng, b)) return 'bunker';
  for (const f of featureData.fairways) if (pointInPolygon(lat, lng, f)) return 'fairway';
  return null;
};

// Working shot marks for the live round (NEW key 'myMarks'): 18 × arrays of
// { lat, lng, accuracy, t }. Survives reloads like the live scores do.
const loadMarks = () => {
  const v = loadJSON('myMarks', null);
  if (!Array.isArray(v) || v.length !== 18) return Array(18).fill().map(() => []);
  return v.map((m) => Array.isArray(m)
    ? m.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : []);
};

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

// One row on the settings screen: descriptive label + on/off switch.
const SettingRow = ({ label, checked, onChange, theme }) => (
  <div
    onClick={() => onChange(!checked)}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
      padding: '13px 12px', border: `1px solid ${theme.scLine}`, borderRadius: theme.radius,
      cursor: 'pointer'
    }}
  >
    <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{label}</span>
    <div style={{
      width: '42px', height: '24px', borderRadius: '12px', position: 'relative', flex: 'none',
      backgroundColor: checked ? theme.scText : 'transparent',
      border: `1px solid ${checked ? theme.scText : theme.scLine}`,
      boxSizing: 'border-box', transition: 'background-color 0.15s ease'
    }}>
      <div style={{
        position: 'absolute', top: '3px', left: checked ? '23px' : '3px',
        width: '16px', height: '16px', borderRadius: '50%',
        backgroundColor: checked ? theme.scBg : theme.scText, transition: 'left 0.15s ease'
      }} />
    </div>
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

// --- SAVED ROUNDS ('myRounds') ---
// ONE round-object schema (schemaVersion 1) — every later feature reads/writes this:
// {
//   schemaVersion: 1,
//   date: ISO string (set at save time),
//   course: 'Mosgolf',
//   weather: { speed, fromDeg, gust, tempC } | null,   // wind snapshot at save time
//   holes: [ 18 × {
//     hole: 1..18, par,                                 // from courseData
//     score, putts,                                     // numbers, 0 = not entered
//     match: '' | 'A' | 'B' | 'H',
//     sheet: null | 'skipped' | {                       // stage 2: post-hole stats
//       tee: 'left'|'hit'|'right'|'whiff'|null,         //   par 4/5 tee shot
//       green: 'short'|'left'|'hit'|'right'|'long'|null,//   par 3 "Á flöt?"
//       bunker: 0|1|2|null, penalty: 0|1|2|null,        //   2 means "2+"
//       firstPutt: '<1'|'1-3'|'3-10'|'10+'|null },      //   metres
//     marks: [ { lat, lng, accuracy, t } ],             // stage 4: raw GPS shot marks
//     shots: [ 'string per stroke' ],                   // stage 4: derived at save time
//       — '<len>m[, fairway|bunker], <toGreen>m to green' for each marked shot,
//         'no info' for unmarked strokes, 'putt' × putts. Nothing is guessed.
//   } ],
// }
// Stored newest-first in the NEW localStorage key 'myRounds' (live round keys
// myScores/myPutts/myMatch stay untouched), capped at MAX_ROUNDS.
const ROUNDS_KEY = 'myRounds';
const MAX_ROUNDS = 50;
const loadRounds = () => {
  const v = loadJSON(ROUNDS_KEY, null);
  if (!Array.isArray(v)) return [];
  return v
    .filter((r) => r && typeof r === 'object' && typeof r.date === 'string' && Array.isArray(r.holes) && r.holes.length === 18)
    .slice(0, MAX_ROUNDS);
};
// Working stat sheets for the live round (NEW key 'mySheets'): 18 × the round
// schema's hole.sheet value (null | 'skipped' | object). Survives app restarts
// mid-round like the live scores do.
const loadSheets = () => {
  const v = loadJSON('mySheets', null);
  return (Array.isArray(v) && v.length === 18) ? v : Array(18).fill(null);
};

// --- EXPORT ---
// English schema notes embedded in every export so the file is self-describing
// (an AI analyzing it needs no other context).
const EXPORT_README =
  'Golf rounds from Mosgolf (Mosfellsbaer, Iceland), exported from a personal GPS app. ' +
  'rounds[] items: { schemaVersion, date (ISO string, when the round was saved), course, ' +
  'weather (conditions snapshot at save time or null: speed = wind m/s, fromDeg = compass direction the wind blows FROM, gust = m/s, tempC = air temp Celsius), ' +
  'holes[18] }. Each hole: { hole (1-18), par, score (strokes, 0 = not entered), putts (0 = not entered), ' +
  'match (match-play result: "" = not logged, "A" = player Halli won the hole, "B" = the opponents won, "H" = halved), sheet, marks }. ' +
  'sheet = self-reported post-hole stats: null (never filled), the string "skipped" (player chose to skip), or an object ' +
  '{ tee: tee-shot result on par 4/5 ("left"|"hit"|"right"|"whiff" = missed swing), ' +
  'green: tee-shot result relative to the green on par 3 ("short"|"left"|"hit"|"right"|"long"), ' +
  'bunker: bunker shots taken (0|1|2 where 2 means 2 or more), penalty: penalty strokes (same scale), ' +
  'firstPutt: first-putt length in metres ("<1"|"1-3"|"3-10"|"10+") } — any field may be null (unanswered; partial data is normal). ' +
  'marks = raw GPS points ({lat, lng, accuracy in metres, t = unix ms}) recorded by the player pressing a button right where each shot was played. ' +
  'shots = the same data made readable, one string per stroke in order: "<length>m[, fairway|bunker], <distance>m to green" for a GPS-marked shot ' +
  '(surface comes from traced course polygons; absent = unknown lie), "no info" for strokes the player did not mark, and "putt" for each recorded putt. ' +
  'Nothing is derived beyond that — missing data stays missing.';

// Download an object as pretty-printed JSON via a temporary Blob link (no deps).
const downloadJSON = (obj, filename) => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Rounds with fewer scored holes than this are left out of the bulk export —
// they're abandoned cards, not data.
const MIN_EXPORT_HOLES = 6;

// Every applicable sheet question answered? (tee on par 4/5, green on par 3.)
const isSheetComplete = (sheet, par) => !!sheet && typeof sheet === 'object' &&
  (par > 3 ? sheet.tee != null : sheet.green != null) &&
  sheet.bunker != null && sheet.penalty != null && sheet.firstPutt != null;

// Out/in/total strokes, par diff over the holes actually played, total putts.
const summarizeRound = (r) => {
  let out = 0, inn = 0, parPlayed = 0, holesPlayed = 0, puttsTotal = 0;
  r.holes.forEach((h, i) => {
    const s = h.score || 0;
    if (i < 9) out += s; else inn += s;
    if (s > 0) { parPlayed += h.par; holesPlayed += 1; }
    puttsTotal += h.putts || 0;
  });
  const total = out + inn;
  return { out, inn, total, diff: total - parPlayed, holesPlayed, puttsTotal };
};
// Manual day.month.year — locale data for is-IS isn't guaranteed on every device.
const fmtRoundDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
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

// How many metres past a club's max still counts as a full swing when the
// front edge of the green is reachable (ball lands on the green, just short).
const FULL_SWING_OVER_M = 3;
// Off the tee the driver never gets recommended ("no driver off the deck").
const DRIVER_ID = 'dr';

// Recommend a club for a plays-like target distance (metres). Always the
// smallest enabled club that covers the shot — no early step-up. A club just
// short of the target (<= FULL_SWING_OVER_M) still counts as a full swing if
// its max carries the front edge of the green (frontDist, plays-like metres).
// Anything beyond the longest club gets that club at full swing (the driver
// covers every shot past the next-longest club). Returns { label, pct } where
// pct is null for a full swing (>=95%).
const recommendClub = (target, bag, { frontDist = null, onTee = true } = {}) => {
  if (target == null || !(target > 0)) return null;
  const enabled = bag
    .filter((c) => c.enabled && (onTee || c.id !== DRIVER_ID))
    .slice().sort((a, b) => a.max - b.max);
  if (enabled.length === 0) return null;
  for (const c of enabled) {
    if (c.max >= target) {
      const pct = Math.round((target / c.max) * 100 / 5) * 5;
      return { label: c.label, pct: pct < 95 ? pct : null };
    }
    if (target - c.max <= FULL_SWING_OVER_M && frontDist !== null && c.max >= frontDist) {
      return { label: c.label, pct: null };
    }
  }
  return { label: enabled[enabled.length - 1].label, pct: null };
};

// "Plays like" model (returns adjusted metres, or null when out of range / no dist):
//  • SLOPE: rise / tan(descent angle); descentDeg = max(36, 52 - 0.06·dist) so short
//    shots (steep landing) care less about elevation, long shots more.
//  • WIND: along-shot component only (crosswind cancels via cosine). Headwind
//    lengthens ~1.5%/(m·s⁻¹), mildly superlinear; tailwind shortens ~0.75%/(m·s⁻¹).
//  • TEMPERATURE (air density): cold air plays longer, ~0.12%/°C. The baseline is
//    a typical Icelandic golf day (BASELINE_TEMP_C) — the bag's club distances are
//    calibrated in local conditions, so only deviations from the local norm count.
// Each term is independently optional (no NaN when wind/temp/elevation is missing).
const BASELINE_TEMP_C = 8;
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
    adj += distM * (BASELINE_TEMP_C - t) * 0.0012;
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
  // "Snjallskrá" — GPS shot-mark mode (replaces the old "Rekja skot" placeholder).
  const [snjallskra, setSnjallskra] = useState(() => loadJSON('snjallskra', false));
  // "Skrá gögn sjálfur" — post-hole stat sheet on/off.
  const [statSheet, setStatSheet] = useState(() => loadJSON('statSheet', false));
  // Shot marks for the live round + brief button-press flash.
  const [marks, setMarks] = useState(loadMarks);
  const [markFlash, setMarkFlash] = useState(false);
  // Live-round stat sheets + which hole's sheet is open (null = closed) + draft.
  const [sheets, setSheets] = useState(loadSheets);
  const [sheetHole, setSheetHole] = useState(null);
  const [sheetDraft, setSheetDraft] = useState({});

  // Simple view: map shows only the centre distance (no elevation, wind, F/B).
  const [simpleView, setSimpleView] = useState(() => loadJSON('simpleView', false));

  // Club bag + whether the club recommendation ("KYLFA") is shown.
  const [bag, setBag] = useState(loadBag);
  const [showClubRec, setShowClubRec] = useState(() => loadJSON('showClubRec', true));
  // Bag editor, settings and saved rounds live on their own screens (opened from
  // the scorecard).
  const [showBag, setShowBag] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRounds, setShowRounds] = useState(false);

  // Saved rounds archive ('myRounds') + which round is expanded in Mínir hringir,
  // and the save-before-clear question for Þurrka út skorkort.
  const [rounds, setRounds] = useState(loadRounds);
  const [expandedRound, setExpandedRound] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Rounds ticked for the AI-prompt export (dates; not persisted).
  const [selectedRounds, setSelectedRounds] = useState([]);
  // Player handicap index — manual entry in Stillingar. GolfBox is another website,
  // so the browser's same-origin policy stops us reading it from their page.
  const [handicap, setHandicap] = useState(() => localStorage.getItem('myHandicap') || '');
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
  const recRef = useRef({ target: null, rec: null, bag: null, onTee: null });

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
    localStorage.setItem('snjallskra', JSON.stringify(snjallskra));
    localStorage.setItem('statSheet', JSON.stringify(statSheet));
    localStorage.setItem('mySheets', JSON.stringify(sheets));
    localStorage.setItem('myMarks', JSON.stringify(marks));
    localStorage.setItem('myHandicap', handicap);
    localStorage.setItem('simpleView', JSON.stringify(simpleView));
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    localStorage.setItem('myBag', JSON.stringify(bag));
    localStorage.setItem('showClubRec', JSON.stringify(showClubRec));
  }, [currentHoleIndex, scores, putts, matchPlay, trackScore, trackPutts, trackGame, snjallskra, statSheet, sheets, marks, handicap, simpleView, darkMode, bag, showClubRec]);

  // Saved rounds live in their own NEW key; the live-round keys above stay as-is.
  useEffect(() => {
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
  }, [rounds]);

  // Match the browser/PWA status-bar colour to the theme (fixes the green top border).
  useEffect(() => {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = darkMode ? '#0b1813' : '#0a4d2a';
  }, [darkMode]);

  // Match status over a hole range for the LEIKUR summary cells (ÚT/INN/TOT):
  // "Halli +n" / "Hinir +n" / "Jafnt", or '' while nothing is logged in the range.
  const matchSummary = (start, end) => {
    let a = 0, b = 0, logged = 0;
    for (let i = start; i < end; i++) {
      if (matchPlay[i] === 'A') a++;
      else if (matchPlay[i] === 'B') b++;
      if (matchPlay[i]) logged++;
    }
    if (!logged) return '';
    const d = a - b;
    return d > 0 ? `Halli +${d}` : d < 0 ? `Hinir +${-d}` : 'Jafnt';
  };

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

  // Post-hole stat sheet: leaving a hole that has a score but no sheet yet slides
  // the sheet up for that hole (only while "Skrá gögn sjálfur" is on). The ref
  // guard means re-runs from scores/sheets changes never fire it.
  const prevHoleRef = useRef(currentHoleIndex);
  useEffect(() => {
    const prev = prevHoleRef.current;
    prevHoleRef.current = currentHoleIndex;
    if (prev === currentHoleIndex || !statSheet) return;
    if ((scores[prev] || 0) > 0 && sheets[prev] == null) {
      setSheetDraft({});
      setSheetHole(prev);
    }
  }, [currentHoleIndex, statSheet, scores, sheets]);

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

  // Build a round object (schema above) from the live round + weather snapshot.
  const buildRound = () => ({
    schemaVersion: 1,
    date: new Date().toISOString(),
    course: 'Mosgolf',
    weather: wind ? { speed: wind.speed, fromDeg: wind.fromDeg, gust: wind.gust, tempC: wind.tempC } : null,
    holes: courseData.map((h, i) => ({
      hole: h.hole, par: h.par,
      score: scores[i] || 0, putts: putts[i] || 0, match: matchPlay[i] || '',
      sheet: sheets[i] || null, marks: marks[i] || [], shots: deriveShots(i),
    })),
  });
  // Built outside the setState updater so StrictMode's double-invoke stays pure.
  const archiveCurrentRound = () => {
    const r = buildRound();
    setRounds((prev) => [r, ...prev].slice(0, MAX_ROUNDS));
  };
  const saveRound = () => {
    if (!scores.some((s) => s > 0)) { alert('Ekkert skor til að vista.'); return; }
    archiveCurrentRound();
    alert('Hringur vistaður!');
  };
  const deleteRound = (date) => {
    if (window.confirm('Eyða þessum hring?')) setRounds((prev) => prev.filter((r) => r.date !== date));
  };

  // Export: all saved rounds plus the current round, keeping only rounds with at
  // least MIN_EXPORT_HOLES scored holes (filters out abandoned cards).
  const exportAllData = () => {
    const candidates = scores.some((s) => s > 0) ? [buildRound(), ...rounds] : rounds;
    const good = candidates.filter((r) => summarizeRound(r).holesPlayed >= MIN_EXPORT_HOLES);
    if (!good.length) { alert(`Engin gögn með a.m.k. ${MIN_EXPORT_HOLES} skráðar holur.`); return; }
    downloadJSON(
      { exportedAt: new Date().toISOString(), readme: EXPORT_README, rounds: good },
      `Mosgolf_Gogn_${new Date().toISOString().split('T')[0]}.json`
    );
  };
  // Single round from Mínir hringir — named after the round's own date.
  const exportRound = (r) => {
    downloadJSON(
      { exportedAt: new Date().toISOString(), readme: EXPORT_README, rounds: [r] },
      `Mosgolf_Gogn_${r.date.split('T')[0]}.json`
    );
  };

  // --- AI COACHING PROMPT ---
  const toggleRoundSel = (date) =>
    setSelectedRounds((prev) => prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]);

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      // Fallback for older WebViews: hidden textarea + execCommand.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  };

  const buildAIPrompt = (sel) => {
    const hcp = parseFloat(String(handicap).replace(',', '.'));
    const hasHcp = Number.isFinite(hcp);
    // WHS course handicap: index × slope/113 + (CR − par).
    const courseHcp = hasHcp ? Math.round(hcp * courseMeta.slope / 113 + (courseMeta.cr - courseMeta.par)) : null;
    const ranks = courseData.map((h) => `${h.hole}:${h.rank}`).join(' ');
    return (
      `You are a golf coaching simulator. The player is an amateur golfer` +
      `${hasHcp ? ` with a handicap index of ${hcp}` : ' (handicap index unknown)'} playing their home course.\n\n` +
      `Below are scores and self-reported stats from ${sel.length} round(s). Your job is to find how and where ` +
      `the player can improve. Do not analyse the rounds hole by hole; instead:\n` +
      `- Find where the good scores came from and look for a pattern in what went right.\n` +
      `- Find the worst holes and look for a pattern in what went wrong (tee shots, bunkers, penalties, long first putts).\n` +
      `- Compare results against each hole's stroke index (1 = hardest): where is the player losing strokes against expectation?\n` +
      `- End with the 2-3 most impactful, concrete things to practise or change, based on the data.\n\n` +
      `COURSE: ${courseMeta.name} (Mosfellsbaer, Iceland) - 18 holes, par ${courseMeta.par}, ` +
      `course rating ${courseMeta.cr}, slope ${courseMeta.slope}.` +
      `${hasHcp ? ` The player's course handicap here is about ${courseHcp}.` : ''}\n` +
      `Stroke index by hole: ${ranks}\n\n` +
      `DATA FORMAT: ${EXPORT_README}\n\n` +
      `ROUNDS (JSON):\n${JSON.stringify(sel, null, 1)}`
    );
  };

  const copyAIPrompt = async () => {
    const sel = rounds.filter((r) => selectedRounds.includes(r.date));
    if (!sel.length) { alert('Hakaðu við hringina sem á að greina.'); return; }
    const ok = await copyText(buildAIPrompt(sel));
    alert(ok ? 'AI prompt afritað á klemmuspjald.' : 'Tókst ekki að afrita.');
  };

  const doClearRound = () => {
    setScores(Array(18).fill(0));
    setPutts(Array(18).fill(0));
    setMatchPlay(Array(18).fill(''));
    setSheets(Array(18).fill(null));
    setSheetHole(null);
    setMarks(Array(18).fill().map(() => []));
    setShowScorecard(false);
    setCurrentHoleIndex(0);
  };
  // With scores on the card, offer to archive first (Já / Nei / Hætta við modal);
  // an empty card keeps the old simple confirm.
  const clearRound = () => {
    if (scores.some((s) => s > 0)) setShowClearConfirm(true);
    else if (window.confirm("Þurrka út allt?")) doClearRound();
  };

  // Snjallskrá and Skrá gögn sjálfur are mutually exclusive (both may be off).
  const setSnjallskraSafe = (v) => { setSnjallskra(v); if (v) setStatSheet(false); };
  const setStatSheetSafe = (v) => { setStatSheet(v); if (v) setSnjallskra(false); };

  // --- SHOT MARKS (Snjallskrá) handlers ---
  const canMark = snjallskra && !isTeeView && !!gpsLocation;
  const addMark = () => {
    if (!canMark) return;
    const mk = { lat: gpsLocation.lat, lng: gpsLocation.lng, accuracy: gpsLocation.accuracy ?? null, t: Date.now() };
    setMarks((prev) => prev.map((m, i) => (i === currentHoleIndex ? [...m, mk] : m)));
    setMarkFlash(true);
    setTimeout(() => setMarkFlash(false), 350);
  };
  const undoLastMark = () => {
    if (!(marks[currentHoleIndex] || []).length) return;
    if (window.confirm('Afturkalla síðasta högg?')) {
      setMarks((prev) => prev.map((m, i) => (i === currentHoleIndex ? m.slice(0, -1) : m)));
    }
  };
  // Long-press = undo; a normal tap that follows a fired long-press is swallowed.
  const markPress = useRef({ timer: null, fired: false });
  const markPressStart = () => {
    markPress.current.fired = false;
    markPress.current.timer = setTimeout(() => {
      markPress.current.fired = true;
      markPress.current.timer = null;
      undoLastMark();
    }, 600);
  };
  const markPressEnd = () => {
    if (markPress.current.timer) { clearTimeout(markPress.current.timer); markPress.current.timer = null; }
  };
  const markClick = () => { if (!markPress.current.fired) addMark(); };

  // One readable string per stroke, in order: marked shots (length, surface from
  // the traced polygons, distance to green centre), then unmarked strokes as
  // 'no info', then recorded putts. Nothing is guessed (see EXPORT_README).
  const deriveShots = (i) => {
    const green = courseData[i].greenLocation;
    const shots = [];
    let prev = courseData[i].teeLocation;
    for (const m of marks[i] || []) {
      const len = calculateDistanceInMeters(prev.lat, prev.lng, m.lat, m.lng);
      const toGreen = calculateDistanceInMeters(m.lat, m.lng, green.lat, green.lng);
      const surf = surfaceAt(m.lat, m.lng);
      shots.push(`${len}m${surf ? `, ${surf}` : ''}, ${toGreen}m to green`);
      prev = m;
    }
    const score = scores[i] || 0, p = putts[i] || 0;
    if (score > 0) {
      const unknown = Math.max(0, score - shots.length - p);
      for (let k = 0; k < unknown; k++) shots.push('no info');
      for (let k = 0; k < Math.min(p, score); k++) shots.push('putt');
    }
    return shots;
  };

  // --- STAT SHEET handlers ---
  const openSheet = (i) => {
    const existing = sheets[i];
    setSheetDraft(existing && typeof existing === 'object' ? existing : {});
    setSheetHole(i);
  };
  // Tap a chosen answer again to unselect it — partial sheets are fine by design.
  const setSheetField = (field, val) =>
    setSheetDraft((d) => ({ ...d, [field]: d[field] === val ? null : val }));
  const saveSheet = () => {
    const s = {
      tee: sheetDraft.tee ?? null, green: sheetDraft.green ?? null,
      bunker: sheetDraft.bunker ?? null, penalty: sheetDraft.penalty ?? null,
      firstPutt: sheetDraft.firstPutt ?? null,
    };
    setSheets((prev) => prev.map((v, i) => (i === sheetHole ? s : v)));
    setSheetHole(null);
  };
  // Loka (and tapping outside the box) marks the hole 'skipped' so it isn't asked
  // again; when re-editing an already saved sheet it closes without touching data.
  // Stable identity (useCallback) because the back-button effect depends on it.
  const skipSheet = useCallback(() => {
    setSheets((prev) => prev.map((v, i) => (i === sheetHole && (v == null || v === 'skipped')) ? 'skipped' : v));
    setSheetHole(null);
  }, [sheetHole]);

  // --- ANDROID BACK BUTTON ---
  // Keep ONE history entry alive while any overlay is open: hardware back then
  // closes the topmost layer (re-arming the entry while layers remain) and only
  // exits the app from a bare live view. X-button closes consume the entry.
  const anyOverlay = showScorecard || showBag || showRounds || showSettings ||
    showClearConfirm || showLoginModal || sheetHole !== null;
  const hadOverlayRef = useRef(false);

  // A reload while an overlay was open leaves a stale entry — drop it once.
  useEffect(() => {
    if (window.history.state && window.history.state.overlay) window.history.replaceState(null, '');
  }, []);

  useEffect(() => {
    const h = window.history;
    if (anyOverlay && !hadOverlayRef.current) {
      if (!(h.state && h.state.overlay)) h.pushState({ overlay: true }, '');
    } else if (!anyOverlay && hadOverlayRef.current) {
      if (h.state && h.state.overlay) h.back();
    }
    hadOverlayRef.current = anyOverlay;
  }, [anyOverlay]);

  useEffect(() => {
    const onPop = () => {
      // Top of the visual stack first (modals > sheet > bag > pages > scorecard).
      const layersOpen = [showClearConfirm, showLoginModal, sheetHole !== null, showBag, showRounds, showSettings, showScorecard].filter(Boolean).length;
      if (showClearConfirm) setShowClearConfirm(false);
      else if (showLoginModal) setShowLoginModal(false);
      else if (sheetHole !== null) skipSheet();
      else if (showBag) setShowBag(false);
      else if (showRounds) setShowRounds(false);
      else if (showSettings) setShowSettings(false);
      else if (showScorecard) setShowScorecard(false);
      else return; // nothing open: a real back navigation, let it through
      if (layersOpen > 1) window.history.pushState({ overlay: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showClearConfirm, showLoginModal, sheetHole, showBag, showRounds, showSettings, showScorecard, skipSheet]);

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
  const gustShown = showWind && wind.gust != null && (wind.gust - wind.speed) >= 4;
  // Wind+gust+slope together overflow the 104px rail → stack them in two rows.
  const stackWindElev = gustShown && showElev;

  // "Plays like" to the green (player/tee → green). Model lives in playsLikeFor.
  const playsLike = playsLikeFor(distanceUserToGreen, elevationDiff, wind, windRelAngle);

  // Plays-like for the player→target leg when a tap target is placed (same model,
  // its own elevation/wind/temperature).
  let targetPlaysLike = null;
  if (targetPoint && userLocation && distanceUserToTarget !== null) {
    const oElev = getElevation(userLocation.lat, userLocation.lng);
    const tElev = getElevation(targetPoint.lat, targetPoint.lng);
    const tElevDiff = (oElev !== null && tElev !== null) ? tElev - oElev : null;
    const tBearing = calculateBearing(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
    const tWindRel = wind ? ((wind.fromDeg + 180 - tBearing) % 360 + 360) % 360 : null;
    targetPlaysLike = playsLikeFor(distanceUserToTarget, tElevDiff, wind, tWindRel);
  }

  // The big rail number follows the shot in front of you: player→marker when a
  // point is tapped, otherwise player→green. Same for its Spilast line.
  const railDist = (targetPoint && distanceUserToTarget !== null) ? distanceUserToTarget : distanceUserToGreen;
  const railPlaysLike = (targetPoint && distanceUserToTarget !== null) ? targetPlaysLike : playsLike;
  const showPlaysLike = !simpleView && railPlaysLike !== null;

  // Club recommendation keys on the shot in front of you: the target leg if a tap
  // target is placed, otherwise the green. Cached in a ref; only re-evaluated when
  // the target distance moves >= 2 m (or the bag / tee status changes) so it
  // doesn't flicker.
  // Beyond the plays-like range (300 m) fall back to the raw distance — the
  // exact adjustment doesn't matter out there, but the driver still should show.
  const recTarget = targetPoint
    ? (targetPlaysLike ?? distanceUserToTarget)
    : (playsLike ?? distanceUserToGreen);
  // Driver only counts while you're effectively on the teebox (<= 10 m from it).
  const onTee = isTeeView || (gpsLocation
    ? calculateDistanceInMeters(gpsLocation.lat, gpsLocation.lng, currentHole.teeLocation.lat, currentHole.teeLocation.lng) <= 10
    : false);
  // Front edge in plays-like metres (same adjustment as the centre distance);
  // only meaningful when the shot is at the green, not a tapped waypoint.
  const recFront = (!targetPoint && greenFB && playsLike !== null && distanceUserToGreen !== null)
    ? greenFB.front + (playsLike - distanceUserToGreen) : null;
  let recommendation = null;
  if (recTarget != null) {
    const r = recRef.current;
    if (r.target == null || r.bag !== bag || r.onTee !== onTee || Math.abs(recTarget - r.target) >= 2) {
      recommendation = recommendClub(recTarget, bag, { frontDist: recFront, onTee });
      recRef.current = { target: recTarget, rec: recommendation, bag, onTee };
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
            {/* Small check when every sheet question for this hole is answered */}
            {statSheet && !isExporting && isSheetComplete(sheets[index], holeData.par) && (
              <span style={{ position: 'absolute', top: '1px', right: '3px', fontSize: '0.6rem', opacity: 0.7, zIndex: 3, pointerEvents: 'none' }}>✓</span>
            )}
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

  // Stat-sheet option pill (selected = filled) and one question row.
  const sheetOptStyle = (selected) => ({
    flex: 1, minWidth: 0, padding: '9px 2px', borderRadius: theme.radius, cursor: 'pointer',
    fontWeight: 700, fontSize: '0.72rem', textAlign: 'center', boxSizing: 'border-box',
    backgroundColor: selected ? theme.panelText : 'transparent',
    color: selected ? theme.scBg : theme.panelText,
    border: `1px solid ${selected ? theme.panelText : theme.hairLight}`,
    textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis'
  });
  const sheetGroup = (label, field, options) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ ...microLabel, marginBottom: '5px' }}>{label}</div>
      <div style={{ display: 'flex', gap: '6px' }}>
        {options.map((o) => (
          <div key={String(o.v)} onClick={() => setSheetField(field, o.v)} title={o.t} style={sheetOptStyle(sheetDraft[field] === o.v)}>
            {o.l}
          </div>
        ))}
      </div>
    </div>
  );

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
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
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

      {/* SAVE-BEFORE-CLEAR MODAL (Já = save+clear / Nei = clear / Hætta við) */}
      {showClearConfirm && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.softWhite, padding: '25px', borderRadius: theme.radius, width: '90%', maxWidth: '400px', textAlign: 'center', border: `1px solid ${theme.darkGreen}` }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: theme.darkGreen, fontSize: '1.15rem', textTransform: 'uppercase' }}>Vista hringinn áður en þú þurrkar út?</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { archiveCurrentRound(); doClearRound(); setShowClearConfirm(false); }} style={{ flex: 1, padding: '12px 6px', background: theme.darkGreen, color: '#fff', border: 'none', borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Já</button>
              <button onClick={() => { doClearRound(); setShowClearConfirm(false); }} style={{ flex: 1, padding: '12px 6px', background: 'transparent', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Nei</button>
              <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: '12px 6px', background: 'transparent', color: theme.darkGreen, border: `1px solid ${theme.darkGreen}`, borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Hætta við</button>
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
          {/* Snjallskrá: dashed tee → shot → shot trail + a dot per recorded shot */}
          {snjallskra && (marks[currentHoleIndex] || []).length > 0 && (
            <>
              <Polyline
                positions={[[currentHole.teeLocation.lat, currentHole.teeLocation.lng], ...marks[currentHoleIndex].map((m) => [m.lat, m.lng])]}
                pathOptions={{ color: 'white', weight: 2, opacity: 0.85, dashArray: '4 6' }}
              />
              {marks[currentHoleIndex].map((m) => (
                <Marker key={m.t} position={[m.lat, m.lng]} icon={markDotIcon} rotateWithView={false} />
              ))}
            </>
          )}
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
        {/* SKRÁ HÖGG — record a shot at the current GPS fix; long-press = undo last */}
        {snjallskra && (
          <div
            onClick={markClick}
            onMouseDown={markPressStart} onMouseUp={markPressEnd} onMouseLeave={markPressEnd}
            onTouchStart={markPressStart} onTouchEnd={markPressEnd} onTouchCancel={markPressEnd}
            onContextMenu={(e) => e.preventDefault()}
            title="Skrá högg (halda inni = afturkalla)"
            style={{
              ...cardStyle, padding: '11px 8px', borderRadius: theme.radius, position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
              cursor: canMark ? 'pointer' : 'default', opacity: canMark ? 1 : 0.45,
              background: markFlash ? theme.accent : theme.panel, transition: 'background 0.15s ease',
              fontWeight: 700, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em',
              userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation'
            }}
          >
            Skrá<br />högg
            {(marks[currentHoleIndex] || []).length > 0 && (
              <span className="num" style={{
                position: 'absolute', top: '-7px', right: '-7px', minWidth: '18px', height: '18px',
                borderRadius: '9px', background: theme.chip.bg, color: theme.chip.fg,
                border: `1px solid ${theme.chip.border}`, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '0.62rem', fontWeight: 700, padding: '0 4px', boxSizing: 'border-box'
              }}>{marks[currentHoleIndex].length}</span>
            )}
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
            <span className="num" style={{ fontSize: railDist !== null ? '2.6rem' : '1.05rem', fontWeight: 700, lineHeight: 0.82 }}>
              {railDist !== null ? railDist : gpsError ? 'Engin GPS' : 'Leitar...'}
            </span>
            {railDist !== null && <span style={{ ...microLabel, fontSize: '0.5rem' }}>m</span>}
          </div>
          {showPlaysLike && (
            <>
              <span style={{ width: '78%', height: '1px', background: theme.hairLight, margin: '5px 0 3px' }} />
              <span style={{ ...microLabel, fontSize: '0.46rem' }}>Spilast</span>
              <span className="num" style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 0.92, color: theme.accent }}>{railPlaysLike}</span>
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
            display: 'flex', flexDirection: stackWindElev ? 'column' : 'row',
            alignItems: 'center', justifyContent: 'center', gap: stackWindElev ? '5px' : '8px'
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
                {gustShown && (
                  <span className="num" style={{ fontSize: '0.8em', fontWeight: 700, lineHeight: 0.85, opacity: 0.75 }}>/{Math.round(wind.gust)}</span>
                )}
              </div>
            )}
            {showWind && showElev && (stackWindElev
              ? <span style={{ width: '62%', height: '1px', background: theme.hairLight }} />
              : <span style={{ width: '1px', alignSelf: 'stretch', background: theme.hairLight }} />
            )}
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
      <div style={{ position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', right: '15px', zIndex: 1000, transition: 'bottom 0.3s ease', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
        {/* Open the current hole's stat sheet by hand (Skrá gögn sjálfur only) */}
        {statSheet && (
          <button onClick={() => openSheet(currentHoleIndex)} title="Skrá gögn" style={{ ...cardStyle, padding: '11px', borderRadius: theme.radius, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardList size={20} />
          </button>
        )}
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
            <div onClick={() => setShowSettings(true)} title="Stillingar" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'start' }}>
              <Settings size={20} />
            </div>
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Skorkort</h2>
            <div onClick={() => setShowScorecard(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
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
                  {trackGame && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(0, 9)}</span></div>}
                  {courseData.slice(9, 18).map((hole, i) => renderRow(hole, i + 9))}
                  <div style={{ ...summaryCellStyle }}>INN</div>
                  <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>}
                  {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(9, 18)}</span></div>}
                  <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>TOT</div>
                  <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(scores, 0, 18)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(putts, 0, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(0, 18)}</span></div>}
                </div>
              </div>
            </div>

            {/* Buttons live directly under the card — no section headings */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%', marginBottom: '28px' }}>
              <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
                <button onClick={saveRound} style={{ ...actionBtnStyle, background: theme.darkGreen, color: '#fff', border: `2px solid ${theme.darkGreen}` }}>Vista hring</button>
                <button onClick={saveScorecardImage} style={actionBtnStyle}>Vista mynd</button>
              </div>
              <button onClick={() => setShowRounds(true)} style={{ ...actionBtnStyle, width: '100%', flex: 'none' }}>
                Mínir hringir
              </button>
              <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
                <button onClick={startPiP} style={{ ...actionBtnStyle, color: '#4A90E2', border: '2px solid #4A90E2' }}>Opna í PiP</button>
                <button onClick={openGolfBox} style={actionBtnStyle}>Skrá í GolfBox</button>
              </div>
            </div>

            {/* Start a fresh round — destructive, always last */}
            <button onClick={clearRound} style={clearBtnStyle}>Byrja nýjan hring</button>
          </div>
        </div>
      )}

      {/* BAG SCREEN OVERLAY — opened from settings, so it sits one layer above it */}
      {showBag && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex: 10001, display: 'flex', flexDirection: 'column', color: theme.scText }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div />
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Pokinn</h2>
            <div onClick={() => setShowBag(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '28px' }}>
              {bag.map((c) => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
                  border: `1px solid ${theme.scLine}`, borderRadius: theme.radius, padding: '6px 10px',
                  opacity: c.enabled ? 1 : 0.4, minWidth: 0, boxSizing: 'border-box'
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

      {/* ROUNDS SCREEN OVERLAY — saved rounds + data export, sits above the scorecard */}
      {showRounds && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex: 10000, display: 'flex', flexDirection: 'column', color: theme.scText }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div />
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Mínir hringir</h2>
            <div onClick={() => setShowRounds(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            {rounds.length === 0 ? (
              <div style={{ fontSize: '0.85rem', opacity: 0.6, margin: '0 2px 28px' }}>Engir vistaðir hringir.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '28px' }}>
                {rounds.map((r) => {
                  const s = summarizeRound(r);
                  const diffText = s.holesPlayed === 0 ? '–' : s.diff === 0 ? '±0' : s.diff > 0 ? `+${s.diff}` : `${s.diff}`;
                  const open = expandedRound === r.date;
                  return (
                    <div key={r.date} style={{ border: `1px solid ${theme.scLine}`, borderRadius: theme.radius }}>
                      <div onClick={() => setExpandedRound(open ? null : r.date)} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                        padding: '10px 12px', cursor: 'pointer'
                      }}>
                        {/* Tick = include this round in the AI prompt */}
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleRoundSel(r.date); }}
                          title="Velja fyrir AI greiningu"
                          style={{
                            width: '20px', height: '20px', borderRadius: '4px', flex: 'none',
                            border: `1px solid ${selectedRounds.includes(r.date) ? theme.scText : theme.scLine}`,
                            backgroundColor: selectedRounds.includes(r.date) ? theme.scText : 'transparent',
                            color: theme.scBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxSizing: 'border-box'
                          }}
                        >{selectedRounds.includes(r.date) ? '✓' : ''}</span>
                        <span style={{ fontWeight: 'bold', fontSize: '0.85rem', flex: 1 }}>{fmtRoundDate(r.date)}</span>
                        <span className="num" style={{ fontSize: '1rem', fontWeight: 700 }}>
                          {s.total}<span style={{ fontSize: '0.75em', opacity: 0.7 }}> ({diffText})</span>
                        </span>
                      </div>
                      {open && (
                        <div style={{
                          borderTop: `1px solid ${theme.scLine}`, padding: '10px 12px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'
                        }}>
                          <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
                            <div>ÚT {s.out} · INN {s.inn} · Samtals {s.total}</div>
                            {s.puttsTotal > 0 && <div>Pútt {s.puttsTotal}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flex: 'none' }}>
                            <button onClick={() => exportRound(r)} style={{
                              background: 'transparent', color: theme.scText, border: `1px solid ${theme.scLine}`,
                              borderRadius: theme.radius, padding: '6px 10px', fontWeight: 'bold', fontSize: '0.7rem',
                              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px'
                            }}>Sækja</button>
                            <button onClick={() => deleteRound(r.date)} style={{
                              background: 'transparent', color: '#d32f2f', border: '1px solid #d32f2f',
                              borderRadius: theme.radius, padding: '6px 10px', fontWeight: 'bold', fontSize: '0.7rem',
                              cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px'
                            }}>Eyða</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Export — AI prompt from the ticked rounds, or all data as JSON */}
            <div style={sectionHeadingStyle}>Sækja gögn</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)' }}>
              <button
                onClick={copyAIPrompt}
                style={{ ...actionBtnStyle, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box', opacity: selectedRounds.length ? 1 : 0.5 }}
              >Sækja AI prompt{selectedRounds.length ? ` (${selectedRounds.length})` : ''}</button>
              <button
                onClick={exportAllData}
                style={{ ...actionBtnStyle, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box' }}
              >Sækja alla hringi</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS SCREEN OVERLAY — sits above the scorecard */}
      {showSettings && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex: 10000, display: 'flex', flexDirection: 'column', color: theme.scText }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
            <div />
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' }}>Stillingar</h2>
            <div onClick={() => setShowSettings(false)} title="Loka" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
              <X size={24} />
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              <SettingRow label="Telja pútt" checked={trackPutts} onChange={setTrackPutts} theme={theme} />
              <SettingRow label="Telja leik" checked={trackGame} onChange={setTrackGame} theme={theme} />
              <SettingRow label="Telja skot" checked={trackScore} onChange={setTrackScore} theme={theme} />
              <SettingRow label="Dökkur hamur" checked={darkMode} onChange={setDarkMode} theme={theme} />
              <SettingRow label="Fleiri tölur" checked={!simpleView} onChange={(v) => setSimpleView(!v)} theme={theme} />
              <SettingRow label="Kaddí" checked={showClubRec} onChange={setShowClubRec} theme={theme} />
              <SettingRow label="Skrá gögn sjálfur" checked={statSheet} onChange={setStatSheetSafe} theme={theme} />
              <SettingRow label="Snjallskrá" checked={snjallskra} onChange={setSnjallskraSafe} theme={theme} />
              {/* Handicap is typed in — GolfBox is cross-origin, unreadable from here */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                padding: '13px 12px', border: `1px solid ${theme.scLine}`, borderRadius: theme.radius
              }}>
                <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Forgjöf</span>
                <input
                  type="text" inputMode="decimal" value={handicap}
                  onChange={(e) => setHandicap(e.target.value)} placeholder="t.d. 23,4"
                  style={{
                    width: '90px', padding: '8px', borderRadius: theme.radius, border: `1px solid ${theme.scLine}`,
                    background: 'transparent', color: theme.scText, fontSize: '1rem', textAlign: 'center',
                    boxSizing: 'border-box', outline: 'none', fontFamily: theme.sans
                  }}
                />
              </div>
            </div>

            {/* The bag lives behind settings; its overlay sits above this screen */}
            <button onClick={() => setShowBag(true)} style={{
              ...actionBtnStyle, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box',
              marginTop: '28px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
            }}>Opna pokann</button>
          </div>
        </div>
      )}

      {/* POST-HOLE STAT SHEET — slides up over the map; buttons only, all optional */}
      {sheetHole !== null && (
        <div onClick={skipSheet} style={{ position: 'absolute', inset: 0, zIndex: 20000, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          {/* Tapping the course (outside the box) closes the sheet, same as Loka */}
          <div onClick={(e) => e.stopPropagation()} style={{
            ...cardStyle, borderRadius: `${theme.radius} ${theme.radius} 0 0`,
            padding: '14px 16px calc(env(safe-area-inset-bottom, 12px) + 12px)',
            animation: 'sheetUp 0.22s ease-out'
          }}>
            <div style={{ ...microLabel, fontSize: '0.62rem', marginBottom: '12px' }}>
              Hola {courseData[sheetHole].hole} · Par {courseData[sheetHole].par}
            </div>
            {courseData[sheetHole].par > 3
              ? sheetGroup('Teighögg', 'tee', [
                  { v: 'left', l: '← Vinstri' }, { v: 'hit', l: 'Braut' }, { v: 'right', l: 'Hægri →' }, { v: 'whiff', l: '↓', t: 'Vindhögg' },
                ])
              : sheetGroup('Á flöt?', 'green', [
                  { v: 'short', l: 'Stutt' }, { v: 'left', l: 'Vinstri' }, { v: 'hit', l: 'Hitt' }, { v: 'right', l: 'Hægri' }, { v: 'long', l: 'Löng' },
                ])}
            {sheetGroup('Glompuhögg', 'bunker', [{ v: 0, l: '0' }, { v: 1, l: '1' }, { v: 2, l: '2+' }])}
            {sheetGroup('Víti', 'penalty', [{ v: 0, l: '0' }, { v: 1, l: '1' }, { v: 2, l: '2+' }])}
            {sheetGroup('Fyrsta pútt', 'firstPutt', [{ v: '<1', l: '<1m' }, { v: '1-3', l: '1–3m' }, { v: '3-10', l: '3–10m' }, { v: '10+', l: '10m+' }])}
            <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
              <div onClick={skipSheet} style={{ ...sheetOptStyle(false), padding: '12px 2px', fontSize: '0.8rem' }}>Loka</div>
              <div onClick={saveSheet} style={{ ...sheetOptStyle(true), padding: '12px 2px', fontSize: '0.8rem' }}>Vista</div>
            </div>
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