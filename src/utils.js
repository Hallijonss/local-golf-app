import { elevationData } from './elevationData';

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