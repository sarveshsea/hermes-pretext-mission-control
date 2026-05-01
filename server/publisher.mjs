import { execFile } from "node:child_process";
import { ROOTS } from "./config.mjs";
import { getPublishStatus } from "./publishStatus.mjs";
import { safeSnippet } from "./redaction.mjs";

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36,}/,
  /sk-[A-Za-z0-9]{40,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /TELEGRAM_BOT_TOKEN\s*=\s*\S{8,}/i,
  /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/
];

export function findSecretMatch(text) {
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { pattern: pattern.source, sample: match[0].slice(0, 12) };
  }
  return null;
}

const PUBLISH_PATHS = [
  ".gitignore",
  "CHANGELOG.md",
  "DESIGN.md",
  "README.md",
  "index.html",
  "package-lock.json",
  "package.json",
  "server",
  "src",
  "tests",
  "tsconfig.json",
  "vite.config.ts"
];

function execProjectFile(command, args) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: ROOTS.project,
        timeout: 180_000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          stdout: safeSnippet(stdout || "", 5000),
          stderr: safeSnippet(stderr || "", 5000)
        });
      }
    );
  });
}

async function defaultExecGit(args) {
  return execProjectFile("git", args);
}

async function defaultExecNpm(args) {
  return execProjectFile("npm", args);
}

function assertOk(result, label) {
  if (result.ok) return;
  const error = new Error(`${label} failed: ${result.stderr || result.stdout || result.code}`);
  error.status = 500;
  throw error;
}

export async function publishProjectChanges({
  publishStatus,
  message = "Automated Pretext improvement",
  execGit = defaultExecGit,
  execNpm = defaultExecNpm
} = {}) {
  const status = publishStatus || (await getPublishStatus());
  if (status.state !== "ready") {
    return {
      status: "skipped",
      reason: status.reason || "Publish status is not ready",
      remote: status.remote || "none"
    };
  }

  const check = await execNpm(["run", "check"]);
  assertOk(check, "npm run check");

  const before = await execGit(["status", "--porcelain"]);
  assertOk(before, "git status");
  if (!before.stdout.trim()) {
    return {
      status: "skipped",
      reason: "No project changes to publish",
      remote: status.remote
    };
  }

  const add = await execGit(["add", ...PUBLISH_PATHS]);
  assertOk(add, "git add");

  if (process.env.PRETEXT_PUBLISH_NO_SECRET_GUARD !== "true") {
    const diff = await execGit(["diff", "--cached"]);
    assertOk(diff, "git diff --cached");
    const found = findSecretMatch(`${diff.stdout}\n${diff.stderr}`);
    if (found) {
      const error = new Error(
        `Refusing to commit: staged diff matches secret pattern ${found.pattern} (sample: ${found.sample}…). ` +
          `Override with PRETEXT_PUBLISH_NO_SECRET_GUARD=true if intentional.`
      );
      error.status = 500;
      throw error;
    }
  }

  const commit = await execGit(["commit", "-m", message]);
  assertOk(commit, "git commit");

  const push = await execGit(["push"]);
  assertOk(push, "git push");

  const head = await execGit(["rev-parse", "--short", "HEAD"]);
  assertOk(head, "git rev-parse");

  return {
    status: "published",
    remote: status.remote,
    commit: head.stdout.trim(),
    output: push.stdout || push.stderr
  };
}
