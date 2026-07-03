// Phase 2 — emit HMAC-signed change notifications to Gurzu (spec §5.5 / §8).
//
// On a catalog change the merchant POSTs the affected product, IN ITS OWN SHAPE,
// to Gurzu's notify endpoint. Gurzu runs the SAME locked mapping on it and applies
// it. The body is signed with a shared secret; Gurzu verifies in constant time.
//
// This is best-effort: a notify failure (engine down, network) must NEVER fail the
// underlying store mutation — the manual re-sync is the self-heal (spec §8). We log
// and move on.
import crypto from "node:crypto";

export function sign(body, secret = process.env.HMAC_SECRET || "") {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// event = { type, product?, external_product_id? } — see buildEvent helpers below.
export async function notify(event) {
  const url = process.env.GURZU_NOTIFY_URL;
  if (!url) return { skipped: "no GURZU_NOTIFY_URL" };

  const body = JSON.stringify(event);
  const signature = sign(body);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": signature },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) console.warn(`[notify] ${event.type} -> HTTP ${res.status}`);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    // Engine unreachable is expected in dev — don't spam, just note once per call.
    console.warn(`[notify] ${event.type} -> not delivered (${err.name || err.message})`);
    return { ok: false, error: String(err.message || err) };
  }
}

// Fire-and-forget wrapper for use inside request handlers: never throws, never
// blocks the response on a slow engine.
export function notifyAsync(event) {
  Promise.resolve()
    .then(() => notify(event))
    .catch(() => {});
}
