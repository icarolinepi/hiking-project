"use client";

import { SiteNav } from "@/components/SiteNav";
import {
  carpathianAreaNames,
  isCoordinateInArea,
} from "@/data/carpathians";
import {
  CARPATHIAN_SUMMITS,
  formatVisitCount,
  type Summit,
} from "@/data/summits";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type FilterMode = "all" | "done" | "repeat" | "todo";

type SummitRow = Summit & { area: string };

function resolveArea(coordinate: [number, number]): string {
  for (const area of carpathianAreaNames) {
    if (isCoordinateInArea(area.name, coordinate)) return area.name;
  }
  return "Інші";
}

export function SummitsCatalogPage() {
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<{
    conqueredCount: number;
    repeatCount: number;
    catalogCount: number;
    highest: { name: string; elevationM: number } | null;
    distanceKm: number;
    routes: number;
  } | null>(null);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [area, setArea] = useState("Усі масиви");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const catalog = useMemo<SummitRow[]>(
    () =>
      CARPATHIAN_SUMMITS.map((summit) => ({
        ...summit,
        area: resolveArea(summit.coordinate),
      })).sort((a, b) => b.elevationM - a.elevationM),
    [],
  );

  const areas = useMemo(() => {
    const names = new Set(catalog.map((summit) => summit.area));
    return ["Усі масиви", ...[...names].sort((a, b) => a.localeCompare(b, "uk"))];
  }, [catalog]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const meRes = await fetch("/api/me");
        const me = await meRes.json();
        if (!me.authenticated) {
          if (!cancelled) {
            setAuthed(false);
            setVisitCounts({});
            setStats(null);
          }
          return;
        }
        if (!cancelled) setAuthed(true);

        const res = await fetch("/api/me/summits");
        if (!res.ok) throw new Error("Не вдалося завантажити вершини");
        const data = await res.json();
        if (!cancelled) {
          const counts = (data.visitCounts ?? {}) as Record<string, number>;
          setVisitCounts(counts);
          setStats({
            conqueredCount: data.conqueredCount ?? 0,
            repeatCount: data.repeatCount ?? 0,
            catalogCount: data.catalogCount ?? catalog.length,
            highest: data.highest ?? null,
            distanceKm: data.distanceKm ?? 0,
            routes: data.routes ?? 0,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Помилка завантаження");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("uk");
    const rows = catalog.filter((summit) => {
      if (area !== "Усі масиви" && summit.area !== area) return false;
      const visits = visitCounts[summit.id] ?? 0;
      if (filter === "done" && visits < 1) return false;
      if (filter === "repeat" && visits < 2) return false;
      if (filter === "todo" && visits > 0) return false;
      if (!q) return true;
      return summit.name.toLocaleLowerCase("uk").includes(q);
    });

    if (filter === "done" || filter === "repeat") {
      return [...rows].sort((a, b) => {
        const diff = (visitCounts[b.id] ?? 0) - (visitCounts[a.id] ?? 0);
        if (diff !== 0) return diff;
        return b.elevationM - a.elevationM;
      });
    }

    return rows;
  }, [area, catalog, filter, query, visitCounts]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand-block">
          <Link href="/" className="brand brand-link">
            Стежки
          </Link>
          <p className="tagline">каталог вершин для тебе</p>
        </div>
        <SiteNav />
        <div className="topbar-actions">
          {authed ? null : (
            <a className="btn btn-primary" href="/api/auth/strava">
              Підключити Strava
            </a>
          )}
        </div>
      </header>

      <main className="page-main">
        <div className="page-hero">
          <h1 className="page-title">Вершини</h1>
          <p className="page-lead">
            Каталог вершин Українських Карпат. Підкореною вважається вершина,
            якщо твій трек пройшов у радіусі 200&nbsp;м. Лічильник — кількість
            різних маршрутів, на яких ти її брав.
          </p>
          {stats ? (
            <ul className="stats-strip">
              <li>
                <strong>{stats.conqueredCount}</strong>
                <span>з {stats.catalogCount}</span>
              </li>
              <li>
                <strong>{stats.repeatCount}</strong>
                <span>не один раз</span>
              </li>
              <li>
                <strong>{stats.routes}</strong>
                <span>маршрутів</span>
              </li>
              <li>
                <strong>{stats.distanceKm}</strong>
                <span>км у Карпатах</span>
              </li>
              {stats.highest ? (
                <li>
                  <strong>{stats.highest.elevationM}&nbsp;м</strong>
                  <span>{stats.highest.name}</span>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        {loading ? <p className="page-status">Завантажую…</p> : null}
        {error ? <p className="page-error">{error}</p> : null}

        {!loading && !error ? (
          <>
            {!authed ? (
              <div className="page-empty">
                <p>
                  Каталог можна гортати й так. Підключи Strava — тоді позначимо
                  вершини, які вже твої.
                </p>
                <a className="btn btn-primary" href="/api/auth/strava">
                  Підключити Strava
                </a>
              </div>
            ) : null}

            <div className="catalog-toolbar">
              <div className="sort-tabs" role="tablist" aria-label="Фільтр">
                {(
                  [
                    ["all", "Усі"],
                    ["done", "Підкорені"],
                    ["repeat", "Не один раз"],
                    ["todo", "Ще не були"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    className={`sort-tab${filter === key ? " is-active" : ""}`}
                    onClick={() => setFilter(key)}
                    disabled={!authed && key !== "all"}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="catalog-search">
                <span className="sr-only">Пошук вершини</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Пошук за назвою…"
                />
              </label>

              <label className="catalog-select">
                <span className="sr-only">Масив</span>
                <select
                  value={area}
                  onChange={(event) => setArea(event.target.value)}
                >
                  {areas.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="page-meta">
              Показано {filtered.length} з {catalog.length}
            </p>

            <ul className="summit-catalog">
              {filtered.map((summit) => {
                const visits = visitCounts[summit.id] ?? 0;
                const done = visits > 0;
                return (
                  <li
                    key={summit.id}
                    className={`summit-row${done ? " is-done" : ""}`}
                  >
                    <div className="summit-main">
                      <span className="summit-name">{summit.name}</span>
                      <span className="summit-meta">
                        {summit.area} · {summit.elevationM}&nbsp;м
                      </span>
                    </div>
                    {authed ? (
                      <span
                        className={`summit-badge${done ? " done" : ""}${visits > 1 ? " repeat" : ""}`}
                      >
                        {visits > 1
                          ? formatVisitCount(visits)
                          : done
                            ? "Підкорена"
                            : "Ще ні"}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {filtered.length === 0 ? (
              <div className="page-empty">
                <p>Нічого не знайдено за цими фільтрами.</p>
              </div>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
