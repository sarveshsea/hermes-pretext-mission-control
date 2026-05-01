import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalMessage,
  getLocalMessages,
  setLocalMessagePathsForTests
} from "../server/localMessages.mjs";

let tempDir;
let storePath;
let markdownPath;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-local-messages-"));
  storePath = path.join(tempDir, "local-messages.json");
  markdownPath = path.join(tempDir, "Local Console.md");
  setLocalMessagePathsForTests({ storePath, markdownPath });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  setLocalMessagePathsForTests(null);
});

describe("local console messages", () => {
  it("stores dashboard messages for Hermes and mirrors them to Obsidian markdown", async () => {
    const message = await createLocalMessage({
      body: "Draft a tighter node explanation for the console",
      author: "sarv",
      source: "dashboard"
    });

    expect(message.id).toMatch(/^msg_/);
    expect(message.channel).toBe("local-console");
    expect(message.status).toBe("captured");

    const messages = await getLocalMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain("node explanation");

    const markdown = await readFile(markdownPath, "utf8");
    expect(markdown).toContain("Local Console");
    expect(markdown).toContain(message.id);
    expect(markdown).toContain("Draft a tighter node explanation");
  });
});
