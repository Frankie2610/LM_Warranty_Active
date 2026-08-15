import { applyCors } from "../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { createWarranty } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

    const user = requireWarrantyAdmin(req);
    const warranty = await createWarranty(req.body || {}, user.email);

    return json(res, 201, { success: true, warranty });
  } catch (error) {
    return errorResponse(res, error, "Không thể tạo phiếu bảo hành.");
  }
}
