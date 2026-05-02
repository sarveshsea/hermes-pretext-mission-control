import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { publishProjectChanges } from "./publisher.mjs";
import { safeSnippet } from "./redaction.mjs";
import { getCadence } from "./scheduler.mjs";

const DEFAULT_INTERVAL_MS = Number(process.env.PRETEXT_IMPROVEMENT_LOOP_MS || 5 * 60_000);
const DEFAULT_COOLDOWN_MS = Number(process.env.PRETEXT_IMPROVEMENT_COOLDOWN_MS || 5 * 60_000);
const DEFAULT_AUTO_PUBLISH = process.env.PRETEXT_AUTO_PUBLISH !== "false";
const ADAPTIVE = process.env.PRETEXT_IMPROVEMENT_ADAPTIVE !== "false";

let loopTimer = null;
let lastTickAt = null;
let lastCreatedAt = null;
let lastError = "";
let pathOverride = null;

export function setImprovementLoopPathsForTests(paths) {
  pathOverride = paths;
}

function storePath() {
  return pathOverride?.storePath || ROOTS.improvementLoopStore;
}

function markdownPath() {
  return pathOverride?.markdownPath || ROOTS.improvementLoopMarkdown;
}

function changelogPath() {
  return pathOverride?.changelogPath || ROOTS.changelog;
}

function improvementId(now) {
  return `imp_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readEvents() {
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

async function writeEvents(events) {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify({ events }, null, 2), "utf8");
}

function pickImprovement(dashboard) {
  const latestLocal = dashboard.localMessages?.[0]?.body || "";
  if (latestLocal) {
    return {
      title: "Local Console Follow-Through",
      summary: `Improvement loop observed local instruction: ${safeSnippet(latestLocal, 220)}`,
      area: "local-console"
    };
  }

  if (dashboard.publishStatus?.state === "blocked") {
    return {
      title: "Publish Guardrail Visibility",
      summary: `Publish is blocked: ${safeSnippet(dashboard.publishStatus.reason || "unknown", 220)}`,
      area: "github-publish"
    };
  }

  return {
    title: "Pretext Surface Health Pass",
    summary: "Improvement loop reviewed dashboard state and kept the next visible upgrade path in the changelog.",
    area: "dashboard"
  };
}

async function appendChangelog(event) {
  await fs.mkdir(path.dirname(changelogPath()), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(changelogPath(), "utf8");
  } catch {
    existing = "# Changelog\n";
  }

  // Dedup gate: if the most recent heading already has the exact same title
  // AND the same summary as what we're about to write, skip. This stops the
  // 5-minute loop from spamming identical "Local Console Follow-Through"
  // entries when the underlying observation hasn't changed.
  const lastHeadingMatch = existing.match(/##\s+([^\n]+)\n+([\s\S]*?)(?=\n##\s|$)/);
  if (lastHeadingMatch) {
    const lastTitle = lastHeadingMatch[1].trim();
    const lastBody = lastHeadingMatch[2];
    const incomingTitle = `${event.date} - ${event.title}`;
    if (lastTitle === incomingTitle && lastBody.includes(event.summary.slice(0, 80))) {
      return; // identical; skip
    }
  }

  const entry = [
    "",
    `## ${event.date} - ${event.title}`,
    "",
    `- ${event.summary}`,
    `- Publish state: ${event.publishState}.`,
    `- Status: ${event.status}.`,
    ""
  ].join("\n");

  await fs.writeFile(changelogPath(), `${existing.trimEnd()}\n${entry}`, "utf8");
}

async function appendMarkdown(event) {
  await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(markdownPath(), "utf8");
  } catch {
    existing = "# Improvement Loop\n\nAutonomous Pretext improvement observations and publish trail.\n";
  }

  const entry = [
    "",
    `## ${event.date} - ${event.title}`,
    "",
    `- id: ${event.id}`,
    `- area: ${event.area}`,
    `- summary: ${event.summary}`,
    `- Publish state: ${event.publishState}`,
    `- status: ${event.status}`,
    ""
  ].join("\n");

  await fs.writeFile(markdownPath(), `${existing.trimEnd()}\n${entry}`, "utf8");
}

function hasRecentEvent(events, now, cooldownMs) {
  return events.some((event) => now.getTime() - new Date(event.createdAt).getTime() < cooldownMs);
}

export function getImprovementLoopStatus() {
  return {
    state: loopTimer ? "running" : "stopped",
    intervalMs: DEFAULT_INTERVAL_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    autoPublish: DEFAULT_AUTO_PUBLISH,
    lastTickAt,
    lastCreatedAt,
    lastError
  };
}

export async function getImprovementEvents() {
  return readEvents();
}

export async function runImprovementLoopOnce({
  dashboard,
  now = new Date(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
  autoPublish = DEFAULT_AUTO_PUBLISH,
  publish = publishProjectChanges
} = {}) {
  lastTickAt = now.toISOString();
  const events = await readEvents();
  if (hasRecentEvent(events, now, cooldownMs)) return null;

  if (!dashboard) {
    const error = new Error("Improvement loop requires a dashboard payload");
    error.status = 500;
    throw error;
  }
  const payload = dashboard;
  const selected = pickImprovement(payload);
  // Anti-noise: skip the publish-and-commit cycle when this is just the
  // default "Local Console Follow-Through" / "Surface Health Pass" with no
  // real signal change. Those were producing 14+ "Automated Pretext
  // improvement" commits per hour that look like activity but represent no
  // actual code changes — only the data/* working files moving.
  const isLowSignal = selected.title === "Pretext Surface Health Pass" || (
    selected.title === "Local Console Follow-Through" &&
    !payload.localMessages?.[0]?.body
  );
  const event = {
    id: improvementId(now),
    date: now.toISOString().slice(0, 10),
    createdAt: now.toISOString(),
    status: "recorded",
    publishState: payload.publishStatus?.state || "unknown",
    ...selected,
    lowSignal: isLowSignal
  };

  await writeEvents([event, ...events].slice(0, 100));
  if (!isLowSignal) {
    await appendChangelog(event);
    await appendMarkdown(event);
  }
  if (!isLowSignal && autoPublish && payload.publishStatus?.state === "ready") {
    event.publishResult = await publish({
      publishStatus: payload.publishStatus,
      message: `Automated Pretext improvement: ${event.title}`
    });
    await writeEvents([event, ...events].slice(0, 100));
  }
  lastCreatedAt = event.createdAt;
  return event;
}

export function startImprovementLoop({ intervalMs = DEFAULT_INTERVAL_MS, getDashboard } = {}) {
  if (loopTimer) return loopTimer;

  const tick = async () => {
    try {
      if (!getDashboard) return;
      await runImprovementLoopOnce({ dashboard: await getDashboard() });
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Improvement loop failed";
    } finally {
      let next = intervalMs;
      if (ADAPTIVE) {
        try {
          const cadence = await getCadence();
          next = cadence.recommendedIntervalMs;
        } catch {
          next = intervalMs;
        }
      }
      loopTimer = setTimeout(tick, next);
      loopTimer.unref?.();
    }
  };

  loopTimer = setTimeout(tick, 1000);
  loopTimer.unref?.();
  return loopTimer;
}
