import type { TimelineBucket } from "../../api";

type Props = {
  buckets: TimelineBucket[];
  total: number;
  peak: number;
};

export default function SparklinePanel({ buckets, total, peak }: Props) {
  const safePeak = Math.max(1, peak);
  return (
    <div className="sparkline-wrap">
      <div className="sparkline-head">
        <span>events/min · 60min</span>
        <span className="muted">peak {safePeak} · total {total}</span>
      </div>
      <div className="sparkline-bars" role="img" aria-label="event rate sparkline">
        {buckets.map((b, idx) => {
          const h = (b.count / safePeak) * 100;
          return (
            <span
              key={idx}
              className={`spark-bar ${b.count > 0 ? "spark-on" : "spark-off"}`}
              style={{ height: `${Math.max(2, h)}%` }}
              title={`t-${b.minutesAgo}min · ${b.count} events`}
            />
          );
        })}
      </div>
    </div>
  );
}
