import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";
import { listTasks } from "./taskLedger.mjs";
import { listPlans } from "./harness.mjs";
import { getCadence } from "./scheduler.mjs";
import { safeSnippet } from "./redaction.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const TICK_MS = 60 * 60_000; // every hour
const NOTE_PATH = path.join(ROOTS.agent, "Hermes Memory/Distilled.md");
const NOTE_HEADER =
  "# Hermes Distilled Memory\n\nAutonomous hourly distillation of recent activity. Hermes reads this on the next tick to maintain working memory across cron runs.\n\n";

let timer = null;
let lastRunAt = null;

function summarizeTypes(events) {
  const buckets = {};
  for (const event of events) buckets[event.type] = (buckets[event.type] || 0) + 1;
  return Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([type, count]) => `- ${type}: ${count}`)
    .join("\n");
}

async function distill() {
  try {
    const cadence = await getCadence();
    if (cadence.mode === "active") return; // don't write during user-active windows
    const [events, tasks, plans] = await Promise.all([getHermesEvents(500), listTasks(), listPlans(5)]);
    const recent = events.slice(0, 200);
    const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "abandoned");
    const recentPlans = plans.slice(0, 3);
    const lastTelegram = events.find((e) => e.type === "telegram_in");
    const lastReply = events.find((e) => e.type === "telegram_out");
    const body = [
      NOTE_HEADER,
      `_distilled at ${new Date().toISOString()}_`,
      "",
      `## Mode`,
      `- cadence: ${cadence.mode} (idle ${Math.round(cadence.idleSec / 60)}m, throttle ${cadence.throttle})`,
      "",
      `## Recent activity (last 200 events)`,
      summarizeTypes(recent),
      "",
      `## Last user signal`,
      lastTelegram ? `- inbound: ${safeSnippet(lastTelegram.content || "", 200)} _(at ${lastTelegram.createdAt})_` : "- (none)",
      lastReply ? `- outbound: ${safeSnippet(lastReply.content || "", 200)} _(at ${lastReply.createdAt})_` : "",
      "",
      `## Open tasks (${openTasks.length})`,
      openTasks.length === 0 ? "- (none)" : openTasks.slice(0, 8).map((t) => `- [${t.mission}] ${t.title} _(${t.status})_`).join("\n"),
      "",
      `## Recent plans`,
      recentPlans.length === 0
        ? "- (none)"
        : recentPlans
            .map((p) => `- ${p.intent} _(${p.mission}, ${p.status}, ${p.steps.length} steps)_${p.reflection ? `\n    - reflection: ${p.reflection}` : ""}`)
            .join("\n"),
      "",
      "## Read this on every cron tick. Use it to maintain continuity."
    ].join("\n");
    await fs.mkdir(path.dirname(NOTE_PATH), { recursive: true });
    await fs.writeFile(NOTE_PATH, body, "utf8");
    lastRunAt = new Date().toISOString();
    await appendHermesEvent({
      type: "memory_write",
      role: "system",
      content: "distilled memory updated",
      extra: { path: "Agent/Hermes Memory/Distilled.md" }
    });
  } catch {
    // best-effort
  }
}

export function startMemoryConsolidator() {
  if (timer) return timer;
  timer = setInterval(() => void distill(), TICK_MS);
  timer.unref?.();
  // first distillation in 5 minutes
  setTimeout(() => void distill(), 5 * 60_000);
  return timer;
}

export function getMemoryConsolidatorStatus() {
  return { state: timer ? "running" : "stopped", intervalMs: TICK_MS, lastRunAt };
}
