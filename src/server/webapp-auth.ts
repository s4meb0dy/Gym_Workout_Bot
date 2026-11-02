import { createHmac, timingSafeEqual } from "crypto";
import express from "express";
import { User } from "@prisma/client";
import { config, isAllowedUser } from "../config/env";
import { findOrCreateUser } from "../services/workout.service";

const MAX_AGE_SECONDS = 24 * 60 * 60;

interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
}

/**
 * Перевірка initData за документацією Telegram Mini Apps: HMAC-SHA256 від усіх полів
 * (крім hash), відсортованих за ключем, з ключем HMAC("WebAppData", BOT_TOKEN).
 */
export function verifyInitData(initData: string): TelegramWebAppUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return null;
  }
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(config.botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const received = Buffer.from(hash, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") ?? "") as TelegramWebAppUser;
    return typeof user.id === "number" ? user : null;
  } catch {
    return null;
  }
}

export interface AuthedLocals {
  user: User;
}

export const requireWebAppUser: express.RequestHandler = async (req, res, next) => {
  try {
    const header = req.header("authorization") ?? "";
    let tgUser: TelegramWebAppUser | null = null;

    if (header.startsWith("tma ")) {
      tgUser = verifyInitData(header.slice(4));
    } else if (config.webappDevUserId != null) {
      tgUser = { id: Number(config.webappDevUserId) };
    }

    if (!tgUser || !isAllowedUser(tgUser.id)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.locals.user = await findOrCreateUser(tgUser.id, tgUser.username, tgUser.first_name);
    next();
  } catch (error) {
    next(error);
  }
};
