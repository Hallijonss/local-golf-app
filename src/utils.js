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