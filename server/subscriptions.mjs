import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const CLAUDE_BIN = process.env.PRETEXT_CLAUDE_BIN || `${ROOTS.home}/.local/bin/claude`;
const CLAUDE_DISPATCH_LIMIT_PER_HOUR = Number(process.env.PRETEXT_CLAUDE_DISPATCH_LIMIT || 5);
const CLAUDE_TIMEOUT_MS = 5 * 60_000;
const CLAUDE_SPEND_LOG = path.join(ROOTS.project, "data/claude-spend.jsonl");

const recentClaudeDispatches = []; // [{ts, taskId, ok}]

const STORE = path.join(ROOTS.project, "data/subscriptions.json");
const MARKDOWN = path.join(ROOTS.hermesOps, "subscriptions.md");
const MAX_TASKS = 200;
const VALID_PROVIDERS = new Set(["codex", "claude-max", "claude-code", "external"]);
const VALID_STATUS = new Set(["queued", "sent", "completed", "failed", "abandoned"]);

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(STORE, "utf8");
    const parsed = JSON.parse(text);
    cache = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify({ tasks: cache.slice(-MAX_TASKS) }, null, 2), "utf8");
}

async function syncMarkdown() {
  if (!cache) await load();
  try {
    await fs.mkdir(path.dirname(MARKDOWN), { recursive: true });
    const lines = [
      "# Subscription Ledger",
      "",
      "Hermes-tracked tasks dispatched to Codex, Claude Max, and external systems.",
      ""
    ];
    const open = cache.filter((t) => t.status !== "completed" && t.status !== "abandoned");
    const closed = cache.filter((t) => t.status === "completed" || t.status === "abandoned");
    lines.push("## Open", "");
    if (!open.length) lines.push("- (none)");
    open
      .slice()
      .reverse()
      .forEach((t) => {
        lines.push(`- [${t.status}] **${t.provider}** — ${t.intent}  \`${t.id}\``);
        if (t.notes?.length) t.notes.slice(-3).forEach((n) => lines.push(`  - ${n}`));
      });
    lines.push("", "## Recent closed", "");
    if (!closed.length) lines.push("- (none)");
    closed
      .slice(-10)
      .reverse()
      .forEach((t) => {
        lines.push(`- [${t.status}] **${t.provider}** — ${t.intent}`);
      });
    await fs.writeFile(MARKDOWN, `${lines.join("\n")}\n`, "utf8");
  } catch {
    // best-effort
  }
}

