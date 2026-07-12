import { NextResponse } from "next/server";
import {
  athleteDisplayName,
  colorForAthleteId,
} from "@/lib/athleteColors";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { activitiesToTracks } from "@/lib/tracksFromActivities";

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

  const tracks = activitiesToTracks(activities);
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

  for (const track of tracks) {
    const existing = athleteStats.get(track.userId);
    if (existing) {
      existing.trackCount += 1;
      continue;
    }
    const activity = activities.find((row) => row.userId === track.userId);
    if (!activity) continue;
    athleteStats.set(track.userId, {
      id: activity.user.id,
      name: athleteDisplayName(activity.user),
      profile: activity.user.profile,
      color: colorForAthleteId(track.userId),
      trackCount: 1,
    });
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
