import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { createRunRequest } from "./runRequests.mjs";
import { safeSnippet } from "./redaction.mjs";

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
    decidedAt: null,
    decision: null,
    declineReason: null,
    runResult: null
  };
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
