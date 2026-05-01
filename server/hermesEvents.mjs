import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet, sanitizeText } from "./redaction.mjs";

const MAX_BUFFER = 2000;
const MAX_PERSISTED = 600;
const KNOWN_TYPES = new Set([
  "telegram_in",
  "telegram_out",
  "model_call",
  "model_result",
  "tool_call",
  "tool_result",
  "iteration_tick",
  "error",
  "public_intent",
  "public_action",
  "run_request",
  "run_chunk",
  "run_result",
  "thinking",
  "mission_start",
  "mission_update",
  "memory_read",
  "memory_write",
  "note"
]);

const buffer = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let storeOverride = null;

function storePath() {
  return storeOverride || path.join(ROOTS.project, "data/hermes-events.json");
}

export function setHermesEventsStoreForTests(filePath) {
  storeOverride = filePath;
  buffer.length = 0;
}

function eventId(now) {
  return `hev_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return sanitizeText(value);
  try {
    return sanitizeText(JSON.stringify(value));
  } catch {
    return "";
  }
}

async function persist() {
  try {
    const tail = buffer.slice(-MAX_PERSISTED);
    await fs.mkdir(path.dirname(storePath()), { recursive: true });
    await fs.writeFile(storePath(), JSON.stringify({ events: tail }, null, 2), "utf8");
  } catch {
    // best-effort — never block the agent on disk hiccups
  }
}

async function hydrate() {
  if (buffer.length) return;
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.events)) {
      buffer.push(...parsed.events.slice(-MAX_BUFFER));
    }
  } catch {
    // empty store is fine
  }
}

export async function appendHermesEvent(input = {}) {
  await hydrate();
  const now = new Date();
  const type = KNOWN_TYPES.has(input.type) ? input.type : "note";
  const event = {
    id: eventId(now),
    createdAt: now.toISOString(),
    type,
    role: typeof input.role === "string" ? input.role.slice(0, 32) : "system",
    content: safeSnippet(normalizeContent(input.content), 4000),
    model: input.model ? safeSnippet(String(input.model), 80) : undefined,
    iteration: Number.isFinite(input.iteration) ? Number(input.iteration) : undefined,
    sessionId: input.sessionId ? safeSnippet(String(input.sessionId), 80) : undefined,
    intent: input.intent ? safeSnippet(String(input.intent), 200) : undefined,
    extra: input.extra && typeof input.extra === "object" ? input.extra : undefined
  };

  buffer.push(event);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  emitter.emit("event", event);
  await persist();
  return event;
}

export async function getHermesEvents(limit = 200) {
  await hydrate();
  const slice = buffer.slice(-limit);
  return slice.slice().reverse();
}

export function subscribeHermesEvents(listener) {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

export function _resetHermesEventsForTests() {
  buffer.length = 0;
  storeOverride = null;
  emitter.removeAllListeners("event");
}
