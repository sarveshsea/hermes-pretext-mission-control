export type StatusPayload = {
  generatedAt: string;
  model: string;
  gateway: string;
  telegramSession: string;
  homeChannel: string;
  dashboardHost: string;
  writeSafeRoot: string;
  projectSandbox: string;
  builderLoop?: {
    state: string;
    intervalMs: number;
    cooldownMs: number;
    autoRun: boolean;
    lastTickAt: string | null;
    lastCreatedAt: string | null;
    lastError: string;
  };
  improvementLoop?: {
    state: string;
    intervalMs: number;
    cooldownMs: number;
    autoPublish: boolean;
    lastTickAt: string | null;
    lastCreatedAt: string | null;
    lastError: string;
  };
};

export type ReviewQueue = {
  name: string;
  path: string;
  updatedAt: string;
  bytes: number;
  headings: string[];
  taskCount: number;
  openTaskCount: number;
  snippet: string;
};

export type ProjectSummary = {
  name: string;
  group: string;
  path: string;
  childCount: number;
  package: null | {
    name: string;
    description: string;
    scripts: string[];
    dependencies: number;
    devDependencies: number;
  };
  git: null | {
    branch: string;
    changedFiles: number;
    head: string;
  };
  riskFlags: string[];
};

export type Learning = {
  title: string;
  source: string;
  updatedAt: string;
  snippet: string;
};

export type RunRequest = {
  id: string;
  command: string;
  argv?: string[];
  shell?: boolean;
  source: string;
  status: string;
  reason?: string;
  cwd: string;
  allowed: boolean;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  rejectedAt?: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
};

export type LocalMessage = {
  id: string;
  channel: "local-console";
  author: string;
  source: string;
  status: string;
  body: string;
  createdAt: string;
};

export type ChangelogEntry = {
  date: string;
  title: string;
  summary: string;
  bullets: string[];
};

export type PublishStatus = {
  state: string;
  remote: string;
  gitRoot?: string;
  reason: string;
};

export type ImprovementEvent = {
  id: string;
  date: string;
  createdAt: string;
  status: string;
  publishState: string;
  title: string;
  summary: string;
  area: string;
};

export type DesignReference = {
  name: string;
  path: string;
  updatedAt: string;
  snippet: string;
};

export type HermesEventType =
  | "telegram_in"
  | "telegram_out"
  | "model_call"
  | "model_result"
  | "tool_call"
  | "tool_result"
  | "iteration_tick"
  | "error"
  | "public_intent"
  | "public_action"
  | "run_request"
  | "run_chunk"
  | "run_result"
  | "thinking"
  | "mission_start"
  | "mission_update"
  | "memory_read"
  | "memory_write"
  | "note";

export type HermesEvent = {
  id: string;
  createdAt: string;
  type: HermesEventType;
  role: string;
  content: string;
  model?: string;
  iteration?: number;
  sessionId?: string;
  intent?: string;
  extra?: Record<string, unknown>;
};

export type HermesRuntime = {
  model: string;
  sessionId: string | null;
  iteration: number;
  lastActivityAt: string | null;
  autoApprove: boolean;
  knownModels: string[];
};

export type PublicIntent = {
  id: string;
  createdAt: string;
  status: "pending" | "approved" | "declined";
  action: string;
  audience: string;
  surface: string;
  content: string;
  legalPosture: string;
  reputationPosture: string;
  worstCase: string;
  sessionId?: string;
  decision: "confirmed" | "declined" | "edited" | null;
  decidedAt: string | null;
  decidedContent: string | null;
  declineReason: string | null;
};

export type MissionState = {
  runtime: HermesRuntime;
  headline: string;
  lastInbound: { at: string; content: string; sessionId?: string } | null;
  lastOutbound: { at: string; content: string; sessionId?: string } | null;
  thinking: { id: string; at: string; type: HermesEventType; content: string }[];
  tools: HermesEvent[];
  memory: HermesEvent[];
  rate1m: number;
  rate5m: number;
  lastEventAt: string | null;
};

export type SystemHealth = {
  generatedAt: string;
  ollama: { up: boolean; latencyMs: number; models: { name: string; sizeBytes: number; modifiedAt: string | null; family: string | null; paramSize: string | null }[]; reason: string };
  gateway: { running: boolean; pid: number | null; etimeSec: number | null; command: string | null };
  dashboard: { running: boolean; pid: number | null; etimeSec: number | null; command: string | null };
  disk: { freeGb: number | null; sizeGb: number | null; usedPct: number | null };
  memory: { totalGb: number; freeGb: number; usedPct: number; loadAvg: number[] };
  vault: { accessible: boolean; path: string };
  channel: { homeChatId: string | null; homePlatform: string | null; homeName: string | null; total: number };
  healthScore: number;
};

