import { db } from "./firebase.js";
import {
  WARRANTY_MONTHS,
  detectBrand,
  normalizeEmail,
  normalizePhone,
  normalizeSku,
  normalizeWarranty,
  normalizeText,
  isValidFirebaseKey,
  randomWarrantyCode,
  safeKey,
  validateWarrantyInput
} from "./utils.js";
import { httpError } from "./http.js";

function nowIso() {
  return new Date().toISOString();
}

function addMonthsToDateOnly(dateString, months) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(dateString || "").trim()
  );

  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const add = Number(months || 0);

  if (!Number.isFinite(add)) return "";

  const targetMonthIndex = (month - 1) + add;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth =
    ((targetMonthIndex % 12) + 12) % 12;

  const maxDay =
    new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  const targetDay = Math.min(day, maxDay);

  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth + 1).padStart(2, "0"),
    String(targetDay).padStart(2, "0")
  ].join("-");
}


const SERVICE_STATUS_VALUES = new Set([
  "received",
  "diagnosing",
  "waiting_parts",
  "repairing",
  "completed",
  "rejected"
]);

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function trimWithLimit(value, max, label) {
  const text = normalizeText(value);
  if (text.length > max) {
    throw httpError(400, `${label} quá dài. Tối đa ${max} ký tự.`);
  }
  return text;
}

function normalizeServiceEntry(entry = {}, id = "") {
  return {
    id: id || entry.id || entry.entry_id || "",
    received_date: entry.received_date || "",
    issue: entry.issue || "",
    status: SERVICE_STATUS_VALUES.has(entry.status) ? entry.status : "received",
    completed_date: entry.completed_date || "",
    handover_date: entry.handover_date || "",
    repair_action: entry.repair_action || "",
    technician: entry.technician || "",
    note: entry.note || "",
    created_at: entry.created_at || "",
    created_by: entry.created_by || "",
    updated_at: entry.updated_at || "",
    updated_by: entry.updated_by || ""
  };
}

function serviceEntriesFromObject(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  const entries = Object.entries(raw).map(([id, value]) =>
    normalizeServiceEntry(value || {}, id)
  );

  entries.sort((a, b) => {
    const aa = String(a.received_date || a.created_at || "");
    const bb = String(b.received_date || b.created_at || "");
    if (aa !== bb) return bb.localeCompare(aa);
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });

  return entries;
}

function serviceSummary(raw = {}) {
  const entries = serviceEntriesFromObject(raw);
  const last = entries[0] || null;
  const completed = entries.filter((x) => x.status === "completed").length;
  const open = entries.filter(
    (x) => x.status !== "completed" && x.status !== "rejected"
  ).length;

  return {
    service_history_count: entries.length,
    service_open_count: open,
    service_completed_count: completed,
    last_service_date: last?.received_date || "",
    last_service_status: last?.status || "",
    last_service_issue: last?.issue || ""
  };
}

function validateServiceInput(body = {}) {
  const warrantyNumber = normalizeWarranty(body.warrantyNumber || body.code);
  const entryId = normalizeText(body.entryId);
  const receivedDate = normalizeText(body.receivedDate);
  const status = normalizeText(body.status || "received");
  const issue = trimWithLimit(body.issue, 700, "Lỗi kỹ thuật / tình trạng");
  const completedDate = normalizeText(body.completedDate);
  const handoverDate = normalizeText(body.handoverDate);
  const repairAction = trimWithLimit(body.repairAction, 2500, "Hướng xử lý");
  const technician = trimWithLimit(body.technician, 160, "Kỹ thuật viên");
  const note = trimWithLimit(body.note, 2500, "Ghi chú");

  if (!warrantyNumber || warrantyNumber.length < 6) {
    throw httpError(400, "Số bảo hành chưa hợp lệ.");
  }
  if (!isValidFirebaseKey(warrantyNumber)) {
    throw httpError(400, "Số bảo hành không được chứa . # $ / [ ].");
  }
  if (entryId && !isValidFirebaseKey(entryId)) {
    throw httpError(400, "Mã lịch sử bảo hành không hợp lệ.");
  }
  if (!isDateOnly(receivedDate)) {
    throw httpError(400, "Ngày tiếp nhận bảo hành chưa hợp lệ.");
  }
  if (!issue || issue.length < 2) {
    throw httpError(400, "Vui lòng nhập lỗi kỹ thuật / tình trạng tiếp nhận.");
  }
  if (!SERVICE_STATUS_VALUES.has(status)) {
    throw httpError(400, "Trạng thái xử lý chưa hợp lệ.");
  }
  if (completedDate && !isDateOnly(completedDate)) {
    throw httpError(400, "Ngày sửa xong chưa hợp lệ.");
  }
  if (handoverDate && !isDateOnly(handoverDate)) {
    throw httpError(400, "Ngày bàn giao khách chưa hợp lệ.");
  }
  if (status === "completed" && !completedDate) {
    throw httpError(400, "Phiếu đã hoàn tất cần có ngày sửa xong.");
  }
  if (completedDate && completedDate < receivedDate) {
    throw httpError(400, "Ngày sửa xong không thể trước ngày tiếp nhận.");
  }
  if (handoverDate && handoverDate < (completedDate || receivedDate)) {
    throw httpError(
      400,
      completedDate
        ? "Ngày bàn giao khách không thể trước ngày sửa xong."
        : "Ngày bàn giao khách không thể trước ngày tiếp nhận."
    );
  }

  return {
    warrantyNumber,
    entryId,
    receivedDate,
    issue,
    status,
    completedDate,
    handoverDate,
    repairAction,
    technician,
    note
  };
}

