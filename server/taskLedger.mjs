import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const STORE = path.join(ROOTS.project, "data/task-ledger.json");
const MARKDOWN = path.join(ROOTS.hermesOps, "tasks.md");
const MAX_TASKS = 500;
const VALID_STATUS = new Set(["open", "in_progress", "advanced", "blocked", "done", "abandoned"]);
const VALID_MISSION = new Set(["design", "pretext", "sports", "buzzr", "library", "obsidian", "memoire", "autofix", "naming", "subscription", "general"]);

let cache = null;
let pathOverride = null;
let markdownOverride = null;

export function setTaskLedgerPathsForTests(paths) {
  pathOverride = paths?.storePath || null;
  markdownOverride = paths?.markdownPath || null;
  cache = null;
}

function storePath() {
  return pathOverride || STORE;
}

function markdownPath() {
  return markdownOverride || MARKDOWN;
}

function newId(now) {
  return `task_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loadTasks() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    cache = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify({ tasks: cache.slice(-MAX_TASKS) }, null, 2), "utf8");
}

async function syncMarkdown() {
  try {
    if (!cache) await loadTasks();
    await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
    const open = cache.filter((task) => task.status !== "done" && task.status !== "abandoned");
    const closed = cache.filter((task) => task.status === "done" || task.status === "abandoned");
    const sections = [
      "# Hermes Tasks",
      "",
      "Hermes-owned working memory across cron ticks. Sarvesh can read or edit; the dashboard mirrors changes.",
      "",
      "## Open",
      ""
    ];
    if (open.length === 0) sections.push("- (none)");
    else
      open
        .slice()
        .reverse()
        .forEach((task) => {
          sections.push(`- [ ] **${task.title}** _(${task.mission})_  \`${task.id}\` · ${task.status} · updated ${task.updatedAt}`);
          (task.notes || []).slice(-3).forEach((note) => sections.push(`  - ${note}`));
        });
    sections.push("", "## Recently closed", "");
    if (closed.length === 0) sections.push("- (none)");
    else
      closed
        .slice(-12)
        .reverse()
        .forEach((task) => {
          sections.push(`- [x] **${task.title}** _(${task.mission})_  ${task.status} · ${task.updatedAt}`);
        });
    await fs.writeFile(markdownPath(), `${sections.join("\n")}\n`, "utf8");
  } catch {
    // best-effort
  }
}

export async function listTasks({ mission, status } = {}) {
  await loadTasks();
  return cache
    .filter((task) => (mission ? task.mission === mission : true))
    .filter((task) => (status ? task.status === status : true))
    .slice(-MAX_TASKS)
    .reverse();
}

export async function addTask(input = {}) {
  await loadTasks();
  const now = new Date();
  const mission = VALID_MISSION.has(input.mission) ? input.mission : "general";
  const task = {
    id: newId(now),
    title: safeSnippet(input.title || "Untitled task", 200),
    status: VALID_STATUS.has(input.status) ? input.status : "open",
    mission,
    createdBy: safeSnippet(input.createdBy || "hermes", 80),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    notes: Array.isArray(input.notes) ? input.notes.map((note) => safeSnippet(String(note), 400)) : [],
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).slice(0, 32)).slice(0, 8) : [],
    pipelineState: input.pipelineState && typeof input.pipelineState === "object" ? input.pipelineState : null
  };
  cache.push(task);
  await persist();
  await syncMarkdown();
  return task;
}

export async function updateTask(id, patch = {}) {
  await loadTasks();
  const task = cache.find((t) => t.id === id);
  if (!task) {
    const error = new Error(`Unknown task: ${id}`);
    error.status = 404;
    throw error;
  }
  if (patch.title) task.title = safeSnippet(patch.title, 200);
  if (patch.status && VALID_STATUS.has(patch.status)) task.status = patch.status;
  if (patch.mission && VALID_MISSION.has(patch.mission)) task.mission = patch.mission;
  if (Array.isArray(patch.notes)) {
    task.notes = (task.notes || []).concat(patch.notes.map((note) => safeSnippet(String(note), 400))).slice(-30);
  } else if (typeof patch.note === "string" && patch.note) {
    task.notes = (task.notes || []).concat([safeSnippet(patch.note, 400)]).slice(-30);
  }
  if (Array.isArray(patch.tags)) {
    task.tags = Array.from(new Set([...(task.tags || []), ...patch.tags.map((t) => String(t).slice(0, 32))])).slice(0, 8);
  }
  if (patch.pipelineState !== undefined) {
    task.pipelineState = patch.pipelineState;
  }
  task.updatedAt = new Date().toISOString();
  await persist();
  await syncMarkdown();
  return task;
}

export function _resetTaskLedgerForTests() {
  cache = null;
  pathOverride = null;
  markdownOverride = null;
}
