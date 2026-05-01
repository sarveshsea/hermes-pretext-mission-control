import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getBuilderLoopStatus } from "./builderLoop.mjs";
import { getImprovementLoopStatus } from "./improvementLoop.mjs";
import { getAutoApplyStatus } from "./autoApply.mjs";
import { getOllamaWarmStatus } from "./ollamaWarm.mjs";
import { getMemoryConsolidatorStatus } from "./memoryConsolidate.mjs";

async function readCronJobs() {
  try {
    const text = await fs.readFile(path.join(ROOTS.hermes, "cron/jobs.json"), "utf8");
    const parsed = JSON.parse(text);
    return (parsed.jobs || []).map((job) => ({
      id: job.id,
      name: job.name,
      everyMinutes: job.schedule?.minutes ?? null,
      enabled: job.enabled,
      state: job.state,
      model: job.model,
      lastRunAt: job.last_run_at,
      lastStatus: job.last_status,
      lastError: job.last_error,
      nextRunAt: job.next_run_at,
      completed: job.repeat?.completed ?? 0,
      workdir: job.workdir
    }));
  } catch {
    return [];
  }
}

export async function getProcessSummary() {
  const [builder, improvement, autoApply, ollamaWarm, memory, crons] = await Promise.all([
    Promise.resolve(getBuilderLoopStatus()),
    Promise.resolve(getImprovementLoopStatus()),
    Promise.resolve(getAutoApplyStatus()),
    Promise.resolve(getOllamaWarmStatus()),
    Promise.resolve(getMemoryConsolidatorStatus()),
    readCronJobs()
  ]);

  const processes = [
    {
      id: "builder-loop",
      label: "builder",
      state: builder.state,
      detail: `every ${Math.round(builder.intervalMs / 60_000)}m · cooldown ${Math.round(builder.cooldownMs / 60_000)}m · auto=${builder.autoRun ? "on" : "off"}`,
      lastAt: builder.lastTickAt,
      lastError: builder.lastError || null
    },
    {
      id: "improvement-loop",
      label: "improvement",
      state: improvement.state,
      detail: `auto-publish=${improvement.autoPublish ? "on" : "off"} · cooldown ${Math.round(improvement.cooldownMs / 60_000)}m`,
      lastAt: improvement.lastTickAt,
      lastError: improvement.lastError || null
    },
    {
      id: "auto-apply",
      label: "auto-apply",
      state: autoApply.state,
      detail: `every ${Math.round(autoApply.intervalMs / 1000)}s · ${autoApply.recentlyApplied?.length ?? 0} recent`,
      lastAt: autoApply.lastTickAt,
      lastError: null
    },
    {
      id: "ollama-warm",
      label: "ollama warm",
      state: ollamaWarm.state,
      detail: `keep-alive ${ollamaWarm.keepAlive} · ${ollamaWarm.models?.join(", ") || "?"}`,
      lastAt: ollamaWarm.lastPingAt,
      lastError: ollamaWarm.lastPingResult?.includes("err") ? ollamaWarm.lastPingResult : null
    },
    {
      id: "memory-consolidator",
      label: "memory consolidate",
      state: memory.state,
      detail: `every ${Math.round(memory.intervalMs / 60_000)}m`,
      lastAt: memory.lastRunAt,
      lastError: null
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    processes,
    crons
  };
}
