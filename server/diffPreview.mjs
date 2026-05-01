import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const TIMEOUT_MS = 30_000;
const MAX_DIFF_BYTES = 200_000;

const FORBIDDEN_RE = /\b(rm\s+-rf|sudo|chmod\s+-R\s+0?7?7?7|chown\s+-R|dd\s+if=|mkfs|launchctl\s+(?:unload|remove)|brew\s+uninstall|npm\s+(?:uninstall|cache\s+clean))\b/i;
const NETWORK_RE = /\b(curl|wget|fetch|nc|nmap|ssh|scp|rsync)\b/i;

function execFileAsync(bin, args, options = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: (stdout || "").toString(), stderr: (stderr || "").toString(), code: error?.code ?? 0 });
    });
  });
}

async function rmrf(target) {
  await fs.rm(target, { recursive: true, force: true });
}

export async function previewProposedCommand({ command, argv, allowNetwork = false } = {}) {
  const text = (command || (argv ? argv.join(" ") : "")).trim();
  if (!text) {
    const error = new Error("command or argv required");
    error.status = 400;
    throw error;
  }
  if (FORBIDDEN_RE.test(text)) {
    return {
      ok: false,
      reason: "command matches destructive pattern; refused to preview",
      preview: null
    };
  }
  if (!allowNetwork && NETWORK_RE.test(text)) {
    return {
      ok: false,
      reason: "command contains network-shaped tokens; pass allowNetwork=true if intended",
      preview: null
    };
  }

  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "pretext-preview-"));
  try {
    // Worktree-clone the project so preview cannot touch the live tree.
    const clone = await execFileAsync("git", ["clone", "--shared", "--no-checkout", ROOTS.project, sandbox]);
    if (!clone.ok) {
      return { ok: false, reason: `git clone failed: ${safeSnippet(clone.stderr, 200)}`, preview: null };
    }
    const checkout = await execFileAsync("git", ["-C", sandbox, "checkout"]);
    if (!checkout.ok) {
      return { ok: false, reason: `git checkout failed: ${safeSnippet(checkout.stderr, 200)}`, preview: null };
    }
    const run = argv?.length
      ? await execFileAsync(argv[0], argv.slice(1), { cwd: sandbox, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
      : await execFileAsync("/bin/zsh", ["-c", text], { cwd: sandbox, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const diff = await execFileAsync("git", ["-C", sandbox, "diff", "--no-color", "--stat", "HEAD"]);
    const diffFull = await execFileAsync("git", ["-C", sandbox, "diff", "--no-color", "HEAD"]);
    return {
      ok: true,
      sandbox,
      exitCode: run.code,
      runOutput: safeSnippet(`${run.stdout}\n${run.stderr}`, 4000),
      diffStat: safeSnippet(diff.stdout, 8000),
      diff: diffFull.stdout.length > MAX_DIFF_BYTES
        ? `${diffFull.stdout.slice(0, MAX_DIFF_BYTES)}\n…[truncated ${diffFull.stdout.length - MAX_DIFF_BYTES} bytes]…`
        : diffFull.stdout,
      reason: run.code === 0 ? "preview applied" : `non-zero exit (${run.code})`
    };
  } finally {
    void rmrf(sandbox).catch(() => {});
  }
}

// Preview a structured file edit without going through a shell pipeline.
// Two modes:
//   - find/replace: replace `find` (literal, single occurrence required) with `replace`
//   - content + allowCreate: write a fresh file (must not exist already unless overwrite=true)
// Sandboxed via the same git-clone trick as previewProposedCommand so the live
// tree is never touched. Returns { ok, diffStat, diff, reason }.
export async function previewProposedEdit({
  filePath,
  find,
  replace,
  content,
  allowCreate = false,
  overwrite = false
} = {}) {
  if (!filePath || typeof filePath !== "string") {
    const error = new Error("filePath required");
    error.status = 400;
    throw error;
  }
  // Path containment: filePath must be relative and resolve inside ROOTS.project.
  const normalized = path.normalize(filePath).replace(/^\/+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return { ok: false, reason: "filePath must be relative to project root" };
  }
  const usingFindReplace = typeof find === "string" && find.length > 0;
  const usingContent = typeof content === "string";
  if (!usingFindReplace && !usingContent) {
    return { ok: false, reason: "either find/replace or content must be provided" };
  }
  if (usingFindReplace && typeof replace !== "string") {
    return { ok: false, reason: "replace must be a string when find is provided" };
  }

  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "pretext-edit-preview-"));
  try {
    const clone = await execFileAsync("git", ["clone", "--shared", "--no-checkout", ROOTS.project, sandbox]);
    if (!clone.ok) return { ok: false, reason: `git clone failed: ${safeSnippet(clone.stderr, 200)}` };
    const checkout = await execFileAsync("git", ["-C", sandbox, "checkout"]);
    if (!checkout.ok) return { ok: false, reason: `git checkout failed: ${safeSnippet(checkout.stderr, 200)}` };

    const target = path.join(sandbox, normalized);
    let original = null;
    try {
      original = await fs.readFile(target, "utf8");
    } catch {
      original = null;
    }

    if (usingFindReplace) {
      if (original === null) return { ok: false, reason: `file does not exist: ${normalized}` };
      const idx = original.indexOf(find);
      if (idx === -1) return { ok: false, reason: `find string not found in ${normalized}` };
      const next = original.indexOf(find, idx + find.length);
      if (next !== -1) return { ok: false, reason: `find string is not unique in ${normalized} (matches at ${idx} and ${next})` };
      const updated = original.slice(0, idx) + replace + original.slice(idx + find.length);
      if (updated === original) return { ok: false, reason: "replace produces no change" };
      await fs.writeFile(target, updated, "utf8");
    } else {
      if (original !== null && !overwrite) {
        return { ok: false, reason: `file already exists: ${normalized} (set overwrite=true to replace)` };
      }
      if (original === null && !allowCreate) {
        return { ok: false, reason: `file does not exist: ${normalized} (set allowCreate=true to create)` };
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }

    const add = await execFileAsync("git", ["-C", sandbox, "add", "-A", "--"]);
    if (!add.ok) return { ok: false, reason: `git add failed: ${safeSnippet(add.stderr, 200)}` };
    const diffStat = await execFileAsync("git", ["-C", sandbox, "diff", "--no-color", "--stat", "--cached"]);
    const diffFull = await execFileAsync("git", ["-C", sandbox, "diff", "--no-color", "--cached"]);
    const stat = (diffStat.stdout || "").trim();

    // Pre-commit gate: typecheck the sandbox. node_modules isn't in the
    // shared clone, so we symlink the live tree's node_modules in. This is
    // safe because tsc only reads it. Skip for non-TS files (.md, .json,
    // .css) where typecheck has nothing to verify and just slows us down.
    const skipTypecheck = process.env.PRETEXT_PRECOMMIT_TYPECHECK === "false";
    const isTsFile = /\.(ts|tsx|mts)$/.test(normalized);
    let typecheck = { ok: true, skipped: true };
    if (isTsFile && !skipTypecheck) {
      try {
        await fs.symlink(path.join(ROOTS.project, "node_modules"), path.join(sandbox, "node_modules"));
      } catch {
        // ignore — symlink may already exist if rerun
      }
      const tc = await execFileAsync("npx", ["tsc", "--noEmit"], { cwd: sandbox, timeout: 45_000 });
      typecheck = {
        ok: tc.ok,
        skipped: false,
        exitCode: tc.code,
        stderrTail: safeSnippet((tc.stderr || tc.stdout || "").trim().split("\n").slice(-12).join("\n"), 1200)
      };
    }

    return {
      ok: true,
      diffStat: safeSnippet(stat, 8000),
      diff: diffFull.stdout.length > MAX_DIFF_BYTES
        ? `${diffFull.stdout.slice(0, MAX_DIFF_BYTES)}\n…[truncated]`
        : diffFull.stdout,
      reason: stat ? "preview applied" : "no change",
      typecheck
    };
  } finally {
    void rmrf(sandbox).catch(() => {});
  }
}
