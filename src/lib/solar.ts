import * as SunCalc from "suncalc";
import type { TrackPayload } from "@/app/api/activities/tracks/route";

export type SolarEvent = {
  type: "sunrise" | "sunset";
  label: string;
  time: Date;
  coordinate: [number, number] | null;
};

export function getSolarEvents(track: TrackPayload): SolarEvent[] {
  const first = track.coordinates[0];
  if (!first) return [];

  const start = new Date(track.startDate);
  const end = new Date(start.getTime() + track.elapsedTimeSeconds * 1000);
  const times = SunCalc.getTimes(start, first[0], first[1]);

  const events: SolarEvent[] = [];
  if (times.sunrise) {
    events.push(
      createEvent("sunrise", "Світанок", times.sunrise, start, end, track),
    );
  }
  if (times.sunset) {
    events.push(
      createEvent("sunset", "Захід", times.sunset, start, end, track),
    );
  }
  return events;
}

export function formatSolarTime(date: Date) {
  return date.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  });
}

function createEvent(
  type: SolarEvent["type"],
  label: string,
  time: Date,
  start: Date,
  end: Date,
  track: TrackPayload,
): SolarEvent {
  const happensDuringActivity = time >= start && time <= end;
  const progress = happensDuringActivity
    ? (time.getTime() - start.getTime()) /
      Math.max(1, end.getTime() - start.getTime())
    : null;

  return {
    type,
    label,
    time,
    coordinate:
      progress === null
        ? null
        : coordinateAtProgress(track.coordinates, progress),
  };
}

function coordinateAtProgress(
  coordinates: [number, number][],
  progress: number,
) {
  const index = Math.min(
    coordinates.length - 1,
    Math.max(0, Math.round(progress * (coordinates.length - 1))),
  );
  return coordinates[index] ?? null;
}
