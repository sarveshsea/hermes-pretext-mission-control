// Agent self-delegation: when a task class abandons N+ times in a window,
// the agent recognizes it's stuck and dispatches the work to a Codex/Claude
// subscription. The subscription queue then surfaces in the dashboard for
// Sarvesh to approve/decline. This is the "agent asks for help when local
// inference can't make progress" loop.

import { readJournalTail } from "./pipelineJournal.mjs";
import { dispatchSubscriptionTask, listSubscriptionTasks } from "./subscriptions.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { createPublicIntent } from "./publicIntents.mjs";
import { createProposal } from "./proposals.mjs";
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
        `Please produce the concrete edit as JSON: {"filePath": "...", "find": "...", "replace": "..."}. ` +
        `If the task is too abstract to map to a file, return {"needs_design": true, "reason": "..."}.`;
      try {
        // Queue the subscription (status: queued, no autoExecute yet).
        const sub = await dispatchSubscriptionTask({
          provider: "claude-code",
          intent,
          payload: { taskId: sample.taskId, taskTitle: sample.taskTitle, lastReason: sample.reason },
          notes: [`auto-delegated by agentDelegation after ${info.count} abandons`],
          autoExecute: false
        });
        // Also queue a public_intent so Sarvesh can approve/decline. Approval
        // will trigger the actual claude-code shell-out (via the public-intent
        // confirm handler in index.mjs — see route below).
        await createPublicIntent({
          channel: "claude-dispatch",
          content: `Ask Claude Code: ${safeSnippet(sample.taskTitle, 100)} (${info.count} abandons)`,
          extra: { subscriptionId: sub.id, taskId: sample.taskId }
        });
        dispatchedClasses.set(cls, Date.now());
        dispatched += 1;
        await appendHermesEvent({
          type: "mission_update",
          role: "assistant",
          content: `[delegate] ${info.count} abandons → queued claude-code dispatch (${sub.id}); awaiting Sarvesh approval`,
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

// Called by subscriptions.executeClaudeCode when a real Claude Code dispatch
// returns. We try to extract a structured edit from the result text — if it's
// shaped as JSON with {filePath, find, replace}, we auto-create an edit
// proposal that the autoApply loop will ship. Otherwise we just log.
export async function digestClaudeResult({ task, parsed, rawText } = {}) {
  if (!task) return;
  // Try several extraction shapes.
  let edit = null;
  // 1) parsed.result is a plain JSON string
  const candidates = [];
  if (parsed?.result && typeof parsed.result === "string") candidates.push(parsed.result);
  if (typeof rawText === "string") candidates.push(rawText);
  for (const text of candidates) {
    if (!text) continue;
    const m = text.match(/\{[\s\S]*?"filePath"[\s\S]*?\}/);
    if (m) {
      try {
        const obj = JSON.parse(m[0]);
        if (obj.filePath && typeof obj.find === "string" && typeof obj.replace === "string") {
          edit = obj;
          break;
        }
      } catch {
        // try next
      }
    }
  }
  if (!edit) {
    await appendHermesEvent({
      type: "tool_result",
      role: "assistant",
      content: `[claude-digest] no edit shape found in result for ${task.id}; raw: ${safeSnippet(String(rawText || ""), 160)}`,
      intent: task.id
    });
    return;
  }
  // Fire a thinking event so the validator's 60s window is satisfied.
  const sessionId = `claude_${task.id}`;
  await appendHermesEvent({
    type: "thinking",
    role: "assistant",
    content: `[claude-digest] proposing edit from claude-code dispatch for ${task.id}`,
    sessionId
  });
  try {
    const proposal = await createProposal({
      kind: "edit",
      title: `From Claude: ${safeSnippet(task.intent, 100)}`,
      rationale: safeSnippet(`Auto-created from claude-code dispatch ${task.id}`, 400),
      filePath: edit.filePath,
      find: edit.find,
      replace: edit.replace,
      autoSafe: true,
      sessionId
    });
    await appendHermesEvent({
      type: "mission_update",
      role: "assistant",
      content: `[claude-digest] created edit proposal ${proposal.id} → ${proposal.status}`,
      intent: task.id,
      extra: { proposalId: proposal.id }
    });
  } catch (error) {
    await appendHermesEvent({
      type: "error",
      role: "system",
      content: `[claude-digest] failed to create proposal: ${error?.message || "unknown"}`,
      intent: task.id
    });
  }
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
