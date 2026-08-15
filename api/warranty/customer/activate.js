import { applyCors } from "../../../lib/cors.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { softRateLimit } from "../../../lib/rate-limit.js";
import { activateWarrantyByPurchaseMatch } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

    // Tighter limit because this endpoint matches customer purchase information.
    softRateLimit(req, {
      key: "customer-activate-match",
      max: 10,
      windowMs: 60_000
    });

    const result = await activateWarrantyByPurchaseMatch(req.body || {});
    return json(res, 200, result);
  } catch (error) {
    return errorResponse(
      res,
      error,
      "Không thể kích hoạt bảo hành với thông tin đã cung cấp."
    );
  }
}
