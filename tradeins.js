import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";
import { markSectionSeen } from "./badges.js";
import { attachBadges } from "./admin-nav.js";
import {
  TRADEIN_TO_CAR,
  buildCarInsert,
  carPatchFromTradein,
  pushTradeinToCar,
  reconcileTradeinLinks
} from "./tradein-sync.js";

const $ = id => document.getElementById(id);
const grid = $("requestsGrid");
const BUCKET = "car-images";

/* Everything the grid, the filters and the approval panel need. The rest
   of the row is fetched only when a request is opened. */
const LIST_COLUMNS = [
  "id", "full_name", "phone", "email",
  "vehicle_make", "vehicle_model", "vehicle_year", "registration",
  "location", "status", "approved_car_id", "approved_at",
  "expected_value", "max_budget", "negotiated_price", "inventory_price",
  "created_at"
].join(",");

const esc = v => String(v ?? "—").replace(/[&<>"']/g,
  m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = v => Number(v || 0).toLocaleString("en-KE");
const date = v => v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dash = v => (v === null || v === undefined || v === "" ? "—" : v);

let requests = [], current = null, currentAdmin = null, adminEmails = new Set(), currentFiles = [];

/* Full rows and file lists keyed by request id, so reopening a request
   costs nothing. */
const fullCache = new Map();
const filesCache = new Map();

const SKELETON = `<div class="detail-field"><span>Loading</span><strong>…</strong></div>`;

const statuses = ["new", "reviewing", "valued", "completed", "rejected"];

/* Editable fields on the trade-in modal. Every key that also exists in
   TRADEIN_TO_CAR is mirrored onto the linked inventory vehicle on save. */
const EDIT_FIELDS = [
  { k: "vehicle_make",   l: "Make",               t: "text" },
  { k: "vehicle_model",  l: "Model",              t: "text" },
  { k: "vehicle_year",   l: "Year",               t: "number", min: "1900", max: "2100" },
  { k: "registration",   l: "Registration Number",t: "text" },
  { k: "body_type",      l: "Body Type",          t: "text" },
  { k: "fuel_type",      l: "Fuel Type",          t: "text" },
  { k: "transmission",   l: "Transmission",       t: "text" },
  { k: "mileage",        l: "Mileage (KM)",       t: "number" },
  { k: "colour",         l: "Colour",             t: "text" },
  { k: "condition",      l: "Condition",          t: "text" },
  { k: "location",       l: "Location",           t: "text" },
  { k: "defect_details", l: "Defect Details",     t: "textarea", full: true }
];

async function auth() {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace("auth.html"); return null; }
  let { data, error } = await supabase.from("admin_users")
    .select("id,email,is_main_admin").eq("id", session.user.id).maybeSingle();
  if (error || !data) { await supabase.auth.signOut(); location.replace("auth.html"); return null; }
  currentAdmin = data; return data;
}

async function loadAdmins() {
  let { data, error } = await supabase.from("admin_users").select("email");
  if (error) return;
  adminEmails = new Set((data || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean));
}

const isAgent = x => adminEmails.has(String(x?.email || "").trim().toLowerCase());
const isMainAdmin = () => currentAdmin?.is_main_admin === true;

function hideLoader() {
  $("loader")?.classList.add("hide");
  $("loading").style.display = "none";
}

async function fetchRequests() {
  const { data, error } = await supabase
    .from("tradein_requests")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* The heavy columns, for one request, once per session. */
async function fetchFullRequest(id) {
  const key = String(id);
  if (fullCache.has(key)) return fullCache.get(key);
  const { data, error } = await supabase
    .from("tradein_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  fullCache.set(key, data);
  return data;
}

async function load({ silent = false } = {}) {
  if (!silent) $("loading").style.display = "block";
  $("error").classList.remove("active");

  try {
    /* Parallel: one round trip of latency instead of three. */
    const [, , list] = await Promise.all([auth(), loadAdmins(), fetchRequests()]);

    requests = list;
    fullCache.clear();

    stats();
    render();
    hideLoader();

    /* Link repair runs after the paint and only repaints if it changed
       something. */
    reconcileTradeinLinks(requests)
      .then(changed => { if (changed && changed.size) { stats(); render(); } })
      .catch(err => console.warn("Link check failed:", err));

  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load requests.";
    $("error").classList.add("active");
    hideLoader();
  }
}

function stats() {
  $("totalRequests").textContent = requests.length;
  $("newRequests").textContent = requests.filter(x => (x.status || "new") === "new").length;
  $("reviewingRequests").textContent = requests.filter(x => x.status === "reviewing").length;
  $("completedRequests").textContent = requests.filter(x => x.approved_car_id).length;
}

function render() {
  let q = $("searchInput").value.toLowerCase().trim();
  let s = $("statusFilter").value;
  let o = $("sortFilter").value;
  let l = requests.filter(x => {
    let t = `${x.full_name || ""} ${x.phone || ""} ${x.email || ""} ${x.vehicle_make || ""} ${x.vehicle_model || ""} ${x.registration || ""} ${x.location || ""}`.toLowerCase();
    let st = x.approved_car_id ? "approved" : (x.status || "new");
    return (!q || t.includes(q)) && (s === "all" || st === s);
  });
  l.sort((a, b) =>
    o === "oldest" ? new Date(a.created_at) - new Date(b.created_at)
    : o === "value-high" ? (b.expected_value || 0) - (a.expected_value || 0)
    : o === "budget-high" ? (b.max_budget || 0) - (a.max_budget || 0)
    : new Date(b.created_at) - new Date(a.created_at));
  if (!l.length) { $("empty").style.display = "block"; grid.innerHTML = ""; return; }
  $("empty").style.display = "none";
  grid.innerHTML = l.map(x => {
    let st = x.approved_car_id ? "approved" : (x.status || "new");
    return `<article class="request-card" data-id="${esc(x.id)}"><div class="request-top"><span class="request-status ${esc(st)}">${esc(x.approved_car_id ? "in inventory" : st)}</span><small>${esc(date(x.created_at))}</small></div><h3>${esc(x.full_name || "Customer")}</h3><p><i class="fa-solid fa-phone"></i> ${esc(x.phone || "—")}</p><p><i class="fa-solid fa-envelope"></i> ${esc(x.email || "—")}</p><div class="request-meta"><span>${esc(`${x.vehicle_make || ""} ${x.vehicle_model || ""}`.trim() || "Vehicle not specified")}</span><strong>KES ${money(x.expected_value)}</strong></div><div class="request-bottom"><span>${esc(x.registration || "No registration")}</span><button type="button">View <i class="fa-solid fa-arrow-right"></i></button></div></article>`;
  }).join("");
}

function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(dash(value))}</strong></div>`;
}

/* ---------------- FILES ---------------- */

async function getFiles(id) {
  const key = String(id);
  if (filesCache.has(key)) return filesCache.get(key);
  let { data, error } = await supabase.from("tradein_files").select("*").eq("tradein_id", id).order("created_at", { ascending: true });
  if (error) throw error;
  filesCache.set(key, data || []);
  return data || [];
}

/* Supabase image transform. Thumbnails come back as small WebP-ish
   renders instead of the full-size original. Non-storage URLs and
   videos are returned untouched. */
function optimizedUrl(url, width = 480, quality = 65) {
  if (!url || !url.includes("/storage/v1/object/public/")) return url;
  return url.replace("/object/public/", "/render/image/public/") +
    `?width=${width}&quality=${quality}&resize=contain`;
}

function fileUrl(f) {
  if (!f) return "";
  return f.file_url || "";
}

function isImageFile(f) {
  const url = fileUrl(f);
  if (String(f?.file_type || "").startsWith("image/")) return true;
  return /\.(jpg|jpeg|png|webp|gif|avif|bmp|heic)(\?|$)/i.test(url);
}

function isVideoFile(f) {
  const url = fileUrl(f);
  if (String(f?.file_type || "").startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url);
}

function fileCard(f, index) {
  const url = fileUrl(f);
  const image = isImageFile(f);
  const video = isVideoFile(f);
  const label = f.file_name || f.file_type || "File";

  let media;
  if (image) {
    /* ~420px render, not the 4MB phone original. */
    media = `<img src="${esc(optimizedUrl(url, 420, 62))}" alt="${esc(label)}" loading="lazy" decoding="async"
      data-lightbox-index="${index}" data-lightbox-kind="image"
      onerror="this.parentElement.innerHTML='<div class=&quot;file-icon&quot;><i class=&quot;fa-solid fa-image&quot;></i></div>'">`;
  } else if (video) {
    /* A tile, not a <video>: the clip only downloads if it is opened. */
    media = `<div class="file-icon video-tile" data-lightbox-index="${index}" data-lightbox-kind="video"
      style="display:grid;place-items:center;width:100%;height:100%">
      <i class="fa-solid fa-circle-play" style="font-size:26px;opacity:.85"></i>
    </div>`;
  } else {
    media = `<div class="file-icon"><i class="fa-solid fa-file"></i></div>`;
  }

  const clickable = image || video;
  return `<div class="file-card ${video ? "is-video" : ""}" ${clickable ? `data-lightbox-index="${index}"` : ""}>
    ${media}
    <div class="file-info">
      <span>${esc(label)}</span>
      <a href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open File <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
    </div>
  </div>`;
}

/* ---------------- EDIT FORM ---------------- */

function buildEditForm() {
  const container = $("vehicleEditForm");
  if (!container || !current) return;

  /* Editing stays open after approval. Changes are written to the
     trade-in request AND mirrored onto the linked inventory vehicle. */
  const locked = false;
  const inInventory = !!current.approved_car_id;

  container.innerHTML = `
    <div class="edit-grid">
      ${EDIT_FIELDS.map(f => {
        const raw = current[f.k];
        let value = raw ?? "";
        const input = f.t === "textarea"
          ? `<textarea id="ef_${f.k}" data-key="${esc(f.k)}" ${locked ? "disabled" : ""}>${esc(value)}</textarea>`
          : `<input id="ef_${f.k}" data-key="${esc(f.k)}" type="${esc(f.t)}"
              ${f.step ? ` step="${esc(f.step)}"` : ""}
              ${f.min ? ` min="${esc(f.min)}"` : ""}
              ${f.max ? ` max="${esc(f.max)}"` : ""}
              ${locked ? "disabled" : ""}
              value="${esc(value)}">`;
        return `
          <div class="edit-field ${f.full ? "full" : ""}">
            <label for="ef_${esc(f.k)}">${esc(f.l)}</label>
            ${input}
          </div>
        `;
      }).join("")}
    </div>
    ${locked ? "" : `
      <div class="edit-actions">
        <button type="button" class="edit-reset" id="resetVehicle">
          <i class="fa-solid fa-rotate-left"></i> Reset
        </button>
        <button type="button" class="edit-save" id="saveVehicle">
          <i class="fa-solid fa-floppy-disk"></i> Save Vehicle Details
        </button>
      </div>
    `}
    <p class="edit-note">
      ${inInventory
        ? "This request is in inventory. Saved changes update the trade-in record and the linked vehicle listing."
        : "Saved changes update the trade-in request. When approved, these values are written into the new inventory vehicle."}
    </p>
    ${inInventory ? `
      <div class="edit-actions">
        <a class="edit-save" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px"
           href="edit.html?id=${encodeURIComponent(current.approved_car_id)}">
          <i class="fa-solid fa-up-right-from-square"></i> Open Full Inventory Page
        </a>
      </div>
    ` : ""}
  `;

  if (!locked) {
    $("saveVehicle").onclick = saveVehicleEdits;
    $("resetVehicle").onclick = () => buildEditForm();
  }
}

function paintVehicleSections() {
  $("detailTitle").textContent = `${current.full_name || "Customer"} — ${current.vehicle_make || ""} ${current.vehicle_model || ""}`.trim();
  $("vehicleTitle").textContent = `${current.vehicle_make || "Vehicle"} ${current.vehicle_model || ""}`.trim();
  $("vehicleMeta").textContent = [current.vehicle_year, current.registration].filter(Boolean).join(" • ") || "Trade-in vehicle";

  $("vehicleDetails").innerHTML = [
    field("Make", current.vehicle_make), field("Model", current.vehicle_model), field("Year", current.vehicle_year),
    field("Registration", current.registration), field("Body Type", current.body_type), field("Fuel", current.fuel_type),
    field("Transmission", current.transmission), field("Mileage", current.mileage != null ? `${Number(current.mileage).toLocaleString()} km` : "—"),
    field("Colour", current.colour), field("Condition", current.condition),
    field("Defects", Array.isArray(current.defects) ? current.defects.join(", ") : current.defects),
    field("Defect Details", current.defect_details), field("Location", current.location)
  ].join("");
}

/* Keep the cached copies in step after any local change. */
function commitCurrent() {
  if (!current) return;
  fullCache.set(String(current.id), current);
  requests = requests.map(x => String(x.id) === String(current.id) ? { ...x, ...current } : x);
}

async function saveVehicleEdits() {
  if (!current) return;

  const button = $("saveVehicle");
  const updates = {};

  document.querySelectorAll("#vehicleEditForm [data-key]").forEach(el => {
    const key = el.dataset.key;
    const def = EDIT_FIELDS.find(f => f.k === key);
    const raw = el.value.trim();

    if (def.t === "number") {
      updates[key] = raw === "" ? null : (Number.isFinite(Number(raw)) ? Number(raw) : null);
    } else {
      updates[key] = raw === "" ? null : raw;
    }
  });

  if (!updates.vehicle_make || !updates.vehicle_model) {
    return alert("Make and model are required.");
  }
  if (updates.vehicle_year !== null && (updates.vehicle_year < 1900 || updates.vehicle_year > 2100)) {
    return alert("Year must be between 1900 and 2100.");
  }

  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    updates.updated_at = new Date().toISOString();

    const linkedCar = current.approved_car_id;
    const merged = { ...current, ...updates };

    /* Both writes go out together instead of one behind the other. */
    const [requestResult, syncError] = await Promise.all([
      supabase.from("tradein_requests").update(updates).eq("id", current.id),
      linkedCar
        ? pushTradeinToCar(merged, linkedCar, Object.keys(TRADEIN_TO_CAR)).then(() => null, err => err)
        : Promise.resolve(null)
    ]);

    if (requestResult.error) throw requestResult.error;

    current = merged;
    commitCurrent();

    paintVehicleSections();
    render();

    if (syncError) {
      console.error(syncError);
      alert(`Saved.\n\nThe trade-in record was saved, but the inventory vehicle was not updated: ${syncError.message || syncError}`);
    }

    button.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved`;
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Vehicle Details`;
    }, 1200);
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to save vehicle details.");
    button.disabled = false;
    button.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Vehicle Details`;
  }
}

