import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { config } from "../src/config/env";
import { verifyInitData } from "../src/server/webapp-auth";

function sign(fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(config.botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

const now = () => String(Math.floor(Date.now() / 1000));

describe("verifyInitData", () => {
  it("accepts data signed with the bot token", () => {
    const initData = sign({ auth_date: now(), user: JSON.stringify({ id: 42, first_name: "T" }) });
    expect(verifyInitData(initData)?.id).toBe(42);
  });

  it("rejects tampered data", () => {
    const initData = sign({ auth_date: now(), user: JSON.stringify({ id: 42 }) }).replace("42", "43");
    expect(verifyInitData(initData)).toBeNull();
  });

  it("rejects stale data", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3 * 86400);
    expect(verifyInitData(sign({ auth_date: old, user: JSON.stringify({ id: 42 }) }))).toBeNull();
  });
});
