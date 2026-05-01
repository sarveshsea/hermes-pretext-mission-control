// nomic-embed-text helper. Caches embeddings in memory so the dedup worker
// doesn't re-embed the same task title every minute.
//
// Usage:
//   const v = await embed("audit document for Memoire");
//   const sim = cosineSim(a, b);  // 0..1, 1=identical

import { runOllama } from "./ollamaQueue.mjs";

const MODEL = process.env.PRETEXT_EMBED_MODEL || "nomic-embed-text:latest";
const CACHE_MAX = 2000;

const cache = new Map(); // text -> Float32Array

export async function embed(text) {
  if (typeof text !== "string" || !text.length) return null;
  if (cache.has(text)) return cache.get(text);
  try {
    const data = await runOllama({
      model: MODEL,
      endpoint: "/api/embeddings",
      timeoutMs: 30_000,
      body: { prompt: text }
    });
    const vec = data.embedding ? Float32Array.from(data.embedding) : null;
    if (vec) {
      cache.set(text, vec);
      if (cache.size > CACHE_MAX) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    }
    return vec;
  } catch {
    return null;
  }
}

export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Cluster a list of items by semantic similarity. Returns array of clusters,
// each cluster is an array of items with same theme. Items must have a
// .embedding (Float32Array) field. Threshold default 0.85.
export function clusterByEmbedding(items, threshold = 0.85) {
  const clusters = [];
  for (const item of items) {
    if (!item.embedding) continue;
    let placed = false;
    for (const cluster of clusters) {
      const sim = cosineSim(item.embedding, cluster.centroid);
      if (sim >= threshold) {
        cluster.members.push(item);
        // running average centroid
        for (let i = 0; i < cluster.centroid.length; i += 1) {
          cluster.centroid[i] = (cluster.centroid[i] * (cluster.members.length - 1) + item.embedding[i]) / cluster.members.length;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ centroid: Float32Array.from(item.embedding), members: [item] });
    }
  }
  return clusters;
}

export function getEmbeddingCacheStatus() {
  return { cached: cache.size, model: MODEL };
}
