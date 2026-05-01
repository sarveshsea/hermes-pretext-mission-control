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
