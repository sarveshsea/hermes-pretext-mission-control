import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const STORE = path.join(ROOTS.project, "data/plans.json");
const REFLECTIONS_MD = path.join(ROOTS.agent, "Reflections.md");
const MAX_PLANS = 200;

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(STORE, "utf8");
    const parsed = JSON.parse(text);
    cache = Array.isArray(parsed.plans) ? parsed.plans : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist() {
  if (!cache) return;
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  await fs.writeFile(STORE, JSON.stringify({ plans: cache.slice(-MAX_PLANS) }, null, 2), "utf8");
}

function newId(now) {
  return `plan_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createPlan({ intent, mission, steps = [], sessionId } = {}) {
  await load();
  const now = new Date();
  const plan = {
    id: newId(now),
    intent: safeSnippet(intent || "", 400),
    mission: safeSnippet(mission || "general", 64),
    sessionId: sessionId ? safeSnippet(String(sessionId), 80) : null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "active",
    currentStep: 0,
    steps: steps.map((step, idx) => ({
      idx,
      text: safeSnippet(typeof step === "string" ? step : step.text || "", 300),
      result: null,
      decision: null,
      completedAt: null
    }))
  };
  cache.push(plan);
  await persist();
  await appendHermesEvent({
    type: "mission_start",
    role: "assistant",
    content: `plan: ${plan.intent}`,
    intent: plan.id,
    extra: { mission: plan.mission, stepCount: plan.steps.length }
  });
  return plan;
}

export async function recordStepResult(planId, stepIdx, { result, decision = "next" } = {}) {
  await load();
  const plan = cache.find((p) => p.id === planId);
  if (!plan) {
    const error = new Error(`Unknown plan: ${planId}`);
    error.status = 404;
    throw error;
  }
  const step = plan.steps[stepIdx];
  if (!step) {
    const error = new Error(`Step out of range: ${stepIdx}`);
    error.status = 400;
    throw error;
  }
  step.result = safeSnippet(result || "", 1200);
  step.decision = decision;
  step.completedAt = new Date().toISOString();
  plan.updatedAt = step.completedAt;
  if (decision === "abort") plan.status = "aborted";
  else if (decision === "replan") plan.status = "replanning";
  else if (stepIdx >= plan.steps.length - 1) plan.status = "complete";
  else plan.currentStep = stepIdx + 1;
  await persist();
  await appendHermesEvent({
    type: "mission_update",
    role: "assistant",
    content: `step ${stepIdx + 1}/${plan.steps.length} (${decision}): ${step.result.slice(0, 100)}`,
    intent: plan.id
  });
  return plan;
}

export async function reflect(planId, learning) {
  await load();
  const plan = cache.find((p) => p.id === planId);
  if (!plan) {
    const error = new Error(`Unknown plan: ${planId}`);
    error.status = 404;
    throw error;
  }
  const note = safeSnippet(learning || "", 800);
  plan.reflection = note;
  plan.reflectedAt = new Date().toISOString();
  await persist();
  try {
    await fs.mkdir(path.dirname(REFLECTIONS_MD), { recursive: true });
    let existing = "";
    try {
      existing = await fs.readFile(REFLECTIONS_MD, "utf8");
    } catch {
      existing = "# Hermes Reflections\n\nWhat each plan taught Hermes; loops back into future plans.\n";
    }
    const block = [
      "",
      `## ${plan.reflectedAt.slice(0, 19).replace("T", " ")} - ${plan.intent.slice(0, 80)}`,
      "",
      `- mission: ${plan.mission}`,
      `- status: ${plan.status}`,
      `- learning: ${note}`,
      ""
    ].join("\n");
    await fs.writeFile(REFLECTIONS_MD, `${existing.trimEnd()}\n${block}`, "utf8");
  } catch {
    // best-effort
  }
  await appendHermesEvent({
    type: "thinking",
    role: "assistant",
    content: `reflection: ${note}`,
    intent: plan.id
  });
  return plan;
}

export async function listPlans(limit = 30) {
  await load();
  return cache.slice(-limit).reverse();
}

export async function getPlan(id) {
  await load();
  return cache.find((p) => p.id === id) || null;
}
