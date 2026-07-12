"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import type {
  AthletePayload,
  TrackPayload,
} from "@/app/api/activities/tracks/route";
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
import {
  COMPARE_ME_COLOR,
  COMPARE_OTHER_COLOR,
} from "@/lib/athleteColors";
import {
  SEASON_OPTIONS,
  collectTrackYears,
  trackMatchesPeriod,
  type SeasonId,
} from "@/lib/seasons";
import { formatSolarTime, getSolarEvents } from "@/lib/solar";

const TracksMap = dynamic(
  () => import("@/components/TracksMap").then((m) => m.TracksMap),
  {
    ssr: false,
    loading: () => <div className="map-skeleton">Завантажую карту…</div>,
  },
);

type MeResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    name: string;
    profile: string | null;
    shareToken: string | null;
    shareUrl: string | null;
    lastSyncedAt: string | null;
    activityCount: number;
  };
  stats?: {
    tracks: number;
    distanceKm: number;
    movingHours: number;
  };
};

export function AppShell() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tracks, setTracks] = useState<TrackPayload[]>([]);
  const [athletes, setAthletes] = useState<AthletePayload[]>([]);
  const [compareWithId, setCompareWithId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedArea, setSelectedArea] = useState("Усі масиви");
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [selectedSeason, setSelectedSeason] = useState<SeasonId | "all">("all");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [basemap, setBasemap] = useState<"topo" | "satellite">("topo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const myId = me?.user?.id ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/me");
      const meData: MeResponse = await meRes.json();
      setMe(meData);

      if (meData.authenticated) {
        const tracksRes = await fetch("/api/activities/tracks");
        if (!tracksRes.ok) {
          throw new Error("Не вдалося завантажити треки");
        }
        const tracksData = await tracksRes.json();
        const nextTracks: TrackPayload[] = tracksData.tracks ?? [];
        const nextAthletes: AthletePayload[] = tracksData.athletes ?? [];
        setTracks(nextTracks);
        setAthletes(nextAthletes);
        setShareUrl(meData.user?.shareUrl ?? null);
        setCompareWithId((prev) => {
          if (!prev) return null;
          return nextAthletes.some((athlete) => athlete.id === prev) ? prev : null;
        });
      } else {
        setTracks([]);
        setAthletes([]);
        setCompareWithId(null);
        setShareUrl(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) queueMicrotask(() => setError(urlError));
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!compareOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCompareOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compareOpen]);

  const otherAthletes = useMemo(
    () => athletes.filter((athlete) => !athlete.isMe),
    [athletes],
  );

  const carpathianCountByUserId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of tracks) {
      if (!track.coordinates.some(isCoordinateInCarpathians)) continue;
      counts.set(track.userId, (counts.get(track.userId) ?? 0) + 1);
    }
    return counts;
  }, [tracks]);

  const compareAthlete = useMemo(
    () => otherAthletes.find((athlete) => athlete.id === compareWithId) ?? null,
    [compareWithId, otherAthletes],
  );

  const carpathianTracks = useMemo(
    () =>
      tracks.filter((track) =>
        track.coordinates.some(isCoordinateInCarpathians),
      ),
    [tracks],
  );

  const availableYears = useMemo(() => {
    if (!myId) return [];
    const relevant = carpathianTracks.filter((track) => {
      if (compareWithId) {
        return track.userId === myId || track.userId === compareWithId;
      }
      return track.userId === myId;
    });
    return collectTrackYears(relevant.map((track) => track.startDate));
  }, [carpathianTracks, compareWithId, myId]);

  const filtered = useMemo(() => {
    if (!myId) return [];

    return carpathianTracks
      .filter((track) => {
        if (compareWithId) {
          if (track.userId !== myId && track.userId !== compareWithId) {
            return false;
          }
        } else if (track.userId !== myId) {
          return false;
        }

        if (!trackMatchesPeriod(track.startDate, selectedYear, selectedSeason)) {
          return false;
        }

        if (selectedArea === "Усі масиви") return true;
        return track.coordinates.some((coordinate) =>
          isCoordinateInArea(selectedArea, coordinate),
        );
      })
      .map((track) => {
        if (!compareWithId) return track;
        return {
          ...track,
          color:
            track.userId === myId ? COMPARE_ME_COLOR : COMPARE_OTHER_COLOR,
        };
      });
  }, [
    carpathianTracks,
    compareWithId,
    myId,
    selectedArea,
    selectedSeason,
    selectedYear,
  ]);

  const mapStats = useMemo(
    () => ({
      distanceKm: Math.round(
        filtered.reduce((sum, track) => sum + track.distanceKm, 0),
      ),
      movingHours: Math.round(
        filtered.reduce(
          (sum, track) => sum + track.movingTimeSeconds / 3600,
          0,
        ),
      ),
      summits: findAllConqueredSummits(filtered),
    }),
    [filtered],
  );

  const compareStats = useMemo(() => {
    if (!myId || !compareWithId || !compareAthlete) return null;

    const mine = filtered.filter((track) => track.userId === myId);
    const theirs = filtered.filter((track) => track.userId === compareWithId);

    const buildSide = (sideTracks: typeof filtered) => {
      const distanceKm = Math.round(
        sideTracks.reduce((sum, track) => sum + track.distanceKm, 0),
      );
      const routes = sideTracks.length;
      const summits = findAllConqueredSummits(sideTracks).filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      ).length;
      return { distanceKm, routes, summits };
    };

    const meSide = buildSide(mine);
    const otherSide = buildSide(theirs);

    const winner = (mineValue: number, otherValue: number) => {
      if (mineValue === otherValue) return "tie" as const;
      return mineValue > otherValue ? ("me" as const) : ("other" as const);
    };

    return {
      me: meSide,
      other: otherSide,
      otherName: compareAthlete.name,
      winners: {
        distanceKm: winner(meSide.distanceKm, otherSide.distanceKm),
        routes: winner(meSide.routes, otherSide.routes),
        summits: winner(meSide.summits, otherSide.summits),
      },
    };
  }, [compareAthlete, compareWithId, filtered, myId, selectedArea]);

  const summitsByTrackId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findConqueredSummits>>();
    for (const track of filtered) {
      const summits = findConqueredSummits(track.coordinates).filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      );
      map.set(track.id, summits);
    }
    return map;
  }, [filtered, selectedArea]);

  async function handleSync() {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка синхронізації");
        return;
      }
      await load();
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe({ authenticated: false });
    setTracks([]);
    setAthletes([]);
    setCompareWithId(null);
    setCompareOpen(false);
    setShareUrl(null);
    setSelectedId(null);
  }

  async function handleShare() {
    setShareBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/share", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Не вдалося створити посилання");
      }
      const url =
        data.shareUrl ||
        `${window.location.origin}/u/${data.shareToken as string}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка поширення");
    } finally {
      setShareBusy(false);
    }
  }

  function selectCompareUser(athleteId: string) {
    setCompareWithId(athleteId);
    setCompareOpen(false);
    setSelectedId(null);
  }

  function clearCompare() {
    setCompareWithId(null);
    setCompareOpen(false);
    setSelectedId(null);
  }

  const selected = filtered.find((t) => t.id === selectedId) ?? null;
  const selectedAreas = selected
    ? carpathianAreaNames
        .filter((area) =>
          selected.coordinates.some((coordinate) =>
            isCoordinateInArea(area.name, coordinate),
          ),
        )
        .map((area) => area.name)
    : [];
  const selectedSolarEvents = selected ? getSolarEvents(selected) : [];
  const selectedSummits = selected
    ? findConqueredSummits(selected.coordinates).filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      )
    : [];
  const visibleSummits = selected
    ? selectedSummits
    : mapStats.summits.filter(
        (summit) =>
          selectedArea === "Усі масиви" ||
          isCoordinateInArea(selectedArea, summit.coordinate),
      );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">Стежки</p>
          <p className="tagline">усі твої маршрути на одній карті</p>
        </div>

        <div className="topbar-actions">
          {me?.authenticated ? (
            <>
              <div className="user-chip">
                {me.user?.profile ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.user.profile} alt="" className="avatar" />
                ) : null}
                <span>{me.user?.name}</span>
              </div>
              <button
                type="button"
                className={`btn ${compareWithId ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setCompareOpen(true)}
              >
                {compareAthlete
                  ? `Порівняння: ${compareAthlete.name}`
                  : "Порівняти"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleShare}
                disabled={shareBusy}
                title={shareUrl ?? "Створити публічне посилання"}
              >
                {shareBusy
                  ? "Готую…"
                  : shareCopied
                    ? "Скопійовано!"
                    : "Поділитися картою"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleSync}
                disabled={isPending}
              >
                {isPending ? "Синхронізую…" : "Оновити зі Strava"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleLogout}>
                Вийти
              </button>
            </>
          ) : (
            <a className="btn btn-primary" href="/api/auth/strava">
              Підключити Strava
            </a>
          )}
        </div>
      </header>

      <main className="stage">
        {me?.authenticated ? (
          <>
            <TracksMap
              tracks={filtered}
              selectedId={selectedId}
              selectedArea={selectedArea}
              terrainEnabled={terrainEnabled}
              showAreas={showAreas}
              basemap={basemap}
              conqueredSummits={visibleSummits}
              compareMode={Boolean(compareWithId)}
              myUserId={myId}
              onSelect={setSelectedId}
              onAreaSelect={setSelectedArea}
            />

            <aside className="panel">
              {compareStats ? (
                <section className="compare-score" aria-label="Рахунок порівняння">
                  <div className="compare-score-header">
                    <div className="compare-score-names">
                      <span>
                        <i style={{ background: COMPARE_ME_COLOR }} aria-hidden />
                        Ти
                      </span>
                      <em>vs</em>
                      <span>
                        <i
                          style={{ background: COMPARE_OTHER_COLOR }}
                          aria-hidden
                        />
                        {compareStats.otherName}
                      </span>
                    </div>
                    <button type="button" onClick={clearCompare}>
                      Скинути
                    </button>
                  </div>

                  <div className="compare-score-rows">
                    {(
                      [
                        {
                          key: "distanceKm" as const,
                          label: "км у Карпатах",
                          me: compareStats.me.distanceKm,
                          other: compareStats.other.distanceKm,
                        },
                        {
                          key: "routes" as const,
                          label: "маршрутів",
                          me: compareStats.me.routes,
                          other: compareStats.other.routes,
                        },
                        {
                          key: "summits" as const,
                          label: "вершин",
                          me: compareStats.me.summits,
                          other: compareStats.other.summits,
                        },
                      ] as const
                    ).map((row) => {
                      const winner = compareStats.winners[row.key];
                      return (
                        <div key={row.key} className="compare-score-row">
                          <div
                            className={`compare-score-side me ${
                              winner === "me" ? "wins" : ""
                            }`}
                          >
                            <strong>{row.me}</strong>
                            {winner === "me" ? <small>виграє</small> : null}
                          </div>
                          <span className="compare-score-label">{row.label}</span>
                          <div
                            className={`compare-score-side other ${
                              winner === "other" ? "wins" : ""
                            }`}
                          >
                            <strong>{row.other}</strong>
                            {winner === "other" ? <small>виграє</small> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
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
              )}

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

                <label className="filter">
                  <span>Сезон</span>
                  <select
                    value={selectedSeason}
                    onChange={(event) => {
                      setSelectedSeason(event.target.value as SeasonId | "all");
                      setSelectedId(null);
                    }}
                  >
                    <option value="all">Усі сезони</option>
                    {SEASON_OPTIONS.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.label}
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
                <button
                  type="button"
                  className={`terrain-toggle ${terrainEnabled ? "active" : ""}`}
                  aria-pressed={terrainEnabled}
                  onClick={() => setTerrainEnabled((enabled) => !enabled)}
                >
                  <span aria-hidden>{terrainEnabled ? "⛰" : "▱"}</span>
                  {terrainEnabled ? "3D-рельєф увімкнено" : "Пласка карта"}
                </button>
              </div>

              {selected ? (
                <section className="route-details" aria-live="polite">
                  <div className="route-details-header">
                    <div>
                      <span className="eyebrow">Вибраний маршрут</span>
                      <h2>{selected.name}</h2>
                    </div>
                    <button
                      type="button"
                      className="route-details-close"
                      aria-label="Закрити деталі маршруту"
                      onClick={() => setSelectedId(null)}
                    >
                      ×
                    </button>
                  </div>

                  {compareWithId ? (
                    <p className="route-athlete">
                      <span
                        className="athlete-swatch"
                        style={{ background: selected.color }}
                        aria-hidden
                      />
                      {selected.athleteName}
                    </p>
                  ) : null}

                  <p className="route-date">
                    {new Date(selected.startDate).toLocaleDateString("uk-UA", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                    {" · "}
                    Хайк
                  </p>

                  {selectedAreas.length > 0 ? (
                    <p className="route-areas">⛰ {selectedAreas.join(" · ")}</p>
                  ) : null}

                  {selectedSummits.length > 0 ? (
                    <div className="route-summits">
                      <span className="route-summits-label">Підкорені вершини</span>
                      <ul>
                        {selectedSummits.map((summit) => (
                          <li key={summit.id}>
                            <strong>{summit.name}</strong>
                            <span>{summit.elevationM} м</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="route-summits-empty">
                      Немає вершин у радіусі 200 м від треку
                    </p>
                  )}

                  <div className="solar-times">
                    {selectedSolarEvents.map((event) => (
                      <div key={event.type}>
                        <span aria-hidden>
                          {event.type === "sunrise" ? "🌅" : "🌇"}
                        </span>
                        <p>
                          <small>{event.label}</small>
                          <strong>{formatSolarTime(event.time)}</strong>
                        </p>
                        {event.coordinate ? <em>під час походу</em> : null}
                      </div>
                    ))}
                  </div>

                  <div className="route-metrics">
                    <div>
                      <strong>{selected.distanceKm}</strong>
                      <span>км</span>
                    </div>
                    <div>
                      <strong>{formatDuration(selected.movingTimeSeconds)}</strong>
                      <span>у русі</span>
                    </div>
                    <div>
                      <strong>{formatDuration(selected.elapsedTimeSeconds)}</strong>
                      <span>загалом</span>
                    </div>
                    <div>
                      <strong>{Math.round(selected.elevationGainM ?? 0)}</strong>
                      <span>м набору</span>
                    </div>
                  </div>

                  <div className="route-summary">
                    <span>Середній темп</span>
                    <strong>
                      {formatPace(
                        selected.movingTimeSeconds,
                        selected.distanceKm,
                      )}
                    </strong>
                  </div>
                  <p className="route-zoom-hint">
                    Маршрут наближено на карті. Натисни ×, щоб повернути всі треки.
                  </p>
                </section>
              ) : null}

              <div className="track-list">
                {loading ? (
                  <p className="muted">Завантажую треки…</p>
                ) : filtered.length === 0 ? (
                  <p className="muted">
                    Поки немає маршрутів з GPS. Натисни «Оновити зі Strava».
                  </p>
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
                          setSelectedId((id) =>
                            id === track.id ? null : track.id,
                          )
                        }
                      >
                        <span className="track-item-top">
                          {compareWithId ? (
                            <span
                              className="athlete-swatch"
                              style={{ background: track.color }}
                              aria-hidden
                            />
                          ) : null}
                          <span className="track-name">{track.name}</span>
                        </span>
                        <span className="track-meta">
                          {compareWithId ? `${track.athleteName} · ` : ""}
                          {track.distanceKm} км ·{" "}
                          {new Date(track.startDate).toLocaleDateString("uk-UA")}
                          {trackSummits.length > 0
                            ? ` · ${trackSummits.length} верх.`
                            : ""}
                        </span>
                        {summitLabel ? (
                          <span
                            className="track-summits"
                            title={trackSummits.map((s) => s.name).join(", ")}
                          >
                            ▲ {summitLabel}
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </>
        ) : (
          <section className="welcome">
            <div className="welcome-copy">
              <p className="welcome-brand">Стежки</p>
              <p className="welcome-lead">
                Усі хайкінг-треки зі Strava на 3D-карті Українських Карпат.
              </p>
              <a className="btn btn-primary btn-lg" href="/api/auth/strava">
                Підключити Strava
              </a>
            </div>
            <div className="welcome-map-hint" aria-hidden>
              <div className="ghost-trail t1" />
              <div className="ghost-trail t2" />
              <div className="ghost-trail t3" />
            </div>
          </section>
        )}
      </main>

      {compareOpen ? (
        <div
          className="compare-backdrop"
          role="presentation"
          onClick={() => setCompareOpen(false)}
        >
          <div
            className="compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compare-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="compare-dialog-header">
              <div>
                <p className="eyebrow">Порівняння</p>
                <h2 id="compare-dialog-title">З ким порівняти?</h2>
              </div>
              <button
                type="button"
                className="route-details-close"
                aria-label="Закрити"
                onClick={() => setCompareOpen(false)}
              >
                ×
              </button>
            </div>

            <p className="compare-dialog-lead">
              Обери людину — твої маршрути будуть одним кольором, її — іншим.
            </p>

            {otherAthletes.length === 0 ? (
              <p className="muted">
                Поки немає інших користувачів. Нехай друг підключить Strava в
                «Стежки».
              </p>
            ) : (
              <div className="compare-user-list">
                {otherAthletes.map((athlete) => (
                  <button
                    key={athlete.id}
                    type="button"
                    className={`compare-user-item ${
                      compareWithId === athlete.id ? "active" : ""
                    }`}
                    onClick={() => selectCompareUser(athlete.id)}
                  >
                    {athlete.profile ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={athlete.profile} alt="" className="avatar" />
                    ) : (
                      <span className="compare-user-fallback" aria-hidden>
                        {athlete.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="compare-user-text">
                      <strong>{athlete.name}</strong>
                      <small>
                        {athlete.trackCount} хайків, з них у Карпатах:{" "}
                        {carpathianCountByUserId.get(athlete.id) ?? 0}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {compareWithId ? (
              <button
                type="button"
                className="btn btn-ghost compare-clear"
                onClick={clearCompare}
              >
                Показати лише мою карту
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

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

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}`
    : `${minutes} хв`;
}

function formatPace(seconds: number, distanceKm: number) {
  if (!distanceKm) return "—";
  const secondsPerKm = Math.round(seconds / distanceKm);
  const minutes = Math.floor(secondsPerKm / 60);
  return `${minutes}:${String(secondsPerKm % 60).padStart(2, "0")} /км`;
}
