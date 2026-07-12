type Basemap = "topo" | "satellite";

const warmedUrls = new Set<string>();
const MAX_WARMED = 2_500;
let lastPrefetchKey = "";

function lngLatToTile(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
    z: zoom,
  };
}

function tileUrls(
  lat: number,
  lng: number,
  zoom: number,
  basemap: Basemap,
): string[] {
  const demZoom = Math.min(zoom, 15);
  const dem = lngLatToTile(lat, lng, demZoom);
  const urls = [
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${dem.z}/${dem.x}/${dem.y}.png`,
  ];

  const base = lngLatToTile(lat, lng, zoom);
  if (basemap === "satellite") {
    urls.push(
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${base.z}/${base.y}/${base.x}`,
    );
  } else {
    const host = ["a", "b", "c"][(base.x + base.y) % 3];
    urls.push(
      `https://${host}.tile.opentopomap.org/${base.z}/${base.x}/${base.y}.png`,
    );
  }

  return urls;
}

function warmUrl(url: string) {
  if (warmedUrls.has(url)) return;
  if (warmedUrls.size >= MAX_WARMED) {
    const first = warmedUrls.values().next().value;
    if (first) warmedUrls.delete(first);
  }
  warmedUrls.add(url);

  // Warm browser HTTP cache; MapLibre will reuse the same tile URLs.
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = url;
}

function sampleRouteAhead(
  coordinates: [number, number][],
  progress: number,
  lookAhead: number,
  step: number,
) {
  const points: [number, number][] = [];
  for (let p = progress; p <= Math.min(1, progress + lookAhead); p += step) {
    const exactIndex = Math.max(
      0,
      Math.min(coordinates.length - 1, p * (coordinates.length - 1)),
    );
    const startIndex = Math.floor(exactIndex);
    const endIndex = Math.min(coordinates.length - 1, startIndex + 1);
    const fraction = exactIndex - startIndex;
    const start = coordinates[startIndex];
    const end = coordinates[endIndex];
    points.push([
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]);
  }
  return points;
}

/**
 * Prefetch DEM + basemap tiles ahead of the flight camera so high playback
 * speeds don't outrun MapLibre's on-demand tile loading.
 */
export function prefetchFlightTiles(
  coordinates: [number, number][],
  progress: number,
  playbackSpeed: number,
  basemap: Basemap,
  flightZoom: number,
) {
  if (coordinates.length < 2) return;

  // Faster flight → look further ahead and sample denser.
  const lookAhead = Math.min(0.4, 0.06 + playbackSpeed * 0.018);
  const step = Math.max(0.004, 0.012 - playbackSpeed * 0.0004);
  const key = `${Math.floor(progress * 200)}:${playbackSpeed}:${basemap}`;
  if (key === lastPrefetchKey) return;
  lastPrefetchKey = key;

  const zooms = [
    Math.max(12, Math.floor(flightZoom) - 2),
    Math.max(13, Math.floor(flightZoom) - 1),
    Math.floor(flightZoom),
  ];

  for (const [lat, lng] of sampleRouteAhead(
    coordinates,
    progress,
    lookAhead,
    step,
  )) {
    for (const zoom of zooms) {
      for (const url of tileUrls(lat, lng, zoom, basemap)) {
        warmUrl(url);
      }
    }
  }
}

/** Warm the start of a route as soon as it is selected. */
export function prefetchRouteStart(
  coordinates: [number, number][],
  basemap: Basemap,
  flightZoom: number,
) {
  lastPrefetchKey = "";
  prefetchFlightTiles(coordinates, 0, 8, basemap, flightZoom);
}
