import React, { useState, useEffect, useRef } from 'react';
import { courseData } from './courseData';
import { greenData } from './greenData';
import { calculateDistanceInMeters, calculateBearing, getElevation } from './utils';
import { MapContainer, Marker, useMapEvents, Polyline, useMap, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import { divIcon } from 'leaflet';
import { Navigation, Flag, Crosshair } from 'lucide-react';
import html2canvas from 'html2canvas';

import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate'; 
import easterEggImg from './assets/easter-egg.png';

// --- DESIGN TOKENS ---
const theme = {
  darkGreen: '#0a4d2a',
  softWhite: 'rgba(255, 255, 255, 0.95)',
  frostedWhite: 'rgba(255, 255, 255, 0.85)',
  glassBorder: '1px solid rgba(9, 82, 40, 0.15)',
  shadow: '0 4px 12px rgba(0,0,0,0.15)',
  radius: '4px',
  // Redesign tokens
  ink: '#0a4d2a',
  card: 'rgba(251, 252, 249, 0.92)',
  hair: 'rgba(10, 77, 42, 0.16)',
  panelShadow: '0 2px 14px rgba(0,0,0,0.20)',
  sans: "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  num: "'Barlow Condensed', 'Barlow', 'Helvetica Neue', sans-serif",
};

// Reusable card material + smallcaps label for the redesigned HUD.
const cardStyle = {
  background: theme.card, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${theme.hair}`, boxShadow: theme.panelShadow, color: theme.ink,
};
const microLabel = {
  fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
  opacity: 0.5, fontFamily: theme.sans,
};

// --- MAP HELPER COMPONENTS ---
function MapCameraTracker({ startLoc, greenLoc, centerTrigger, currentHoleIndex, isTeeView }) {
  const map = useMap();
  
  useEffect(() => {
    const updateView = () => {
      if (!startLoc || !greenLoc) return;

      const mapSize = map.getSize();
      if (mapSize.y === 0) return;

      const centerRatio = 38 / 62;
      const centerLat = greenLoc.lat + (startLoc.lat - greenLoc.lat) * centerRatio;
      const centerLng = greenLoc.lng + (startLoc.lng - greenLoc.lng) * centerRatio;

      const pt1 = L.latLng(startLoc.lat, startLoc.lng);
      const pt2 = L.latLng(greenLoc.lat, greenLoc.lng);
      const distanceMeters = pt1.distanceTo(pt2);

      if (distanceMeters > 0) {
        const targetPixels = mapSize.y * 0.68;
        const metersPerPixel = distanceMeters / targetPixels;
        const initialResolution = 156543.03392;
        const latRad = centerLat * (Math.PI / 180);
        let targetZoom = Math.log2((initialResolution * Math.cos(latRad)) / metersPerPixel);
        if (targetZoom > 21) targetZoom = 21;
        if (targetZoom < 5) targetZoom = 5;
        map.setView([centerLat, centerLng], targetZoom, { animate: false });
      }
    };

    updateView();
    const timer = setTimeout(() => { map.invalidateSize(); updateView(); }, 500);
    map.on('resize', updateView);
    return () => { clearTimeout(timer); map.off('resize', updateView); };
  }, [map, centerTrigger, currentHoleIndex, isTeeView]);
  
  return null;
}

function MapRotationManager({ bearing, centerTrigger, currentHoleIndex, isTeeView }) {
  const map = useMap();
  useEffect(() => {
    if (typeof map.setBearing === 'function') map.setBearing(bearing);
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
const createGreenIcon = (distanceTargetToGreen) => divIcon({
  className: '',
  html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="background-color: ${theme.ink}; width: 22px; height: 22px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: white; border: 2px solid white; box-shadow: 0 1px 5px rgba(0,0,0,0.4);">⚑</div>
      ${distanceTargetToGreen !== null ? `<div style="position: absolute; left: 26px; background: ${theme.ink}; color: #fff; padding: 1px 6px; border-radius: 3px; font-family: ${theme.num}; font-size: 13px; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 5px rgba(0,0,0,0.45);">${distanceTargetToGreen}</div>` : ''}
    </div>`,
  iconSize: [22, 22], iconAnchor: [11, 11]
});

