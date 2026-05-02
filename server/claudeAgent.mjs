// Proactive Claude Code dispatcher. Replaces the "wait until gemma4 fails 5x"
// fallback model with a primary executor that picks edit-shaped open tasks
// every few minutes and ships them via Claude Code.
//
// Flow: pick task → read target file → build precise prompt → dispatch via
// existing executeClaudeCode → digestClaudeResult creates kind:edit
// proposal → autoApply ships within 10s → sandbox typecheck gate + auto
// revert protect main from regressions.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { listTasks, updateTask } from "./taskLedger.mjs";
import { dispatchSubscriptionTask, getClaudeDispatchStatus } from "./subscriptions.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const TICK_MS = Number(process.env.PRETEXT_CLAUDE_AGENT_TICK_MS || 4 * 60_000);
const MIN_BUDGET = Number(process.env.PRETEXT_CLAUDE_AGENT_MIN_BUDGET || 2);
const MAX_FILE_BYTES = 60_000; // don't blow Claude's context with giant files

let timer = null;
let totalTicks = 0;
let totalDispatched = 0;
let lastTickAt = null;
let lastResult = "boot";
const dispatchedTasks = new Set();

async function readFile(rel) {
  const full = path.join(ROOTS.project, rel);
  try {
    const text = await fs.readFile(full, "utf8");
    if (text.length > MAX_FILE_BYTES) {
      return { ok: true, text: text.slice(0, MAX_FILE_BYTES), truncated: true };
    }
    return { ok: true, text, truncated: false };
  } catch (error) {
    return { ok: false, reason: error?.message || "read failed" };
  }
}

async function pickTask() {
  const open = await listTasks({ status: "open" });
  if (!open.length) return null;
  const candidates = open
    .filter((t) => {
      const tags = t.tags || [];
      // Skip needs_design tasks — claudeAgent edits files, not invents specs.
      if (tags.includes("needs_design")) return false;
      // Already dispatched in this session — skip.
      if (dispatchedTasks.has(t.id)) return false;
      // Need a file_path to work on.
      const ps = t.pipelineState || {};
      const filePath = ps.concretize?.file_path;
      if (!filePath) return false;
      return true;
    })
    .sort((a, b) => {
      // Prefer tasks the gemma pipeline already gave up on (attempts ≥ 1)
      const aAttempts = (a.pipelineState?.attempts || 0);
      const bAttempts = (b.pipelineState?.attempts || 0);
      if (aAttempts !== bAttempts) return bAttempts - aAttempts;
      // Then oldest first.
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  return candidates[0] || null;
}

function buildPrompt(task, fileText, filePath) {
  const change = task.pipelineState?.concretize?.target_change || task.title;
  return [
    `Edit ${filePath} to: ${task.title}.`,
    "",
    `Specific change: ${change}`,
    "",
    "RESPOND WITH JSON ONLY (no markdown, no preamble), in this exact shape:",
    `{"filePath": "${filePath}", "find": "<a UNIQUE substring of ≥ 20 chars taken VERBATIM from the file contents below>", "replace": "<the replacement string>"}`,
    "",
    "Rules:",
    `- "find" MUST appear EXACTLY ONCE in the file contents below.`,
    `- "find" MUST be ≥ 20 characters and copied byte-for-byte from the contents.`,
    `- "replace" MUST preserve syntactic validity (typescript/tsx). Do not break JSX.`,
    `- Do not add em dashes (—) or en dashes (–); use a hyphen.`,
    `- Do not include explanations. JSON only.`,
    "",
    `File contents (length ${fileText.length}):`,
    "",
    fileText
  ].join("\n");
}

async function tick() {
  totalTicks += 1;
  lastTickAt = new Date().toISOString();
  try {
    const dispatch = getClaudeDispatchStatus();
    if (dispatch.remaining < MIN_BUDGET) {
      lastResult = `skip: only ${dispatch.remaining} dispatches remaining`;
      return;
    }
    const task = await pickTask();
    if (!task) {
      lastResult = "no eligible task";
      return;
    }
    const filePath = task.pipelineState?.concretize?.file_path;
    if (!filePath) {
      lastResult = `task ${task.id} missing file_path`;
      return;
    }
    const file = await readFile(filePath);
    if (!file.ok) {
      lastResult = `read fail: ${file.reason}`;
      // Mark abandoned so we don't re-pick it next tick.
      await updateTask(task.id, {
        status: "abandoned",
        note: `claudeAgent: cannot read ${filePath} — ${file.reason}`
      });
      return;
    }
    const intent = buildPrompt(task, file.text, filePath);
    dispatchedTasks.add(task.id);
    await dispatchSubscriptionTask({
      provider: "claude-code",
      intent,
      payload: { taskId: task.id, taskTitle: task.title, filePath, source: "claudeAgent" },
      notes: [`claudeAgent dispatch (file ${file.truncated ? "truncated" : "full"})`],
      autoExecute: true
    });
    await updateTask(task.id, {
      pipelineState: {
        ...(task.pipelineState || {}),
        phase: "claude-dispatched",
        dispatchedAt: new Date().toISOString()
      },
      note: `dispatched to Claude Code at ${new Date().toISOString().slice(11, 19)}`
    });
    totalDispatched += 1;
    lastResult = `dispatched ${task.id} → Claude Code (${dispatch.remaining - 1} budget left)`;
    await appendHermesEvent({
      type: "mission_update",
      role: "assistant",
      content: `[claudeAgent] dispatched ${task.id}: ${safeSnippet(task.title, 100)}`,
      extra: { taskId: task.id, filePath }
    }).catch(() => {});
  } catch (error) {
    lastResult = `tick error: ${error?.message || "unknown"}`;
  }
}

export function startClaudeAgent() {
  if (timer) return timer;
  if (process.env.PRETEXT_CLAUDE_AGENT === "false") return null;
  // First tick at 30s so swarm + pipeline boot first.
  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return timer;
}

export function getClaudeAgentStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: TICK_MS,
    minBudget: MIN_BUDGET,
    totalTicks,
    totalDispatched,
    lastTickAt,
    lastResult,
    inSessionDispatched: dispatchedTasks.size
  };
}

export async function fireClaudeAgentNow() {
  await tick();
  return getClaudeAgentStatus();
}
