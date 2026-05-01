import { execFile } from "node:child_process";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const MAX_RESULTS = 80;
const TIMEOUT_MS = 6_000;
const SAFE_PATTERN_RE = /^[\s\S]{1,200}$/;
const FORBIDDEN_FLAG_RE = /(^|\s)(--no-config|-c|--exec|--pre|--no-ignore-vcs)\b/;
const ALLOWED_ROOTS = [ROOTS.project, path.join(ROOTS.home, ".hermes")];

function execFileAsync(bin, args, options = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error || error.code === 1,
        stdout: (stdout || "").toString(),
        stderr: (stderr || "").toString(),
        code: error?.code ?? 0
      });
    });
  });
}

function rootForScope(scope) {
  if (scope === "hermes") return path.join(ROOTS.home, ".hermes");
  return ROOTS.project;
}

export async function searchCode({ pattern, scope = "project", maxResults = MAX_RESULTS, fileGlob = null } = {}) {
  if (!pattern || typeof pattern !== "string" || !SAFE_PATTERN_RE.test(pattern)) {
    const error = new Error("pattern required (1-200 chars)");
    error.status = 400;
    throw error;
  }
  if (FORBIDDEN_FLAG_RE.test(pattern)) {
    const error = new Error("pattern contains forbidden flag-shaped tokens");
    error.status = 400;
    throw error;
  }
  const cwd = rootForScope(scope);
  if (!ALLOWED_ROOTS.includes(cwd)) {
    const error = new Error("scope must be 'project' or 'hermes'");
    error.status = 400;
    throw error;
  }
  const args = [
    "--no-heading",
    "--line-number",
    "--column",
    "--max-count",
    "5",
    "--max-columns",
    "200",
    "--smart-case",
    "--ignore-case",
    "--max-depth",
    "8",
    "--type-add",
    "tsx:*.tsx",
    "--type-add",
    "mjs:*.mjs"
  ];
  if (fileGlob && typeof fileGlob === "string" && /^[a-zA-Z0-9_./*-]+$/.test(fileGlob)) {
    args.push("--glob", fileGlob);
  }
  args.push("--", pattern);
  const result = await execFileAsync("rg", args, { cwd, maxBuffer: 2 * 1024 * 1024 });
  const lines = result.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, maxResults)
    .map((line) => {
      const match = line.match(/^([^:]+):(\d+):(\d+):(.*)$/);
      if (!match) return null;
      return {
        file: match[1],
        line: Number(match[2]),
        column: Number(match[3]),
        snippet: safeSnippet(match[4], 240)
      };
    })
    .filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    pattern,
    scope,
    truncated: result.stdout.split("\n").length > maxResults,
    matches: lines,
    error: result.code > 1 ? safeSnippet(result.stderr, 200) : null
  };
}
