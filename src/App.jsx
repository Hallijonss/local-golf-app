import React, { useState, useEffect, useRef } from 'react';
import { courseData } from './courseData';
import { calculateDistanceInMeters, calculateBearing } from './utils';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { Navigation, Flag, Crosshair } from 'lucide-react';
import html2canvas from 'html2canvas';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate'; 
import easterEggImg from './assets/easter-egg.png';

// --- MAP HELPER COMPONENTS ---
function MapCameraTracker({ startLoc, greenLoc, centerTrigger, currentHoleIndex, isTeeView }) {
  const map = useMap();
  useEffect(() => {
    if (startLoc && greenLoc) {
      const centerLat = (startLoc.lat + greenLoc.lat) / 2;
      const centerLng = (startLoc.lng + greenLoc.lng) / 2;
      const latDiff = Math.abs(startLoc.lat - greenLoc.lat);
      const lngDiff = Math.abs(startLoc.lng - greenLoc.lng);
      const latCos = Math.cos(centerLat * (Math.PI / 180));
      const lngDiffInLatEquivalent = lngDiff * latCos;
      const distanceInLatEquivalent = Math.sqrt(latDiff * latDiff + lngDiffInLatEquivalent * lngDiffInLatEquivalent);
      const size = map.getSize();
      const aspectRatio = size.x / size.y;
      const S = distanceInLatEquivalent * 1.4 * Math.min(1, aspectRatio);
      const finalS = Math.max(S, distanceInLatEquivalent * 0.6); 
      const spanLng = finalS / latCos;
      const bounds = latLngBounds([
        [centerLat - finalS / 2, centerLng - spanLng / 2],
        [centerLat + finalS / 2, centerLng + spanLng / 2]
      ]);
      map.fitBounds(bounds, { padding: [0, 0] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, centerTrigger, currentHoleIndex, isTeeView]);
  return null;
}

function MapRotationManager({ bearing, centerTrigger, currentHoleIndex, isTeeView }) {
  const map = useMap();
  useEffect(() => {
    if (typeof map.setBearing === 'function') map.setBearing(bearing);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, centerTrigger, currentHoleIndex, isTeeView]);
  return null;
}

function MapEvents({ setTargetPoint }) {
  useMapEvents({
    click(e) { setTargetPoint({ lat: e.latlng.lat, lng: e.latlng.lng }); },
    dblclick() { setTargetPoint(null); }
  });
  return null;
}

// --- ICONS ---
const createGreenIcon = (distanceTargetToGreen) => divIcon({
  className: '', 
  html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="background-color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #333;">⚑</div>
      ${distanceTargetToGreen !== null ? `<div style="position: absolute; left: 28px; background: #222; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">${distanceTargetToGreen}m</div>` : ''}
    </div>`,
  iconSize: [24, 24], iconAnchor: [12, 12]
});

const userIcon = divIcon({
  className: '', 
  html: `<div style="background-color: #4A90E2; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9]
});

const createTargetIcon = (distance) => divIcon({
  className: '',
  html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="width: 16px; height: 16px; border: 2px solid white; border-radius: 50%; background: transparent; box-shadow: 0 0 2px rgba(0,0,0,0.5);"></div>
      <div style="position: absolute; left: 24px; background: #222; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">${distance !== null ? distance + 'm' : 'N/A'}</div>
    </div>`,
  iconSize: [20, 20], iconAnchor: [10, 10]
});

// --- PHASE 2: SCORECARD HELPER COMPONENTS ---
const getScoreStyles = (score, par) => {
  if (!score || score === 0) return { shape: null, textColor: '#111' };
  const diff = score - par;
  if (diff <= -2) return { shape: 'double-circle', textColor: '#111' };
  if (diff === -1) return { shape: 'circle', textColor: '#111' };
  if (diff === 0) return { shape: null, textColor: '#111' };
  if (diff === 1) return { shape: 'square', textColor: '#111' };
  if (diff === 2) return { shape: 'double-square', textColor: '#111' };
  return { shape: 'red-square', textColor: '#fff' };
};

const renderScoreShape = (shape) => {
  const base = { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (shape === 'circle') return <div style={{ ...base, border: '1.5px solid #111', borderRadius: '50%' }} />;
  if (shape === 'double-circle') return (
    <div style={{ ...base, border: '1.5px solid #111', borderRadius: '50%', padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: '1px solid #111', borderRadius: '50%' }} />
    </div>
  );
  if (shape === 'square') return <div style={{ ...base, border: '1.5px solid #111' }} />;
  if (shape === 'double-square') return (
    <div style={{ ...base, border: '1.5px solid #111', padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: '1px solid #111' }} />
    </div>
  );
  if (shape === 'red-square') return <div style={{ ...base, backgroundColor: '#d32f2f' }} />;
  return null;
};

const ToggleBtn = ({ label, checked, onChange }) => (
  <div 
    onClick={() => onChange(!checked)} 
    style={{ 
      padding: '8px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.9rem',
      backgroundColor: checked ? '#fff' : '#e0e0e0',
      color: checked ? '#000' : '#666',
      border: checked ? '2px solid #000' : '1px solid #ccc',
      fontWeight: checked ? 'bold' : 'normal',
      boxShadow: checked ? '0 2px 4px rgba(0,0,0,0.2)' : 'none',
      transition: 'all 0.1s ease'
    }}
  >
    {label}
  </div>
);

// New component for the Live View Match Play Toggles
const MatchToggleBtn = ({ label, value, selected, onClick }) => (
  <div 
    onClick={() => onClick(value)}
    style={{
      padding: '4px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold',
      backgroundColor: selected ? '#4CAF50' : '#1B5E20',
      color: selected ? '#FFF' : '#C8E6C9',
      border: selected ? '2px solid #FFF' : '2px solid transparent',
      boxShadow: selected ? '0 2px 6px rgba(0,0,0,0.4)' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minWidth: '60px', textAlign: 'center', boxSizing: 'border-box',
      transition: 'all 0.15s ease'
    }}
  >
    {label}
  </div>
);

// --- MAIN APP ---
export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(0);
  
  const [scores, setScores] = useState(() => JSON.parse(localStorage.getItem('myScores')) || Array(18).fill(0));
  const [putts, setPutts] = useState(() => JSON.parse(localStorage.getItem('myPutts')) || Array(18).fill(0));
  const [matchPlay, setMatchPlay] = useState(() => JSON.parse(localStorage.getItem('myMatch')) || Array(18).fill(''));
  
  // TOGGLE STATES
  const [trackScore, setTrackScore] = useState(() => {
    const saved = localStorage.getItem('trackScore');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [trackPutts, setTrackPutts] = useState(() => JSON.parse(localStorage.getItem('trackPutts')) || false);
  const [trackGame, setTrackGame] = useState(() => JSON.parse(localStorage.getItem('trackGame')) || false);
  const [highContrast, setHighContrast] = useState(() => JSON.parse(localStorage.getItem('highContrast')) || false);
  
  const [matchPlayResult, setMatchPlayResult] = useState('');
  const [hideEasterEgg, setHideEasterEgg] = useState(false);

  const [gpsLocation, setGpsLocation] = useState(null);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);
  const [isExporting, setIsExporting] = useState(false); // Used to swap inputs for divs during screenshot
  
  const [centerTrigger, setCenterTrigger] = useState(0);
  const [hasInitialGps, setHasInitialGps] = useState(false);

  // Scorecard DOM ref for saving image
  const scorecardRef = useRef(null);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  useEffect(() => {
    localStorage.setItem('myScores', JSON.stringify(scores));
    localStorage.setItem('myPutts', JSON.stringify(putts));
    localStorage.setItem('myMatch', JSON.stringify(matchPlay));
    localStorage.setItem('trackScore', JSON.stringify(trackScore));
    localStorage.setItem('trackPutts', JSON.stringify(trackPutts));
    localStorage.setItem('trackGame', JSON.stringify(trackGame));
    localStorage.setItem('highContrast', JSON.stringify(highContrast));
  }, [scores, putts, matchPlay, trackScore, trackPutts, trackGame, highContrast]);

  useEffect(() => {
    if (!trackGame) {
      setMatchPlayResult('');
      return;
    }
    
    let aWins = 0;
    let bWins = 0;
    let holesLogged = 0;
    
    matchPlay.forEach(val => {
      if (val === 'A') aWins++;
      else if (val === 'B') bWins++;
      
      if (val !== '') holesLogged++;
    });
    
    const diff = aWins - bWins;
    const absDiff = Math.abs(diff);
    
    const strokeWord = absDiff === 1 ? 'höggi' : 'höggum';
    const verb = holesLogged === 18 ? 'vann' : 'er að vinna';
    
    if (diff > 0) setMatchPlayResult(`Halli&co ${verb} með ${absDiff} ${strokeWord}`);
    else if (diff < 0) setMatchPlayResult(`Hinir ${verb} með ${absDiff} ${strokeWord}`);
    else setMatchPlayResult('Jafntefli');
  }, [matchPlay, trackGame]);

  useEffect(() => {
    if (isTeeView) return;
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => setGpsLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
        (error) => console.error("GPS Error:", error),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [isTeeView]);

  useEffect(() => {
    if (gpsLocation && !hasInitialGps) {
      setHasInitialGps(true);
      setCenterTrigger(c => c + 1);
    }
  }, [gpsLocation, hasInitialGps]);

  useEffect(() => { setTargetPoint(null); }, [currentHoleIndex]);

  // Main View Stepper Handlers
  const adjustScore = (amount) => {
    const newScores = [...scores];
    const currentVal = newScores[currentHoleIndex] || 0;
    if (currentVal === 0) {
      newScores[currentHoleIndex] = currentHole.par;
    } else {
      newScores[currentHoleIndex] = Math.max(0, currentVal + amount);
    }
    setScores(newScores);
  };

  const adjustPutts = (amount) => {
    const newPutts = [...putts];
    const currentVal = newPutts[currentHoleIndex] || 0;
    if (currentVal === 0) {
      newPutts[currentHoleIndex] = 1;
    } else {
      newPutts[currentHoleIndex] = Math.max(0, currentVal + amount);
    }
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

  // --- ACTIONS ---
  const saveScorecardImage = () => {
    setIsExporting(true); // Switch to plain divs for perfect rendering
    
    setTimeout(() => { // Give React 150ms to update the DOM
      if (scorecardRef.current) {
        html2canvas(scorecardRef.current, { backgroundColor: '#fff', scale: 2 }).then(canvas => {
          const link = document.createElement('a');
          
          // Generate today's date in YYYY-MM-DD format
          const today = new Date();
          const dateString = today.toISOString().split('T')[0];
          
          link.download = `Mosgolf_Skorkort_${dateString}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
          setIsExporting(false); // Switch back to inputs
        }).catch(() => setIsExporting(false));
      } else {
        setIsExporting(false);
      }
    }, 150);
  };

  const openGolfBox = () => {
    window.open('https://www.golfbox.dk/site/my_golfbox/score/whs/newWHSScore.asp?', '_blank');
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

  if (activeLocation && currentHole.greenLocation) {
    const centerLat = (activeLocation.lat + currentHole.greenLocation.lat) / 2;
    const centerLng = (activeLocation.lng + currentHole.greenLocation.lng) / 2;
    const latDiff = Math.abs(activeLocation.lat - currentHole.greenLocation.lat);
    const lngDiff = Math.abs(activeLocation.lng - currentHole.greenLocation.lng);
    const latCos = Math.cos(centerLat * (Math.PI / 180));
    const distanceInLatEquivalent = Math.sqrt(latDiff * latDiff + (lngDiff * latCos) * (lngDiff * latCos));
    const heightSpan = distanceInLatEquivalent * 1.3;
    const widthSpan = distanceInLatEquivalent * 0.6;
    initialBounds = [
      [centerLat - heightSpan / 2, centerLng - (widthSpan / latCos) / 2],
      [centerLat + heightSpan / 2, centerLng + (widthSpan / latCos) / 2]
    ];
  }

  const calculateTotal = (arr, start, end) => arr.slice(start, end).reduce((a, b) => a + b, 0);

  // --- SCORECARD STYLING VARS ---
  const SQUARE_CELL_SIZE = '44px';
  const cellStyle = { 
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: SQUARE_CELL_SIZE,
    borderBottom: '1px solid #000', borderRight: '1px solid #000', boxSizing: 'border-box', position: 'relative'
  };
  const summaryCellStyle = { ...cellStyle, fontWeight: 'bold', backgroundColor: '#f0f0f0', color: '#111' };
  
  const getGridCols = () => {
    if (trackGame) {
      return `40px 40px ${trackScore ? SQUARE_CELL_SIZE : ''} ${trackPutts ? SQUARE_CELL_SIZE : ''} 1fr`;
    }
    return `40px 40px ${trackScore ? '1fr' : ''} ${trackPutts ? '1fr' : ''}`;
  };

  const stepperBtnStyle = {
    width: '40px', height: '40px', border: 'none', background: 'transparent',
    color: 'white', fontSize: '2rem', 
    fontWeight: 'bold', cursor: 'pointer', display: 'flex', 
    alignItems: 'center', justifyContent: 'center', padding: 0
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
        {/* Normal Weight for Hole and Par */}
        <div style={{ ...cellStyle, width: '40px', borderLeft: '1px solid #000', color: '#111', fontWeight: 'normal' }}>{holeData.hole}</div>
        <div style={{ ...cellStyle, width: '40px', color: '#111', fontWeight: 'normal' }}>{holeData.par}</div>
        
        {trackScore && (
          <div style={{ ...cellStyle, width: '100%' }}>
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
          <div style={{ ...cellStyle, width: '100%' }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontWeight: 'bold' }}>
                {putts[index] || ''}
              </div>
            ) : (
              <input 
                type="number" inputMode="numeric" className="no-spinners"
                value={putts[index] || ''} onChange={(e) => handlePuttsChange(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: '#111', fontWeight: 'bold' }} 
              />
            )}
          </div>
        )}
        
        {trackGame && (
          <div style={{ ...cellStyle, width: '100%', padding: '0' }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontWeight: 'normal', fontSize: '1rem' }}>
                {matchPlay[index] === 'A' ? 'Halli&co' : matchPlay[index] === 'B' ? 'Hinir' : matchPlay[index] === 'H' ? 'Féll' : ''}
              </div>
            ) : (
              <select 
                value={matchPlay[index]} onChange={(e) => updateMatch(e.target.value, index)} 
                style={{ ...invisibleInputStyle, color: '#111', appearance: 'none', textAlignLast: 'center', fontWeight: 'normal', fontSize: '1rem' }}
              >
                <option value=""></option>
                <option value="A">Halli&co</option>
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

  // New action button styles
  const actionBtnStyle = {
    flex: 1, padding: '15px 5px', background: '#fff', border: '2px solid #000', borderRadius: '0', 
    fontWeight: 'bold', fontSize: '1rem', color: '#111', cursor: 'pointer', 
    textTransform: 'uppercase', letterSpacing: '0.5px'
  };

  const clearBtnStyle = {
    width: '100%', background: '#fff', color: '#d32f2f', padding: '15px', border: '2px solid #000', 
    borderRadius: '0', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', 
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
  };

  return (
    <div style={{ 
      display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: 'sans-serif', backgroundColor: '#2E7D32',
      filter: highContrast ? 'contrast(140%) saturate(150%)' : 'none', transition: 'filter 0.3s ease'
    }}>
      <style>{`
        .no-spinners::-webkit-inner-spin-button, 
        .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinners { -moz-appearance: textfield; }
      `}</style>

      {/* HEADER */}
      <header style={{ padding: 'max(env(safe-area-inset-top), 15px) 15px 15px', backgroundColor: '#2E7D32', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem' }}>Hola {currentHole.hole} | Par {currentHole.par}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => setShowScorecard(true)} style={{ background: '#1B5E20', color: 'white', padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            Skorkort
          </button>
        </div>
      </header>

      {/* MAP AREA */}
      <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MapContainer bounds={initialBounds} doubleClickZoom={false} zoomControl={false} rotateControl={false} zoomSnap={0} maxZoom={22} rotate={true} style={{ flex: 1, width: '100%', height: '100%', zIndex: 0 }}>
          <MapCameraTracker startLoc={activeLocation} greenLoc={currentHole.greenLocation} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} />
          <MapRotationManager bearing={mapBearing} centerTrigger={centerTrigger} currentHoleIndex={currentHoleIndex} isTeeView={isTeeView} />
          <MapEvents setTargetPoint={setTargetPoint} />
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" maxZoom={22} maxNativeZoom={18} />
          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={createGreenIcon(targetPoint ? distanceTargetToGreen : null)} rotateWithView={false} />
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} rotateWithView={false} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={createTargetIcon(distanceUserToTarget)} rotateWithView={false} />}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [targetPoint.lat, targetPoint.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {targetPoint && <Polyline positions={[[targetPoint.lat, targetPoint.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
        </MapContainer>
        
        {/* TOP LEFT: View Toggle & Center Button */}
        <div style={{ position: 'absolute', top: '15px', left: '15px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1000 }}>
          <div onClick={() => setIsTeeView(!isTeeView)} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer' }}>
            {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
          </div>
          {!isTeeView && (
            <div onClick={() => setCenterTrigger(c => c + 1)} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer' }}>
              <Crosshair size={20} />
            </div>
          )}
        </div>

        {/* TOP RIGHT: Distance Pill */}
        <div style={{ position: 'absolute', top: '15px', right: '15px', backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '6px 14px', borderRadius: '20px', fontSize: '1rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', zIndex: 1000, pointerEvents: 'none' }}>
          {distanceUserToGreen !== null ? `${distanceUserToGreen}m` : 'Leitar...'}
        </div>

        {/* BOTTOM OVERLAYS: Fyrri / Næsta Buttons floating on map */}
        <div style={{ position: 'absolute', bottom: showFooter ? '15px' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', left: '15px', zIndex: 1000 }}>
           <button onClick={() => setCurrentHoleIndex(Math.max(0, currentHoleIndex - 1))} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px 16px', borderRadius: '20px', border: 'none', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
             Fyrri
           </button>
        </div>
        <div style={{ position: 'absolute', bottom: showFooter ? '15px' : 'calc(env(safe-area-inset-bottom, 15px) + 15px)', right: '15px', zIndex: 1000 }}>
           <button onClick={() => setCurrentHoleIndex(Math.min(17, currentHoleIndex + 1))} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px 16px', borderRadius: '20px', border: 'none', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
             Næsta
           </button>
        </div>
      </main>

      {/* FOOTER - Main view steppers */}
      {showFooter && (
        <footer style={{ padding: '8px 10px calc(env(safe-area-inset-bottom, 8px) + 8px)', backgroundColor: '#2E7D32', color: 'white', zIndex: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', width: '100%', gap: '15px' }}>
              {trackScore && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => adjustScore(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', minWidth: '70px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {scores[currentHoleIndex] || 0} högg
                  </span>
                  <button onClick={() => adjustScore(1)} style={stepperBtnStyle}>+</button>
                </div>
              )}
              
              {trackPutts && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button onClick={() => adjustPutts(-1)} style={stepperBtnStyle}>{"\u2212"}</button>
                  <span style={{ fontSize: '1.2rem', fontWeight: 'bold', minWidth: '70px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {putts[currentHoleIndex] || 0} pútt
                  </span>
                  <button onClick={() => adjustPutts(1)} style={stepperBtnStyle}>+</button>
                </div>
              )}
            </div>

            {trackGame && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', marginTop: '2px', flexWrap: 'wrap' }}>
                <MatchToggleBtn 
                  label="Halli&co" 
                  value="A" 
                  selected={matchPlay[currentHoleIndex] === 'A'} 
                  onClick={toggleMatchPlay} 
                />
                <MatchToggleBtn 
                  label="Hinir" 
                  value="B" 
                  selected={matchPlay[currentHoleIndex] === 'B'} 
                  onClick={toggleMatchPlay} 
                />
                <MatchToggleBtn 
                  label="Féll" 
                  value="H" 
                  selected={matchPlay[currentHoleIndex] === 'H'} 
                  onClick={toggleMatchPlay} 
                />
              </div>
            )}
          </div>
        </footer>
      )}

      {/* SCORECARD OVERLAY */}
      {showScorecard && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f5f5f5', zIndex: 9999, display: 'flex', flexDirection: 'column', color: '#111' }}>
          
          <div style={{ padding: 'max(env(safe-area-inset-top), 15px) 20px 15px', background: '#2E7D32', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <h2 style={{ margin: 0, color: 'white' }}>Skorkort</h2>
            <button onClick={() => setShowScorecard(false)} style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Loka</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
            
            {/* Toggles - Styled as pills outside the scorecard */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
              <ToggleBtn label="Skor" checked={trackScore} onChange={setTrackScore} />
              <ToggleBtn label="Pútt" checked={trackPutts} onChange={setTrackPutts} />
              <ToggleBtn label="Leikur" checked={trackGame} onChange={setTrackGame} />
              <ToggleBtn label="Háskerpa" checked={highContrast} onChange={setHighContrast} />
            </div>

            {/* Classic Printed Scorecard Container WITH REF */}
            <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
              <div ref={scorecardRef} style={{ background: '#fff', borderRadius: '0', border: '2px solid #000', overflow: 'hidden', marginBottom: '20px', width: '100%' }}>
                
                {/* Table Headers */}
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.9rem', backgroundColor: '#fff', borderBottom: '2px solid #000' }}>
                  <strong style={{ ...cellStyle, borderLeft: '1px solid #000', borderTop: 'none', color: '#111' }}>H</strong>
                  <strong style={{ ...cellStyle, borderTop: 'none', color: '#111' }}>P</strong>
                  {trackScore && <strong style={{ ...cellStyle, borderTop: 'none', color: '#111' }}>SKOR</strong>}
                  {trackPutts && <strong style={{ ...cellStyle, borderTop: 'none', color: '#111' }}>PÚTT</strong>}
                  {trackGame && <strong style={{ ...cellStyle, borderTop: 'none', borderRight: '1px solid #000', color: '#111' }}>LEIKUR</strong>}
                </div>
                
                {/* Holes 1-18 with Mid-Break */}
                <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '1.1rem', backgroundColor: '#fff', color: '#111' }}>
                  
                  {/* Front 9 */}
                  {courseData.slice(0, 9).map((hole, i) => renderRow(hole, i))}
                  
                  {/* OUT (Front 9 Summary Break) */}
                  <div style={{ ...summaryCellStyle, borderLeft: '1px solid #000', borderBottom: '2px solid #000' }}>ÚT</div>
                  <div style={{ ...summaryCellStyle, borderBottom: '2px solid #000' }}>{courseData.slice(0, 9).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, borderBottom: '2px solid #000' }}>{calculateTotal(scores, 0, 9)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, borderBottom: '2px solid #000' }}>{calculateTotal(putts, 0, 9)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, borderBottom: '2px solid #000', borderRight: '1px solid #000' }}></div>}

                  {/* Back 9 */}
                  {courseData.slice(9, 18).map((hole, i) => renderRow(hole, i + 9))}

                  {/* IN (Back 9 Summary) */}
                  <div style={{ ...summaryCellStyle, borderLeft: '1px solid #000' }}>INN</div>
                  <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>}
                  {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, borderRight: '1px solid #000' }}></div>}

                  {/* TOTAL (18 Holes) */}
                  <div style={{ ...summaryCellStyle, borderLeft: '1px solid #000', backgroundColor: '#e8f5e9', borderBottom: 'none' }}>TOT</div>
                  <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', borderBottom: 'none' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
                  {trackScore && <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', borderBottom: 'none' }}>{calculateTotal(scores, 0, 18)}</div>}
                  {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', borderBottom: 'none' }}>{calculateTotal(putts, 0, 18)}</div>}
                  {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', borderBottom: 'none', borderRight: '1px solid #000' }}></div>}
                </div>
              </div>
            </div>

            {trackGame && matchPlayResult && (
              <div style={{ padding: '15px', background: '#fff', border: '2px solid #000', borderRadius: '0', marginBottom: '20px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: '#1B5E20' }}>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '1.1rem', color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Niðurstaða leiks</h3>
                {matchPlayResult}
              </div>
            )}

            {/* ACTION BUTTONS ROW */}
            <div style={{ display: 'flex', gap: '10px', width: '100%', marginBottom: '15px' }}>
              <button onClick={saveScorecardImage} style={actionBtnStyle}>
                Vista skorkort
              </button>
              <button onClick={openGolfBox} style={{ ...actionBtnStyle, color: '#1B5E20' }}>
                Skrá skor
              </button>
            </div>

            <button onClick={clearRound} style={clearBtnStyle}>
              Þurrka út skorkort
            </button>
          </div>
        </div>
      )}

      {/* EASTER EGG */}
      {scores[5] === 7 && !hideEasterEgg && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 99999, 
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          animation: 'fadeIn 0.5s ease'
        }}>
          <img 
            src={easterEggImg} 
            alt="Easter Egg" 
            style={{ maxWidth: '80%', maxHeight: '60%', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }} 
          />
          <button 
            onClick={() => setHideEasterEgg(true)} 
            style={{ 
              marginTop: '30px', background: '#2E7D32', color: 'white', 
              padding: '12px 24px', border: 'none', borderRadius: '8px', 
              fontSize: '1.2rem', fontWeight: 'bold', cursor: 'pointer' 
            }}
          >
            Loka
          </button>
        </div>
      )}
    </div>
  );
}