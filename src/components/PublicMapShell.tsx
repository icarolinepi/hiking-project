"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { TrackPayload } from "@/app/api/activities/tracks/route";
import {
  carpathianAreaNames,
  isCoordinateInArea,
  isCoordinateInCarpathians,
} from "@/data/carpathians";
import {
  findAllConqueredSummits,
  findConqueredSummits,
  formatSummitList,
} from "@/data/summits";
import { collectTrackYears, trackMatchesYear } from "@/lib/seasons";

const TracksMap = dynamic(
  () => import("@/components/TracksMap").then((m) => m.TracksMap),
  {
    ssr: false,
    loading: () => <div className="map-skeleton">Завантажую карту…</div>,
  },
);

type PublicMapShellProps = {
  token: string;
};

export function PublicMapShell({ token }: PublicMapShellProps) {
  const [ownerName, setOwnerName] = useState("Мандрівник");
  const [tracks, setTracks] = useState<TrackPayload[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedArea, setSelectedArea] = useState("Усі масиви");
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [basemap, setBasemap] = useState<"topo" | "satellite">("topo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/${token}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Не вдалося завантажити карту");
        if (cancelled) return;
        setOwnerName(data.owner?.name ?? "Мандрівник");
        setTracks(data.tracks ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Помилка завантаження");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const carpathianTracks = useMemo(
    () =>
      tracks.filter((track) =>
        track.coordinates.some(isCoordinateInCarpathians),
      ),
    [tracks],
  );

  const availableYears = useMemo(
    () => collectTrackYears(carpathianTracks.map((track) => track.startDate)),
    [carpathianTracks],
  );

  const filtered = useMemo(() => {
    return carpathianTracks.filter((track) => {
      if (!trackMatchesYear(track.startDate, selectedYear)) {
        return false;
      }
      if (selectedArea === "Усі масиви") return true;
      return track.coordinates.some((coordinate) =>
        isCoordinateInArea(selectedArea, coordinate),
      );
    });
  }, [carpathianTracks, selectedArea, selectedYear]);

  const mapStats = useMemo(
    () => ({
      distanceKm: Math.round(
        filtered.reduce((sum, track) => sum + track.distanceKm, 0),
      ),
      summits: findAllConqueredSummits(filtered),
    }),
    [filtered],
  );

  const summitsByTrackId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findConqueredSummits>>();
    for (const track of filtered) {
      map.set(
        track.id,
        findConqueredSummits(track.coordinates).filter(
          (summit) =>
            selectedArea === "Усі масиви" ||
            isCoordinateInArea(selectedArea, summit.coordinate),
        ),
      );
    }
    return map;
  }, [filtered, selectedArea]);

  const selected = filtered.find((track) => track.id === selectedId) ?? null;
  const visibleSummits = selected
    ? findConqueredSummits(selected.coordinates).filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      )
    : mapStats.summits.filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      );

  return (
    <div className="shell public-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">Стежки</p>
          <p className="tagline">карта Карпат · {ownerName}</p>
        </div>
        <div className="topbar-actions topbar-actions-guest">
          <a className="btn btn-primary" href="/">
            Мої Стежки
          </a>
        </div>
      </header>

      <main className="stage">
        <TracksMap
          tracks={filtered}
          selectedId={selectedId}
          selectedArea={selectedArea}
          terrainEnabled={terrainEnabled}
          showAreas={showAreas}
          basemap={basemap}
          conqueredSummits={visibleSummits}
          onSelect={setSelectedId}
          onAreaSelect={setSelectedArea}
        />

        <aside className="panel">
          <div className="stats">
            <div>
              <span className="stat-value">{mapStats.distanceKm}</span>
              <span className="stat-label">км у Карпатах</span>
            </div>
            <div>
              <span className="stat-value">{filtered.length}</span>
              <span className="stat-label">маршрутів</span>
            </div>
            <div>
              <span className="stat-value">{mapStats.summits.length}</span>
              <span className="stat-label">вершин</span>
            </div>
          </div>

          <div className="map-controls">
            <label className="filter">
              <span>Гірський масив</span>
              <select
                value={selectedArea}
                onChange={(event) => {
                  setSelectedArea(event.target.value);
                  setSelectedId(null);
                }}
              >
                <option>Усі масиви</option>
                {carpathianAreaNames.map((area) => (
                  <option key={area.name} value={area.name}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter">
              <span>Рік</span>
              <select
                value={selectedYear === "all" ? "all" : String(selectedYear)}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedYear(value === "all" ? "all" : Number(value));
                  setSelectedId(null);
                }}
              >
                <option value="all">Усі роки</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="check-toggle">
              <input
                type="checkbox"
                checked={showAreas}
                onChange={(event) => setShowAreas(event.target.checked)}
              />
              <span>Показувати гірські масиви</span>
            </label>

            <div className="basemap-toggle" role="group" aria-label="Підкладка карти">
              <button
                type="button"
                className={basemap === "topo" ? "active" : ""}
                onClick={() => setBasemap("topo")}
              >
                Топо
              </button>
              <button
                type="button"
                className={basemap === "satellite" ? "active" : ""}
                onClick={() => {
                  setBasemap("satellite");
                  setTerrainEnabled(true);
                }}
              >
                Супутник 3D
              </button>
            </div>
          </div>

          <div className="track-list">
            {loading ? (
              <p className="muted">Завантажую треки…</p>
            ) : filtered.length === 0 ? (
              <p className="muted">Немає маршрутів за цими фільтрами.</p>
            ) : (
              filtered.slice(0, 80).map((track) => {
                const trackSummits = summitsByTrackId.get(track.id) ?? [];
                const summitLabel = formatSummitList(trackSummits);
                return (
                  <button
                    key={track.id}
                    type="button"
                    className={`track-item ${selectedId === track.id ? "active" : ""}`}
                    onClick={() =>
                      setSelectedId((id) => (id === track.id ? null : track.id))
                    }
                  >
                    <span className="track-name">{track.name}</span>
                    <span className="track-meta">
                      {track.distanceKm} км ·{" "}
                      {new Date(track.startDate).toLocaleDateString("uk-UA")}
                    </span>
                    {summitLabel ? (
                      <span className="track-summits">▲ {summitLabel}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </main>

      {error ? (
        <div className="toast" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Закрити
          </button>
        </div>
      ) : null}
    </div>
  );
}
