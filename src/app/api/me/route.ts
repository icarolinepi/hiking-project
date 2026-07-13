import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ authenticated: false });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      username: true,
      profile: true,
      shareToken: true,
      lastSyncedAt: true,
      _count: { select: { activities: true } },
    },
  });

  if (!user) {
    session.destroy();
    return NextResponse.json({ authenticated: false });
  }

  const stats = await prisma.activity.aggregate({
    where: {
      userId: user.id,
      summaryPolyline: { not: null },
      OR: [{ type: "Hike" }, { sportType: "Hike" }],
    },
    _sum: { distance: true, movingTime: true },
    _count: true,
  });

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      name:
        [user.firstname, user.lastname].filter(Boolean).join(" ") ||
        user.username ||
        "Атлет",
      profile: user.profile,
      shareToken: user.shareToken,
      shareUrl: user.shareToken ? `${appUrl}/u/${user.shareToken}` : null,
      lastSyncedAt: user.lastSyncedAt,
      activityCount: user._count.activities,
    },
    stats: {
      tracks: stats._count,
      distanceKm: Math.round(((stats._sum.distance ?? 0) / 1000) * 10) / 10,
      movingHours: Math.round(((stats._sum.movingTime ?? 0) / 3600) * 10) / 10,
    },
  });
}