function buildServiceSummaryUpdates(warrantyRecord, rawHistory) {
  const summary = serviceSummary(rawHistory);
  const updates = {
    [`warranties/${warrantyRecord.warranty_number}/service_history_count`]: summary.service_history_count,
    [`warranties/${warrantyRecord.warranty_number}/service_open_count`]: summary.service_open_count,
    [`warranties/${warrantyRecord.warranty_number}/service_completed_count`]: summary.service_completed_count,
    [`warranties/${warrantyRecord.warranty_number}/last_service_date`]: summary.last_service_date,
    [`warranties/${warrantyRecord.warranty_number}/last_service_status`]: summary.last_service_status,
    [`warranties/${warrantyRecord.warranty_number}/last_service_issue`]: summary.last_service_issue,

    // Alias fields kept for backward/forward compatibility with older UI experiments.
    [`warranties/${warrantyRecord.warranty_number}/service_count`]: summary.service_history_count,
    [`warranties/${warrantyRecord.warranty_number}/service_last_date`]: summary.last_service_date,
    [`warranties/${warrantyRecord.warranty_number}/service_last_status`]: summary.last_service_status
  };

  if (warrantyRecord.customer_id && warrantyRecord.purchase_id) {
    const purchaseBase =
      `customers/${warrantyRecord.customer_id}/purchases/${warrantyRecord.purchase_id}`;

    updates[`${purchaseBase}/service_history_count`] = summary.service_history_count;
    updates[`${purchaseBase}/service_open_count`] = summary.service_open_count;
    updates[`${purchaseBase}/service_completed_count`] = summary.service_completed_count;
    updates[`${purchaseBase}/last_service_date`] = summary.last_service_date;
    updates[`${purchaseBase}/last_service_status`] = summary.last_service_status;
    updates[`${purchaseBase}/last_service_issue`] = summary.last_service_issue;
  }

  return { updates, summary };
}

function normalizeRecord(record = {}, key = "") {
  const summary = serviceSummary(record.service_history || {});

  return {
    warranty_number: record.warranty_number || key,
    customer_id: record.customer_id || "",
    purchase_id: record.purchase_id || "",
    customer_name: record.customer_name || "",
    customer_phone: record.customer_phone || "",
    customer_email: record.customer_email || "",
    sku: normalizeSku(record.sku || ""),
    brand: record.brand || detectBrand(record.sku || ""),
    product_name: record.product_name || "",
    purchase_date: record.purchase_date || "",
    purchase_location: record.purchase_location || "",
    warranty_period: Number(record.warranty_period || WARRANTY_MONTHS),
    status: record.status || record.warranty_status || "pending",
    created_at: record.created_at || "",
    created_by: record.created_by || "",
    updated_at: record.updated_at || "",
    updated_by: record.updated_by || "",
    activated_at: record.activated_at || "",
    activation_method: record.activation_method || "",
    verified_email: record.verified_email || "",
    firebase_uid: record.firebase_uid || "",
    service_history_count: Number(
      record.service_history_count ?? record.service_count ?? summary.service_history_count
    ),
    service_open_count: Number(record.service_open_count ?? summary.service_open_count),
    service_completed_count: Number(
      record.service_completed_count ?? summary.service_completed_count
    ),
    last_service_date:
      record.last_service_date || record.service_last_date || summary.last_service_date,
    last_service_status:
      record.last_service_status || record.service_last_status || summary.last_service_status,
    last_service_issue: record.last_service_issue || summary.last_service_issue
  };
}

