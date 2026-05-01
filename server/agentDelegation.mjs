// Agent self-delegation: when a task class abandons N+ times in a window,
// the agent recognizes it's stuck and dispatches the work to a Codex/Claude
// subscription. The subscription queue then surfaces in the dashboard for
// Sarvesh to approve/decline. This is the "agent asks for help when local
// inference can't make progress" loop.

import { readJournalTail } from "./pipelineJournal.mjs";
import { dispatchSubscriptionTask, listSubscriptionTasks } from "./subscriptions.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const ABANDON_THRESHOLD = 5;
const WINDOW_LOOKBACK = 60;
const COOLDOWN_MS = 30 * 60_000; // don't re-dispatch the same class within 30min

let timer = null;
let lastTickAt = null;
let lastResult = "boot";
const dispatchedClasses = new Map(); // classKey -> lastDispatchedAt

function classify(entry) {
  if (!entry || !entry.taskTitle) return null;
  const tokens = entry.taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3);
  return `${entry.taskId?.slice(0, 12) || "unknown"}::${tokens.join("-") || "untitled"}`;
}

async function tick() {
  lastTickAt = new Date().toISOString();
  try {
    const entries = await readJournalTail(WINDOW_LOOKBACK);
    const buckets = new Map();
    for (const e of entries) {
      if (e.outcome !== "abandon") continue;
      const cls = classify(e);
      if (!cls) continue;
      if (!buckets.has(cls)) buckets.set(cls, { count: 0, sample: e });
      buckets.get(cls).count += 1;
    }
    let dispatched = 0;
    for (const [cls, info] of buckets) {
      if (info.count < ABANDON_THRESHOLD) continue;
      const last = dispatchedClasses.get(cls) || 0;
      if (Date.now() - last < COOLDOWN_MS) continue;

      const sample = info.sample;
      const intent =
        `Hermes pipeline abandoned ${info.count}× on task: "${safeSnippet(sample.taskTitle, 120)}". ` +
        `Last reason: ${safeSnippet(sample.reason || "unknown", 200)}. ` +
        `Please advise: produce the concrete edit (filePath + find/replace) OR mark this needs_design.`;
      try {
        const sub = await dispatchSubscriptionTask({
          provider: "claude-code",
          intent,
          payload: { taskId: sample.taskId, taskTitle: sample.taskTitle, lastReason: sample.reason },
          notes: [`auto-delegated by agentDelegation after ${info.count} abandons`]
        });
        dispatchedClasses.set(cls, Date.now());
        dispatched += 1;
        await appendHermesEvent({
          type: "mission_update",
          role: "assistant",
          content: `[delegate] ${info.count} abandons → asked claude-code for help (${sub.id})`,
          extra: { taskId: sample.taskId, subscriptionId: sub.id }
        });
      } catch {
        // best-effort
      }
    }
    lastResult = `tick: ${dispatched} dispatched (${buckets.size} classes scanned)`;
  } catch (error) {
    lastResult = `tick error: ${error?.message || "unknown"}`;
  }
}

export function startAgentDelegation() {
  if (timer) return timer;
  if (process.env.PRETEXT_DELEGATION === "false") return null;
  setTimeout(() => void tick(), 60_000);
  timer = setInterval(() => void tick(), 5 * 60_000);
  timer.unref?.();
  return timer;
}

export async function getAgentDelegationStatus() {
  const recent = await listSubscriptionTasks({ status: "queued" });
  return {
    state: timer ? "running" : "stopped",
    lastTickAt,
    lastResult,
    pendingDispatches: recent.length,
    dispatched: Array.from(dispatchedClasses.entries()).map(([cls, ts]) => ({ class: cls, at: new Date(ts).toISOString() }))
  };
}
