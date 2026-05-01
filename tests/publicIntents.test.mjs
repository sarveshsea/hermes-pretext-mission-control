import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetPublicIntentsForTests,
  createPublicIntent,
  decidePublicIntent,
  getPendingPublicIntents,
  setPublicIntentPathsForTests
} from "../server/publicIntents.mjs";
import {
  _resetHermesEventsForTests,
  setHermesEventsStoreForTests
} from "../server/hermesEvents.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-public-intents-"));
  setPublicIntentPathsForTests({
    storePath: path.join(tempDir, "intents.json"),
    markdownPath: path.join(tempDir, "Public Actions.md")
  });
  setHermesEventsStoreForTests(path.join(tempDir, "hermes-events.json"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  _resetPublicIntentsForTests();
  _resetHermesEventsForTests();
});

describe("public intents", () => {
  it("creates a pending intent and writes the audit markdown", async () => {
    const intent = await createPublicIntent({
      action: "tweet",
      audience: "x.com followers",
      surface: "twitter",
      content: "hot take about react 20",
      legalPosture: "no copyright issue, opinion only",
      reputationPosture: "low risk",
      worstCase: "nobody cares"
    });
    expect(intent.status).toBe("pending");
    expect(intent.decision).toBeNull();

    const md = await readFile(path.join(tempDir, "Public Actions.md"), "utf8");
    expect(md).toContain("Public Actions");
    expect(md).toContain(intent.id);
    expect(md).toContain("tweet");
  });

  it("confirms an intent and flips its status", async () => {
    const intent = await createPublicIntent({ action: "post", audience: "linkedin", surface: "linkedin", content: "x" });
    const decided = await decidePublicIntent(intent.id, { decision: "confirmed" });
    expect(decided.decision).toBe("confirmed");
    expect(decided.status).toBe("approved");
    const pending = await getPendingPublicIntents();
    expect(pending.find((item) => item.id === intent.id)).toBeUndefined();
  });

  it("declines an intent with a reason", async () => {
    const intent = await createPublicIntent({ action: "email", audience: "recruiter", surface: "email", content: "hi" });
    const decided = await decidePublicIntent(intent.id, { decision: "declined", reason: "not now" });
    expect(decided.decision).toBe("declined");
    expect(decided.declineReason).toBe("not now");
    expect(decided.status).toBe("declined");
  });

  it("rejects double-decision", async () => {
    const intent = await createPublicIntent({ action: "x", audience: "y", surface: "z", content: "q" });
    await decidePublicIntent(intent.id, { decision: "confirmed" });
    await expect(decidePublicIntent(intent.id, { decision: "declined" })).rejects.toThrow(/already decided/);
  });

  it("rejects unknown decision values", async () => {
    const intent = await createPublicIntent({ action: "x", audience: "y", surface: "z", content: "q" });
    await expect(decidePublicIntent(intent.id, { decision: "yolo" })).rejects.toThrow(/Invalid decision/);
  });
});
