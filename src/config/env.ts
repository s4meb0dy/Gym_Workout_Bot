import dotenv from "dotenv";

dotenv.config({ override: true });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validateBotToken(token: string): string {
  const placeholders = [
    "your_telegram_bot_token_here",
    "0000000000:TEST_TOKEN_FOR_LOCAL_BUILD",
  ];

  if (placeholders.includes(token)) {
    throw new Error(
      "BOT_TOKEN is still a placeholder. Get a real token from @BotFather and paste it into .env",
    );
  }

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error(
      "BOT_TOKEN has invalid format. It should look like 123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    );
  }

  return token;
}

function parseOwnerId(raw: string | undefined): bigint | null {
  const value = raw?.trim();
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("OWNER_TELEGRAM_ID must be a numeric Telegram user id (get it from @userinfobot)");
  }
  return BigInt(value);
}

export const config = {
  botToken: validateBotToken(requireEnv("BOT_TOKEN")),
  ownerTelegramId: parseOwnerId(process.env.OWNER_TELEGRAM_ID),
  port: Number(process.env.PORT ?? 3000),
  restSeconds: Number(process.env.REST_SECONDS ?? 90),
  timezone: process.env.TZ_NAME?.trim() || "Europe/Brussels",
  databaseFile: process.env.DATABASE_FILE?.trim() || "prisma/dev.db",
  enableScheduler: (process.env.ENABLE_SCHEDULER ?? "true").trim() !== "false",
  appUrl: process.env.APP_URL?.trim() || "",
  keepAliveMinutes: Number(process.env.KEEPALIVE_MINUTES ?? 10),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
  // Mini App: фіксована адреса або метрики cloudflared, з яких береться адреса quick tunnel.
  webappUrl: process.env.WEBAPP_URL?.trim() || "",
  tunnelMetricsUrl: process.env.TUNNEL_METRICS_URL?.trim() || "",
  // Лише для локальної розробки: API без Telegram, бот не запускається.
  botDisabled: (process.env.BOT_DISABLED ?? "false").trim() === "true",
  webappDevUserId: process.env.NODE_ENV === "production" ? null : parseOwnerId(process.env.WEBAPP_DEV_USER_ID),
};

/** Бот особистий: якщо OWNER_TELEGRAM_ID задано, усі інші користувачі ігноруються. */
export function isAllowedUser(telegramId: number | bigint): boolean {
  return config.ownerTelegramId == null || BigInt(telegramId) === config.ownerTelegramId;
}

export function getPublicAppUrl(): string {
  if (config.appUrl) {
    return config.appUrl.replace(/\/$/, "");
  }
  return `http://localhost:${config.port}`;
}
