import { applyCors } from "../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { migrateLegacyData } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

    const user = requireWarrantyAdmin(req);
    const result = await migrateLegacyData(user.email);

    return json(res, 200, { success: true, ...result });
  } catch (error) {
    return errorResponse(res, error, "Không thể đồng bộ dữ liệu cũ.");
  }
}
