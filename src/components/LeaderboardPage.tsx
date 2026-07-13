"use client";

import { SiteNav } from "@/components/SiteNav";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LeaderboardRow = {
  id: string;
  name: string;
  profile: string | null;
  color: string;
  isMe: boolean;
  distanceKm: number;
  routes: number;
  summits: number;
  elevationM: number;
};

type SortKey = "summits" | "distanceKm" | "routes" | "elevationM";

const SORT_LABELS: Record<SortKey, string> = {
  summits: "Вершини",
  distanceKm: "Кілометри",
  routes: "Маршрути",
  elevationM: "Набір м",
};

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [sort, setSort] = useState<SortKey>("summits");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

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
            setRows([]);
          }
          return;
        }
        if (!cancelled) setAuthed(true);

        const res = await fetch("/api/leaderboard");
        if (!res.ok) {
          throw new Error("Не вдалося завантажити лідерборд");
        }
        const data = await res.json();
        if (!cancelled) setRows(data.rows ?? []);
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
  }, []);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const diff = b[sort] - a[sort];
      if (diff !== 0) return diff;
      if (b.summits !== a.summits) return b.summits - a.summits;
      return b.distanceKm - a.distanceKm;
    });
  }, [rows, sort]);

  const myRank = useMemo(() => {
    const index = sorted.findIndex((row) => row.isMe);
    return index >= 0 ? index + 1 : null;
  }, [sorted]);

  return (
    <div className="page-shell">
      <header className="topbar">
        <div className="brand-block">
          <Link href="/" className="brand brand-link">
            Стежки
          </Link>
          <p className="tagline">хто більше ходить Карпатами</p>
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
          <h1 className="page-title">Лідерборд</h1>
          <p className="page-lead">
            Рейтинг за пішими маршрутами в Українських Карпатах: вершини в радіусі
            200&nbsp;м від треку, кілометри та кількість походів.
          </p>
          {myRank ? (
            <p className="page-meta">Твоє місце: #{myRank}</p>
          ) : null}
        </div>

        {!authed && !loading ? (
          <div className="page-empty">
            <p>Увійди через Strava, щоб побачити рейтинг спільноти.</p>
            <a className="btn btn-primary" href="/api/auth/strava">
              Підключити Strava
            </a>
          </div>
        ) : null}

        {loading ? <p className="page-status">Завантажую…</p> : null}
        {error ? <p className="page-error">{error}</p> : null}

        {authed && !loading && !error ? (
          <>
            <div className="sort-tabs" role="tablist" aria-label="Сортування">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={sort === key}
                  className={`sort-tab${sort === key ? " is-active" : ""}`}
                  onClick={() => setSort(key)}
                >
                  {SORT_LABELS[key]}
                </button>
              ))}
            </div>

            {sorted.length === 0 ? (
              <div className="page-empty">
                <p>Поки немає маршрутів у Карпатах. Онови треки зі Strava на карті.</p>
                <Link className="btn btn-ghost" href="/">
                  На карту
                </Link>
              </div>
            ) : (
              <ol className="leaderboard-list">
                {sorted.map((row, index) => (
                  <li
                    key={row.id}
                    className={`leaderboard-row${row.isMe ? " is-me" : ""}`}
                  >
                    <span className="leaderboard-rank">{index + 1}</span>
                    <span
                      className="leaderboard-swatch"
                      style={{ background: row.color }}
                      aria-hidden
                    />
                    {row.profile ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.profile}
                        alt=""
                        className="leaderboard-avatar"
                      />
                    ) : (
                      <span className="leaderboard-avatar placeholder" />
                    )}
                    <div className="leaderboard-identity">
                      <span className="leaderboard-name">
                        {row.name}
                        {row.isMe ? " · ти" : ""}
                      </span>
                      <span className="leaderboard-sub">
                        {row.routes}{" "}
                        {row.routes === 1
                          ? "маршрут"
                          : row.routes < 5
                            ? "маршрути"
                            : "маршрутів"}
                      </span>
                    </div>
                    <dl className="leaderboard-stats">
                      <div>
                        <dt>Вершини</dt>
                        <dd>{row.summits}</dd>
                      </div>
                      <div>
                        <dt>Км</dt>
                        <dd>{row.distanceKm}</dd>
                      </div>
                      <div>
                        <dt>Набір</dt>
                        <dd>{row.elevationM}&nbsp;м</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
