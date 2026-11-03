import { StorageAdapter } from "grammy";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

/**
 * Сесії бота (відкладені/пропущені вправи, жива картка тренування) у JSON-файлі,
 * щоб рестарт pm2 посеред тренування їх не губив. Бот особистий — файл крихітний.
 */
export class JsonFileStorage<T> implements StorageAdapter<T> {
  private data: Record<string, T>;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      this.data = existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as Record<string, T>) : {};
    } catch (error) {
      console.error("Session file is corrupted, starting fresh:", error);
      this.data = {};
    }
  }

  read(key: string): T | undefined {
    return this.data[key];
  }

  write(key: string, value: T): void {
    this.data[key] = value;
    this.scheduleFlush();
  }

  delete(key: string): void {
    delete this.data[key];
    this.scheduleFlush();
  }

  /** Записуємо пачкою й атомарно (через тимчасовий файл), щоб не зіпсувати JSON при падінні. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file);
    }, 500);
  }
}
