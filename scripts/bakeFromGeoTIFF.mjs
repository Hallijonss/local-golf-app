// Crop + bake a high-resolution DEM GeoTIFF into src/elevationData.js.
//
// Use this when you have a downloaded high-res DEM (e.g. ISLandsDEM 2m
// bare-earth, or ArcticDEM 2m) and want far better accuracy than the global
// COP30 grid. The running app reads only the baked file — no network, no key.
//
// Usage:
//   node scripts/bakeFromGeoTIFF.mjs path/to/dem.tif
//   node scripts/bakeFromGeoTIFF.mjs                # defaults to scripts/dem.tif
//
// The input may be in any common Icelandic/European CRS (see CRS_DEFS); the
// script reprojects sample points into the raster's CRS automatically. The
// output is downsampled to OUT_SPACING_M metres so the bundle stays small.

import { fromFile } from 'geotiff';
import proj4 from 'proj4';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- Course bounding box (WGS84), matching the rest of the pipeline ---
const LAT_MIN = 64.1623;
const LAT_MAX = 64.1733;
const LNG_MIN = -21.7516;
const LNG_MAX = -21.7197;

const OUT_SPACING_M = 5; // output grid resolution in metres

// proj4 ships only EPSG:4326 and EPSG:3857. Define the CRSs Icelandic /
// European DEMs commonly use so we can reproject WGS84 -> raster CRS.
const CRS_DEFS = {
  3057: '+proj=lcc +lat_0=65 +lon_0=-19 +lat_1=64.25 +lat_2=65.75 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs', // ISN93 / Lambert 1993
  8088: '+proj=lcc +lat_0=65 +lon_0=-19 +lat_1=64.25 +lat_2=65.75 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs', // ISN2016 / Lambert 2016
  5325: '+proj=lcc +lat_0=65 +lon_0=-19 +lat_1=64.25 +lat_2=65.75 +x_0=500000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs', // ISN2004 / Lambert 2004
  3035: '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs', // ETRS89-LAEA
  32627: '+proj=utm +zone=27 +datum=WGS84 +units=m +no_defs',
  32628: '+proj=utm +zone=28 +datum=WGS84 +units=m +no_defs',
  4326: 'EPSG:4326',
  3857: 'EPSG:3857',
};

function detectEpsg(image) {
  const k = image.getGeoKeys();
  return k.ProjectedCSTypeGeoKey || k.ProjectedCRSGeoKey || k.GeographicTypeGeoKey || null;
}

async function main() {
  const dir = dirname(fileURLToPath(import.meta.url));
  const input = process.argv[2] || join(dir, 'dem.tif');
  console.log(`Reading ${input} ...`);

  const tiff = await fromFile(input);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution(); // resY is typically negative
  const nodata = image.getGDALNoData();
  const epsg = detectEpsg(image);

  console.log(`Raster: ${width} x ${height}, res ${resX} x ${resY}, EPSG:${epsg}, nodata=${nodata}`);

  // Set up WGS84 -> raster-CRS transform.
  let toRaster;
  if (epsg === 4326 || epsg === null) {
    toRaster = (lng, lat) => [lng, lat];
  } else {
    const def = CRS_DEFS[epsg];
    if (!def) throw new Error(`Unsupported EPSG:${epsg}. Add it to CRS_DEFS (or reproject the GeoTIFF to EPSG:4326 first).`);
    proj4.defs(`EPSG:${epsg}`, def);
    const fwd = proj4('EPSG:4326', `EPSG:${epsg}`);
    toRaster = (lng, lat) => fwd.forward([lng, lat]);
  }

  // Read the whole raster into memory (cropped tiles are small; a big tile is
  // still fine for one-off generation).
  const [raster] = await image.readRasters();

  const sampleRaster = (x, y) => {
    // Map projected x/y to fractional pixel (col, row), pixel-centre aligned.
    const col = (x - originX) / resX - 0.5;
    const row = (y - originY) / resY - 0.5;
    const c0 = Math.floor(col), r0 = Math.floor(row);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= width || r0 + 1 >= height) return null;
    const at = (r, c) => {
      const v = raster[r * width + c];
      return (nodata !== null && v === nodata) ? null : v;
    };
    const v00 = at(r0, c0), v01 = at(r0, c0 + 1), v10 = at(r0 + 1, c0), v11 = at(r0 + 1, c0 + 1);
    if ([v00, v01, v10, v11].some((v) => v === null)) {
      // fall back to nearest valid corner if any cell is nodata
      const valid = [v00, v01, v10, v11].filter((v) => v !== null);
      return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    }
    const dx = col - c0, dy = row - r0;
    const top = v00 * (1 - dx) + v01 * dx;
    const bot = v10 * (1 - dx) + v11 * dx;
    return top * (1 - dy) + bot * dy;
  };

  // Output grid dimensions from the requested spacing in metres.
  const latMid = (LAT_MIN + LAT_MAX) / 2;
  const latMeters = (LAT_MAX - LAT_MIN) * 111320;
  const lngMeters = (LNG_MAX - LNG_MIN) * 111320 * Math.cos(latMid * Math.PI / 180);
  const nLat = Math.max(2, Math.round(latMeters / OUT_SPACING_M) + 1);
  const nLng = Math.max(2, Math.round(lngMeters / OUT_SPACING_M) + 1);
  console.log(`Output grid: ${nLat} x ${nLng} (~${OUT_SPACING_M}m, area ${Math.round(lngMeters)}m x ${Math.round(latMeters)}m)`);

  const grid = [];
  let misses = 0;
  for (let i = 0; i < nLat; i++) {
    const lat = LAT_MIN + (LAT_MAX - LAT_MIN) * (i / (nLat - 1));
    const rowArr = [];
    for (let j = 0; j < nLng; j++) {
      const lng = LNG_MIN + (LNG_MAX - LNG_MIN) * (j / (nLng - 1));
      const [x, y] = toRaster(lng, lat);
      const v = sampleRaster(x, y);
      if (v === null) misses++;
      rowArr.push(v === null ? null : Math.round(v * 10) / 10);
    }
    grid.push(rowArr);
  }

  if (misses > 0) {
    const total = nLat * nLng;
    throw new Error(`${misses}/${total} output points fell outside the raster or on nodata. `
      + `The GeoTIFF likely doesn't fully cover the course bbox — check the download extent.`);
  }

  const out = `// AUTO-GENERATED by scripts/bakeFromGeoTIFF.mjs — do not edit by hand.
// Baked elevation grid (meters) for the Mosgolf course area.
// Source: high-resolution DEM GeoTIFF (EPSG:${epsg}), ~${OUT_SPACING_M}m grid. Baked ${new Date().toISOString().split('T')[0]}.
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

  const target = join(dir, '..', 'src', 'elevationData.js');
  writeFileSync(target, out, 'utf8');
  console.log(`Wrote ${target} (${nLat} x ${nLng} grid)`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
