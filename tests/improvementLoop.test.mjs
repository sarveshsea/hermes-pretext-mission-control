import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runImprovementLoopOnce,
  setImprovementLoopPathsForTests
} from "../server/improvementLoop.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-improvement-loop-"));
  setImprovementLoopPathsForTests({
    storePath: path.join(tempDir, "improvements.json"),
    markdownPath: path.join(tempDir, "Improvement Loop.md"),
    changelogPath: path.join(tempDir, "CHANGELOG.md")
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  setImprovementLoopPathsForTests(null);
});

describe("improvement loop", () => {
  it("records an improvement event and appends it to the changelog", async () => {
    const event = await runImprovementLoopOnce({
      dashboard: {
        localMessages: [{ body: "Make changelog visible", createdAt: new Date().toISOString() }],
        changelog: [],
        publishStatus: { state: "ready", remote: "https://github.com/sarveshsea/hermes-pretext-mission-control.git" },
        runRequests: []
      },
      now: new Date("2026-04-30T22:30:00Z")
    });

    expect(event.id).toMatch(/^imp_/);
    expect(event.title).toContain("Local Console");
    expect(event.status).toBe("recorded");

    const changelog = await readFile(path.join(tempDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(event.title);
    expect(changelog).toContain("Improvement loop observed");

    const markdown = await readFile(path.join(tempDir, "Improvement Loop.md"), "utf8");
    expect(markdown).toContain(event.id);
    expect(markdown).toContain("Publish state");
  });
});
