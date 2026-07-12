import polyline from "@mapbox/polyline";
import { NextResponse } from "next/server";
import {
  athleteDisplayName,
  colorForAthleteId,
} from "@/lib/athleteColors";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export type AthletePayload = {
  id: string;
  name: string;
  profile: string | null;
  color: string;
  trackCount: number;
  isMe: boolean;
};

export type TrackPayload = {
  id: string;
  userId: string;
  athleteName: string;
  color: string;
  name: string;
  type: string;
  sportType: string | null;
  distanceKm: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  elevationGainM: number | null;
  startDate: string;
  coordinates: [number, number][];
};

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }

  const activities = await prisma.activity.findMany({
    where: {
      summaryPolyline: { not: null },
      OR: [{ type: "Hike" }, { sportType: "Hike" }],
    },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      userId: true,
      name: true,
      type: true,
      sportType: true,
      distance: true,
      movingTime: true,
      elapsedTime: true,
      totalElevation: true,
      startDate: true,
      summaryPolyline: true,
      user: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          username: true,
          profile: true,
        },
      },
    },
  });

  const tracks: TrackPayload[] = [];
  const athleteStats = new Map<
    string,
    {
      id: string;
      name: string;
      profile: string | null;
      color: string;
      trackCount: number;
    }
  >();

  for (const activity of activities) {
    if (!activity.summaryPolyline) continue;
    try {
      const decoded = polyline.decode(activity.summaryPolyline) as [
        number,
        number,
      ][];
      if (decoded.length < 2) continue;

      const color = colorForAthleteId(activity.userId);
      const athleteName = athleteDisplayName(activity.user);

      tracks.push({
        id: activity.id,
        userId: activity.userId,
        athleteName,
        color,
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

      const existing = athleteStats.get(activity.userId);
      if (existing) {
        existing.trackCount += 1;
      } else {
        athleteStats.set(activity.userId, {
          id: activity.user.id,
          name: athleteName,
          profile: activity.user.profile,
          color,
          trackCount: 1,
        });
      }
    } catch {
      // пропускаємо биті polyline
    }
  }

  const athletes: AthletePayload[] = [...athleteStats.values()]
    .map((athlete) => ({
      ...athlete,
      isMe: athlete.id === session.userId,
    }))
    .sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      return a.name.localeCompare(b.name, "uk");
    });

  return NextResponse.json({ athletes, tracks });
}
