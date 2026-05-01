import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ALLOWED_COMMANDS, ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

let runRequestStoreOverride = null;

export function isAllowedCommand(command) {
  return ALLOWED_COMMANDS.has(String(command ?? "").trim());
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

function assertProjectCwd(cwd) {
  const resolved = path.resolve(cwd);
  if (resolved !== ROOTS.project) {
    throw new Error(`Refusing to run outside Pretext project cwd: ${resolved}`);
  }
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
      allowed: isAllowedCommand(request.command),
      cwd: request.cwd || ROOTS.project
    }));
}

export async function createRunRequest({ command, reason = "", source = "dashboard" }) {
  const normalizedCommand = String(command ?? "").trim();
  const allowed = isAllowedCommand(normalizedCommand);
  const request = {
    id: requestId(),
    command: normalizedCommand,
    source: safeSnippet(source || "dashboard", 120),
    status: allowed ? "pending" : "blocked",
    reason: safeSnippet(reason || "Local builder request", 500),
    cwd: ROOTS.project,
    allowed,
    createdAt: new Date().toISOString()
  };

  const existing = await readJsonStore();
  await writeJsonStore([request, ...existing]);
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
  const commandSpec = ALLOWED_COMMANDS.get(request.command);
  if (!commandSpec) {
    const error = new Error(`Command is not allowlisted: ${request.command}`);
    error.status = 400;
    throw error;
  }
  assertProjectCwd(request.cwd || ROOTS.project);

  const startedAt = new Date().toISOString();
  if (commandSpec.longRunning) {
    const result = {
      id,
      command: request.command,
      cwd: ROOTS.project,
      source: request.source,
      status: "approved_not_launched",
      startedAt,
      finishedAt: new Date().toISOString(),
      output: "The dashboard server is already the local dev process. Start or restart `npm run dev` from a local terminal when needed."
    };
    await appendExecutionResult(result);
    return result;
  }

  const result = await new Promise((resolve) => {
    execFile(
      commandSpec.command,
      commandSpec.args,
      {
        cwd: ROOTS.project,
        timeout: 180_000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          id,
          command: request.command,
          cwd: ROOTS.project,
          source: request.source,
          status: error ? "failed" : "completed",
          exitCode: error?.code ?? 0,
          startedAt,
          finishedAt: new Date().toISOString(),
          output: safeSnippet(`${stdout}\n${stderr}`, 5000)
        });
      }
    );
  });

  await appendExecutionResult(result);
  return result;
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
