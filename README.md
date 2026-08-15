# L&M Warranty V8.2 — Shopify OTP cho cả Admin và Khách

## Điểm thay đổi chính

Firebase Authentication đã được loại bỏ hoàn toàn khỏi browser.

Firebase chỉ còn:

```text
Realtime Database
        ↑
Firebase Admin SDK
        ↑
Vercel
```

Shopify Customer Account chịu trách nhiệm đăng nhập/passwordless verification
cho cả Admin và khách.

---

# Kiến trúc

## Admin

```text
/pages/warranty-admin
→ Shopify Customer Account
→ Shopify passwordless / OTP flow
→ Liquid có `customer`
→ Liquid kiểm tra tag `warranty-admin`
→ Liquid chỉ render Admin Access Key cho đúng Admin đã đăng nhập
→ browser gửi Admin Access Key đến Vercel
→ Vercel kiểm tra WARRANTY_ADMIN_ACCESS_KEY
→ Firebase Admin SDK
→ Realtime Database
```

## Khách

```text
Trang kích hoạt
→ Shopify Customer Account / OTP
→ Liquid có customer.email
→ khách chọn Brand
→ nhập Phone
→ nhập Purchase Date
→ Vercel match:
   Brand + Phone + Purchase Date + Shopify Email
→ phải có đúng 1 pending warranty
→ Activated
```

---

# 1. Firebase Authentication

KHÔNG CẦN BẬT.

Không còn:
- Firebase Email Link
- Firebase ID Token
- Firebase Auth user
- WARRANTY_ADMIN_EMAILS

Firebase vẫn cần Service Account vì Vercel dùng Firebase Admin SDK để truy cập
Realtime Database.

---

# 2. Firebase Admin SDK

Firebase Console:

```text
Project settings
→ Service accounts
→ Firebase Admin SDK
→ Generate new private key
```

KHÔNG upload JSON lên GitHub.

Vercel cần:

```text
FIREBASE_PROJECT_ID
warranty-active-7c65a

FIREBASE_DATABASE_URL
https://warranty-active-7c65a-default-rtdb.firebaseio.com

FIREBASE_CLIENT_EMAIL
<client_email từ JSON>

FIREBASE_PRIVATE_KEY
<private_key từ JSON>
```

---

# 3. Admin Access Key

Vì hiện không dùng Shopify App Proxy, Vercel không nhận được một signed Shopify
request để chứng minh customer ID.

V8 dùng một bearer key ngẫu nhiên chỉ được Liquid render sau khi Shopify customer
đã đăng nhập và có tag `warranty-admin`.

## Tạo key

Tạo chuỗi ngẫu nhiên tối thiểu 32 ký tự. Khuyến nghị 64 ký tự hex.

Ví dụ command trên máy:

```bash
openssl rand -hex 32
```

KHÔNG dùng chuỗi ví dụ trong tài liệu làm key production.

Giả sử key bạn tự tạo là:

```text
YOUR_RANDOM_64_CHAR_KEY
```

## Vercel

```text
WARRANTY_ADMIN_ACCESS_KEY
YOUR_RANDOM_64_CHAR_KEY
```

## Shopify Admin customer

Tài khoản Shopify dùng làm Warranty Admin cần 2 tags:

```text
warranty-admin
warranty-admin-key-YOUR_RANDOM_64_CHAR_KEY
```

Chỉ đúng tài khoản Admin mới được gắn các tag này.

Không commit key vào GitHub.

Backend dùng timing-safe comparison để kiểm tra key trước mọi Admin write.

Nếu nghi key bị lộ:
1. tạo key mới;
2. đổi Vercel `WARRANTY_ADMIN_ACCESS_KEY`;
3. đổi tag customer;
4. redeploy Vercel nếu Environment Variable mới cần deployment mới.

---

# 4. Vercel Environment Variables

```text
ALLOWED_ORIGINS
https://lmtimepiece.com,https://www.lmtimepiece.com

WARRANTY_ADMIN_ACCESS_KEY
<random key>

FIREBASE_PROJECT_ID
warranty-active-7c65a

FIREBASE_DATABASE_URL
https://warranty-active-7c65a-default-rtdb.firebaseio.com

FIREBASE_CLIENT_EMAIL
<service account client_email>

FIREBASE_PRIVATE_KEY
<service account private_key>
```

