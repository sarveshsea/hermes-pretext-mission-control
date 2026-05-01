// Keep gemma4:e4b and gpt-oss:20b resident in VRAM so cron + interactive
// turns don't pay cold-start each time. Ollama's daemon evicts after 5min by
// default; we send a noop /api/generate with keep_alive every 4min to refresh
// the eviction timer.

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "24h";
const PING_INTERVAL_MS = 4 * 60_000;
const PING_MODELS = (process.env.OLLAMA_WARM_MODELS || "gemma4:e4b,gpt-oss:20b").split(",").map((m) => m.trim()).filter(Boolean);

let timer = null;
let lastPingAt = null;
let lastPingResult = "boot";

async function pingModel(model) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    // A 1-token generation is cheap (<100ms once loaded) but forces Ollama to
    // honor the keep_alive timer. Empty-prompt requests don't reset the timer.
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: ".",
        keep_alive: KEEP_ALIVE,
        stream: false,
        options: { num_predict: 1, temperature: 0 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return `${model}:${res.status}`;
    return `${model}:ok`;
  } catch (error) {
    return `${model}:err(${error?.name || "fetch"})`;
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
