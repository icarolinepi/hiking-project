"use client";

import { SiteNav } from "@/components/SiteNav";
import {
  downloadPhotoGpx,
  emptyPhotosGpxMessage,
  extractPhotoPoints,
  formatPhotoTimeRange,
  restampTrackToPhotoWindow,
  routedPointsToGpx,
} from "@/lib/photosToGpx";
import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";

export function PhotosGpxPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePhotosToGpx(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const extracted = await extractPhotoPoints(files);
      if (extracted.points.length === 0) {
        throw new Error(emptyPhotosGpxMessage(extracted));
      }

      const routeRes = await fetch("/api/route/trail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: extracted.points.map((point) => ({
            lat: point.lat,
            lon: point.lon,
            time: point.time.toISOString(),
            ele: point.ele,
          })),
        }),
      });
      const routeData = await routeRes.json();
      if (!routeRes.ok) {
        throw new Error(
          routeData.error || "Не вдалося прокласти маршрут по стежках",
        );
      }

      const routedPoints = (routeData.points ?? []) as Array<{
        lat: number;
        lon: number;
        ele: number | null;
        time: string;
      }>;
      if (routedPoints.length < 2 && extracted.points.length > 1) {
        throw new Error("Маршрут по стежках порожній");
      }

      const firstPhoto = extracted.points[0];
      const lastPhoto = extracted.points[extracted.points.length - 1];
      const timedTrack = restampTrackToPhotoWindow(
        routedPoints,
        firstPhoto.time,
        lastPhoto.time,
      );
      const gpx = routedPointsToGpx(timedTrack, "Маршрут з фото");
      downloadPhotoGpx(gpx, "marshrut-z-foto");

      const distanceHint =
        typeof routeData.distanceKm === "number"
          ? ` · ~${routeData.distanceKm} км`
          : "";
      const skipHint =
        extracted.skipped > 0
          ? ` Пропущено без GPS/часу: ${extracted.skipped}.`
          : "";
      setMessage(
        `Готово: ${extracted.points.length} фото · ${formatPhotoTimeRange(firstPhoto.time, lastPhoto.time)}${distanceHint}.${skipHint}`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не вдалося зібрати GPX з фото",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand-block">
          <Link href="/" className="brand brand-link">
            Стежки
          </Link>
          <p className="tagline">маршрут із геотегів у фото</p>
        </div>
        <SiteNav />
        <div className="topbar-actions" />
      </header>

      <main className="page-main">
        <div className="page-hero">
          <h1 className="page-title">GPX з фото</h1>
          <p className="page-lead">
            Обери кілька знімків з GPS і часом зйомки — зберемо трек по
            пішохідних стежках і скачаємо GPX.
          </p>
        </div>

        <div className="photos-gpx-panel">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Прокладаю стежки…" : "Обрати фото"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.heic,.heif,.tif,.tiff,image/jpeg,image/heic,image/heif,image/tiff"
            multiple
            hidden
            onChange={handlePhotosToGpx}
          />
          <ul className="photos-gpx-hints">
            <li>Потрібні EXIF GPS і DateTimeOriginal (час зйомки).</li>
            <li>Можна кількома файлами одразу — порядок за часом зйомки.</li>
            <li>Маршрут будується пішохідними стежками, не дорогою.</li>
          </ul>
          {message ? <p className="page-meta">{message}</p> : null}
          {error ? <p className="page-error">{error}</p> : null}
        </div>
      </main>
    </div>
  );
}
