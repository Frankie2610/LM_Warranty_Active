import { applyCors } from "../../../lib/cors.js";
import { requireWarrantyAdmin } from "../../../lib/auth.js";
import { errorResponse, json, methodNotAllowed } from "../../../lib/http.js";
import { lookupProduct } from "../../../lib/warranty-service.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

    requireWarrantyAdmin(req);
    const product = await lookupProduct(req.query?.sku);

    return json(res, 200, product);
  } catch (error) {
    return errorResponse(res, error, "Không thể tra cứu SKU.");
  }
}
