import { describe, expect, it } from "vitest";
import { isExcludedPath, sanitizeText, safeSnippet } from "../server/redaction.mjs";

describe("redaction", () => {
  it("excludes secret-like and build paths", () => {
    expect(isExcludedPath("/tmp/app/.env")).toBe(true);
    expect(isExcludedPath("/tmp/app/node_modules/react/package.json")).toBe(true);
    expect(isExcludedPath("/tmp/app/dist/index.js")).toBe(true);
    expect(isExcludedPath("/tmp/app/src/App.tsx")).toBe(false);
  });

  it("redacts common token shapes and assignments", () => {
    const text = [
      `TELEGRAM_BOT_TOKEN=${"1234567890:"}${"FAKE_REDACTION_TOKEN_VALUE_ONLY_12345"}`,
      `TAVILY_API_KEY=${"tvly-dev-"}${"FAKE_REDACTION_KEY_1234567890abcdef"}`,
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456789"
    ].join("\n");

    const sanitized = sanitizeText(text);
    expect(sanitized).not.toContain("FAKE_REDACTION_TOKEN");
    expect(sanitized).not.toContain("tvly-dev");
    expect(sanitized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(sanitized).toContain("[REDACTED]");
  });

  it("bounds snippets", () => {
    expect(safeSnippet("x".repeat(100), 20)).toHaveLength(20);
    expect(safeSnippet("x".repeat(100), 20).endsWith("…")).toBe(true);
  });
});
