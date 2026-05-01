import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const KNOWN_MODELS = ["gemma4:e4b", "llama3.1:8b", "gpt-oss:20b", "nomic-embed-text:latest"];
const DEFAULT_RUNTIME = {
  model: process.env.HERMES_MODEL || "gemma4:e4b",
  sessionId: null,
  iteration: 0,
  lastActivityAt: null,
  autoApprove: process.env.PRETEXT_AUTO_APPROVE !== "false",
  knownModels: KNOWN_MODELS
};

let cache = null;
let pathOverride = null;

function storePath() {
  return pathOverride || path.join(ROOTS.project, "data/hermes-runtime.json");
}

export function setHermesRuntimePathForTests(filePath) {
  pathOverride = filePath;
  cache = null;
}

async function loadRuntime() {
  if (cache) return cache;
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    cache = { ...DEFAULT_RUNTIME, ...parsed, knownModels: KNOWN_MODELS };
  } catch {
    cache = { ...DEFAULT_RUNTIME };
  }
  return cache;
}

async function saveRuntime() {
  if (!cache) return;
  try {
    await fs.mkdir(path.dirname(storePath()), { recursive: true });
    await fs.writeFile(storePath(), JSON.stringify(cache, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

export async function getHermesRuntime() {
  return { ...(await loadRuntime()) };
}

export async function setHermesModel(name) {
  const clean = safeSnippet(String(name ?? "").trim(), 80);
  if (!clean) {
    const err = new Error("Model name required");
    err.status = 400;
    throw err;
  }
  await loadRuntime();
  cache.model = clean;
  cache.lastActivityAt = new Date().toISOString();
  await saveRuntime();
  return { ...cache };
}

export async function recordRuntimeActivity({ sessionId, iteration } = {}) {
  await loadRuntime();
  if (sessionId) cache.sessionId = safeSnippet(String(sessionId), 80);
  if (Number.isFinite(iteration)) cache.iteration = Number(iteration);
  cache.lastActivityAt = new Date().toISOString();
  await saveRuntime();
  return { ...cache };
}

export async function setAutoApprove(value) {
  await loadRuntime();
  cache.autoApprove = Boolean(value);
  await saveRuntime();
  return { ...cache };
}

export function _resetHermesRuntimeForTests() {
  cache = null;
  pathOverride = null;
}
