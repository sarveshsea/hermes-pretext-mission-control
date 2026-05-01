// Append-only daily archive of every Hermes event so nothing is lost when the
// in-memory ring buffer rolls over. Written as JSON-lines so we can grep,
// `jq`, or replay easily.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "./config.mjs";
import { getHermesEvents } from "./hermesEvents.mjs";

const ARCHIVE_DIR = path.join(ROOTS.project, "data/event-archive");
const FLUSH_INTERVAL_MS = 5 * 60_000;

let timer = null;
let lastFlushedId = null;
let totalArchived = 0;

function dailyFile(date) {
  const day = (date || new Date()).toISOString().slice(0, 10);
  return path.join(ARCHIVE_DIR, `${day}.jsonl`);
}

async function flush() {
  try {
    const events = await getHermesEvents(2000);
    if (!events.length) return;
    // Events come back newest-first; reverse so we append chronologically.
    const chronological = events.slice().reverse();
    let toAppend;
    if (lastFlushedId) {
      const idx = chronological.findIndex((e) => e.id === lastFlushedId);
      toAppend = idx === -1 ? chronological : chronological.slice(idx + 1);
    } else {
      toAppend = chronological;
    }
    if (!toAppend.length) return;
    // Bucket by date in case the flush spans a day boundary.
    const byDay = new Map();
    for (const event of toAppend) {
      const day = (event.createdAt || new Date().toISOString()).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(event);
    }
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
    for (const [day, batch] of byDay) {
      const file = path.join(ARCHIVE_DIR, `${day}.jsonl`);
      const text = batch.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(file, text, "utf8");
    }
    lastFlushedId = toAppend[toAppend.length - 1]?.id || lastFlushedId;
    totalArchived += toAppend.length;
  } catch {
    // best-effort
  }
}

export function startEventArchive() {
  if (timer) return timer;
  // Initial flush at 30s (let the swarm produce a batch first).
  setTimeout(() => void flush(), 30_000);
  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

export function getEventArchiveStatus() {
  return {
    state: timer ? "running" : "stopped",
    intervalMs: FLUSH_INTERVAL_MS,
    lastFlushedId,
    totalArchived,
    todayFile: dailyFile()
  };
}

export async function readArchivedEvents({ sinceMs = null, untilMs = null, limit = 5000 } = {}) {
  const out = [];
  const now = Date.now();
  const since = sinceMs ?? now - 24 * 3_600_000;
  const until = untilMs ?? now;
  // Scan today's and yesterday's files (covers any 24h window).
  const days = new Set();
  days.add(new Date(since).toISOString().slice(0, 10));
  days.add(new Date(until).toISOString().slice(0, 10));
  for (const day of days) {
    const file = path.join(ARCHIVE_DIR, `${day}.jsonl`);
    try {
      const text = await fs.readFile(file, "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line);
          const ts = new Date(e.createdAt).getTime();
          if (ts >= since && ts <= until) out.push(e);
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // file may not exist yet
    }
  }
  // Merge with the live in-memory buffer so the most-recent N seconds are
  // included even if not yet flushed.
  try {
    const live = await getHermesEvents(2000);
    const seen = new Set(out.map((e) => e.id));
    for (const e of live) {
      if (seen.has(e.id)) continue;
      const ts = new Date(e.createdAt).getTime();
      if (ts >= since && ts <= until) out.push(e);
    }
  } catch {
    // ignore
  }
  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return out.slice(-limit);
}
