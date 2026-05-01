import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { subscribeHermesEvents } from "./hermesEvents.mjs";
import { safeSnippet } from "./redaction.mjs";

const DEFAULT_DIR = path.join(ROOTS.agent, "Hermes Logs");
const TYPE_ICON = {
  telegram_in: "📥",
  telegram_out: "📤",
  model_call: "🧠",
  tool_call: "🔧",
  tool_result: "✅",
  iteration_tick: "↻",
  error: "⚠",
  public_intent: "🔒",
  public_action: "🔓",
  run_request: "▶",
  run_chunk: "·",
  run_result: "■",
  thinking: "💭",
  mission_start: "🚀",
  mission_update: "✎",
  memory_read: "📖",
  memory_write: "✍",
  note: "•"
};

let dirOverride = null;
let started = false;
let unsubscribe = null;

export function setObsidianLogDirForTests(dir) {
  dirOverride = dir;
  started = false;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function logDir() {
  return dirOverride || DEFAULT_DIR;
}

function dailyPath(date = new Date()) {
  return path.join(logDir(), `${date.toISOString().slice(0, 10)}.md`);
}

async function ensureDailyHeader(file) {
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const date = path.basename(file, ".md");
    const header =
      `# Hermes Log — ${date}\n\n` +
      "Auto-mirrored from the Pretext dashboard. Each row is a single event.\n" +
      "Format: `HH:MM:SS  type  role  content` with optional metadata.\n\n";
    await fs.writeFile(file, header, "utf8");
  }
}

function renderLine(event) {
  const time = event.createdAt.slice(11, 19);
  const icon = TYPE_ICON[event.type] || "·";
  const tag = event.type.padEnd(14, " ");
  const role = (event.role || "").padEnd(9, " ").slice(0, 9);
  const body = safeSnippet((event.content || "").replace(/\s+/g, " "), 600);
  const extras = [];
  if (event.model) extras.push(`model=${event.model}`);
  if (event.iteration != null) extras.push(`iter=${event.iteration}`);
  if (event.intent) extras.push(`intent=${event.intent.slice(0, 12)}`);
  if (event.sessionId) extras.push(`session=${event.sessionId}`);
  const meta = extras.length ? `  _${extras.join(" · ")}_` : "";
  return `- \`${time}\` ${icon} \`${tag}\` \`${role}\` ${body}${meta}`;
}

export async function appendObsidianLog(event) {
  try {
    const file = dailyPath(new Date(event.createdAt || Date.now()));
    await ensureDailyHeader(file);
    await fs.appendFile(file, `${renderLine(event)}\n`, "utf8");
  } catch {
    // best-effort: a missing vault should never block the agent
  }
}

export function startObsidianLogger() {
  if (started) return;
  started = true;
  unsubscribe = subscribeHermesEvents((event) => {
    void appendObsidianLog(event);
  });
}

export function stopObsidianLoggerForTests() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  started = false;
}
