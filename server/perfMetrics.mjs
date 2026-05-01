import { execFile } from "node:child_process";
import os from "node:os";

const TTL_MS = 5_000;
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
let cache = { value: null, at: 0 };

function execFileAsync(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 1500, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolve(error ? "" : (stdout || "").toString());
    });
  });
}

async function probeOllamaPs() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/ps`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => ({
      name: m.name,
      sizeVramMb: Math.round((m.size_vram || 0) / 1024 / 1024),
      contextLen: m.context_length || 0,
      expiresAt: m.expires_at || null
    }));
  } catch {
    return [];
  }
}

async function probeOllamaSpeed(model = "gemma4:e4b") {
  // tokens/sec by running a 1-token completion and reading the eval_duration field
  try {
    const start = Date.now();
    const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: ".", stream: false, options: { num_predict: 12, temperature: 0 } }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const wallMs = Date.now() - start;
    const evalCount = data.eval_count || 0;
    const evalDurationNs = data.eval_duration || 0;
    const tokensPerSec = evalDurationNs > 0 ? Math.round((evalCount / (evalDurationNs / 1e9)) * 100) / 100 : 0;
    return { model, evalCount, tokensPerSec, wallMs };
  } catch {
    return null;
  }
}

async function probeNodeProc() {
  const usage = process.resourceUsage();
  return {
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    cpuUserMs: Math.round(usage.userCPUTime / 1000),
    cpuSystemMs: Math.round(usage.systemCPUTime / 1000),
    uptimeSec: Math.round(process.uptime())
  };
}

export async function getPerfMetrics({ force = false, probeSpeed = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  const [models, nodeProc, speed] = await Promise.all([
    probeOllamaPs(),
    probeNodeProc(),
    probeSpeed ? probeOllamaSpeed() : Promise.resolve(null)
  ]);
  const cpus = os.cpus();
  const value = {
    generatedAt: new Date().toISOString(),
    ollama: { residentModels: models },
    node: nodeProc,
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model ?? "unknown",
      loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100)
    },
    memory: {
      totalGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      freeGb: Math.round(os.freemem() / 1024 / 1024 / 1024)
    },
    speed
  };
  cache = { value, at: now };
  return value;
}
