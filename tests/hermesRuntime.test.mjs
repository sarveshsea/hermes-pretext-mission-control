import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetHermesRuntimeForTests,
  getHermesRuntime,
  recordRuntimeActivity,
  setAutoApprove,
  setHermesModel,
  setHermesRuntimePathForTests
} from "../server/hermesRuntime.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-runtime-"));
  setHermesRuntimePathForTests(path.join(tempDir, "hermes-runtime.json"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  _resetHermesRuntimeForTests();
});

describe("hermes runtime", () => {
  it("returns defaults on first read", async () => {
    const runtime = await getHermesRuntime();
    expect(runtime.model).toBeTruthy();
    expect(runtime.knownModels.length).toBeGreaterThan(0);
  });

  it("persists model switch across reads", async () => {
    await setHermesModel("gpt-oss:20b");
    _resetHermesRuntimeForTests();
    setHermesRuntimePathForTests(path.join(tempDir, "hermes-runtime.json"));
    const runtime = await getHermesRuntime();
    expect(runtime.model).toBe("gpt-oss:20b");
  });

  it("rejects empty model names", async () => {
    await expect(setHermesModel("")).rejects.toThrow();
  });

  it("toggles auto-approve", async () => {
    const runtime = await setAutoApprove(false);
    expect(runtime.autoApprove).toBe(false);
  });

  it("records activity (session, iteration, lastActivityAt)", async () => {
    const runtime = await recordRuntimeActivity({ sessionId: "abc", iteration: 7 });
    expect(runtime.sessionId).toBe("abc");
    expect(runtime.iteration).toBe(7);
    expect(runtime.lastActivityAt).toBeTruthy();
  });
});