export type SessionRow = {
  key: string;
  platform: string;
  chatId: string | null;
  sessionId: string | null;
  userName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  modelOverride: string | null;
};

export type SkillRow = {
  name: string;
  description: string;
  version: string;
  tags: string[];
  sizeBytes: number;
  modifiedAt: string;
  path: string;
  disabled: boolean;
};

export type MemoryFile = {
  name: string;
  description: string;
  type: string;
  file: string;
  sizeBytes: number;
  modifiedAt: string;
  excerpt: string;
};

export type TimelineBucket = {
  minutesAgo: number;
  epoch: number;
  count: number;
  byType: Record<string, number>;
};

export type GitState = {
  generatedAt: string;
  branch: string | null;
  head: string | null;
  lastCommit: { sha: string; short: string; author: string; email: string; subject: string; committedAt: string } | null;
  remote: string | null;
  dirty: boolean;
  dirtyFiles: number;
  ahead: number;
  pushAuth: { ok: boolean; reason: string };
};

export type Proposal = {
  id: string;
  createdAt: string;
  status: "pending" | "confirmed" | "declined" | "applied" | "ran" | "failed";
  kind: "shell" | "patch" | "note";
  title: string;
  rationale: string;
  command: string | null;
  argv: string[] | null;
  cwd: string | null;
  sessionId: string | null;
  autoSafe: boolean;
  autoAppliedAt: string | null;
  decidedAt: string | null;
  decision: "confirmed" | "declined" | null;
  declineReason: string | null;
  runResult: null | { id?: string; status?: string; exitCode?: number | null; durationMs?: number | null; output?: string; error?: string };
};

export type Cadence = {
  generatedAt: string;
  idleSec: number;
  loadAvg: number;
  throttle: number;
  mode: "active" | "idle" | "asleep";
  recommendedIntervalMs: number;
  recommendedAutoApply: boolean;
  sinceTransitionMs: number;
};

export type MorningBrief = {
  generatedAt: string;
  startedAt: string;
  endedAt: string;
  cadence: Cadence;
  events: { total: number; byType: Record<string, number> };
  proposals: { pending: number; applied: number; declined: number; failed: number; appliedTitles: string[] };
  commits: { sha: string; short: string; author: string; subject: string; committedAt: string }[];
  headlines: string[];
  deltas: string[];
  markdown?: string;
};

export type Task = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "advanced" | "blocked" | "done" | "abandoned";
  mission: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  notes: string[];
};

export type PlanStep = {
  idx: number;
  text: string;
  result: string | null;
  decision: string | null;
  completedAt: string | null;
};

export type PlanState = {
  id: string;
  intent: string;
  mission: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  status: "active" | "complete" | "aborted" | "replanning";
  currentStep: number;
  steps: PlanStep[];
  reflection?: string;
  reflectedAt?: string;
};

export type ThemedItem = {
  id: string;
  surface: string;
  createdAt: string;
  [key: string]: unknown;
};

export type ThemedSummary = {
  design_lab?: { count: number; latest: ThemedItem[] };
  sports_radar?: { count: number; latest: ThemedItem[] };
  buzzr_drafts?: { count: number; latest: ThemedItem[] };
  design_library?: { count: number; latest: ThemedItem[] };
};

export type TelegramOutboundStatus = {
  enabled: boolean;
  rateLimitMs: number;
  lastSendAt: string | null;
};

export type DashboardPayload = {
  status: StatusPayload;
  reviewQueues: ReviewQueue[];
  projects: ProjectSummary[];
  learnings: Learning[];
  runRequests: RunRequest[];
  designReferences: DesignReference[];
  localMessages: LocalMessage[];
  changelog: ChangelogEntry[];
  publishStatus: PublishStatus;
  improvementEvents: ImprovementEvent[];
  hermesEvents: HermesEvent[];
  hermesRuntime: HermesRuntime;
  pendingPublicIntents: PublicIntent[];
  mission: MissionState;
  health: SystemHealth;
  sessions: { generatedAt: string; sessions: SessionRow[] };
  skills: { generatedAt: string; activeCount: number; disabledCount: number; totalCount: number; skills: SkillRow[] };
  memoryFiles: { generatedAt: string; count: number; totalBytes: number; files: MemoryFile[] };
  timeline: { generatedAt: string; minutes: number; total: number; peak: number; buckets: TimelineBucket[] };
  git: GitState;
  pendingProposals: Proposal[];
  cadence: Cadence;
  themed: ThemedSummary;
  tasks: Task[];
  plans: PlanState[];
  telegramOutbound: TelegramOutboundStatus;
  perf: {
    generatedAt: string;
    ollama: { residentModels: { name: string; sizeVramMb: number; contextLen: number; expiresAt: string | null }[] };
    node: { rssMb: number; heapUsedMb: number; cpuUserMs: number; cpuSystemMs: number; uptimeSec: number };
    cpu: { cores: number; model: string; loadAvg: number[] };
    memory: { totalGb: number; freeGb: number };
    speed: { model: string; evalCount: number; tokensPerSec: number; wallMs: number } | null;
  };
  subagentTree: {
    generatedAt: string;
    total: number;
    roots: { id: string; intent: string; mission: string; status: string }[];
    byParent: Record<string, { id: string; intent: string; mission: string; status: string }[]>;
  };
};

