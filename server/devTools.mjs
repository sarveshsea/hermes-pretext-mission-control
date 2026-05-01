import { spawn } from "node:child_process";
import { ROOTS } from "./config.mjs";
import { appendHermesEvent } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const COMMANDS = {
  typecheck: { bin: "npm", args: ["run", "typecheck"] },
  test: { bin: "npm", args: ["test"] },
  build: { bin: "npm", args: ["run", "build"] },
  check: { bin: "npm", args: ["run", "check"] },
  lint: { bin: "npx", args: ["tsc", "--noEmit"] }
};

const TIMEOUT_MS = 240_000;
const MAX_OUTPUT = 50_000;

let activeRuns = new Map();

export async function runDevCheck(name = "check") {
  const spec = COMMANDS[name];
  if (!spec) {
    const error = new Error(`Unknown dev check: ${name}`);
    error.status = 400;
    throw error;
  }
  const startedAt = new Date().toISOString();
  await appendHermesEvent({
    type: "tool_call",
    role: "system",
    content: `dev:${name} start`,
    extra: { source: "devTools" }
  });
  const child = spawn(spec.bin, spec.args, { cwd: ROOTS.project, env: process.env });
  const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const collected = { stdout: "", stderr: "" };
  const onChunk = (kind) => (chunk) => {
    const text = chunk.toString("utf8");
    collected[kind] = `${collected[kind]}${text}`.slice(-MAX_OUTPUT);
    appendHermesEvent({
      type: "tool_result",
      role: "system",
      content: safeSnippet(text, 500),
      extra: { source: "devTools", check: name, stream: kind }
    }).catch(() => {});
  };
  child.stdout.on("data", onChunk("stdout"));
  child.stderr.on("data", onChunk("stderr"));
  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
  }, TIMEOUT_MS);
  activeRuns.set(id, { name, startedAt, child });
  return new Promise((resolve) => {
    child.on("close", async (code) => {
      clearTimeout(timer);
      activeRuns.delete(id);
      const finishedAt = new Date().toISOString();
      const result = {
        id,
        name,
        startedAt,
        finishedAt,
        exitCode: code ?? 0,
        ok: code === 0,
        stdoutTail: safeSnippet(collected.stdout, 2400),
        stderrTail: safeSnippet(collected.stderr, 2400)
      };
      await appendHermesEvent({
        type: "tool_result",
        role: "system",
        content: `dev:${name} ${result.ok ? "ok" : `exit=${code}`}`,
        extra: { source: "devTools", id }
      });
      resolve(result);
    });
  });
}

export function listDevChecks() {
  return Object.keys(COMMANDS);
}

export function getActiveDevRuns() {
  return Array.from(activeRuns.entries()).map(([id, run]) => ({
    id,
    name: run.name,
    startedAt: run.startedAt
  }));
}
