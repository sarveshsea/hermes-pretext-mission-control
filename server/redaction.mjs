import path from "node:path";
import { BINARY_EXTENSIONS, EXCLUDED_SEGMENTS, MAX_SNIPPET_CHARS } from "./config.mjs";

const SECRET_NAME_RE = /(^|[._\-/])(env|secret|token|api[-_]?key|credential|credentials|password|passwd|private[-_]?key)([._\-/]|$)/i;
const TOKEN_RE = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g;
const API_KEY_RE = /\b(?:tvly-[A-Za-z0-9_-]{20,}|fc-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g;
const ASSIGNMENT_RE = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*([^\s"'`]+|"[^"]+"|'[^']+')/gi;

export function isExcludedPath(filePath) {
  const normalized = path.resolve(filePath);
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) return true;
  if (parts.some((part) => SECRET_NAME_RE.test(part))) return true;
  return BINARY_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}

export function sanitizeText(input) {
  return String(input ?? "")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(TOKEN_RE, "[REDACTED_BOT_TOKEN]")
    .replace(API_KEY_RE, "[REDACTED_API_KEY]")
    .replace(ASSIGNMENT_RE, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, "Bearer [REDACTED]");
}

export function safeSnippet(input, maxChars = MAX_SNIPPET_CHARS) {
  const clean = sanitizeText(input).replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars - 1)}…`;
}

export function publicPath(filePath) {
  return sanitizeText(String(filePath)).replace("/Users/sarveshchidambaram", "~");
}