export async function fetchDashboard(): Promise<DashboardPayload> {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard API failed: ${response.status}`);
  return response.json();
}

export async function approveRunRequest(id: string): Promise<RunRequest> {
  const response = await fetch(`/api/run-requests/${encodeURIComponent(id)}/approve`, {
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Approve failed: ${response.status}`);
  }
  return response.json();
}

export async function createRunRequest(command: string, reason: string): Promise<RunRequest> {
  const response = await fetch("/api/run-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      command,
      reason,
      source: "dashboard"
    })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Create run request failed: ${response.status}`);
  }
  return response.json();
}

export async function rejectRunRequest(id: string, reason: string): Promise<RunRequest> {
  const response = await fetch(`/api/run-requests/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ reason })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Reject failed: ${response.status}`);
  }
  return response.json();
}

export async function createLocalMessage(body: string): Promise<LocalMessage> {
  const response = await fetch("/api/local-messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      body,
      author: "sarv",
      source: "dashboard"
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Local message failed: ${response.status}`);
  }
  return response.json();
}

export async function setHermesModel(name: string): Promise<HermesRuntime> {
  const response = await fetch("/api/hermes/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Set model failed: ${response.status}`);
  }
  return response.json();
}

export async function setAutoApprove(value: boolean): Promise<HermesRuntime> {
  const response = await fetch("/api/runtime/auto-approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Set auto-approve failed: ${response.status}`);
  }
  return response.json();
}

export async function decidePublicIntent(
  id: string,
  decision: "confirm" | "decline" | "edit",
  options: { content?: string; reason?: string } = {}
): Promise<PublicIntent> {
  const response = await fetch(`/api/hermes/public-intent/${encodeURIComponent(id)}/${decision}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Decision failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchMorningBrief(force = false): Promise<MorningBrief> {
  const response = await fetch(`/api/hermes/morning-brief${force ? "?force=true" : ""}`);
  if (!response.ok) throw new Error(`Morning brief failed: ${response.status}`);
  return response.json();
}

export async function sendTelegramMessage(text: string, urgent = false): Promise<{ ok: boolean; messageId?: number; sentAt?: string }> {
  const response = await fetch("/api/telegram/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, urgent })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Telegram send failed: ${response.status}`);
  }
  return response.json();
}

export async function setTelegramOutbound(enabled: boolean): Promise<TelegramOutboundStatus> {
  const response = await fetch("/api/runtime/telegram-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: enabled })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Telegram toggle failed: ${response.status}`);
  }
  return response.json();
}

export async function decideProposal(
  id: string,
  decision: "confirm" | "decline",
  options: { reason?: string } = {}
): Promise<Proposal> {
  const response = await fetch(`/api/hermes/proposal/${encodeURIComponent(id)}/${decision}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Proposal decision failed: ${response.status}`);
  }
  return response.json();
}

export type HermesStreamHandlers = {
  onEvent?: (event: HermesEvent) => void;
  onPublicIntent?: (intent: PublicIntent) => void;
  onError?: (event: Event) => void;
};

export function subscribeHermesStream(handlers: HermesStreamHandlers): () => void {
  const source = new EventSource("/api/hermes/stream");
  if (handlers.onEvent) {
    source.addEventListener("hermes-event", (event) => {
      try {
        handlers.onEvent?.(JSON.parse((event as MessageEvent).data) as HermesEvent);
      } catch {
        // ignore malformed payloads
      }
    });
  }
  if (handlers.onPublicIntent) {
    source.addEventListener("public-intent", (event) => {
      try {
        handlers.onPublicIntent?.(JSON.parse((event as MessageEvent).data) as PublicIntent);
      } catch {
        // ignore
      }
    });
  }
  if (handlers.onError) {
    source.addEventListener("error", handlers.onError);
  }
  return () => source.close();
}