export async function listWarranties() {
  const snap = await db.ref("warranties").get();
  if (!snap.exists()) return [];

  const data = snap.val() || {};
  const rows = Object.entries(data).map(([key, value]) =>
    normalizeRecord(value || {}, key)
  );

  rows.sort((a, b) => {
    const aa = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bb - aa;
  });

  return rows;
}

async function findExistingCustomer(email, phone) {
  const [emailSnap, phoneSnap] = await Promise.all([
    db.ref(`customer_lookup/by_email/${safeKey(email)}`).get(),
    db.ref(`customer_lookup/by_phone/${safeKey(phone)}`).get()
  ]);

  const indexed =
    (emailSnap.exists() && emailSnap.val()) ||
    (phoneSnap.exists() && phoneSnap.val());

  if (indexed) return String(indexed);

  const customersSnap = await db.ref("customers").get();
  if (!customersSnap.exists()) return null;

  const customers = customersSnap.val() || {};

  for (const [customerId, customer] of Object.entries(customers)) {
    if (
      normalizeEmail(customer?.email) === email ||
      normalizePhone(customer?.phone) === phone
    ) {
      return customerId;
    }
  }

  return null;
}

export async function generateUniqueWarrantyNumber() {
  for (let i = 0; i < 15; i++) {
    const code = randomWarrantyCode();
    const snap = await db.ref(`warranties/${code}`).get();
    if (!snap.exists()) return code;
  }

  return `LM-${Date.now().toString(36).toUpperCase()}`;
}

export async function createWarranty(body, adminEmail) {
  const data = validateWarrantyInput(body);

  const duplicate = await db.ref(`warranties/${data.warrantyNumber}`).get();
  if (duplicate.exists()) throw httpError(409, "Số bảo hành này đã tồn tại.");

  let customerId = await findExistingCustomer(data.email, data.phone);
  if (!customerId) customerId = db.ref("customers").push().key;

  const purchaseId = db.ref(`customers/${customerId}/purchases`).push().key;
  const createdAt = nowIso();

  const purchase = {
    sku: data.sku,
    brand: data.brand,
    product_name: data.productName,
    purchase_date: data.purchaseDate,
    purchase_location: data.purchaseLocation,
    warranty_number: data.warrantyNumber,
    warranty_period: WARRANTY_MONTHS,
    warranty_status: "pending",
    repair_status: "not_repaired",
    repair_notes: "",
    created_at: createdAt,
    created_by: adminEmail
  };

  const warranty = {
    warranty_number: data.warrantyNumber,
    customer_id: customerId,
    purchase_id: purchaseId,
    customer_name: data.customerName,
    customer_phone: data.phone,
    customer_email: data.email,
    sku: data.sku,
    brand: data.brand,
    product_name: data.productName,
    purchase_date: data.purchaseDate,
    purchase_location: data.purchaseLocation,
    warranty_period: WARRANTY_MONTHS,
    status: "pending",
    created_at: createdAt,
    created_by: adminEmail
  };

  await db.ref().update({
    [`customers/${customerId}/name`]: data.customerName,
    [`customers/${customerId}/phone`]: data.phone,
    [`customers/${customerId}/email`]: data.email,
    [`customers/${customerId}/updated_at`]: createdAt,
    [`customers/${customerId}/purchases/${purchaseId}`]: purchase,
    [`warranties/${data.warrantyNumber}`]: warranty,
    [`customer_lookup/by_email/${safeKey(data.email)}`]: customerId,
    [`customer_lookup/by_phone/${safeKey(data.phone)}`]: customerId
  });

  return normalizeRecord(warranty, data.warrantyNumber);
}

