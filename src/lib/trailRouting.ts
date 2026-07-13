export type TrailWaypoint = {
  lat: number;
  lon: number;
  time?: string | Date | null;
  ele?: number | null;
};

export type TrailRoutePoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: Date;
};

export type TrailRouteResult = {
  points: TrailRoutePoint[];
  provider: "valhalla-pedestrian" | "openrouteservice" | "osrm-foot" | "direct";
  distanceM: number;
};

type LatLon = { lat: number; lon: number };

const SNAP_RADIUS_M = 400;
const MAX_DETOUR_RATIO = 2.6;
const MAX_DETOUR_EXTRA_M = 700;

function haversineM(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function pathLengthM(coords: LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i += 1) {
    sum += haversineM(coords[i - 1], coords[i]);
  }
  return sum;
}

function isBadDetour(routedM: number, straightM: number): boolean {
  if (straightM < 40) return routedM > 200;
  return (
    routedM > straightM * MAX_DETOUR_RATIO &&
    routedM > straightM + MAX_DETOUR_EXTRA_M
  );
}

function densifyStraight(a: LatLon, b: LatLon, stepM = 35): LatLon[] {
  const dist = haversineM(a, b);
  if (dist < 1) return [{ lat: a.lat, lon: a.lon }];
  const steps = Math.max(1, Math.ceil(dist / stepM));
  const points: LatLon[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
    });
  }
  return points;
}

function dedupeWaypoints(waypoints: TrailWaypoint[]): TrailWaypoint[] {
  if (waypoints.length === 0) return [];
  const result: TrailWaypoint[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i += 1) {
    const prev = result[result.length - 1];
    const next = waypoints[i];
    const near = haversineM(prev, next) < 12;
    const prevMs = asDate(prev.time)?.getTime();
    const nextMs = asDate(next.time)?.getTime();
    const dt =
      prevMs != null && nextMs != null ? Math.abs(nextMs - prevMs) : Number.POSITIVE_INFINITY;
    // Same spot within a few minutes → one point. Overnight at same camp → keep both days.
    if (near && dt < 3 * 60 * 1000) {
      result[result.length - 1] = {
        ...prev,
        time: next.time ?? prev.time,
        ele: next.ele ?? prev.ele,
      };
      continue;
    }
    result.push(next);
  }
  return result;
}

/** Valhalla / Google encoded polyline (precision 6). */
function decodePolyline6(encoded: string): LatLon[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: LatLon[] = [];
  const factor = 1e6;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push({ lat: lat / factor, lon: lng / factor });
  }

  return coordinates;
}

const PEDESTRIAN_COSTING = {
  use_roads: 0.05,
  use_tracks: 1,
  use_hills: 0.35,
  use_living_streets: 0.4,
  use_ferry: 0.3,
  walkway_factor: 0.55,
  sidewalk_factor: 0.75,
  alley_factor: 1.6,
  driveway_factor: 8,
  step_penalty: 0,
  max_hiking_difficulty: 6,
  walking_speed: 4.5,
} as const;

