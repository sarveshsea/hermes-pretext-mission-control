const HEARTBEAT_MS = 15_000;

export function openSseStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
}

export function writeSseEvent(res, event, data) {
  if (res.writableEnded) return false;
  try {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

export function attachSseHeartbeat(res) {
  const timer = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(timer);
      return;
    }
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(timer);
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
  res.on("close", () => clearInterval(timer));
  return timer;
}
