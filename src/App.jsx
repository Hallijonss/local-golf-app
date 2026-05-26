import React, { useState, useEffect } from 'react';
import { courseData } from './courseData';
import { calculateDistanceInMeters, calculateBearing } from './utils';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { Navigation, Flag } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate'; 

// FIX 2: Better framing. Uses the Tee Box if GPS hasn't loaded yet.
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
      
      // Calculate a perfect isotropic square bounding box on the globe.
      // This ensures Leaflet calculates the exact same zoom level regardless of hole rotation.
      const S = distanceInLatEquivalent * 1.4 * Math.min(1, aspectRatio);
      const finalS = Math.max(S, distanceInLatEquivalent * 0.6); 
      const spanLng = finalS / latCos;

      const bounds = latLngBounds([
        [centerLat - finalS / 2, centerLng - spanLng / 2],
        [centerLat + finalS / 2, centerLng + spanLng / 2]
      ]);
      // Dynamic scaling gives us natural padding, so we pass 0 here
      map.fitBounds(bounds, { padding: [0, 0] });
    }
  }, [map, startLoc, greenLoc]);

  return null;
}

function MapRotationManager({ bearing }) {
  const map = useMap();
  
  useEffect(() => {
    if (typeof map.setBearing === 'function') {
      map.setBearing(bearing);
    }
  }, [map, bearing]);

  return null;
}

