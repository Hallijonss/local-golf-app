// All stateless logic: geometry, storage loaders, golf models, export helpers.
// Nothing in here touches React state — every function takes plain inputs.
import { elevationData } from './elevationData';
import { featureData } from './featureData';
import { courseData, courseMeta } from './courseData';

// Sample elevation (meters) at a lat/lng via bilinear interpolation over the
// baked DEM grid. No network — reads only the bundled elevationData.
// Points outside the course bounding box are clamped to the nearest edge.
// Returns a number (meters), or null if the grid is somehow unavailable.
export function getElevation(lat, lng) {
  const { latMin, latMax, lngMin, lngMax, nLat, nLng, grid } = elevationData;
  if (!grid || !grid.length) return null;

  // Fractional grid coordinates (row = lat, col = lng), clamped to [0, n-1].
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fy = clamp(((lat - latMin) / (latMax - latMin)) * (nLat - 1), 0, nLat - 1);
  const fx = clamp(((lng - lngMin) / (lngMax - lngMin)) * (nLng - 1), 0, nLng - 1);

  const i0 = Math.floor(fy), j0 = Math.floor(fx);
  const i1 = Math.min(i0 + 1, nLat - 1), j1 = Math.min(j0 + 1, nLng - 1);
  const dy = fy - i0, dx = fx - j0;

  // Bilinear blend of the four surrounding grid cells.
  const top = grid[i0][j0] * (1 - dx) + grid[i0][j1] * dx;
  const bot = grid[i1][j0] * (1 - dx) + grid[i1][j1] * dx;
  return top * (1 - dy) + bot * dy;
}

export function calculateDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance);
}

// Calculate the compass bearing between two coordinates
export const calculateBearing = (startLat, startLng, destLat, destLng) => {
  const toRad = (degree) => degree * (Math.PI / 180);
  const toDeg = (radian) => radian * (180 / Math.PI);

  const startLatRad = toRad(startLat);
  const destLatRad = toRad(destLat);
  const deltaLngRad = toRad(destLng - startLng);

  const y = Math.sin(deltaLngRad) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
            Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(deltaLngRad);

  let bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360; // Normalize to 0-360 degrees
};

// Move a lat/lng `dist` metres along a compass `bearingDeg` (geodesic).
export const offsetLatLng = (lat, lng, bearingDeg, dist) => {
  const R = 6378137;
  const d = dist / R, t = bearingDeg * Math.PI / 180;
  const p1 = lat * Math.PI / 180, l1 = lng * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * 180 / Math.PI, lng: l2 * 180 / Math.PI };
};

