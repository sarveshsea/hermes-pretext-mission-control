import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { getHermesRuntime } from "./hermesRuntime.mjs";
import { safeSnippet, sanitizeText } from "./redaction.mjs";

const DEFAULT_RUN_TIMEOUT_MS = Number(process.env.PRETEXT_RUN_TIMEOUT_MS || 600_000);
const DEFAULT_SHELL = process.env.SHELL || "/bin/zsh";
const MAX_OUTPUT_CHARS = 20_000;

let runRequestStoreOverride = null;

// Kept for backwards compatibility with existing tests; allowlist is now empty,
// meaning every command is permitted but isAllowedCommand always returns true.
export function isAllowedCommand() {
  return true;
}

export function setRunRequestStoreForTests(filePath) {
  runRequestStoreOverride = filePath;
}

function runRequestStorePath() {
  return runRequestStoreOverride || ROOTS.runRequestsStore;
}

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readJsonStore() {
  try {
    const text = await fs.readFile(runRequestStorePath(), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.requests) ? parsed.requests : [];
  } catch {
    return [];
  }
}

async function writeJsonStore(requests) {
  await fs.mkdir(path.dirname(runRequestStorePath()), { recursive: true });
  await fs.writeFile(runRequestStorePath(), JSON.stringify({ requests }, null, 2), "utf8");
}

function parseMarkdownRequests(markdown) {
  const requests = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/-\s+\[\s?\]\s+id:\s*([^|]+)\|\s*command:\s*([^|]+)(?:\|\s*reason:\s*(.+))?/i);
    if (!match) continue;
    const id = match[1].trim();
    const command = match[2].trim();
    requests.push({
      id,
      command,
      source: "obsidian",
      status: "pending",
      reason: safeSnippet(match[3] || "Telegram-originated run request"),
      cwd: ROOTS.project
    });
  }
  return requests;
}

async function readMarkdownRequests() {
  try {
    return parseMarkdownRequests(await fs.readFile(ROOTS.runRequestsMarkdown, "utf8"));
  } catch {
    return [];
  }
}

export async function getRunRequests() {
  const stored = await readJsonStore();
  const markdown = runRequestStoreOverride ? [] : await readMarkdownRequests();
  const seen = new Set();
  return [...stored, ...markdown]
    .filter((request) => {
      if (!request?.id || seen.has(request.id)) return false;
      seen.add(request.id);
      return true;
    })
    .map((request) => ({
      ...request,
      allowed: true,
      cwd: request.cwd || ROOTS.project
    }));
}

function autoApproveAllowed(source) {
  if (source === "hermes") return process.env.PRETEXT_AUTO_APPROVE !== "false";
  return false;
}

export async function createRunRequest({
  command,
  argv,
  cwd,
  reason = "",
  source = "dashboard",
  shell
}) {
  const normalizedCommand = command ? String(command).trim() : "";
  const normalizedArgv = Array.isArray(argv) ? argv.map((part) => String(part)) : null;
  if (!normalizedCommand && !normalizedArgv?.length) {
    const error = new Error("Run request requires `command` or `argv`");
    error.status = 400;
    throw error;
  }
  const cleanCwd = cwd ? path.resolve(String(cwd)) : ROOTS.project;
  const request = {
    id: requestId(),
    command: normalizedCommand || normalizedArgv.join(" "),
    argv: normalizedArgv || undefined,
    shell: shell != null ? Boolean(shell) : !normalizedArgv,
    source: safeSnippet(source || "dashboard", 120),
    status: "pending",
    reason: safeSnippet(reason || "", 500),
    cwd: cleanCwd,
    allowed: true,
    createdAt: new Date().toISOString()
  };

  const existing = await readJsonStore();
  await writeJsonStore([request, ...existing]);

  await appendHermesEvent({
    type: "run_request",
    role: source === "hermes" ? "assistant" : "user",
    content: request.command,
    intent: request.id,
    extra: { source: request.source, cwd: request.cwd }
  });

  if (autoApproveAllowed(source)) {
    return approveRunRequest(request.id);
  }

  return request;
}

