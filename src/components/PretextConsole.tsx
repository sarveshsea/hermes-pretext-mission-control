import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { ConsoleNode, ConsoleNodeId } from "../consoleModel";
import { activeNodeCopy, buildWorkTrace } from "../consoleModel";
import type { DashboardPayload, RunRequest } from "../api";

type Props = {
  payload: DashboardPayload;
  nodes: ConsoleNode[];
  activeNode: ConsoleNodeId;
};

function plural(count: number, label: string) {
  return `${count} ${count === 1 ? label : `${label}s`}`;
}

function latestRuns(requests: RunRequest[]) {
  return requests
    .slice(0, 4)
    .map((request) => `${request.source}:${request.command.replace(/^npm run /, "")}:${request.status}`)
    .join(" | ");
}

function latestLocalMessages(payload: DashboardPayload) {
  return payload.localMessages
    .slice(0, 3)
    .map((message) => `${message.author}:${message.body}`)
    .join(" | ");
}

function buildConsoleLanguage(payload: DashboardPayload, nodes: ConsoleNode[], activeNode: ConsoleNodeId) {
  const active = nodes.find((node) => node.id === activeNode);
  const loop = payload.status.builderLoop;
  const pending = payload.runRequests.filter((request) => request.status === "pending").length;
  const completed = payload.runRequests.filter((request) => request.status === "completed").length;
  const blocked = payload.runRequests.filter((request) => request.status === "blocked").length;

  return [
    `focus=${active?.label || "Hermes"} signal=${active?.signal || "live"} metric=${active?.metric || "online"}`,
    activeNodeCopy(nodes, activeNode),
    `loop=${loop?.state || "unknown"} auto=${loop?.autoRun ? "on" : "off"} cadence=${loop ? Math.round(loop.intervalMs / 1000) : 0}s cooldown=${loop ? Math.round(loop.cooldownMs / 60000) : 0}m`,
    `runs=${payload.runRequests.length} pending=${pending} complete=${completed} blocked=${blocked}`,
    `latest=${latestRuns(payload.runRequests) || "none"}`
  ]
    .join("   ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawTextBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  lines: string[],
  color = "rgba(224, 246, 255, 0.9)"
) {
  context.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, y + index * 18));
}

