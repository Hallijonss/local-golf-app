import React, { useState, useEffect } from 'react';
import { courseData } from './courseData';
import { calculateDistanceInMeters } from './utils';
import { MapContainer, TileLayer, Marker, useMapEvents, Polyline, useMap } from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import { Navigation, Flag } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

function MapCameraTracker({ userLoc, greenLoc }) {
  const map = useMap();
  
  useEffect(() => {
    if (userLoc && greenLoc) {
      const bounds = latLngBounds([
        [userLoc.lat, userLoc.lng],
        [greenLoc.lat, greenLoc.lng]
      ]);
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (greenLoc) {
      map.setView([greenLoc.lat, greenLoc.lng], 18);
    }
  }, [map, userLoc, greenLoc]);

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
  
  // 1. LocalStorage Hookup
  const [scores, setScores] = useState(() => {
    const savedScores = localStorage.getItem('myGolfScores');
    return savedScores ? JSON.parse(savedScores) : Array(18).fill(0);
  });
  
  const [userLocation, setUserLocation] = useState(null);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  // Save scores automatically
  useEffect(() => {
    localStorage.setItem('myGolfScores', JSON.stringify(scores));
  }, [scores]);

  // GPS & Spoofing
  useEffect(() => {
    if (isTeeView) {
      setUserLocation({
        lat: currentHole.teeLocation.lat,
        lng: currentHole.teeLocation.lng
      });
      return;
    }

    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
        },
        (error) => console.error("GPS Error:", error),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [currentHoleIndex, isTeeView, currentHole.teeLocation]);

  useEffect(() => {
    setTargetPoint(null);
  }, [currentHoleIndex]);

  const updateScore = (amount) => {
    const newScores = [...scores];
    newScores[currentHoleIndex] = Math.max(0, newScores[currentHoleIndex] + amount);
    setScores(newScores);
  };

  // Score Summary Math
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

  // Distance Calcs
  let distanceUserToGreen = null;
  if (userLocation) distanceUserToGreen = calculateDistanceInMeters(userLocation.lat, userLocation.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);
  
  let distanceUserToTarget = null;
  if (userLocation && targetPoint) distanceUserToTarget = calculateDistanceInMeters(userLocation.lat, userLocation.lng, targetPoint.lat, targetPoint.lng);
  
  let distanceTargetToGreen = null;
  if (targetPoint) distanceTargetToGreen = calculateDistanceInMeters(targetPoint.lat, targetPoint.lng, currentHole.greenLocation.lat, currentHole.greenLocation.lng);

  const initialBounds = userLocation 
    ? [[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]
    : [[currentHole.greenLocation.lat - 0.001, currentHole.greenLocation.lng - 0.001], [currentHole.greenLocation.lat + 0.001, currentHole.greenLocation.lng + 0.001]];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif', backgroundColor: '#2E7D32' }}>
      
      {/* HEADER */}
      <header style={{ padding: '10px 15px', backgroundColor: '#2E7D32', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
      <main style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <MapContainer 
          key={`hole-${currentHoleIndex}`}
          bounds={initialBounds}
          doubleClickZoom={false}
          zoomControl={false}
          zoomSnap={0}
          maxZoom={22}
          style={{ flex: 1, width: '100%', zIndex: 0 }}
        >
          <MapCameraTracker userLoc={userLocation} greenLoc={currentHole.greenLocation} />
          <MapEvents setTargetPoint={setTargetPoint} />
          
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
            maxZoom={22}
            maxNativeZoom={18}
          />
          
          <Marker position={[currentHole.greenLocation.lat, currentHole.greenLocation.lng]} icon={createGreenIcon(targetPoint ? distanceTargetToGreen : null)} />
          {userLocation && <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} />}
          {targetPoint && <Marker position={[targetPoint.lat, targetPoint.lng]} icon={createTargetIcon(distanceUserToTarget)} />}

          {/* LINES */}
          {userLocation && !targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {userLocation && targetPoint && <Polyline positions={[[userLocation.lat, userLocation.lng], [targetPoint.lat, targetPoint.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
          {targetPoint && <Polyline positions={[[targetPoint.lat, targetPoint.lng], [currentHole.greenLocation.lat, currentHole.greenLocation.lng]]} pathOptions={{ color: 'white', weight: 2 }} />}
        </MapContainer>
        
        {/* ICON TOGGLE BUTTON */}
        <div 
          onClick={() => setIsTeeView(!isTeeView)}
          style={{
            position: 'absolute', top: '15px', left: '15px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)', color: 'white',
            padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)', zIndex: 1000, cursor: 'pointer'
          }}
        >
          {isTeeView ? <Flag size={20} /> : <Navigation size={20} />}
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
      <footer style={{ padding: '12px 15px', backgroundColor: '#2E7D32', color: 'white' }}>
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