export async function updateWarranty(body, adminEmail) {
  const originalCode = normalizeWarranty(body?.originalCode);
  if (!originalCode) throw httpError(400, "Thiếu số bảo hành gốc.");

  const currentSnap = await db.ref(`warranties/${originalCode}`).get();
  if (!currentSnap.exists()) throw httpError(404, "Không tìm thấy phiếu bảo hành.");

  const currentRaw = currentSnap.val() || {};
  const current = normalizeRecord(currentRaw, originalCode);
  const data = validateWarrantyInput(body);

  if (!current.customer_id || !current.purchase_id) {
    throw httpError(
      409,
      "Phiếu cũ chưa có customer_id/purchase_id. Hãy chạy Đồng bộ dữ liệu cũ trước."
    );
  }

  if (data.warrantyNumber !== originalCode) {
    const duplicate = await db.ref(`warranties/${data.warrantyNumber}`).get();
    if (duplicate.exists()) throw httpError(409, "Số bảo hành mới đã tồn tại.");
  }

  const updatedAt = nowIso();

  const updatedWarranty = {
    ...currentRaw,
    warranty_number: data.warrantyNumber,
    customer_name: data.customerName,
    customer_phone: data.phone,
    customer_email: data.email,
    sku: data.sku,
    brand: data.brand,
    product_name: data.productName,
    purchase_date: data.purchaseDate,
    purchase_location: data.purchaseLocation,
    warranty_period: WARRANTY_MONTHS,
    updated_at: updatedAt,
    updated_by: adminEmail
  };

  const updates = {};
  updates[`warranties/${data.warrantyNumber}`] = updatedWarranty;

  if (data.warrantyNumber !== originalCode) {
    updates[`warranties/${originalCode}`] = null;
  }

  const purchaseBase = `customers/${current.customer_id}/purchases/${current.purchase_id}`;

  updates[`${purchaseBase}/sku`] = data.sku;
  updates[`${purchaseBase}/brand`] = data.brand;
  updates[`${purchaseBase}/product_name`] = data.productName;
  updates[`${purchaseBase}/purchase_date`] = data.purchaseDate;
  updates[`${purchaseBase}/purchase_location`] = data.purchaseLocation;
  updates[`${purchaseBase}/warranty_number`] = data.warrantyNumber;
  updates[`${purchaseBase}/warranty_period`] = WARRANTY_MONTHS;
  updates[`${purchaseBase}/updated_at`] = updatedAt;
  updates[`${purchaseBase}/updated_by`] = adminEmail;

  updates[`customers/${current.customer_id}/name`] = data.customerName;
  updates[`customers/${current.customer_id}/phone`] = data.phone;
  updates[`customers/${current.customer_id}/email`] = data.email;
  updates[`customers/${current.customer_id}/updated_at`] = updatedAt;

  const oldEmail = normalizeEmail(current.customer_email);
  const oldPhone = normalizePhone(current.customer_phone);

  if (oldEmail && oldEmail !== data.email) {
    updates[`customer_lookup/by_email/${safeKey(oldEmail)}`] = null;
  }
  if (oldPhone && oldPhone !== data.phone) {
    updates[`customer_lookup/by_phone/${safeKey(oldPhone)}`] = null;
  }

  updates[`customer_lookup/by_email/${safeKey(data.email)}`] = current.customer_id;
  updates[`customer_lookup/by_phone/${safeKey(data.phone)}`] = current.customer_id;

  await db.ref().update(updates);

  return normalizeRecord(updatedWarranty, data.warrantyNumber);
}

export async function deleteWarranty(body) {
  const code = normalizeWarranty(body?.warrantyNumber);
  if (!code) throw httpError(400, "Thiếu số bảo hành.");

  const snap = await db.ref(`warranties/${code}`).get();
  if (!snap.exists()) throw httpError(404, "Không tìm thấy phiếu bảo hành.");

  const record = normalizeRecord(snap.val() || {}, code);
  const updates = { [`warranties/${code}`]: null };

  if (record.customer_id && record.purchase_id) {
    updates[`customers/${record.customer_id}/purchases/${record.purchase_id}`] = null;
  }

  await db.ref().update(updates);
  return { deleted: true, warrantyNumber: code };
}

