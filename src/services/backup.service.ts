import { InputFile } from "grammy";
import { existsSync } from "fs";
import { config } from "../config/env";

export function backupExists(): boolean {
  return existsSync(config.databaseFile);
}

export function buildBackupFile(): InputFile {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new InputFile(config.databaseFile, `gymapp-backup-${stamp}.db`);
}
