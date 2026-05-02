// One-shot maintenance helpers: batch-concretize the existing 150 noisy
// abstract tasks, and seed a starter set of file-bound dogfood tasks the
// pipeline can ship right now.

import { listTasks, addTask, updateTask } from "./taskLedger.mjs";
import { getCodeIndex, renderIndexBlock } from "./codeIndex.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { runOllama } from "./ollamaQueue.mjs";
import { createPlan } from "./harness.mjs";

const CONCRETIZE_MODEL = process.env.PRETEXT_PIPELINE_CONCRETIZE_MODEL || "gemma4:e4b";

async function concretizeOne(task, indexBlock) {
  try {
    const data = await runOllama({
      model: CONCRETIZE_MODEL,
      endpoint: "/api/chat",
      timeoutMs: 90_000,
      body: {
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
      }
    });
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
  }
}

// Drain the task-recursion graveyard. Most "consolidate Master Task Plan" /
// "review rejection feedback" / "finalize audit" tasks are duplicates of
// duplicates. Cluster by (mission + first 3 lowercased title tokens); abandon
// all but oldest in each cluster of size >5; tag survivor recursion-survivor
// so the pipeline can't pick it again without explicit promote.
export async function drainRecursion({ minClusterSize = 5 } = {}) {
  const open = await listTasks({ status: "open" });
  if (open.length < minClusterSize) return { drained: 0, clustersFound: 0, openBefore: open.length };
  const buckets = new Map();
  for (const task of open) {
    const tokens = (task.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .slice(0, 3);
    const key = `${task.mission}::${tokens.join("-")}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(task);
  }
  let drained = 0;
  let clustersFound = 0;
  for (const [key, group] of buckets) {
    if (group.length <= minClusterSize) continue;
    clustersFound += 1;
    const sorted = group.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keeper = sorted[0];
    await updateTask(keeper.id, {
      tags: ["recursion-survivor"],
      note: `survivor of ${group.length}-task cluster (${key.split("::")[1]})`
    });
    for (const dupe of sorted.slice(1)) {
      await updateTask(dupe.id, {
        status: "abandoned",
        note: `drained as recursion (cluster: ${key.split("::")[1]}, kept ${keeper.id})`
      });
      drained += 1;
    }
  }
  await appendHermesEvent({
    type: "memory_write",
    role: "system",
    content: `drainRecursion: ${drained} drained across ${clustersFound} clusters (of ${open.length} open)`
  });
  return { drained, clustersFound, openBefore: open.length };
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

// Dogfood seeds. All target files must:
//  (a) currently lack data-testid (verified at seed time)
//  (b) have a UNIQUE find anchor (the export default function signature)
// The pipeline replaces "export default function X(...) {" with the same +
// extra return prefix injecting data-testid. Keeps find strings unique.
const DOGFOOD_TASKS = [
  {
    title: "Add data-testid pane-mission to MissionPanel",
    mission: "design",
    file_path: "src/components/panes/MissionPanel.tsx",
    target_change: "in MissionPanel.tsx, find the outermost JSX <div> in the return statement and add data-testid=\"pane-mission\""
  },
  {
    title: "Add data-testid pane-hermes-live to HermesLivePanel",
    mission: "design",
    file_path: "src/components/panes/HermesLivePanel.tsx",
    target_change: "in HermesLivePanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-hermes-live\""
  },
  {
    title: "Add data-testid pane-themed to ThemedSurfacesPanel",
    mission: "design",
    file_path: "src/components/panes/ThemedSurfacesPanel.tsx",
    target_change: "in ThemedSurfacesPanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-themed\""
  },
  {
    title: "Add data-testid pane-changelog to ChangelogPanel",
    mission: "design",
    file_path: "src/components/panes/ChangelogPanel.tsx",
    target_change: "in ChangelogPanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-changelog\""
  },
  {
    title: "Add data-testid pane-git to GitStatePanel",
    mission: "design",
    file_path: "src/components/panes/GitStatePanel.tsx",
    target_change: "in GitStatePanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-git\""
  },
  {
    title: "Add data-testid pane-improve to ImprovementLoopPanel",
    mission: "design",
    file_path: "src/components/panes/ImprovementLoopPanel.tsx",
    target_change: "in ImprovementLoopPanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-improve\""
  },
  {
    title: "Add data-testid pane-skills to SkillsPanel",
    mission: "design",
    file_path: "src/components/panes/SkillsPanel.tsx",
    target_change: "in SkillsPanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-skills\""
  },
  {
    title: "Add data-testid pane-memory to MemoryPanel",
    mission: "design",
    file_path: "src/components/panes/MemoryPanel.tsx",
    target_change: "in MemoryPanel.tsx, find the outermost JSX element in the return statement and add data-testid=\"pane-memory\""
  },
  {
    title: "Add data-testid to GoalsPanel root",
    mission: "design",
    file_path: "src/components/panes/GoalsPanel.tsx",
    target_change: "add data-testid=\"pane-goals\" to the outer .goals-pane div"
  },
  // === Communication-focused dogfood tasks (per Sarvesh's directive) ===
  // These target what each pane EXPLAINS to the operator, not just structural
  // attributes. The pipeline picks these and adds tooltips, captions, and
  // empty-state copy that helps Sarvesh understand what's happening.
  {
    title: "Add aria-label to refresh button in PowerMetricsPanel",
    mission: "design",
    file_path: "src/components/panes/PowerMetricsPanel.tsx",
    target_change: "add aria-label to any unlabeled <button> describing the refresh action"
  },
  {
    title: "Add a helpful empty-state caption to GoalsPanel when goals are empty",
    mission: "design",
    file_path: "src/components/panes/GoalsPanel.tsx",
    target_change: "extend the empty-state div to include a short helper line: \"Edit ~/.hermes/memories/goals.md and reload to populate.\""
  },
  {
    title: "Add a `title` attribute to the .pane-bar count in PlaybookScoreboardPanel",
    mission: "design",
    file_path: "src/components/panes/PlaybookScoreboardPanel.tsx",
    target_change: "find the count display and add title=\"successes / total attempts\" so hover explains it"
  },
  {
    title: "Add aria-live polite to LiveTimeline for screen readers",
    mission: "design",
    file_path: "src/components/LiveTimeline.tsx",
    target_change: "ensure the timeline list element has aria-live=\"polite\" so updates are announced"
  },
  {
    title: "Add helpful empty-state to OllamaQueuePanel when no model traffic",
    mission: "design",
    file_path: "src/components/panes/OllamaQueuePanel.tsx",
    target_change: "extend the no-traffic empty state to mention \"models warm up after first request\""
  },
  {
    title: "Add data-testid pane-delegation-inbox helper text",
    mission: "design",
    file_path: "src/components/panes/DelegationInboxPanel.tsx",
    target_change: "in the no-pending empty state, add a one-liner: \"Hermes auto-fires Claude Code unless an intent matches a danger pattern.\""
  },
  {
    title: "Add a tooltip explaining the pipeline-river phase columns",
    mission: "design",
    file_path: "src/components/PipelineRiver.tsx",
    target_change: "add title attribute to .pr-label spans summarizing what each phase does"
  },
  {
    title: "Add aria-label to refresh button in OllamaQueuePanel",
    mission: "design",
    file_path: "src/components/panes/OllamaQueuePanel.tsx",
    target_change: "if there is a refresh button add aria-label, otherwise add a small visible refresh hint"
  },
  {
    title: "Caption AGENT_INTENT lane in WhyStrip with a one-line meaning",
    mission: "design",
    file_path: "src/components/WhyStrip.tsx",
    target_change: "add a title attribute to the AGENT INTENT label explaining \"what the agent wants to do that is awaiting your approval\""
  },
  {
    title: "Make timestamps in AgentVoicePanel relative (e.g. 5s ago) when fresh",
    mission: "design",
    file_path: "src/components/panes/AgentVoicePanel.tsx",
    target_change: "when the event is < 5min old, render the time as a relative phrase like \"5s ago\" rather than HH:MM:SS"
  },
  {
    title: "Add data-testid to PlaybookScoreboardPanel root",
    mission: "design",
    file_path: "src/components/panes/PlaybookScoreboardPanel.tsx",
    target_change: "add data-testid=\"pane-playbook-scoreboard\" to the outer .playbook-scoreboard div"
  },
  {
    title: "Add data-testid to RunningProcessesPanel root",
    mission: "design",
    file_path: "src/components/panes/RunningProcessesPanel.tsx",
    target_change: "add data-testid=\"pane-running-processes\" to the outermost JSX element"
  },
  {
    title: "Add aria-label to refresh button in CodeSearchPanel",
    mission: "design",
    file_path: "src/components/panes/CodeSearchPanel.tsx",
    target_change: "add aria-label to any unlabeled <button> in this file"
  },
  {
    title: "Add id anchor to LocalConsolePanel for #pane-local",
    mission: "design",
    file_path: "src/components/panes/LocalConsolePanel.tsx",
    target_change: "add id=\"pane-local\" to the outermost JSX element"
  },
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

// Multi-step plan seeds. The pipeline's planAdvance phase reads task.plan_id
// and advances ONE step per tick, so multi-tick work compounds across hours.
const PLAN_SEEDS = [
  {
    intent: "Audit Material Design 3 + record findings + write Obsidian note",
    mission: "design",
    steps: [
      "code_search 'material' across src to see what already references it",
      "read existing Antimetal.md + Raycast.md notes for shape",
      "write Agent/Design Library/Material-3.md with Posture/Color/Type/Spacing/Motion sections",
      "commit with title 'Material 3 design audit note'"
    ]
  },
  {
    intent: "Drain task ledger duplicates and tag survivors",
    mission: "general",
    steps: [
      "list all open tasks; bucket by first 5 lowercased title tokens",
      "abandon all but oldest in each bucket >2",
      "tag survivors as edit-shaped or needs_design"
    ]
  },
  {
    intent: "Buzzr launch readiness sweep",
    mission: "buzzr",
    steps: [
      "list 5 underserved micro-fan communities (NCAA conference fans, NHL niche, MLS supporter groups)",
      "draft tweet for each via post_buzzr_draft",
      "compile shortlist into Agent/Buzzr/Launch-Shortlist.md",
      "open contact-add tasks for top 10 handles"
    ]
  },
  {
    intent: "Memoire app: 5 design system audits",
    mission: "memoire",
    steps: [
      "audit Day One (journaling)",
      "audit Notion (capture)",
      "audit Obsidian (linking)",
      "audit Daylio (mood tracking)",
      "synthesize Agent/Memoire Audits/Synthesis.md"
    ]
  },
  {
    intent: "Add data-testid to 6 remaining panes for E2E",
    mission: "design",
    steps: [
      "edit ThemedSurfacesPanel — add data-testid",
      "edit MissionPanel — add data-testid",
      "edit MemoryPanel — add data-testid",
      "edit GitStatePanel — add data-testid",
      "edit ChangelogPanel — add data-testid",
      "edit ImprovementLoopPanel — add data-testid"
    ]
  }
];

export async function seedMultiStepPlans() {
  const created = [];
  for (const seed of PLAN_SEEDS) {
    try {
      const plan = await createPlan({
        intent: seed.intent,
        mission: seed.mission,
        steps: seed.steps
      });
      // Create a parent task that references the plan_id so the pipeline picks it up.
      const task = await addTask({
        title: `Plan: ${seed.intent.slice(0, 80)}`,
        mission: seed.mission,
        createdBy: "maintenance:plan-seed",
        tags: ["multi-step", "plan-parent"],
        notes: [`plan_id: ${plan.id}`, `${seed.steps.length} steps`]
      });
      // Stash plan_id on the task so pickTask can find it.
      await updateTask(task.id, { pipelineState: { phase: "plan", plan_id: plan.id, currentStep: 0, updatedAt: new Date().toISOString() } });
      created.push({ planId: plan.id, taskId: task.id, intent: seed.intent });
    } catch (error) {
      created.push({ error: error?.message || "plan create failed", intent: seed.intent });
    }
  }
  return { created };
}
