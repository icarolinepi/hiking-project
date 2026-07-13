import { NextResponse } from "next/server";
import { z } from "zod";
import { routeAlongTrails } from "@/lib/trailRouting";

const bodySchema = z.object({
  waypoints: z
    .array(
      z.object({
        lat: z.number().finite().gte(-90).lte(90),
        lon: z.number().finite().gte(-180).lte(180),
        time: z.union([z.string(), z.null()]).optional(),
        ele: z.union([z.number().finite(), z.null()]).optional(),
      }),
    )
    .min(1)
    .max(80),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Некоректні точки для маршруту" },
        { status: 400 },
      );
    }

    const result = await routeAlongTrails(
      parsed.data.waypoints.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        time: point.time ?? null,
        ele: point.ele ?? null,
      })),
    );

    return NextResponse.json({
      points: result.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        ele: point.ele,
        time: point.time.toISOString(),
      })),
      provider: result.provider,
      distanceKm: Math.round((result.distanceM / 1000) * 100) / 100,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не вдалося прокласти маршрут по стежках",
      },
      { status: 502 },
    );
  }
}
