import { Api } from "grammy";
import { formatRestDuration } from "../services/progression";

const restTimers = new Map<number, NodeJS.Timeout>();

export function clearRest(chatId: number): void {
  const timer = restTimers.get(chatId);
  if (timer) {
    clearTimeout(timer);
    restTimers.delete(chatId);
  }
}

/**
 * Після відпочинку надсилає нове повідомлення (а не редагує старе) — щоб прилетів
 * push на телефон, навіть коли бот чи Mini App згорнуті.
 */
export function scheduleRest(api: Api, chatId: number, seconds: number): void {
  clearRest(chatId);
  if (seconds <= 0) {
    return;
  }

  restTimers.set(
    chatId,
    setTimeout(() => {
      restTimers.delete(chatId);
      api
        .sendMessage(
          chatId,
          `🔔 Відпочинок ${formatRestDuration(seconds)} завершено — вперед на наступний підхід!`,
        )
        .catch(() => undefined);
    }, seconds * 1000),
  );
}
