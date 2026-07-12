import { NextResponse } from "next/server";
import { getStravaAuthorizeUrl } from "@/lib/strava";

export async function GET() {
  try {
    const state = crypto.randomUUID();
    const url = getStravaAuthorizeUrl(state);
    const response = NextResponse.redirect(url);
    response.cookies.set("strava_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Помилка авторизації";
    return NextResponse.redirect(
      `${process.env.APP_URL}/?error=${encodeURIComponent(message)}`,
    );
  }
}
