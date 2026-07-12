import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { syncUserActivities } from "@/lib/sync";

export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }

  try {
    const result = await syncUserActivities(session.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка синхронізації";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
