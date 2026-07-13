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

export function trackToGpx(track: TrackPayload): string {
  return tracksToGpx([track], track.name);
}

export function tracksToGpx(tracks: TrackPayload[], docName?: string): string {
  const name = escapeXml(docName ?? "Стежки");
  const body = tracks
    .map((track) => {
      const points = track.coordinates
        .map(
          ([lat, lng]) =>
            `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`,
        )
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
