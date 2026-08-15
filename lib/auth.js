import crypto from "node:crypto";
import { httpError } from "./http.js";

function requiredAdminKey() {
  const value = String(process.env.WARRANTY_ADMIN_ACCESS_KEY || "").trim();

  if (!value || value.length < 32) {
    throw httpError(
      500,
      "WARRANTY_ADMIN_ACCESS_KEY chưa được cấu hình an toàn trên Vercel."
    );
  }

  return value;
}

function timingSafeEqualText(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

export function requireWarrantyAdmin(req) {
  const provided = String(
    req.headers["x-warranty-admin-key"] || ""
  ).trim();

  if (!provided) {
    throw httpError(401, "Thiếu thông tin xác thực quản trị.");
  }

  const expected = requiredAdminKey();

  if (!timingSafeEqualText(provided, expected)) {
    throw httpError(403, "Không có quyền truy cập quản trị bảo hành.");
  }

  const shopifyEmail = String(
    req.headers["x-shopify-customer-email"] || ""
  ).trim().toLowerCase();

  return {
    email: shopifyEmail || "shopify-admin",
    authMethod: "shopify_otp_liquid_bearer_key"
  };
}
