import { approveRunRequest, createRunRequest, getRunRequests } from "./runRequests.mjs";

const DEFAULT_INTERVAL_MS = Number(process.env.PRETEXT_BUILDER_LOOP_MS || 60_000);
const DEFAULT_COOLDOWN_MS = Number(process.env.PRETEXT_BUILDER_LOOP_COOLDOWN_MS || 10 * 60_000);
const DEFAULT_AUTORUN = process.env.PRETEXT_BUILDER_AUTORUN !== "false";

let loopTimer = null;
let lastTickAt = null;
let lastCreatedAt = null;
let lastError = "";

function requestTime(request) {
  const value = request.createdAt || request.rejectedAt || request.finishedAt || request.startedAt;
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function hasPendingRequest(requests) {
  return requests.some((request) => request.status === "pending");
}

function hasRecentBuilderRequest(requests, now, cooldownMs) {
  return requests.some((request) => request.source === "builder-loop" && now - requestTime(request) < cooldownMs);
}

export function getBuilderLoopStatus() {
  return {
    state: loopTimer ? "running" : "stopped",
    intervalMs: DEFAULT_INTERVAL_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    autoRun: DEFAULT_AUTORUN,
    lastTickAt,
    lastCreatedAt,
    lastError
  };
}

export async function runBuilderLoopOnce({
  now = Date.now(),
  cooldownMs = DEFAULT_COOLDOWN_MS,
  autoRun = DEFAULT_AUTORUN,
  approve = approveRunRequest
} = {}) {
  lastTickAt = new Date(now).toISOString();
  const requests = await getRunRequests();
  if (hasPendingRequest(requests) || hasRecentBuilderRequest(requests, now, cooldownMs)) return null;

  const request = await createRunRequest({
    command: "npm run check",
    source: "builder-loop",
    reason:
      "Autonomous builder loop heartbeat: verify the Pretext Console after local memory, API, or UI changes. Requires local approval before execution."
  });
  lastCreatedAt = request.createdAt;
  if (!autoRun) return request;
  return approve(request.id);
}

export function startBuilderLoop({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (loopTimer) return loopTimer;

  const tick = async () => {
    try {
      await runBuilderLoopOnce();
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Builder loop failed";
    }
  };

  void tick();
  loopTimer = setInterval(tick, intervalMs);
  loopTimer.unref?.();
  return loopTimer;
}

export function stopBuilderLoopForTests() {
  if (loopTimer) clearInterval(loopTimer);
  loopTimer = null;
  lastTickAt = null;
  lastCreatedAt = null;
  lastError = "";
}
