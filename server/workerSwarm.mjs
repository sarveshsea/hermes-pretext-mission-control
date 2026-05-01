// Parallel autonomous worker swarm.
//
// Replaces the single continuousWorker that produced the same narration every
// tick because the prompt + model + interval were identical. The swarm runs 6
// specialized workers in parallel, each with its own short directive prompt,
// its own cadence, and its own action verb. Each worker uses Ollama's JSON
// mode (format: "json") so structured output is guaranteed. When parsing or
// the model fails, the worker still posts a deterministic event so the
// dashboard never goes quiet.

import { execFile } from "node:child_process";
import { appendHermesEvent, getHermesEvents } from "./hermesEvents.mjs";
import { listTasks, addTask, updateTask } from "./taskLedger.mjs";
import { postThemedItem } from "./themedSurfaces.mjs";
import { writeNote } from "./obsidian.mjs";
import { safeSnippet } from "./redaction.mjs";
import { spawnSubagent, updateSubagent, listSubagents } from "./subagents.mjs";
import { getSharedContext, formatSharedContextBlock } from "./swarmContext.mjs";
import { ROOTS } from "./config.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.PRETEXT_SWARM_MODEL || "gemma4:e4b";

const WORKERS = [
  {
    id: "observer",
    label: "observer",
    intervalMs: 18_000,
    mission: "general",
    system:
      "You are the OBSERVER worker. Watch the dashboard's recent events and state. " +
      "Output one observation about what is changing or notable. Return JSON with keys: " +
      '{"thinking": "<one short sentence>", "finding": "<one observation, ≤ 140 chars>", "area": "<dashboard|cron|cadence|publish|ledger>"}.'
  },
  {
    id: "design",
    label: "design",
    intervalMs: 35_000,
    mission: "design",
    system:
      "You are the DESIGN worker. Propose ONE small dashboard visual refinement to add as a task. " +
      "Return JSON: " +
      '{"thinking": "<one short sentence>", "title": "<task title, ≤ 80 chars>", "rationale": "<why, ≤ 120 chars>"}.'
  },
  {
    id: "buzzr",
    label: "buzzr",
    intervalMs: 45_000,
    mission: "buzzr",
    system:
      "You are the BUZZR copywriter. Draft ONE punchy launch tweet for Buzzr — a mobile sports app for micro-fan communities (NFL/NBA/MLS). " +
      "Voice: Sarvesh-as-founder, confident, specific, no hashtag spam, ≤ 220 chars. " +
      'Return JSON: {"thinking": "<short reason for this angle>", "text": "<tweet draft>", "audience": "<x.com followers|sports fans|founders>"}.'
  },
  {
    id: "memoire",
    label: "memoire",
    intervalMs: 55_000,
    mission: "memoire",
    system:
      "You are the MEMOIRE audit worker. Suggest ONE design system or app to audit for Memoire (a memory/journal app). " +
      'Return JSON: {"thinking": "<short reason>", "slug": "<short-slug>", "source": "<system or URL>", "summary": "<one-line audit angle>"}.'
  },
  {
    id: "autofix",
    label: "autofix",
    intervalMs: 35_000,
    mission: "autofix",
    system:
      "You are the AUTOFIX worker. Look at recent run_result and error events; pick a small, concrete fix idea. " +
      'Return JSON: {"thinking": "<one sentence>", "title": "<task title>", "area": "<area being fixed>"}.'
  },
  {
    id: "obsidian",
    label: "obsidian",
    intervalMs: 55_000,
    mission: "obsidian",
    system:
      "You are the OBSIDIAN gardener. Suggest ONE small vault improvement (index note, link cleanup, new section). " +
      'Return JSON: {"thinking": "<short reason>", "title": "<task title>", "path_hint": "<relative vault path>"}.'
  },
  {
    id: "planner",
    label: "planner",
    intervalMs: 50_000,
    mission: "general",
    system:
      "You are the PLANNER. Read the open ledger and recent events; identify ONE multi-step plan that breaks a large task into 3-5 sub-tasks. " +
      'Return JSON: {"thinking": "<one sentence>", "parent_title": "<the larger goal>", "subtasks": ["sub 1", "sub 2", "sub 3"], "mission": "<mission name>"}.'
  },
  {
    id: "critic",
    label: "critic",
    intervalMs: 40_000,
    mission: "general",
    system:
      "You are the CRITIC. Look at recent thinking and proposals; flag ONE thing that is unclear, redundant, or low-value. " +
      'Return JSON: {"thinking": "<one sentence>", "target": "<what is flawed>", "critique": "<≤ 140 chars>", "suggestion": "<≤ 120 chars>"}.'
  },
  {
    id: "sports",
    label: "sports",
    intervalMs: 40_000,
    mission: "sports",
    system:
      "You are the SPORTS RADAR worker. Surface ONE notable storyline from a major league (NFL / NBA / MLS / NCAA / MLB). " +
      "Pull from your training (you don't have live web). Pick something fresh-feeling and angle-able for a sports app. " +
      'Return JSON: {"thinking": "<one sentence>", "league": "<NFL|NBA|MLS|NCAA|MLB>", "headline": "<≤ 140 chars>", "source": "<imagined outlet name>"}.'
  },
  // Note: the old `executor` and `selfimprove` workers were removed. Their job
  // (turning a task into a shell pipeline) produced 100% rejection because the
  // model can't produce real diffs through freeform shell. They are replaced
  // by the chained pipeline worker (server/pipelineWorker.mjs) which uses
  // structured kind:"edit" proposals + playbooks instead.
  {
    id: "closer",
    label: "closer",
    intervalMs: 30_000,
    mission: "general",
    deterministic: true,
    system: "Deterministic worker — no LLM call. Closes tasks whose titles match recent commit subjects; archives stale opens."
  },
  {
    id: "dedup",
    label: "dedup",
    intervalMs: 60_000,
    mission: "general",
    deterministic: true,
    system: "Deterministic worker — no LLM call. Merges open tasks with near-identical titles to keep the ledger small."
  },
  {
    id: "runner",
    label: "runner",
    intervalMs: 180_000,
    mission: "general",
    deterministic: true,
    system: "Deterministic worker — no LLM call. Picks tasks tagged 'long_running' and dispatches a real shell run via createRunRequest."
  }
];

