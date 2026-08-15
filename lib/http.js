export function json(res, status, payload) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.status(status).json(payload);
}

export function methodNotAllowed(res, allowed = []) {
  if (allowed.length) res.setHeader("Allow", allowed.join(", "));
  return json(res, 405, { error: "Method not allowed." });
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

export function errorResponse(res, error, fallback = "Đã xảy ra lỗi.") {
  console.error(error);
  return json(
    res,
    Number(error?.status || 500),
    { error: error?.publicMessage || error?.message || fallback }
  );
}
