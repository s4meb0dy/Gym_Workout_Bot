import express from "express";
import { config } from "../config/env";

export function createServer(): express.Application {
  const app = express();

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
