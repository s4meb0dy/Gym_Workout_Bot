import { useEffect } from "react";

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const tg: TelegramWebApp | undefined = window.Telegram?.WebApp;

export function initTelegram(background: string): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  tg.setHeaderColor(background);
  tg.setBackgroundColor(background);
}

/** Нативна кнопка «Назад» Telegram для вкладених екранів. */
export function useBackButton(onBack: (() => void) | null): void {
  useEffect(() => {
    const button = tg?.BackButton;
    if (!button || !onBack) return;
    button.show();
    button.onClick(onBack);
    return () => {
      button.offClick(onBack);
      button.hide();
    };
  }, [onBack]);
}

export const haptic = {
  tap: () => tg?.HapticFeedback?.selectionChanged(),
  impact: () => tg?.HapticFeedback?.impactOccurred("medium"),
  success: () => tg?.HapticFeedback?.notificationOccurred("success"),
  warning: () => tg?.HapticFeedback?.notificationOccurred("warning"),
};

/** Підтвердження через нативний діалог Telegram, у браузері — window.confirm. */
export function confirmAction(message: string): Promise<boolean> {
  if (tg?.initData) {
    return new Promise((resolve) => tg.showConfirm(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}
