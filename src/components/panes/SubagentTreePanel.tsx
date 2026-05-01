import type { DashboardPayload } from "../../api";

type SubagentNode = { id: string; intent: string; mission: string; status: string };

function renderTree(
  nodes: SubagentNode[],
  byParent: Record<string, SubagentNode[]>,
  depth: number
): React.ReactNode[] {
  return nodes.flatMap((node) => {
    const children = byParent[node.id] || [];
    const tone =
      node.status === "succeeded"
        ? "ok"
        : node.status === "failed"
          ? "warn"
          : node.status === "running"
            ? "active"
            : "muted";
    return [
      <li key={node.id} className="tree-row" style={{ paddingLeft: depth * 16 }}>
        <span className={`tree-dot tree-${tone}`}>{depth > 0 ? "└" : "◇"}</span>
        <span className="tree-mission">{node.mission}</span>
        <span className="tree-intent truncate">{node.intent}</span>
        <span className={`tree-status tree-${tone}`}>{node.status}</span>
      </li>,
      ...renderTree(children, byParent, depth + 1)
    ];
  });
}

export default function SubagentTreePanel({ payload }: { payload: DashboardPayload }) {
  const tree = payload.subagentTree;
  if (!tree || tree.total === 0) {
    return <div className="muted">no subagents — Hermes hasn't spawned any yet</div>;
  }
  return (
    <ul className="tree">
      {renderTree(tree.roots as SubagentNode[], tree.byParent as Record<string, SubagentNode[]>, 0)}
    </ul>
  );
}
