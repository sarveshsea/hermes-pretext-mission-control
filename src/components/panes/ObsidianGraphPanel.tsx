import { useEffect, useRef, useState } from "react";

type GraphNode = { id: string; title: string; tags: string[] };
type GraphEdge = { from: string; to: string; kind: string };
type Position = { x: number; y: number };

type LayoutCache = Record<string, Position>;

function springLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number, iterations = 80) {
  const positions: LayoutCache = {};
  nodes.forEach((node, idx) => {
    const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2;
    positions[node.id] = {
      x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.3,
      y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.3
    };
  });
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.55;
  for (let i = 0; i < iterations; i++) {
    const disp: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) disp[n.id] = { x: 0, y: 0 };
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a];
        const nb = nodes[b];
        const dx = positions[na.id].x - positions[nb.id].x;
        const dy = positions[na.id].y - positions[nb.id].y;
        const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[na.id].x += fx;
        disp[na.id].y += fy;
        disp[nb.id].x -= fx;
        disp[nb.id].y -= fy;
      }
    }
    for (const e of edges) {
      if (!positions[e.from] || !positions[e.to]) continue;
      const dx = positions[e.from].x - positions[e.to].x;
      const dy = positions[e.from].y - positions[e.to].y;
      const dist = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      disp[e.from].x -= fx;
      disp[e.from].y -= fy;
      disp[e.to].x += fx;
      disp[e.to].y += fy;
    }
    const t = (1 - i / iterations) * 8;
    for (const n of nodes) {
      const d = disp[n.id];
      const m = Math.max(0.01, Math.sqrt(d.x * d.x + d.y * d.y));
      positions[n.id].x = Math.min(width - 24, Math.max(24, positions[n.id].x + (d.x / m) * Math.min(m, t)));
      positions[n.id].y = Math.min(height - 24, Math.max(24, positions[n.id].y + (d.y / m) * Math.min(m, t)));
    }
  }
  return positions;
}

export default function ObsidianGraphPanel() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [positions, setPositions] = useState<LayoutCache>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const offsetRef = useRef<Position | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/obsidian/graph", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        // Rank by edge degree, keep top 24 — orphans clutter the canvas.
        const allNodes: GraphNode[] = data.nodes || [];
        const allEdges: GraphEdge[] = data.edges || [];
        const degree = new Map<string, number>();
        for (const e of allEdges) {
          degree.set(e.from, (degree.get(e.from) || 0) + 1);
          degree.set(e.to, (degree.get(e.to) || 0) + 1);
        }
        const ranked = [...allNodes]
          .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
          .slice(0, 24);
        const ids = new Set(ranked.map((n) => n.id));
        const limitedEdges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to)).slice(0, 80);
        setNodes(ranked);
        setEdges(limitedEdges);
        const rect = containerRef.current?.getBoundingClientRect();
        const w = rect?.width || 600;
        const h = rect?.height || 220;
        const layoutPos = await fetch("/api/dashboard-layout").then((r) => r.json()).catch(() => null);
        const persisted: LayoutCache = layoutPos?.obsidianNodes || {};
        const computed = springLayout(ranked, limitedEdges, w, h, 120);
        const merged: LayoutCache = {};
        for (const n of ranked) merged[n.id] = persisted[n.id] || computed[n.id];
        setPositions(merged);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string) {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pos = positions[id] || { x: 0, y: 0 };
    offsetRef.current = { x: e.clientX - rect.left - pos.x, y: e.clientY - rect.top - pos.y };
    setDragId(id);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragId || !offsetRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(20, Math.min(rect.width - 20, e.clientX - rect.left - offsetRef.current.x));
    const y = Math.max(20, Math.min(rect.height - 20, e.clientY - rect.top - offsetRef.current.y));
    setPositions((prev) => ({ ...prev, [dragId]: { x, y } }));
  }

  function onPointerUp() {
    if (!dragId) return;
    const persistKey = dragId;
    const persistPos = positions[dragId];
    setDragId(null);
    offsetRef.current = null;
    if (persistPos) {
      void fetch("/api/dashboard-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obsidianNodes: { [persistKey]: persistPos } })
      }).catch(() => {});
    }
  }

  return (
    <div
      ref={containerRef}
      className="obsidian-graph"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg className="obsidian-graph-edges" width="100%" height="100%">
        {edges.map((e, i) => {
          const a = positions[e.from];
          const b = positions[e.to];
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="rgba(140, 200, 255, 0.22)"
              strokeWidth={0.7}
            />
          );
        })}
      </svg>
      {nodes.map((n) => {
        const pos = positions[n.id] || { x: 0, y: 0 };
        return (
          <div
            key={n.id}
            className={`obsidian-node ${dragId === n.id ? "obsidian-node-dragging" : ""}`}
            style={{ left: pos.x, top: pos.y }}
            onPointerDown={(e) => onPointerDown(e, n.id)}
            title={n.id}
          >
            {n.title}
          </div>
        );
      })}
      <div className="obsidian-graph-meta muted">
        {nodes.length} nodes · {edges.length} edges · drag to rearrange
      </div>
    </div>
  );
}
