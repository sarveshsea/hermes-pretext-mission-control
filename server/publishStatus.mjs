import { execFile } from "node:child_process";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

function execGit(args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd: ROOTS.project,
        timeout: 3000,
        maxBuffer: 256 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: safeSnippet(stdout || "", 2000),
          stderr: safeSnippet(stderr || "", 2000)
        });
      }
    );
  });
}

export function classifyPublishStatus({ projectRoot, gitRoot, remote }) {
  const normalizedProject = path.resolve(projectRoot);
  const normalizedGitRoot = gitRoot ? path.resolve(gitRoot) : "";
  const cleanRemote = safeSnippet(remote || "none", 500);

  if (!normalizedGitRoot) {
    return {
      state: "unconfigured",
      remote: cleanRemote,
      reason: "Pretext is not inside its own Git repository."
    };
  }

  if (normalizedGitRoot !== normalizedProject) {
    return {
      state: "blocked",
      remote: cleanRemote,
      gitRoot: normalizedGitRoot,
      reason: "Git resolves Pretext through a parent or home-level repository. Auto-push is blocked until Pretext has its own repository."
    };
  }

  if (!remote) {
    return {
      state: "unconfigured",
      remote: "none",
      gitRoot: normalizedGitRoot,
      reason: "Pretext has a local Git repository but no GitHub remote."
    };
  }

  return {
    state: "ready",
    remote: cleanRemote,
    gitRoot: normalizedGitRoot,
    reason: "Pretext has its own Git repository and remote. Push still requires explicit confirmation before external upload."
  };
}

export async function getPublishStatus() {
  const [rootResult, remoteResult] = await Promise.all([
    execGit(["rev-parse", "--show-toplevel"]),
    execGit(["remote", "get-url", "origin"])
  ]);

  return classifyPublishStatus({
    projectRoot: ROOTS.project,
    gitRoot: rootResult.ok ? rootResult.stdout.trim() : "",
    remote: remoteResult.ok ? remoteResult.stdout.trim() : ""
  });
}
