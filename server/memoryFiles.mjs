import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { safeSnippet } from "./redaction.mjs";

const TTL_MS = 8000;
let cache = { value: null, at: 0 };

async function readMemoryFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const text = await fs.readFile(filePath, "utf8");
    const front = text.startsWith("---") ? text.split(/^---\s*$/m)[1] || "" : "";
    const nameMatch = front.match(/^\s*name:\s*(.+)$/m);
    const descMatch = front.match(/^\s*description:\s*(.+)$/m);
    const typeMatch = front.match(/^\s*type:\s*(.+)$/m);
    const body = text.replace(/^---[\s\S]*?---\s*/, "").trim();
    return {
      name: (nameMatch?.[1] || path.basename(filePath, ".md")).replace(/^['"]|['"]$/g, ""),
      description: safeSnippet((descMatch?.[1] || "").replace(/^['"]|['"]$/g, ""), 200),
      type: (typeMatch?.[1] || "memory").replace(/^['"]|['"]$/g, ""),
      file: path.basename(filePath),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      excerpt: safeSnippet(body.split("\n").filter(Boolean).slice(0, 4).join(" "), 280)
    };
  } catch {
    return null;
  }
}

export async function getMemoryFiles({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  const dir = path.join(ROOTS.hermes, "memories");
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    entries = [];
  }
  const files = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const summary = await readMemoryFile(path.join(dir, name));
    if (summary) files.push(summary);
  }
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const value = {
    generatedAt: new Date().toISOString(),
    count: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    files
  };
  cache = { value, at: now };
  return value;
}
