import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS, MAX_FILE_BYTES } from "./config.mjs";
import { getBuilderLoopStatus } from "./builderLoop.mjs";
import { getChangelog } from "./changelog.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";
import { getHermesRuntime } from "./hermesRuntime.mjs";
import { getImprovementEvents, getImprovementLoopStatus } from "./improvementLoop.mjs";
import { getLocalMessages } from "./localMessages.mjs";
import { getMissionState } from "./missions.mjs";
import { getPendingPublicIntents } from "./publicIntents.mjs";
import { probeSystem } from "./systemProbe.mjs";
import { getHermesSessions } from "./sessions.mjs";
import { getHermesSkills } from "./skills.mjs";
import { getMemoryFiles } from "./memoryFiles.mjs";
import { getEventTimeline } from "./timeline.mjs";
import { getGitState } from "./git.mjs";
import { getPendingProposals } from "./proposals.mjs";
import { getPublishStatus } from "./publishStatus.mjs";
import { isExcludedPath, publicPath, safeSnippet, sanitizeText } from "./redaction.mjs";
import { getRunRequests } from "./runRequests.mjs";

const cache = new Map();

async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await producer();
  cache.set(key, { at: now, value });
  return value;
}

async function readText(filePath, fallback = "") {
  try {
    if (isExcludedPath(filePath)) return fallback;
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) return fallback;
    return sanitizeText(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function execFileSafe(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeout || 4000,
        cwd: options.cwd,
        maxBuffer: 512 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: sanitizeText(stdout || ""),
          stderr: sanitizeText(stderr || ""),
          code: error?.code ?? 0
        });
      }
    );
  });
}

function parseDefaultModel(configText) {
  return configText.match(/default:\s*"?([^"\n]+)"?/m)?.[1]?.trim() || "unknown";
}

export async function getStatus() {
  return cached("status", 5000, async () => {
    const config = await readText(path.join(ROOTS.hermes, "config.yaml"));
    const sessionsText = await readText(path.join(ROOTS.hermesSessions, "sessions.json"), "{}");
    const gateway = await execFileSafe("launchctl", ["print", `gui/${process.getuid()}/ai.hermes.gateway`], {
      timeout: 3000
    });
    let telegramSession = "unknown";
    try {
      const sessions = JSON.parse(sessionsText || "{}");
      telegramSession = sessions["agent:main:telegram:dm:5880414420"]?.session_id || "not active";
    } catch {
      telegramSession = "unreadable";
    }
    let homeChannel = "not set";
    try {
      const dirText = await fs.readFile(path.join(ROOTS.hermes, "channel_directory.json"), "utf8");
      const dir = JSON.parse(dirText);
      const targets = Array.isArray(dir.targets) ? dir.targets : Object.values(dir.targets || {});
      const home = targets.find((entry) => entry?.is_home || entry?.role === "home") || targets[0];
      if (home?.chat_id) {
        const cid = String(home.chat_id);
        const masked = cid.length > 4 ? `${cid.slice(0, 2)}***${cid.slice(-3)}` : cid;
        homeChannel = `${home.platform || "telegram"}:${masked}`;
      }
    } catch {
      homeChannel = "unconfigured";
    }
    let gatewayState = "not running";
    if (gateway.stdout.includes("state = running")) {
      gatewayState = "running";
    } else {
      const probe = await execFileSafe("pgrep", ["-f", "hermes_cli.main gateway"], { timeout: 1500 });
      if (probe.ok && probe.stdout.trim()) gatewayState = "running";
    }
    return {
      generatedAt: new Date().toISOString(),
      model: parseDefaultModel(config),
      gateway: gatewayState,
      telegramSession,
      homeChannel,
      dashboardHost: "127.0.0.1",
      writeSafeRoot: ROOTS.vault,
      projectSandbox: ROOTS.project,
      builderLoop: getBuilderLoopStatus(),
      improvementLoop: getImprovementLoopStatus()
    };
  });
}

