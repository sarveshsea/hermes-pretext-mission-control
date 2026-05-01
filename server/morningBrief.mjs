import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";
import { getProposals } from "./proposals.mjs";
import { getCadence } from "./scheduler.mjs";
import { safeSnippet } from "./redaction.mjs";

const CURSOR_FILE = path.join(ROOTS.project, "data/morning-cursor.json");
const BRIEF_MD = path.join(ROOTS.hermesOps, "morning-brief.md");
const BRIEFS_DIR = ROOTS.hermesOpsBriefs;
const TTL_MS = 8_000;

let cache = { value: null, at: 0 };
let lastMode = null;
let lastModeAt = Date.now();

function execGit(args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: ROOTS.project, timeout: 4000, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: (stdout || "").toString().trim(),
          stderr: (stderr || "").toString().trim()
        });
      }
    );
  });
}

async function readCursor() {
  try {
    const text = await fs.readFile(CURSOR_FILE, "utf8");
    return JSON.parse(text);
  } catch {
    return { lastActiveTransitionAt: null, lastBriefAt: null };
  }
}

async function writeCursor(data) {
  try {
    await fs.mkdir(path.dirname(CURSOR_FILE), { recursive: true });
    await fs.writeFile(CURSOR_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

function bucketByType(events) {
  const out = {};
  for (const event of events) {
    out[event.type] = (out[event.type] || 0) + 1;
  }
  return out;
}

async function commitsSince(isoStart) {
  if (!isoStart) return [];
  const result = await execGit(["log", `--since=${isoStart}`, "--pretty=format:%H%x09%h%x09%an%x09%s%x09%cI"]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, short, author, subject, committedAt] = line.split("\t");
      return { sha, short, author, subject: safeSnippet(subject || "", 200), committedAt };
    });
}

async function buildBriefBody({ startedAt, endedAt, events, proposals, commits, headlines, deltas, cadence }) {
  const lines = [
    `# Hermes Morning Brief`,
    "",
    `**Window:** ${startedAt || "unknown"} → ${endedAt || "now"}`,
    `**Mode:** ${cadence?.mode || "unknown"} · throttle ${cadence?.throttle ?? "?"} · idle ${Math.round((cadence?.idleSec ?? 0) / 60)}m`,
    "",
    `## Activity`,
    `- events: **${events.total}** total`,
    ...Object.entries(events.byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, count]) => `  - ${type}: ${count}`),
    "",
    `## Proposals`,
    `- pending: ${proposals.pending}`,
    `- applied: ${proposals.applied}`,
    `- declined: ${proposals.declined}`,
    `- failed: ${proposals.failed}`,
    "",
    proposals.appliedTitles.length ? `### Applied this window` : "",
    ...proposals.appliedTitles.slice(0, 8).map((title) => `- ${title}`),
    "",
    `## Commits`,
    ...(commits.length
      ? commits.slice(0, 12).map((c) => `- \`${c.short}\` ${c.subject} _by ${c.author}_`)
      : ["- (none)"]),
    "",
    headlines.length ? `## Headlines` : "",
    ...headlines.slice(0, 8).map((h) => `- ${h}`),
    "",
    `## Deltas`,
    ...(deltas.length ? deltas.map((d) => `- ${d}`) : ["- (no measurable shift)"]),
    ""
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

async function persistBrief(brief, body) {
  try {
    await fs.mkdir(path.dirname(BRIEF_MD), { recursive: true });
    await fs.writeFile(BRIEF_MD, body, "utf8");
    const date = (brief.endedAt || brief.startedAt || new Date().toISOString()).slice(0, 10);
    await fs.mkdir(BRIEFS_DIR, { recursive: true });
    await fs.writeFile(path.join(BRIEFS_DIR, `${date}.md`), body, "utf8");
  } catch {
    // best-effort
  }
}

export async function getMorningBrief({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.value && now - cache.at < TTL_MS) return cache.value;

  const cursor = await readCursor();
  const cadence = await getCadence();
  const startIso = cursor.lastActiveTransitionAt || new Date(now - 8 * 60 * 60_000).toISOString();
  const endIso = new Date().toISOString();
  const startMs = new Date(startIso).getTime();

  const [events, proposalsAll, commits] = await Promise.all([
    getHermesEvents(2000),
    getProposals(200),
    commitsSince(startIso)
  ]);

  const eventsInWindow = events.filter((event) => new Date(event.createdAt).getTime() >= startMs);
  const proposalsInWindow = proposalsAll.filter((p) => new Date(p.createdAt).getTime() >= startMs);

  const proposalsSummary = {
    pending: proposalsInWindow.filter((p) => p.status === "pending").length,
    applied: proposalsInWindow.filter((p) => p.status === "applied").length,
    declined: proposalsInWindow.filter((p) => p.status === "declined").length,
    failed: proposalsInWindow.filter((p) => p.status === "failed").length,
    appliedTitles: proposalsInWindow
      .filter((p) => p.status === "applied" || p.status === "ran")
      .map((p) => p.title)
  };

  const headlines = eventsInWindow
    .filter((event) => event.type === "telegram_in" || event.type === "mission_update")
    .slice(0, 12)
    .map((event) => safeSnippet(event.content || "", 120));

  const deltas = [];
  if (proposalsSummary.applied > 0) deltas.push(`${proposalsSummary.applied} proposals applied while you were away`);
  if (commits.length > 0) deltas.push(`${commits.length} commits landed; latest: ${commits[0]?.subject}`);
  if (eventsInWindow.length > 200) deltas.push(`busy window: ${eventsInWindow.length} events`);

  const brief = {
    generatedAt: endIso,
    startedAt: startIso,
    endedAt: endIso,
    cadence,
    events: { total: eventsInWindow.length, byType: bucketByType(eventsInWindow) },
    proposals: proposalsSummary,
    commits,
    headlines,
    deltas
  };

  const body = await buildBriefBody(brief);
  await persistBrief(brief, body);
  brief.markdown = body;
  cache = { value: brief, at: now };
  return brief;
}

export async function noteCadenceTransition({ mode }) {
  const now = Date.now();
  if (lastMode && lastMode !== mode) {
    const cursor = await readCursor();
    if (mode === "active") {
      cursor.lastActiveTransitionAt = new Date(now).toISOString();
      await writeCursor(cursor);
    }
  }
  lastMode = mode;
  lastModeAt = now;
}
