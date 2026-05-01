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

      // 2. Matrix rain layer — modulated by cadence mode
      if (!matrixRef.current || matrixRef.current.width !== rect.width || matrixRef.current.height !== rect.height) {
        matrixRef.current = buildMatrixRain(rect.width, rect.height);
      }
      const cadenceMode = payload.cadence?.mode || "active";
      const cadenceMultiplier = cadenceMode === "asleep" ? 1.6 : cadenceMode === "idle" ? 1.0 : 0.4;
      drawMatrixRain(context, matrixRef.current, Math.min(1, density * cadenceMultiplier + (cadenceMode === "asleep" ? 0.15 : 0)));

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

      // 6. Nodes with pulse-driven glow (breathing scales with cadence)
      const breathSpeed = cadenceMode === "asleep" ? 0.18 : cadenceMode === "idle" ? 0.10 : 0.04;
      nodes.forEach((node) => {
        const x = (node.x / 100) * rect.width;
        const y = (node.y / 100) * rect.height;
        const isActive = node.id === activeNode;
        const pulse = nodePulseRef.current.get(node.id) || 0;
        nodePulseRef.current.set(node.id, decay(pulse, dt, 600));
        const breathing = isActive ? Math.sin(frame * breathSpeed) * 1.4 : 0;
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

      // 9a. HEALTH pills (top-center band)
      const health = payload.health;
      const pills: { label: string; value: string; ok: boolean }[] = [
        { label: "OLLAMA", value: health?.ollama?.up ? `${health.ollama.latencyMs}ms · ${health.ollama.models.length}m` : "DOWN", ok: !!health?.ollama?.up },
        { label: "GATEWAY", value: health?.gateway?.running ? `pid${health.gateway.pid}` : "DOWN", ok: !!health?.gateway?.running },
        { label: "DASH", value: health?.dashboard?.running ? `pid${health.dashboard.pid}` : "DOWN", ok: !!health?.dashboard?.running },
        { label: "VAULT", value: health?.vault?.accessible ? "ok" : "missing", ok: !!health?.vault?.accessible },
        { label: "DISK", value: health?.disk?.freeGb != null ? `${health.disk.freeGb}GB free` : "?", ok: (health?.disk?.usedPct ?? 0) < 90 },
        { label: "PUSH", value: payload.git?.pushAuth?.ok ? "ok" : "fail", ok: !!payload.git?.pushAuth?.ok },
        { label: "MEM", value: health?.memory ? `${health.memory.usedPct}%` : "?", ok: (health?.memory?.usedPct ?? 100) < 90 },
        { label: "SCORE", value: `${health?.healthScore ?? 0}/100`, ok: (health?.healthScore ?? 0) >= 70 }
      ];
      let pillX = 48;
      const pillY = 100;
      const pillH = 22;
      context.font = `11px ${MONO}`;
      pills.forEach((pill) => {
        const text = `${pill.label} ${pill.value}`;
        const w = context.measureText(text).width + 16;
        const fill = pill.ok ? "rgba(208, 241, 0, 0.12)" : "rgba(255, 130, 130, 0.18)";
        const stroke = pill.ok ? "rgba(208, 241, 0, 0.6)" : "rgba(255, 130, 130, 0.7)";
        context.fillStyle = fill;
        context.fillRect(pillX, pillY, w, pillH);
        context.strokeStyle = stroke;
        context.strokeRect(pillX + 0.5, pillY + 0.5, w - 1, pillH - 1);
        context.fillStyle = pill.ok ? "rgba(208, 241, 0, 0.95)" : "rgba(255, 180, 180, 0.95)";
        context.fillText(text, pillX + 8, pillY + 15);
        pillX += w + 8;
      });

      // 9a-bis. CADENCE pill row — adaptive scheduler state
      const cadence = payload.cadence;
      if (cadence) {
        const cadenceY = 124;
        const idleMin = Math.floor(cadence.idleSec / 60);
        const idleSec = cadence.idleSec % 60;
        const idleLabel = idleMin > 0 ? `${idleMin}m${idleSec}s` : `${cadence.idleSec}s`;
        const cadencePills = [
          { label: "MODE", value: cadence.mode.toUpperCase(), tone: cadence.mode === "asleep" ? "alert" : cadence.mode === "idle" ? "warm" : "neutral" },
          { label: "IDLE", value: idleLabel, tone: "neutral" },
          { label: "THROTTLE", value: cadence.throttle.toFixed(2), tone: cadence.throttle > 0.7 ? "good" : "neutral" },
          { label: "INTERVAL", value: `${Math.round(cadence.recommendedIntervalMs / 1000)}s`, tone: "neutral" },
          { label: "AUTO-APPLY", value: cadence.recommendedAutoApply ? "ARMED" : "off", tone: cadence.recommendedAutoApply ? "good" : "neutral" },
          { label: "LOAD", value: cadence.loadAvg.toFixed(2), tone: cadence.loadAvg > 3 ? "alert" : "neutral" }
        ];
        let cadenceX = 48;
        context.font = `11px ${MONO}`;
        cadencePills.forEach((pill) => {
          const text = `${pill.label} ${pill.value}`;
          const w = context.measureText(text).width + 14;
          const fill = pill.tone === "alert" ? "rgba(255, 130, 130, 0.18)" : pill.tone === "warm" ? "rgba(255, 200, 120, 0.18)" : pill.tone === "good" ? "rgba(208, 241, 0, 0.16)" : "rgba(140, 200, 255, 0.16)";
          const stroke = pill.tone === "alert" ? "rgba(255, 130, 130, 0.7)" : pill.tone === "warm" ? "rgba(255, 200, 120, 0.7)" : pill.tone === "good" ? "rgba(208, 241, 0, 0.7)" : "rgba(140, 200, 255, 0.6)";
          const txt = pill.tone === "alert" ? "rgba(255, 180, 180, 0.95)" : pill.tone === "warm" ? "rgba(255, 220, 170, 0.95)" : pill.tone === "good" ? "rgba(225, 255, 120, 0.95)" : "rgba(190, 220, 255, 0.92)";
          context.fillStyle = fill;
          context.fillRect(cadenceX, cadenceY, w, 20);
          context.strokeStyle = stroke;
          context.strokeRect(cadenceX + 0.5, cadenceY + 0.5, w - 1, 19);
          context.fillStyle = txt;
          context.fillText(text, cadenceX + 7, cadenceY + 14);
          cadenceX += w + 6;
        });
      }

      // 9b. SPARKLINE — events per minute over last hour
      const sparkX = 48;
      const sparkY = 154;
      const sparkW = Math.min(420, rect.width * 0.32);
      const sparkH = 36;
      paneBox(context, sparkX, sparkY, sparkW, sparkH, "rgba(140, 200, 255, 0.32)", 0.4);
      context.font = `10px ${MONO}`;
      context.fillStyle = "rgba(140, 200, 255, 0.85)";
      context.fillText("EVENTS/min · last 60min", sparkX + 8, sparkY + 12);
      const buckets = payload.timeline?.buckets || [];
      const peak = Math.max(1, payload.timeline?.peak || 1);
      const innerW = sparkW - 16;
      const colW = innerW / Math.max(1, buckets.length);
      buckets.forEach((bucket, idx) => {
        const h = (bucket.count / peak) * (sparkH - 18);
        const x = sparkX + 8 + idx * colW;
        const y = sparkY + sparkH - 4 - h;
        context.fillStyle = bucket.count > 0 ? "rgba(208, 241, 0, 0.78)" : "rgba(140, 200, 255, 0.18)";
        context.fillRect(x, y, Math.max(1, colW - 1), Math.max(1, h));
      });
      context.fillStyle = "rgba(224, 246, 255, 0.5)";
      context.font = `10px ${MONO}`;
      context.fillText(`peak=${peak}  total=${payload.timeline?.total ?? 0}`, sparkX + sparkW - 130, sparkY + 12);

      // 9c. GIT_STATE — branch, head, dirty, ahead, push auth
      const git = payload.git;
      const gitX = sparkX + sparkW + 12;
      const gitY = sparkY;
      const gitW = Math.min(360, rect.width - gitX - 420);
      paneBox(context, gitX, gitY, gitW, sparkH, git?.pushAuth?.ok ? "rgba(208, 241, 0, 0.42)" : "rgba(255, 200, 120, 0.55)", 0.45);
      context.font = `11px ${MONO}`;
      context.fillStyle = git?.pushAuth?.ok ? "rgba(208, 241, 0, 0.92)" : "rgba(255, 200, 120, 0.92)";
      context.fillText(`GIT  ${git?.branch || "?"}@${git?.head || "?"}`, gitX + 8, gitY + 14);
      context.fillStyle = "rgba(224, 246, 255, 0.78)";
      const gitLine2 = git
        ? `${git.dirty ? `${git.dirtyFiles}* dirty` : "clean"}  ahead:${git.ahead}  push:${git.pushAuth?.ok ? "ok" : "FAIL"}`
        : "no git probe";
      context.fillText(gitLine2, gitX + 8, gitY + 28);
      context.fillStyle = "rgba(180, 220, 255, 0.6)";
      const lastSubject = clip(git?.lastCommit?.subject || "—", Math.max(20, Math.floor(gitW / 7)));
      context.fillText(`last: ${git?.lastCommit?.short || "?"}  ${lastSubject}`, gitX + 8, gitY + sparkH + 14);

      // 9d. SESSIONS pane (left-middle)
      const sessionsBoxX = 48;
      const sessionsBoxY = 196;
      const sessionsBoxW = sparkW;
      const sessionsBoxH = 96;
      paneBox(context, sessionsBoxX, sessionsBoxY, sessionsBoxW, sessionsBoxH, "rgba(160, 240, 200, 0.4)");
      paneTitle(context, sessionsBoxX + 12, sessionsBoxY + 16, "TELEGRAM_SESSIONS", "rgba(160, 240, 200, 0.92)");
      const sessionRows = payload.sessions?.sessions?.slice(0, 4) || [];
      if (!sessionRows.length) {
        paneLine(context, sessionsBoxX + 12, sessionsBoxY + 36, "no active sessions tracked", "rgba(224, 246, 255, 0.5)");
      } else {
        sessionRows.forEach((session, idx) => {
          const last = session.updatedAt ? session.updatedAt.slice(11, 19) : "—";
          const line = `${last}  ${session.platform.padEnd(8)} ${session.chatId || "?"}  ${session.userName || "anon"}`;
          context.fillStyle = "rgba(224, 246, 255, 0.78)";
          context.font = `11px ${MONO}`;
          context.fillText(clip(line, Math.floor(sessionsBoxW / 7)), sessionsBoxX + 12, sessionsBoxY + 34 + idx * 14);
        });
      }

      // 9e. SKILLS pane (left-middle, below sessions)
      const skillsBoxX = 48;
      const skillsBoxY = sessionsBoxY + sessionsBoxH + 8;
      const skillsBoxW = sparkW;
      const skillsBoxH = 96;
      paneBox(context, skillsBoxX, skillsBoxY, skillsBoxW, skillsBoxH, "rgba(180, 160, 255, 0.4)");
      const skillsHeader = payload.skills
        ? `SKILLS  active=${payload.skills.activeCount}  disabled=${payload.skills.disabledCount}  total=${payload.skills.totalCount}`
        : "SKILLS";
      paneTitle(context, skillsBoxX + 12, skillsBoxY + 16, skillsHeader, "rgba(225, 218, 255, 0.92)");
      const activeSkills = (payload.skills?.skills || []).filter((s) => !s.disabled).slice(0, 4);
      if (!activeSkills.length) {
        paneLine(context, skillsBoxX + 12, skillsBoxY + 36, "no skills loaded", "rgba(224, 246, 255, 0.5)");
      } else {
        activeSkills.forEach((skill, idx) => {
          context.fillStyle = "rgba(225, 218, 255, 0.85)";
          context.font = `11px ${MONO}`;
          context.fillText(
            clip(`· ${skill.name.padEnd(22)} ${skill.description}`, Math.floor(skillsBoxW / 7)),
            skillsBoxX + 12,
            skillsBoxY + 34 + idx * 14
          );
        });
      }

      // 9f. MEMORY_FILES pane (left-middle, below skills)
      const memFilesBoxX = 48;
      const memFilesBoxY = skillsBoxY + skillsBoxH + 8;
      const memFilesBoxW = sparkW;
      const memFilesBoxH = 96;
      paneBox(context, memFilesBoxX, memFilesBoxY, memFilesBoxW, memFilesBoxH, "rgba(160, 240, 200, 0.4)");
      paneTitle(
        context,
        memFilesBoxX + 12,
        memFilesBoxY + 16,
        `MEMORY_FILES  ${payload.memoryFiles?.count || 0} loaded`,
        "rgba(160, 240, 200, 0.92)"
      );
      const memFiles = payload.memoryFiles?.files?.slice(0, 4) || [];
      if (!memFiles.length) {
        paneLine(context, memFilesBoxX + 12, memFilesBoxY + 36, "~/.hermes/memories empty", "rgba(224, 246, 255, 0.5)");
      } else {
        memFiles.forEach((file, idx) => {
          context.fillStyle = "rgba(224, 246, 255, 0.82)";
          context.font = `11px ${MONO}`;
          context.fillText(
            clip(`· ${file.name.padEnd(28)} ${file.description}`, Math.floor(memFilesBoxW / 7)),
            memFilesBoxX + 12,
            memFilesBoxY + 34 + idx * 14
          );
        });
      }

      // 9g. PROPOSALS strip (right side, only if pending)
      const proposals = payload.pendingProposals || [];
      if (proposals.length) {
        const propX = rect.width - 380;
        const propY = 110;
        const propW = 332;
        const propH = Math.min(180, 22 + proposals.length * 32);
        paneBox(context, propX, propY, propW, propH, "rgba(255, 200, 120, 0.6)", 0.45);
        paneTitle(context, propX + 12, propY + 16, `HERMES_PROPOSALS  pending=${proposals.length}`, "rgba(255, 200, 120, 0.95)");
        proposals.slice(0, 4).forEach((proposal, idx) => {
          context.fillStyle = "rgba(255, 240, 200, 0.92)";
          context.font = `11px ${MONO}`;
          context.fillText(clip(`◆ ${proposal.title}`, Math.floor(propW / 7)), propX + 12, propY + 34 + idx * 28);
          context.fillStyle = "rgba(224, 246, 255, 0.6)";
          context.fillText(clip(proposal.rationale, Math.floor(propW / 6)), propX + 12, propY + 48 + idx * 28);
        });
      }

      // 9h. THEMED SURFACES strip (DESIGN_LAB / SPORTS_RADAR / BUZZR_DRAFTS / DESIGN_LIBRARY)
      const themed = payload.themed || {};
      const themedY = rect.height - 332;
      const themedW = (rect.width - 96) / 4;
      const themedH = 84;
      const themedSurfaces: { key: keyof typeof themed; title: string; color: string; emptyHint: string }[] = [
        { key: "design_lab", title: "DESIGN_LAB", color: "rgba(180, 160, 255, 0.5)", emptyHint: "no experiments yet — Hermes will propose visual polishes overnight" },
        { key: "sports_radar", title: "SPORTS_RADAR", color: "rgba(140, 200, 255, 0.5)", emptyHint: "leagues / headlines / commentator tweets — Hermes fetches via web tool" },
        { key: "buzzr_drafts", title: "BUZZR_DRAFTS", color: "rgba(208, 241, 0, 0.5)", emptyHint: "tweet drafts queued — public-gate before any post" },
        { key: "design_library", title: "DESIGN_LIBRARY", color: "rgba(160, 240, 200, 0.5)", emptyHint: "design system summaries pulled by Hermes" }
      ];
      themedSurfaces.forEach((surface, idx) => {
        const x = 48 + idx * themedW;
        const summary = themed[surface.key];
        const count = summary?.count ?? 0;
        paneBox(context, x, themedY, themedW - 10, themedH, surface.color, 0.45);
        context.font = `12px ${MONO}`;
        context.fillStyle = surface.color.replace("0.5", "0.95");
        context.fillText(`${surface.title}  ${count}`, x + 10, themedY + 16);
        if (count === 0 || !summary?.latest?.length) {
          context.fillStyle = "rgba(224, 246, 255, 0.5)";
          context.font = `10px ${MONO}`;
          const wrapped = surface.emptyHint.match(/.{1,38}/g) || [surface.emptyHint];
          wrapped.slice(0, 4).forEach((line, lidx) => {
            context.fillText(line, x + 10, themedY + 34 + lidx * 12);
          });
        } else {
          summary.latest.slice(0, 4).forEach((item: Record<string, unknown>, lidx: number) => {
            const text =
              (item.title as string | undefined) ||
              (item.headline as string | undefined) ||
              (item.text as string | undefined) ||
              (item.summary as string | undefined) ||
              "";
            context.fillStyle = "rgba(224, 246, 255, 0.78)";
            context.font = `11px ${MONO}`;
            context.fillText(`· ${clip(String(text), Math.floor((themedW - 30) / 6))}`, x + 10, themedY + 32 + lidx * 13);
          });
        }
      });

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
