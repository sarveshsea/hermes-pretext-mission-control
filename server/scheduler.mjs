import { execFile } from "node:child_process";
import os from "node:os";

const TTL_MS = 4_000;
const ACTIVE_INTERVAL_MS = 300_000;
const IDLE_INTERVAL_MS = 90_000;
const ASLEEP_INTERVAL_MS = 45_000;

let cache = { value: null, at: 0 };
let lastTransitionAt = Date.now();
let lastMode = "active";

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function execIdleSec() {
  return new Promise((resolve) => {
    execFile(
      "ioreg",
      ["-c", "IOHIDSystem"],
      { timeout: 1500, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout) return resolve(0);
        const match = stdout.match(/HIDIdleTime"\s*=\s*(\d+)/);
        if (!match) return resolve(0);
        const ns = Number(match[1]);
        resolve(Number.isFinite(ns) ? Math.floor(ns / 1_000_000_000) : 0);
      }
    );
  });
}

function deriveMode(idleSec, loadAvg) {
  if (idleSec < 60 || loadAvg > 3) return "active";
  if (idleSec < 900) return "idle";
  return "asleep";
}

function intervalFor(mode) {
  if (mode === "asleep") return ASLEEP_INTERVAL_MS;
  if (mode === "idle") return IDLE_INTERVAL_MS;
  return ACTIVE_INTERVAL_MS;
}

export async function getCadence({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;

  const idleSec = await execIdleSec();
  const loadAvg = os.loadavg()[0] ?? 0;
  const mode = deriveMode(idleSec, loadAvg);
  const idleScore = clamp(idleSec / 900, 0, 1);
  const loadScore = clamp((4 - loadAvg) / 4, 0, 1);
  const throttle = Math.round((idleScore * 0.7 + loadScore * 0.3) * 100) / 100;
  const recommendedIntervalMs = intervalFor(mode);
  // Auto-apply is now ON by default regardless of mode. The validator
  // (no-op rejection + thinking-window) is the floor that prevents theater
  // proposals from shipping. Sarvesh can still override via env:
  //   PRETEXT_AUTO_APPLY_GATE=asleep  → only auto-apply when asleep (legacy)
  //   PRETEXT_AUTO_APPLY=false        → kill switch in autoApply.mjs
  const gate = process.env.PRETEXT_AUTO_APPLY_GATE || "always";
  const recommendedAutoApply = gate === "asleep" ? mode === "asleep" : true;

  if (mode !== lastMode) {
    lastMode = mode;
    lastTransitionAt = now;
  }

  const value = {
    generatedAt: new Date().toISOString(),
    idleSec,
    loadAvg: Math.round(loadAvg * 100) / 100,
    throttle,
    mode,
    recommendedIntervalMs,
    recommendedAutoApply,
    sinceTransitionMs: now - lastTransitionAt
  };
  cache = { value, at: now };
  return value;
}

export function cadenceIntervals() {
  return {
    active: ACTIVE_INTERVAL_MS,
    idle: IDLE_INTERVAL_MS,
    asleep: ASLEEP_INTERVAL_MS
  };
}
