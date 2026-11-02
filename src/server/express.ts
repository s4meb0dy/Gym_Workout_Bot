import express from "express";
import { config } from "../config/env";
import { registerHealthSyncRoutes } from "./health-sync";
import { registerWebAppRoutes } from "./webapp-api";

export function createServer(): express.Application {
  const app = express();

  registerHealthSyncRoutes(app);
  registerWebAppRoutes(app);

  app.get(["/healthcheck", "/health"], (_req, res) => {
    res.status(200).send("OK");
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      status: "running",
      service: "gym-telegram-bot",
    });
  });

  return app;
}

export function startServer(app: express.Application): void {
  app.listen(config.port, () => {
    console.log(`Express server listening on port ${config.port}`);
  });
}