const swarmState = {
  startedAt: null,
  workers: WORKERS.map((w) => ({
    id: w.id,
    label: w.label,
    intervalMs: w.intervalMs,
    cycles: 0,
    inFlight: false,
    lastTickAt: null,
    lastResultAt: null,
    lastResult: "boot",
    lastError: null,
    subagentId: null
  }))
};
const timers = [];

async function ensureSubagent(spec, status) {
  if (status.subagentId) return status.subagentId;
  try {
    // Reuse existing subagent for this worker label if already in the ledger
    // (avoids duplication on dashboard restart).
    const existing = await listSubagents({ limit: 200 });
    const match = existing.find(
      (s) => s.intent && s.intent.startsWith(`${spec.label} swarm worker`)
    );
    if (match) {
      status.subagentId = match.id;
      await updateSubagent(match.id, { status: "running" });
      return status.subagentId;
    }
    const sub = await spawnSubagent({
      intent: `${spec.label} swarm worker — ${spec.system.split(".")[0]}`,
      mission: spec.mission,
      modelHint: DEFAULT_MODEL,
      steps: [`tick every ${Math.round(spec.intervalMs / 1000)}s`]
    });
    status.subagentId = sub.id;
    await updateSubagent(sub.id, { status: "running" });
  } catch {
    // best-effort
  }
  return status.subagentId;
}

function statusFor(id) {
  return swarmState.workers.find((w) => w.id === id);
}

