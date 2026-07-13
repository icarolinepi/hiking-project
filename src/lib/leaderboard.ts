import {
  athleteDisplayName,
  colorForAthleteId,
} from "@/lib/athleteColors";
import { isCoordinateInCarpathians } from "@/data/carpathians";
import {
  countSummitVisits,
  findAllConqueredSummits,
} from "@/data/summits";
import { prisma } from "@/lib/prisma";
import { activitiesToTracks } from "@/lib/tracksFromActivities";

export type LeaderboardRow = {
  id: string;
  name: string;
  profile: string | null;
  color: string;
  isMe: boolean;
  distanceKm: number;
  routes: number;
  summits: number;
  elevationM: number;
};

export type PersonalSummitStats = {
  conqueredIds: string[];
  /** id вершини → скільки маршрутів її взяли */
  visitCounts: Record<string, number>;
  conqueredCount: number;
  repeatCount: number;
  catalogCount: number;
  highest: { id: string; name: string; elevationM: number } | null;
  distanceKm: number;
  routes: number;
};

const activitySelect = {
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
} as const;

export async function loadHikeActivities(userId?: string) {
  return prisma.activity.findMany({
    where: {
      summaryPolyline: { not: null },
      OR: [{ type: "Hike" }, { sportType: "Hike" }],
      ...(userId ? { userId } : {}),
    },
    orderBy: { startDate: "desc" },
    select: activitySelect,
  });
}

function carpathianTracksFromActivities(
  activities: Awaited<ReturnType<typeof loadHikeActivities>>,
) {
  return activitiesToTracks(activities).filter((track) =>
    track.coordinates.some(isCoordinateInCarpathians),
  );
}

export async function buildLeaderboard(
  viewerId: string,
): Promise<LeaderboardRow[]> {
  const activities = await loadHikeActivities();
  const tracks = carpathianTracksFromActivities(activities);

  const byUser = new Map<
    string,
    {
      id: string;
      name: string;
      profile: string | null;
      color: string;
      distanceKm: number;
      routes: number;
      elevationM: number;
      coordinates: [number, number][][];
    }
  >();

  for (const track of tracks) {
    const existing = byUser.get(track.userId);
    if (existing) {
      existing.distanceKm += track.distanceKm;
      existing.routes += 1;
      existing.elevationM += track.elevationGainM ?? 0;
      existing.coordinates.push(track.coordinates);
      continue;
    }

    const activity = activities.find((row) => row.userId === track.userId);
    byUser.set(track.userId, {
      id: track.userId,
      name: activity ? athleteDisplayName(activity.user) : track.athleteName,
      profile: activity?.user.profile ?? null,
      color: colorForAthleteId(track.userId),
      distanceKm: track.distanceKm,
      routes: 1,
      elevationM: track.elevationGainM ?? 0,
      coordinates: [track.coordinates],
    });
  }

  return [...byUser.values()]
    .map((row) => ({
      id: row.id,
      name: row.name,
      profile: row.profile,
      color: row.color,
      isMe: row.id === viewerId,
      distanceKm: Math.round(row.distanceKm * 10) / 10,
      routes: row.routes,
      summits: findAllConqueredSummits(
        row.coordinates.map((coordinates) => ({ coordinates })),
      ).length,
      elevationM: Math.round(row.elevationM),
    }))
    .sort((a, b) => {
      if (b.summits !== a.summits) return b.summits - a.summits;
      if (b.distanceKm !== a.distanceKm) return b.distanceKm - a.distanceKm;
      return b.routes - a.routes;
    });
}

export async function buildPersonalSummitStats(
  userId: string,
  catalogCount: number,
): Promise<PersonalSummitStats> {
  const activities = await loadHikeActivities(userId);
  const tracks = carpathianTracksFromActivities(activities);
  const visits = countSummitVisits(tracks);
  const visitCounts = Object.fromEntries(visits);
  const conqueredIds = [...visits.keys()];
  const conquered = findAllConqueredSummits(tracks);

  return {
    conqueredIds,
    visitCounts,
    conqueredCount: conqueredIds.length,
    repeatCount: conqueredIds.filter((id) => (visits.get(id) ?? 0) > 1).length,
    catalogCount,
    highest: conquered[0]
      ? {
          id: conquered[0].id,
          name: conquered[0].name,
          elevationM: conquered[0].elevationM,
        }
      : null,
    distanceKm: Math.round(
      tracks.reduce((sum, track) => sum + track.distanceKm, 0) * 10,
    ) / 10,
    routes: tracks.length,
  };
}
