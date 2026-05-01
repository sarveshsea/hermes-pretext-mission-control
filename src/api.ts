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
  | "tool_call"
  | "tool_result"
  | "iteration_tick"
  | "error"
  | "public_intent"
  | "public_action"
  | "run_request"
  | "run_chunk"
  | "run_result"
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
