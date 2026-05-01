import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const STORE = path.join(ROOTS.project, "data/subagents.json");
const MAX_AGENTS = 100;
const VALID_STATUS = new Set(["pending", "running", "succeeded", "failed", "cancelled"]);

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(STORE, "utf8");
    const parsed = JSON.parse(text);
    cache = Array.isArray(parsed.agents) ? parsed.agents : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify({ agents: cache.slice(-MAX_AGENTS) }, null, 2), "utf8");
}

function newId(now) {
  return `sub_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function spawnSubagent({ parentId = null, intent, mission = "general", steps = [], modelHint = null } = {}) {
  await load();
  const now = new Date();
  const subagent = {
    id: newId(now),
    parentId: parentId ? String(parentId).slice(0, 80) : null,
    intent: safeSnippet(intent || "", 400),
    mission: safeSnippet(mission || "general", 64),
    modelHint: modelHint ? safeSnippet(String(modelHint), 80) : null,
    status: "pending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    steps: steps.map((step, idx) => ({
      idx,
      text: safeSnippet(typeof step === "string" ? step : step.text || "", 300),
      result: null,
      completedAt: null
    })),
    result: null,
    error: null
  };
  cache.push(subagent);
  await persist();
  await appendHermesEvent({
    type: "mission_start",
    role: "assistant",
    content: `subagent: ${subagent.intent}`,
    intent: subagent.id,
    extra: { mission: subagent.mission, parentId: subagent.parentId }
  });
  return subagent;
}

export async function updateSubagent(id, patch = {}) {
  await load();
  const sub = cache.find((s) => s.id === id);
  if (!sub) {
    const error = new Error(`Unknown subagent: ${id}`);
    error.status = 404;
    throw error;
  }
  if (patch.status && VALID_STATUS.has(patch.status)) sub.status = patch.status;
  if (typeof patch.result === "string") sub.result = safeSnippet(patch.result, 1600);
  if (typeof patch.error === "string") sub.error = safeSnippet(patch.error, 800);
  if (Number.isFinite(patch.stepIdx) && typeof patch.stepResult === "string") {
    const step = sub.steps[patch.stepIdx];
    if (step) {
      step.result = safeSnippet(patch.stepResult, 800);
      step.completedAt = new Date().toISOString();
    }
  }
  sub.updatedAt = new Date().toISOString();
  await persist();
  await appendHermesEvent({
    type: "mission_update",
    role: "assistant",
    content: `subagent ${sub.id} -> ${sub.status}`,
    intent: sub.id
  });
  return sub;
}

export async function listSubagents({ parentId = null, limit = 30 } = {}) {
  await load();
  const all = parentId ? cache.filter((s) => s.parentId === parentId) : cache;
  return all.slice(-limit).reverse();
}

export async function getSubagentTree() {
  await load();
  const byParent = new Map();
  for (const sub of cache) {
    const parent = sub.parentId || "ROOT";
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(sub);
  }
  return {
    generatedAt: new Date().toISOString(),
    total: cache.length,
    roots: byParent.get("ROOT") || [],
    byParent: Object.fromEntries(byParent)
  };
}
