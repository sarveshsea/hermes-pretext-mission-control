// One-shot maintenance helpers: batch-concretize the existing 150 noisy
// abstract tasks, and seed a starter set of file-bound dogfood tasks the
// pipeline can ship right now.

import { listTasks, addTask, updateTask } from "./taskLedger.mjs";
import { getCodeIndex, renderIndexBlock } from "./codeIndex.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const CONCRETIZE_MODEL = process.env.PRETEXT_PIPELINE_CONCRETIZE_MODEL || "gpt-oss:20b";

async function concretizeOne(task, indexBlock) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CONCRETIZE_MODEL,
        keep_alive: "24h",
        stream: false,
        format: "json",
        think: false,
        options: { temperature: 0.2, num_predict: 400, num_ctx: 8192 },
        messages: [
          {
            role: "system",
            content:
              "Output JSON only: {component, file_path, target_change, needs_design}. " +
              "file_path must be a real path from the index. needs_design=true means the task is too abstract to map."
          },
          { role: "user", content: `${indexBlock}\n\nTask: [${task.mission}] ${task.title}` }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.message?.content || data.message?.thinking || "";
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch { return null; }
      }
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function batchConcretizeLedger({ limit = 50 } = {}) {
  const open = await listTasks({ status: "open" });
  const candidates = open
    .filter((t) => !t.tags?.includes("needs_design") && !t.pipelineState?.concretize)
    .slice(0, limit);
  const codeIndex = await getCodeIndex();
  const indexBlock = renderIndexBlock(codeIndex);
  let designed = 0;
  let concretized = 0;
  let failed = 0;
  for (const task of candidates) {
    const result = await concretizeOne(task, indexBlock);
    if (!result) {
      failed += 1;
      continue;
    }
    if (result.needs_design === true) {
      await updateTask(task.id, {
        tags: ["needs_design"],
        note: "batch-concretize: needs_design"
      });
      designed += 1;
      continue;
    }
    if (result.file_path && result.target_change) {
      await updateTask(task.id, {
        tags: ["edit-shaped"],
        pipelineState: {
          phase: "concretized",
          concretize: {
            component: result.component || null,
            file_path: result.file_path,
            target_change: result.target_change
          },
          updatedAt: new Date().toISOString()
        },
        note: `batch-concretize: → ${result.file_path}`
      });
      concretized += 1;
    } else {
      failed += 1;
    }
  }
  await appendHermesEvent({
    type: "memory_write",
    role: "system",
    content: `batchConcretize: ${concretized} edit-shaped, ${designed} needs_design, ${failed} failed (of ${candidates.length})`
  });
  return { processed: candidates.length, concretized, designed, failed, totalOpenBefore: open.length };
}

const DOGFOOD_TASKS = [
  {
    title: "Add data-testid to PowerMetricsPanel pane root",
    mission: "design",
    file_path: "src/components/panes/PowerMetricsPanel.tsx",
    target_change: "add data-testid=\"pane-power-metrics\" to the outer .power-metrics div"
  },
  {
    title: "Add data-testid to SessionReportPanel pane root",
    mission: "design",
    file_path: "src/components/panes/SessionReportPanel.tsx",
    target_change: "add data-testid=\"pane-session-report\" to the outer .session-report div"
  },
  {
    title: "Add aria-label to refresh button in SessionReportPanel",
    mission: "design",
    file_path: "src/components/panes/SessionReportPanel.tsx",
    target_change: "add aria-label=\"refresh session report\" to the refresh button"
  },
  {
    title: "Extract chartreuse rgb to CSS variable in styles.css",
    mission: "design",
    file_path: "src/styles.css",
    target_change: "introduce --color-chartreuse variable in :root and replace the first rgb(208, 241, 0) usage with var(--color-chartreuse)"
  },
  {
    title: "Add id anchor to PerformancePanel for #pane-perf deep link",
    mission: "design",
    file_path: "src/components/panes/PerformancePanel.tsx",
    target_change: "add id=\"pane-perf\" attribute to the outermost JSX element"
  },
  {
    title: "Add empty-state to SubscriptionLedgerPanel when array is empty",
    mission: "design",
    file_path: "src/components/panes/SubscriptionLedgerPanel.tsx",
    target_change: "add a length === 0 fallback rendering 'no subscriptions yet' before the .map render"
  },
  {
    title: "Add data-testid to SubagentTreePanel pane root",
    mission: "design",
    file_path: "src/components/panes/SubagentTreePanel.tsx",
    target_change: "add data-testid=\"pane-subagent-tree\" to the outermost element"
  },
  {
    title: "Add data-testid to ObsidianGraphPanel pane root",
    mission: "design",
    file_path: "src/components/panes/ObsidianGraphPanel.tsx",
    target_change: "add data-testid=\"pane-obsidian-graph\" to the outermost element"
  },
  {
    title: "Add aria-label to refresh button in PerformancePanel if present",
    mission: "design",
    file_path: "src/components/panes/PerformancePanel.tsx",
    target_change: "add aria-label to any unlabeled <button> in this file"
  },
  {
    title: "Add data-testid to CodeSearchPanel pane root",
    mission: "design",
    file_path: "src/components/panes/CodeSearchPanel.tsx",
    target_change: "add data-testid=\"pane-code-search\" to the outermost element"
  }
];

export async function seedDogfoodTasks() {
  const created = [];
  for (const seed of DOGFOOD_TASKS) {
    const task = await addTask({
      title: seed.title,
      mission: seed.mission,
      createdBy: "maintenance:dogfood-seed",
      tags: ["edit-shaped", "dogfood"],
      pipelineState: {
        phase: "concretized",
        concretize: { component: null, file_path: seed.file_path, target_change: seed.target_change },
        updatedAt: new Date().toISOString()
      },
      notes: ["dogfood seed — pipeline should ship this"]
    });
    created.push({ id: task.id, title: task.title });
  }
  return { created };
}
