import { applyCors } from "../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { deleteWarranty } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

    requireWarrantyAdmin(req);
    const result = await deleteWarranty(req.body || {});

    return json(res, 200, result);
  } catch (error) {
    return errorResponse(res, error, "Không thể xóa phiếu bảo hành.");
  }
}
