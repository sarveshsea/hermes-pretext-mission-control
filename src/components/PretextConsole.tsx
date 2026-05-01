import { useEffect, useMemo, useRef } from "react";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { ConsoleNode, ConsoleNodeId } from "../consoleModel";
import { activeNodeCopy } from "../consoleModel";
import type { DashboardPayload, HermesEvent } from "../api";
import {
  decay,
  drawParticle,
  edgeKey,
  eventTrajectory,
  spawnParticle,
  type Particle,
  type Vec2
} from "../visualEngine";

type Props = {
  payload: DashboardPayload;
  nodes: ConsoleNode[];
  activeNode: ConsoleNodeId;
  liveEvents: HermesEvent[];
  nodePositionOverrides?: Record<string, { x: number; y: number }>;
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const BG = "#001033";

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

function effectiveNodePosition(node: ConsoleNode, overrides: Record<string, { x: number; y: number }> | undefined, rect: DOMRect) {
  const override = overrides?.[node.id];
  if (override) {
    return { x: override.x, y: override.y };
  }
  return { x: (node.x / 100) * rect.width, y: (node.y / 100) * rect.height };
}

export default function PretextConsole({ payload, nodes, activeNode, liveEvents, nodePositionOverrides }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headline = useMemo(
    () => buildHeadline(payload, nodes, activeNode),
    [activeNode, nodes, payload]
  );

  const particlesRef = useRef<Particle[]>([]);
  const edgeHeatRef = useRef<Map<string, number>>(new Map());
  const nodePulseRef = useRef<Map<string, number>>(new Map());
  const lastEventIdRef = useRef<string | null>(null);
  const lastFrameRef = useRef<number>(performance.now());

  // Spawn particles for new events, boost edge heat + node pulse.
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
      const found = nodes.find((node) => node.id === id);
      if (!found) return null;
      return effectiveNodePosition(found, nodePositionOverrides, rect);
    };
    const now = performance.now();
    fresh
      .slice()
      .reverse()
      .forEach((event) => {
        const traj = eventTrajectory(event.type);
        const heat = (edgeHeatRef.current.get(edgeKey(traj.source, traj.target)) || 0) + 1;
        edgeHeatRef.current.set(edgeKey(traj.source, traj.target), Math.min(heat, 4));
        nodePulseRef.current.set(traj.source, Math.min((nodePulseRef.current.get(traj.source) || 0) + 0.6, 4));
        nodePulseRef.current.set(traj.target, Math.min((nodePulseRef.current.get(traj.target) || 0) + 1, 4));
        const particle = spawnParticle(event, resolveNode, now);
        if (particle) particlesRef.current.push(particle);
      });
  }, [liveEvents, nodes, nodePositionOverrides]);

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

      // 1. Flat background — no gradient, no matrix rain.
      context.fillStyle = BG;
      context.fillRect(0, 0, rect.width, rect.height);

      // 2. Subtle grid, every 80px, very faint.
      context.strokeStyle = "rgba(140, 200, 255, 0.04)";
      context.lineWidth = 1;
      for (let x = 80; x < rect.width; x += 80) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, rect.height);
        context.stroke();
      }
      for (let y = 80; y < rect.height; y += 80) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(rect.width, y);
        context.stroke();
      }

      const centerX = rect.width / 2;
      const centerY = rect.height * 0.5;

      // 3. Edges with heat-based brightness.
      nodes.forEach((from) => {
        nodes.forEach((to) => {
          if (from.id >= to.id) return;
          const key = edgeKey(from.id, to.id);
          const heat = edgeHeatRef.current.get(key) || 0;
          edgeHeatRef.current.set(key, decay(heat, dt, 700));
          const baseAlpha = from.id === activeNode || to.id === activeNode ? 0.16 : 0.06;
          const alpha = Math.min(0.85, baseAlpha + heat * 0.22);
          context.strokeStyle = `rgba(140, 200, 255, ${alpha})`;
          context.lineWidth = 0.6 + heat * 0.4;
          const fp = effectiveNodePosition(from, nodePositionOverrides, rect);
          const tp = effectiveNodePosition(to, nodePositionOverrides, rect);
          context.beginPath();
          context.moveTo(fp.x, fp.y);
          context.quadraticCurveTo(centerX, centerY, tp.x, tp.y);
          context.stroke();
        });
      });

      // 4. Particles
      particlesRef.current = particlesRef.current.filter((particle) => drawParticle(context, particle, now));

      // 5. Hermes nodes with pulse-driven halo
      nodes.forEach((node) => {
        const pos = effectiveNodePosition(node, nodePositionOverrides, rect);
        const isActive = node.id === activeNode;
        const pulse = nodePulseRef.current.get(node.id) || 0;
        nodePulseRef.current.set(node.id, decay(pulse, dt, 600));
        const breathing = isActive ? Math.sin(frame * 0.06) * 1.4 : 0;
        const radius = 24 + pulse * 8 + breathing;
        const haloAlpha = Math.min(0.55, 0.04 + pulse * 0.18 + (isActive ? 0.15 : 0));

        const grad = context.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, radius * 1.4);
        grad.addColorStop(0, isActive ? `rgba(208, 241, 0, ${haloAlpha + 0.2})` : `rgba(140, 200, 255, ${haloAlpha})`);
        grad.addColorStop(1, "rgba(0, 16, 51, 0)");
        context.fillStyle = grad;
        context.beginPath();
        context.arc(pos.x, pos.y, radius * 1.4, 0, Math.PI * 2);
        context.fill();

        context.font = `13px ${MONO}`;
        context.textAlign = "center";
        context.fillStyle = isActive ? "#d0f100" : "rgba(224, 246, 255, 0.92)";
        context.fillText(
          isActive ? `> ${node.label.toUpperCase()} <` : `[${node.label.toUpperCase()}]`,
          pos.x,
          pos.y
        );
        context.fillStyle = isActive ? "rgba(208, 241, 0, 0.78)" : "rgba(180, 220, 255, 0.55)";
        context.fillText(node.metric.slice(0, 30), pos.x, pos.y + 16);
        context.textAlign = "left";
      });

      // 6. Center kinetic headline
      const prepared = prepareWithSegments(headline, `15px ${MONO}`);
      const headlineWidth = Math.min(640, rect.width * 0.42);
      const layout = layoutWithLines(prepared, headlineWidth, 22);
      const textX = centerX - headlineWidth / 2;
      const textY = centerY - 70;
      context.fillStyle = "rgba(0, 16, 51, 0.6)";
      context.fillRect(textX - 16, textY - 14, headlineWidth + 32, 134);
      context.strokeStyle = "rgba(208, 241, 0, 0.32)";
      context.strokeRect(textX - 16.5, textY - 14.5, headlineWidth + 33, 135);
      context.font = `15px ${MONO}`;
      context.textBaseline = "top";
      layout.lines.slice(0, 5).forEach((line, index) => {
        context.fillStyle = index === 0 ? "#d0f100" : "rgba(250, 254, 255, 0.86)";
        context.globalAlpha = 0.98 - index * 0.06;
        context.fillText(index === 0 ? `$ ${line.text}` : `  ${line.text}`, textX, textY + index * 22);
      });
      context.globalAlpha = 1;
      context.textBaseline = "alphabetic";

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [activeNode, headline, nodes, nodePositionOverrides]);

  return <canvas ref={canvasRef} className="pretext-console-canvas" aria-label="Hermes Pretext node console" />;
}
