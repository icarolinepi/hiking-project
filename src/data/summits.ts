import catalog from "./carpathian-summits.json";

export type Summit = {
  id: string;
  name: string;
  elevationM: number;
  /** [latitude, longitude] — same order as Strava polylines */
  coordinate: [number, number];
};

type SummitJson = {
  id: string;
  name: string;
  elevationM: number;
  coordinate: [number, number];
};

/** Вершини Українських Карпат з OpenStreetMap (Overpass). */
export const CARPATHIAN_SUMMITS: Summit[] = (catalog as SummitJson[]).map(
  (summit) => ({
    id: summit.id,
    name: summit.name,
    elevationM: summit.elevationM,
    coordinate: summit.coordinate,
  }),
);

const EARTH_RADIUS_M = 6_371_000;
const SUMMIT_RADIUS_M = 200;
/** ~1.1 km cells — enough to bucket nearby peaks for the summit radius. */
const GRID_DEG = 0.01;

function haversineMeters(
  [lat1, lng1]: [number, number],
  [lat2, lng2]: [number, number],
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function cellKey(lat: number, lng: number) {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lng / GRID_DEG)}`;
}

const summitGrid = new Map<string, Summit[]>();
for (const summit of CARPATHIAN_SUMMITS) {
  const key = cellKey(summit.coordinate[0], summit.coordinate[1]);
  const bucket = summitGrid.get(key);
  if (bucket) bucket.push(summit);
  else summitGrid.set(key, [summit]);
}

function nearbySummits([lat, lng]: [number, number]): Summit[] {
  const i0 = Math.floor(lat / GRID_DEG);
  const j0 = Math.floor(lng / GRID_DEG);
  const out: Summit[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const bucket = summitGrid.get(`${i0 + di}:${j0 + dj}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

export function findConqueredSummits(
  coordinates: [number, number][],
  radiusM = SUMMIT_RADIUS_M,
): Summit[] {
  if (coordinates.length === 0) return [];

  const byId = new Map<string, Summit>();
  for (const point of coordinates) {
    for (const summit of nearbySummits(point)) {
      if (byId.has(summit.id)) continue;
      if (haversineMeters(point, summit.coordinate) <= radiusM) {
        byId.set(summit.id, summit);
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.elevationM - a.elevationM);
}

export function findAllConqueredSummits(
  tracks: { coordinates: [number, number][] }[],
  radiusM = SUMMIT_RADIUS_M,
): Summit[] {
  const byId = new Map<string, Summit>();
  for (const track of tracks) {
    for (const summit of findConqueredSummits(track.coordinates, radiusM)) {
      byId.set(summit.id, summit);
    }
  }
  return [...byId.values()].sort((a, b) => b.elevationM - a.elevationM);
}

/** Скільки різних маршрутів «взяли» вершину (1 трек = максимум 1 зарахування). */
export function countSummitVisits(
  tracks: { coordinates: [number, number][] }[],
  radiusM = SUMMIT_RADIUS_M,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    for (const summit of findConqueredSummits(track.coordinates, radiusM)) {
      counts.set(summit.id, (counts.get(summit.id) ?? 0) + 1);
    }
  }
  return counts;
}

export function formatSummitList(summits: Summit[], limit = 4): string {
  if (summits.length === 0) return "";
  const names = summits.slice(0, limit).map((s) => s.name);
  const rest = summits.length - names.length;
  return rest > 0 ? `${names.join(" · ")} · +${rest}` : names.join(" · ");
}

export function formatVisitCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} раз`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} рази`;
  }
  return `${count} разів`;
}
