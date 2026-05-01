import { describe, expect, it } from "vitest";
import { buildConsoleNodes, activeNodeCopy, buildWorkTrace } from "../src/consoleModel";
import type { DashboardPayload } from "../src/api";

const payload: DashboardPayload = {
  status: {
    generatedAt: new Date().toISOString(),
    model: "gpt-oss:20b",
    gateway: "running",
    telegramSession: "session-1",
    homeChannel: "set",
    dashboardHost: "127.0.0.1",
    writeSafeRoot: "/vault",
    projectSandbox: "/pretext"
  },
  reviewQueues: [
    {
      name: "Bug Hunt",
      path: "~/Bug Hunt.md",
      updatedAt: new Date().toISOString(),
      bytes: 10,
      headings: ["Bug Hunt"],
      taskCount: 2,
      openTaskCount: 1,
      snippet: "One open issue"
    }
  ],
  projects: [
    {
      name: "pretext",
      group: "Other",
      path: "~/pretext",
      childCount: 4,
      package: null,
      git: { branch: "## main", changedFiles: 2, head: "abc123" },
      riskFlags: ["2 changed git file(s)"]
    }
  ],
  learnings: [
    {
      title: "Telegram write verified",
      source: "~/Telegram Diagnostics.md",
      updatedAt: new Date().toISOString(),
      snippet: "Hermes wrote and read back a file."
    }
  ],
  runRequests: [
    {
      id: "req_1",
      command: "npm test",
      source: "telegram",
      status: "pending",
      reason: "verify",
      cwd: "/pretext",
      allowed: true
    }
  ],
  designReferences: [
    {
      name: "Antimetal",
      path: "~/Antimetal.md",
      updatedAt: new Date().toISOString(),
      snippet: "strict visual contract"
    }
  ],
  localMessages: [
    {
      id: "msg_1",
      channel: "local-console",
      author: "sarv",
      source: "dashboard",
      status: "captured",
      body: "Can you tighten the dashboard?",
      createdAt: new Date().toISOString()
    }
  ],
  changelog: [
    {
      date: "2026-04-30",
      title: "Local Console Channel",
      summary: "Added dashboard-originated local messages.",
      bullets: ["Added dashboard-originated local messages."]
    }
  ],
  publishStatus: {
    state: "blocked",
    remote: "https://github.com/sarveshsea/Labor-Budgeting.git",
    gitRoot: "/Users/sarveshchidambaram",
    reason: "Git resolves Pretext through a parent or home-level repository."
  },
  improvementEvents: [
    {
      id: "imp_1",
      date: "2026-04-30",
      createdAt: new Date().toISOString(),
      status: "recorded",
      publishState: "blocked",
      title: "Local Console Follow-Through",
      summary: "Improvement loop observed local instruction.",
      area: "local-console"
    }
  ]
};

describe("console model", () => {
  it("builds the mission-control nodes including local console", () => {
    const nodes = buildConsoleNodes(payload);
    expect(nodes.map((node) => node.id)).toEqual([
      "hermes",
      "builder",
      "run-queue",
      "local-console",
      "obsidian",
      "projects",
      "design-memory"
    ]);
  });

  it("generates active node language from live payload counts", () => {
    const copy = activeNodeCopy(buildConsoleNodes(payload), "run-queue");
    expect(copy).toContain("1 request");
    expect(copy).toContain("npm test");
  });

  it("generates an observable work trace without exposing hidden reasoning", () => {
    const trace = buildWorkTrace(payload);
    expect(trace.join("\n")).toContain("OBSERVE");
    expect(trace.join("\n")).toContain("ASSESS");
    expect(trace.join("\n")).toContain("PUBLISH");
    expect(trace.join("\n")).toContain("blocked");
    expect(trace.join("\n")).toContain("DECIDE");
    expect(trace.join("\n")).toContain("GUARD");
    expect(trace.join("\n")).toContain("Can you tighten");
    expect(trace.join("\n")).toContain("yolo_local");
    expect(trace.join("\n")).toContain("sarvesh_code_loaded");
  });
});
