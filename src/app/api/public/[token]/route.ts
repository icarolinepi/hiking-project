import { NextResponse } from "next/server";
import { athleteDisplayName } from "@/lib/athleteColors";
import { prisma } from "@/lib/prisma";
import { activitiesToTracks } from "@/lib/tracksFromActivities";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Невірне посилання" }, { status: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { shareToken: token },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      username: true,
      profile: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Карту не знайдено" }, { status: 404 });
  }

  const activities = await prisma.activity.findMany({
    where: {
      userId: user.id,
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
  const name = athleteDisplayName(user);

  return NextResponse.json({
    owner: {
      name,
      profile: user.profile,
    },
    tracks,
  });
}