export async function lookupProduct(rawSku) {
  const sku = normalizeSku(rawSku);
  const brand = detectBrand(sku);

  if (!sku) return { sku: "", brand: "", productName: "", warrantyPeriod: WARRANTY_MONTHS };

  const key = sku.replace(/[.#$/\[\]]/g, "_");
  const snap = await db.ref(`products/${key}`).get();

  let productName = "";
  if (snap.exists()) {
    const product = snap.val() || {};
    productName = product.product_name || product.name || product.title || "";
  }

  return { sku, brand, productName, warrantyPeriod: WARRANTY_MONTHS };
}

export async function publicLookup(rawCode) {
  const code = normalizeWarranty(rawCode);
  if (!code || code.length < 6) throw httpError(400, "Số bảo hành chưa hợp lệ.");

  const snap = await db.ref(`warranties/${code}`).get();

  if (!snap.exists()) return { exists: false };

  const record = normalizeRecord(snap.val() || {}, code);

  return {
    exists: true,
    warrantyNumber: code,
    status: record.status,
    sku: record.sku,
    brand: record.brand,
    productName: record.product_name,
    warrantyPeriod: WARRANTY_MONTHS
  };
}

export async function activateWarranty(body, verifiedUser) {
  const warrantyNumber = normalizeWarranty(body?.warrantyNumber);
  const customerName = String(body?.customerName || "").trim();
  const phone = normalizePhone(body?.phone);
  const formEmail = normalizeEmail(body?.email);
  const trustedEmail = normalizeEmail(verifiedUser.email);

  if (!warrantyNumber || warrantyNumber.length < 6) throw httpError(400, "Số bảo hành chưa hợp lệ.");
  if (customerName.length < 2) throw httpError(400, "Họ và tên chưa hợp lệ.");
  if (phone.length < 9 || phone.length > 15) throw httpError(400, "Số điện thoại chưa hợp lệ.");
  if (!formEmail || formEmail !== trustedEmail) {
    throw httpError(403, "Email trên biểu mẫu không trùng email đã xác thực.");
  }

  const warrantyRef = db.ref(`warranties/${warrantyNumber}`);
  const snap = await warrantyRef.get();

  if (!snap.exists()) throw httpError(404, "Số bảo hành không tồn tại.");

  const record = normalizeRecord(snap.val() || {}, warrantyNumber);

  if (record.status === "activated") {
    throw httpError(409, "Số bảo hành đã được kích hoạt trước đó.");
  }

  const storedEmail = normalizeEmail(record.customer_email);

  if (storedEmail && storedEmail !== trustedEmail) {
    throw httpError(403, "Email xác thực không trùng hồ sơ bảo hành.");
  }

  if (!record.customer_id || !record.purchase_id) {
    throw httpError(
      409,
      "Phiếu cũ chưa được đồng bộ dữ liệu. Vui lòng liên hệ bộ phận bảo hành."
    );
  }

  const activatedAt = nowIso();
  const purchaseBase = `customers/${record.customer_id}/purchases/${record.purchase_id}`;

  await db.ref().update({
    [`warranties/${warrantyNumber}/status`]: "activated",
    [`warranties/${warrantyNumber}/customer_name`]: customerName,
    [`warranties/${warrantyNumber}/customer_phone`]: phone,
    [`warranties/${warrantyNumber}/customer_email`]: trustedEmail,
    [`warranties/${warrantyNumber}/activated_at`]: activatedAt,
    [`warranties/${warrantyNumber}/activation_method`]: "firebase_email_link",
    [`warranties/${warrantyNumber}/verified_email`]: trustedEmail,
    [`warranties/${warrantyNumber}/firebase_uid`]: verifiedUser.uid,

    [`customers/${record.customer_id}/name`]: customerName,
    [`customers/${record.customer_id}/phone`]: phone,
    [`customers/${record.customer_id}/email`]: trustedEmail,
    [`customers/${record.customer_id}/updated_at`]: activatedAt,

    [`${purchaseBase}/warranty_status`]: "activated",
    [`${purchaseBase}/activated_at`]: activatedAt,
    [`${purchaseBase}/activation_method`]: "firebase_email_link",
    [`${purchaseBase}/verified_email`]: trustedEmail,
    [`${purchaseBase}/firebase_uid`]: verifiedUser.uid
  });

  return {
    success: true,
    warrantyNumber,
    status: "activated"
  };
}


export async function listWarrantyHistory(rawCode) {
  const warrantyNumber = normalizeWarranty(rawCode);

  if (!warrantyNumber || warrantyNumber.length < 6) {
    throw httpError(400, "Số bảo hành chưa hợp lệ.");
  }
  if (!isValidFirebaseKey(warrantyNumber)) {
    throw httpError(400, "Số bảo hành không được chứa . # $ / [ ].");
  }

  const warrantySnap = await db.ref(`warranties/${warrantyNumber}`).get();
  if (!warrantySnap.exists()) {
    throw httpError(404, "Không tìm thấy phiếu bảo hành.");
  }

  const raw = warrantySnap.val() || {};
  const history = serviceEntriesFromObject(raw.service_history || {});

  return {
    warrantyNumber,
    history,
    summary: serviceSummary(raw.service_history || {})
  };
}

export async function saveWarrantyHistory(body, adminEmail) {
  const data = validateServiceInput(body);
  const warrantyRef = db.ref(`warranties/${data.warrantyNumber}`);
  const warrantySnap = await warrantyRef.get();

  if (!warrantySnap.exists()) {
    throw httpError(404, "Không tìm thấy phiếu bảo hành.");
  }

  const warrantyRaw = warrantySnap.val() || {};
  const warrantyRecord = normalizeRecord(warrantyRaw, data.warrantyNumber);
  const currentHistory =
    warrantyRaw.service_history && typeof warrantyRaw.service_history === "object"
      ? { ...warrantyRaw.service_history }
      : {};

  const entryId = data.entryId || warrantyRef.child("service_history").push().key;
  if (!entryId || !isValidFirebaseKey(entryId)) {
    throw httpError(500, "Không thể tạo mã lịch sử bảo hành.");
  }

  if (data.entryId && !currentHistory[entryId]) {
    throw httpError(404, "Không tìm thấy lần bảo hành cần chỉnh sửa.");
  }

  const now = nowIso();
  const existing = currentHistory[entryId] || {};
  const entry = {
    received_date: data.receivedDate,
    issue: data.issue,
    status: data.status,
    completed_date: data.completedDate,
    handover_date: data.handoverDate,
    repair_action: data.repairAction,
    technician: data.technician,
    note: data.note,
    created_at: existing.created_at || now,
    created_by: existing.created_by || adminEmail,
    updated_at: now,
    updated_by: adminEmail
  };

  currentHistory[entryId] = entry;
  const { updates: summaryUpdates, summary } = buildServiceSummaryUpdates(
    warrantyRecord,
    currentHistory
  );

  await db.ref().update({
    [`warranties/${data.warrantyNumber}/service_history/${entryId}`]: entry,
    [`warranties/${data.warrantyNumber}/updated_at`]: now,
    [`warranties/${data.warrantyNumber}/updated_by`]: adminEmail,
    ...summaryUpdates
  });

  return {
    success: true,
    warrantyNumber: data.warrantyNumber,
    entry: normalizeServiceEntry(entry, entryId),
    summary
  };
}

export async function deleteWarrantyHistory(body, adminEmail) {
  const warrantyNumber = normalizeWarranty(body?.warrantyNumber || body?.code);
  const entryId = normalizeText(body?.entryId);

  if (!warrantyNumber || warrantyNumber.length < 6) {
    throw httpError(400, "Số bảo hành chưa hợp lệ.");
  }
  if (!isValidFirebaseKey(warrantyNumber)) {
    throw httpError(400, "Số bảo hành không được chứa . # $ / [ ].");
  }
  if (!entryId || !isValidFirebaseKey(entryId)) {
    throw httpError(400, "Mã lịch sử bảo hành chưa hợp lệ.");
  }

  const warrantySnap = await db.ref(`warranties/${warrantyNumber}`).get();
  if (!warrantySnap.exists()) {
    throw httpError(404, "Không tìm thấy phiếu bảo hành.");
  }

  const warrantyRaw = warrantySnap.val() || {};
  const warrantyRecord = normalizeRecord(warrantyRaw, warrantyNumber);
  const currentHistory =
    warrantyRaw.service_history && typeof warrantyRaw.service_history === "object"
      ? { ...warrantyRaw.service_history }
      : {};

  if (!currentHistory[entryId]) {
    throw httpError(404, "Không tìm thấy lần bảo hành cần xóa.");
  }

  delete currentHistory[entryId];
  const now = nowIso();
  const { updates: summaryUpdates, summary } = buildServiceSummaryUpdates(
    warrantyRecord,
    currentHistory
  );

  await db.ref().update({
    [`warranties/${warrantyNumber}/service_history/${entryId}`]: null,
    [`warranties/${warrantyNumber}/updated_at`]: now,
    [`warranties/${warrantyNumber}/updated_by`]: adminEmail,
    ...summaryUpdates
  });

  return {
    success: true,
    deleted: true,
    warrantyNumber,
    entryId,
    summary
  };
}

export async function migrateLegacyData(adminEmail) {
  const customersSnap = await db.ref("customers").get();

  if (!customersSnap.exists()) {
    return { created: 0, skipped: 0, customersIndexed: 0 };
  }

  const customers = customersSnap.val() || {};
  const existingSnap = await db.ref("warranties").get();
  const existing = existingSnap.exists() ? existingSnap.val() || {} : {};

  const updates = {};
  let created = 0;
  let skipped = 0;
  let customersIndexed = 0;
  const migratedAt = nowIso();

  for (const [customerId, customer] of Object.entries(customers)) {
    const email = normalizeEmail(customer?.email);
    const phone = normalizePhone(customer?.phone);

    if (email) {
      updates[`customer_lookup/by_email/${safeKey(email)}`] = customerId;
      customersIndexed++;
    }
    if (phone) {
      updates[`customer_lookup/by_phone/${safeKey(phone)}`] = customerId;
    }

    const purchases = customer?.purchases || {};

    for (const [purchaseId, purchase] of Object.entries(purchases)) {
      const code = normalizeWarranty(purchase?.warranty_number);
      if (!code) continue;

      if (existing[code]) {
        skipped++;
        continue;
      }

      const sku = normalizeSku(purchase?.sku || "");

      updates[`warranties/${code}`] = {
        warranty_number: code,
        customer_id: customerId,
        purchase_id: purchaseId,
        customer_name: customer?.name || "",
        customer_phone: phone,
        customer_email: email,
        sku,
        brand: purchase?.brand || detectBrand(sku),
        product_name: purchase?.product_name || "",
        purchase_date: purchase?.purchase_date || "",
        purchase_location: purchase?.purchase_location || "",
        warranty_period: Number(purchase?.warranty_period || WARRANTY_MONTHS),
        status: purchase?.warranty_status || "pending",
        created_at: purchase?.created_at || migratedAt,
        created_by: purchase?.created_by || adminEmail,
        migrated_at: migratedAt
      };

      created++;
    }
  }

  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }

  return { created, skipped, customersIndexed };
}

export async function activateWarrantyByPurchaseMatch(body) {
  const brand = String(body?.brand || "").trim().toUpperCase();
  const phone = normalizePhone(body?.phone);
  const purchaseDate = String(body?.purchaseDate || "").trim();
  const shopifyEmail = normalizeEmail(body?.shopifyEmail);

  const allowedBrands = new Set([
    "GUESS",
    "TED BAKER",
    "PHILIPP PLEIN",
    "ADIDAS",
    "FURLA",
    "LOCMAN ITALY",
    "VERSUS BY VERSACE",
    "MISSONI"
  ]);

  if (!allowedBrands.has(brand)) {
    throw httpError(400, "Thương hiệu chưa hợp lệ.");
  }

  if (phone.length < 9 || phone.length > 15) {
    throw httpError(400, "Số điện thoại chưa hợp lệ.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw httpError(400, "Ngày mua chưa hợp lệ.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shopifyEmail)) {
    throw httpError(400, "Không xác định được email tài khoản Shopify.");
  }

  let customerId = null;

  const phoneLookup = await db.ref(
    `customer_lookup/by_phone/${safeKey(phone)}`
  ).get();

  if (phoneLookup.exists()) {
    customerId = String(phoneLookup.val() || "");
  }

  // Legacy fallback when customer_lookup hasn't been generated yet.
  if (!customerId) {
    const customersSnap = await db.ref("customers").get();
    const customers = customersSnap.exists() ? customersSnap.val() || {} : {};

    for (const [id, customer] of Object.entries(customers)) {
      if (normalizePhone(customer?.phone) === phone) {
        customerId = id;
        break;
      }
    }
  }

  if (!customerId) {
    throw httpError(
      404,
      "Không tìm thấy phiếu bảo hành phù hợp với thông tin đã cung cấp."
    );
  }

  const customerSnap = await db.ref(`customers/${customerId}`).get();

  if (!customerSnap.exists()) {
    throw httpError(
      404,
      "Không tìm thấy phiếu bảo hành phù hợp với thông tin đã cung cấp."
    );
  }

  const customer = customerSnap.val() || {};
  const storedCustomerEmail = normalizeEmail(customer.email);

  // Email is one of the required matching factors.
  if (storedCustomerEmail && storedCustomerEmail !== shopifyEmail) {
    throw httpError(
      404,
      "Không tìm thấy phiếu bảo hành phù hợp với thông tin đã cung cấp."
    );
  }

  const purchases = customer.purchases || {};
  const matches = [];

  for (const [purchaseId, purchase] of Object.entries(purchases)) {
    const sku = normalizeSku(purchase?.sku || "");
    const purchaseBrand =
      String(purchase?.brand || detectBrand(sku) || "").trim().toUpperCase();

    const status = String(purchase?.warranty_status || "pending").toLowerCase();
    const warrantyNumber = normalizeWarranty(purchase?.warranty_number);

    if (
      purchaseBrand === brand &&
      String(purchase?.purchase_date || "") === purchaseDate &&
      warrantyNumber
    ) {
      matches.push({
        purchaseId,
        purchase,
        sku,
        status,
        warrantyNumber
      });
    }
  }

  if (matches.length === 0) {
    throw httpError(
      404,
      "Không tìm thấy phiếu bảo hành phù hợp với thông tin đã cung cấp."
    );
  }

  if (matches.length > 1) {
    throw httpError(
      409,
      "Có nhiều phiếu trùng thông tin. Vui lòng liên hệ bộ phận bảo hành để được hỗ trợ."
    );
  }

  const match = matches[0];
  const warrantyNumber = match.warrantyNumber;
  const warrantyRef = db.ref(`warranties/${warrantyNumber}`);
  const warrantySnap = await warrantyRef.get();

  const warrantyRaw = warrantySnap.exists() ? warrantySnap.val() || {} : null;
  let warrantyRecord = warrantyRaw
    ? normalizeRecord(warrantyRaw, warrantyNumber)
    : null;

  const purchaseAlreadyActivated = match.status === "activated";
  const warrantyAlreadyActivated =
    String(warrantyRecord?.status || "").toLowerCase() === "activated";

  if (purchaseAlreadyActivated || warrantyAlreadyActivated) {
    const activatedAt =
      warrantyRecord?.activated_at ||
      match.purchase?.activated_at ||
      "";

    // Repair a stale legacy purchase record if the warranty index is already activated.
    if (!purchaseAlreadyActivated && warrantyAlreadyActivated) {
      const purchaseBase =
        `customers/${customerId}/purchases/${match.purchaseId}`;

      await db.ref().update({
        [`${purchaseBase}/warranty_status`]: "activated",
        [`${purchaseBase}/activated_at`]: activatedAt || nowIso(),
        [`customers/${customerId}/updated_at`]: nowIso()
      });
    }

    const warrantyPeriod = Number(
      warrantyRecord?.warranty_period ||
      match.purchase?.warranty_period ||
      WARRANTY_MONTHS
    );

    const warrantyExpiresOn = addMonthsToDateOnly(
      purchaseDate,
      warrantyPeriod
    );

    return {
      success: true,
      alreadyActivated: true,
      warrantyNumber,
      status: "activated",
      activatedAt,
      brand,
      sku: match.sku,
      productName:
        warrantyRecord?.product_name ||
        match.purchase?.product_name ||
        "",
      purchaseDate,
      warrantyPeriod,
      warrantyExpiresOn
    };
  }

  // If legacy data hasn't been indexed yet, create the warranty index now.
  if (!warrantyRecord) {
    warrantyRecord = {
      warranty_number: warrantyNumber,
      customer_id: customerId,
      purchase_id: match.purchaseId,
      customer_name: customer?.name || "",
      customer_phone: phone,
      customer_email: shopifyEmail,
      sku: match.sku,
      brand,
      product_name: match.purchase?.product_name || "",
      purchase_date: purchaseDate,
      purchase_location: match.purchase?.purchase_location || "",
      warranty_period: Number(
        match.purchase?.warranty_period || WARRANTY_MONTHS
      ),
      status: "pending",
      created_at: match.purchase?.created_at || nowIso(),
      created_by: match.purchase?.created_by || "legacy"
    };
  }

  const activatedAt = nowIso();
  const purchaseBase =
    `customers/${customerId}/purchases/${match.purchaseId}`;

  const updates = {
    [`customers/${customerId}/email`]: shopifyEmail,
    [`customers/${customerId}/updated_at`]: activatedAt,
    [`customer_lookup/by_email/${safeKey(shopifyEmail)}`]: customerId,
    [`customer_lookup/by_phone/${safeKey(phone)}`]: customerId,

    [`${purchaseBase}/brand`]: brand,
    [`${purchaseBase}/warranty_status`]: "activated",
    [`${purchaseBase}/activated_at`]: activatedAt,
    [`${purchaseBase}/activation_method`]:
      "shopify_customer_account_otp_ui_gate",
    [`${purchaseBase}/verified_email`]: shopifyEmail,

    [`warranties/${warrantyNumber}`]: {
      ...(warrantyRaw || warrantyRecord),
      customer_id: customerId,
      purchase_id: match.purchaseId,
      customer_phone: phone,
      customer_email: shopifyEmail,
      sku: match.sku,
      brand,
      purchase_date: purchaseDate,
      status: "activated",
      activated_at: activatedAt,
      activation_method: "shopify_customer_account_otp_ui_gate",
      verified_email: shopifyEmail
    }
  };

  await db.ref().update(updates);

  const warrantyPeriod = Number(
    warrantyRecord?.warranty_period ||
    match.purchase?.warranty_period ||
    WARRANTY_MONTHS
  );

  const warrantyExpiresOn = addMonthsToDateOnly(
    purchaseDate,
    warrantyPeriod
  );

  return {
    success: true,
    alreadyActivated: false,
    warrantyNumber,
    status: "activated",
    activatedAt,
    brand,
    sku: match.sku,
    productName: match.purchase?.product_name || "",
    purchaseDate,
    warrantyPeriod,
    warrantyExpiresOn
  };
}

