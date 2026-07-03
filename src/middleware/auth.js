// Bearer-token auth. Two tokens:
//   READ_TOKEN  — shared with Gurzu at connect; gates the catalog read endpoint.
//   ADMIN_TOKEN — gates the manage (write) endpoints. This project's addition;
//                 not part of Gurzu's pull contract.
//
// Compared in constant time so a wrong token can't be discovered byte-by-byte
// via timing (same discipline the engine uses for the Phase-2 HMAC check).
import crypto from "node:crypto";

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual requires equal length; length itself is not secret here,
  // but we still avoid an early-exit length check leaking via the compare.
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function bearer(req) {
  const h = req.header("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export function requireReadToken(req, res, next) {
  const token = bearer(req);
  if (!token || !safeEqual(token, process.env.READ_TOKEN || "")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

export function requireAdminToken(req, res, next) {
  const token = bearer(req);
  if (!token || !safeEqual(token, process.env.ADMIN_TOKEN || "")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
