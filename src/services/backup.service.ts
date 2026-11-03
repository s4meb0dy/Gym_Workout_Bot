import { InputFile } from "grammy";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { config } from "../config/env";
import { prisma } from "../db/client";

export function backupExists(): boolean {
  return existsSync(config.databaseFile);
}

/**
 * Консистентний знімок бази через `VACUUM INTO`: копіювання файлу відкритої SQLite
 * під час запису могло дати биту копію. Після надсилання тимчасовий файл треба прибрати.
 */
export async function createBackupFile(): Promise<{ file: InputFile; cleanup: () => void }> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const name = `gymapp-backup-${stamp}.db`;
  const tmp = path.join(tmpdir(), name);
  rmSync(tmp, { force: true });
  await prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  return { file: new InputFile(tmp, name), cleanup: () => rmSync(tmp, { force: true }) };
}
