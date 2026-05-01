// Ollama daemon auto-recovery. When ollamaQueue sees N consecutive timeouts
// on a model, it calls attemptRestart(). We quit the Ollama app via osascript
// and re-launch via `open -a Ollama`. 5min cooldown between attempts so we
// never restart-loop.

import { execFile } from "node:child_process";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { setHealthHook } from "./ollamaQueue.mjs";

const COOLDOWN_MS = 5 * 60_000;

let lastRestartAt = 0;
let lastRestartReason = null;
let lastRestartResult = null;
let totalAttempts = 0;

function execAsync(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 15_000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout?.toString() || "", stderr: stderr?.toString() || "" });
    });
  });
}

export async function attemptRestart({ model, reason } = {}) {
  const now = Date.now();
  if (now - lastRestartAt < COOLDOWN_MS) {
    return { skipped: true, reason: "cooldown" };
  }
  lastRestartAt = now;
  lastRestartReason = `[${model || "unknown"}] ${reason || "unknown"}`;
  totalAttempts += 1;
  await appendHermesEvent({
    type: "error",
    role: "system",
    content: `ollama-health: triggering restart — ${lastRestartReason}`,
    extra: { action: "ollama-restart", attempt: totalAttempts }
  }).catch(() => {});

  // Quit cleanly via AppleScript first; -9 fallback if needed.
  const quit = await execAsync("osascript", ["-e", 'tell application "Ollama" to quit']);
  await new Promise((r) => setTimeout(r, 4000));
  await execAsync("killall", ["-9", "ollama"]); // brutal fallback if osascript didn't take
  await new Promise((r) => setTimeout(r, 2000));
  const open = await execAsync("open", ["-a", "Ollama"]);
  await new Promise((r) => setTimeout(r, 6000));

  lastRestartResult = open.ok ? "relaunched" : `relaunch_failed: ${open.stderr.slice(0, 80)}`;
  await appendHermesEvent({
    type: "memory_write",
    role: "system",
    content: `ollama-health: ${lastRestartResult}`,
    extra: { action: "ollama-restart-result" }
  }).catch(() => {});
  return { skipped: false, ok: open.ok, result: lastRestartResult };
}

export function getOllamaHealthStatus() {
  return {
    lastRestartAt: lastRestartAt ? new Date(lastRestartAt).toISOString() : null,
    lastRestartReason,
    lastRestartResult,
    totalAttempts,
    cooldownMs: COOLDOWN_MS
  };
}

// Wire up: ollamaQueue calls this hook when consecutive fails hit threshold.
// One-time registration on import.
setHealthHook(attemptRestart);
