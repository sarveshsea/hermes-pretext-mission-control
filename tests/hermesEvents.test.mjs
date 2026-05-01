import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetHermesEventsForTests,
  appendHermesEvent,
  getHermesEvents,
  setHermesEventsStoreForTests,
  subscribeHermesEvents
} from "../server/hermesEvents.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-hermes-events-"));
  setHermesEventsStoreForTests(path.join(tempDir, "hermes-events.json"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  _resetHermesEventsForTests();
});

describe("hermes events", () => {
  it("appends and replays events newest-first", async () => {
    await appendHermesEvent({ type: "telegram_in", role: "user", content: "first" });
    await appendHermesEvent({ type: "telegram_out", role: "assistant", content: "reply" });
    const events = await getHermesEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("telegram_out");
    expect(events[1].type).toBe("telegram_in");
  });

  it("persists events to disk", async () => {
    const event = await appendHermesEvent({ type: "model_call", model: "gemma4:e4b" });
    const text = await readFile(path.join(tempDir, "hermes-events.json"), "utf8");
    const parsed = JSON.parse(text);
    expect(parsed.events.find((item) => item.id === event.id)).toBeTruthy();
  });

  it("redacts secret-shaped content", async () => {
    const event = await appendHermesEvent({
      type: "note",
      content: "leak: ghp_aaaabbbbccccddddeeeeffffgggghhhhiiiijj"
    });
    expect(event.content).not.toContain("ghp_aaaabbbb");
  });

  it("notifies subscribers", async () => {
    const seen = [];
    const off = subscribeHermesEvents((event) => seen.push(event.type));
    await appendHermesEvent({ type: "iteration_tick", iteration: 5 });
    off();
    expect(seen).toContain("iteration_tick");
  });

  it("falls back to 'note' for unknown types", async () => {
    const event = await appendHermesEvent({ type: "weird-thing", content: "x" });
    expect(event.type).toBe("note");
  });
});