export async function approveRunRequest(id) {
  const requests = await getRunRequests();
  const request = requests.find((item) => item.id === id);
  if (!request) {
    const error = new Error(`Unknown run request: ${id}`);
    error.status = 404;
    throw error;
  }

  const startedAt = new Date().toISOString();
  await appendHermesEvent({
    type: "run_chunk",
    role: "system",
    content: `start ${request.command}`,
    intent: request.id,
    extra: { cwd: request.cwd }
  });

  const result = await runOnce(request, startedAt);
  await appendExecutionResult(result);
  await appendHermesEvent({
    type: "run_result",
    role: "system",
    content: `${result.status} exit=${result.exitCode} dur=${result.durationMs}ms`,
    intent: request.id,
    extra: { command: request.command }
  });
  return result;
}

function spawnProcess(request) {
  if (request.argv && request.argv.length) {
    const [bin, ...rest] = request.argv;
    return spawn(bin, rest, { cwd: request.cwd, env: process.env, shell: false });
  }
  return spawn(request.command, [], {
    cwd: request.cwd,
    env: process.env,
    shell: DEFAULT_SHELL
  });
}

async function runOnce(request, startedAt) {
  const child = spawnProcess(request);
  let stdoutBuf = "";
  let stderrBuf = "";
  const start = Date.now();

  const onChunk = (stream, chunk) => {
    const text = chunk.toString("utf8");
    if (stream === "stdout") stdoutBuf = `${stdoutBuf}${text}`.slice(-MAX_OUTPUT_CHARS);
    else stderrBuf = `${stderrBuf}${text}`.slice(-MAX_OUTPUT_CHARS);
    appendHermesEvent({
      type: "run_chunk",
      role: "system",
      content: sanitizeText(text).slice(0, 800),
      intent: request.id,
      extra: { stream }
    }).catch(() => {});
  };

  child.stdout?.on("data", (chunk) => onChunk("stdout", chunk));
  child.stderr?.on("data", (chunk) => onChunk("stderr", chunk));

  const timeoutHandle = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, DEFAULT_RUN_TIMEOUT_MS);

  return new Promise((resolve) => {
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      resolve({
        id: request.id,
        command: request.command,
        argv: request.argv,
        cwd: request.cwd,
        source: request.source,
        status: "failed",
        exitCode: error.code || 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        output: safeSnippet(`${stdoutBuf}\n${stderrBuf}\n${error.message}`, 5000)
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      const exitCode = signal ? 137 : code ?? 0;
      resolve({
        id: request.id,
        command: request.command,
        argv: request.argv,
        cwd: request.cwd,
        source: request.source,
        status: exitCode === 0 ? "completed" : "failed",
        exitCode,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
        output: safeSnippet(`${stdoutBuf}\n${stderrBuf}`, 5000)
      });
    });
  });
}

export async function rejectRunRequest(id, reason = "Rejected locally") {
  const requests = await getRunRequests();
  const request = requests.find((item) => item.id === id);
  if (!request) {
    const error = new Error(`Unknown run request: ${id}`);
    error.status = 404;
    throw error;
  }

  const result = {
    ...request,
    status: "rejected",
    rejectedAt: new Date().toISOString(),
    output: safeSnippet(reason || "Rejected locally", 1000),
    source: request.source || "dashboard"
  };
  await appendExecutionResult(result);
  return result;
}

async function appendExecutionResult(result) {
  const existing = await readJsonStore();
  const without = existing.filter((request) => request.id !== result.id);
  await writeJsonStore([
    {
      ...result,
      source: result.source || "dashboard"
    },
    ...without
  ]);
}

export async function getRuntimeRunHints() {
  return getHermesRuntime();
}
