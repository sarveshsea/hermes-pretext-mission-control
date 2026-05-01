import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { createRunRequest } from "./runRequests.mjs";
import { safeSnippet } from "./redaction.mjs";
import { previewProposedCommand } from "./diffPreview.mjs";

const MAX_HISTORY = 200;
const STORE_FILE = path.join(ROOTS.project, "data/improvement-proposals.json");
const MARKDOWN_FILE = path.join(ROOTS.reviewQueues, "Hermes Proposals.md");

const VALID_KIND = new Set(["shell", "patch", "note"]);

let proposals = [];
let storeOverride = null;
let markdownOverride = null;
let hydrated = false;

export function setProposalPathsForTests(paths) {
  storeOverride = paths?.storePath || null;
  markdownOverride = paths?.markdownPath || null;
  proposals.length = 0;
  hydrated = false;
}

function storePath() {
  return storeOverride || STORE_FILE;
}

function markdownPath() {
  return markdownOverride || MARKDOWN_FILE;
}

function newId(now) {
  return `prop_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function persist() {
  try {
    await fs.mkdir(path.dirname(storePath()), { recursive: true });
    await fs.writeFile(storePath(), JSON.stringify({ proposals: proposals.slice(-MAX_HISTORY) }, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

async function appendMarkdown(proposal) {
  try {
    await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
    let existing = "";
    try {
      existing = await fs.readFile(markdownPath(), "utf8");
    } catch {
      existing = "# Hermes Proposals\n\nDashboard-improvement proposals authored by Hermes. Sarvesh confirms or declines.\n";
    }
    const date = proposal.createdAt.slice(0, 10);
    const block = [
      "",
      `## ${date} - ${proposal.title}`,
      "",
      `- id: ${proposal.id}`,
      `- kind: ${proposal.kind}`,
      `- rationale: ${proposal.rationale}`,
      `- status: ${proposal.status}`,
      proposal.command ? `- command: \`${proposal.command}\`` : null,
      proposal.argv?.length ? `- argv: \`${proposal.argv.join(" ")}\`` : null,
      proposal.cwd ? `- cwd: ${proposal.cwd}` : null,
      ""
    ]
      .filter(Boolean)
      .join("\n");
    await fs.writeFile(markdownPath(), `${existing.trimEnd()}\n${block}`, "utf8");
  } catch {
    // best-effort
  }
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.proposals)) proposals.push(...parsed.proposals.slice(-MAX_HISTORY));
  } catch {
    // empty
  }
}

// Reject shell proposals whose command/argv produces no actual file changes.
// This prevents the model from pretending to "improve" the dashboard with
// no-op commands like `echo "tweak"` or `npm run typecheck` and still claiming
// credit. Run a sandboxed dry-run via diffPreview; if diffStat is empty AND
// the title implies code change ("add", "tweak", "refine", "fix"), refuse.
const NO_OP_TITLE_RE = /\b(add|fix|tweak|refine|polish|improve|enhance|update|implement|ship|new)\b/i;

async function validateProposalActuallyChanges(proposal) {
  if (proposal.kind !== "shell") return { ok: true };
  if (!proposal.command && !proposal.argv?.length) return { ok: true };
  // Reservation: typecheck / test / build / lint are diagnostic-only by design.
  // They legitimately don't change files, but they should not be wrapped as
  // "Add X" proposals. If the title sounds like a change, the command must change.
  const text = (proposal.command || (proposal.argv || []).join(" ")).trim();
  const isDiagnostic = /^(npm\s+(?:run\s+)?(?:typecheck|test|build|lint|check)|tsc\b|vitest\b)/.test(text);
  const titleClaimsChange = NO_OP_TITLE_RE.test(proposal.title || "");
  if (isDiagnostic && titleClaimsChange) {
    return {
      ok: false,
      reason: `Title "${proposal.title}" claims a change but command "${text.slice(0, 80)}" is diagnostic-only. Either change the title or supply a command that edits a file.`
    };
  }
  if (isDiagnostic) return { ok: true };
  try {
    const preview = await previewProposedCommand({
      command: proposal.command || undefined,
      argv: proposal.argv || undefined
    });
    if (!preview.ok) {
      return { ok: false, reason: `Preview refused: ${preview.reason}` };
    }
    const diffStat = (preview.diffStat || "").trim();
    if (!diffStat) {
      return {
        ok: false,
        reason: "Proposed command produces no file changes. Submit a real edit (printf >> file, sed -i, file write) or skip the proposal entirely."
      };
    }
    return { ok: true, preview };
  } catch (error) {
    return { ok: false, reason: `Preview failed: ${error?.message || "unknown"}` };
  }
}

