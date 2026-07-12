import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }

  const existing = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { shareToken: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  let shareToken = existing.shareToken;
  if (!shareToken) {
    shareToken = randomBytes(12).toString("hex");
    await prisma.user.update({
      where: { id: session.userId },
      data: { shareToken },
    });
  }

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  return NextResponse.json({
    shareToken,
    shareUrl: `${appUrl}/u/${shareToken}`,
  });
}
