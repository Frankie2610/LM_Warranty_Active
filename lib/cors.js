import { httpError } from "./http.js";

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function applyCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  const allowed = allowedOrigins();

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (origin) {
    throw httpError(403, "Origin không được phép gọi Warranty API.");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Warranty-Admin-Key, X-Shopify-Customer-Email");
  res.setHeader("Access-Control-Max-Age", "600");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
