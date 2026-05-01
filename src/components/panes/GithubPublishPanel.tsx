import type { PublishStatus } from "../../api";

export default function GithubPublishPanel({ publishStatus }: { publishStatus: PublishStatus }) {
  const ok = publishStatus.state === "ready";
  return (
    <div className="kv">
      <div className="kv-row">
        <span className="kv-key">state</span>
        <span className={`kv-val ${ok ? "ok" : "warn"}`}>{publishStatus.state.toUpperCase()}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">remote</span>
        <span className="kv-val truncate">{publishStatus.remote}</span>
      </div>
      <div className="kv-row">
        <span className="kv-key">why</span>
        <span className="kv-val muted">{publishStatus.reason}</span>
      </div>
    </div>
  );
}
