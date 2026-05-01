import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const MAX_PENDING = 50;
const MAX_HISTORY = 200;
const VALID_DECISIONS = new Set(["confirmed", "declined", "edited"]);

const intents = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let storeOverride = null;
let markdownOverride = null;
let hydrated = false;

function storePath() {
  return storeOverride || path.join(ROOTS.project, "data/public-intents.json");
}

function markdownPath() {
  return markdownOverride || path.join(ROOTS.reviewQueues, "Public Actions.md");
}

export function setPublicIntentPathsForTests(paths) {
  storeOverride = paths?.storePath || null;
  markdownOverride = paths?.markdownPath || null;
  intents.length = 0;
  hydrated = false;
}

function intentId(now) {
  return `pi_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist() {
  try {
    await fs.mkdir(path.dirname(storePath()), { recursive: true });
    await fs.writeFile(storePath(), JSON.stringify({ intents: intents.slice(-MAX_HISTORY) }, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

async function appendMarkdown(intent) {
  try {
    await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
    const header =
      "# Public Actions\n\nAudit trail of every moment Hermes acted (or proposed to act) under Sarvesh's public identity.\n";
    let existing = "";
    try {
      existing = await fs.readFile(markdownPath(), "utf8");
    } catch {
      existing = header;
    }
    const date = intent.createdAt.slice(0, 10);
    const decision = intent.decision || "pending";
    const block = [
      "",
      `## ${date} - ${intent.action} → ${intent.surface}`,
      "",
      `- id: ${intent.id}`,
      `- audience: ${intent.audience}`,
      `- legal: ${intent.legalPosture}`,
      `- reputation: ${intent.reputationPosture}`,
      `- worst-case: ${intent.worstCase}`,
      `- decision: ${decision}${intent.decidedAt ? ` at ${intent.decidedAt}` : ""}`,
      `- content: ${intent.content}`,
      ""
    ].join("\n");
    await fs.writeFile(markdownPath(), `${existing.trimEnd()}\n${block}`, "utf8");
  } catch {
    // best-effort
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.intents)) intents.push(...parsed.intents.slice(-MAX_HISTORY));
  } catch {
    // empty
  }
}

export async function createPublicIntent(input = {}) {
  await hydrate();
  const now = new Date();
  const intent = {
    id: intentId(now),
    createdAt: now.toISOString(),
    status: "pending",
    action: safeSnippet(input.action || "unspecified action", 200),
    audience: safeSnippet(input.audience || "unknown", 200),
    surface: safeSnippet(input.surface || "unknown", 80),
    content: safeSnippet(input.content || "", 4000),
    legalPosture: safeSnippet(input.legalPosture || "unreviewed", 400),
    reputationPosture: safeSnippet(input.reputationPosture || "unreviewed", 400),
    worstCase: safeSnippet(input.worstCase || "not described", 400),
    sessionId: input.sessionId ? safeSnippet(String(input.sessionId), 80) : undefined,
    decision: null,
    decidedAt: null,
    decidedContent: null,
    declineReason: null
  };
  intents.push(intent);
  if (intents.length > MAX_HISTORY) intents.splice(0, intents.length - MAX_HISTORY);
  await persist();
  await appendMarkdown(intent);
  await appendHermesEvent({
    type: "public_intent",
    role: "assistant",
    content: `${intent.action} → ${intent.surface} (${intent.audience})`,
    intent: intent.id,
    sessionId: intent.sessionId,
    extra: { worstCase: intent.worstCase }
  });
  emitter.emit("created", intent);
  return intent;
}

export async function decidePublicIntent(id, { decision, content, reason } = {}) {
  await hydrate();
  if (!VALID_DECISIONS.has(decision)) {
    const err = new Error(`Invalid decision: ${decision}`);
    err.status = 400;
    throw err;
  }
  const intent = intents.find((item) => item.id === id);
  if (!intent) {
    const err = new Error(`Unknown public intent: ${id}`);
    err.status = 404;
    throw err;
  }
  if (intent.decision) {
    const err = new Error(`Intent already decided: ${intent.decision}`);
    err.status = 409;
    throw err;
  }
  intent.decision = decision;
  intent.decidedAt = new Date().toISOString();
  intent.status = decision === "declined" ? "declined" : "approved";
  if (decision === "edited" && content) intent.decidedContent = safeSnippet(content, 4000);
  if (decision === "declined") intent.declineReason = safeSnippet(reason || "declined", 400);
  await persist();
  await appendMarkdown(intent);
  await appendHermesEvent({
    type: "public_action",
    role: "system",
    content: `decision=${decision} on ${intent.action}`,
    intent: intent.id,
    sessionId: intent.sessionId,
    extra: {
      decidedContent: intent.decidedContent || undefined,
      declineReason: intent.declineReason || undefined
    }
  });
  emitter.emit("decided", intent);
  return intent;
}

export async function getPendingPublicIntents() {
  await hydrate();
  return intents.filter((item) => item.status === "pending").slice(-MAX_PENDING);
}

export async function getPublicIntents(limit = 50) {
  await hydrate();
  return intents.slice(-limit).slice().reverse();
}

export function subscribePublicIntents(listener) {
  emitter.on("created", listener);
  emitter.on("decided", listener);
  return () => {
    emitter.off("created", listener);
    emitter.off("decided", listener);
  };
}

export function _resetPublicIntentsForTests() {
  intents.length = 0;
  hydrated = false;
  storeOverride = null;
  markdownOverride = null;
  emitter.removeAllListeners();
}
