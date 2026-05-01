import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approveRunRequest,
  createRunRequest,
  getRunRequests,
  isAllowedCommand,
  setRunRequestStoreForTests
} from "../server/runRequests.mjs";
import {
  _resetHermesEventsForTests,
  setHermesEventsStoreForTests
} from "../server/hermesEvents.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-run-requests-"));
  setRunRequestStoreForTests(path.join(tempDir, "run-requests.json"));
  setHermesEventsStoreForTests(path.join(tempDir, "hermes-events.json"));
  delete process.env.PRETEXT_AUTO_APPROVE;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  setRunRequestStoreForTests(null);
  _resetHermesEventsForTests();
});

describe("run request runner (unlocked)", () => {
  it("treats every command as allowed", () => {
    expect(isAllowedCommand("npm run build")).toBe(true);
    expect(isAllowedCommand("rm -rf /tmp/never-actually-run-this")).toBe(true);
    expect(isAllowedCommand("git push")).toBe(true);
  });

  it("creates a request and persists it as pending for dashboard sources", async () => {
    const request = await createRunRequest({
      command: "echo hello",
      source: "dashboard",
      reason: "smoke"
    });
    expect(request.status).toBe("pending");
    expect(request.allowed).toBe(true);
    expect(request.command).toBe("echo hello");

    const all = await getRunRequests();
    expect(all.find((item) => item.id === request.id)).toBeTruthy();
  });

  it("auto-runs commands when source is hermes and auto-approve is on", async () => {
    process.env.PRETEXT_AUTO_APPROVE = "true";
    const result = await createRunRequest({
      argv: ["node", "-e", "process.stdout.write('ok')"],
      source: "hermes",
      reason: "auto-run"
    });
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("ok");
  });

  it("executes a request through approveRunRequest and captures stdout", async () => {
    const created = await createRunRequest({
      command: "echo unlocked",
      source: "dashboard",
      reason: "manual"
    });
    const result = await approveRunRequest(created.id);
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("unlocked");
  });
});
