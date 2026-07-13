import exifr from "exifr";

export type PhotoTrackPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time: Date;
  name: string;
};

export type PhotosToGpxResult = {
  points: PhotoTrackPoint[];
  skipped: number;
  skippedNoGps: number;
  skippedNoTime: number;
  skippedError: number;
  gpx: string;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "photos"
  );
}

type CivilTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseOffsetMinutes(offset: unknown): number | null {
  if (typeof offset !== "string") return null;
  const match = offset.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function parseCivilTime(value: unknown): CivilTime | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Avoid using Date getters — they depend on the runtime timezone.
    // Prefer string fields from EXIF instead.
    return null;
  }
  if (typeof value !== "string" || !value.trim()) return null;

  const raw = value.trim();
  const exif = raw.match(
    /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?/,
  );
  if (!exif) return null;

  return {
    year: Number(exif[1]),
    month: Number(exif[2]),
    day: Number(exif[3]),
    hour: Number(exif[4] ?? "0"),
    minute: Number(exif[5] ?? "0"),
    second: Number(exif[6] ?? "0"),
  };
}

function getTimeZoneParts(utcMs: number, timeZone: string): CivilTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** Interpret camera civil time as Europe/Kyiv (Carpathians), DST-safe. */
function civilTimeInKyivToUtc(civil: CivilTime): Date {
  const wanted = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  let utc = wanted;
  for (let i = 0; i < 4; i += 1) {
    const seen = getTimeZoneParts(utc, "Europe/Kyiv");
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second,
    );
    utc += wanted - seenAsUtc;
  }
  return new Date(utc);
}

function civilTimeWithOffsetToUtc(
  civil: CivilTime,
  offsetMinutes: number,
): Date {
  return new Date(
    Date.UTC(
      civil.year,
      civil.month - 1,
      civil.day,
      civil.hour,
      civil.minute,
      civil.second,
    ) -
      offsetMinutes * 60_000,
  );
}

function gpsTimeToHms(value: unknown): [number, number, number] | null {
  if (Array.isArray(value) && value.length >= 3) {
    const hour = Number(value[0]);
    const minute = Number(value[1]);
    const second = Number(value[2]);
    if ([hour, minute, second].every((part) => Number.isFinite(part))) {
      return [hour, minute, second];
    }
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (match) {
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }
  }
  return null;
}

function readGpsDateTime(data: Record<string, unknown>): Date | null {
  const dateStamp = data.GPSDateStamp;
  if (typeof dateStamp !== "string") return null;
  const dateMatch = dateStamp.trim().match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!dateMatch) return null;

  const hms = gpsTimeToHms(data.GPSTimeStamp);
  if (!hms) return null;

  return new Date(
    Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      hms[0],
      hms[1],
      Math.floor(hms[2]),
    ),
  );
}

