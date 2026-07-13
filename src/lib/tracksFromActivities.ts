import polyline from "@mapbox/polyline";
import {
  athleteDisplayName,
  colorForTrackId,
} from "@/lib/athleteColors";
import type { TrackPayload } from "@/app/api/activities/tracks/route";

type ActivityRow = {
  id: string;
  userId: string;
  name: string;
  type: string;
  sportType: string | null;
  distance: number;
  movingTime: number;
  elapsedTime: number;
  totalElevation: number | null;
  startDate: Date;
  summaryPolyline: string | null;
  user: {
    id: string;
    firstname: string | null;
    lastname: string | null;
    username: string | null;
    profile: string | null;
  };
};

export function activitiesToTracks(activities: ActivityRow[]): TrackPayload[] {
  const tracks: TrackPayload[] = [];

  for (const activity of activities) {
    if (!activity.summaryPolyline) continue;
    try {
      const decoded = polyline.decode(activity.summaryPolyline) as [
        number,
        number,
      ][];
      if (decoded.length < 2) continue;

      tracks.push({
        id: activity.id,
        userId: activity.userId,
        athleteName: athleteDisplayName(activity.user),
        color: colorForTrackId(activity.id),
        name: activity.name,
        type: activity.type,
        sportType: activity.sportType,
        distanceKm: Math.round((activity.distance / 1000) * 100) / 100,
        movingTimeSeconds: activity.movingTime,
        elapsedTimeSeconds: activity.elapsedTime,
        elevationGainM: activity.totalElevation,
        startDate: activity.startDate.toISOString(),
        coordinates: decoded,
      });
    } catch {
      // пропускаємо биті polyline
    }
  }

  return tracks;
}
