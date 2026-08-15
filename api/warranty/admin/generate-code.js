import { applyCors } from "../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { generateUniqueWarrantyNumber } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

    requireWarrantyAdmin(req);
    const warrantyNumber = await generateUniqueWarrantyNumber();

    return json(res, 200, { warrantyNumber });
  } catch (error) {
    return errorResponse(res, error, "Không thể tạo số bảo hành.");
  }
}
