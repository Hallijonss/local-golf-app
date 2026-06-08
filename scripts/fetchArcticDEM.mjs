// Fetch ArcticDEM 2m and bake it into src/elevationData.js — no manual download.
//
// Reads ONLY the small window covering the course directly from the public
// ArcticDEM v4.1 mosaic Cloud-Optimized GeoTIFF (HTTP range requests), so we
// pull ~a megabyte instead of the full 2.5 GB tile. The running app reads only
// the baked file — no network, no key, offline.
//
// The correct mosaic tile was found via the PGC STAC API:
//   collection arcticdem-mosaics-v4.1-2m, item 14_52_2_1_2m_v4.1
//
// Usage:  node scripts/fetchArcticDEM.mjs
//
// NOTE: ArcticDEM is a SURFACE model (DSM) — like COP30 it reads trees/buildings
// high. It's 2m though, so it captures small features (raised tees) far better.

import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COG_URL = 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/arcticdem/mosaics/v4.1/2m/14_52/14_52_2_1_2m_v4.1_dem.tif';

// --- Course bounding box (WGS84) ---
const LAT_MIN = 64.1623;
const LAT_MAX = 64.1733;
const LNG_MIN = -21.7516;
const LNG_MAX = -21.7197;

const OUT_SPACING_M = 5; // output grid resolution in metres
const NODATA = -9999;

// ArcticDEM heights are ellipsoidal (WGS84); topo maps and COP30 are orthometric
// (mean sea level). Subtract the geoid undulation to convert. For this location
// (64.168N, -21.736W) EGM2008 N = 66.686 m (GeographicLib GeoidEval); it varies
// <0.1 m across the course, so a constant is exact enough.
const GEOID_UNDULATION_M = 66.686;

// ArcticDEM is in EPSG:3413 (NSIDC Sea Ice Polar Stereographic North).
proj4.defs('EPSG:3413', '+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs');
const toRaster = proj4('EPSG:4326', 'EPSG:3413');

async function main() {
  console.log('Opening ArcticDEM COG (range requests)...');
  const tiff = await fromUrl(COG_URL);
  const image = await tiff.getImage();
  const width = image.getWidth(), height = image.getHeight();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution(); // resY negative

  // Project the course bbox corners into EPSG:3413 to find the pixel window.
  const corners = [
    [LNG_MIN, LAT_MIN], [LNG_MIN, LAT_MAX], [LNG_MAX, LAT_MIN], [LNG_MAX, LAT_MAX],
  ].map(([lng, lat]) => toRaster.forward([lng, lat]));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const toCol = (x) => (x - originX) / resX;
  const toRow = (y) => (y - originY) / resY;
  const MARGIN = 8; // pixels of slack around the bbox
  const left = Math.max(0, Math.floor(Math.min(...xs.map(toCol))) - MARGIN);
  const right = Math.min(width, Math.ceil(Math.max(...xs.map(toCol))) + MARGIN);
  const top = Math.max(0, Math.floor(Math.min(...ys.map(toRow))) - MARGIN);
  const bottom = Math.min(height, Math.ceil(Math.max(...ys.map(toRow))) + MARGIN);
  console.log(`Reading window [${left}..${right}, ${top}..${bottom}] = ${right - left} x ${bottom - top} px`);

  const [win] = await image.readRasters({ window: [left, top, right, bottom] });
  const winW = right - left, winH = bottom - top;
  const winOriginX = originX + left * resX;
  const winOriginY = originY + top * resY;

  const sample = (x, y) => {
    const col = (x - winOriginX) / resX - 0.5;
    const row = (y - winOriginY) / resY - 0.5;
    const c0 = Math.floor(col), r0 = Math.floor(row);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= winW || r0 + 1 >= winH) return null;
    const at = (r, c) => { const v = win[r * winW + c]; return v === NODATA ? null : v; };
    const v00 = at(r0, c0), v01 = at(r0, c0 + 1), v10 = at(r0 + 1, c0), v11 = at(r0 + 1, c0 + 1);
    const all = [v00, v01, v10, v11];
    if (all.some((v) => v === null)) {
      const valid = all.filter((v) => v !== null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    }
    const dx = col - c0, dy = row - r0;
    return (v00 * (1 - dx) + v01 * dx) * (1 - dy) + (v10 * (1 - dx) + v11 * dx) * dy;
  };

  // Output grid sized from the requested spacing in metres.
  const latMid = (LAT_MIN + LAT_MAX) / 2;
  const latMeters = (LAT_MAX - LAT_MIN) * 111320;
  const lngMeters = (LNG_MAX - LNG_MIN) * 111320 * Math.cos(latMid * Math.PI / 180);
  const nLat = Math.max(2, Math.round(latMeters / OUT_SPACING_M) + 1);
  const nLng = Math.max(2, Math.round(lngMeters / OUT_SPACING_M) + 1);
  console.log(`Output grid: ${nLat} x ${nLng} (~${OUT_SPACING_M}m)`);

  const grid = [];
  let misses = 0;
  for (let i = 0; i < nLat; i++) {
    const lat = LAT_MIN + (LAT_MAX - LAT_MIN) * (i / (nLat - 1));
    const rowArr = [];
    for (let j = 0; j < nLng; j++) {
      const lng = LNG_MIN + (LNG_MAX - LNG_MIN) * (j / (nLng - 1));
      const [x, y] = toRaster.forward([lng, lat]);
      const v = sample(x, y);
      if (v === null) misses++;
      rowArr.push(v === null ? null : Math.round((v - GEOID_UNDULATION_M) * 10) / 10);
    }
    grid.push(rowArr);
  }
  if (misses > 0) throw new Error(`${misses} points fell on nodata/outside window`);

  const out = `// AUTO-GENERATED by scripts/fetchArcticDEM.mjs — do not edit by hand.
// Baked elevation grid (meters) for the Mosgolf course area.
// Source: ArcticDEM v4.1 2m mosaic (tile 14_52_2_1), ~${OUT_SPACING_M}m grid. Baked ${new Date().toISOString().split('T')[0]}.
export const elevationData = {
  latMin: ${LAT_MIN},
  latMax: ${LAT_MAX},
  lngMin: ${LNG_MIN},
  lngMax: ${LNG_MAX},
  nLat: ${nLat},
  nLng: ${nLng},
  grid: ${JSON.stringify(grid)},
};
`;
  const dir = dirname(fileURLToPath(import.meta.url));
  const target = join(dir, '..', 'src', 'elevationData.js');
  writeFileSync(target, out, 'utf8');
  console.log(`Wrote ${target} (${nLat} x ${nLng} grid)`);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
