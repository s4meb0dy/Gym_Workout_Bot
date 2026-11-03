import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // config/env.ts вимагає BOT_TOKEN при імпорті; локальний .env (якщо є) його перекриє.
    env: { BOT_TOKEN: "123456:TESTtokenForVitest", NODE_ENV: "test" },
  },
});