const userIcon = divIcon({
  className: '', 
  html: `<div style="background-color: #4A90E2; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9]
});

const createTargetIcon = (distance) => divIcon({
  className: '',
  html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="width: 16px; height: 16px; border: 3px solid white; border-radius: 50%; background: ${theme.darkGreen}; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>
      <div style="position: absolute; left: 24px; background: ${theme.softWhite}; color: ${theme.darkGreen}; padding: 4px 8px; border-radius: 4px; border: 1px solid ${theme.darkGreen}; font-size: 12px; font-weight: bold; white-space: nowrap; box-shadow: ${theme.shadow};">${distance !== null ? distance + 'm' : 'N/A'}</div>
    </div>`,
  iconSize: [20, 20], iconAnchor: [10, 10]
});

// Small distance label centred on a green edge point (front/back when aiming).
const createEdgeLabel = (distance) => divIcon({
  className: '',
  html: `<div style="display: inline-block; transform: translate(-50%, -50%); background: ${theme.ink}; color: #fff; padding: 1px 5px; border-radius: 3px; font-family: ${theme.num}; font-size: 11px; font-weight: 600; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">${distance}</div>`,
  iconSize: [0, 0], iconAnchor: [0, 0]
});

// --- FRONT/BACK OF GREEN ---
// Beyond this distance the green is too far to bother showing front/back.
const MAX_FB_DISTANCE = 300;
// Nearest (front) and farthest (back) green-edge point from `from`, plus their
// distances. Returns null if there's nothing to measure.
const frontBackFrom = (from, points) => {
  if (!from || !points || points.length === 0) return null;
  let frontPt = null, backPt = null, front = Infinity, back = -Infinity;
  for (const p of points) {
    const d = calculateDistanceInMeters(from.lat, from.lng, p.lat, p.lng);
    if (d < front) { front = d; frontPt = p; }
    if (d > back) { back = d; backPt = p; }
  }
  return { frontPt, backPt, front, back };
};

// --- SCORECARD HELPER COMPONENTS ---
const getScoreStyles = (score, par) => {
  if (!score || score === 0) return { shape: null, textColor: theme.darkGreen };
  const diff = score - par;
  if (diff <= -2) return { shape: 'double-circle', textColor: theme.darkGreen };
  if (diff === -1) return { shape: 'circle', textColor: theme.darkGreen };
  if (diff === 0) return { shape: null, textColor: theme.darkGreen };
  if (diff === 1) return { shape: 'square', textColor: theme.darkGreen };
  if (diff === 2) return { shape: 'double-square', textColor: theme.darkGreen };
  return { shape: 'red-square', textColor: '#fff' };
};