Không còn Shopify Client ID / Secret.

Không còn Firebase Auth configuration.

---

# 5. GitHub / Vercel backend

Push:

```text
api/
lib/
package.json
vercel.json
.gitignore
```

Không push:

```text
.env
service-account.json
Firebase private key
Admin Access Key
```

Deploy repo trên Vercel.

Health:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/warranty
```

---

# 6. Shopify Admin page

File:

```text
shopify/page.warranty-admin.liquid
```

Tìm:

```js
const API_BASE =
  'https://REPLACE-WITH-YOUR-VERCEL-DOMAIN.vercel.app/api/warranty';
```

đổi sang Vercel domain thật.

Paste vào:

```text
templates/page.warranty-admin.liquid
```

Luồng:

```text
Chưa login
→ XÁC THỰC TÀI KHOẢN SHOPIFY
→ Shopify passwordless/OTP
→ reload
```

Nếu login nhưng không có:

```text
warranty-admin
```

thì hiển thị:

```text
KHÔNG CÓ QUYỀN TRUY CẬP
```

Nếu có `warranty-admin` nhưng thiếu:

```text
warranty-admin-key-...
```

thì hiển thị lỗi cấu hình.

Đủ cả hai mới render Admin.

---

# 7. Admin API authorization

Mỗi request Admin gửi:

```text
X-Warranty-Admin-Key
X-Shopify-Customer-Email
```

Vercel bắt buộc `X-Warranty-Admin-Key` phải trùng:

```text
WARRANTY_ADMIN_ACCESS_KEY
```

Các route được bảo vệ:

```text
/admin/list
/admin/create
/admin/update
/admin/delete
/admin/generate-code
/admin/product
/admin/migrate
```

---

# 8. Customer activation

File:

```text
shopify/warranty-activation.liquid
```

Không dùng Firebase Auth.

Không nhập số bảo hành.

Sau Shopify login, form chỉ có:

```text
Brand
Phone
Purchase Date
```

Email được lấy từ:

```liquid
customer.email
```

Kích hoạt chỉ xảy ra khi có đúng một pending purchase thỏa:

```text
Brand
+
Phone
+
Purchase Date
+
Shopify customer email
```

Sau khi thành công mới hiển thị số bảo hành.

---

# 9. Security boundary

V8 an toàn hơn việc chỉ tin `customer.email` vì Admin API có thêm một bearer key
ngẫu nhiên không được render cho khách public.

Tuy nhiên đây vẫn KHÔNG tương đương App Proxy.

Shopify App Proxy có signed request và logged_in_customer_id nên Vercel có thể
cryptographically verify Shopify identity. Khi không có App Proxy, V8 dùng:

```text
Shopify login gate
+ Liquid tag
+ hidden-to-public bearer key
+ Vercel timing-safe key verification
+ CORS
```

Access key vẫn xuất hiện trong DevTools của đúng Admin đang đăng nhập, giống một
session credential. Vì vậy:
- chỉ dùng trên thiết bị Admin tin cậy;
- không chia sẻ key;
- rotate key nếu nghi bị lộ.

---

# 10. Realtime Database Rules

Sau khi toàn bộ Vercel flow đã chạy ổn:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

Browser không truy cập RTDB trực tiếp.

Firebase Admin SDK trên Vercel tiếp tục hoạt động.


## V8.2 Theme Check fix

Fixed Shopify `LiquidHTMLSyntaxError` around the edit form by replacing block-level
`div` wrappers nested inside `label` with inline `span` wrappers for
`.lmwa-suffix` and `.lmwa-code-field`.

Also updated stale Firebase Authentication wording in the Admin UI.


## V8.2 Shopify customer-tag fix

Admin security tag format is now:

```text
warranty-admin
warranty-admin-key-<64-char-lowercase-hex-key>
```

The same 64-character value after `warranty-admin-key-` must equal the Vercel
environment variable `WARRANTY_ADMIN_ACCESS_KEY`.

Use lowercase hex generated by:

```bash
openssl rand -hex 32
```

The old colon format `warranty-admin-key:...` is no longer used.
