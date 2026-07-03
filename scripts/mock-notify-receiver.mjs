// Mock Gurzu notify endpoint — stands in for the (not-yet-built) engine so the
// merchant's Phase-2 notifications can be tested end-to-end.
//
// It does exactly what the spec says the engine does (§8):
//   • reads the RAW body, recomputes HMAC-SHA256 with the shared secret,
//   • verifies the X-Signature header in CONSTANT TIME, rejecting forgeries (401),
//   • classifies the embedding effect (content change → re-embed; price/qty → not),
//   • records the event so a test can assert what arrived (GET /_events).
//
// Run:  npm run notify:receiver   (listens on :8000, path /v1/integrations/custom-pull/notify)
import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";

const PORT = parseInt(process.env.NOTIFY_PORT || "8000", 10);
const SECRET = process.env.HMAC_SECRET || "demo_shared_hmac_secret_xyz789";
const PATH = "/v1/integrations/custom-pull/notify";

const events = []; // in-memory log for assertions

// Which events re-NULL the embedding (spec §8).
function embeddingEffect(type) {
  switch (type) {
    case "product.created": return "embed (new)";
    case "product.updated": return "re-embed (content/image changed)";
    case "variant.updated": return "no re-embed (price/qty only)";
    case "product.deleted": return "none (deactivate)";
    default: return "unknown";
  }
}

function verify(rawBody, signature) {
  const expected = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(signature || "", "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  // Test helper: dump what we've received.
  if (req.method === "GET" && req.url === "/_events") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ count: events.length, events }));
  }
  if (req.method === "POST" && req.url === "/_reset") {
    events.length = 0;
    res.writeHead(200); return res.end("ok");
  }

  if (req.method !== "POST" || req.url !== PATH) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }

  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const sig = req.headers["x-signature"];

    if (!verify(raw, sig)) {
      console.warn("[receiver] ✗ REJECTED forged/invalid signature");
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "bad_signature" }));
    }

    let event;
    try { event = JSON.parse(raw); }
    catch { res.writeHead(400); return res.end(JSON.stringify({ error: "bad_json" })); }

    const id = event.external_product_id || event.product?.sku_group || "?";
    const effect = embeddingEffect(event.type);
    events.push({ type: event.type, id, effect, at: Date.now() });
    console.log(`[receiver] ✓ ${event.type}  id=${id}  → ${effect}`);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, embedding: effect }));
  });
});

server.listen(PORT, () =>
  console.log(`mock Gurzu notify receiver on http://localhost:${PORT}${PATH}`)
);
