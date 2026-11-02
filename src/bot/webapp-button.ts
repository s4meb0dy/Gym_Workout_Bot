import { Api } from "grammy";
import { config } from "../config/env";

const REFRESH_MS = 2 * 60 * 1000;

let currentUrl: string | null = null;

export function getWebAppUrl(): string | null {
  return currentUrl;
}

/**
 * Адреса Mini App: WEBAPP_URL, або адреса cloudflared quick tunnel з його метрик
 * (/quicktunnel). Quick tunnel міняє адресу після рестарту, тож її перечитуємо.
 */
async function resolveWebAppUrl(): Promise<string | null> {
  if (config.webappUrl) {
    return config.webappUrl.replace(/\/?$/, "/");
  }
  if (!config.tunnelMetricsUrl) {
    return null;
  }

  try {
    const res = await fetch(`${config.tunnelMetricsUrl.replace(/\/$/, "")}/quicktunnel`);
    const data = (await res.json()) as { hostname?: string };
    return data.hostname ? `https://${data.hostname}/app/` : null;
  } catch {
    return null;
  }
}

async function refreshMenuButton(api: Api): Promise<void> {
  const url = await resolveWebAppUrl();
  if (!url || url === currentUrl) {
    return;
  }

  await api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Тренування", web_app: { url } },
  });
  currentUrl = url;
  console.log(`Mini App menu button → ${url}`);
}

export function startWebAppMenuButton(api: Api): void {
  if (!config.webappUrl && !config.tunnelMetricsUrl) {
    console.log("Mini App disabled (set WEBAPP_URL or TUNNEL_METRICS_URL).");
    return;
  }

  const run = () =>
    refreshMenuButton(api).catch((error) => console.error("Mini App menu button update failed:", error));
  void run();
  if (!config.webappUrl) {
    setInterval(run, REFRESH_MS);
  }
}
