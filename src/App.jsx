import React, { useState, useEffect } from 'react';
import { courseData } from './courseData';
import { calculateDistanceInMeters, calculateBearing } from './utils';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { Navigation, Flag } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate'; 

// --- MAP HELPER COMPONENTS ---
function MapCameraTracker({ startLoc, greenLoc }) {
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
  }, [map, startLoc, greenLoc]);
  return null;
}

function MapRotationManager({ bearing }) {
  const map = useMap();
  useEffect(() => {
    if (typeof map.setBearing === 'function') map.setBearing(bearing);
  }, [map, bearing]);
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

// --- MAIN APP ---
export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(0);
  
  const [scores, setScores] = useState(() => JSON.parse(localStorage.getItem('myScores')) || Array(18).fill(0));
  const [putts, setPutts] = useState(() => JSON.parse(localStorage.getItem('myPutts')) || Array(18).fill(0));
  const [matchPlay, setMatchPlay] = useState(() => JSON.parse(localStorage.getItem('myMatch')) || Array(18).fill(''));
  
  const [trackPutts, setTrackPutts] = useState(() => JSON.parse(localStorage.getItem('trackPutts')) || false);
  const [trackGame, setTrackGame] = useState(() => JSON.parse(localStorage.getItem('trackGame')) || false);
  const [highContrast, setHighContrast] = useState(() => JSON.parse(localStorage.getItem('highContrast')) || false);
  const [matchPlayResult, setMatchPlayResult] = useState('');
  const [hideEasterEgg, setHideEasterEgg] = useState(false); // NEW STATE

  const [gpsLocation, setGpsLocation] = useState(null);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  useEffect(() => {
    localStorage.setItem('myScores', JSON.stringify(scores));
    localStorage.setItem('myPutts', JSON.stringify(putts));
    localStorage.setItem('myMatch', JSON.stringify(matchPlay));
    localStorage.setItem('trackPutts', JSON.stringify(trackPutts));
    localStorage.setItem('trackGame', JSON.stringify(trackGame));
    localStorage.setItem('highContrast', JSON.stringify(highContrast));
  }, [scores, putts, matchPlay, trackPutts, trackGame, highContrast]);

  useEffect(() => {
    if (!trackGame) {
      setMatchPlayResult('');
      return;
    }
    let aWins = 0;
    let bWins = 0;
    matchPlay.forEach(val => {
      if (val === 'A') aWins++;
      else if (val === 'B') bWins++;
    });
    const diff = aWins - bWins;
    if (diff > 0) setMatchPlayResult(`Halli&co er að vinna með ${diff} höggum`);
    else if (diff < 0) setMatchPlayResult(`Hinir er að vinna með ${Math.abs(diff)} höggum`);
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

  useEffect(() => { setTargetPoint(null); }, [currentHoleIndex]);

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

  const clearRound = () => {
    if (window.confirm("Þurrka út allt?")) {
      setScores(Array(18).fill(0));
      setPutts(Array(18).fill(0));
      setMatchPlay(Array(18).fill('')); 
      setShowScorecard(false);
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

  // --- STYLING VARS ---
  const cellStyle = { padding: '10px 4px', borderBottom: '1px solid #ddd', borderRight: '1px solid #ddd', display: 'flex', justifyContent: 'center', alignItems: 'center' };
  const summaryCellStyle = { ...cellStyle, fontWeight: 'bold', background: '#f5f5f5', color: '#2E7D32' };
  const getGridCols = () => `40px 40px 1fr ${trackPutts ? '1fr' : ''} ${trackGame ? '80px' : ''}`;

  const footerInputStyle = { 
    width: '100%', height: '44px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem', 
    border: '1px solid #1B5E20', borderRadius: '0px', backgroundColor: '#C8E6C9', color: '#111', 
    fontWeight: 'bold', appearance: 'none', margin: 0
  };

  const tableInputStyle = { 
    width: '100%', height: '36px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.1rem', 
    border: '1px solid #ccc', borderRadius: '0px', background: '#fff', color: '#111', 
    fontWeight: 'bold', appearance: 'none', margin: 0 
  };

  const renderRow = (holeData, index) => (
    <React.Fragment key={index}>
      <div style={{ ...cellStyle, borderLeft: '1px solid #ddd', fontWeight: 'bold', color: '#333' }}>{holeData.hole}</div>
      <div style={cellStyle}>{holeData.par}</div>
      <div style={cellStyle}>
        <input 
          type="number" inputMode="numeric" pattern="[0-9]*" className="no-spinners"
          value={scores[index] || ''} onChange={(e) => handleScoreChange(e.target.value, index)} style={tableInputStyle} placeholder="" 
        />
      </div>
      {trackPutts && (
        <div style={cellStyle}>
          <input 
            type="number" inputMode="numeric" pattern="[0-9]*" className="no-spinners"
            value={putts[index] || ''} onChange={(e) => handlePuttsChange(e.target.value, index)} style={tableInputStyle} placeholder="" 
          />
        </div>
      )}
      {trackGame && (
        <div style={cellStyle}>
          <select value={matchPlay[index]} onChange={(e) => updateMatch(e.target.value, index)} style={{ ...tableInputStyle, padding: '0 8px', background: '#fafafa' }}>
            <option value=""></option>
            <option value="A">Halli&co</option>
            <option value="B">Hinir</option>
            <option value="H">Féll</option>
          </select>
        </div>
      )}
    </React.Fragment>
  );

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
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'normal' }}>Samtals: <strong>{scores.reduce((a, b) => a + b, 0)}</strong></h3>
          <button onClick={() => setShowScorecard(true)} style={{ background: '#1B5E20', color: 'white', padding: '8px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            Skorkort
          </button>
        </div>
      </header>

      {/* MAP AREA */}
      <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <MapContainer bounds={initialBounds} doubleClickZoom={false} zoomControl={false} rotateControl={false} zoomSnap={0} maxZoom={22} rotate={true} style={{ flex: 1, width: '100%', height: '100%', zIndex: 0 }}>
          <MapCameraTracker startLoc={activeLocation} greenLoc={currentHole.greenLocation} />
          <MapRotationManager bearing={mapBearing} />
          <MapEvents setTargetPoint={setTargetPoint} />
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" maxZoom={22} maxNativeZoom={18} />
          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={createGreenIcon(targetPoint ? distanceTargetToGreen : null)} rotateWithView={false} />
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} rotateWithView={false} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={createTargetIcon(distanceUserToTarget)} rotateWithView={false} />}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [targetPoint.lat, targetPoint.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {targetPoint && <Polyline positions={[[targetPoint.lat, targetPoint.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
        </MapContainer>
        
        {/* TOP LEFT: View Toggle */}
        <div style={{ position: 'absolute', top: '15px', left: '15px', display: 'flex', gap: '10px', zIndex: 1000 }}>
          <div onClick={() => setIsTeeView(!isTeeView)} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer' }}>
            {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
          </div>
        </div>

        {/* TOP RIGHT: Distance Pill */}
        <div style={{ position: 'absolute', top: '15px', right: '15px', backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '6px 14px', borderRadius: '20px', fontSize: '1rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', zIndex: 1000, pointerEvents: 'none' }}>
          {distanceUserToGreen !== null ? `${distanceUserToGreen}m` : 'Leitar...'}
        </div>

        {/* BOTTOM OVERLAYS: Prev / Next Hole Buttons */}
        <div style={{ position: 'absolute', bottom: '15px', left: '15px', zIndex: 1000 }}>
           <button onClick={() => setCurrentHoleIndex(Math.max(0, currentHoleIndex - 1))} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px 16px', borderRadius: '20px', border: 'none', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
             Fyrri
           </button>
        </div>
        <div style={{ position: 'absolute', bottom: '15px', right: '15px', zIndex: 1000 }}>
           <button onClick={() => setCurrentHoleIndex(Math.min(17, currentHoleIndex + 1))} style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white', padding: '10px 16px', borderRadius: '20px', border: 'none', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
             Næsta
           </button>
        </div>
      </main>

      {/* FOOTER */}
      <footer style={{ padding: '15px 15px calc(env(safe-area-inset-bottom, 15px) + 15px)', backgroundColor: '#2E7D32', color: 'white', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', gap: '15px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <label style={{ fontSize: '0.85rem', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Skor</label>
            <input type="number" inputMode="numeric" pattern="[0-9]*" className="no-spinners" value={scores[currentHoleIndex] || ''} onChange={(e) => handleScoreChange(e.target.value)} style={{...footerInputStyle, maxWidth: trackPutts || trackGame ? 'none' : '120px'}} placeholder="" />
          </div>
          
          {trackPutts && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <label style={{ fontSize: '0.85rem', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pútt</label>
              <input type="number" inputMode="numeric" pattern="[0-9]*" className="no-spinners" value={putts[currentHoleIndex] || ''} onChange={(e) => handlePuttsChange(e.target.value)} style={footerInputStyle} placeholder="" />
            </div>
          )}

          {trackGame && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <label style={{ fontSize: '0.85rem', marginBottom: '6px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Leikur</label>
              <select value={matchPlay[currentHoleIndex]} onChange={(e) => updateMatch(e.target.value)} style={{ ...footerInputStyle, padding: '0 8px', backgroundColor: '#C8E6C9' }}>
                <option value=""></option>
                <option value="A">Halli&co</option>
                <option value="B">Hinir</option>
                <option value="H">Féll</option>
              </select>
            </div>
          )}

        </div>
      </footer>

      {/* SCORECARD OVERLAY */}
      {showScorecard && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1B5E20', zIndex: 9999, display: 'flex', flexDirection: 'column', color: '#111' }}>
          
          <div style={{ padding: 'max(env(safe-area-inset-top), 15px) 20px 15px', background: '#2E7D32', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <h2 style={{ margin: 0, color: 'white' }}>Skorkort</h2>
            <button onClick={() => setShowScorecard(false)} style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Loka</button>
          </div>

          <div style={{ padding: '15px 20px', display: 'flex', flexWrap: 'wrap', gap: '15px', background: '#1B5E20', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'white' }}>
              <input type="checkbox" checked={trackPutts} onChange={(e) => setTrackPutts(e.target.checked)} style={{ width: '18px', height: '18px' }}/> Telja pútt
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'white' }}>
              <input type="checkbox" checked={trackGame} onChange={(e) => setTrackGame(e.target.checked)} style={{ width: '18px', height: '18px' }}/> Telja leik
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'white' }}>
              <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} style={{ width: '18px', height: '18px' }}/> Háskerpa
            </label>
          </div>

          {/* Unified 18 Hole Table */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
            <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #ddd', overflow: 'hidden', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
              
              {/* Table Headers */}
              <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.9rem', backgroundColor: '#f0f0f0', borderBottom: '2px solid #ddd' }}>
                <strong style={{ ...cellStyle, borderLeft: '1px solid #ddd', borderTop: 'none', color: '#555' }}>H</strong>
                <strong style={{ ...cellStyle, borderTop: 'none', color: '#555' }}>P</strong>
                <strong style={{ ...cellStyle, borderTop: 'none', color: '#555' }}>Skor</strong>
                {trackPutts && <strong style={{ ...cellStyle, borderTop: 'none', color: '#555' }}>Pútt</strong>}
                {trackGame && <strong style={{ ...cellStyle, borderTop: 'none', color: '#555' }}>Leikur</strong>}
              </div>
              
              {/* Holes 1-18 */}
              <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.95rem', backgroundColor: '#fff' }}>
                {courseData.map((hole, i) => renderRow(hole, i))}
                
                {/* --- SUMMARY ROWS --- */}
                {/* OUT (Front 9) */}
                <div style={{ ...summaryCellStyle, borderLeft: '1px solid #ddd' }}>Út</div>
                <div style={summaryCellStyle}>{courseData.slice(0, 9).reduce((sum, h) => sum + h.par, 0)}</div>
                <div style={summaryCellStyle}>{calculateTotal(scores, 0, 9)}</div>
                {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 0, 9)}</div>}
                {trackGame && <div style={summaryCellStyle}></div>}

                {/* IN (Back 9) */}
                <div style={{ ...summaryCellStyle, borderLeft: '1px solid #ddd' }}>Inn</div>
                <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
                <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>
                {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
                {trackGame && <div style={summaryCellStyle}></div>}

                {/* TOTAL (18 Holes) */}
                <div style={{ ...summaryCellStyle, borderLeft: '1px solid #ddd', backgroundColor: '#e8f5e9', color: '#1B5E20', fontSize: '1.1rem' }}>TOT</div>
                <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', color: '#1B5E20', fontSize: '1.1rem' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
                <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', color: '#1B5E20', fontSize: '1.1rem' }}>{calculateTotal(scores, 0, 18)}</div>
                {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9', color: '#1B5E20', fontSize: '1.1rem' }}>{calculateTotal(putts, 0, 18)}</div>}
                {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: '#e8f5e9' }}></div>}
              </div>

            </div>

            {trackGame && matchPlayResult && (
              <div style={{ padding: '15px', background: '#fff', border: '1px solid #ddd', borderRadius: '8px', marginBottom: '20px', textAlign: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: '#1B5E20', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                <h3 style={{ margin: '0 0 5px 0', fontSize: '1.1rem', color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Niðurstaða leiks</h3>
                {matchPlayResult}
              </div>
            )}

            <button onClick={clearRound} style={{ width: '100%', background: '#d32f2f', color: 'white', padding: '15px', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)' }}>
              Þurrka út skorkort
            </button>
          </div>
        </div>
      )}

      {/* EASTER EGG */}
      {scores[5] === 6 && scores[6] === 7 && !hideEasterEgg && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(0,0,0,0.9)', zIndex: 99999, 
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          animation: 'fadeIn 0.5s ease'
        }}>
          <img 
            src="/easter-egg.png" 
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