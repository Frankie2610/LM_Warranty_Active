import { applyCors } from "../../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../../lib/http.js";
import { listWarrantyHistory } from "../../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

    requireWarrantyAdmin(req);
    const result = await listWarrantyHistory(req.query?.code);

    return json(res, 200, result);
  } catch (error) {
    return errorResponse(res, error, "Không thể tải lịch sử bảo hành.");
  }
}
