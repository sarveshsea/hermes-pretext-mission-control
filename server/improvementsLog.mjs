// Surfaces real UI/UX commits — not the "Local Console Follow-Through" noise
// — so Sarvesh can SEE that Hermes is actually improving the dashboard's
// communication clarity. Reads git log, filters out the auto-publish noise,
// classifies each commit by what it touched (UI / agent / infra), and
// returns a window for the dashboard to render.

import { execFile } from "node:child_process";
import { ROOTS } from "./config.mjs";

const NOISE_PATTERNS = [
  /^Automated Pretext improvement: Local Console Follow-Through/,
  /^Automated Pretext improvement: Pretext Surface Health Pass/,
  /^Automated commit:/,
  /^Update data\//
];

function execGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: ROOTS.project, timeout: 4000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: (stdout || "").toString(), stderr: (stderr || "").toString() });
    });
  });
}

function classify(subject, files) {
  const fileList = files.join(" ");
  const isUi = /src\/(components|styles|App)/.test(fileList);
  const isAgent = /(server\/(pipeline|workerSwarm|agentDelegation|maintenance|qualityGates|playbook|swarmContext|ollama|memoryConsolidate))|\.hermes\//.test(fileList);
  const isInfra = /(server\/(index|config|hermesEvents|sessionReport|eventArchive))|tests/.test(fileList);
  if (isUi) return "ui";
  if (isAgent) return "agent";
  if (isInfra) return "infra";
  return "other";
}

export async function getImprovementsLog({ minutes = 24 * 60 } = {}) {
  const since = `${minutes} minutes ago`;
  const log = await execGit([
    "log",
    `--since=${since}`,
    "--pretty=format:%H|%h|%ai|%s",
    "--name-only"
  ]);
  if (!log.ok) return { entries: [], error: log.stderr };
  // Parse commit blocks separated by blank lines.
  const blocks = log.stdout.split("\n\n").map((b) => b.trim()).filter(Boolean);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const head = lines[0] || "";
    const files = lines.slice(1).filter(Boolean);
    const [sha, short, ts, ...rest] = head.split("|");
    const subject = rest.join("|");
    if (!subject) continue;
    if (NOISE_PATTERNS.some((re) => re.test(subject))) continue;
    entries.push({
      sha: short,
      fullSha: sha,
      ts,
      subject,
      kind: classify(subject, files),
      filesTouched: files.length,
      sampleFile: files[0] || null
    });
  }
  // Newest first.
  entries.sort((a, b) => b.ts.localeCompare(a.ts));
  // Counts per kind for the headline.
  const counts = entries.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, { ui: 0, agent: 0, infra: 0, other: 0 });
  return {
    windowMinutes: minutes,
    counts,
    entries: entries.slice(0, 40)
  };
}
