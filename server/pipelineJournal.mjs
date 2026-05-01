// Append-only outcome log for the pipeline worker. Every tick writes a JSON
// line summarizing what happened. The pipeline reads the last N entries on
// each subsequent tick and formats them as few-shot examples in the playbook
// prompt — so the model SEES "you tried add-aria-label and it failed because
// X; you tried add-data-testid and it shipped (+2 lines)" and adapts.
//
// This is the loop that makes hour-2 materially smarter than hour-1.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";

const JOURNAL_PATH = path.join(ROOTS.project, "data/pipeline-journal.jsonl");
const MAX_READ = 60;

export async function appendJournal(entry) {
  try {
    await fs.mkdir(path.dirname(JOURNAL_PATH), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    await fs.appendFile(JOURNAL_PATH, line, "utf8");
  } catch {
    // best-effort
  }
}

export async function readJournalTail(n = 20) {
  try {
    const text = await fs.readFile(JOURNAL_PATH, "utf8");
    const lines = text.split("\n").filter(Boolean);
    const tail = lines.slice(-Math.max(1, Math.min(n, MAX_READ)));
    return tail
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Format the last N journal entries as a "past outcomes" prompt block for
// the playbook phase. Skews recent. Limits output to ~600 chars.
export function formatJournalForPrompt(entries) {
  if (!entries?.length) return "(no past outcomes yet)";
  const lines = ["Past outcomes (learn from these — repeat ✓ patterns, avoid ✗ patterns):"];
  for (const e of entries.slice(-12)) {
    const mark = e.outcome === "applied" || e.outcome === "shipped" || e.outcome === "submitted" ? "✓" : "✗";
    const summary = `${mark} [${e.phase || "?"}] ${e.playbook || "—"}${e.filePath ? ` → ${e.filePath}` : ""}${e.diffLines ? ` (+${e.diffLines})` : ""}`;
    const reason = e.reason ? ` — ${String(e.reason).slice(0, 100)}` : "";
    lines.push(`- ${summary}${reason}`);
  }
  return lines.join("\n").slice(0, 800);
}
