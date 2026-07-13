import { NextResponse } from "next/server";
import { buildLeaderboard } from "@/lib/leaderboard";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }

  const rows = await buildLeaderboard(session.userId);
  return NextResponse.json({ rows });
}