function readCoords(data: Record<string, unknown> | null | undefined): {
  lat: number;
  lon: number;
  ele: number | null;
} | null {
  if (!data) return null;

  const lat =
    typeof data.latitude === "number"
      ? data.latitude
      : typeof data.GPSLatitude === "number"
        ? data.GPSLatitude
        : null;
  const lon =
    typeof data.longitude === "number"
      ? data.longitude
      : typeof data.GPSLongitude === "number"
        ? data.GPSLongitude
        : null;

  if (lat == null || lon == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const eleRaw = data.GPSAltitude ?? data.altitude;
  const ele =
    typeof eleRaw === "number" && Number.isFinite(eleRaw) ? eleRaw : null;

  return { lat, lon, ele };
}

function readExifCaptureInstant(
  data: Record<string, unknown>,
  field: string,
): Date | null {
  const civil = parseCivilTime(data[field]);
  if (!civil) return null;
  // Date-only tags are useless for a multi-hour track.
  if (
    civil.hour === 0 &&
    civil.minute === 0 &&
    civil.second === 0 &&
    typeof data[field] === "string" &&
    !/\d{2}:\d{2}:\d{2}/.test(data[field])
  ) {
    return null;
  }

  const offset =
    parseOffsetMinutes(data.OffsetTimeOriginal) ??
    parseOffsetMinutes(data.OffsetTimeDigitized) ??
    parseOffsetMinutes(data.OffsetTime);

  if (offset != null) {
    return civilTimeWithOffsetToUtc(civil, offset);
  }

  return civilTimeInKyivToUtc(civil);
}

/**
 * Capture time from the camera clock only (never GPS timestamp — it is often
 * clustered and breaks duration for Strava).
 */
function readCaptureTime(
  data: Record<string, unknown> | null | undefined,
): Date | null {
  if (!data) return null;

  for (const field of [
    "DateTimeOriginal",
    "DateTimeDigitized",
    "CreateDate",
    "DateTime",
    "CreationDate",
  ]) {
    const instant = readExifCaptureInstant(data, field);
    if (instant) return instant;
  }

  // Last resort: revived Date objects from exifr (browser local interpretation).
  for (const field of ["DateTimeOriginal", "DateTimeDigitized", "CreateDate"]) {
    const value = data[field];
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
  }

  return null;
}

async function parsePhotoMeta(file: File): Promise<Record<string, unknown> | null> {
  const options = {
    gps: true,
    exif: true,
    xmp: true,
    iptc: false,
    icc: false,
    jfif: false,
    ihdr: false,
    translateKeys: true,
    translateValues: true,
    sanitize: true,
    mergeOutput: true,
    multiSegment: true,
  } as const;

  // Prefer raw EXIF strings so we control timezone (Europe/Kyiv).
  const raw = await exifr.parse(file, { ...options, reviveValues: false });
  if (raw && typeof raw === "object") {
    return raw as Record<string, unknown>;
  }

  const revived = await exifr.parse(file, { ...options, reviveValues: true });
  if (revived && typeof revived === "object") {
    return revived as Record<string, unknown>;
  }

  try {
    const gps = await exifr.gps(file);
    if (gps && typeof gps === "object") {
      return gps as unknown as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  return null;
}

type PointResult =
  | { ok: true; point: PhotoTrackPoint }
  | { ok: false; reason: "no-gps" | "no-time" | "error" };

async function pointFromPhoto(file: File): Promise<PointResult> {
  try {
    const data = await parsePhotoMeta(file);
    const coords = readCoords(data);
    if (!coords) return { ok: false, reason: "no-gps" };

    const time = readCaptureTime(data);
    if (!time) return { ok: false, reason: "no-time" };

    return {
      ok: true,
      point: {
        lat: coords.lat,
        lon: coords.lon,
        ele: coords.ele,
        time,
        name: file.name,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export function photoPointsToGpx(
  points: PhotoTrackPoint[],
  trackName = "Маршрут з фото",
): string {
  const sorted = [...points].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
  return writeGpxTrack(sorted, trackName);
}

export async function extractPhotoPoints(
  files: File[],
): Promise<Omit<PhotosToGpxResult, "gpx"> & { points: PhotoTrackPoint[] }> {
  const points: PhotoTrackPoint[] = [];
  let skippedNoGps = 0;
  let skippedNoTime = 0;
  let skippedError = 0;

  for (const file of files) {
    const result = await pointFromPhoto(file);
    if (result.ok) {
      points.push(result.point);
      continue;
    }
    if (result.reason === "no-gps") skippedNoGps += 1;
    else if (result.reason === "no-time") skippedNoTime += 1;
    else skippedError += 1;
  }

  const sorted = [...points].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );

  return {
    points: sorted,
    skipped: skippedNoGps + skippedNoTime + skippedError,
    skippedNoGps,
    skippedNoTime,
    skippedError,
  };
}

export async function photosToGpx(
  files: File[],
  trackName = "Маршрут з фото",
): Promise<PhotosToGpxResult> {
  const extracted = await extractPhotoPoints(files);
  return {
    ...extracted,
    gpx: photoPointsToGpx(extracted.points, trackName),
  };
}

/**
 * Write a routed track in path order (do NOT re-sort by time — that breaks
 * geometry and confuses Strava moving-time).
 */
export function routedPointsToGpx(
  points: Array<{
    lat: number;
    lon: number;
    ele?: number | null;
    time: string | Date;
    name?: string;
  }>,
  trackName = "Маршрут з фото",
): string {
  const track = collapseNearDuplicates(
    points.map((point, index) => ({
      lat: point.lat,
      lon: point.lon,
      ele: point.ele ?? null,
      time: point.time instanceof Date ? point.time : new Date(point.time),
      name: point.name ?? `pt-${index + 1}`,
    })),
  );
  return writeGpxTrack(track, trackName);
}

/** Force elapsed time to exactly first photo → last photo along the path. */
export function restampTrackToPhotoWindow(
  track: Array<{
    lat: number;
    lon: number;
    ele?: number | null;
    time: string | Date;
  }>,
  firstPhotoTime: Date,
  lastPhotoTime: Date,
): Array<{ lat: number; lon: number; ele: number | null; time: Date }> {
  if (track.length === 0) return [];
  if (track.length === 1) {
    return [
      {
        lat: track[0].lat,
        lon: track[0].lon,
        ele: track[0].ele ?? null,
        time: firstPhotoTime,
      },
    ];
  }

  const distances = [0];
  for (let i = 1; i < track.length; i += 1) {
    distances.push(
      distances[i - 1] + haversineMeters(track[i - 1], track[i]),
    );
  }
  const total = distances[distances.length - 1] || 1;
  const t0 = firstPhotoTime.getTime();
  const t1 = Math.max(lastPhotoTime.getTime(), t0 + 60_000);

  return track.map((point, index) => ({
    lat: point.lat,
    lon: point.lon,
    ele: point.ele ?? null,
    time: new Date(t0 + ((t1 - t0) * distances[index]) / total),
  }));
}

export function formatPhotoTimeRange(start: Date, end: Date): string {
  const fmt = (date: Date) =>
    date.toLocaleTimeString("uk-UA", {
      timeZone: "Europe/Kyiv",
      hour: "2-digit",
      minute: "2-digit",
    });
  const minutes = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const duration =
    hours > 0 ? `${hours}г ${String(mins).padStart(2, "0")}хв` : `${mins} хв`;
  return `${fmt(start)}→${fmt(end)} (${duration})`;
}

function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
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

function collapseNearDuplicates(points: PhotoTrackPoint[]): PhotoTrackPoint[] {
  if (points.length === 0) return [];
  const result: PhotoTrackPoint[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = result[result.length - 1];
    const cur = points[i];
    if (haversineMeters(prev, cur) < 3) {
      result[result.length - 1] = { ...cur };
      continue;
    }
    result.push(cur);
  }
  return result;
}

function writeGpxTrack(points: PhotoTrackPoint[], trackName: string): string {
  const metadataTime = points[0]?.time.toISOString() ?? new Date().toISOString();
  const body = points
    .map((point) => {
      const elev =
        point.ele == null
          ? ""
          : `\n        <ele>${point.ele.toFixed(1)}</ele>`;
      return `      <trkpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}">${elev}
        <time>${point.time.toISOString()}</time>
      </trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Stezhky" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(trackName)}</name>
    <time>${metadataTime}</time>
  </metadata>
  <trk>
    <name>${escapeXml(trackName)}</name>
    <type>Hike</type>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`;
}

export function emptyPhotosGpxMessage(
  result: Pick<PhotosToGpxResult, "skippedNoGps" | "skippedNoTime">,
): string {
  if (result.skippedNoGps > 0) {
    return (
      "У вибраних файлах немає GPS-координат. На iPhone локація в «Фото» часто є, " +
      "але Safari її зрізає при виборі. Збережи знімки в «Файли» (Поділитися → Зберегти у Файли) " +
      "і обери вже звідти, або відкрий Стежки на комп’ютері й вибери оригінали з диска."
    );
  }
  if (result.skippedNoTime > 0) {
    return (
      "У фото є GPS, але немає часу зйомки (DateTimeOriginal). " +
      "На iPhone після «Зберегти у Файли» час інколи губиться — спробуй оригінали з Mac/iCloud Drive."
    );
  }
  return "Не вдалося прочитати метадані фото.";
}

export function downloadPhotoGpx(gpx: string, filenameBase: string) {
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `${slugify(filenameBase)}-${stamp}.gpx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
