import { config } from "../config/env";

let timer: NodeJS.Timeout | null = null;

/**
 * Періодично пінгує власний публічний URL, щоб хостинг не присипляв процес
 * під час відсутності трафіку (інакше нагадування та бекап не спрацюють).
 *
 * Працює лише якщо задано APP_URL. На платформах, де процес повністю
 * зупиняється при простої (напр. Render Free), додатково налаштуй зовнішній
 * пінгер (cron-job.org) на {APP_URL}/health.
 */
export function startKeepAlive(): void {
  if (!config.appUrl) {
    return;
  }

  const url = `${config.appUrl.replace(/\/$/, "")}/health`;
  const intervalMs = Math.max(1, config.keepAliveMinutes) * 60 * 1000;

  timer = setInterval(() => {
    fetch(url)
      .then(() => undefined)
      .catch((error) => console.error("Keep-alive ping failed:", error));
  }, intervalMs);

  console.log(`Keep-alive enabled: pinging ${url} every ${config.keepAliveMinutes} min.`);
}

export function stopKeepAlive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
