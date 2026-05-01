import { describe, expect, it } from "vitest";
import { buildComposerLines } from "../src/composerModel";

describe("composer model", () => {
  it("formats local agent messages as pretext-visible composer language", () => {
    const lines = buildComposerLines({
      mode: "message",
      value: "build me a tighter agent communication panel",
      busy: false
    });

    expect(lines[0]).toContain("@ LOCAL_CONSOLE");
    expect(lines.join("\n")).toContain("build me a tighter");
    expect(lines.join("\n")).toContain("send");
  });

  it("formats run requests separately from agent messages", () => {
    const lines = buildComposerLines({
      mode: "command",
      value: "npm run check",
      detail: "verify the Pretext surface",
      busy: true
    });

    expect(lines[0]).toContain("$ RUN_REQUEST");
    expect(lines.join("\n")).toContain("npm run check");
    expect(lines.join("\n")).toContain("working");
  });
});
