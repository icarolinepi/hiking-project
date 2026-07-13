import { NextResponse } from "next/server";
import { CARPATHIAN_SUMMITS } from "@/data/summits";
import { buildPersonalSummitStats } from "@/lib/leaderboard";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }

  const stats = await buildPersonalSummitStats(
    session.userId,
    CARPATHIAN_SUMMITS.length,
  );
  return NextResponse.json(stats);
}
