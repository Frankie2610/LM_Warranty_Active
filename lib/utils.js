import crypto from "node:crypto";

export const WARRANTY_MONTHS = 24;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

export function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeWarranty(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeText(value) {
  return String(value || "").trim();
}

export function safeKey(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64url").replace(/=+$/g, "");
}

export function isValidFirebaseKey(value) {
  return Boolean(value) && !/[.#$/\[\]]/.test(value);
}

export function detectBrand(rawSku) {
  const sku = normalizeSku(rawSku);

  if (/^GW0/.test(sku)) return "GUESS";
  if (/^BKP/.test(sku)) return "TED BAKER";
  if (/^PW/.test(sku)) return "PHILIPP PLEIN";
  if (/^AO/.test(sku)) return "ADIDAS";
  if (/^WW/.test(sku)) return "FURLA";
  if (/^(?:D\d{3}[A-Z]|0\d{3}[A-Z])/.test(sku)) return "LOCMAN ITALY";
  if (/^VSP/.test(sku)) return "VERSUS BY VERSACE";
  if (/^MWY/.test(sku)) return "MISSONI";

  return "";
}

export function randomWarrantyCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(5);
  let token = "";

  for (let i = 0; i < bytes.length; i++) {
    token += alphabet[bytes[i] % alphabet.length];
  }

  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");

  return `LM-${yy}${mm}${dd}-${token}`;
}

export function validateWarrantyInput(body = {}) {
  const data = {
    customerName: normalizeName(body.customerName),
    phone: normalizePhone(body.phone),
    email: normalizeEmail(body.email),
    sku: normalizeSku(body.sku),
    productName: normalizeText(body.productName),
    purchaseDate: normalizeText(body.purchaseDate),
    purchaseLocation: normalizeText(body.purchaseLocation || "Khác"),
    warrantyNumber: normalizeWarranty(body.warrantyNumber),
    warrantyPeriod: WARRANTY_MONTHS
  };

  data.brand = detectBrand(data.sku);

  if (data.customerName.length < 2) throw validation("Vui lòng nhập đầy đủ họ và tên khách hàng.");
  if (data.phone.length < 9 || data.phone.length > 15) throw validation("Số điện thoại chưa hợp lệ.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw validation("Email chưa hợp lệ.");
  if (!data.sku) throw validation("Vui lòng nhập SKU sản phẩm.");
  if (!data.brand) throw validation("SKU chưa nhận diện được thương hiệu.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.purchaseDate)) throw validation("Ngày mua chưa hợp lệ.");
  if (!data.warrantyNumber || data.warrantyNumber.length < 6) throw validation("Số bảo hành chưa hợp lệ.");
  if (!isValidFirebaseKey(data.warrantyNumber)) throw validation("Số bảo hành không được chứa . # $ / [ ].");

  return data;
}

function validation(message) {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
}
