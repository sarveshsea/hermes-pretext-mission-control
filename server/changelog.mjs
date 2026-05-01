import { promises as fs } from "node:fs";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

let changelogPathOverride = null;

export function setChangelogPathForTests(filePath) {
  changelogPathOverride = filePath;
}

function changelogPath() {
  return changelogPathOverride || ROOTS.changelog;
}

function parseHeading(line) {
  const match = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s+-\s+(.+)$/);
  if (!match) return null;
  return {
    date: match[1],
    title: match[2].trim()
  };
}

export function parseChangelog(markdown) {
  const entries = [];
  let current = null;

  for (const line of markdown.split("\n")) {
    const heading = parseHeading(line);
    if (heading) {
      if (current) entries.push(current);
      current = {
        ...heading,
        summary: "",
        bullets: []
      };
      continue;
    }

    if (!current) continue;
    const bullet = line.match(/^-\s+(.+)$/)?.[1]?.trim();
    if (bullet) current.bullets.push(safeSnippet(bullet, 240));
  }

  if (current) entries.push(current);
  return entries.map((entry) => ({
    ...entry,
    summary: safeSnippet(entry.bullets.join(" "), 420)
  }));
}

export async function getChangelog() {
  try {
    const markdown = await fs.readFile(changelogPath(), "utf8");
    return parseChangelog(markdown).slice(0, 12);
  } catch {
    return [];
  }
}
