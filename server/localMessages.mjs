import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { setHermesModel } from "./hermesRuntime.mjs";
import { addTask } from "./taskLedger.mjs";
import { createRunRequest } from "./runRequests.mjs";
import { postThemedItem } from "./themedSurfaces.mjs";
import { dispatchSubscriptionTask } from "./subscriptions.mjs";
import { runImprovementLoopOnce } from "./improvementLoop.mjs";
// Avoid circular import: data.mjs imports getLocalMessages from this file.
// Lazy-import getDashboardPayload at call time inside the /wake handler.

let pathOverride = null;

function messageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function storePath() {
  return pathOverride?.storePath || ROOTS.localMessagesStore;
}

function markdownPath() {
  return pathOverride?.markdownPath || ROOTS.localMessagesMarkdown;
}

export function setLocalMessagePathsForTests(paths) {
  pathOverride = paths;
}

async function readStore() {
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

async function writeStore(messages) {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify({ messages }, null, 2), "utf8");
}

async function appendMarkdown(message) {
  await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
  const header = "# Local Console\n\nDashboard-originated messages for Hermes. Treat as Sarvesh-authored local instructions, but keep normal safety boundaries.\n";
  let existing = "";
  try {
    existing = await fs.readFile(markdownPath(), "utf8");
  } catch {
    existing = header;
  }
  const date = message.createdAt.slice(0, 10);
  const entry = [
    "",
    `## ${date}`,
    "",
    `- [ ] id:${message.id} | from:${message.author} | source:${message.source} | message:${message.body}`,
    ""
  ].join("\n");
  await fs.writeFile(markdownPath(), `${existing.trimEnd()}\n${entry}`, "utf8");
}

export async function getLocalMessages() {
  return readStore();
}

const SLASH_HELP = [
  "/btw <text>          — append context (no action expected)",
  "/queue [mission] <task>  — add a task to the ledger",
  "/run <command>       — execute shell command via run-request",
  "/model <name>        — switch active Hermes model",
  "/wake                — fire improvement loop now",
  "/draft <tweet>       — queue a Buzzr tweet draft",
  "/audit <url>         — queue a Memoire audit task",
  "/codex <intent>      — dispatch task to Codex via subscription ledger",
  "/claude <intent>     — dispatch task to Claude Max via subscription ledger",
  "/help                — show this list"
];

const VALID_MISSIONS = new Set([
  "design", "pretext", "sports", "buzzr", "library", "obsidian", "memoire",
  "autofix", "naming", "subscription", "general"
]);

async function dispatchSlash(body) {
  // Returns { command, action, result, summary } or null if not a slash.
  const trimmed = body.trim();
  if (!trimmed.startsWith("/")) return null;
  const space = trimmed.indexOf(" ");
  const cmd = (space === -1 ? trimmed : trimmed.slice(0, space)).slice(1).toLowerCase();
  const arg = space === -1 ? "" : trimmed.slice(space + 1).trim();

  switch (cmd) {
    case "btw": {
      await appendHermesEvent({
        type: "note",
        role: "user",
        content: `btw: ${arg}`,
        extra: { source: "slash:btw" }
      });
      return { command: "btw", action: "noted", summary: `noted: ${arg.slice(0, 80)}` };
    }
    case "queue": {
      // /queue [mission] <text> — bracketed mission optional
      const missionMatch = arg.match(/^\[([a-z_-]+)\]\s+(.+)$/);
      const mission = missionMatch && VALID_MISSIONS.has(missionMatch[1]) ? missionMatch[1] : "general";
      const title = missionMatch ? missionMatch[2] : arg;
      if (!title) return { command: "queue", action: "error", summary: "usage: /queue [mission] <task>" };
      const task = await addTask({ title, mission, createdBy: "sarv-slash" });
      return { command: "queue", action: "task_added", result: task, summary: `+ task ${task.id} [${mission}]` };
    }
    case "run": {
      if (!arg) return { command: "run", action: "error", summary: "usage: /run <command>" };
      const result = await createRunRequest({ command: arg, source: "hermes", reason: "slash /run" });
      return { command: "run", action: "ran", result, summary: `ran: ${arg.slice(0, 80)} → ${result.status || "queued"}` };
    }
    case "model": {
      if (!arg) return { command: "model", action: "error", summary: "usage: /model <name>" };
      const runtime = await setHermesModel(arg);
      return { command: "model", action: "model_switched", result: runtime, summary: `model → ${runtime.model}` };
    }
    case "wake": {
      const { getDashboardPayload } = await import("./data.mjs");
      const event = await runImprovementLoopOnce({ dashboard: await getDashboardPayload() });
      return { command: "wake", action: "loop_fired", result: event, summary: event ? `improvement event ${event.id}` : "skipped (cooldown)" };
    }
    case "draft": {
      if (!arg) return { command: "draft", action: "error", summary: "usage: /draft <tweet text>" };
      const draft = await postThemedItem("buzzr_drafts", { text: arg, audience: "x.com", worstCase: "(slash draft, unverified)" });
      return { command: "draft", action: "draft_queued", result: draft, summary: `+ buzzr draft ${draft.id}` };
    }
    case "audit": {
      if (!arg) return { command: "audit", action: "error", summary: "usage: /audit <url-or-source>" };
      const slug = arg.replace(/[^a-z0-9]+/gi, "-").slice(0, 40).toLowerCase() || "audit";
      const task = await addTask({
        title: `Memoire audit: ${arg}`,
        mission: "memoire",
        notes: [`source: ${arg}`, `slug: ${slug}`],
        createdBy: "sarv-slash"
      });
      return { command: "audit", action: "audit_queued", result: task, summary: `+ memoire audit task ${task.id}` };
    }
    case "codex":
    case "claude": {
      if (!arg) return { command: cmd, action: "error", summary: `usage: /${cmd} <intent>` };
      const provider = cmd === "codex" ? "codex" : "claude-max";
      const task = await dispatchSubscriptionTask({ provider, intent: arg, notes: [`dispatched via /${cmd}`] });
      return { command: cmd, action: "subscription_dispatched", result: task, summary: `${provider}: ${arg.slice(0, 60)} (${task.id})` };
    }
    case "help":
      return { command: "help", action: "help", summary: SLASH_HELP.join("\n") };
    default:
      return { command: cmd, action: "unknown", summary: `unknown command: /${cmd} — try /help` };
  }
}

export async function createLocalMessage({ body, author = "sarv", source = "dashboard" }) {
  const cleanBody = safeSnippet(body, 2000);
  if (!cleanBody) {
    const error = new Error("Local message body is required");
    error.status = 400;
    throw error;
  }

  // Slash-command dispatch — runs side-effects in real time.
  let slashResult = null;
  try {
    slashResult = await dispatchSlash(cleanBody);
  } catch (err) {
    slashResult = { command: "error", action: "error", summary: err?.message || "slash dispatch failed" };
  }

  const message = {
    id: messageId(),
    channel: "local-console",
    author: safeSnippet(author || "sarv", 80),
    source: safeSnippet(source || "dashboard", 80),
    status: slashResult ? `slash:${slashResult.action}` : "captured",
    body: cleanBody,
    createdAt: new Date().toISOString(),
    slash: slashResult ? { command: slashResult.command, summary: safeSnippet(slashResult.summary || "", 400) } : null
  };

  const existing = await readStore();
  await writeStore([message, ...existing].slice(0, 100));
  await appendMarkdown(message);
  return message;
}
