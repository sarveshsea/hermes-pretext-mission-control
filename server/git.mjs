import { execFile } from "node:child_process";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const TTL_MS = 6000;
let cache = { value: null, at: 0 };

function execGit(args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: ROOTS.project,
        timeout: options.timeout || 4000,
        maxBuffer: 256 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: (stdout || "").toString().trim(),
          stderr: (stderr || "").toString().trim()
        });
      }
    );
  });
}

export async function getGitState({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  const [branchRes, headRes, lastRes, remoteRes, dirtyRes, aheadRes, lsRemote] = await Promise.all([
    execGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    execGit(["rev-parse", "--short", "HEAD"]),
    execGit(["log", "-1", "--pretty=format:%H%x09%h%x09%an%x09%ae%x09%s%x09%cI"]),
    execGit(["remote", "get-url", "origin"]),
    execGit(["status", "--porcelain"]),
    execGit(["rev-list", "--count", "@{u}..HEAD"]).catch(() => ({ ok: false, stdout: "" })),
    execGit(["ls-remote", "--heads", "origin"], { timeout: 6000 })
  ]);
  const lastParts = lastRes.ok ? lastRes.stdout.split("\t") : [];
  const value = {
    generatedAt: new Date().toISOString(),
    branch: branchRes.ok ? branchRes.stdout : null,
    head: headRes.ok ? headRes.stdout : null,
    lastCommit: lastParts.length === 6
      ? {
          sha: lastParts[0],
          short: lastParts[1],
          author: lastParts[2],
          email: safeSnippet(lastParts[3], 80),
          subject: safeSnippet(lastParts[4], 200),
          committedAt: lastParts[5]
        }
      : null,
    remote: remoteRes.ok ? safeSnippet(remoteRes.stdout, 200) : null,
    dirty: dirtyRes.ok && dirtyRes.stdout.length > 0,
    dirtyFiles: dirtyRes.ok ? dirtyRes.stdout.split("\n").filter(Boolean).length : 0,
    ahead: aheadRes.ok ? Number(aheadRes.stdout) || 0 : 0,
    pushAuth: {
      ok: lsRemote.ok,
      reason: lsRemote.ok ? "ls-remote ok" : safeSnippet(lsRemote.stderr || "ls-remote failed", 200)
    }
  };
  cache = { value, at: now };
  return value;
}
