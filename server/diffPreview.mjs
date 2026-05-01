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
