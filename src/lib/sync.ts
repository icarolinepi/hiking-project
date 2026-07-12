import { prisma } from "@/lib/prisma";
import { fetchStravaActivities } from "@/lib/strava";
import { getValidAccessToken } from "@/lib/user";

export async function syncUserActivities(userId: string) {
  const accessToken = await getValidAccessToken(userId);
  let page = 1;
  let imported = 0;
  let withTrack = 0;

  while (true) {
    const activities = await fetchStravaActivities(accessToken, page, 100);
    if (activities.length === 0) break;

    for (const activity of activities) {
      const isHike =
        activity.type === "Hike" || activity.sport_type === "Hike";
      if (!isHike) continue;

      const polyline = activity.map?.summary_polyline ?? null;
      if (polyline) withTrack += 1;

      await prisma.activity.upsert({
        where: { stravaId: BigInt(activity.id) },
        create: {
          stravaId: BigInt(activity.id),
          userId,
          name: activity.name,
          type: activity.type,
          sportType: activity.sport_type ?? null,
          distance: activity.distance,
          movingTime: activity.moving_time,
          elapsedTime: activity.elapsed_time,
          totalElevation: activity.total_elevation_gain,
          startDate: new Date(activity.start_date),
          summaryPolyline: polyline,
          startLatlng: activity.start_latlng ?? undefined,
          endLatlng: activity.end_latlng ?? undefined,
        },
        update: {
          name: activity.name,
          type: activity.type,
          sportType: activity.sport_type ?? null,
          distance: activity.distance,
          movingTime: activity.moving_time,
          elapsedTime: activity.elapsed_time,
          totalElevation: activity.total_elevation_gain,
          startDate: new Date(activity.start_date),
          summaryPolyline: polyline,
          startLatlng: activity.start_latlng ?? undefined,
          endLatlng: activity.end_latlng ?? undefined,
        },
      });
      imported += 1;
    }

    if (activities.length < 100) break;
    page += 1;

    // легка пауза, щоб не впертись у rate limit Strava
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await prisma.user.update({
    where: { id: userId },
    data: { lastSyncedAt: new Date() },
  });

  return { imported, withTrack, pages: page };
}
