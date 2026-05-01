import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = "/Users/sarveshchidambaram";
const vault = path.join(home, "Documents/Obsidian/Sarvesh Brain");

export const ROOTS = {
  home,
  project: projectRoot,
  desktop: path.join(home, "Desktop"),
  desktopProjects: path.join(home, "Desktop/Projects"),
  vault,
  agent: path.join(vault, "Agent"),
  reviewQueues: path.join(vault, "Agent/Review Queues"),
  hermes: path.join(home, ".hermes"),
  hermesLogs: path.join(home, ".hermes/logs"),
  hermesSessions: path.join(home, ".hermes/sessions"),
  // Hermes operational data lives here, not in the vault. Session reports,
  // briefs, run digests, distilled memory, task ledger markdown, reflections,
  // subscription ledger, proposal markdown — all of it. The vault stays
  // curated (Design Library + Playbooks + Buzzr + Daily digest only).
  hermesOps: path.join(home, ".hermes/ops"),
  hermesOpsSessions: path.join(home, ".hermes/ops/sessions"),
  hermesOpsBriefs: path.join(home, ".hermes/ops/briefs"),
  hermesOpsRuns: path.join(home, ".hermes/ops/runs"),
  // Vault: only the daily digest goes here.
  hermesDailyDigest: path.join(vault, "Agent/Hermes Daily"),
  personalAgent: path.join(home, "Documents/Personal Agent"),
  styleReferences: path.join(vault, "Agent/Context/Style References"),
  runRequestsMarkdown: path.join(vault, "Agent/Review Queues/Run Requests.md"),
  runRequestsStore: path.join(projectRoot, "data/run-requests.json"),
  localMessagesMarkdown: path.join(vault, "Agent/Review Queues/Local Console.md"),
  localMessagesStore: path.join(projectRoot, "data/local-messages.json"),
  improvementLoopMarkdown: path.join(vault, "Agent/Review Queues/Improvement Loop.md"),
  improvementLoopStore: path.join(projectRoot, "data/improvement-events.json"),
  changelog: path.join(projectRoot, "CHANGELOG.md")
};

export const LOCAL_HOST = "127.0.0.1";
export const DEFAULT_PORT = Number(process.env.PORT || 4317);
export const POLL_MS = 12_000;

export const DEFAULT_RUN_TIMEOUT_MS = Number(process.env.PRETEXT_RUN_TIMEOUT_MS || 600_000);

export const KNOWN_OLLAMA_MODELS = ["gemma4:e4b", "llama3.1:8b", "gpt-oss:20b", "nomic-embed-text:latest"];

export const MAX_FILE_BYTES = 256_000;
export const MAX_SNIPPET_CHARS = 420;

export const EXCLUDED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "__pycache__"
]);

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
  ".app",
  ".dmg",
  ".sqlite",
  ".db"
]);