async function routeWithValhalla(
  waypoints: TrailWaypoint[],
): Promise<{ coords: LatLon[]; distanceM: number }> {
  const response = await fetch("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Stezhky/1.0 (hiking photo GPX; pedestrian trails)",
    },
    body: JSON.stringify({
      locations: waypoints.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        type: "break",
        radius: SNAP_RADIUS_M,
      })),
      costing: "pedestrian",
      costing_options: {
        pedestrian: PEDESTRIAN_COSTING,
      },
      shape_format: "polyline6",
      directions_options: { units: "kilometers" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Valhalla ${response.status}`);
  }

  const data = (await response.json()) as {
    trip?: {
      status?: number;
      status_message?: string;
      summary?: { length?: number };
      legs?: Array<{ shape?: string; summary?: { length?: number } }>;
    };
    error?: string;
  };

  if (!data.trip || data.trip.status !== 0 || !data.trip.legs?.length) {
    throw new Error(data.trip?.status_message || data.error || "Valhalla empty");
  }

  const coords: LatLon[] = [];
  for (const leg of data.trip.legs) {
    if (!leg.shape) continue;
    const decoded = decodePolyline6(leg.shape);
    if (coords.length === 0) coords.push(...decoded);
    else coords.push(...decoded.slice(1));
  }

  if (coords.length < 2) {
    throw new Error("Valhalla: порожня геометрія");
  }

  const distanceM =
    typeof data.trip.summary?.length === "number"
      ? data.trip.summary.length * 1000
      : pathLengthM(coords);
  const straightM = pathLengthM(waypoints);
  if (isBadDetour(distanceM, straightM)) {
    throw new Error("Valhalla detour too large");
  }

  // Anchor exact photo coordinates.
  return {
    coords: [
      { lat: waypoints[0].lat, lon: waypoints[0].lon },
      ...coords,
      {
        lat: waypoints[waypoints.length - 1].lat,
        lon: waypoints[waypoints.length - 1].lon,
      },
    ],
    distanceM,
  };
}

async function routeSegmentValhalla(a: LatLon, b: LatLon): Promise<LatLon[] | null> {
  try {
    const routed = await routeWithValhalla([
      { lat: a.lat, lon: a.lon },
      { lat: b.lat, lon: b.lon },
    ]);
    return routed.coords;
  } catch {
    return null;
  }
}

async function routeWithOpenRouteService(
  waypoints: TrailWaypoint[],
  apiKey: string,
): Promise<{ coords: LatLon[]; distanceM: number }> {
  const response = await fetch(
    "https://api.openrouteservice.org/v2/directions/foot-hiking/geojson",
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        coordinates: waypoints.map((point) => [point.lon, point.lat]),
        elevation: true,
        instructions: false,
        preference: "recommended",
        radiuses: waypoints.map(() => SNAP_RADIUS_M),
        options: {
          avoid_features: ["ferries"],
          profile_params: {
            weightings: {
              green: 1,
              steepless: 0.2,
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouteService: ${response.status} ${text.slice(0, 180)}`);
  }

  const data = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: number[][] };
      properties?: { summary?: { distance?: number } };
    }>;
  };

  const feature = data.features?.[0];
  const raw = feature?.geometry?.coordinates ?? [];
  if (raw.length < 2) {
    throw new Error("OpenRouteService не повернув маршрут");
  }

  const coords = raw.map((coordinate) => ({
    lon: coordinate[0],
    lat: coordinate[1],
  }));
  const distanceM = feature?.properties?.summary?.distance ?? pathLengthM(coords);
  if (isBadDetour(distanceM, pathLengthM(waypoints))) {
    throw new Error("ORS detour too large");
  }

  return { coords, distanceM };
}

async function routeSegmentOsrm(a: LatLon, b: LatLon): Promise<LatLon[] | null> {
  const path = `${a.lon},${a.lat};${b.lon},${b.lat}`;
  const url =
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${path}` +
    `?overview=full&geometries=geojson&steps=false` +
    `&radiuses=${SNAP_RADIUS_M};${SNAP_RADIUS_M}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Stezhky/1.0 (hiking photo GPX; pedestrian)",
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      geometry?: { coordinates?: number[][] };
    }>;
  };
  if (data.code !== "Ok" || !data.routes?.[0]?.geometry?.coordinates?.length) {
    return null;
  }

  const routedM = data.routes[0].distance ?? 0;
  if (isBadDetour(routedM, haversineM(a, b))) return null;

  return data.routes[0].geometry.coordinates.map((coordinate) => ({
    lon: coordinate[0],
    lat: coordinate[1],
  }));
}

