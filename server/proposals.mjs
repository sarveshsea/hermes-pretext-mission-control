import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent, lastThinkingAge } from "./hermesEvents.mjs";
import { createRunRequest } from "./runRequests.mjs";
import { safeSnippet } from "./redaction.mjs";
import { previewProposedCommand, previewProposedEdit } from "./diffPreview.mjs";

const MAX_HISTORY = 200;
const STORE_FILE = path.join(ROOTS.project, "data/improvement-proposals.json");
const MARKDOWN_FILE = path.join(ROOTS.hermesOps, "proposals.md");

const VALID_KIND = new Set(["shell", "patch", "note", "edit"]);

function execGit(args, options = {}) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOTS.project, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: (stdout || "").toString(), stderr: (stderr || "").toString(), code: error?.code ?? 0 });
    });
  });
}

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

const THINKING_WINDOW_MS = 60_000;

async function validateProposalActuallyChanges(proposal) {
  // Pattern 4 enforced server-side: require Hermes to have narrated reasoning
  // (thinking / model_call / model_result event) within the last minute before
  // it can submit an autoSafe proposal. Forces the model to use bridge.thinking().
  const age = lastThinkingAge(proposal.sessionId);
  if (age > THINKING_WINDOW_MS) {
    return {
      ok: false,
      reason: `No bridge.thinking() / model_call event in the last 60s${proposal.sessionId ? ` for session ${proposal.sessionId}` : ""}. Call bridge.thinking('<one-line reasoning>') before proposing.`
    };
  }
  if (proposal.kind === "edit") {
    if (!proposal.filePath) return { ok: false, reason: "edit proposal missing filePath" };
    try {
      const preview = await previewProposedEdit({
        filePath: proposal.filePath,
        find: proposal.find,
        replace: proposal.replace,
        content: proposal.content,
        allowCreate: proposal.allowCreate === true,
        overwrite: proposal.overwrite === true
      });
      if (!preview.ok) return { ok: false, reason: `edit preview failed: ${preview.reason}` };
      const stat = (preview.diffStat || "").trim();
      if (!stat) return { ok: false, reason: "edit preview produced no diff" };
      // Pre-commit gate: sandbox typecheck. Catches malformed JSX, orphan
      // returns, dangling braces, type errors — BEFORE the live commit.
      // Skipped for non-TS files (preview returns {skipped:true}).
      if (preview.typecheck && preview.typecheck.skipped !== true && preview.typecheck.ok === false) {
        return {
          ok: false,
          reason: `typecheck regression in sandbox: ${preview.typecheck.stderrTail || `exit ${preview.typecheck.exitCode}`}`
        };
      }
      return { ok: true, preview };
    } catch (error) {
      return { ok: false, reason: `edit preview error: ${error?.message || "unknown"}` };
    }
  }
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
    runResult: null,
    // edit-kind fields
    filePath: kind === "edit" && input.filePath ? String(input.filePath).slice(0, 400) : null,
    find: kind === "edit" && typeof input.find === "string" ? input.find.slice(0, 4000) : null,
    replace: kind === "edit" && typeof input.replace === "string" ? input.replace.slice(0, 4000) : null,
    content: kind === "edit" && typeof input.content === "string" ? input.content.slice(0, 20000) : null,
    allowCreate: kind === "edit" && input.allowCreate === true,
    overwrite: kind === "edit" && input.overwrite === true,
    playbookId: kind === "edit" && input.playbookId ? String(input.playbookId).slice(0, 60) : null
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

async function runTypecheckPostApply() {
  return new Promise((resolve) => {
    execFile("npm", ["run", "typecheck"], { cwd: ROOTS.project, timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, exitCode: error?.code ?? 0, stdout: (stdout || "").slice(-1500), stderr: (stderr || "").slice(-1500) });
    });
  });
}

