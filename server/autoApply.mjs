import { getCadence } from "./scheduler.mjs";
import { decideProposal, getPendingProposals } from "./proposals.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";

const TICK_MS = 30_000;
const MAX_PER_TICK = 3;

const SAFE_CMD_RE =
  /^(?:cd\s+\S+(?:\s*&&\s*)?)?(?:printf|echo|sed -i\s+'[^']*'\s+|cat\s|ls\s|git\s+(?:add|commit|push|status|diff)\b|pretty=)[\s\S]*$/;
const UNSAFE_CMD_RE = /\b(rm\s|chmod\s|chown\s|sudo\b|curl[^|]*\|\s*sh\b|wget[^|]*\|\s*sh\b|dd\s|mkfs|kill -9 1\b|shutdown\b|reboot\b|launchctl\s+(?:unload|remove)\b|brew\s+(?:uninstall|cleanup -s)\b|npm\s+(?:uninstall|cache\s+clean)\b)/i;

let timer = null;
let lastTickAt = null;
let lastApplied = [];

function commandLooksSafe(proposal) {
  const text = (proposal.command || (proposal.argv || []).join(" ") || "").trim();
  if (!text) return false;
  if (UNSAFE_CMD_RE.test(text)) return false;
  if (proposal.kind === "shell" && proposal.command) return SAFE_CMD_RE.test(text);
  if (proposal.kind === "shell" && proposal.argv?.length) {
    const head = proposal.argv[0];
    return /^(echo|printf|sed|cat|ls|git|node|npx|npm|python3?)$/i.test(head) && !UNSAFE_CMD_RE.test(text);
  }
  return false;
}

async function tick() {
  lastTickAt = new Date().toISOString();
  try {
    const cadence = await getCadence();
    if (!cadence.recommendedAutoApply) return;
    const pending = await getPendingProposals();
    if (!pending.length) return;
    const candidates = pending
      .filter((proposal) => proposal.autoSafe || commandLooksSafe(proposal))
      .slice(0, MAX_PER_TICK);
    if (!candidates.length) return;

    for (const proposal of candidates) {
      try {
        const result = await decideProposal(proposal.id, { decision: "confirmed" });
        lastApplied.unshift({
          id: proposal.id,
          title: proposal.title,
          appliedAt: new Date().toISOString(),
          status: result.status
        });
        lastApplied = lastApplied.slice(0, 20);
        await appendHermesEvent({
          type: "mission_update",
          role: "system",
          content: `auto-applied: ${proposal.title}`,
          intent: proposal.id,
          extra: { mode: cadence.mode, status: result.status }
        });
      } catch (error) {
        await appendHermesEvent({
          type: "error",
          role: "system",
          content: `auto-apply failed for ${proposal.id}: ${error?.message || "unknown"}`,
          intent: proposal.id
        });
      }
    }
  } catch (error) {
    // best-effort; never crash
  }
}

export function startAutoApplyLoop() {
  if (timer) return timer;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref?.();
  void tick();
  return timer;
}

export function getAutoApplyStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: TICK_MS,
    lastTickAt,
    recentlyApplied: lastApplied.slice(0, 10)
  };
}