function MapEvents({ setTargetPoint }) {
  useMapEvents({
    click(e) {
      setTargetPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    dblclick() {
      setTargetPoint(null);
    }
  });
  return null;
}

const createGreenIcon = (distanceTargetToGreen) => divIcon({
  className: '', 
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="background-color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #333;">⚑</div>
      ${distanceTargetToGreen !== null ? `
        <div style="position: absolute; left: 28px; background: #222; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">
          ${distanceTargetToGreen}m
        </div>
      ` : ''}
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

const userIcon = divIcon({
  className: '', 
  html: `<div style="background-color: #4A90E2; width: 14px; height: 14px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const createTargetIcon = (distance) => divIcon({
  className: '',
  html: `
    <div style="position: relative; display: flex; align-items: center; justify-content: center;">
      <div style="width: 16px; height: 16px; border: 2px solid white; border-radius: 50%; background: transparent; box-shadow: 0 0 2px rgba(0,0,0,0.5);"></div>
      <div style="position: absolute; left: 24px; background: #222; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">
        ${distance !== null ? distance + 'm' : 'N/A'}
      </div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(0);
  
  const [scores, setScores] = useState(() => {
    const savedScores = localStorage.getItem('myGolfScores');
    return savedScores ? JSON.parse(savedScores) : Array(18).fill(0);
  });
  
  const [gpsLocation, setGpsLocation] = useState(null);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  useEffect(() => {
    localStorage.setItem('myGolfScores', JSON.stringify(scores));
  }, [scores]);

  // This effect now only handles watching for the real GPS location
  // when we are in "Live" mode.
  useEffect(() => {
    if (isTeeView) return;

    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setGpsLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        },
        (error) => console.error("GPS Error:", error),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [isTeeView]);

  useEffect(() => {
    setTargetPoint(null);
  }, [currentHoleIndex]);

  const updateScore = (amount) => {
    const newScores = [...scores];
    newScores[currentHoleIndex] = Math.max(0, newScores[currentHoleIndex] + amount);
    setScores(newScores);
  };

  const getScoreSummary = () => {
    let totalScore = 0;
    let totalPar = 0;
    scores.forEach((score, index) => {
      if (score > 0) { 
        totalScore += score;
        totalPar += courseData[index].par;
      }
    });
    const diff = totalScore - totalPar;
    const relation = diff > 0 ? `+${diff}` : diff === 0 ? "E" : diff;
    return { totalScore, relation };
  };

  const clearRound = () => {
    if (window.confirm("Are you sure you want to clear your scorecard?")) {
      setScores(Array(18).fill(0));
      setShowScorecard(false);
    }
  };

  // This is the key change to fix the view "mangling" on hole change.
  // We derive the location to be displayed directly from the current state and props,
  // rather than waiting for a `useEffect` to update state.
  const userLocation = isTeeView ? currentHole.teeLocation : gpsLocation;

  const activeLocation = userLocation || currentHole.teeLocation; // Fallback to tee location if GPS is not yet available in live view

  let distanceUserToGreen = null;
  if (userLocation) distanceUserToGreen = calculateDistanceInMeters(userLocation.lat, userLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  
  let distanceUserToTarget = null;
  if (userLocation && targetPoint) distanceUserToTarget = calculateDistanceInMeters(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
  
  let distanceTargetToGreen = null;
  if (targetPoint) distanceTargetToGreen = calculateDistanceInMeters(targetPoint.lat, targetPoint.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);

  // FIX 1: Add a negative sign (-) to the bearing to counter-spin the plugin correctly
  let mapBearing = 0;
  if (activeLocation) {
    mapBearing = -calculateBearing(activeLocation.lat, activeLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  }

  let initialBounds = null;
  if (activeLocation && currentHole.greenLocation) {
    const centerLat = (activeLocation.lat + currentHole.greenLocation.lat) / 2;
    const centerLng = (activeLocation.lng + currentHole.greenLocation.lng) / 2;
    const latDiff = Math.abs(activeLocation.lat - currentHole.greenLocation.lat);
    const lngDiff = Math.abs(activeLocation.lng - currentHole.greenLocation.lng);
    const latCos = Math.cos(centerLat * (Math.PI / 180));
    const lngDiffInLatEquivalent = lngDiff * latCos;
    const distanceInLatEquivalent = Math.sqrt(latDiff * latDiff + lngDiffInLatEquivalent * lngDiffInLatEquivalent);

    const heightSpan = distanceInLatEquivalent * 1.3;
    const widthSpan = distanceInLatEquivalent * 0.6;
    const widthSpanInLng = widthSpan / latCos;

    initialBounds = [
      [centerLat - heightSpan / 2, centerLng - widthSpanInLng / 2],
      [centerLat + heightSpan / 2, centerLng + widthSpanInLng / 2]
    ];
  } else {
    initialBounds = [
      [activeLocation.lat, activeLocation.lng], 
      [currentHole.greenLocation.lat, currentHole.greenLocation.lng]
    ];
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', backgroundColor: '#2E7D32' }}>
      
      {/* HEADER */}
      <header style={{ padding: '10px 15px', backgroundColor: '#2E7D32', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem' }}>Hole {currentHole.hole} | Par {currentHole.par}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'normal' }}>Total: <strong>{scores.reduce((a, b) => a + b, 0)}</strong></h3>
          <button 
            onClick={() => setShowScorecard(true)}
            style={{ background: '#1B5E20', color: 'white', padding: '6px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Scorecard
          </button>
        </div>
      </header>

      {/* MAP AREA */}
      <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        <MapContainer 
          bounds={initialBounds}
          doubleClickZoom={false}
          zoomControl={false}
          rotateControl={false}
          zoomSnap={0}
          maxZoom={22}
          rotate={true} 
          style={{ flex: 1, width: '100%', height: '100%', zIndex: 0 }}
        >
          {/* Tracker now uses activeLocation (Tee or User) to frame the hole smoothly */}
          <MapCameraTracker startLoc={activeLocation} greenLoc={currentHole.greenLocation} />
          <MapRotationManager bearing={mapBearing} />
          <MapEvents setTargetPoint={setTargetPoint} />
          
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={22}
            maxNativeZoom={18}
          />
          
          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={createGreenIcon(targetPoint ? distanceTargetToGreen : null)} rotateWithView={false} />
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} rotateWithView={false} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={createTargetIcon(distanceUserToTarget)} rotateWithView={false} />}

          {/* LINES */}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [targetPoint.lat, targetPoint.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {targetPoint && <Polyline positions={[[targetPoint.lat, targetPoint.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
        </MapContainer>
        
        {/* ICON TOGGLE BUTTONS */}
        <div style={{ position: 'absolute', top: '15px', left: '15px', display: 'flex', gap: '10px', zIndex: 1000 }}>
          <div 
            onClick={() => setIsTeeView(!isTeeView)}
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white',
              padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)', cursor: 'pointer'
            }}
          >
            {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
          </div>
        </div>

        {/* DISTANCE PILL */}
        <div style={{
          position: 'absolute', top: '15px', right: '15px',
          backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white',
          padding: '6px 14px', borderRadius: '20px', fontSize: '1rem', fontWeight: 'bold',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)', zIndex: 1000, pointerEvents: 'none'
        }}>
          {distanceUserToGreen !== null ? `${distanceUserToGreen}m` : 'Locating...'}
        </div>
      </main>

      {/* FOOTER */}
      <footer style={{ padding: '12px 15px', backgroundColor: '#2E7D32', color: 'white', zIndex: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button 
            style={{ padding: '8px 16px', fontSize: '0.9rem', borderRadius: '8px', border: 'none', backgroundColor: '#1B5E20', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
            onClick={() => setCurrentHoleIndex(Math.max(0, currentHoleIndex - 1))}
          >Prev</button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              style={{ padding: '6px 14px', fontSize: '1.2rem', borderRadius: '8px', border: 'none', backgroundColor: '#1B5E20', color: 'white', fontWeight: 'bold', cursor: 'pointer' }} 
              onClick={() => updateScore(-1)}
            >-</button>
            <span style={{ fontSize: '1.1rem', fontWeight: 'bold', minWidth: '85px', textAlign: 'center' }}>
              Strokes: {scores[currentHoleIndex]}
            </span>
            <button 
              style={{ padding: '6px 14px', fontSize: '1.2rem', borderRadius: '8px', border: 'none', backgroundColor: '#1B5E20', color: 'white', fontWeight: 'bold', cursor: 'pointer' }} 
              onClick={() => updateScore(1)}
            >+</button>
          </div>

          <button 
            style={{ padding: '8px 16px', fontSize: '0.9rem', borderRadius: '8px', border: 'none', backgroundColor: '#1B5E20', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
            onClick={() => setCurrentHoleIndex(Math.min(17, currentHoleIndex + 1))}
          >Next</button>
        </div>
      </footer>

      {/* SCORECARD OVERLAY */}
      {showScorecard && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 9999,
          display: 'flex', flexDirection: 'column', padding: '20px', color: 'white', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>Scorecard</h2>
            <button onClick={() => setShowScorecard(false)} style={{ background: '#333', color: 'white', padding: '10px 15px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', textAlign: 'center', marginBottom: '20px', fontSize: '1.1rem' }}>
            <strong style={{ borderBottom: '1px solid #444', paddingBottom: '5px' }}>Hole</strong>
            <strong style={{ borderBottom: '1px solid #444', paddingBottom: '5px' }}>Par</strong>
            <strong style={{ borderBottom: '1px solid #444', paddingBottom: '5px' }}>Score</strong>
            {courseData.map((hole, index) => (
              <React.Fragment key={index}>
                <div style={{ padding: '5px 0' }}>{hole.hole}</div>
                <div style={{ padding: '5px 0' }}>{hole.par}</div>
                <div style={{ padding: '5px 0', fontWeight: 'bold', color: scores[index] < hole.par && scores[index] > 0 ? '#4ade80' : scores[index] > hole.par ? '#f87171' : 'white' }}>
                  {scores[index] === 0 ? '-' : scores[index]}
                </div>
              </React.Fragment>
            ))}
          </div>

          <div style={{ background: '#1B5E20', padding: '15px', borderRadius: '8px', textAlign: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>Total Strokes: {getScoreSummary().totalScore}</h3>
            <p style={{ margin: '5px 0 0 0', fontSize: '1.1rem' }}>Relation to Par: <strong>{getScoreSummary().relation}</strong></p>
          </div>

          <button onClick={clearRound} style={{ background: '#dc2626', color: 'white', padding: '15px', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
            Clear Round
          </button>
        </div>
      )}

    </div>
  );
}
