// Long-running goal memory. Sarvesh-editable markdown at
// ~/.hermes/memories/goals.md. Format:
//
//   ## <goal title> (deadline 2026-06-01, optional)
//   - target: <measurable goal>
//   - progress: <current> / <total>  (or freeform)
//
// The pipeline reads this on every tick to bias task pick toward open goals.
// Memory consolidator updates progress lines from session-report counts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const GOALS_PATH = path.join(ROOTS.hermes, "memories/goals.md");

const SEED = `# Hermes Long-Running Goals

These goals span hours/days. Pipeline biases task pick toward open goals.
Edit freely; consolidator updates progress lines automatically when it can.

## Pretext pipeline ships
- target: ≥ 1 proposal applied per hour, sustained 6h
- progress: 0 / 6

## Buzzr launch readiness
- target: 50 micro-fan handles in buzzr_drafts
- progress: 0 / 50

## Memoire app audit complete
- target: 12 design system audits in Agent/Memoire Audits
- progress: 0 / 12

## Pretext dashboard 100x
- target: power-metrics show non-zero in all 4 cells, sustained 1h
- progress: in flight
`;

export async function readGoals() {
  try {
    const text = await fs.readFile(GOALS_PATH, "utf8");
    return parse(text);
  } catch {
    // Seed on first read if missing.
    try {
      await fs.mkdir(path.dirname(GOALS_PATH), { recursive: true });
      await fs.writeFile(GOALS_PATH, SEED, "utf8");
      return parse(SEED);
    } catch {
      return [];
    }
  }
}

function parse(text) {
  const goals = [];
  let current = null;
  for (const line of text.split("\n")) {
    const headMatch = line.match(/^##\s+(.+?)(?:\s*\(deadline\s+([^)]+)\))?\s*$/);
    if (headMatch) {
      if (current) goals.push(current);
      current = { title: headMatch[1].trim(), deadline: headMatch[2] || null, target: "", progress: "" };
      continue;
    }
    if (!current) continue;
    const targetMatch = line.match(/^-\s+target:\s*(.+)$/i);
    if (targetMatch) current.target = targetMatch[1].trim();
    const progressMatch = line.match(/^-\s+progress:\s*(.+)$/i);
    if (progressMatch) current.progress = progressMatch[1].trim();
  }
  if (current) goals.push(current);
  return goals.filter((g) => g.title);
}

export async function writeGoals(goals) {
  const lines = ["# Hermes Long-Running Goals", "", "Pipeline biases task pick toward open goals. Auto-updated progress lines."];
  for (const g of goals) {
    lines.push("");
    lines.push(`## ${g.title}${g.deadline ? ` (deadline ${g.deadline})` : ""}`);
    if (g.target) lines.push(`- target: ${g.target}`);
    if (g.progress) lines.push(`- progress: ${g.progress}`);
  }
  try {
    await fs.mkdir(path.dirname(GOALS_PATH), { recursive: true });
    await fs.writeFile(GOALS_PATH, lines.join("\n") + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}