/* ---------------- LIGHTBOX ---------------- */

let lbImages = [];
let lbIndex = 0;
let lbElement = null;

function openLightbox(images, startIndex = 0) {
  if (!images.length) return;
  lbImages = images;
  lbIndex = Math.max(0, Math.min(startIndex, images.length - 1));

  if (lbElement) lbElement.remove();

  lbElement = document.createElement("div");
  lbElement.className = "trade-lightbox";
  lbElement.innerHTML = `
    <div class="lb-topbar">
      <div class="lb-title" id="lbTitle"></div>
      <div class="lb-topbar-actions">
        <button class="lb-icon-btn" id="lbZoom" title="Toggle zoom"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
        <button class="lb-icon-btn" id="lbClose" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="lb-stage" id="lbStage">
      <button class="lb-nav lb-prev" id="lbPrev"><i class="fa-solid fa-chevron-left"></i></button>
      <div id="lbMediaWrap" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%"></div>
      <button class="lb-nav lb-next" id="lbNext"><i class="fa-solid fa-chevron-right"></i></button>
      <div class="lb-counter" id="lbCounter"></div>
    </div>
    <div class="lb-thumbs" id="lbThumbs"></div>
  `;
  document.body.appendChild(lbElement);
  document.body.classList.add("locked");

  const title = $("lbTitle");
  const counter = $("lbCounter");
  const thumbs = $("lbThumbs");
  const stage = $("lbStage");
  const wrap = $("lbMediaWrap");
  let zoomed = false;

  thumbs.innerHTML = images.map((im, i) => `
    <div class="lb-thumb ${i === lbIndex ? "active" : ""}" data-i="${i}">
      ${im.kind === "video"
        ? `<div class="thumb-video-mark"><i class="fa-solid fa-play"></i></div>`
        : `<img src="${esc(im.thumb || im.url)}" alt="" loading="lazy" decoding="async">`}
    </div>
  `).join("");

  const renderActive = () => {
    const item = images[lbIndex];
    zoomed = false;
    wrap.innerHTML = "";

    if (item.kind === "video") {
      const v = document.createElement("video");
      v.src = item.url;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.style.maxWidth = "100%";
      v.style.maxHeight = "100%";
      v.style.background = "#000";
      wrap.appendChild(v);
      $("lbZoom").style.display = "none";
    } else {
      const img = document.createElement("img");
      img.src = item.view || item.url;
      img.alt = item.label || "";
      img.decoding = "async";
      img.className = "lb-image";
      img.onclick = () => { zoomed = !zoomed; img.classList.toggle("zoomed", zoomed); };
      wrap.appendChild(img);
      $("lbZoom").style.display = "grid";
    }

    title.textContent = item.label || "File";
    counter.textContent = `${lbIndex + 1} / ${images.length}`;
    [...thumbs.children].forEach((el, i) => el.classList.toggle("active", i === lbIndex));
    const active = thumbs.querySelector(".lb-thumb.active");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    $("lbPrev").disabled = lbIndex === 0;
    $("lbNext").disabled = lbIndex === images.length - 1;
  };

  const close = () => {
    lbElement.remove();
    lbElement = null;
    document.body.classList.remove("locked");
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight" && lbIndex < images.length - 1) { lbIndex++; renderActive(); }
    else if (e.key === "ArrowLeft" && lbIndex > 0) { lbIndex--; renderActive(); }
  };

  $("lbClose").onclick = close;
  $("lbPrev").onclick = () => { if (lbIndex > 0) { lbIndex--; renderActive(); } };
  $("lbNext").onclick = () => { if (lbIndex < images.length - 1) { lbIndex++; renderActive(); } };
  $("lbZoom").onclick = () => {
    const img = wrap.querySelector("img");
    if (!img) return;
    zoomed = !zoomed;
    img.classList.toggle("zoomed", zoomed);
  };

  thumbs.onclick = (e) => {
    const t = e.target.closest(".lb-thumb");
    if (!t) return;
    lbIndex = Number(t.dataset.i);
    renderActive();
  };

  stage.onclick = (e) => { if (e.target === stage) close(); };
  document.addEventListener("keydown", onKey);

  renderActive();
}

