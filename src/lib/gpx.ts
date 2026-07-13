import type { TrackPayload } from "@/app/api/activities/tracks/route";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60) || "track";
}

function pointTimes(track: TrackPayload): string[] {
  const count = track.coordinates.length;
  if (count === 0) return [];

  const startMs = new Date(track.startDate).getTime();
  const durationSec =
    track.elapsedTimeSeconds > 0
      ? track.elapsedTimeSeconds
      : track.movingTimeSeconds > 0
        ? track.movingTimeSeconds
        : Math.max(count - 1, 1) * 60;

  if (count === 1 || Number.isNaN(startMs)) {
    const fallback = Number.isNaN(startMs) ? Date.now() : startMs;
    return [new Date(fallback).toISOString()];
  }

  return track.coordinates.map((_, index) => {
    const progress = index / (count - 1);
    return new Date(startMs + progress * durationSec * 1000).toISOString();
  });
}

export function trackToGpx(track: TrackPayload): string {
  return tracksToGpx([track], track.name);
}

export function tracksToGpx(tracks: TrackPayload[], docName?: string): string {
  const name = escapeXml(docName ?? "Стежки");
  const metadataTime = tracks[0]
    ? new Date(tracks[0].startDate).toISOString()
    : new Date().toISOString();
  const body = tracks
    .map((track) => {
      const times = pointTimes(track);
      const points = track.coordinates
        .map(([lat, lng], index) => {
          const time = times[index];
          return `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">
        <time>${time}</time>
      </trkpt>`;
        })
        .join("\n");
      return `  <trk>
    <name>${escapeXml(track.name)}</name>
    <type>${escapeXml(track.sportType || track.type || "Hike")}</type>
    <trkseg>
${points}
    </trkseg>
  </trk>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Stezhky" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${metadataTime}</time>
  </metadata>
${body}
</gpx>
`;
}

export function downloadGpx(tracks: TrackPayload[], filenameBase: string) {
  if (tracks.length === 0) return;
  const gpx = tracksToGpx(
    tracks,
    tracks.length === 1 ? tracks[0].name : filenameBase,
  );
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
