import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

let pathOverride = null;

function messageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function storePath() {
  return pathOverride?.storePath || ROOTS.localMessagesStore;
}

function markdownPath() {
  return pathOverride?.markdownPath || ROOTS.localMessagesMarkdown;
}

export function setLocalMessagePathsForTests(paths) {
  pathOverride = paths;
}

async function readStore() {
  try {
    const text = await fs.readFile(storePath(), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

async function writeStore(messages) {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify({ messages }, null, 2), "utf8");
}

async function appendMarkdown(message) {
  await fs.mkdir(path.dirname(markdownPath()), { recursive: true });
  const header = "# Local Console\n\nDashboard-originated messages for Hermes. Treat as Sarvesh-authored local instructions, but keep normal safety boundaries.\n";
  let existing = "";
  try {
    existing = await fs.readFile(markdownPath(), "utf8");
  } catch {
    existing = header;
  }

  const date = message.createdAt.slice(0, 10);
  const entry = [
    "",
    `## ${date}`,
    "",
    `- [ ] id:${message.id} | from:${message.author} | source:${message.source} | message:${message.body}`,
    ""
  ].join("\n");
  await fs.writeFile(markdownPath(), `${existing.trimEnd()}\n${entry}`, "utf8");
}

export async function getLocalMessages() {
  return readStore();
}

export async function createLocalMessage({ body, author = "sarv", source = "dashboard" }) {
  const cleanBody = safeSnippet(body, 2000);
  if (!cleanBody) {
    const error = new Error("Local message body is required");
    error.status = 400;
    throw error;
  }

  const message = {
    id: messageId(),
    channel: "local-console",
    author: safeSnippet(author || "sarv", 80),
    source: safeSnippet(source || "dashboard", 80),
    status: "captured",
    body: cleanBody,
    createdAt: new Date().toISOString()
  };

  const existing = await readStore();
  await writeStore([message, ...existing].slice(0, 100));
  await appendMarkdown(message);
  return message;
}