// Ray-cast point-in-polygon over a { lat, lng } ring.
export const pointInPolygon = (lat, lng, poly) => {
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
export const surfaceAt = (lat, lng) => {
  for (const b of featureData.bunkers) if (pointInPolygon(lat, lng, b)) return 'bunker';
  for (const f of featureData.fairways) if (pointInPolygon(lat, lng, f)) return 'fairway';
  return null;
};

// Signed sideways offset (metres) of point M from the line A→B as seen from A:
// negative = left of the line, positive = right.
export const lateralOffset = (A, B, M) => {
  const mx = 111320 * Math.cos(A.lat * Math.PI / 180), my = 110540;
  const bx = (B.lng - A.lng) * mx, by = (B.lat - A.lat) * my;
  const px = (M.lng - A.lng) * mx, py = (M.lat - A.lat) * my;
  const len = Math.hypot(bx, by) || 1;
  // 2D cross product: positive when M lies left of A→B (x east, y north) — flip.
  return Math.round(-(bx * py - by * px) / len);
};

// --- FRONT/BACK OF GREEN ---
// Beyond this distance the green is too far to bother showing front/back.
export const MAX_FB_DISTANCE = 300;
// Where the play line (from `from` through `green`) crosses the green polygon:
// front = nearest crossing, back = farthest. Returns the crossing points (lat/lng)
// and the unrounded distances from `from`. Falls back to nearest/farthest polygon
// vertex when the ray gives fewer than two crossings (e.g. measured from inside).
export const frontBackOnLine = (from, green, polygon) => {
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

// --- SCORECARD HELPERS ---
// Golf score shapes: circles under par, squares over, red fill for the bad days.
export const getScoreStyles = (score, par, col) => {
  if (!score || score === 0) return { shape: null, textColor: col };
  const diff = score - par;
  if (diff <= -2) return { shape: 'double-circle', textColor: col };
  if (diff === -1) return { shape: 'circle', textColor: col };
  if (diff === 0) return { shape: null, textColor: col };
  if (diff === 1) return { shape: 'square', textColor: col };
  if (diff === 2) return { shape: 'double-square', textColor: col };
  return { shape: 'red-square', textColor: '#fff' };
};

export const calculateTotal = (arr, start, end) => arr.slice(start, end).reduce((a, b) => a + b, 0);

// Match status over a hole range for the LEIKUR summary cells (ÚT/INN/TOT):
// "Halli +n" / "Hinir +n" / "Jafnt", or '' while nothing is logged in the range.
export const matchSummary = (matchPlay, start, end) => {
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

// --- STORAGE LOADERS ---
// Safe localStorage read: parses JSON, returns fallback on missing/invalid.
export const loadJSON = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
// A valid 18-length round array, else the given empty round.
export const loadRound = (key, fill) => {
  const v = loadJSON(key, null);
  return (Array.isArray(v) && v.length === 18) ? v : Array(18).fill(fill);
};

// --- SAVED ROUNDS ('myRounds') ---
// ONE round-object schema (schemaVersion 1) — every feature reads/writes this:
// {
//   schemaVersion: 1,
//   date: ISO string (set at save time),
//   course: 'Mosgolf',
//   weather: { speed, fromDeg, gust, tempC } | null,   // wind snapshot at save time
//   holes: [ 18 × {
//     hole: 1..18, par,                                 // from courseData
//     score, putts,                                     // numbers, 0 = not entered
//     match: '' | 'A' | 'B' | 'H',
//     sheet: null | 'skipped' | {                       // post-hole stat sheet
//       tee: 'left'|'hit'|'right'|'whiff'|null,         //   par 4/5 tee shot
//       green: 'short'|'left'|'hit'|'right'|'long'|null,//   par 3 "Á flöt?"
//       bunker: 0|1|2|null, penalty: 0|1|2|null,        //   2 means "2+"
//       firstPutt: '<1'|'1-3'|'3-10'|'10+'|null },      //   metres
//     marks: [ { lat, lng, accuracy, t,                 // Snjallskrá raw GPS marks
//                manual?: true,                         //   placed by hand on the map
//                drop?: true } ],                       //   relief point after a penalty
//     shots: [ 'string per stroke' ],                   // derived at save time
//       — '<len>m[, fairway|bunker], <offset>, <toGreen>m to green' per marked shot,
//         a drop mark yields 'in penalty area / unplayable' + 'relief, ...',
//         'no info' for unmarked strokes, 'putt' × putts. Nothing is guessed.
//   } ],
// }
// Stored newest-first in the localStorage key 'myRounds' (live round keys
// myScores/myPutts/myMatch stay untouched), capped at MAX_ROUNDS.
export const ROUNDS_KEY = 'myRounds';
export const MAX_ROUNDS = 50;
export const loadRounds = () => {
  const v = loadJSON(ROUNDS_KEY, null);
  if (!Array.isArray(v)) return [];
  return v
    .filter((r) => r && typeof r === 'object' && typeof r.date === 'string' && Array.isArray(r.holes) && r.holes.length === 18)
    .slice(0, MAX_ROUNDS);
};
// Working stat sheets for the live round (key 'mySheets'): 18 × the round
// schema's hole.sheet value (null | 'skipped' | object). Survives app restarts
// mid-round like the live scores do.
export const loadSheets = () => {
  const v = loadJSON('mySheets', null);
  return (Array.isArray(v) && v.length === 18) ? v : Array(18).fill(null);
};
// Working shot marks for the live round (key 'myMarks'): 18 × arrays of
// { lat, lng, accuracy, t }. Survives reloads like the live scores do.
export const loadMarks = () => {
  const v = loadJSON('myMarks', null);
  if (!Array.isArray(v) || v.length !== 18) return Array(18).fill().map(() => []);
  return v.map((m) => Array.isArray(m)
    ? m.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : []);
};

// --- BAG / CLUB RECOMMENDATION ---
// max = full-swing carry in metres.
export const DEFAULT_BAG = [
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
export const freshBag = () => DEFAULT_BAG.map((c) => ({ ...c, enabled: true }));
export const loadBag = () => {
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
export const recommendClub = (target, bag, { frontDist = null, onTee = true } = {}) => {
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
export const playsLikeFor = (distM, elevDiff, w, relAngleDeg) => {
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

// --- DERIVED SHOT STRINGS ---
// One readable string per stroke, in order: marked shots (length, surface from
// the traced polygons, sideways miss vs the intended line, distance to green
// centre), then unmarked strokes as 'no info', then recorded putts. The tee
// shot is measured against the hole's ideal driving line (aim point) when one
// exists; every other shot against the straight line to the green. Nothing is
// guessed (see EXPORT_README).
export const deriveShots = (i, marks, scores, putts) => {
  const green = courseData[i].greenLocation;
  const aim = featureData.aims[i];
  const shots = [];
  let prev = courseData[i].teeLocation;
  (marks[i] || []).forEach((m, k) => {
    const len = calculateDistanceInMeters(prev.lat, prev.lng, m.lat, m.lng);
    const toGreen = calculateDistanceInMeters(m.lat, m.lng, green.lat, green.lng);
    const surf = surfaceAt(m.lat, m.lng);
    const off = lateralOffset(prev, (k === 0 && aim) ? aim : green, m);
    const offTxt = Math.abs(off) < 3 ? 'on line' : `${Math.abs(off)}m ${off < 0 ? 'left' : 'right'} of line`;
    if (m.drop) {
      // Two strokes: the swing that found trouble (resting spot unknown),
      // then the penalty stroke, located at the relief point.
      shots.push('in penalty area / unplayable');
      shots.push(`relief, ${len}m${surf ? `, ${surf}` : ''}, ${offTxt}, ${toGreen}m to green`);
    } else {
      shots.push(`${len}m${surf ? `, ${surf}` : ''}, ${offTxt}, ${toGreen}m to green`);
    }
    prev = m;
  });
  const score = scores[i] || 0, p = putts[i] || 0;
  if (score > 0) {
    const unknown = Math.max(0, score - shots.length - p);
    for (let k = 0; k < unknown; k++) shots.push('no info');
    for (let k = 0; k < Math.min(p, score); k++) shots.push('putt');
  }
  return shots;
};

// --- COMPLETENESS CHECKS (the ✓ in the PÚTT column) ---
// Every applicable sheet question answered? (tee on par 4/5, green on par 3.)
export const isSheetComplete = (sheet, par) => !!sheet && typeof sheet === 'object' &&
  (par > 3 ? sheet.tee != null : sheet.green != null) &&
  sheet.bunker != null && sheet.penalty != null && sheet.firstPutt != null;

// Snjallskrá completeness: every non-putt stroke accounted for. A drop mark
// stands for two strokes (the swing into trouble + the penalty stroke).
export const allShotsMarked = (score, putts, mks) => {
  const strokes = (mks || []).reduce((t, m) => t + (m && m.drop ? 2 : 1), 0);
  return score > 0 && score - putts > 0 && strokes === score - putts;
};

// Out/in/total strokes, par diff over the holes actually played, total putts.
export const summarizeRound = (r) => {
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
export const fmtRoundDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};

// --- EXPORT ---
// English schema notes embedded in every export so the file is self-describing
// (an AI analyzing it needs no other context).
export const EXPORT_README =
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
  'marks = raw GPS points ({lat, lng, accuracy in metres, t = unix ms}) recorded by the player pressing a button right where each shot was played; ' +
  'a mark with manual: true (accuracy null) was placed by hand on the map afterwards (hazard, forgotten shot) — position is approximate, t is entry time, not shot time; ' +
  'a mark with drop: true is the relief point after a penalty — the swing before it went into a penalty area or was unplayable, and the mark accounts for two strokes (swing + penalty). ' +
  'shots = the same data made readable, one string per stroke in order: "<length>m[, fairway|bunker], <offset>, <distance>m to green" for a GPS-marked shot, ' +
  '"in penalty area / unplayable" followed by "relief, ..." for a penalty (the relief string carries the drop position data), ' +
  '"no info" for strokes the player did not mark, and "putt" for each recorded putt. Surface comes from traced course polygons (absent = unknown lie). ' +
  "<offset> is the sideways miss versus the intended line — tee shots are measured against the hole's ideal safe driving line (so dogleg holes are judged fairly), " +
  'later shots against the straight line to the green; "on line" means within 3 m. Nothing is derived beyond that — missing data stays missing.';

// Download an object as pretty-printed JSON via a temporary Blob link (no deps).
export const downloadJSON = (obj, filename) => {
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
export const MIN_EXPORT_HOLES = 6;

// Copy plain text to the clipboard, with a fallback for older WebViews.
export const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
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

// --- AI COACHING PROMPT ---
// Plaintext prompt: coaching framing + course facts + the selected rounds JSON.
export const buildAIPrompt = (sel, handicap) => {
  const hcp = parseFloat(String(handicap).replace(',', '.'));
  const hasHcp = Number.isFinite(hcp);
  // WHS course handicap: index × slope/113 + (CR − par).
  const courseHcp = hasHcp ? Math.round(hcp * courseMeta.slope / 113 + (courseMeta.cr - courseMeta.par)) : null;
  const ranks = courseData.map((h) => `${h.hole}:${h.rank}`).join(' ');
  // Hole shapes from the baked aim points: dogleg direction + severity.
  const shapes = courseData.map((h, i) => {
    const a = featureData.aims[i];
    if (!a) return `${h.hole}:straight (par 3)`;
    const mag = Math.abs(a.dogleg);
    const lbl = mag < 10 ? 'straight' : `${mag >= 30 ? 'hard' : 'slight'} ${a.dogleg > 0 ? 'right' : 'left'} (${mag}°)`;
    return `${h.hole}:${lbl}`;
  }).join(', ');
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
    `Stroke index by hole: ${ranks}\n` +
    `Hole shapes (dogleg from the ideal driving line): ${shapes}\n\n` +
    `DATA FORMAT: ${EXPORT_README}\n\n` +
    `ROUNDS (JSON):\n${JSON.stringify(sel, null, 1)}`
  );
};