const REGRESSIONS_LOG = path.join(ROOTS.project, "data/regressions.jsonl");
async function appendRegression(entry) {
  try {
    await fs.mkdir(path.dirname(REGRESSIONS_LOG), { recursive: true });
    await fs.appendFile(REGRESSIONS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

async function applyEditProposal(proposal) {
  const started = Date.now();
  try {
    const target = path.join(ROOTS.project, proposal.filePath);
    if (!target.startsWith(ROOTS.project + path.sep)) {
      return { exitCode: 1, error: "filePath escapes project root", durationMs: Date.now() - started };
    }
    let original = null;
    try {
      original = await fs.readFile(target, "utf8");
    } catch {
      original = null;
    }
    if (proposal.find) {
      if (original === null) return { exitCode: 1, error: `file does not exist: ${proposal.filePath}`, durationMs: Date.now() - started };
      const idx = original.indexOf(proposal.find);
      if (idx === -1) return { exitCode: 1, error: "find string not found at apply time (file changed since preview)", durationMs: Date.now() - started };
      const next = original.indexOf(proposal.find, idx + proposal.find.length);
      if (next !== -1) return { exitCode: 1, error: "find string is no longer unique", durationMs: Date.now() - started };
      const updated = original.slice(0, idx) + proposal.replace + original.slice(idx + proposal.find.length);
      await fs.writeFile(target, updated, "utf8");
    } else if (typeof proposal.content === "string") {
      if (original !== null && !proposal.overwrite) {
        return { exitCode: 1, error: "file already exists; overwrite not set", durationMs: Date.now() - started };
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, proposal.content, "utf8");
    } else {
      return { exitCode: 1, error: "edit proposal has no find/replace or content", durationMs: Date.now() - started };
    }
    const add = await execGit(["add", "--", proposal.filePath]);
    if (!add.ok) return { exitCode: 1, error: `git add failed: ${safeSnippet(add.stderr, 200)}`, durationMs: Date.now() - started };
    const commitMsg = `${safeSnippet(proposal.title, 80)}\n\n${safeSnippet(proposal.rationale || "Hermes edit proposal", 240)}`;
    const commit = await execGit(["commit", "-m", commitMsg]);
    if (!commit.ok) {
      // No-op commit can happen if the find/replace was already applied between
      // preview and apply. Surface as failed rather than silent.
      return { exitCode: 1, error: `git commit failed: ${safeSnippet(commit.stderr || commit.stdout, 200)}`, durationMs: Date.now() - started };
    }
    const sha = await execGit(["rev-parse", "--short", "HEAD"]);
    const push = await execGit(["push"]);
    // Post-apply belt-and-suspenders: even though previewProposedEdit
    // already typechecks in the sandbox, run tsc one more time on the live
    // tree. If it fails (rare — only happens if the sandbox skipped or
    // missed something), AUTO-REVERT the commit + push the revert. The
    // dashboard self-heals within ~30s.
    const tc = await runTypecheckPostApply();
    let revertedSha = null;
    if (!tc.ok) {
      try {
        const revert = await execGit(["revert", "HEAD", "--no-edit"]);
        if (revert.ok) {
          const revertSha = await execGit(["rev-parse", "--short", "HEAD"]);
          revertedSha = (revertSha.stdout || "").trim();
          await execGit(["push"]).catch(() => {});
          await appendRegression({
            proposalId: proposal.id,
            badSha: (sha.stdout || "").trim(),
            revertSha: revertedSha,
            stderrTail: tc.stderr.slice(-1000) || tc.stdout.slice(-1000),
            filePath: proposal.filePath,
            title: proposal.title
          });
          await appendHermesEvent({
            type: "error",
            role: "system",
            content: `post-apply tsc failed → AUTO-REVERTED ${(sha.stdout || "").trim()} via ${revertedSha}`,
            intent: proposal.id,
            extra: { badSha: (sha.stdout || "").trim(), revertSha: revertedSha }
          });
        } else {
          await appendHermesEvent({
            type: "error",
            role: "system",
            content: `post-apply tsc failed AND auto-revert failed: ${safeSnippet(revert.stderr, 200)}`,
            intent: proposal.id
          });
        }
      } catch (error) {
        await appendHermesEvent({
          type: "error",
          role: "system",
          content: `post-apply auto-revert error: ${error?.message || "unknown"}`,
          intent: proposal.id
        });
      }
    }
    return {
      exitCode: revertedSha ? 1 : 0,
      sha: (sha.stdout || "").trim(),
      revertedSha,
      durationMs: Date.now() - started,
      pushed: push.ok,
      pushOutput: safeSnippet(push.stderr || push.stdout || "", 600),
      output: safeSnippet(
        revertedSha
          ? `applied to ${proposal.filePath} then AUTO-REVERTED via ${revertedSha} (typecheck failed)`
          : `applied to ${proposal.filePath}`,
        260
      ),
      typecheck: { ok: tc.ok, exitCode: tc.exitCode }
    };
  } catch (error) {
    return { exitCode: 1, error: error?.message || "apply failed", durationMs: Date.now() - started };
  }
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
  if (decision === "confirmed" && proposal.kind === "edit") {
    proposal.runResult = await applyEditProposal(proposal);
    if (proposal.runResult?.revertedSha) proposal.status = "applied-then-reverted";
    else if (proposal.runResult?.exitCode !== 0) proposal.status = "failed";
    else proposal.status = "applied";
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
