type ComposerMode = "message" | "command";

export type ComposerState = {
  mode: ComposerMode;
  value: string;
  detail?: string;
  busy: boolean;
};

function cleanLine(value: string, fallback: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function clip(value: string, max = 92) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildComposerLines({ mode, value, detail = "", busy }: ComposerState) {
  if (mode === "message") {
    return [
      `@ LOCAL_CONSOLE  channel=dashboard->obsidian->hermes  action=${busy ? "working" : "send"}`,
      `sarv: ${clip(cleanLine(value, "message hermes locally..."))}`
    ];
  }

  return [
    `$ RUN_REQUEST  scope=pretext-only  action=${busy ? "working" : "queue"}`,
    `cmd: ${clip(cleanLine(value, "npm run check"))}`,
    `why: ${clip(cleanLine(detail, "local console improvement check"))}`
  ];
}
