import { db } from "./firebase.js";
import {
  WARRANTY_MONTHS,
  detectBrand,
  normalizeEmail,
  normalizePhone,
  normalizeSku,
  normalizeWarranty,
  randomWarrantyCode,
  safeKey,
  validateWarrantyInput
} from "./utils.js";
import { httpError } from "./http.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeRecord(record = {}, key = "") {
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
    activated_at: record.activated_at || ""
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

  const current = normalizeRecord(currentSnap.val() || {}, originalCode);
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
    ...current,
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

  let warrantyRecord = warrantySnap.exists()
    ? normalizeRecord(warrantySnap.val() || {}, warrantyNumber)
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
      warrantyPeriod: Number(
        warrantyRecord?.warranty_period ||
        match.purchase?.warranty_period ||
        WARRANTY_MONTHS
      )
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
      ...warrantyRecord,
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

  return {
    success: true,
    alreadyActivated: false,
    warrantyNumber,
    status: "activated",
    activatedAt,
    brand,
    sku: match.sku,
    productName: match.purchase?.product_name || ""
  };
}