async function callOllamaJson({ model, system, user }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        keep_alive: "24h",
        stream: false,
        format: "json",
        // Disable hidden reasoning channel so output lands in .content not .thinking
        think: false,
        options: { temperature: 0.5, num_predict: 600, num_ctx: 4096, top_p: 0.9 },
        messages: [
          {
            role: "system",
            content: `${system}\n\nReply with ONE valid JSON object only. No markdown, no preamble, no commentary.`
          },
          { role: "user", content: user }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json();
    const content = data.message?.content || "";
    const thinkingField = data.message?.thinking || "";
    const text = content || thinkingField;
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = {}; }
      }
    }
    return { parsed, raw: text, evalCount: data.eval_count || 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function buildUserContext(missionFilter) {
  const [tasks, events, shared] = await Promise.all([
    listTasks({ status: "open" }),
    getHermesEvents(8),
    getSharedContext()
  ]);
  const sharedBlock = formatSharedContextBlock(shared);
  const recent = events.slice(0, 4).map((e) => `${e.createdAt.slice(11, 19)} ${e.type} ${(e.content || "").slice(0, 60)}`).join("\n");
  const taskLines = tasks
    .filter((t) => !missionFilter || t.mission === missionFilter || t.mission === "general")
    .slice(0, 3)
    .map((t) => `- [${t.mission}] ${t.title} (id=${t.id})`)
    .join("\n") || "(no open tasks in your mission)";
  return `${sharedBlock}\n\nRecent events:\n${recent}\n\nYour mission's open tasks:\n${taskLines}\n\nProduce ONE JSON object as instructed.`;
}

// --- Deterministic worker helpers (closer + dedup) ---

function execGit(args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: ROOTS.project, timeout: 4000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        resolve({ ok: !error, stdout: (stdout || "").toString().trim() });
      }
    );
  });
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4); // skip short words like "the", "for"
}

async function runCloserTick() {
  const open = await listTasks({ status: "open" });
  if (!open.length) return "no open tasks";
  const log = await execGit(["log", "-50", "--pretty=format:%h|%s"]);
  const commits = (log.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("|");
      return { sha: line.slice(0, idx), subject: line.slice(idx + 1) };
    });
  const STALE_MS = 30 * 60_000;
  const now = Date.now();
  let closed = 0;
  let abandoned = 0;
  for (const task of open) {
    const titleTokens = new Set(tokenize(task.title));
    if (titleTokens.size >= 3) {
      for (const c of commits) {
        const subjectTokens = new Set(tokenize(c.subject));
        let overlap = 0;
        for (const t of titleTokens) if (subjectTokens.has(t)) overlap += 1;
        if (overlap >= 3) {
          await updateTask(task.id, {
            status: "done",
            note: `shipped via ${c.sha} (closer match: "${safeSnippet(c.subject, 80)}")`
          });
          closed += 1;
          break;
        }
      }
    }
    // Stale-archive: open >30min, no notes, no recent commit match.
    if (
      task.status === "open" &&
      (!task.notes || task.notes.length === 0) &&
      now - new Date(task.updatedAt).getTime() > STALE_MS
    ) {
      await updateTask(task.id, { status: "abandoned", note: "stale, no progress (closer)" });
      abandoned += 1;
    }
  }
  return `closer closed=${closed} abandoned=${abandoned} (of ${open.length} open)`;
}

async function runRunnerTick() {
  // Picks the oldest task tagged "long_running" or "test_and_ship" and
  // dispatches a real shell run. The run streams events so the dashboard
  // sees output flow. Auto-approve fires for source:"hermes".
  const open = await listTasks({ status: "open" });
  const candidates = open.filter((t) =>
    (t.tags || []).some((tag) => tag === "long_running" || tag === "test_and_ship") &&
    !(t.pipelineState?.phase === "running")
  );
  if (!candidates.length) return "no long_running tasks pending";
  const task = candidates.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
  // Pick the command from the task's pipelineState.command, or default to a
  // safe diagnostic if not specified.
  const command = task.pipelineState?.command || "npm run typecheck";
  // Lazy import to avoid circular dependency at module load.
  const { createRunRequest } = await import("./runRequests.mjs");
  try {
    await updateTask(task.id, {
      pipelineState: { ...(task.pipelineState || {}), phase: "running", startedAt: new Date().toISOString() },
      note: `runner dispatching: ${command.slice(0, 80)}`
    });
    const result = await createRunRequest({
      source: "hermes",
      reason: `runner: ${task.title}`,
      command
    });
    if (result.exitCode === 0) {
      await updateTask(task.id, { status: "done", note: `runner shipped (exit 0): ${command.slice(0, 80)}` });
      return `ran ${task.id}: exit 0`;
    }
    await updateTask(task.id, {
      pipelineState: { ...(task.pipelineState || {}), phase: "ran", lastError: `exit ${result.exitCode}` },
      note: `runner exit ${result.exitCode}: ${(result.output || "").slice(0, 200)}`
    });
    return `ran ${task.id}: exit ${result.exitCode}`;
  } catch (error) {
    return `runner error: ${error?.message || "unknown"}`;
  }
}

