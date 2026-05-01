// Keep gemma4:e4b and gpt-oss:20b resident in VRAM so cron + interactive
// turns don't pay cold-start each time. Ollama's daemon evicts after 5min by
// default; we send a noop /api/generate with keep_alive every 4min to refresh
// the eviction timer.

import { runOllama } from "./ollamaQueue.mjs";

const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "24h";
const PING_INTERVAL_MS = 4 * 60_000;
const PING_MODELS = (process.env.OLLAMA_WARM_MODELS || "gemma4:e4b,gpt-oss:20b").split(",").map((m) => m.trim()).filter(Boolean);

let timer = null;
let lastPingAt = null;
let lastPingResult = "boot";

let consecutiveFails = new Map();

async function pingModel(model) {
  try {
    await runOllama({
      model,
      endpoint: "/api/generate",
      timeoutMs: 60_000,
      body: {
        prompt: ".",
        keep_alive: KEEP_ALIVE,
        stream: false,
        options: { num_predict: 1, temperature: 0 }
      }
    });
    consecutiveFails.set(model, 0);
    return `${model}:ok`;
  } catch (error) {
    const fails = (consecutiveFails.get(model) || 0) + 1;
    consecutiveFails.set(model, fails);
    return fails >= 3 ? `${model}:err(${error?.name || "fetch"})` : `${model}:busy`;
  }
}

async function tick() {
  const results = await Promise.all(PING_MODELS.map(pingModel));
  lastPingAt = new Date().toISOString();
  lastPingResult = results.join(" ");
}

export function startOllamaWarm() {
  if (timer) return timer;
  void tick();
  timer = setInterval(() => void tick(), PING_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function getOllamaWarmStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: PING_INTERVAL_MS,
    keepAlive: KEEP_ALIVE,
    models: PING_MODELS,
    lastPingAt,
    lastPingResult
  };
}