/* ---------------- DOWNLOAD AS FORM ---------------- */

function buildPrintableTradeInForm() {
  const c = current;
  const files = currentFiles || [];
  const row = (label, val) => `<tr><th>${esc(label)}</th><td>${esc(dash(val))}</td></tr>`;

  const photos = files.filter(isImageFile).map(f => `
    <figure>
      <img src="${esc(optimizedUrl(fileUrl(f), 760, 68))}" alt="">
      <figcaption>${esc(f.file_name || "Photo")}</figcaption>
    </figure>`).join("");

  const status = c.approved_car_id ? "In Inventory" : (c.status || "new");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Trade-In Request — ${esc(c.full_name || "Customer")}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Space Grotesk', Arial, sans-serif; color: #102b46; font-size: 11px; line-height: 1.4; margin: 0; padding: 0; }
  header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 3px solid #f7941d; margin-bottom: 18px; }
  header h1 { margin: 0; font-size: 18px; }
  header span { font-size: 10px; color: #657b8c; }
  h2 { font-size: 13px; margin: 18px 0 8px; border-left: 3px solid #f7941d; padding-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d9e2e8; vertical-align: top; }
  th { width: 34%; background: #f5f8fa; font-weight: 700; color: #657b8c; text-transform: uppercase; font-size: 8.5px; letter-spacing: .04em; }
  td { font-size: 10.5px; }
  .badge { display: inline-block; padding: 3px 7px; background: #edf5f8; color: #075985; font-size: 8px; font-weight: 800; text-transform: uppercase; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; page-break-inside: avoid; }
  .photos figure { margin: 0; border: 1px solid #d9e2e8; padding: 4px; }
  .photos img { width: 100%; height: 130px; object-fit: cover; display: block; }
  .photos figcaption { font-size: 8.5px; margin-top: 4px; color: #657b8c; text-transform: uppercase; font-weight: 700; }
  .sign { margin-top: 26px; display: flex; justify-content: space-between; gap: 30px; }
  .sign > div { flex: 1; }
  .sign .line { border-top: 1px solid #102b46; padding-top: 4px; font-size: 9px; color: #657b8c; }
  footer { margin-top: 24px; font-size: 8.5px; color: #94a6b0; text-align: center; }
</style>
</head>
<body>

<header>
  <div>
    <h1>Trade-In Request</h1>
    <span>Regional Autoselections Ltd — Admin Form</span>
  </div>
  <div style="text-align:right">
    <div class="badge">${esc(status)}</div>
    <div style="font-size:9px;color:#657b8c;margin-top:4px">Ref: ${esc(c.id)}</div>
    <div style="font-size:9px;color:#657b8c">${esc(date(c.created_at))}</div>
  </div>
</header>

<h2>Customer Information</h2>
<table>
  ${row("Full Name", c.full_name)}
  ${row("Phone", c.phone)}
  ${row("Email", c.email)}
  ${row("Location", c.location)}
  ${row("ID / Passport", c.id_number)}
  ${row("Preferred Contact Time", c.contact_time)}
</table>

<h2>Trade-In Vehicle</h2>
<table>
  ${row("Make", c.vehicle_make)}
  ${row("Model", c.vehicle_model)}
  ${row("Year", c.vehicle_year)}
  ${row("Registration", c.registration)}
  ${row("Body Type", c.body_type)}
  ${row("Fuel Type", c.fuel_type)}
  ${row("Transmission", c.transmission)}
  ${row("Mileage (KM)", c.mileage != null ? Number(c.mileage).toLocaleString() : "—")}
  ${row("Colour", c.colour)}
  ${row("Condition", c.condition)}
  ${row("Defects", Array.isArray(c.defects) ? c.defects.join(", ") : c.defects)}
  ${row("Defect Details", c.defect_details)}
  ${row("Location", c.location)}
</table>

<h2>Desired Upgrade</h2>
<table>
  ${row("Identified Vehicle", c.identified_vehicle)}
  ${row("Make", c.upgrade_make)}
  ${row("Model", c.upgrade_model)}
  ${row("Max Budget", c.max_budget != null ? `KES ${money(c.max_budget)}` : "—")}
</table>

<h2>Financial Information</h2>
<table>
  ${row("Expected Trade-In Value", c.expected_value != null ? `KES ${money(c.expected_value)}` : "—")}
  ${row("Loan Balance", c.loan_balance != null ? `KES ${money(c.loan_balance)}` : "—")}
  ${row("Top-Up", c.topup != null ? `KES ${money(c.topup)}` : "—")}
  ${row("Financing", c.financing)}
</table>

${c.negotiated_price != null || c.inventory_price != null ? `
<h2>Valuation</h2>
<table>
  ${row("Negotiated Value", c.negotiated_price != null ? `KES ${money(c.negotiated_price)}` : "—")}
  ${row("Inventory Price", c.inventory_price != null ? `KES ${money(c.inventory_price)}` : "—")}
  ${row("Estimated Profit", (c.inventory_price != null && c.negotiated_price != null) ? `KES ${money(Number(c.inventory_price) - Number(c.negotiated_price))}` : "—")}
</table>` : ""}

<h2>Additional Information</h2>
<table>
  ${row("Source", c.source)}
  ${row("Timeline", c.trade_timeline)}
  ${row("Notes", c.notes)}
  ${row("Request ID", c.id)}
  ${row("Inventory Vehicle ID", c.approved_car_id)}
</table>

<h2>Submitted Photos (${files.filter(isImageFile).length})</h2>
${photos ? `<div class="photos">${photos}</div>` : `<p>No photos submitted.</p>`}

<div class="sign">
  <div><div class="line">Admin Signature / Date</div></div>
  <div><div class="line">Customer Signature / Date</div></div>
</div>

<footer>Generated ${date(new Date().toISOString())} — Regional Autoselections Ltd</footer>

</body>
</html>`;
}

function downloadTradeInForm() {
  if (!current) return;
  const html = buildPrintableTradeInForm();
  const win = window.open("", "_blank");
  if (!win) return alert("Please allow pop-ups to download the request form.");
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) { /* user prints manually */ } }, 400);
}

window.downloadTradeInForm = downloadTradeInForm;
window.openInventoryCar = () => {
  if (current?.approved_car_id) location.href = `edit.html?id=${encodeURIComponent(current.approved_car_id)}`;
};

/* ---------------- STATUS ---------------- */

function updateDetailStatus(status) {
  let badge = $("detailStatusLabel");
  if (!badge) return;
  badge.className = `large-status ${status}`;
  badge.textContent = status === "approved" ? "IN INVENTORY" : status.toUpperCase();
}

function renderContact(row) {
  const c = row || current;
  let p = String(c.phone || "").replace(/\D/g, "").replace(/^0/, "254");
  let e = c.email || "";
  $("contactActions").innerHTML =
    `${p ? `<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Customer</a><a class="contact-action-large whatsapp" href="https://wa.me/${esc(p)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>` : ""}${e ? `<a class="contact-action-large" href="mailto:${esc(e)}"><i class="fa-solid fa-envelope"></i>Email Customer</a>` : ""}`;
}

/* ---------------- APPROVAL PANEL ---------------- */

function approvalPanel() {
  if (current.approved_car_id) {
    let profit = Number(current.inventory_price || 0) - Number(current.negotiated_price || 0);
    return `<section class="approval-panel approved-panel">
      <div class="approval-title">
        <div><i class="fa-solid fa-circle-check"></i></div>
        <div><span>INVENTORY STATUS</span><h3>Vehicle Approved & Added</h3></div>
      </div>
      <div class="approval-summary">
        <div><span>Trade-In Value</span><strong>KES ${money(current.negotiated_price)}</strong></div>
        <div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div>
        <div><span>Estimated Gross Profit</span><strong class="${profit >= 0 ? "profit-positive" : "profit-negative"}">KES ${money(profit)}</strong></div>
      </div>
      <div class="approved-actions">
        <button type="button" class="inventory-btn" onclick="openInventoryCar()"><i class="fa-solid fa-pen-to-square"></i> Open Inventory Vehicle</button>
        <button type="button" class="download-btn" onclick="window.downloadTradeInForm()"><i class="fa-solid fa-file-arrow-down"></i> Download Form</button>
      </div>
    </section>`;
  }
  if (!isMainAdmin()) return `<section class="approval-panel locked-panel">
    <div class="approval-title">
      <div><i class="fa-solid fa-lock"></i></div>
      <div><span>INVENTORY APPROVAL</span><h3>Main Admin Approval Required</h3>
      <p>Only the main administrator can approve this trade-in vehicle and move it into inventory.</p></div>
    </div>
    <div style="margin-top:12px">
      <button type="button" class="download-btn" onclick="window.downloadTradeInForm()"><i class="fa-solid fa-file-arrow-down"></i> Download Form</button>
    </div>
  </section>`;

  return `<section class="approval-panel">
    <div class="approval-title">
      <div><i class="fa-solid fa-handshake"></i></div>
      <div><span>INVENTORY APPROVAL</span><h3>Approve & Add to Inventory</h3>
      <p>Enter the agreed trade-in value and the intended inventory selling price.</p></div>
    </div>
    <div class="asking-price">
      <span>Customer Expected Trade-In Value</span>
      <strong>KES ${money(current.expected_value)}</strong>
    </div>
    <div class="approval-grid">
      <div><label>Agreed Trade-In Value *</label>
        <input id="negotiatedPrice" type="number" min="0" step="1" value="${current.negotiated_price ?? ""}" placeholder="Final value agreed"></div>
      <div><label>Inventory Selling Price *</label>
        <input id="inventoryPrice" type="number" min="0" step="1" value="${current.inventory_price ?? ""}" placeholder="Vehicle listing price"></div>
    </div>
    <div class="profit-box">
      <div><span>Estimated Gross Profit</span><strong id="profitValue">KES 0</strong></div>
      <small>Selling price minus agreed trade-in value.</small>
    </div>
    <button id="approveInventory" type="button" class="approve-btn"><i class="fa-solid fa-car-side"></i> Approve & Add to Inventory</button>
    <div style="margin-top:12px">
    </div>
  </section>`;
}

/* ---------------- VIEW ---------------- */

let openToken = 0;

/* Paints instantly from the row already in the grid. */
function openDetailShell(row) {
  $("detailTitle").textContent = `${row.full_name || "Customer"} — ${row.vehicle_make || ""} ${row.vehicle_model || ""}`.trim();
  $("detailDate").textContent = date(row.created_at);
  $("detailStatus").value = row.status || "new";
  updateDetailStatus(row.approved_car_id ? "approved" : (row.status || "new"));

  $("agentBanner").innerHTML = "";
  $("customerDetails").innerHTML = [
    field("Full Name", row.full_name), field("Phone", row.phone), field("Email", row.email),
    field("Location", row.location), SKELETON, SKELETON
  ].join("");
  $("upgradeDetails").innerHTML = SKELETON;
  $("financialDetails").innerHTML = SKELETON;
  $("additionalDetails").innerHTML = SKELETON;
  if ($("vehicleEditForm")) $("vehicleEditForm").innerHTML = SKELETON;
  $("filesContent").innerHTML = SKELETON;
  $("approvalContent").innerHTML = "";

  $("vehicleTitle").textContent = `${row.vehicle_make || "Vehicle"} ${row.vehicle_model || ""}`.trim();
  $("vehicleMeta").textContent = [row.vehicle_year, row.registration].filter(Boolean).join(" • ") || "Trade-in vehicle";
  $("vehicleDetails").innerHTML = SKELETON;

  paintValuation(row);
  renderContact.call(null, row);

  $("tradeDetail").classList.add("show");
  document.body.classList.add("locked");
}

function paintValuation(c) {
  $("valuationDetails").innerHTML = [
    field("Expected Value", `KES ${money(c.expected_value)}`),
    field("Negotiated Value", c.negotiated_price != null ? `KES ${money(c.negotiated_price)}` : "—"),
    field("Inventory Price", c.inventory_price != null ? `KES ${money(c.inventory_price)}` : "—"),
    field("Estimated Profit", c.inventory_price != null && c.negotiated_price != null ? `KES ${money(Number(c.inventory_price) - Number(c.negotiated_price))}` : "—")
  ].join("");
}

function paintApprovalPanel() {
  $("approvalContent").innerHTML = approvalPanel();
  if (!current.approved_car_id && isMainAdmin()) {
    $("negotiatedPrice")?.addEventListener("input", updateProfit);
    $("inventoryPrice")?.addEventListener("input", updateProfit);
    $("approveInventory")?.addEventListener("click", approveToInventory);
    updateProfit();
  }
}

function paintDetail() {
  $("agentBanner").innerHTML = isAgent(current)
    ? `<div class="agent-banner"><i class="fa-solid fa-user-tie"></i><div><strong>AGENT SUBMISSION</strong><span>This request was submitted using an administrator email.</span></div></div>`
    : "";

  $("customerDetails").innerHTML = [
    field("Full Name", current.full_name), field("Phone", current.phone), field("Email", current.email),
    field("Location", current.location), field("ID / Passport", current.id_number), field("Contact Time", current.contact_time)
  ].join("");

  buildEditForm();

  $("upgradeDetails").innerHTML = [
    field("Identified Vehicle", current.identified_vehicle), field("Make", current.upgrade_make),
    field("Model", current.upgrade_model), field("Max Budget", `KES ${money(current.max_budget)}`)
  ].join("");

  $("financialDetails").innerHTML = [
    field("Expected Trade-In", `KES ${money(current.expected_value)}`), field("Loan Balance", `KES ${money(current.loan_balance)}`),
    field("Top-Up", `KES ${money(current.topup)}`), field("Financing", current.financing)
  ].join("");

  $("additionalDetails").innerHTML = [
    field("Source", current.source), field("Timeline", current.trade_timeline),
    field("Notes", current.notes), field("Request ID", current.id),
    field("Inventory Vehicle ID", current.approved_car_id)
  ].join("");

  renderContact();
  paintVehicleSections();
  paintValuation(current);

  $("filesContent").innerHTML = currentFiles.length
    ? `<div class="files-grid">${currentFiles.map((f, i) => fileCard(f, i)).join("")}</div>`
    : `<div class="notes"><p>No vehicle files were submitted.</p></div>`;

  paintApprovalPanel();
}

async function viewRequest(id) {
  const lite = requests.find(x => String(x.id) === String(id));
  if (!lite) return;

  const token = ++openToken;
  current = lite;
  openDetailShell(lite);

  try {
    /* The full row and the file list in one round trip. */
    const [full, files] = await Promise.all([fetchFullRequest(id), getFiles(id)]);
    if (token !== openToken) return;   /* closed, or another one opened */

    current = full ? { ...lite, ...full } : lite;
    currentFiles = files;
    commitCurrent();
    paintDetail();

    /* The link check happens after the modal is usable, not before it
       opens. Only the linked vehicle is checked, not the whole table. */
    if (current.approved_car_id) {
      const { data } = await supabase.from("cars").select("id").eq("id", current.approved_car_id).maybeSingle();
      if (token !== openToken || data) return;
      await reconcileTradeinLinks([current]);
      commitCurrent();
      updateDetailStatus(current.approved_car_id ? "approved" : (current.status || "new"));
      buildEditForm();
      paintApprovalPanel();
      stats();
      render();
    }
  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load request.";
    $("error").classList.add("active");
  }
}

function updateProfit() {
  let buy = Number($("negotiatedPrice")?.value || 0);
  let sell = Number($("inventoryPrice")?.value || 0);
  let profit = sell - buy;
  let el = $("profitValue");
  if (!el) return;
  el.textContent = `KES ${money(profit)}`;
  el.className = profit < 0 ? "profit-negative" : "profit-positive";
}

/* ---------------- APPROVE ---------------- */

function imageFiles() {
  return currentFiles.filter(isImageFile);
}

function safeName(name) {
  return String(name || "image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

async function copyImageToCar(file, carId, index) {
  const url = fileUrl(file);
  if (!url) throw new Error("Image URL is missing.");
  /* Copy a 1600px render into inventory instead of the raw upload. */
  let response = await fetch(optimizedUrl(url, 1600, 82));
  if (!response.ok) response = await fetch(url);
  if (!response.ok) throw new Error("Unable to download submitted image.");
  let blob = await response.blob();
  let name = safeName(file.file_name || `image-${index}.jpg`);
  let target = `${carId}/gallery/${crypto.randomUUID()}-${name}`;
  let { error } = await supabase.storage.from(BUCKET).upload(target, blob, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.file_type || blob.type
  });
  if (error) throw error;
  return { storage_path: target, image_url: supabase.storage.from(BUCKET).getPublicUrl(target).data.publicUrl };
}

async function approveToInventory() {
  if (!current || !isMainAdmin()) return alert("Only the main administrator can approve vehicles into inventory.");
  if (current.approved_car_id) return alert("This request has already been added to inventory.");

  let buy = Number($("negotiatedPrice")?.value), sell = Number($("inventoryPrice")?.value);
  if (!Number.isFinite(buy) || buy < 0) return alert("Enter a valid agreed trade-in value.");
  if (!Number.isFinite(sell) || sell <= 0) return alert("Enter a valid inventory selling price.");

  let name = `${current.vehicle_make || ""} ${current.vehicle_model || ""}`.trim() || "this vehicle";
  if (!confirm(`Approve ${name} and add it to inventory for KES ${money(sell)}?`)) return;

  let button = $("approveInventory");
  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding to Inventory...`;

  let uploaded = [];
  let createdCarId = null;   /* only set when this run inserted the row */

  try {
    /* Session and both duplicate checks together. */
    const [sessionResult, check, existing] = await Promise.all([
      supabase.auth.getSession(),
      supabase.from("tradein_requests").select("approved_car_id").eq("id", current.id).maybeSingle(),
      supabase.from("cars").select("id").eq("source_request_id", current.id).maybeSingle()
    ]);

    const session = sessionResult?.data?.session;
    if (!session) throw new Error("Your session has expired. Please log in again.");
    if (check.error) throw check.error;
    if (check.data?.approved_car_id) throw new Error("This request has already been approved by another administrator.");
    if (existing.error) throw existing.error;

    let car;
    if (existing.data) {
      car = existing.data;
      /* Keep the price on an already-created row in step with the panel. */
      await supabase.from("cars").update({
        price: sell, purchase_price: buy, is_public: true, updated_at: new Date().toISOString()
      }).eq("id", car.id);
    } else {
      let r = await supabase.from("cars").insert(buildCarInsert(current, { buy, sell })).select("id").single();
      if (r.error) {
        if (r.error.code === "23505") {
          let q = await supabase.from("cars").select("id").eq("source_request_id", current.id).single();
          if (q.error) throw q.error;
          car = q.data;
        } else throw r.error;
      } else {
        car = r.data;
        createdCarId = car.id;
      }
    }

    if (!car?.id) throw new Error("The inventory vehicle was not created. Nothing has been marked as approved.");

    /* Images copy in parallel, then land as a single insert. */
    let images = imageFiles();
    if (createdCarId && images.length) {
      const copied = await Promise.all(images.map((f, i) => copyImageToCar(f, car.id, i)));
      uploaded = copied.map(c => c.storage_path);

      const [insertResult, displayResult] = await Promise.all([
        supabase.from("car_images").insert(copied.map((c, i) => ({
          car_id: car.id, image_url: c.image_url, storage_path: c.storage_path,
          image_type: "gallery", display_order: i
        }))),
        supabase.from("cars").update({
          display_image_url: copied[0].image_url,
          display_image_path: copied[0].storage_path
        }).eq("id", car.id)
      ]);

      if (insertResult.error) throw insertResult.error;
      if (displayResult.error) throw displayResult.error;
    }

    let now = new Date().toISOString();
    let requestUpdate = {
      status: "approved", negotiated_price: buy, inventory_price: sell,
      approved_car_id: car.id, approved_at: now, approved_by: session.user.id, updated_at: now
    };

    /* The returned row confirms both that the vehicle exists and that no
       one else approved this request first. */
    let { data: updatedRows, error: updateError } = await supabase
      .from("tradein_requests")
      .update(requestUpdate)
      .eq("id", current.id)
      .is("approved_car_id", null)
      .select("id");
    if (updateError) throw updateError;
    if (!updatedRows || !updatedRows.length) {
      throw new Error("This request was approved by another administrator while you were working on it. Refresh to see the current state.");
    }

    current = { ...current, ...requestUpdate };
    commitCurrent();

    alert(`Vehicle approved and successfully added to inventory.${images.length && createdCarId ? ` ${images.length} image(s) were transferred.` : ""}`);
    closeDetail();
    stats();
    render();

  } catch (e) {
    console.error(e);

    /* Roll the whole thing back, so a failed approval never leaves a
       half-made vehicle or a request pointing at nothing. */
    try {
      if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
      if (createdCarId) {
        await supabase.from("car_images").delete().eq("car_id", createdCarId);
        await supabase.from("cars").delete().eq("id", createdCarId);
      }
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }

    alert(e.message || "Unable to add vehicle to inventory.");
    if (button) {
      button.disabled = false;
      button.innerHTML = `<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`;
    }
  }
}

/* ---------------- STATUS UPDATE / DELETE ---------------- */

async function updateStatus(id, status) {
  if (current?.approved_car_id && status !== "approved" && !confirm("This request is already linked to an inventory vehicle. Change its request status anyway?")) return;
  let { error } = await supabase.from("tradein_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return alert(error.message);
  let x = requests.find(x => String(x.id) === String(id));
  if (x) x.status = status;
  if (current) { current.status = status; commitCurrent(); }
  updateDetailStatus(current?.approved_car_id ? "approved" : status);
  stats();
  render();
  $("saveStatus").disabled = false;
}

async function deleteRequest() {
  if (!current) return;
  if (current.approved_car_id &&
      !confirm("This request is linked to a vehicle in inventory. Deleting the request will leave that vehicle in place. Continue?")) return;
  if (!confirm(`Delete trade-in request from ${current.full_name || "this customer"}? This cannot be undone.`)) return;
  const id = current.id;
  try {
    let { error: e } = await supabase.from("tradein_requests").delete().eq("id", id);
    if (e) throw e;

    requests = requests.filter(x => String(x.id) !== String(id));
    fullCache.delete(String(id));
    filesCache.delete(String(id));
    closeDetail();
    stats();
    render();

    /* Drop the back-reference in the background. */
    supabase.from("cars").update({ source_request_id: null }).eq("source_request_id", id);

    alert("Trade-in request deleted successfully.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to delete trade-in request");
  }
}

function closeDetail() {
  openToken++;
  $("tradeDetail").classList.remove("show");
  document.body.classList.remove("locked");
  current = null;
  currentFiles = [];
}

/* ---------------- EVENTS ---------------- */

let searchTimer;

grid.addEventListener("click", e => { let card = e.target.closest(".request-card"); if (card) viewRequest(card.dataset.id); });
$("searchInput").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 150); };
$("statusFilter").onchange = render;
$("sortFilter").onchange = render;
$("refreshBtn").onclick = () => load();
$("detailStatus").onchange = e => updateDetailStatus(e.target.value);
$("saveStatus").onclick = () => current && updateStatus(current.id, $("detailStatus").value);
$("deleteRequest").onclick = deleteRequest;
$("closeDetail").onclick = closeDetail;
$("detailBg").onclick = closeDetail;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && current && !document.querySelector(".trade-lightbox")) closeDetail();
});
$("menu").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show"); };
$("closeMenu").onclick = $("overlay").onclick = () => { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show"); };
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); location.replace("auth.html"); };

/* Bound once, instead of on every request that is opened. */
$("filesContent").onclick = (e) => {
  const card = e.target.closest("[data-lightbox-index]");
  if (!card) return;
  const items = currentFiles.map((f) => {
    const src = fileUrl(f);
    const kind = isVideoFile(f) ? "video" : "image";
    return {
      url: src,
      /* screen-sized for viewing, thumbnail-sized for the strip */
      view: kind === "video" ? src : optimizedUrl(src, 1400, 80),
      thumb: kind === "video" ? src : optimizedUrl(src, 140, 50),
      label: f.file_name || f.file_type || "File",
      kind
    };
  }).filter(it => it.url);
  const idx = Number(card.dataset.lightboxIndex);
  if (isNaN(idx)) return;
  openLightbox(items, idx);
};

(() => {
  const statusCard = document.querySelector(".status-card .status-controls");
  if (statusCard && !statusCard.querySelector(".download-btn")) {
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "download-btn";
    dl.style.width = "auto";
    dl.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Download`;
    dl.onclick = downloadTradeInForm;
    statusCard.appendChild(dl);
  }
})();

/* Returning to the tab refreshes quietly, at most once a minute, instead
   of running a full blocking reload every time. */
let lastRefresh = Date.now();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || current) return;
  if (Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  load({ silent: true });
});

/* ---------------- BOOT ---------------- */

requireAdmin("tradeins").then(allowed => {
  if (!allowed) return;
  load();
  markSectionSeen("tradeins");
  attachBadges();
});