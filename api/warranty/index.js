import { json } from "../../lib/http.js";
import { applyCors } from "../../lib/cors.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    return json(res, 200, {
      ok: true,
      service: "lm-warranty-vercel",
      version: "6.0.0",
      auth: "firebase-email-link",
      appProxy: false
    });
  } catch (error) {
    return json(res, Number(error?.status || 500), { error: error?.message || "Request failed." });
  }
}
