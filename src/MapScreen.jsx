// The live map view: rotating satellite map, camera framing, HUD pills/rail,
// Snjallskrá buttons + trail, the scoring footer and the post-hole stat sheet.
// All persistent state lives in App.jsx; purely map-internal mechanics
// (camera trigger, auto-frame bookkeeping, measured UI insets) live here.
import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, Marker, useMapEvents, Polyline, Polygon, Circle, useMap, TileLayer } from 'react-leaflet';
import { Navigation, Flag, Crosshair, ClipboardList } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';

import { courseData } from './courseData';
import { greenData } from './greenData';
import { microLabel, cardStyleFor } from './theme';
import { greenIcon, userIcon, targetIcon, createChip, markDotIcon, dropMarkIcon } from './icons';
import {
  calculateDistanceInMeters, calculateBearing, getElevation, offsetLatLng,
  frontBackOnLine, MAX_FB_DISTANCE, playsLikeFor, recommendClub,
} from './utils';

// Draws the traced green polygons so trace accuracy can be checked on the phone.
// Verification only — flip to false for the final product. The polygon DATA is
// still used for front/back calculations regardless of this flag.
const SHOW_GREEN_OUTLINES = false;

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

export default function MapScreen({
  theme, currentHoleIndex, setCurrentHoleIndex, isTeeView, setIsTeeView,
  gpsLocation, gpsError, targetPoint, setTargetPoint, wind, simpleView,
  bag, showClubRec, snjallskra, statSheet, marks,
  canMark, markFlash, vitiFlash, lastShotLen,
  markClick, markPressStart, markPressEnd, addMark,
  openSheet, sheetHole, sheetDraft, setSheetField, saveSheet, skipSheet,
  scores, putts, matchPlay, adjustScore, adjustPutts, toggleMatchPlay,
  trackScore, trackPutts, trackGame, onOpenScorecard,
}) {
  const cardStyle = useMemo(() => cardStyleFor(theme), [theme]);
  const currentHole = courseData[currentHoleIndex] || courseData[0];

  // Map-internal mechanics: recenter trigger, auto-frame bookkeeping, insets.
  const [centerTrigger, setCenterTrigger] = useState(0);
  // Auto-frame bookkeeping — refs (not state) so GPS ticks don't re-render or reset timers.
  const autoCenter = useRef({ done: false, firstFixAt: 0, timer: null });

  // Cached club recommendation (anti-flicker; see below).
  const recRef = useRef({ target: null, rec: null, bag: null, onTee: null });

  // Measured UI insets (px) so the camera frames exactly above/below the chrome.
  const topPillRef = useRef(null);
  const footerRef = useRef(null);
  const navRef = useRef(null);
  const [insets, setInsets] = useState({ top: 64, bottom: 56 });

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
  // Snjallskrá trail: one faint length chip per segment, memoised so marker DOM
  // only churns when the marks change. Tiny segments (< 8 m) skip the label.
  const trailChips = useMemo(() => {
    if (!snjallskra) return [];
    let prev = currentHole.teeLocation;
    const chips = [];
    for (const m of marks[currentHoleIndex] || []) {
      const len = calculateDistanceInMeters(prev.lat, prev.lng, m.lat, m.lng);
      if (len >= 8) chips.push({ key: m.t, pos: [(prev.lat + m.lat) / 2, (prev.lng + m.lng) / 2], icon: createChip(len, 12, true) });
      prev = m;
    }
    return chips;
  }, [snjallskra, marks, currentHoleIndex, currentHole]);

  if (activeLocation && currentHole.greenLocation) {
    initialBounds = [
      [activeLocation.lat, activeLocation.lng],
      [currentHole.greenLocation.lat, currentHole.greenLocation.lng]
    ];
  }

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

  return (
    <>
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
          {/* Snjallskrá: faint dashed tee → shot → shot trail, a dot per recorded
              shot (triangle = relief/drop), faint length labels on the segments */}
          {snjallskra && (marks[currentHoleIndex] || []).length > 0 && (
            <>
              <Polyline
                positions={[[currentHole.teeLocation.lat, currentHole.teeLocation.lng], ...marks[currentHoleIndex].map((m) => [m.lat, m.lng])]}
                pathOptions={{ color: 'white', weight: 2, opacity: 0.6, dashArray: '4 6' }}
              />
              {marks[currentHoleIndex].map((m) => (
                <Marker key={m.t} position={[m.lat, m.lng]} icon={m.drop ? dropMarkIcon : markDotIcon} rotateWithView={false} />
              ))}
              {trailChips.map((c) => (
                <Marker key={'c' + c.key} position={c.pos} icon={c.icon} rotateWithView={false} />
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
      <button onClick={onOpenScorecard} style={{ ...topPillStyle, right: '15px', width: '104px', cursor: 'pointer' }}>
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
        {/* VÍTI — record the relief point after a penalty (same grey rules) */}
        {snjallskra && (
          <div
            onClick={() => addMark(true)}
            title="Víti — skrá vítastað"
            style={{
              ...cardStyle, padding: '11px 8px', borderRadius: theme.radius,
              display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
              cursor: canMark ? 'pointer' : 'default', opacity: canMark ? 1 : 0.45,
              background: vitiFlash ? theme.accent : theme.panel, transition: 'background 0.15s ease',
              fontWeight: 700, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em',
              userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation'
            }}
          >
            Víti
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

      {/* SHOT LENGTH TOAST — the shot just recorded, centered between Fyrri/Næsta */}
      {lastShotLen !== null && (
        <div style={{
          position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)',
          left: '50%', transform: 'translateX(-50%)', zIndex: 1000, pointerEvents: 'none',
          ...cardStyle, borderRadius: theme.radius, padding: '9px 16px',
          display: 'flex', alignItems: 'baseline', gap: '5px', animation: 'sheetUp 0.18s ease-out'
        }}>
          <span className="num" style={{ fontSize: '1.7rem', fontWeight: 700, lineHeight: 0.9 }}>{lastShotLen}</span>
          <span style={{ ...microLabel, fontSize: '0.55rem' }}>m högg</span>
        </div>
      )}

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
                  <button onClick={() => adjustScore(-1)} style={stepperBtnStyle}>{"−"}</button>
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
                  <button onClick={() => adjustPutts(-1)} style={stepperBtnStyle}>{"−"}</button>
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
    </>
  );
}
