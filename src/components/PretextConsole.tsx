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

type PulseRing = { x: number; y: number; born: number; ttl: number; hue: string };

const MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
const BG = "#0a0a0c";

function drawHexGrid(ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) {
  const r = 22;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 0.5;
  for (let row = -1, ry = 0; ry < h + r; row++, ry = row * dy) {
    const offset = row % 2 === 0 ? 0 : dx / 2;
    for (let cx = -dx; cx < w + dx; cx += dx) {
      const x = cx + offset;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6;
        const px = x + Math.cos(angle) * r;
        const py = ry + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  // subtle scanline
  const scan = ((frame * 0.6) % h) - 40;
  const grad = ctx.createLinearGradient(0, scan, 0, scan + 40);
  grad.addColorStop(0, "rgba(208, 241, 0, 0)");
  grad.addColorStop(0.5, "rgba(208, 241, 0, 0.04)");
  grad.addColorStop(1, "rgba(208, 241, 0, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, scan, w, 40);
}

function drawConcentricRings(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, intensity: number) {
  const radii = [44, 60, 80, 102];
  const rotations = [0.004, -0.0024, 0.0016, -0.001];
  radii.forEach((r, i) => {
    const phase = frame * rotations[i];
    ctx.strokeStyle = `rgba(208, 241, 0, ${0.08 + intensity * 0.18 * (1 - i / radii.length)})`;
    ctx.lineWidth = i === 0 ? 1.4 : 0.6;
    ctx.setLineDash(i === 1 ? [5, 9] : i === 2 ? [2, 6] : []);
    ctx.beginPath();
    const start = phase % (Math.PI * 2);
    const arcLen = i === 0 ? Math.PI * 2 : Math.PI * 1.4;
    ctx.arc(x, y, r, start, start + arcLen);
    ctx.stroke();
    ctx.setLineDash([]);
    if (i === 0) {
      // tick marks every 30°
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const ax = x + Math.cos(a + phase) * (r - 3);
        const ay = y + Math.sin(a + phase) * (r - 3);
        const bx = x + Math.cos(a + phase) * (r + 3);
        const by = y + Math.sin(a + phase) * (r + 3);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
  });
}

function drawPulseRing(ctx: CanvasRenderingContext2D, ring: PulseRing, now: number): boolean {
  const t = (now - ring.born) / ring.ttl;
  if (t >= 1) return false;
  const radius = 10 + t * 80;
  ctx.strokeStyle = ring.hue.replace(/[\d.]+\)/, `${(1 - t) * 0.8})`);
  ctx.lineWidth = 2 * (1 - t);
  ctx.beginPath();
  ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  return true;
}

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
  const pulseRingsRef = useRef<PulseRing[]>([]);

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
        // Pulse ring on the destination node
        const dest = resolveNode(traj.target);
        if (dest) {
          const hueMatch = particle?.hue || "rgba(208, 241, 0, 0.8)";
          pulseRingsRef.current.push({ x: dest.x, y: dest.y, born: now, ttl: 1100, hue: hueMatch });
        }
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

      // 1. Flat background.
      context.fillStyle = BG;
      context.fillRect(0, 0, rect.width, rect.height);

      // 2. Hex-grid backdrop with slow scanline.
      drawHexGrid(context, rect.width, rect.height, frame);

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

      // 4a. Pulse rings (event arrival pop)
      pulseRingsRef.current = pulseRingsRef.current.filter((ring) => drawPulseRing(context, ring, now));

      // 4b. Particles travelling along edges
      particlesRef.current = particlesRef.current.filter((particle) => drawParticle(context, particle, now));

      // 4c. Concentric rings around the HERMES node
      const hermesNode = nodes.find((n) => n.id === "hermes");
      if (hermesNode) {
        const pos = effectiveNodePosition(hermesNode, nodePositionOverrides, rect);
        const intensity = Math.min(1, (nodePulseRef.current.get("hermes") || 0) / 2);
        drawConcentricRings(context, pos.x, pos.y, frame, intensity);
      }

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
