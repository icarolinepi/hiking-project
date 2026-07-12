import { prisma } from "@/lib/prisma";
import { refreshStravaToken } from "@/lib/strava";

export async function getValidAccessToken(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const expiresSoon = user.expiresAt.getTime() - Date.now() < 60_000;
  if (!expiresSoon) {
    return user.accessToken;
  }

  const tokens = await refreshStravaToken(user.refreshToken);
  await prisma.user.update({
    where: { id: userId },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(tokens.expires_at * 1000),
    },
  });

  return tokens.access_token;
}
