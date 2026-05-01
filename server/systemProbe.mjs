import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOTS } from "./config.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const PROBE_TIMEOUT_MS = 1500;

let cache = { value: null, at: 0 };
const TTL_MS = 4000;

function execFileAsync(bin, args, options = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: PROBE_TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: (stdout || "").toString(), stderr: (stderr || "").toString() });
    });
  });
}

async function probeOllama() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { up: false, latencyMs: Date.now() - start, models: [], reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = (data.models || []).map((model) => ({
      name: model.name,
      sizeBytes: model.size || 0,
      modifiedAt: model.modified_at || null,
      family: model.details?.family || null,
      paramSize: model.details?.parameter_size || null
    }));
    return { up: true, latencyMs: Date.now() - start, models, reason: "" };
  } catch (error) {
    return { up: false, latencyMs: Date.now() - start, models: [], reason: error.message || "fetch failed" };
  }
}

async function probeProcess(pgrepPattern, opts = {}) {
  // For the dashboard itself we know our own PID directly (no pgrep needed).
  // Pass {selfPid: process.pid} to short-circuit.
  if (opts.selfPid) {
    const ps = await execFileAsync("ps", ["-p", String(opts.selfPid), "-o", "etime=,command="]);
    if (!ps.ok || !ps.stdout.trim()) return { running: true, pid: opts.selfPid, etimeSec: null, command: null };
    const line = ps.stdout.trim();
    const etimeStr = line.split(/\s+/)[0] || "";
    return {
      running: true,
      pid: opts.selfPid,
      etimeSec: parseEtime(etimeStr),
      command: line.slice(etimeStr.length).trim().slice(0, 240)
    };
  }
  const result = await execFileAsync("pgrep", ["-f", pgrepPattern]);
  if (!result.ok || !result.stdout.trim()) return { running: false, pid: null, etimeSec: null, command: null };
  const pid = Number(result.stdout.trim().split("\n")[0]);
  if (!pid) return { running: false, pid: null, etimeSec: null, command: null };
  const ps = await execFileAsync("ps", ["-p", String(pid), "-o", "etime=,command="]);
  if (!ps.ok || !ps.stdout.trim()) return { running: true, pid, etimeSec: null, command: null };
  const line = ps.stdout.trim();
  const etimeStr = line.split(/\s+/)[0] || "";
  return {
    running: true,
    pid,
    etimeSec: parseEtime(etimeStr),
    command: line.slice(etimeStr.length).trim().slice(0, 240)
  };
}

function parseEtime(value) {
  if (!value) return null;
  const dayMatch = value.match(/^(\d+)-(\d+):(\d+):(\d+)$/);
  if (dayMatch) {
    const [, d, h, m, s] = dayMatch.map(Number);
    return d * 86400 + h * 3600 + m * 60 + s;
  }
  const fullMatch = value.match(/^(\d+):(\d+):(\d+)$/);
  if (fullMatch) {
    const [, h, m, s] = fullMatch.map(Number);
    return h * 3600 + m * 60 + s;
  }
  const shortMatch = value.match(/^(\d+):(\d+)$/);
  if (shortMatch) {
    const [, m, s] = shortMatch.map(Number);
    return m * 60 + s;
  }
  return null;
}

async function probeDisk() {
  const result = await execFileAsync("df", ["-k", os.homedir()]);
  if (!result.ok) return { freeGb: null, sizeGb: null, usedPct: null };
  const lines = result.stdout.trim().split("\n");
  if (lines.length < 2) return { freeGb: null, sizeGb: null, usedPct: null };
  const parts = lines[1].trim().split(/\s+/);
  const sizeKb = Number(parts[1]);
  const usedKb = Number(parts[2]);
  const availKb = Number(parts[3]);
  if (!Number.isFinite(sizeKb)) return { freeGb: null, sizeGb: null, usedPct: null };
  return {
    sizeGb: Math.round(sizeKb / 1024 / 1024),
    freeGb: Math.round(availKb / 1024 / 1024),
    usedPct: Math.round((usedKb / sizeKb) * 100)
  };
}

async function probeVault() {
  try {
    const stat = await fs.stat(ROOTS.agent);
    return { accessible: stat.isDirectory(), path: ROOTS.agent };
  } catch {
    return { accessible: false, path: ROOTS.agent };
  }
}

async function probeMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalGb: Math.round(total / 1024 / 1024 / 1024),
    freeGb: Math.round(free / 1024 / 1024 / 1024),
    usedPct: Math.round(((total - free) / total) * 100),
    loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100)
  };
}

async function probeBotChannel() {
  try {
    const text = await fs.readFile(path.join(ROOTS.hermes, "channel_directory.json"), "utf8");
    const parsed = JSON.parse(text);
    const targets = Array.isArray(parsed.targets) ? parsed.targets : Object.values(parsed.targets || {});
    const home = targets.find((entry) => entry?.is_home || entry?.role === "home");
    return {
      homeChatId: home?.chat_id || null,
      homePlatform: home?.platform || null,
      homeName: home?.name || home?.display || null,
      total: targets.length
    };
  } catch {
    return { homeChatId: null, homePlatform: null, homeName: null, total: 0 };
  }
}

export async function probeSystem({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  const [ollama, gateway, dashboard, disk, memory, vault, channel] = await Promise.all([
    probeOllama(),
    probeProcess("hermes_cli.main gateway"),
    probeProcess("node server/index.mjs", { selfPid: process.pid }),
    probeDisk(),
    probeMemory(),
    probeVault(),
    probeBotChannel()
  ]);
  const value = {
    generatedAt: new Date().toISOString(),
    ollama,
    gateway,
    dashboard,
    disk,
    memory,
    vault,
    channel,
    healthScore: scoreHealth({ ollama, gateway, dashboard, disk, vault })
  };
  cache = { value, at: now };
  return value;
}

function scoreHealth({ ollama, gateway, dashboard, disk, vault }) {
  let score = 0;
  if (ollama.up) score += 25;
  if (gateway.running) score += 25;
  if (dashboard.running) score += 15;
  if (vault.accessible) score += 15;
  if (disk.usedPct != null && disk.usedPct < 90) score += 10;
  if (ollama.latencyMs && ollama.latencyMs < 400) score += 10;
  return score;
}
