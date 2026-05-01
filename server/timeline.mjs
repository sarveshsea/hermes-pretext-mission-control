import { getHermesEvents } from "./hermesEvents.mjs";

export async function getEventTimeline({ minutes = 60 } = {}) {
  const events = await getHermesEvents(2000);
  const now = Date.now();
  const buckets = new Array(minutes).fill(0).map((_, idx) => ({
    minutesAgo: minutes - 1 - idx,
    epoch: now - (minutes - 1 - idx) * 60_000,
    count: 0,
    byType: {}
  }));
  const start = now - minutes * 60_000;
  for (const event of events) {
    const ts = new Date(event.createdAt).getTime();
    if (!Number.isFinite(ts) || ts < start) continue;
    const minutesAgo = Math.floor((now - ts) / 60_000);
    if (minutesAgo < 0 || minutesAgo >= minutes) continue;
    const bucket = buckets[minutes - 1 - minutesAgo];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.byType[event.type] = (bucket.byType[event.type] || 0) + 1;
  }
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const peak = buckets.reduce((max, bucket) => (bucket.count > max ? bucket.count : max), 0);
  return {
    generatedAt: new Date().toISOString(),
    minutes,
    total,
    peak,
    buckets
  };
}