export async function createProposal(input = {}) {
  await hydrate();
  const now = new Date();
  const kind = VALID_KIND.has(input.kind) ? input.kind : "shell";
  const proposal = {
    id: newId(now),
    createdAt: now.toISOString(),
    status: "pending",
    kind,
    title: safeSnippet(input.title || "Untitled improvement", 200),
    rationale: safeSnippet(input.rationale || "", 800),
    command: input.command ? safeSnippet(String(input.command), 600) : null,
    argv: Array.isArray(input.argv) ? input.argv.map((part) => String(part)) : null,
    cwd: input.cwd ? String(input.cwd) : null,
    sessionId: input.sessionId ? String(input.sessionId).slice(0, 80) : null,
    autoSafe: input.autoSafe === true,
    autoAppliedAt: null,
    decidedAt: null,
    decision: null,
    declineReason: null,
    runResult: null
  };

  // Validation gate: reject pure no-op proposals so the model can't pad its
  // proposal count with theater. Skipped when input.skipValidation === true
  // (used by tests + the cleanup commit path).
  if (!input.skipValidation && proposal.autoSafe) {
    const verdict = await validateProposalActuallyChanges(proposal);
    if (!verdict.ok) {
      proposal.status = "rejected";
      proposal.decision = "declined";
      proposal.declineReason = verdict.reason;
      proposal.decidedAt = now.toISOString();
      proposals.push(proposal);
      if (proposals.length > MAX_HISTORY) proposals.splice(0, proposals.length - MAX_HISTORY);
      await persist();
      await appendHermesEvent({
        type: "error",
        role: "system",
        content: `proposal rejected at validation: ${proposal.title} — ${verdict.reason}`,
        intent: proposal.id
      });
      return proposal;
    }
  }
  proposals.push(proposal);
  if (proposals.length > MAX_HISTORY) proposals.splice(0, proposals.length - MAX_HISTORY);
  await persist();
  await appendMarkdown(proposal);
  await appendHermesEvent({
    type: "mission_update",
    role: "assistant",
    content: `proposal: ${proposal.title}`,
    intent: proposal.id,
    extra: { kind: proposal.kind, rationale: proposal.rationale }
  });
  return proposal;
}

export async function decideProposal(id, { decision, reason } = {}) {
  await hydrate();
  if (decision !== "confirmed" && decision !== "declined") {
    const error = new Error(`Invalid decision: ${decision}`);
    error.status = 400;
    throw error;
  }
  const proposal = proposals.find((item) => item.id === id);
  if (!proposal) {
    const error = new Error(`Unknown proposal: ${id}`);
    error.status = 404;
    throw error;
  }
  if (proposal.decision) {
    const error = new Error(`Proposal already decided: ${proposal.decision}`);
    error.status = 409;
    throw error;
  }
  proposal.decision = decision;
  proposal.decidedAt = new Date().toISOString();
  proposal.status = decision;
  if (decision === "declined") {
    proposal.declineReason = safeSnippet(reason || "declined", 400);
  }
  if (decision === "confirmed" && proposal.kind === "shell" && (proposal.command || proposal.argv?.length)) {
    try {
      const result = await createRunRequest({
        source: "hermes",
        reason: `Approved proposal: ${proposal.title}`,
        argv: proposal.argv || undefined,
        command: proposal.argv?.length ? undefined : proposal.command || undefined,
        cwd: proposal.cwd || undefined
      });
      proposal.runResult = {
        id: result.id,
        status: result.status,
        exitCode: result.exitCode ?? null,
        durationMs: result.durationMs ?? null,
        output: safeSnippet(result.output || "", 1500)
      };
      proposal.status = result.status === "completed" ? "applied" : "ran";
    } catch (error) {
      proposal.runResult = { error: error?.message || "run failed" };
      proposal.status = "failed";
    }
  }
  await persist();
  await appendMarkdown(proposal);
  await appendHermesEvent({
    type: "mission_update",
    role: "system",
    content: `proposal ${decision}: ${proposal.title}`,
    intent: proposal.id,
    extra: proposal.runResult ? { runResult: proposal.runResult } : undefined
  });
  return proposal;
}

export async function getProposals(limit = 30) {
  await hydrate();
  return proposals.slice(-limit).slice().reverse();
}

export async function getPendingProposals() {
  await hydrate();
  return proposals.filter((item) => item.status === "pending").slice(-30).reverse();
}

export function _resetProposalsForTests() {
  proposals.length = 0;
  hydrated = false;
  storeOverride = null;
  markdownOverride = null;
}