async function routePairwise(
  waypoints: TrailWaypoint[],
): Promise<{ coords: LatLon[]; distanceM: number; provider: TrailRouteResult["provider"] }> {
  const coords: LatLon[] = [];
  let distanceM = 0;
  let valhallaSegments = 0;
  let osrmSegments = 0;
  let directSegments = 0;

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const a = waypoints[i];
    const b = waypoints[i + 1];

    let segment = await routeSegmentValhalla(a, b);
    let source: "valhalla" | "osrm" | "direct" = "valhalla";

    if (!segment || segment.length < 2) {
      segment = await routeSegmentOsrm(a, b);
      source = "osrm";
    }
    if (!segment || segment.length < 2) {
      segment = densifyStraight(a, b);
      source = "direct";
    }

    if (source === "valhalla") valhallaSegments += 1;
    else if (source === "osrm") osrmSegments += 1;
    else directSegments += 1;

    const anchored = [
      { lat: a.lat, lon: a.lon },
      ...segment,
      { lat: b.lat, lon: b.lon },
    ];
    distanceM += pathLengthM(anchored);
    if (coords.length === 0) coords.push(...anchored);
    else coords.push(...anchored.slice(1));
  }

  if (coords.length < 2) {
    throw new Error("Не вдалося побудувати піший маршрут між фото");
  }

  const provider: TrailRouteResult["provider"] =
    valhallaSegments >= osrmSegments && valhallaSegments >= directSegments
      ? "valhalla-pedestrian"
      : osrmSegments >= directSegments
        ? "osrm-foot"
        : "direct";

  return { coords, distanceM, provider };
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function interpolateTimes(
  coords: LatLon[],
  waypoints: TrailWaypoint[],
): TrailRoutePoint[] {
  if (coords.length === 0) return [];

  // Waypoint times must be real photo capture times (already sorted by time).
  const waypointTimes = waypoints.map((point, index) => {
    const explicit = asDate(point.time ?? null);
    if (!explicit) {
      throw new Error(
        `Немає часу зйомки для точки ${index + 1}. GPX будується лише з часу й локації фото.`,
      );
    }
    return explicit;
  });

  // Bind each photo to the nearest point along the trail, moving only forward.
  const snapIndices: number[] = [];
  let searchFrom = 0;
  for (let w = 0; w < waypoints.length; w += 1) {
    const waypoint = waypoints[w];
    let bestIdx = searchFrom;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = searchFrom; i < coords.length; i += 1) {
      const dist = haversineM(waypoint, coords[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    snapIndices.push(bestIdx);
    searchFrom = bestIdx;
  }
  snapIndices[0] = 0;
  snapIndices[snapIndices.length - 1] = coords.length - 1;

  // Force exact photo coordinates + capture times onto the track.
  const merged: LatLon[] = [];
  const timesMs: number[] = [];
  let coordCursor = 0;

  for (let w = 0; w < waypoints.length; w += 1) {
    const snap = snapIndices[w];
    const nextSnap =
      w < waypoints.length - 1 ? snapIndices[w + 1] : coords.length - 1;

    if (w === 0) {
      merged.push({ lat: waypoints[w].lat, lon: waypoints[w].lon });
      timesMs.push(waypointTimes[w].getTime());
      coordCursor = Math.max(snap, 0);
    }

    // Trail points between this photo and the next, timed by capture times.
    if (w < waypoints.length - 1) {
      const segmentCoords: LatLon[] = [
        { lat: waypoints[w].lat, lon: waypoints[w].lon },
      ];
      for (let i = coordCursor + 1; i < nextSnap; i += 1) {
        segmentCoords.push(coords[i]);
      }
      segmentCoords.push({
        lat: waypoints[w + 1].lat,
        lon: waypoints[w + 1].lon,
      });

      const t0 = waypointTimes[w].getTime();
      const t1 = waypointTimes[w + 1].getTime();
      const segDist = [0];
      for (let i = 1; i < segmentCoords.length; i += 1) {
        segDist.push(
          segDist[i - 1] + haversineM(segmentCoords[i - 1], segmentCoords[i]),
        );
      }
      const total = segDist[segDist.length - 1] || 1;

      // Skip index 0 — already added as current photo.
      for (let i = 1; i < segmentCoords.length; i += 1) {
        const progress = segDist[i] / total;
        merged.push(segmentCoords[i]);
        timesMs.push(t0 + (t1 - t0) * progress);
      }
      coordCursor = nextSnap;
    }
  }

  return merged.map((coordinate, index) => {
    const nearestWaypoint = waypoints.reduce(
      (best, point) => {
        const dist = haversineM(point, coordinate);
        return dist < best.dist ? { dist, point } : best;
      },
      { dist: Number.POSITIVE_INFINITY, point: waypoints[0] },
    );

    return {
      lat: coordinate.lat,
      lon: coordinate.lon,
      ele: nearestWaypoint.dist < 30 ? (nearestWaypoint.point.ele ?? null) : null,
      time: new Date(timesMs[index]),
    };
  });
}

export async function routeAlongTrails(
  inputWaypoints: TrailWaypoint[],
): Promise<TrailRouteResult> {
  const byTime = [...inputWaypoints].sort((a, b) => {
    const ta = asDate(a.time)?.getTime() ?? 0;
    const tb = asDate(b.time)?.getTime() ?? 0;
    return ta - tb;
  });
  const waypoints = dedupeWaypoints(byTime);

  if (waypoints.length === 0) {
    return { points: [], provider: "direct", distanceM: 0 };
  }
  if (waypoints.length === 1) {
    const time = asDate(waypoints[0].time ?? null) ?? new Date();
    return {
      points: [
        {
          lat: waypoints[0].lat,
          lon: waypoints[0].lon,
          ele: waypoints[0].ele ?? null,
          time,
        },
      ],
      provider: "direct",
      distanceM: 0,
    };
  }

  const orsKey = process.env.OPENROUTESERVICE_API_KEY?.trim();
  if (orsKey) {
    try {
      const routed = await routeWithOpenRouteService(waypoints, orsKey);
      return {
        points: interpolateTimes(routed.coords, waypoints),
        provider: "openrouteservice",
        distanceM: routed.distanceM,
      };
    } catch {
      // fall through to pedestrian Valhalla
    }
  }

  // Prefer one-shot Valhalla pedestrian (avoids roads, likes tracks/paths).
  try {
    const routed = await routeWithValhalla(waypoints);
    return {
      points: interpolateTimes(routed.coords, waypoints),
      provider: "valhalla-pedestrian",
      distanceM: routed.distanceM,
    };
  } catch {
    const routed = await routePairwise(waypoints);
    return {
      points: interpolateTimes(routed.coords, waypoints),
      provider: routed.provider,
      distanceM: routed.distanceM,
    };
  }
}
