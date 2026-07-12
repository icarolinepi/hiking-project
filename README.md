# Стежки

Локальний петпроєкт: хайкінг-треки зі Strava на 3D-карті Українських Карпат.

## Що вміє

- вхід через Strava OAuth
- синхронізація лише хайків (Hike) у Postgres
- порівняння маршрутів кількох людей різними кольорами (після того як друзі підключать Strava)
- 3D-карта Українських Карпат (MapLibre + OSM + AWS Terrarium DEM)
- точні межі 11 карпатських масивів
- фільтр за гірським масивом
- 2D/3D перемикач і підсвічені GPS-треки
- український інтерфейс
- усе крутиться в Docker

## Швидкий старт

### 1. Strava API

1. Відкрий [https://www.strava.com/settings/api](https://www.strava.com/settings/api)
2. Створи застосунок
3. **Authorization Callback Domain:** `localhost`
4. Скопіюй Client ID і Client Secret

### 2. Налаштуй `.env`

```bash
cp .env.example .env
```

Заповни:

```env
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
SESSION_SECRET=будь-який-довгий-секрет-мінімум-32-символи
```

### 3. Запуск у Docker

```bash
docker compose up --build
```

Відкрий [http://localhost:3000](http://localhost:3000) → **Підключити Strava**.

Після логіну треки підтягнуться автоматично і з’являться на карті.

## Сервіси

| Сервіс | Порт | Опис |
|--------|------|------|
| `app`  | 3000 | Next.js |
| `db`   | 5432 | PostgreSQL |

## Корисні команди

```bash
# логи
docker compose logs -f app

# лише база
docker compose up db

# зупинити
docker compose down
```

## Локальна розробка без Docker-апа (опційно)

```bash
docker compose up db -d
npm install
npx prisma migrate dev
npm run dev
```

## Структура

- `src/app/api/auth/strava` — OAuth
- `src/app/api/sync` — повторна синхронізація
- `src/app/api/activities/tracks` — polyline для карти
- `src/components/TracksMap.tsx` — Leaflet + OSM
- `prisma/schema.prisma` — User + Activity