const renderScoreShape = (shape) => {
  const base = { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (shape === 'circle') return <div style={{ ...base, border: `1.5px solid ${theme.darkGreen}`, borderRadius: '50%' }} />;
  if (shape === 'double-circle') return (
    <div style={{ ...base, border: `1.5px solid ${theme.darkGreen}`, borderRadius: '50%', padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${theme.darkGreen}`, borderRadius: '50%' }} />
    </div>
  );
  if (shape === 'square') return <div style={{ ...base, border: `1.5px solid ${theme.darkGreen}` }} />;
  if (shape === 'double-square') return (
    <div style={{ ...base, border: `1.5px solid ${theme.darkGreen}`, padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${theme.darkGreen}` }} />
    </div>
  );
  if (shape === 'red-square') return <div style={{ ...base, backgroundColor: '#d32f2f' }} />;
  return null;
};

const ToggleBtn = ({ label, checked, onChange }) => (
  <div 
    onClick={() => onChange(!checked)} 
    style={{
      padding: '7px 11px', borderRadius: theme.radius, cursor: 'pointer', fontSize: '0.78rem',
      backgroundColor: checked ? theme.darkGreen : theme.softWhite,
      color: checked ? '#fff' : theme.darkGreen,
      border: `1px solid ${theme.darkGreen}`,
      fontWeight: 'bold',
      boxShadow: checked ? theme.shadow : 'none',
      transition: 'all 0.1s ease',
      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap'
    }}
  >
    {label}
  </div>
);

const MatchToggleBtn = ({ label, value, selected, onClick }) => (
  <div 
    onClick={() => onClick(value)}
    style={{
      padding: '6px 4px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', 
      borderRadius: theme.radius, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold',
      backgroundColor: selected ? theme.darkGreen : 'transparent',
      color: selected ? '#FFF' : theme.darkGreen,
      border: `1px solid ${theme.darkGreen}`,
      boxShadow: selected ? theme.shadow : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: 1, textAlign: 'center', boxSizing: 'border-box',
      transition: 'all 0.15s ease', textTransform: 'uppercase'
    }}
  >
    {label}
  </div>
);

// --- MAIN APP ---
export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(() => {
    const savedHole = localStorage.getItem('currentHoleIndex');
    return savedHole !== null ? parseInt(savedHole, 10) : 0;
  });
  
  const [scores, setScores] = useState(() => JSON.parse(localStorage.getItem('myScores')) || Array(18).fill(0));
  const [putts, setPutts] = useState(() => JSON.parse(localStorage.getItem('myPutts')) || Array(18).fill(0));
  const [matchPlay, setMatchPlay] = useState(() => JSON.parse(localStorage.getItem('myMatch')) || Array(18).fill(''));
  
  const [gbUser, setGbUser] = useState(() => localStorage.getItem('gbUser') || '');
  const [gbPass, setGbPass] = useState(() => localStorage.getItem('gbPass') || '');
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [trackScore, setTrackScore] = useState(() => {
    const saved = localStorage.getItem('trackScore');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [trackPutts, setTrackPutts] = useState(() => JSON.parse(localStorage.getItem('trackPutts')) || false);
  const [trackGame, setTrackGame] = useState(() => JSON.parse(localStorage.getItem('trackGame')) || false);

  // Simple view: map shows only the centre distance (no elevation, wind, F/B).
  const [simpleView, setSimpleView] = useState(() => JSON.parse(localStorage.getItem('simpleView')) || false);
  
  const [matchPlayResult, setMatchPlayResult] = useState('');
  const [hideEasterEgg, setHideEasterEgg] = useState(false);

  const [gpsLocation, setGpsLocation] = useState(null);
  const [gpsError, setGpsError] = useState(false); 
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);
  const [isExporting, setIsExporting] = useState(false); 
  
  const [centerTrigger, setCenterTrigger] = useState(0);
  const [hasAutoCentered, setHasAutoCentered] = useState(false);

  // --- ELEVATION STATE ---
  // elevationDiff: greenElevation - (tee or player) elevation
  // positive = uphill (green is higher), negative = downhill.
  // Sampled locally from the baked DEM (see utils.getElevation) — no network.
  const [elevationDiff, setElevationDiff] = useState(null);
  const gpsRef = useRef(null); // latest GPS pos, so the live timer reads fresh values

  // --- WIND STATE (Open-Meteo, free/keyless; the only feature needing network) ---
  // { speed: m/s, fromDeg: meteorological direction the wind blows FROM } or null.
  const [wind, setWind] = useState(null);

  const scorecardRef = useRef(null);
  const videoRef = useRef(null);
  const loginFormRef = useRef(null);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  // Keep a ref of the latest GPS position so the live-view timer below can
  // read fresh coordinates without re-running on every GPS tick.
  useEffect(() => { gpsRef.current = gpsLocation; }, [gpsLocation]);

  // --- TEE-VIEW ELEVATION ---
  // Tee and green are fixed, so the tee->green difference is instant and exact.
  useEffect(() => {
    if (!isTeeView) return;
    const tee = currentHole.teeLocation;
    const green = currentHole.greenLocation;
    const teeElev = getElevation(tee.lat, tee.lng);
    const greenElev = getElevation(green.lat, green.lng);
    setElevationDiff(teeElev !== null && greenElev !== null ? greenElev - teeElev : null);
  }, [isTeeView, currentHoleIndex]);

  // --- LIVE-VIEW ELEVATION ---
  // Player elevation is dynamic. Wait 2s for GPS to settle, then recompute
  // the player->green difference every 5s from the latest position.
  useEffect(() => {
    if (isTeeView) return;
    setElevationDiff(null); // clear stale value while GPS settles

    const compute = () => {
      const pos = gpsRef.current;
      if (!pos) return;
      const green = currentHole.greenLocation;
      const playerElev = getElevation(pos.lat, pos.lng);
      const greenElev = getElevation(green.lat, green.lng);
      if (playerElev !== null && greenElev !== null) setElevationDiff(greenElev - playerElev);
    };

    let interval;
    const settle = setTimeout(() => { compute(); interval = setInterval(compute, 5000); }, 2000);
    return () => { clearTimeout(settle); clearInterval(interval); };
  }, [isTeeView, currentHoleIndex]);

  // --- WIND FETCH ---
  // One request for the course (wind is ~uniform over 1.5km); refresh every 10 min.
  useEffect(() => {
    let cancelled = false;
    const fetchWind = async () => {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=64.1678&longitude=-21.7357&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms');
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.current) setWind({ speed: j.current.wind_speed_10m, fromDeg: j.current.wind_direction_10m });
      } catch { /* wind is non-critical; ignore failures (e.g. offline) */ }
    };
    fetchWind();
    const id = setInterval(fetchWind, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
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
  }, [currentHoleIndex, scores, putts, matchPlay, trackScore, trackPutts, trackGame, simpleView]);

  useEffect(() => {
    if (!trackGame) { setMatchPlayResult(''); return; }
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
    if (diff > 0) setMatchPlayResult(`Halli ${verb} með ${absDiff} ${strokeWord}`);
    else if (diff < 0) setMatchPlayResult(`Hinir ${verb} með ${absDiff} ${strokeWord}`);
    else setMatchPlayResult('Jafntefli');
  }, [matchPlay, trackGame]);

  useEffect(() => {
    if (isTeeView) return;
    setGpsError(false); 
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setGpsLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
          setGpsError(false);
        },
        (error) => {
          console.error("GPS Error:", error.message);
          setGpsError(true);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } 
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      setGpsError(true);
    }
  }, [isTeeView]);

  useEffect(() => { setHasAutoCentered(false); }, [currentHoleIndex, isTeeView]);

  useEffect(() => {
    if (!isTeeView && gpsLocation && !hasAutoCentered) {
      const timer = setTimeout(() => {
        setCenterTrigger(c => c + 1);
        setHasAutoCentered(true);
      }, 1000); 
      return () => clearTimeout(timer);
    }
  }, [gpsLocation, isTeeView, hasAutoCentered]);

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

  const saveScorecardImage = () => {
    setIsExporting(true); 
    setTimeout(() => { 
      if (scorecardRef.current) {
        html2canvas(scorecardRef.current, { backgroundColor: '#f8f9fa', scale: 2 }).then(canvas => {
          const link = document.createElement('a');
          const dateString = new Date().toISOString().split('T')[0];
          link.download = `Mosgolf_Skorkort_${dateString}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
          setIsExporting(false); 
        }).catch(() => setIsExporting(false));
      } else {
        setIsExporting(false);
      }
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

  const userLocation = isTeeView ? currentHole.teeLocation : gpsLocation;
  const activeLocation = userLocation || currentHole.teeLocation; 
  let distanceUserToGreen = null, distanceUserToTarget = null, distanceTargetToGreen = null, mapBearing = 0, initialBounds = null;

  if (userLocation) distanceUserToGreen = calculateDistanceInMeters(userLocation.lat, userLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  if (userLocation && targetPoint) distanceUserToTarget = calculateDistanceInMeters(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
  if (targetPoint) distanceTargetToGreen = calculateDistanceInMeters(targetPoint.lat, targetPoint.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  if (activeLocation) mapBearing = -calculateBearing(activeLocation.lat, activeLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);

  // Front/back of green. Computed from the player for the pill, and from the
  // aimed-at waypoint for the floating on-green labels. Hidden beyond 300m.
  const holePoints = greenData[currentHoleIndex] ? greenData[currentHoleIndex].points : null;
  const pillFB = (userLocation && distanceUserToGreen !== null && distanceUserToGreen <= MAX_FB_DISTANCE)
    ? frontBackFrom(userLocation, holePoints) : null;
  const targetFB = (targetPoint && distanceTargetToGreen !== null && distanceTargetToGreen <= MAX_FB_DISTANCE)
    ? frontBackFrom(targetPoint, holePoints) : null;

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

  // "Plays like" — the green distance adjusted for slope and the head/tail wind
  // component. Slope is 1:1 (uphill plays longer). Wind uses only the along-shot
  // component (crosswind cancels via cosine); a headwind hurts ~2x what a tailwind
  // helps, scaled by the shot length. Pressure is ignored — the raw distance is
  // already the Mosfellsbær baseline. Only shown within range (<=300m).
  let playsLike = null;
  if (distanceUserToGreen !== null && distanceUserToGreen <= MAX_FB_DISTANCE) {
    let adj = 0;
    if (elevationDiff !== null) adj += elevationDiff; // uphill (+) plays longer
    if (wind && windRelAngle !== null) {
      const tail = wind.speed * Math.cos(windRelAngle * Math.PI / 180); // + tailwind, - headwind
      adj += tail >= 0
        ? -distanceUserToGreen * tail * 0.0075   // tailwind shortens (~0.75%/m·s⁻¹)
        : -distanceUserToGreen * tail * 0.015;   // headwind lengthens (~1.5%/m·s⁻¹)
    }
    playsLike = Math.round(distanceUserToGreen + adj);
  }
  const showPlaysLike = !simpleView && playsLike !== null;

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
    borderBottom: `1px solid ${theme.darkGreen}`, borderRight: `1px solid ${theme.darkGreen}`, boxSizing: 'border-box', position: 'relative',
    color: theme.darkGreen
  };
  const summaryCellStyle = { ...cellStyle, fontWeight: 'bold', backgroundColor: 'rgba(9, 82, 40, 0.05)', color: theme.darkGreen };
  
  const getGridCols = () => {
    const cols = ['40px', '40px'];
    if (trackScore) cols.push('1fr');
    if (trackPutts) cols.push('1fr');
    if (trackGame) cols.push('75px');
    return cols.join(' ');
  };

  const topPillStyle = {
    position: 'absolute', top: 'max(env(safe-area-inset-top, 15px), 15px)', zIndex: 1000,
    ...cardStyle, padding: '0 14px', borderRadius: theme.radius,
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40px'
  };

  const stepperBtnStyle = {
    width: '40px', height: '40px', border: 'none', background: 'transparent',
    color: theme.darkGreen, fontSize: '2.5rem', fontWeight: '300', cursor: 'pointer', 
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
    const { shape, textColor } = getScoreStyles(scoreVal, holeData.par);
    return (
      <React.Fragment key={index}>
        <div 
          onClick={() => { setCurrentHoleIndex(index); setShowScorecard(false); }}
          style={{ ...cellStyle, fontWeight: 'bold', cursor: 'pointer', backgroundColor: '#eef3f0' }}
          title={`Fara á holu ${holeData.hole}`}
        >
          {holeData.hole}
        </div>
        <div style={{ ...cellStyle, fontWeight: 'normal' }}>{holeData.par}</div>
        
        {trackScore && (
          <div style={{ ...cellStyle }}>
            <div style={{ position: 'absolute', zIndex: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {renderScoreShape(shape)}
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
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.darkGreen, fontWeight: 'bold' }}>
                {putts[index] || ''}
              </div>
            ) : (
              <input 
                type="number" inputMode="numeric" className="no-spinners"
                value={putts[index] || ''} onChange={(e) => handlePuttsChange(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: theme.darkGreen, fontWeight: 'bold' }} 
              />
            )}
          </div>
        )}
        
        {trackGame && (
          <div style={{ ...cellStyle, padding: '0' }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.darkGreen, fontWeight: 'normal', fontSize: '0.9rem' }}>
                {matchPlay[index] === 'A' ? 'Halli' : matchPlay[index] === 'B' ? 'Hinir' : matchPlay[index] === 'H' ? 'Féll' : ''}
              </div>
            ) : (
              <select 
                value={matchPlay[index]} onChange={(e) => updateMatch(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: theme.darkGreen, appearance: 'none', textAlignLast: 'center', fontWeight: 'bold', fontSize: '0.95rem' }}
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

  const actionBtnStyle = {
    flex: 1, padding: '15px 5px', background: theme.softWhite, border: `2px solid ${theme.darkGreen}`, borderRadius: theme.radius, 
    fontWeight: 'bold', fontSize: '0.95rem', color: theme.darkGreen, cursor: 'pointer', 
    textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', boxShadow: theme.shadow
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
          <MapCameraTracker startLoc={activeLocation} greenLoc={currentHole.greenLocation} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} />
          <MapRotationManager bearing={mapBearing} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} />
          <MapEvents setTargetPoint={setTargetPoint} />

          <TileLayer
            url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&v=2"
            attribution="&copy; Google"
            maxZoom={22}
            maxNativeZoom={21}
            className="punchy-map-tiles"
          />

          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={createGreenIcon(targetPoint ? distanceTargetToGreen : null)} rotateWithView={false} />
          {/* Floating front/back labels on the green, measured from the aimed-at waypoint */}
          {!simpleView && targetFB && <Marker position={[targetFB.frontPt.lat, targetFB.frontPt.lng]} icon={createEdgeLabel(targetFB.front)} rotateWithView={false} />}
          {!simpleView && targetFB && <Marker position={[targetFB.backPt.lat, targetFB.backPt.lng]} icon={createEdgeLabel(targetFB.back)} rotateWithView={false} />}
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} rotateWithView={false} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={createTargetIcon(distanceUserToTarget)} rotateWithView={false} />}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [targetPoint.lat, targetPoint.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {targetPoint && <Polyline positions={[[targetPoint.lat, targetPoint.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
        </MapContainer>
      </div>

      {/* FLOATING TOP BAR - LEFT PILL */}
      <div style={{ ...topPillStyle, left: '15px', gap: '9px' }}>
        <span style={{ ...microLabel }}>Hola</span>
        <span className="num" style={{ fontSize: '1.45rem', fontWeight: 700, lineHeight: 1 }}>{currentHole.hole}</span>
        <span style={{ width: '1px', height: '18px', background: theme.hair }} />
        <span style={{ ...microLabel }}>Par</span>
        <span className="num" style={{ fontSize: '1.45rem', fontWeight: 700, lineHeight: 1 }}>{currentHole.par}</span>
      </div>

      {/* FLOATING TOP BAR - RIGHT PILL */}
      <button onClick={() => setShowScorecard(true)} style={{ ...topPillStyle, right: '15px', cursor: 'pointer' }}>
        <span style={{ ...microLabel, fontSize: '0.62rem', opacity: 0.85 }}>Skorkort</span>
      </button>

      {/* FLOATING TOOLS LEFT */}
      <div style={{ position: 'absolute', top: 'calc(max(env(safe-area-inset-top, 15px), 15px) + 60px)', left: '15px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1000 }}>
        <div onClick={() => setIsTeeView(!isTeeView)} style={{ ...cardStyle, color: theme.ink, padding: '11px', borderRadius: theme.radius, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
        </div>
        {!isTeeView && (
          <div onClick={() => setCenterTrigger(c => c + 1)} style={{ ...cardStyle, color: theme.ink, padding: '11px', borderRadius: theme.radius, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Crosshair size={20} />
          </div>
        )}
      </div>

      {/* WIND — top-centre compass (complex view) */}
      {showWind && (
        <div style={{
          position: 'absolute', top: 'max(env(safe-area-inset-top, 15px), 15px)', left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, ...cardStyle, borderRadius: '999px', height: '40px', padding: '0 13px 0 8px',
          display: 'flex', alignItems: 'center', gap: '7px', pointerEvents: 'none'
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '24px', height: '24px', borderRadius: '50%', border: `1.5px solid ${theme.ink}`
          }}>
            <span style={{ display: 'inline-block', transform: `rotate(${windRelAngle}deg)`, fontSize: '1rem', lineHeight: 1 }}>↑</span>
          </span>
          <span className="num" style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1 }}>{Math.round(wind.speed)}</span>
          <span style={{ ...microLabel, fontSize: '0.46rem' }}>m/s</span>
        </div>
      )}

      {/* PRIMARY READOUT — right edge, vertically centred */}
      <div style={{
        position: 'absolute', top: '50%', right: '15px', transform: 'translateY(-50%)', zIndex: 1000, pointerEvents: 'none'
      }}>
        <div style={{
          ...cardStyle, borderRadius: theme.radius, padding: '11px 16px', minWidth: '78px',
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          {/* Back of green */}
          {!simpleView && pillFB && (
            <span className="num" style={{ fontSize: '1.05rem', fontWeight: 600, opacity: 0.5, lineHeight: 1 }}>{pillFB.back}</span>
          )}
          {/* Centre distance — hero */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px' }}>
            <span className="num" style={{ fontSize: distanceUserToGreen !== null ? '2.7rem' : '1.05rem', fontWeight: 700, lineHeight: 0.85 }}>
              {distanceUserToGreen !== null ? distanceUserToGreen : gpsError ? 'Engin GPS' : 'Leitar...'}
            </span>
            {distanceUserToGreen !== null && <span style={{ ...microLabel, fontSize: '0.52rem' }}>m</span>}
          </div>
          {/* Front of green */}
          {!simpleView && pillFB && (
            <span className="num" style={{ fontSize: '1.05rem', fontWeight: 600, opacity: 0.5, lineHeight: 1, marginTop: '1px' }}>{pillFB.front}</span>
          )}
          {/* Slope */}
          {showElev && (
            <span className="num" style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1, marginTop: '4px', opacity: 0.85 }}>
              {elevRounded > 0 ? '▲' : elevRounded < 0 ? '▼' : '–'} {Math.abs(elevRounded)}<span style={{ ...microLabel, fontSize: '0.42rem' }}>m</span>
            </span>
          )}
          {/* Plays-like */}
          {showPlaysLike && (
            <>
              <span style={{ width: '72%', height: '1px', background: theme.hair, margin: '8px 0 4px' }} />
              <span style={{ ...microLabel, fontSize: '0.46rem' }}>Spilast</span>
              <span className="num" style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 0.95 }}>{playsLike}</span>
            </>
          )}
        </div>
      </div>

      {/* MAP CONTROLS - PREV / NEXT */}
      <div style={{ position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', left: '15px', zIndex: 1000, transition: 'bottom 0.3s ease' }}>
        <button onClick={() => setCurrentHoleIndex(Math.max(0, currentHoleIndex - 1))} style={{ ...cardStyle, color: theme.ink, padding: '11px 18px', borderRadius: theme.radius, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Fyrri
        </button>
      </div>
      <div style={{ position: 'absolute', bottom: showFooter ? 'calc(env(safe-area-inset-bottom, 15px) + 140px)' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', right: '15px', zIndex: 1000, transition: 'bottom 0.3s ease' }}>
        <button onClick={() => setCurrentHoleIndex(Math.min(17, currentHoleIndex + 1))} style={{ ...cardStyle, color: theme.ink, padding: '11px 18px', borderRadius: theme.radius, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.16em' }}>
          Næsta
        </button>
      </div>

      {/* UNIFIED SCORING & LEIKUR FOOTER */}
      {showFooter && (
        <div style={{ 
          position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 15px) + 15px)', left: '50%', transform: 'translateX(-50%)', 
          zIndex: 1000, width: '92%', maxWidth: '380px', display: 'flex', flexDirection: 'column',
          background: theme.frostedWhite, backdropFilter: 'blur(10px)', borderRadius: theme.radius, 
          boxShadow: theme.shadow, border: theme.glassBorder, overflow: 'hidden'
        }}>
          {(trackScore || trackPutts) && (
            <div style={{ display: 'flex', flexDirection: 'row', width: '100%', backgroundColor: 'rgba(255,255,255,0.2)' }}>
              {trackScore && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
                  <button onClick={() => adjustScore(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: '900', color: theme.darkGreen, lineHeight: '1' }}>
                      {scores[currentHoleIndex] || 0}
                    </span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 'bold', textTransform: 'uppercase', color: theme.darkGreen, letterSpacing: '1px', marginTop: '2px' }}>Högg</span>
                  </div>
                  <button onClick={() => adjustScore(1)} style={stepperBtnStyle}>+</button>
                </div>
              )}
              {trackPutts && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderLeft: trackScore ? theme.glassBorder : 'none' }}>
                  <button onClick={() => adjustPutts(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.4rem', fontWeight: '900', color: theme.darkGreen, lineHeight: '1' }}>
                      {putts[currentHoleIndex] || 0}
                    </span>
                    <span style={{ fontSize: '0.6rem', fontWeight: 'bold', textTransform: 'uppercase', color: theme.darkGreen, letterSpacing: '1px', marginTop: '2px' }}>Pútt</span>
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
              borderTop: (trackScore || trackPutts) ? theme.glassBorder : 'none', 
              backgroundColor: 'rgba(255,255,255,0.4)', boxSizing: 'border-box'
            }}>
              <MatchToggleBtn label="Halli" value="A" selected={matchPlay[currentHoleIndex] === 'A'} onClick={toggleMatchPlay} />
              <MatchToggleBtn label="Hinir" value="B" selected={matchPlay[currentHoleIndex] === 'B'} onClick={toggleMatchPlay} />
              <MatchToggleBtn label="Féll" value="H" selected={matchPlay[currentHoleIndex] === 'H'} onClick={toggleMatchPlay} />
            </div>
          )}
        </div>
      )}

      {/* SCORECARD OVERLAY */}
      {showScorecard && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: '#f5f8f5', zIndex: 9999, display: 'flex', flexDirection: 'column', color: theme.darkGreen }}>
          <div style={{ padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900' }}>Skorkort</h2>
            <button onClick={() => setShowScorecard(false)} style={{ background: 'transparent', color: 'white', padding: '8px 16px', border: '1px solid white', borderRadius: theme.radius, cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px' }}>Loka</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '25px' }}>
              <ToggleBtn label="Skor" checked={trackScore} onChange={setTrackScore} />
              <ToggleBtn label="Pútt" checked={trackPutts} onChange={setTrackPutts} />
              <ToggleBtn label="Leikur" checked={trackGame} onChange={setTrackGame} />
              <ToggleBtn label="Einfalt" checked={simpleView} onChange={setSimpleView} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <div ref={scorecardRef} style={{ background: '#fff', borderRadius: '0', border: `2px solid ${theme.darkGreen}`, overflow: 'hidden', marginBottom: '25px', width: '100%', boxShadow: theme.shadow }}>
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.8rem', backgroundColor: '#eef3f0', borderBottom: `2px solid ${theme.darkGreen}`, color: theme.darkGreen }}>
                  <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>H</strong>
                  <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>P</strong>
                  {trackScore && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>SKOR</strong>}
                  {trackPutts && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>PÚTT</strong>}
                  {trackGame && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>LEIKUR</strong>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '1.1rem', backgroundColor: '#fff', color: theme.darkGreen }}>
                  {courseData.slice(0, 9).map((hole, i) => renderRow(hole, i))}
                  <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.darkGreen}` }}>ÚT</div>
                  <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.darkGreen}` }}>{courseData.slice(0, 9).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.darkGreen}` }}>{calculateTotal(scores, 0, 9)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.darkGreen}` }}>{calculateTotal(putts, 0, 9)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.darkGreen}` }}></div>}
                  {courseData.slice(9, 18).map((hole, i) => renderRow(hole, i + 9))}
                  <div style={{ ...summaryCellStyle }}>INN</div>
                  <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>}
                  {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle }}></div>}
                  <div style={{ ...summaryCellStyle, backgroundColor: '#dff0e4', borderBottom: 'none' }}>TOT</div>
                  <div style={{ ...summaryCellStyle, backgroundColor: '#dff0e4', borderBottom: 'none' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, backgroundColor: '#dff0e4', borderBottom: 'none' }}>{calculateTotal(scores, 0, 18)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: '#dff0e4', borderBottom: 'none' }}>{calculateTotal(putts, 0, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: '#dff0e4', borderBottom: 'none' }}></div>}
                </div>
              </div>
            </div>

            {trackGame && matchPlayResult && (
              <div style={{ padding: '20px', background: 'transparent', border: `2px solid ${theme.darkGreen}`, borderRadius: theme.radius, marginBottom: '25px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: theme.darkGreen }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: theme.darkGreen, textTransform: 'uppercase', letterSpacing: '1px' }}>Niðurstaða leiks</h3>
                {matchPlayResult}
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%', marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
                <button onClick={saveScorecardImage} style={actionBtnStyle}>Vista mynd</button>
                <button onClick={startPiP} style={{ ...actionBtnStyle, color: '#4A90E2', borderColor: '#4A90E2' }}>Opna í PiP</button>
              </div>
              <button onClick={openGolfBox} style={{ ...actionBtnStyle, background: theme.darkGreen, color: '#fff', borderColor: theme.darkGreen, width: '100%', flex: 'none' }}>
                Skrá skor í GolfBox
              </button>
            </div>

            <button onClick={clearRound} style={clearBtnStyle}>Þurrka út skorkort</button>
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