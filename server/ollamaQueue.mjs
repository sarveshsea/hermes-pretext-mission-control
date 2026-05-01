// Per-model FIFO queue for every Ollama call in the dashboard. Without this,
// 9 separate callers (8 swarm workers + pipeline + warm + perf + maintenance)
// each guard their own concurrency with inFlight flags or AbortControllers,
// and Ollama eventually deadlocks under multi-client load. The queue
// serializes per-model so gemma4:e4b and gpt-oss:20b can still run in
// parallel (both fit in VRAM), but neither has overlapping requests within
// itself. Hard timeout per call; on N consecutive timeouts on a model, the
// queue triggers ollamaHealth.attemptRestart().

import { appendHermesEvent } from "./hermesEvents.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const RESTART_AFTER_FAILS = 3;
const DEFAULT_TIMEOUT_MS = 90_000;

// One queue per model. Each entry is a job = { run: () => Promise, resolve, reject }.
const queues = new Map();
const stats = new Map(); // model -> { inFlight, queued, completed, failed, consecutiveFails, lastError, lastSuccessAt }

let healthHook = null; // injected from ollamaHealth — circular import dodge.

export function setHealthHook(fn) {
  healthHook = fn;
}

function statsFor(model) {
  if (!stats.has(model)) {
    stats.set(model, {
      model,
      inFlight: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      consecutiveFails: 0,
      lastError: null,
      lastSuccessAt: null,
      lastFailAt: null
    });
  }
  return stats.get(model);
}

async function drain(model) {
  const queue = queues.get(model);
  if (!queue || !queue.length) return;
  const s = statsFor(model);
  if (s.inFlight >= 1) return;
  const job = queue.shift();
  s.queued = queue.length;
  s.inFlight = 1;
  try {
    const result = await job.run();
    s.completed += 1;
    s.consecutiveFails = 0;
    s.lastSuccessAt = new Date().toISOString();
    job.resolve(result);
  } catch (error) {
    s.failed += 1;
    s.consecutiveFails += 1;
    s.lastError = error?.message || String(error);
    s.lastFailAt = new Date().toISOString();
    job.reject(error);
    if (s.consecutiveFails >= RESTART_AFTER_FAILS && healthHook) {
      // Async, fire-and-forget. ollamaHealth has its own cooldown.
      void Promise.resolve(healthHook({ model, reason: `${s.consecutiveFails} consecutive fails: ${s.lastError}` })).catch(() => {});
    }
  } finally {
    s.inFlight = 0;
    // Drain next.
    if (queue.length) setImmediate(() => void drain(model));
  }
}

// Public: enqueue an Ollama API call. Returns the parsed JSON response.
//
// Usage:
//   const data = await runOllama({
//     model: "gemma4:e4b",
//     endpoint: "/api/chat",
//     body: { ... },
//     timeoutMs: 90_000,
//     signal: callerSignal  // optional — cancels the queue wait too
//   });
//
// On any kind of failure (timeout, non-2xx, parse error), throws so the
// caller can do its own deterministic-fallback path.
export function runOllama({ model, endpoint = "/api/chat", body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  if (!model) return Promise.reject(new Error("runOllama: model required"));
  if (!body) return Promise.reject(new Error("runOllama: body required"));
  return new Promise((resolve, reject) => {
    if (!queues.has(model)) queues.set(model, []);
    const queue = queues.get(model);
    const s = statsFor(model);
    const job = {
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`ollama timeout ${timeoutMs}ms`)), timeoutMs);
        const onCallerAbort = () => controller.abort(signal?.reason || new Error("caller aborted"));
        if (signal) signal.addEventListener("abort", onCallerAbort, { once: true });
        try {
          const res = await fetch(`${OLLAMA_BASE}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, ...body }),
            signal: controller.signal
          });
          if (!res.ok) throw new Error(`ollama ${res.status}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onCallerAbort);
        }
      },
      resolve,
      reject
    };
    queue.push(job);
    s.queued = queue.length;
    setImmediate(() => void drain(model));
  });
}

export function getOllamaQueueStatus() {
  const out = {};
  for (const [model, s] of stats) {
    out[model] = { ...s };
  }
  return {
    models: out,
    generatedAt: new Date().toISOString()
  };
}

export function _resetForTests() {
  queues.clear();
  stats.clear();
}
