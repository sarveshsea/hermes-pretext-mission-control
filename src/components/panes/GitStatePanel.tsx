import type { GitState } from "../../api";

export default function GitStatePanel({ git }: { git: GitState }) {
  if (!git) return <div className="muted" data-testid="pane-git">no git probe</div>;
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">branch</span>
        <span className="kv-val">{git.branch || "?"}@{git.head || "?"}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">tree</span>
        <span className={`kv-val ${git.dirty ? "warn" : "ok"}`}>
          {git.dirty ? `${git.dirtyFiles}* dirty` : "clean"} · ahead {git.ahead}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">push</span>
        <span className={`kv-val ${git.pushAuth?.ok ? "ok" : "warn"}`}>
          {git.pushAuth?.ok ? "ok" : "FAIL"}
        </span>
      </div>
      <div className="kv-row">
        <span className="kv-key">last</span>
        <span className="kv-val truncate">
          {git.lastCommit?.short || "?"} {git.lastCommit?.subject || "—"}
        </span>
      </div>
    </div>
  );
}
