# Gym Telegram Bot

Автономний Telegram-бот для відстеження силових тренувань з автоматичним розрахунком прогресії робочої ваги.

## Стек

- **Node.js + TypeScript**
- **grammY** — Telegram Bot API
- **Prisma ORM + SQLite** — локальна база даних
- **Express** — healthcheck для безкоштовного хостингу (Render)

## Швидкий старт (локально)

### 1. Клонування та ініціалізація

```bash
cd GymApp
npm install
```

### 2. Налаштування змінних середовища

```bash
copy .env.example .env
```

Відредагуй `.env` і встав токен бота від [@BotFather](https://t.me/BotFather):

```env
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
PORT=3000
DATABASE_URL="file:./dev.db"
```

### 3. Створення бази даних та seed програми

```bash
npx prisma migrate dev --name init
npm run db:seed
```

### 4. Запуск

**Режим розробки (з hot-reload):**

```bash
npm run dev
```

**Production-білд:**

```bash
npm run build
npm start
```

Перевір healthcheck: [http://localhost:3000/healthcheck](http://localhost:3000/healthcheck) — має повернути `OK`.

## Команди npm

| Скрипт | Опис |
|--------|------|
| `npm run dev` | Запуск у режимі розробки |
| `npm run build` | Компіляція TypeScript → `dist/` |
| `npm start` | Запуск зібраного додатку |
| `npm run db:migrate` | Prisma migrate dev |
| `npm run db:push` | Синхронізація схеми без міграції |
| `npm run db:seed` | Заповнення 4-денної програми |
| `npm run db:reseed` | Примусове оновлення програми (очистить історію тренувань) |
| `npm run db:setup` | migrate deploy + seed (для Render) |

## Структура проєкту

```
GymApp/
├── prisma/
│   ├── schema.prisma      # Моделі: User, WorkoutDay, Exercise, WorkoutSession, Set
│   ├── workout-program.ts # Фінальна 4-денна програма (Пн/Ср/Пт/Нд)
│   └── seed.ts            # Автоматичне занесення програми в SQLite
├── src/
│   ├── index.ts           # Точка входу (Express + Bot)
│   ├── config/env.ts      # Конфігурація
│   ├── db/client.ts       # Prisma client
│   ├── server/express.ts  # GET /healthcheck
│   ├── services/
│   │   ├── progression.ts # Розрахунок прогресії ваги
│   │   └── workout.service.ts
│   └── bot/
│       ├── bot.ts
│       ├── keyboards.ts
│       └── handlers/
├── package.json
└── tsconfig.json
```

## Логіка прогресії

- Якщо на **минулому тренуванні** у всіх робочих підходах вправи виконано **верхню межу** цільових повторень → бот пропонує **+2.5 кг** (верх тіла) або **+5 кг** (ноги).
- Якщо ціль не досягнута → **вага без змін**, бот пропонує зробити більше повторень.

## Розгортання на Render (безкоштовно)

1. Створи **Web Service** на [render.com](https://render.com).
2. Підключи GitHub-репозиторій.
3. Налаштування:
   - **Build Command:** `npm install && npm run build && npm run db:setup`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     - `BOT_TOKEN` — токен від BotFather
     - `DATABASE_URL` — `file:./dev.db`
     - `PORT` — Render встановлює автоматично
4. Render періодично пінгує ваш сервіс; ендпоінт `/healthcheck` тримає процес активним.

> **Примітка:** На безкоштовному Render файли SQLite можуть скидатися при redeploy. Для production краще перейти на PostgreSQL (Render має безкоштовний tier).

## Використання бота

1. `/start` — головне меню
2. **Розпочати тренування** → обери день 1–4
3. Вводь підходи у форматі `60x10` або `60 x 10`
4. **Таймер відпочинку** — опційний 90-секундний таймер
5. **Фініш** — підсумок (тоннаж, підходи, рекорди)

## Telegram-команди

- `/start` — головне меню
- `/workout` — розпочати тренування
- `/program` — переглянути програму
- `/stats` — статистика та рекорди