function newId(now) {
  return `sub_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function dispatchSubscriptionTask({ provider, intent, payload, notes, autoExecute = false } = {}) {
  await load();
  const safeProvider = VALID_PROVIDERS.has(provider) ? provider : "external";
  const now = new Date();
  const task = {
    id: newId(now),
    provider: safeProvider,
    intent: safeSnippet(intent || "(no intent)", 400),
    payload: payload ? safeSnippet(JSON.stringify(payload).slice(0, 1200)) : null,
    status: "queued",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
    result: null,
    notes: Array.isArray(notes) ? notes.map((n) => safeSnippet(String(n), 240)) : []
  };
  cache.push(task);
  if (cache.length > MAX_TASKS) cache.splice(0, cache.length - MAX_TASKS);
  await persist();
  await syncMarkdown();
  await appendHermesEvent({
    type: "tool_call",
    role: "assistant",
    content: `dispatch[${safeProvider}]: ${task.intent}`,
    intent: task.id,
    extra: { provider: safeProvider }
  });
  // Real execution: only when explicitly autoExecute is true (the agent
  // delegation flow gates this through public_intent first, so by the time
  // we get here Sarvesh has approved). For claude-code, shell out.
  if (autoExecute && safeProvider === "claude-code") {
    void executeClaudeCode(task).catch(() => {});
  }
  return task;
}

async function executeClaudeCode(task) {
  // Rate limit: max N dispatches per rolling hour.
  const cutoff = Date.now() - 3600_000;
  const recent = recentClaudeDispatches.filter((r) => r.ts > cutoff);
  recentClaudeDispatches.length = 0;
  recentClaudeDispatches.push(...recent);
  if (recent.length >= CLAUDE_DISPATCH_LIMIT_PER_HOUR) {
    await logSubscriptionResult(task.id, {
      status: "failed",
      result: `rate-limited: ${recent.length} dispatches in last hour (cap ${CLAUDE_DISPATCH_LIMIT_PER_HOUR})`
    });
    return;
  }
  recentClaudeDispatches.push({ ts: Date.now(), taskId: task.id, ok: null });
  await logSubscriptionResult(task.id, { status: "sent", notes: ["dispatched to claude-code"] });
  const args = [
    "--print",
    "--output-format", "json",
    "--dangerously-skip-permissions",
    "--add-dir", ROOTS.project,
    task.intent
  ];
  const startedAt = Date.now();
  const exec = await new Promise((resolve) => {
    execFile(CLAUDE_BIN, args, { timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        exitCode: error?.code ?? 0,
        stdout: (stdout || "").toString(),
        stderr: (stderr || "").toString()
      });
    });
  });
  const durationMs = Date.now() - startedAt;
  let parsed = null;
  try {
    parsed = JSON.parse(exec.stdout);
  } catch {
    parsed = null;
  }
  // Spend log — best-effort.
  try {
    await fs.mkdir(path.dirname(CLAUDE_SPEND_LOG), { recursive: true });
    await fs.appendFile(
      CLAUDE_SPEND_LOG,
      JSON.stringify({
        ts: new Date().toISOString(),
        taskId: task.id,
        intent: task.intent,
        durationMs,
        exitCode: exec.exitCode,
        usage: parsed?.usage || null,
        cost: parsed?.total_cost_usd || null
      }) + "\n",
      "utf8"
    );
  } catch {
    // ignore
  }
  if (!exec.ok) {
    await logSubscriptionResult(task.id, {
      status: "failed",
      result: safeSnippet(exec.stderr || exec.stdout || `exit ${exec.exitCode}`, 1500)
    });
    return;
  }
  const summary = parsed?.result || parsed?.text || exec.stdout.slice(-1500);
  await logSubscriptionResult(task.id, {
    status: "completed",
    result: safeSnippet(summary, 1600),
    notes: parsed?.usage ? [`usage: ${JSON.stringify(parsed.usage)}`] : []
  });
  // Hand the result to agentDelegation for digestion (auto-create kind:edit
  // proposals if the result looks like {filePath, find, replace}).
  try {
    const { digestClaudeResult } = await import("./agentDelegation.mjs");
    await digestClaudeResult({ task, parsed, rawText: summary });
  } catch {
    // best-effort
  }
}

export function getClaudeDispatchStatus() {
  const cutoff = Date.now() - 3600_000;
  const recent = recentClaudeDispatches.filter((r) => r.ts > cutoff);
  return {
    limitPerHour: CLAUDE_DISPATCH_LIMIT_PER_HOUR,
    inLastHour: recent.length,
    remaining: Math.max(0, CLAUDE_DISPATCH_LIMIT_PER_HOUR - recent.length),
    bin: CLAUDE_BIN,
    recent: recent.slice(-5).map((r) => ({ taskId: r.taskId, at: new Date(r.ts).toISOString() }))
  };
}

export async function logSubscriptionResult(id, { status, result, notes } = {}) {
  await load();
  const task = cache.find((t) => t.id === id);
  if (!task) {
    const error = new Error(`Unknown subscription task: ${id}`);
    error.status = 404;
    throw error;
  }
  if (status && VALID_STATUS.has(status)) task.status = status;
  if (typeof result === "string") task.result = safeSnippet(result, 1600);
  if (Array.isArray(notes)) task.notes = (task.notes || []).concat(notes.map((n) => safeSnippet(String(n), 240))).slice(-30);
  if (task.status === "completed") task.completedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  await persist();
  await syncMarkdown();
  await appendHermesEvent({
    type: "tool_result",
    role: "system",
    content: `subscription[${task.provider}] -> ${task.status}`,
    intent: task.id
  });
  return task;
}

export async function listSubscriptionTasks({ provider, status } = {}) {
  await load();
  return cache
    .filter((t) => (provider ? t.provider === provider : true))
    .filter((t) => (status ? t.status === status : true))
    .slice(-MAX_TASKS)
    .reverse();
}
