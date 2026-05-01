import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRunRequest,
  getRunRequests,
  rejectRunRequest,
  setRunRequestStoreForTests
} from "../server/runRequests.mjs";
import { runBuilderLoopOnce } from "../server/builderLoop.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-builder-loop-"));
  setRunRequestStoreForTests(path.join(tempDir, "run-requests.json"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  setRunRequestStoreForTests(null);
});

describe("builder loop run requests", () => {
  it("creates an allowlisted pending run request", async () => {
    const request = await createRunRequest({
      command: "npm run build",
      reason: "Hermes wants to verify the console after a design change",
      source: "telegram"
    });

    expect(request.allowed).toBe(true);
    expect(request.status).toBe("pending");
    expect(request.id).toMatch(/^req_/);

    const requests = await getRunRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].command).toBe("npm run build");
  });

  it("permits any command in unlocked mode (was previously blocked)", async () => {
    const request = await createRunRequest({
      command: "npm install lodash",
      reason: "Hermes wants to install a dep",
      source: "telegram"
    });

    expect(request.allowed).toBe(true);
    expect(request.status).toBe("pending");

    const requests = await getRunRequests();
    expect(requests[0].allowed).toBe(true);
  });

  it("rejects a pending request without running it", async () => {
    const request = await createRunRequest({
      command: "npm test",
      reason: "Hermes requested a test run",
      source: "dashboard"
    });

    const rejected = await rejectRunRequest(request.id, "Not needed right now");

    expect(rejected.status).toBe("rejected");
    expect(rejected.output).toContain("Not needed right now");
  });

  it("queues one autonomous builder heartbeat when the queue is empty", async () => {
    const request = await runBuilderLoopOnce({ autoRun: false });

    expect(request.command).toBe("npm run check");
    expect(request.source).toBe("builder-loop");
    expect(request.status).toBe("pending");

    const second = await runBuilderLoopOnce();
    const requests = await getRunRequests();
    expect(second).toBe(null);
    expect(requests).toHaveLength(1);
  });

  it("can auto-run the safe builder heartbeat through the approval runner", async () => {
    const result = await runBuilderLoopOnce({
      approve: async (id) => ({
        id,
        command: "npm run check",
        source: "builder-loop",
        status: "completed"
      })
    });

    expect(result.command).toBe("npm run check");
    expect(result.source).toBe("builder-loop");
    expect(result.status).toBe("completed");
  });
});
