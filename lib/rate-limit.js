import { httpError } from "./http.js";

const buckets = new Map();

export function softRateLimit(req, {
  key = "default",
  max = 30,
  windowMs = 60_000
} = {}) {
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  const ip = forwarded.split(",")[0].trim() || String(req.socket?.remoteAddress || "unknown");
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();

  let item = buckets.get(bucketKey);

  if (!item || now - item.startedAt >= windowMs) {
    item = { startedAt: now, count: 0 };
    buckets.set(bucketKey, item);
  }

  item.count += 1;

  if (item.count > max) {
    throw httpError(429, "Có quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.");
  }

  if (buckets.size > 5000) {
    for (const [k, value] of buckets) {
      if (now - value.startedAt > windowMs * 2) buckets.delete(k);
    }
  }
}
