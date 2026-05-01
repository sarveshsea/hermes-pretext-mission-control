import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const TTL_MS = 12_000;
let cache = { value: null, at: 0 };

function parseSkillFront(matter) {
  const result = { name: "", description: "", version: "", tags: [] };
  const lines = matter.split("\n");
  let inTags = false;
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) {
      const [, key, value] = m;
      if (key === "name") result.name = value.trim().replace(/^['"]|['"]$/g, "");
      else if (key === "description") result.description = value.trim().replace(/^['"]|['"]$/g, "");
      else if (key === "version") result.version = value.trim().replace(/^['"]|['"]$/g, "");
      inTags = false;
    }
    if (line.trim().startsWith("- ") && inTags) {
      result.tags.push(line.trim().replace(/^- /, ""));
    }
    if (/^\s*tags:/.test(line)) inTags = true;
  }
  return result;
}

async function loadSkillFile(skillDir) {
  const skillFile = path.join(skillDir, "SKILL.md");
  try {
    const text = await fs.readFile(skillFile, "utf8");
    const front = text.startsWith("---") ? text.split(/^---\s*$/m)[1] || "" : "";
    const meta = parseSkillFront(front);
    const stat = await fs.stat(skillFile);
    return {
      name: meta.name || path.basename(skillDir),
      description: meta.description,
      version: meta.version,
      tags: meta.tags,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      path: skillDir
    };
  } catch {
    return null;
  }
}

async function walkSkills(root, depth = 2) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    const skill = await loadSkillFile(full);
    if (skill) {
      out.push(skill);
    } else if (depth > 0) {
      out.push(...(await walkSkills(full, depth - 1)));
    }
  }
  return out;
}

function parseDisabledSkills(configText) {
  const match = configText.match(/skills:\s*\n([\s\S]*?)\n[a-zA-Z_]/);
  if (!match) return [];
  const block = match[1];
  const items = [];
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*-\s+(.+?)\s*$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

export async function getHermesSkills({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;
  const [installed, configText] = await Promise.all([
    walkSkills(path.join(ROOTS.hermes, "skills"), 2),
    fs.readFile(path.join(ROOTS.hermes, "config.yaml"), "utf8").catch(() => "")
  ]);
  const disabledSet = new Set(parseDisabledSkills(configText));
  const annotated = installed
    .map((skill) => ({
      ...skill,
      disabled: disabledSet.has(skill.name)
    }))
    .sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name));
  const value = {
    generatedAt: new Date().toISOString(),
    activeCount: annotated.filter((s) => !s.disabled).length,
    disabledCount: annotated.filter((s) => s.disabled).length,
    totalCount: annotated.length,
    skills: annotated.slice(0, 80)
  };
  cache = { value, at: now };
  return value;
}
