import { useEffect, useState, type ReactNode } from "react";
import type { Proposal } from "../api";

type Props = {
  proposal: Proposal | null;
  onClose: () => void;
};

type Preview = {
  ok: boolean;
  reason: string;
  diffStat?: string;
  diff?: string;
  exitCode?: number;
};

function colorizeDiff(diff: string): ReactNode[] {
  return diff.split("\n").slice(0, 80).map((line, idx) => {
    let cls = "diff-context";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "diff-meta";
    else if (line.startsWith("+")) cls = "diff-add";
    else if (line.startsWith("-")) cls = "diff-del";
    else if (line.startsWith("@@")) cls = "diff-hunk";
    return (
      <span key={idx} className={`diff-line ${cls}`}>
        {line}
      </span>
    );
  });
}

export default function DiffPreviewOverlay({ proposal, onClose }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!proposal) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void fetch("/api/code/diff-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: proposal.command || undefined,
        argv: proposal.argv || undefined
      })
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview({ ok: false, reason: "preview request failed" });
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposal]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && proposal) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proposal, onClose]);

  if (!proposal) return null;

  return (
    <aside className="diff-overlay">
      <header>
        <strong>diff_preview · {proposal.title}</strong>
        <button onClick={onClose} className="button button-mini button-light">close</button>
      </header>
      {busy ? (
        <div className="muted">running sandboxed dry-run…</div>
      ) : preview ? (
        preview.ok ? (
          <>
            <div className="diff-stat">
              <strong>diff stat</strong>
              <pre>{preview.diffStat || "(empty)"}</pre>
            </div>
            <div className="diff-body">
              <strong>diff (first 80 lines)</strong>
              <pre className="diff-pre">{colorizeDiff(preview.diff || "")}</pre>
            </div>
          </>
        ) : (
          <div className="warn">refused: {preview.reason}</div>
        )
      ) : (
        <div className="muted">no preview</div>
      )}
    </aside>
  );
}
