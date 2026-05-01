#!/usr/bin/env node
// One-shot vault cleanup. Moves Hermes operational data OUT of the Obsidian
// vault and into ~/.hermes/ops/. Vault becomes Sarvesh's curated PKM again,
// not a dumping ground for 6.8M of session reports.
//
// Run with --confirm to actually move files. Without --confirm, prints a
// dry-run plan.

import { promises as fs } from "node:fs";
import path from "node:path";
import { ROOTS } from "../config.mjs";

const CONFIRM = process.argv.includes("--confirm");

// (vaultRelPath, opsRelPath, kind: "dir" | "file")
const MIGRATIONS = [
  ["Agent/Hermes Logs/Sessions",   "sessions",   "dir"],
  ["Agent/Hermes Logs/Briefs",     "briefs",     "dir"],
  ["Agent/Hermes Logs",            "logs",       "dir"],
  ["Agent/Hermes Memory",          "memory",     "dir"],
  ["Agent/Review Queues/Hermes Runs", "runs",   "dir"],
  ["Agent/Hermes Tasks.md",        "tasks.md",   "file"],
  ["Agent/Reflections.md",         "reflections.md", "file"],
  ["Agent/Subscription Ledger.md", "subscriptions.md", "file"],
  ["Agent/Review Queues/Hermes Proposals.md", "proposals.md", "file"],
  ["Agent/Review Queues/Improvement Loop.md", "improvement-loop.md", "file"],
  ["Agent/Review Queues/Local Console.md",    "local-console.md",    "file"],
  ["Agent/Review Queues/Run Requests.md",     "run-requests.md",     "file"],
  ["Agent/Review Queues/Public Actions.md",   "public-actions.md",   "file"]
];

const DUPES_TO_DELETE = [
  "Agent/Context/Permission_Ledger.md" // duplicate of "Permission Ledger.md"
];

const STUB_PATH = path.join(ROOTS.agent, "Hermes Operational Data Moved.md");
const STUB_BODY = `# Hermes Operational Data Moved

Hermes runtime data (session reports, briefs, runs, tasks ledger, reflections,
subscription queue, proposal markdown) used to live in the vault. As of
${new Date().toISOString().slice(0, 10)} it lives at:

\`\`\`
~/.hermes/ops/
\`\`\`

The vault now keeps only what Sarvesh actually reads: \`Agent/Design Library/\`,
\`Agent/Playbooks/\`, \`Agent/Context/\`, \`Agent/Hermes Daily/\` (one curated
markdown per day), and the human-curated project notes.

To browse Hermes operational data, open the dashboard at \`http://127.0.0.1:4317\`
or \`cd ~/.hermes/ops\`.
`;

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(dir) {
  let total = 0;
  let count = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const sub = await dirSize(full);
        total += sub.bytes;
        count += sub.files;
      } else {
        const stat = await fs.stat(full);
        total += stat.size;
        count += 1;
      }
    }
  } catch {
    // missing
  }
  return { bytes: total, files: count };
}

async function moveDir(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  // Use rename when on the same filesystem; fall back to copy+delete.
  try {
    await fs.rename(src, dst);
  } catch (error) {
    if (error.code === "EXDEV") {
      // cross-device — copy then unlink (rare for ~/ → ~/.hermes/)
      await fs.cp(src, dst, { recursive: true });
      await fs.rm(src, { recursive: true });
    } else throw error;
  }
}

async function moveFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fs.rename(src, dst);
  } catch (error) {
    if (error.code === "EXDEV") {
      await fs.copyFile(src, dst);
      await fs.unlink(src);
    } else throw error;
  }
}

async function main() {
  console.log(CONFIRM ? "MIGRATING vault → ~/.hermes/ops/" : "DRY RUN — pass --confirm to actually move\n");
  await fs.mkdir(ROOTS.hermesOps, { recursive: true });

  let totalBytes = 0;
  let totalFiles = 0;

  for (const [vaultRel, opsRel, kind] of MIGRATIONS) {
    const src = path.join(ROOTS.vault, vaultRel);
    const dst = path.join(ROOTS.hermesOps, opsRel);

    if (!(await exists(src))) {
      console.log(`  skip   ${vaultRel} (not found)`);
      continue;
    }

    if (kind === "dir") {
      const size = await dirSize(src);
      totalBytes += size.bytes;
      totalFiles += size.files;
      console.log(`  ${CONFIRM ? "MOVE" : "plan"}   ${vaultRel} → ops/${opsRel}  (${size.files} files, ${(size.bytes / 1024).toFixed(0)}K)`);
      if (CONFIRM) {
        if (await exists(dst)) {
          // Merge: move children one by one
          const entries = await fs.readdir(src);
          for (const e of entries) await moveFile(path.join(src, e), path.join(dst, e)).catch(() => {});
          await fs.rmdir(src).catch(() => {});
        } else {
          await moveDir(src, dst);
        }
      }
    } else {
      const stat = await fs.stat(src);
      totalBytes += stat.size;
      totalFiles += 1;
      console.log(`  ${CONFIRM ? "MOVE" : "plan"}   ${vaultRel} → ops/${opsRel}  (${(stat.size / 1024).toFixed(1)}K)`);
      if (CONFIRM) {
        if (await exists(dst)) await fs.unlink(dst);
        await moveFile(src, dst);
      }
    }
  }

  for (const rel of DUPES_TO_DELETE) {
    const p = path.join(ROOTS.vault, rel);
    if (await exists(p)) {
      console.log(`  ${CONFIRM ? "DELETE" : "plan-del"}  ${rel} (duplicate)`);
      if (CONFIRM) await fs.unlink(p).catch(() => {});
    }
  }

  if (CONFIRM) {
    await fs.mkdir(path.dirname(STUB_PATH), { recursive: true });
    await fs.writeFile(STUB_PATH, STUB_BODY, "utf8");
    console.log(`  STUB   wrote ${STUB_PATH}`);
  }

  console.log(`\n${CONFIRM ? "MOVED" : "Would move"} ${totalFiles} files / ${(totalBytes / 1024 / 1024).toFixed(2)}M`);
  if (!CONFIRM) console.log("Re-run with --confirm to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