function summarizeMarkdown(text) {
  const lines = text.split("\n");
  const headings = lines
    .filter((line) => /^#{1,3}\s+/.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^#+\s+/, ""));
  const tasks = lines.filter((line) => /^-\s+\[[ xX]\]/.test(line));
  return {
    headings,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((line) => /^-\s+\[ \]/.test(line)).length,
    snippet: safeSnippet(lines.filter(Boolean).slice(0, 12).join(" "))
  };
}

export async function getReviewQueues() {
  return cached("reviewQueues", 8000, async () => {
    const entries = await fs.readdir(ROOTS.reviewQueues, { withFileTypes: true }).catch(() => []);
    const queues = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(ROOTS.reviewQueues, entry.name);
      if (isExcludedPath(filePath)) continue;
      const [stat, text] = await Promise.all([fs.stat(filePath), readText(filePath)]);
      queues.push({
        name: entry.name.replace(/\.md$/, ""),
        path: publicPath(filePath),
        updatedAt: stat.mtime.toISOString(),
        bytes: stat.size,
        ...summarizeMarkdown(text)
      });
    }
    return queues.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
}

async function readPackageSummary(projectPath) {
  const packagePath = path.join(projectPath, "package.json");
  if (!(await pathExists(packagePath)) || isExcludedPath(packagePath)) return null;
  try {
    const pkg = JSON.parse(await readText(packagePath, "{}"));
    return {
      name: pkg.name || path.basename(projectPath),
      description: safeSnippet(pkg.description || ""),
      scripts: Object.keys(pkg.scripts || {}).slice(0, 12),
      dependencies: Object.keys(pkg.dependencies || {}).length,
      devDependencies: Object.keys(pkg.devDependencies || {}).length
    };
  } catch {
    return null;
  }
}

async function gitSummary(projectPath) {
  if (!(await pathExists(path.join(projectPath, ".git")))) return null;
  const [status, head] = await Promise.all([
    execFileSafe("git", ["status", "--short", "--branch"], { cwd: projectPath, timeout: 3000 }),
    execFileSafe("git", ["log", "-1", "--oneline"], { cwd: projectPath, timeout: 3000 })
  ]);
  return {
    branch: status.stdout.split("\n")[0] || "unknown",
    changedFiles: status.stdout.split("\n").filter((line) => line && !line.startsWith("##")).length,
    head: safeSnippet(head.stdout)
  };
}

async function scanProjectFolder(folderPath, group) {
  if (isExcludedPath(folderPath)) return null;
  const stat = await fs.stat(folderPath).catch(() => null);
  if (!stat?.isDirectory()) return null;
  const [pkg, git] = await Promise.all([readPackageSummary(folderPath), gitSummary(folderPath)]);
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  const riskFlags = [];
  if (pkg?.scripts?.includes("deploy")) riskFlags.push("deploy script present");
  if (pkg?.scripts?.some((script) => /migrate|migration/i.test(script))) riskFlags.push("migration script present");
  if (await pathExists(path.join(folderPath, ".env"))) riskFlags.push("local env file excluded");
  if (git?.changedFiles) riskFlags.push(`${git.changedFiles} changed git file(s)`);
  return {
    name: path.basename(folderPath),
    group,
    path: publicPath(folderPath),
    package: pkg,
    git,
    childCount: entries.length,
    riskFlags
  };
}

export async function getProjects() {
  return cached("projects", 15000, async () => {
    const candidates = new Map();
    const desktopEntries = await fs.readdir(ROOTS.desktop, { withFileTypes: true }).catch(() => []);
    for (const entry of desktopEntries) {
      if (entry.isDirectory()) candidates.set(path.join(ROOTS.desktop, entry.name), "Desktop");
    }
    const projectGroups = await fs.readdir(ROOTS.desktopProjects, { withFileTypes: true }).catch(() => []);
    for (const group of projectGroups) {
      if (!group.isDirectory()) continue;
      const groupPath = path.join(ROOTS.desktopProjects, group.name);
      const children = await fs.readdir(groupPath, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (child.isDirectory()) candidates.set(path.join(groupPath, child.name), group.name);
      }
    }
    const rows = [];
    for (const [folderPath, group] of candidates) {
      const summary = await scanProjectFolder(folderPath, group);
      if (summary) rows.push(summary);
    }
    return rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  });
}

async function recentMarkdownFiles(dir, limit = 12) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await recentMarkdownFiles(filePath, limit)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && !isExcludedPath(filePath)) {
      const stat = await fs.stat(filePath);
      files.push({ filePath, mtime: stat.mtime.toISOString() });
    }
  }
  return files.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, limit);
}

export async function getLearnings() {
  return cached("learnings", 10000, async () => {
    const files = await recentMarkdownFiles(path.join(ROOTS.reviewQueues, "Hermes Runs"), 8);
    const fixed = [
      path.join(ROOTS.reviewQueues, "Telegram Diagnostics.md"),
      path.join(ROOTS.agent, "Context/Agent Permission Ledger.md"),
      path.join(ROOTS.agent, "Context/Hermes Context.md")
    ];
    const items = [];
    for (const item of [...files.map((file) => file.filePath), ...fixed]) {
      if (!(await pathExists(item))) continue;
      const text = await readText(item);
      const stat = await fs.stat(item);
      const summary = summarizeMarkdown(text);
      items.push({
        title: summary.headings[0] || path.basename(item, ".md"),
        source: publicPath(item),
        updatedAt: stat.mtime.toISOString(),
        snippet: summary.snippet
      });
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  });
}

export async function getDesignReferences() {
  return cached("designReferences", 10000, async () => {
    const refs = [];
    for (const file of ["Antimetal Style Reference.md", "Refero Styles Reference.md"]) {
      const filePath = path.join(ROOTS.styleReferences, file);
      const text = await readText(filePath);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) continue;
      refs.push({
        name: file.replace(/\.md$/, ""),
        path: publicPath(filePath),
        updatedAt: stat.mtime.toISOString(),
        snippet: summarizeMarkdown(text).snippet
      });
    }
    return refs;
  });
}

export async function getDashboardPayload() {
  const [
    status,
    reviewQueues,
    projects,
    learnings,
    runRequests,
    designReferences,
    localMessages,
    changelog,
    publishStatus,
    improvementEvents,
    hermesEvents,
    hermesRuntime,
    pendingPublicIntents,
    mission,
    health,
    sessions,
    skills,
    memoryFiles,
    timeline,
    git,
    pendingProposals
  ] = await Promise.all([
    getStatus(),
    getReviewQueues(),
    getProjects(),
    getLearnings(),
    getRunRequests(),
    getDesignReferences(),
    getLocalMessages(),
    getChangelog(),
    getPublishStatus(),
    getImprovementEvents(),
    getHermesEvents(160),
    getHermesRuntime(),
    getPendingPublicIntents(),
    getMissionState(),
    probeSystem(),
    getHermesSessions(),
    getHermesSkills(),
    getMemoryFiles(),
    getEventTimeline({ minutes: 60 }),
    getGitState(),
    getPendingProposals()
  ]);
  return {
    status,
    reviewQueues,
    projects,
    learnings,
    runRequests,
    designReferences,
    localMessages,
    changelog,
    publishStatus,
    improvementEvents,
    hermesEvents,
    hermesRuntime,
    pendingPublicIntents,
    mission,
    health,
    sessions,
    skills,
    memoryFiles,
    timeline,
    git,
    pendingProposals
  };
}