export default function PretextConsole({ payload, nodes, activeNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const corpus = useMemo(() => buildConsoleLanguage(payload, nodes, activeNode), [activeNode, nodes, payload]);
  const workTrace = useMemo(() => buildWorkTrace(payload), [payload]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const centerX = rect.width / 2;
      const centerY = rect.height * 0.49;
      const active = nodes.find((node) => node.id === activeNode) || nodes[0];
      const pending = payload.runRequests.filter((request) => request.status === "pending").length;
      const completed = payload.runRequests.filter((request) => request.status === "completed").length;

      const bg = context.createLinearGradient(0, 0, rect.width, rect.height);
      bg.addColorStop(0, "#001033");
      bg.addColorStop(0.5, "#00245f");
      bg.addColorStop(1, "#0050f8");
      context.fillStyle = bg;
      context.fillRect(0, 0, rect.width, rect.height);

      context.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.fillStyle = "rgba(224, 246, 255, 0.08)";
      for (let x = 24; x < rect.width; x += 34) {
        for (let y = 28; y < rect.height; y += 30) {
          const char = (Math.floor((x + y + frame * 0.35) / 19) % 2 ? "." : "+");
          context.fillText(char, x, y);
        }
      }

      context.strokeStyle = "rgba(224, 246, 255, 0.22)";
      context.lineWidth = 1;
      context.strokeRect(22.5, 22.5, rect.width - 45, rect.height - 45);

      drawTextBox(context, 52, 48, 500, [
        "PRETEXT://HERMES_LOCAL",
        `gateway:${payload.status.gateway}  model:${payload.status.model}  loop:${payload.status.builderLoop?.state || "boot"}`,
        `queues:${payload.reviewQueues.length}  projects:${payload.projects.length}  local:${payload.localMessages.length}  runs:${payload.runRequests.length}  pending:${pending}  complete:${completed}`
      ]);

      context.textAlign = "right";
      drawTextBox(context, rect.width - 500, 48, 450, [
        `host:${payload.status.dashboardHost}`,
        `sandbox:${payload.status.projectSandbox.split("/").slice(-3).join("/")}`,
        `style:ANTIMETAL_ASCII  memory:OBSIDIAN  channel:LOCAL_CONSOLE`
      ], "rgba(224, 246, 255, 0.72)");
      context.textAlign = "left";

      context.save();
      context.translate(centerX, centerY);
      context.strokeStyle = "rgba(224, 246, 255, 0.16)";
      context.beginPath();
      context.moveTo(-250, 0);
      context.lineTo(250, 0);
      context.moveTo(0, -210);
      context.lineTo(0, 210);
      context.stroke();
      context.restore();

      nodes.forEach((node) => {
        const x = (node.x / 100) * rect.width;
        const y = (node.y / 100) * rect.height;
        const isActive = node.id === activeNode;
        const jitter = Math.sin(frame * 0.018 + node.x) * 1.2;

        context.strokeStyle = isActive ? "rgba(208, 241, 0, 0.9)" : "rgba(224, 246, 255, 0.18)";
        context.lineWidth = isActive ? 1.5 : 1;
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(x, y + jitter);
        context.stroke();

        context.font = "13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        context.textAlign = "center";
        context.fillStyle = isActive ? "#d0f100" : "rgba(224, 246, 255, 0.9)";
        context.fillText(isActive ? `> ${node.label.toUpperCase()} <` : `[${node.label.toUpperCase()}]`, x, y + jitter);
        context.fillStyle = isActive ? "rgba(208, 241, 0, 0.82)" : "rgba(224, 246, 255, 0.54)";
        context.fillText(node.metric.slice(0, 30), x, y + jitter + 18);
      });

      const prepared = prepareWithSegments(corpus, "15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
      const layout = layoutWithLines(prepared, Math.min(760, rect.width * 0.62), 23);
      const textWidth = Math.min(800, rect.width * 0.64);
      const textX = centerX - textWidth / 2;
      const textY = centerY - 76;

      context.fillStyle = "rgba(0, 16, 51, 0.48)";
      context.fillRect(textX - 18, textY - 18, textWidth + 36, 182);
      context.strokeStyle = active?.signal === "blocked" ? "rgba(208, 241, 0, 0.72)" : "rgba(224, 246, 255, 0.28)";
      context.strokeRect(textX - 18.5, textY - 18.5, textWidth + 37, 183);

      context.textAlign = "left";
      context.textBaseline = "top";
      context.font = "15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      layout.lines.slice(0, 6).forEach((line, index) => {
        context.fillStyle = index === 0 ? "#d0f100" : "rgba(250, 254, 255, 0.86)";
        context.globalAlpha = 0.98 - index * 0.05;
        context.fillText(index === 0 ? `$ ${line.text}` : `  ${line.text}`, textX, textY + index * 23);
      });
      context.globalAlpha = 1;

      const runLines = payload.runRequests.slice(0, 5).map((request) => {
        const status = request.status.toUpperCase().slice(0, 8).padEnd(8, " ");
        return `${status} ${request.command.replace(/^npm run /, "")}`;
      });
      drawTextBox(context, 52, rect.height - 134, 460, [
        "RUN_LOG",
        ...(runLines.length ? runLines : ["EMPTY"])
      ], "rgba(224, 246, 255, 0.72)");

      const localLines = latestLocalMessages(payload) || "EMPTY";
      drawTextBox(context, 52, rect.height - 226, 560, [
        "LOCAL_CONSOLE",
        ...(localLines === "EMPTY" ? ["EMPTY"] : localLines.match(/.{1,68}/g) || ["EMPTY"])
      ], "rgba(224, 246, 255, 0.7)");

      const changeLines = payload.changelog.slice(0, 4).map((entry) => `${entry.date} ${entry.title}`);
      drawTextBox(context, rect.width - 560, rect.height - 210, 510, [
        "CHANGELOG",
        ...(changeLines.length ? changeLines : ["EMPTY"])
      ], "rgba(224, 246, 255, 0.7)");

      drawTextBox(context, rect.width - 560, rect.height - 110, 510, [
        "GITHUB_PUBLISH",
        `${payload.publishStatus.state.toUpperCase()} ${payload.publishStatus.remote}`,
        payload.publishStatus.reason
      ], payload.publishStatus.state === "ready" ? "rgba(208, 241, 0, 0.72)" : "rgba(255, 210, 164, 0.72)");

      const improvementLines = payload.improvementEvents
        .slice(0, 3)
        .map((event) => `${event.date} ${event.title}:${event.status}`);
      drawTextBox(context, rect.width - 560, rect.height - 302, 510, [
        "IMPROVEMENT_LOOP",
        `state:${payload.status.improvementLoop?.state || "boot"} cadence:${payload.status.improvementLoop ? Math.round(payload.status.improvementLoop.intervalMs / 60000) : 0}m`,
        ...(improvementLines.length ? improvementLines : ["EMPTY"])
      ], "rgba(208, 241, 0, 0.68)");

      context.textAlign = "right";
      drawTextBox(context, rect.width - 520, rect.height - 92, 470, [
        `ACTIVE:${active?.id || "hermes"}  AUTORUN:${payload.status.builderLoop?.autoRun ? "ON" : "OFF"}  SAFETY:SCOPED`,
        "NO_INSTALLS NO_DELETES NO_PUSHES NO_SPEND"
      ], "rgba(224, 246, 255, 0.62)");
      context.textAlign = "left";

      const traceX = Math.max(52, rect.width - 620);
      const traceY = Math.max(168, centerY - 256);
      context.fillStyle = "rgba(0, 16, 51, 0.36)";
      context.fillRect(traceX - 14, traceY - 24, Math.min(560, rect.width - traceX - 44), 142);
      context.strokeStyle = "rgba(208, 241, 0, 0.24)";
      context.strokeRect(traceX - 14.5, traceY - 24.5, Math.min(560, rect.width - traceX - 44) + 1, 143);
      context.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.fillStyle = "#d0f100";
      context.fillText("WORK_TRACE", traceX, traceY - 14);
      const hotLine = Math.floor(frame / 55) % workTrace.length;
      workTrace.forEach((line, index) => {
        const marker = index === hotLine ? ">" : " ";
        const clipped = line.length > 74 ? `${line.slice(0, 71)}...` : line;
        context.fillStyle = index === hotLine ? "rgba(250, 254, 255, 0.92)" : "rgba(224, 246, 255, 0.58)";
        context.fillText(`${marker} ${clipped}`, traceX, traceY + 10 + index * 20);
      });

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [activeNode, corpus, nodes, payload, workTrace]);

  return <canvas ref={canvasRef} className="pretext-console-canvas" aria-label="Hermes Pretext node console" />;
}
