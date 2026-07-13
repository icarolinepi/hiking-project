import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { exchangeStravaCode } from "@/lib/strava";
import { syncUserActivities } from "@/lib/sync";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("strava_oauth_state")?.value;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent("Авторизацію Strava скасовано")}`,
    );
  }

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent("Невірний стан OAuth")}`,
    );
  }

  try {
    const tokens = await exchangeStravaCode(code);
    const athlete = tokens.athlete;

    const user = await prisma.user.upsert({
      where: { stravaId: BigInt(athlete.id) },
      create: {
        stravaId: BigInt(athlete.id),
        username: athlete.username,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
      },
      update: {
        username: athlete.username,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(tokens.expires_at * 1000),
      },
    });

    const session = await getSession();
    session.userId = user.id;
    await session.save();

    // перша синхронізація після логіну
    await syncUserActivities(user.id);

    const response = NextResponse.redirect(`${appUrl}/?synced=1`);
    response.cookies.set("strava_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Помилка входу";
    return NextResponse.redirect(`${appUrl}/?error=${encodeURIComponent(message)}`);
  }
}
