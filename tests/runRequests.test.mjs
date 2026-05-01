import { describe, expect, it } from "vitest";
import { isAllowedCommand } from "../server/runRequests.mjs";

describe("run request command policy", () => {
  it("allows only the project command allowlist", () => {
    expect(isAllowedCommand("npm run build")).toBe(true);
    expect(isAllowedCommand("npm test")).toBe(true);
    expect(isAllowedCommand("npm install")).toBe(false);
    expect(isAllowedCommand("rm -rf dist")).toBe(false);
    expect(isAllowedCommand("git push")).toBe(false);
  });
});
