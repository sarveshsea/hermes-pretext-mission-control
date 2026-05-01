import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { ConsoleNode, ConsoleNodeId } from "../consoleModel";
import { activeNodeCopy } from "../consoleModel";
import type { DashboardPayload, HermesEvent, PublicIntent } from "../api";
import {
  buildMatrixRain,
  colorFor,
  decay,
  drawMatrixRain,
  drawParticle,
  edgeKey,
  eventTrajectory,
  spawnParticle,
  type MatrixRainState,
  type Particle,
  type Vec2
} from "../visualEngine";

type Props = {
  payload: DashboardPayload;
  nodes: ConsoleNode[];
  activeNode: ConsoleNodeId;
  liveEvents: HermesEvent[];
  pendingIntents: PublicIntent[];
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

function buildHeadline(payload: DashboardPayload, nodes: ConsoleNode[], activeNode: ConsoleNodeId) {
  const active = nodes.find((node) => node.id === activeNode);
  const mission = payload.mission;
  return [
    `focus=${active?.label || "Hermes"}  signal=${active?.signal || "live"}  metric=${active?.metric || "online"}`,
    activeNodeCopy(nodes, activeNode),
    mission?.headline ? `mission=${mission.headline}` : "mission=idle",
    `rate1m=${mission?.rate1m ?? 0}  rate5m=${mission?.rate5m ?? 0}  model=${mission?.runtime?.model ?? "?"}`
  ]
    .join("   ")
    .replace(/\s+/g, " ")
    .trim();
}

function paneBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
  fillAlpha = 0.5
) {
  ctx.fillStyle = `rgba(0, 16, 51, ${fillAlpha})`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function paneTitle(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string) {
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
}

function paneLine(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = `12px ${MONO}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatHermesLine(event: HermesEvent) {
  const time = (event.createdAt || "").slice(11, 19);
  const tag = event.type.toUpperCase().padEnd(14, " ");
  const role = (event.role || "").padEnd(6, " ").slice(0, 6);
  const body = (event.content || "").replace(/\s+/g, " ").trim();
  return `${time} ${tag} ${role} ${clip(body, 64)}`;
}

export default function PretextConsole({ payload, nodes, activeNode, liveEvents, pendingIntents }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headline = useMemo(() => buildHeadline(payload, nodes, activeNode), [activeNode, nodes, payload]);

  const particlesRef = useRef<Particle[]>([]);
  const edgeHeatRef = useRef<Map<string, number>>(new Map());
  const nodePulseRef = useRef<Map<string, number>>(new Map());
  const lastEventIdRef = useRef<string | null>(null);
  const matrixRef = useRef<MatrixRainState | null>(null);
  const lastFrameRef = useRef<number>(performance.now());

  // Spawn particles + boost heat when new events arrive.
  useEffect(() => {
    if (!liveEvents.length) return;
    const headId = liveEvents[0]?.id;
    if (headId === lastEventIdRef.current) return;

    const lastIdx = lastEventIdRef.current
      ? liveEvents.findIndex((event) => event.id === lastEventIdRef.current)
      : -1;
    const fresh = lastIdx === -1 ? liveEvents.slice(0, 6) : liveEvents.slice(0, lastIdx);
    lastEventIdRef.current = headId;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const resolveNode = (id: string): Vec2 | null => {
      if (id === "external") {
        return { x: rect.width - 60, y: 60 };
      }
      const found = nodes.find((node) => node.id === id);
      if (!found) return null;
      return { x: (found.x / 100) * rect.width, y: (found.y / 100) * rect.height };
    };

    const now = performance.now();
    fresh
      .slice()
      .reverse()
      .forEach((event) => {
        const traj = eventTrajectory(event.type);
        const heat = (edgeHeatRef.current.get(edgeKey(traj.source, traj.target)) || 0) + 1;
        edgeHeatRef.current.set(edgeKey(traj.source, traj.target), Math.min(heat, 4));
        const sourcePulse = (nodePulseRef.current.get(traj.source) || 0) + 0.6;
        const targetPulse = (nodePulseRef.current.get(traj.target) || 0) + 1;
        nodePulseRef.current.set(traj.source, Math.min(sourcePulse, 4));
        nodePulseRef.current.set(traj.target, Math.min(targetPulse, 4));
        const particle = spawnParticle(event, resolveNode, now);
        if (particle) particlesRef.current.push(particle);
      });
  }, [liveEvents, nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const now = performance.now();
      const dt = Math.max(1, now - lastFrameRef.current);
      lastFrameRef.current = now;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const centerX = rect.width / 2;
      const centerY = rect.height * 0.5;
      const active = nodes.find((node) => node.id === activeNode) || nodes[0];
      const runtime = payload.hermesRuntime;
      const mission = payload.mission;
      const activeModel = runtime?.model || payload.status.model || "unknown";
      const autoApprove = runtime?.autoApprove ? "ON" : "OFF";
      const rate1m = mission?.rate1m ?? 0;
      const rate5m = mission?.rate5m ?? 0;
      const density = Math.min(1, rate1m / 18);

      // 1. Background gradient
      const bg = context.createLinearGradient(0, 0, rect.width, rect.height);
      bg.addColorStop(0, "#001033");
      bg.addColorStop(0.45, "#001a4e");
      bg.addColorStop(1, "#00306e");
      context.fillStyle = bg;
      context.fillRect(0, 0, rect.width, rect.height);

      // 2. Matrix rain layer (subtle, scales with rate)
      if (!matrixRef.current || matrixRef.current.width !== rect.width || matrixRef.current.height !== rect.height) {
        matrixRef.current = buildMatrixRain(rect.width, rect.height);
      }
      drawMatrixRain(context, matrixRef.current, density);

      // 3. ASCII dust grid (very faint)
      context.font = `11px ${MONO}`;
      context.fillStyle = "rgba(224, 246, 255, 0.05)";
      for (let x = 24; x < rect.width; x += 38) {
        for (let y = 28; y < rect.height; y += 32) {
          const ch = (Math.floor((x + y + frame * 0.3) / 23) % 2 ? "·" : "+");
          context.fillText(ch, x, y);
        }
      }

      // Outer chrome
      context.strokeStyle = "rgba(224, 246, 255, 0.18)";
      context.lineWidth = 1;
      context.strokeRect(20.5, 20.5, rect.width - 41, rect.height - 41);

      // Top header strip
      context.font = `13px ${MONO}`;
      context.fillStyle = "#d0f100";
      context.fillText("PRETEXT://HERMES_LOCAL", 48, 46);
      context.fillStyle = "rgba(224, 246, 255, 0.78)";
      context.fillText(
        `gateway:${payload.status.gateway}  model:${activeModel}  loop:${payload.status.builderLoop?.state || "boot"}  auto:${autoApprove}`,
        48,
        62
      );
      context.fillText(
        `runs:${payload.runRequests.length}  intents:${pendingIntents.length}  rate1m:${rate1m}  rate5m:${rate5m}  events:${liveEvents.length}`,
        48,
        78
      );
      context.textAlign = "right";
      context.fillStyle = "rgba(224, 246, 255, 0.6)";
      context.fillText(`host:${payload.status.dashboardHost}`, rect.width - 48, 46);
      context.fillText(`iter:${runtime?.iteration ?? 0}  session:${runtime?.sessionId ?? "—"}`, rect.width - 48, 62);
      context.fillText("ANTIMETAL · OBSIDIAN · PRETEXT", rect.width - 48, 78);
      context.textAlign = "left";

      // 4. Edges with heat-based brightness
      nodes.forEach((from) => {
        nodes.forEach((to) => {
          if (from.id >= to.id) return;
          const key = edgeKey(from.id, to.id);
          const heat = edgeHeatRef.current.get(key) || 0;
          edgeHeatRef.current.set(key, decay(heat, dt, 700));
          const baseAlpha = from.id === activeNode || to.id === activeNode ? 0.18 : 0.08;
          const alpha = Math.min(0.85, baseAlpha + heat * 0.22);
          context.strokeStyle = `rgba(140, 200, 255, ${alpha})`;
          context.lineWidth = 0.6 + heat * 0.4;
          const fx = (from.x / 100) * rect.width;
          const fy = (from.y / 100) * rect.height;
          const tx = (to.x / 100) * rect.width;
          const ty = (to.y / 100) * rect.height;
          context.beginPath();
          context.moveTo(fx, fy);
          context.quadraticCurveTo(centerX, centerY, tx, ty);
          context.stroke();
        });
      });

      // 5. Particles
      particlesRef.current = particlesRef.current.filter((particle) => drawParticle(context, particle, now));

      // 6. Nodes with pulse-driven glow
      nodes.forEach((node) => {
        const x = (node.x / 100) * rect.width;
        const y = (node.y / 100) * rect.height;
        const isActive = node.id === activeNode;
        const pulse = nodePulseRef.current.get(node.id) || 0;
        nodePulseRef.current.set(node.id, decay(pulse, dt, 600));
        const breathing = isActive ? Math.sin(frame * 0.07) * 1.4 : 0;
        const radius = 26 + pulse * 8 + breathing;
        const haloAlpha = Math.min(0.55, 0.05 + pulse * 0.18 + (isActive ? 0.15 : 0));

        // Halo
        const grad = context.createRadialGradient(x, y, 4, x, y, radius * 1.4);
        grad.addColorStop(0, isActive ? `rgba(208, 241, 0, ${haloAlpha + 0.2})` : `rgba(140, 200, 255, ${haloAlpha})`);
        grad.addColorStop(1, "rgba(0, 16, 51, 0)");
        context.fillStyle = grad;
        context.beginPath();
        context.arc(x, y, radius * 1.4, 0, Math.PI * 2);
        context.fill();

        // Label
        context.font = `13px ${MONO}`;
        context.textAlign = "center";
        context.fillStyle = isActive ? "#d0f100" : "rgba(224, 246, 255, 0.92)";
        context.fillText(isActive ? `> ${node.label.toUpperCase()} <` : `[${node.label.toUpperCase()}]`, x, y);
        context.fillStyle = isActive ? "rgba(208, 241, 0, 0.78)" : "rgba(180, 220, 255, 0.55)";
        context.fillText(node.metric.slice(0, 30), x, y + 16);
        context.textAlign = "left";
      });

      // 7. Kinetic Pretext headline (center)
      const prepared = prepareWithSegments(headline, `15px ${MONO}`);
      const headlineWidth = Math.min(840, rect.width * 0.62);
      const layout = layoutWithLines(prepared, headlineWidth, 23);
      const textX = centerX - headlineWidth / 2;
      const textY = centerY - 80;
      paneBox(context, textX - 18, textY - 18, headlineWidth + 36, 144, "rgba(208, 241, 0, 0.32)", 0.55);
      context.textBaseline = "top";
      context.font = `15px ${MONO}`;
      layout.lines.slice(0, 5).forEach((line, index) => {
        context.fillStyle = index === 0 ? "#d0f100" : "rgba(250, 254, 255, 0.86)";
        context.globalAlpha = 0.98 - index * 0.06;
        context.fillText(index === 0 ? `$ ${line.text}` : `  ${line.text}`, textX, textY + index * 23);
      });
      context.globalAlpha = 1;
      context.textBaseline = "alphabetic";

      // 8. Right-side stack: HERMES_LIVE / THINKING / MISSION / MEMORY
      const rightX = rect.width - 380;
      const rightW = 332;
      const rightYStart = 110;
      const rightH = 138;
      const rightGap = 12;

      // HERMES_LIVE
      paneBox(context, rightX, rightYStart, rightW, rightH, "rgba(140, 200, 255, 0.42)");
      paneTitle(context, rightX + 12, rightYStart + 18, "HERMES_LIVE", "rgba(140, 200, 255, 0.94)");
      const liveSlice = liveEvents.slice(0, 6);
      if (liveSlice.length === 0) {
        paneLine(context, rightX + 12, rightYStart + 40, "waiting for events…", "rgba(224, 246, 255, 0.5)");
      } else {
        liveSlice.forEach((event, idx) => {
          context.fillStyle = colorFor(event.type);
          context.font = `11px ${MONO}`;
          context.fillText(formatHermesLine(event), rightX + 12, rightYStart + 38 + idx * 16);
        });
      }

      // THINKING (recent assistant content / model_call traces)
      const thinkingY = rightYStart + rightH + rightGap;
      paneBox(context, rightX, thinkingY, rightW, rightH, "rgba(180, 160, 255, 0.45)");
      paneTitle(context, rightX + 12, thinkingY + 18, "THINKING", "rgba(180, 160, 255, 0.94)");
      const thinkingSrc = mission?.thinking?.length
        ? mission.thinking
        : liveEvents.filter((event) => event.type === "telegram_out" || event.type === "thinking" || event.type === "model_call").slice(0, 4);
      if (!thinkingSrc.length) {
        paneLine(context, rightX + 12, thinkingY + 40, "no recent reasoning", "rgba(224, 246, 255, 0.5)");
      } else {
        const blob = thinkingSrc
          .map((event) => `· ${event.content || ""}`)
          .join("  ");
        const tPrep = prepareWithSegments(blob, `11px ${MONO}`);
        const tLayout = layoutWithLines(tPrep, rightW - 24, 14);
        tLayout.lines.slice(0, 6).forEach((line, idx) => {
          context.fillStyle = idx === 0 ? "rgba(225, 218, 255, 0.95)" : "rgba(225, 218, 255, 0.7)";
          context.font = `11px ${MONO}`;
          context.fillText(line.text, rightX + 12, thinkingY + 38 + idx * 14);
        });
      }

      // MISSION
      const missionY = thinkingY + rightH + rightGap;
      paneBox(context, rightX, missionY, rightW, rightH, "rgba(208, 241, 0, 0.38)");
      paneTitle(context, rightX + 12, missionY + 18, "MISSION", "rgba(208, 241, 0, 0.92)");
      const missionLines = [
        `headline: ${clip(mission?.headline || "idle", 38)}`,
        `model:    ${activeModel}`,
        `iter:     ${runtime?.iteration ?? 0}     auto:${autoApprove}`,
        `rate:     1m=${rate1m}  5m=${rate5m}`,
        `last_in:  ${clip((mission?.lastInbound?.content || "—").replace(/\s+/g, " "), 38)}`,
        `last_out: ${clip((mission?.lastOutbound?.content || "—").replace(/\s+/g, " "), 38)}`
      ];
      missionLines.forEach((line, idx) => {
        context.fillStyle = idx === 0 ? "rgba(255, 255, 240, 0.95)" : "rgba(224, 246, 255, 0.78)";
        context.font = `11px ${MONO}`;
        context.fillText(line, rightX + 12, missionY + 38 + idx * 14);
      });

      // MEMORY
      const memoryY = missionY + rightH + rightGap;
      paneBox(context, rightX, memoryY, rightW, rightH, "rgba(160, 240, 200, 0.42)");
      paneTitle(context, rightX + 12, memoryY + 18, "MEMORY", "rgba(160, 240, 200, 0.94)");
      const memoryItems = mission?.memory?.length ? mission.memory : liveEvents.filter((event) => event.type === "memory_read" || event.type === "memory_write" || event.type === "note").slice(0, 5);
      if (!memoryItems.length) {
        paneLine(context, rightX + 12, memoryY + 40, "no memory writes yet — Obsidian quiet", "rgba(224, 246, 255, 0.5)");
        paneLine(context, rightX + 12, memoryY + 56, "expected: ~/Documents/Obsidian/Sarvesh Brain", "rgba(224, 246, 255, 0.4)");
        paneLine(context, rightX + 12, memoryY + 72, "          /Agent/Hermes Logs/<date>.md", "rgba(224, 246, 255, 0.4)");
      } else {
        memoryItems.slice(0, 6).forEach((event, idx) => {
          context.fillStyle = colorFor(event.type);
          context.font = `11px ${MONO}`;
          context.fillText(formatHermesLine(event), rightX + 12, memoryY + 38 + idx * 14);
        });
      }

      // 9. Bottom-left footer panes (RUN_LOG, LOCAL_CONSOLE)
      const footerY = rect.height - 230;
      paneBox(context, 40, footerY, 480, 90, "rgba(224, 246, 255, 0.22)");
      paneTitle(context, 52, footerY + 16, "RUN_LOG", "rgba(224, 246, 255, 0.82)");
      const runRows = payload.runRequests.slice(0, 4);
      if (!runRows.length) {
        paneLine(context, 52, footerY + 36, "EMPTY", "rgba(224, 246, 255, 0.4)");
      } else {
        runRows.forEach((req, idx) => {
          const status = req.status.toUpperCase().slice(0, 8).padEnd(8, " ");
          context.fillStyle = req.status === "completed" ? "rgba(208, 241, 0, 0.85)" : req.status === "failed" ? "rgba(255, 130, 130, 0.85)" : "rgba(224, 246, 255, 0.7)";
          context.font = `11px ${MONO}`;
          context.fillText(`${status} ${clip(req.command || "", 50)}`, 52, footerY + 32 + idx * 14);
        });
      }

      const localY = footerY + 100;
      paneBox(context, 40, localY, 480, 90, "rgba(224, 246, 255, 0.22)");
      paneTitle(context, 52, localY + 16, "LOCAL_CONSOLE", "rgba(224, 246, 255, 0.82)");
      const localRows = payload.localMessages.slice(0, 4);
      if (!localRows.length) {
        paneLine(context, 52, localY + 36, "no local messages", "rgba(224, 246, 255, 0.4)");
      } else {
        localRows.forEach((msg, idx) => {
          context.fillStyle = "rgba(224, 246, 255, 0.78)";
          context.font = `11px ${MONO}`;
          context.fillText(`${msg.author}: ${clip(msg.body, 56)}`, 52, localY + 32 + idx * 14);
        });
      }

      // 10. Bottom-right footer panes (CHANGELOG / GITHUB / IMPROVEMENT)
      paneBox(context, rect.width - 540, footerY, 500, 90, "rgba(208, 241, 0, 0.22)");
      paneTitle(context, rect.width - 528, footerY + 16, "CHANGELOG", "rgba(208, 241, 0, 0.78)");
      payload.changelog.slice(0, 3).forEach((entry, idx) => {
        context.fillStyle = "rgba(224, 246, 255, 0.74)";
        context.font = `11px ${MONO}`;
        context.fillText(`${entry.date} ${clip(entry.title, 50)}`, rect.width - 528, footerY + 32 + idx * 14);
      });

      paneBox(context, rect.width - 540, footerY + 100, 500, 50, payload.publishStatus.state === "ready" ? "rgba(208, 241, 0, 0.5)" : "rgba(255, 210, 164, 0.5)");
      paneTitle(context, rect.width - 528, footerY + 116, "GITHUB_PUBLISH", "rgba(208, 241, 0, 0.86)");
      paneLine(
        context,
        rect.width - 528,
        footerY + 134,
        `${payload.publishStatus.state.toUpperCase()}  ${clip(payload.publishStatus.remote, 50)}`,
        payload.publishStatus.state === "ready" ? "rgba(208, 241, 0, 0.78)" : "rgba(255, 210, 164, 0.78)"
      );

      const improvementY = footerY + 160;
      paneBox(context, rect.width - 540, improvementY, 500, 50, "rgba(180, 160, 255, 0.4)");
      paneTitle(context, rect.width - 528, improvementY + 16, "IMPROVEMENT_LOOP", "rgba(180, 160, 255, 0.86)");
      paneLine(
        context,
        rect.width - 528,
        improvementY + 34,
        `${payload.status.improvementLoop?.state || "boot"}  autopush:${payload.status.improvementLoop?.autoPublish ? "on" : "off"}  evts:${payload.improvementEvents.length}`,
        "rgba(225, 218, 255, 0.78)"
      );

      // Posture footer
      context.font = `11px ${MONO}`;
      context.fillStyle = "rgba(224, 246, 255, 0.55)";
      context.textAlign = "center";
      context.fillText("YOLO_LOCAL · GUARDED_PUBLIC · SARVESH_CODE_LOADED · OBSIDIAN_MIRROR_ACTIVE", centerX, rect.height - 28);
      context.textAlign = "left";

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [activeNode, headline, liveEvents, nodes, payload, pendingIntents]);

  return <canvas ref={canvasRef} className="pretext-console-canvas" aria-label="Hermes Pretext node console" />;
}
