import { createBot, startBot } from "./bot/bot";
import { createServer, startServer } from "./server/express";
import { setHealthSyncBot } from "./server/health-sync";
import { setWebAppBotApi } from "./server/webapp-api";
import { startScheduler } from "./scheduler/scheduler";
import { startKeepAlive, stopKeepAlive } from "./server/keepalive";
import { config } from "./config/env";
import { prisma } from "./db/client";

async function main() {
  const app = createServer();
  startServer(app);

  if (config.botDisabled) {
    console.log("BOT_DISABLED=true — only the HTTP server is running (local Mini App dev).");
    return;
  }

  startKeepAlive();

  const bot = createBot();
  setHealthSyncBot(bot);
  setWebAppBotApi(bot.api);
  startScheduler(bot);

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    stopKeepAlive();
    try {
      await bot.stop();
    } catch (error) {
      console.error("Error while stopping bot:", error);
    }
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await startBot(bot);
}

main().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});
