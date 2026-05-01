import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChangelog, setChangelogPathForTests } from "../server/changelog.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "pretext-changelog-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  setChangelogPathForTests(null);
});

describe("changelog", () => {
  it("parses dated changelog entries for the dashboard", async () => {
    const filePath = path.join(tempDir, "CHANGELOG.md");
    await writeFile(
      filePath,
      [
        "# Changelog",
        "",
        "## 2026-04-30 - Pretext Local Console",
        "",
        "- Added dashboard-originated local messages.",
        "- Verification: `npm run check` passed.",
        "",
        "## 2026-04-30 - Pretext Work Trace",
        "",
        "- Added observable work trace.",
        ""
      ].join("\n"),
      "utf8"
    );
    setChangelogPathForTests(filePath);

    const entries = await getChangelog();

    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("Pretext Local Console");
    expect(entries[0].date).toBe("2026-04-30");
    expect(entries[0].summary).toContain("dashboard-originated");
  });
});
