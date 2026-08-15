import { json } from "../../lib/http.js";
import { applyCors } from "../../lib/cors.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    return json(res, 200, {
      ok: true,
      service: "lm-warranty-vercel",
      version: "8.2.0",
      auth: "shopify-customer-account",
      appProxy: false
    });
  } catch (error) {
    return json(res, Number(error?.status || 500), { error: error?.message || "Request failed." });
  }
}