async function runDedupTick() {
  const open = await listTasks({ status: "open" });
  if (open.length < 3) return `dedup: only ${open.length} open tasks, skipping`;
  const buckets = new Map();
  for (const task of open) {
    const key = (task.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).slice(0, 5).join(" ");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(task);
  }
  let merged = 0;
  for (const [, group] of buckets) {
    if (group.length < 2) continue;
    // Keep the OLDEST (first created); merge the rest.
    const sorted = group.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keeper = sorted[0];
    for (const dupe of sorted.slice(1)) {
      await updateTask(dupe.id, { status: "abandoned", note: `merged into ${keeper.id} (dedup bucket)` });
      merged += 1;
    }
  }
  return `dedup merged=${merged} (of ${open.length} open, ${buckets.size} buckets)`;
}

async function runWorker(spec) {
  const status = statusFor(spec.id);
  if (status.inFlight) return;
  status.inFlight = true;
  status.lastTickAt = new Date().toISOString();
  status.cycles += 1;
  const sessionId = `swarm_${spec.id}`;
  await ensureSubagent(spec, status);

  // Deterministic workers (closer/dedup) skip the LLM entirely.
  if (spec.deterministic) {
    try {
      let summary;
      if (spec.id === "closer") summary = await runCloserTick();
      else if (spec.id === "dedup") summary = await runDedupTick();
      else if (spec.id === "runner") summary = await runRunnerTick();
      else summary = "deterministic worker without handler";
      status.lastResult = summary;
      status.lastResultAt = new Date().toISOString();
      status.lastError = null;
      await appendHermesEvent({
        type: "mission_update",
        role: "system",
        content: `[${spec.label}] ${summary}`,
        sessionId
      });
      if (status.subagentId) {
        void updateSubagent(status.subagentId, { result: summary, status: "running" }).catch(() => {});
      }
    } catch (err) {
      status.lastError = err?.message || "tick failed";
    } finally {
      status.inFlight = false;
    }
    return;
  }

  try {
    await appendHermesEvent({
      type: "model_call",
      role: "assistant",
      content: `[${spec.label}] tick #${status.cycles}`,
      model: DEFAULT_MODEL,
      iteration: status.cycles,
      sessionId,
      intent: status.subagentId || undefined
    });
    const userContext = await buildUserContext(spec.mission);
    const result = await callOllamaJson({ model: DEFAULT_MODEL, system: spec.system, user: userContext });

    const thinking = result.parsed.thinking || result.parsed.reason || "";
    if (thinking) {
      await appendHermesEvent({
        type: "thinking",
        role: "assistant",
        content: `[${spec.label}] ${thinking}`,
        model: DEFAULT_MODEL,
        iteration: status.cycles,
        sessionId
      });
    }

    let resultSummary = null;
    if (Object.keys(result.parsed).length === 0) {
      // Deterministic fallback so this worker still produces an event.
      await appendHermesEvent({
        type: "note",
        role: "system",
        content: `[${spec.label}] model returned no JSON; raw=${safeSnippet(result.raw, 160) || "(empty)"}`,
        sessionId
      });
      resultSummary = "no json";
    } else {
      // Dispatch the worker-specific action.
      switch (spec.id) {
        case "observer": {
          const finding = result.parsed.finding || result.parsed.observation || "";
          const area = result.parsed.area || "dashboard";
          if (finding) {
            await appendHermesEvent({
              type: "mission_update",
              role: "assistant",
              content: `[observer:${area}] ${finding}`,
              sessionId
            });
            resultSummary = `observe ${area}: ${safeSnippet(finding, 60)}`;
          }
          break;
        }
        case "design":
        case "autofix":
        case "obsidian": {
          const title = result.parsed.title || result.parsed.task || "";
          if (title) {
            const t = await addTask({
              title: safeSnippet(title, 200),
              mission: spec.mission,
              createdBy: `swarm:${spec.id}`,
              notes: result.parsed.rationale ? [safeSnippet(result.parsed.rationale, 240)] : []
            });
            resultSummary = `+ task ${t.id} [${spec.mission}]: ${safeSnippet(title, 60)}`;
          }
          break;
        }
        case "buzzr": {
          const text = result.parsed.text || result.parsed.tweet || "";
          if (text) {
            const item = await postThemedItem("buzzr_drafts", {
              text: safeSnippet(text, 280),
              audience: result.parsed.audience || "x.com followers",
              worstCase: "(swarm draft, unverified)"
            });
            resultSummary = `+ buzzr draft ${item.id}: ${safeSnippet(text, 60)}`;
          }
          break;
        }
        case "memoire": {
          const slug = (result.parsed.slug || "audit").replace(/[^a-z0-9-]/gi, "-").slice(0, 40).toLowerCase();
          const source = result.parsed.source || "";
          if (source) {
            const t = await addTask({
              title: `Memoire audit: ${safeSnippet(source, 120)}`,
              mission: "memoire",
              createdBy: "swarm:memoire",
              notes: [`source: ${source}`, `slug: ${slug}`, result.parsed.summary || ""].filter(Boolean)
            });
            resultSummary = `+ memoire audit task ${t.id}: ${safeSnippet(source, 60)}`;
          }
          break;
        }
        case "sports": {
          const headline = result.parsed.headline || "";
          const league = result.parsed.league || "general";
          if (headline) {
            const item = await postThemedItem("sports_radar", {
              kind: "headline",
              league,
              source: result.parsed.source || "swarm",
              headline: safeSnippet(headline, 280)
            });
            resultSummary = `+ sports_radar [${league}] ${item.id}: ${safeSnippet(headline, 60)}`;
          }
          break;
        }
        case "planner": {
          const subtasks = Array.isArray(result.parsed.subtasks) ? result.parsed.subtasks : [];
          const parent = result.parsed.parent_title || "";
          const planMission = result.parsed.mission || "general";
          if (parent && subtasks.length) {
            const parentTask = await addTask({
              title: `Plan: ${safeSnippet(parent, 160)}`,
              mission: planMission,
              createdBy: "swarm:planner",
              notes: [`subtasks: ${subtasks.length}`]
            });
            for (const st of subtasks.slice(0, 6)) {
              await addTask({
                title: safeSnippet(String(st), 160),
                mission: planMission,
                createdBy: "swarm:planner",
                notes: [`parent: ${parentTask.id}`]
              });
            }
            resultSummary = `+ plan ${parentTask.id} (${subtasks.length} subtasks): ${safeSnippet(parent, 50)}`;
          }
          break;
        }
        case "critic": {
          const target = result.parsed.target || "";
          const critique = result.parsed.critique || "";
          const suggestion = result.parsed.suggestion || "";
          if (target && critique) {
            await appendHermesEvent({
              type: "mission_update",
              role: "assistant",
              content: `[critic] ${target}: ${critique}${suggestion ? ` → ${suggestion}` : ""}`,
              sessionId
            });
            resultSummary = `critique [${safeSnippet(target, 30)}]: ${safeSnippet(critique, 60)}`;
          }
          break;
        }
      }
    }

    if (!resultSummary) {
      // The model returned something but it was empty for our action shape.
      await appendHermesEvent({
        type: "note",
        role: "assistant",
        content: `[${spec.label}] tick produced no actionable payload`,
        sessionId
      });
      resultSummary = "no actionable payload";
    }
    status.lastResult = resultSummary;
    status.lastResultAt = new Date().toISOString();
    status.lastError = null;
    if (status.subagentId) {
      void updateSubagent(status.subagentId, { result: resultSummary, status: "running" }).catch(() => {});
    }
  } catch (err) {
    status.lastError = err?.message || "tick failed";
    await appendHermesEvent({
      type: "note",
      role: "system",
      content: `[${spec.label}] error: ${status.lastError}`,
      sessionId
    }).catch(() => {});
  } finally {
    status.inFlight = false;
  }
}

export function startWorkerSwarm() {
  if (timers.length) return timers;
  if (process.env.PRETEXT_SWARM === "false") return null;
  swarmState.startedAt = new Date().toISOString();
  // Stagger the initial fires so they don't all hammer Ollama at boot.
  WORKERS.forEach((spec, idx) => {
    setTimeout(() => {
      void runWorker(spec);
      const t = setInterval(() => void runWorker(spec), spec.intervalMs);
      t.unref?.();
      timers.push(t);
    }, 4_000 + idx * 2_500);
  });
  return timers;
}

export function getSwarmStatus() {
  return {
    startedAt: swarmState.startedAt,
    model: DEFAULT_MODEL,
    workers: swarmState.workers.map((w) => ({ ...w }))
  };
}
