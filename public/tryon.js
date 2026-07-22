// "Search & Try-On" side panel — talks to the GurzuVTO REST API.
//
// Config arrives from the server as a JSON island (#gvto-config), the same
// pattern store.js uses for #pd-data. The publishable key is origin-locked, so
// it is safe in page source, but it still spends renders — see CLAUDE.md.
//
// The shopper photo lives in memory only: never localStorage, never sent
// anywhere but the API, and dropped when the panel closes.
(function () {
  const cfgEl = document.getElementById("gvto-config");
  if (!cfgEl) return;
  let CFG;
  try { CFG = JSON.parse(cfgEl.textContent); } catch { return; }
  if (!CFG.apiBase || !CFG.publishableKey) return;

  const MAX_GARMENTS = 6;
  const POLL_MS = 2500;
  const POLL_BUDGET_MS = 6 * 60 * 1000;
  const MAX_EDGE = 1536;
  // "done"/"failed" are the only terminal states; anything else means keep polling.
  const TERMINAL = new Set(["done", "failed"]);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── tiny DOM helpers (build nodes, never innerHTML — no injection surface) ──
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

  // ── API ────────────────────────────────────────────────────────────────────
  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(CFG.apiBase + path, {
        method,
        headers: {
          Authorization: "Bearer " + CFG.publishableKey,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      const e = new Error("Couldn't reach the try-on service. Is it running at " + CFG.apiBase + "?");
      e.status = 0;
      throw e;
    }
    if (!res.ok) throw await toError(res);
    return res.json();
  }

  async function toError(res) {
    let detail = null;
    try { detail = (await res.json())?.detail ?? null; } catch { /* no body */ }
    // `detail` comes in three shapes: {reason, message}, a plain string, or —
    // for 422 — FastAPI's array of {msg, loc} validation errors.
    let reason = null;
    let message = null;
    if (Array.isArray(detail)) {
      message = detail.map((d) => d?.msg).filter(Boolean).join("; ") || null;
    } else if (detail && typeof detail === "object") {
      reason = detail.reason ?? null;
      message = detail.message ?? null;
    } else if (typeof detail === "string") {
      message = detail;
    }
    const e = new Error(explain(res.status, reason, message));
    e.status = res.status;
    e.reason = reason;
    e.retryAfter = Number(res.headers.get("retry-after")) || null;
    return e;
  }

  // Each status gets its own user-facing wording; only 429 is worth retrying.
  function explain(status, reason, message) {
    switch (status) {
      case 401:
        return "Try-on isn't set up correctly here — the API key is missing, wrong, or revoked. The store owner needs to fix it.";
      case 402:
        return reason === "render_cap_exhausted"
          ? "This store has used up its try-on renders for the month. It'll work again after the allowance resets."
          : message || "Try-on is switched off — the store's subscription isn't active.";
      case 403:
        if (reason === "origin_not_allowed")
          return "This page isn't allowed to use try-on. The store has to be served from http://localhost:4000.";
        if (reason === "missing_scope")
          return "This store's API key isn't allowed to do that.";
        return message || "Try-on refused that request.";
      case 409:
        return message || "This store isn't ready for try-on yet — its catalog still needs to be synced and embedded.";
      case 422:
        return message || "That request wasn't valid.";
      case 429:
        return "Too many requests just now — easing off and retrying.";
      default:
        return message || `The try-on service returned an error (${status}).`;
    }
  }

  // 429 is the one retryable status; everything else fails straight through.
  async function apiRetrying(path, opts, tries = 3) {
    let wait = 2000;
    for (let attempt = 0; ; attempt++) {
      try {
        return await api(path, opts);
      } catch (e) {
        if (e.status !== 429 || attempt >= tries) throw e;
        await sleep(e.retryAfter ? e.retryAfter * 1000 : wait);
        wait *= 2;
      }
    }
  }

  // ── photo preprocessing ────────────────────────────────────────────────────
  // EXIF-rotate, downscale to <=1536px longest edge, re-encode JPEG, strip the
  // data: prefix. Without the rotation step phone portraits arrive sideways.
  async function preparePhoto(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = el("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("Couldn't process that image.");
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Couldn't read that image."));
      fr.readAsDataURL(blob);
    });
    return { b64: dataUrl.split(",")[1], previewUrl: URL.createObjectURL(blob) };
  }

  // ── state ──────────────────────────────────────────────────────────────────
  const picked = new Map();     // external_id -> search hit
  const addButtons = new Map(); // external_id -> its "Add to try" button
  let photo = null;             // {b64, previewUrl} — in memory only
  let running = false;

  const money = (amount, currency) => {
    if (amount == null) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
    } catch {
      return `${currency || ""} ${amount}`.trim();
    }
  };

  // ── panel shell ────────────────────────────────────────────────────────────
  const searchInput = el("input", {
    class: "gvto-input", type: "search", placeholder: "red summer dress…",
    "aria-label": "Search garments to try on",
  });
  const searchBtn = el("button", { class: "gvto-btn", type: "submit", text: "Search" });
  const searchForm = el("form", { class: "gvto-searchrow" }, searchInput, searchBtn);
  const hitsBox = el("div", { class: "gvto-hits" });
  const searchNote = el("div");

  const trayBox = el("div");
  const traySect = el("section", { class: "gvto-sect" },
    el("h3", { class: "gvto-sect-t", text: "Selected" }), trayBox);

  const tilesBox = el("div", { class: "gvto-tiles" });
  const tilesSect = el("section", { class: "gvto-sect" },
    el("h3", { class: "gvto-sect-t", text: "Your try-ons" }), tilesBox);

  const body = el("div", { class: "gvto-body" },
    el("section", { class: "gvto-sect" },
      el("h3", { class: "gvto-sect-t", text: "Find something to try" }),
      searchForm, searchNote, hitsBox),
    traySect, tilesSect);

  const closeBtn = el("button", { class: "gvto-x", type: "button", "aria-label": "Close try-on", text: "×" });
  const panel = el("aside", {
    class: "gvto-panel", role: "dialog", "aria-modal": "true", "aria-label": "Search and try on",
  },
    el("div", { class: "gvto-head" },
      el("div", {},
        el("h2", { class: "gvto-title", text: "Search & Try-On" }),
        el("p", { class: "gvto-sub", text: "Powered by GurzuVTO" })),
      closeBtn),
    body);

  const scrim = el("div", { class: "gvto-scrim" });
  const root = el("div", { id: "gvto-root" }, scrim, panel);
  document.body.append(root);

  traySect.hidden = true;
  tilesSect.hidden = true;

  // ── open / close ───────────────────────────────────────────────────────────
  const launcher = document.getElementById("gvto-launch");
  function open() {
    root.classList.add("gvto-open");
    setTimeout(() => searchInput.focus(), 240);
  }
  function close() {
    root.classList.remove("gvto-open");
    // The shopper's photo is never persisted — drop it the moment we're done.
    dropPhoto();
  }
  function dropPhoto() {
    if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    photo = null;
    renderTray();
  }
  launcher?.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("gvto-open")) close();
  });

  // ── search ─────────────────────────────────────────────────────────────────
  function note(target, text, bad) {
    clear(target);
    if (text) target.append(el("p", { class: "gvto-note" + (bad ? " gvto-bad" : ""), text }));
  }

  searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = searchInput.value.trim();
    if (!text) return;
    searchBtn.disabled = true;
    clear(hitsBox);
    note(searchNote, "Searching…");
    try {
      const data = await apiRetrying("/v1/search", { method: "POST", body: { text, top_k: 8 } });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        note(searchNote, `Nothing matched “${text}”. Try different words.`);
      } else {
        note(searchNote, "");
        items.forEach((item) => hitsBox.append(hitCard(item)));
      }
    } catch (err) {
      note(searchNote, err.message, true);
    } finally {
      searchBtn.disabled = false;
    }
  });

  function hitCard(item) {
    const id = item.external_id;
    const add = el("button", {
      class: "gvto-btn gvto-btn-ghost", type: "button",
      text: picked.has(id) ? "Added" : "Add to try",
      disabled: picked.has(id) || !id,
      onclick: () => {
        if (!id || picked.has(id)) return;
        if (picked.size >= MAX_GARMENTS) {
          note(searchNote, `You can try on ${MAX_GARMENTS} garments at a time. Remove one first.`, true);
          return;
        }
        picked.set(id, item);
        add.textContent = "Added";
        add.disabled = true;
        renderTray();
      },
    });
    if (id) addButtons.set(id, add);
    const img = el("img", { alt: "", loading: "lazy", src: item.image_url || "" });
    img.addEventListener("error", () => { img.removeAttribute("src"); });
    return el("div", { class: "gvto-hit" },
      img,
      el("div", { class: "gvto-hit-b" },
        el("p", { class: "gvto-hit-n", text: item.name || "Untitled" }),
        el("p", { class: "gvto-hit-p", text: money(item.price, item.currency) }),
        item.designer ? el("p", { class: "gvto-hit-d", text: item.designer }) : null),
      add);
  }

  // ── tray + photo ───────────────────────────────────────────────────────────
  const fileInput = el("input", { class: "gvto-file", type: "file", accept: "image/*" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const next = await preparePhoto(file);
      if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      photo = next;
      renderTray();
    } catch (err) {
      renderTray(err.message || "Couldn't use that photo.");
    }
  });

  function renderTray(errText) {
    traySect.hidden = picked.size === 0;
    if (!picked.size) return clear(trayBox);

    clear(trayBox);
    const chips = el("div", { class: "gvto-chips" });
    for (const [id, item] of picked) {
      chips.append(el("div", { class: "gvto-chip" },
        item.image_url ? el("img", { src: item.image_url, alt: "" }) : null,
        el("span", { text: item.name || id }),
        el("button", {
          type: "button", "aria-label": "Remove", text: "×",
          onclick: () => {
            picked.delete(id);
            // re-enable that hit's "Add to try" button if it's still on screen
            const add = addButtons.get(id);
            if (add) { add.textContent = "Add to try"; add.disabled = false; }
            renderTray();
          },
        })));
    }
    trayBox.append(chips);

    const pickPhoto = el("button", {
      class: "gvto-btn gvto-btn-ghost", type: "button",
      text: photo ? "Change photo" : "Choose photo",
      onclick: () => fileInput.click(),
    });
    trayBox.append(el("div", { class: "gvto-drop" },
      photo ? el("img", { src: photo.previewUrl, alt: "Your photo" }) : null,
      el("div", { class: "gvto-hit-b" },
        el("p", { class: "gvto-drop-t", text: photo ? "Photo ready." : "Add a photo of yourself." }),
        el("p", { class: "gvto-drop-h", text: "Stays on your device except for the render. Never saved." })),
      pickPhoto));

    if (errText) trayBox.append(el("p", { class: "gvto-note gvto-bad", text: errText }));

    trayBox.append(el("button", {
      class: "gvto-btn gvto-btn-wide", type: "button",
      text: running ? "Rendering…" : `Try on ${picked.size} item${picked.size > 1 ? "s" : ""}`,
      disabled: !photo || running,
      onclick: startRenders,
    }));
    if (!photo) trayBox.append(el("p", { class: "gvto-muted", text: "Choose a photo to start." }));
    trayBox.append(fileInput);
  }

  // ── render + poll ──────────────────────────────────────────────────────────
  function makeTile(item) {
    const imgWrap = el("div", { class: "gvto-tile-img" });
    const state = el("p", { class: "gvto-state" });
    const foot = el("div", { class: "gvto-tile-b" },
      el("p", { class: "gvto-tile-n", text: item.name || item.external_id }), state);
    const tile = el("div", { class: "gvto-tile" }, imgWrap, foot);

    return {
      node: tile,
      status(label, spinning) {
        clear(state).className = "gvto-state";
        if (spinning) state.append(el("span", { class: "gvto-spin" }));
        state.append(el("span", { text: label }));
      },
      fail(msg) {
        clear(state).className = "gvto-state gvto-bad";
        state.append(el("span", { text: "Failed" }));
        clear(imgWrap).append(el("p", { class: "gvto-err", text: msg }));
      },
      done(b64, contentType) {
        const src = `data:${contentType || "image/jpeg"};base64,${b64}`;
        clear(imgWrap).append(el("img", { src, alt: "Try-on result for " + (item.name || "") }));
        clear(state).className = "gvto-state";
        const safe = String(item.name || "try-on").replace(/[^\w.-]+/g, "-").slice(0, 60);
        state.append(el("a", {
          class: "gvto-dl", href: src, download: `tryon-${safe}.jpg`, text: "↓ Download",
        }));
      },
    };
  }

  async function startRenders() {
    if (running || !photo || !picked.size) return;
    running = true;
    renderTray();

    const items = [...picked.values()];
    tilesSect.hidden = false;
    clear(tilesBox);
    const tiles = new Map();
    for (const item of items) {
      const t = makeTile(item);
      t.status("Queued…", true);
      tiles.set(item.external_id, t);
      tilesBox.append(t.node);
    }
    tilesSect.scrollIntoView({ behavior: "smooth", block: "start" });

    let jobs;
    try {
      const res = await apiRetrying("/v1/tryon/batch", {
        method: "POST",
        body: {
          variant_ids: items.map((i) => i.external_id).slice(0, MAX_GARMENTS),
          person_photo_b64: photo.b64,
        },
      });
      jobs = Array.isArray(res?.jobs) ? res.jobs : [];
    } catch (err) {
      // The whole batch was rejected — say so in every tile, not in a void.
      tiles.forEach((t) => t.fail(err.message));
      running = false;
      renderTray();
      return;
    }

    const byVariant = new Map(jobs.map((j) => [j.variant_id, j.job_id]));
    tiles.forEach((t, variantId) => {
      if (!byVariant.has(variantId)) t.fail("The service didn't start a render for this garment.");
    });

    const deadline = Date.now() + POLL_BUDGET_MS;
    // Poll every job concurrently — one stuck job must not hold up the others.
    await Promise.allSettled(jobs.map(async (job) => {
      const tile = tiles.get(job.variant_id);
      if (!tile) return;
      try {
        const final = await pollJob(job.job_id, deadline, (status) => tile.status(label(status), true));
        if (final.status === "done" && final.result_image_b64) {
          tile.done(final.result_image_b64, final.content_type);
        } else {
          tile.fail(final.error || "The render failed, but the service didn't say why.");
        }
      } catch (err) {
        tile.fail(err.message);
      }
    }));

    running = false;
    renderTray();
  }

  const label = (status) =>
    status === "pending" ? "Queued…" : status === "running" ? "Rendering…" : `${status}…`;

  async function pollJob(jobId, deadline, onTick) {
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      let job;
      try {
        job = await api("/v1/tryon/" + encodeURIComponent(jobId));
      } catch (err) {
        if (err.status === 429 || err.status === 0) continue; // transient — keep polling
        throw err;
      }
      if (TERMINAL.has(job.status)) return job;
      onTick(job.status);
    }
    throw new Error("This render is taking longer than 6 minutes — giving up on it.");
  }
})();
