import { supabase } from "./supabase.js";
import{requireAdmin}from"./admin-guard.js";import{markSectionSeen}from"./badges.js";import{attachBadges}from"./admin-nav.js";
const $ = id => document.getElementById(id);
const grid = $("requestsGrid");
const BUCKET = "car-images";

const esc = v => String(v ?? "—").replace(/[&<>"']/g,
  m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const money = v => Number(v || 0).toLocaleString("en-KE");
const date = v => v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dash = v => (v === null || v === undefined || v === "" ? "—" : v);

let requests = [], current = null, currentAdmin = null, adminEmails = new Set(), currentFiles = [];

const statuses = ["new", "reviewing", "valued", "completed", "rejected"];

/* Editable fields on the trade-in modal (writes to tradein_requests) */
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

/* Tradein field → cars column mapping, for post-approval sync */
const TRADEIN_TO_CAR_FIELD = {
  vehicle_make:  "make",
  vehicle_model: "model",
  vehicle_year:  "year",
  registration:  "registration_number",
  body_type:     "body_type",
  fuel_type:     "fuel_type",
  transmission:  "transmission",
  mileage:       "mileage",
  colour:        "exterior_color",
  condition:     "condition",
  location:      "location"
};

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
  if (error) throw error;
  adminEmails = new Set((data || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean));
}

const isAgent = x => adminEmails.has(String(x?.email || "").trim().toLowerCase());
const isMainAdmin = () => currentAdmin?.is_main_admin === true;

async function load() {
  $("loading").style.display = "block";
  grid.innerHTML = "";
  $("empty").style.display = "none";
  $("error").classList.remove("active");
  try {
    await auth();
    await loadAdmins();
    let { data, error } = await supabase.from("tradein_requests").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    requests = data || [];
    stats();
    render();
  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load requests.";
    $("error").classList.add("active");
  } finally {
    $("loading").style.display = "none";
  }
}

function stats() {
  $("totalRequests").textContent = requests.length;
  $("newRequests").textContent = requests.filter(x => (x.status || "new") === "new").length;
  $("reviewingRequests").textContent = requests.filter(x => x.status === "reviewing").length;
  $("completedRequests").textContent = requests.filter(x => x.approved_car_id || x.status === "approved").length;
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
    return `<article class="request-card" data-id="${esc(x.id)}">
      <div class="request-top"><small>${esc(date(x.created_at))}</small>
      <span class="request-status ${esc(st)}">${esc(x.approved_car_id ? "in inventory" : st)}</span></div>
      <h3>${esc(x.full_name || "Customer")}</h3>
      <p><i class="fa-solid fa-phone"></i> ${esc(x.phone || "—")}</p>
      <p><i class="fa-solid fa-envelope"></i> ${esc(x.email || "—")}</p>
      <div class="request-meta"><span>${esc(`${x.vehicle_make || ""} ${x.vehicle_model || ""}`.trim() || "Vehicle not specified")}</span><strong>KES ${money(x.expected_value)}</strong></div>
      <div class="request-bottom"><span>${esc(x.registration || "No registration")}</span>
      <button type="button">View Request <i class="fa-solid fa-arrow-right"></i></button></div>
    </article>`;
  }).join("");
}

function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(dash(value))}</strong></div>`;
}

/* ---------------- FILES ---------------- */

async function getFiles(id) {
  let { data, error } = await supabase.from("tradein_files").select("*").eq("tradein_id", id).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
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
    media = `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy"
      data-lightbox-index="${index}" data-lightbox-kind="image"
      onerror="this.parentElement.innerHTML='<div class=&quot;file-icon&quot;><i class=&quot;fa-solid fa-image&quot;></i></div>'">`;
  } else if (video) {
    media = `<video src="${esc(url)}" preload="metadata" muted
      data-lightbox-index="${index}" data-lightbox-kind="video"
      onerror="this.parentElement.innerHTML='<div class=&quot;file-icon&quot;><i class=&quot;fa-solid fa-video&quot;></i></div>'"></video>`;
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
        if (f.k === "defect_details" && Array.isArray(current.defects) && !value) {
          /* fallback: nothing */
        }
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

    const { error } = await supabase
      .from("tradein_requests")
      .update(updates)
      .eq("id", current.id);
    if (error) throw error;

    /* If already linked to a car in some edge case, sync anyway */
    if (current.approved_car_id) {
      const carUpdates = {};
      Object.entries(TRADEIN_TO_CAR_FIELD).forEach(([subKey, carKey]) => {
        if (subKey in updates) carUpdates[carKey] = updates[subKey];
      });
      if ("location" in updates) {
        carUpdates.location = updates.location;
        carUpdates.city = updates.location;
      }
      if (Object.keys(carUpdates).length) {
        carUpdates.updated_at = new Date().toISOString();
        await supabase.from("cars").update(carUpdates).eq("id", current.approved_car_id);
      }
    }

    /* Update local state */
    current = { ...current, ...updates };
    requests = requests.map(x => x.id === current.id ? current : x);

    /* Re-render read-only sections */
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

    render();

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
        : `<img src="${esc(im.url)}" alt="">`}
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
      img.src = item.url;
      img.alt = item.label || "";
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
      <img src="${esc(fileUrl(f))}" alt="">
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

function renderContact() {
  let p = String(current.phone || "").replace(/\D/g, "").replace(/^0/, "254");
  let e = current.email || "";
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

async function viewRequest(id) {
  current = requests.find(x => String(x.id) === String(id));
  if (!current) return;
  try {
    currentFiles = await getFiles(id);
    let status = current.approved_car_id ? "approved" : (current.status || "new");
    let agent = isAgent(current);
    $("detailTitle").textContent = `${current.full_name || "Customer"} — ${current.vehicle_make || ""} ${current.vehicle_model || ""}`.trim();
    $("detailDate").textContent = date(current.created_at);
    $("detailStatus").value = current.status || "new";
    updateDetailStatus(status);

    $("agentBanner").innerHTML = agent
      ? `<div class="agent-banner"><i class="fa-solid fa-user-tie"></i><div><strong>AGENT SUBMISSION</strong><span>This request was submitted using an administrator email.</span></div></div>`
      : "";

    $("customerDetails").innerHTML = [
      field("Full Name", current.full_name), field("Phone", current.phone), field("Email", current.email),
      field("Location", current.location), field("ID / Passport", current.id_number), field("Contact Time", current.contact_time)
    ].join("");

    /* NEW: build the editable vehicle form */
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
      field("Notes", current.notes), field("Request ID", current.id)
    ].join("");

    renderContact();
    $("approvalContent").innerHTML = approvalPanel();

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

    $("valuationDetails").innerHTML = [
      field("Expected Value", `KES ${money(current.expected_value)}`),
      field("Negotiated Value", current.negotiated_price != null ? `KES ${money(current.negotiated_price)}` : "—"),
      field("Inventory Price", current.inventory_price != null ? `KES ${money(current.inventory_price)}` : "—"),
      field("Estimated Profit", current.inventory_price != null && current.negotiated_price != null ? `KES ${money(Number(current.inventory_price) - Number(current.negotiated_price))}` : "—")
    ].join("");

    $("filesContent").innerHTML = currentFiles.length
      ? `<div class="files-grid">${currentFiles.map((f, i) => fileCard(f, i)).join("")}</div>`
      : `<div class="notes"><p>No vehicle files were submitted.</p></div>`;

    $("tradeDetail").classList.add("show");
    document.body.classList.add("locked");

    /* Download button in the status card (once) */
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

    /* Lightbox */
    $("filesContent").onclick = (e) => {
      const card = e.target.closest("[data-lightbox-index]");
      if (!card) return;
      const items = currentFiles.map((f) => ({
        url: fileUrl(f),
        label: f.file_name || f.file_type || "File",
        kind: isVideoFile(f) ? "video" : "image"
      })).filter(it => it.url);
      const idx = Number(card.dataset.lightboxIndex);
      if (isNaN(idx)) return;
      openLightbox(items, idx);
    };

    if (!current.approved_car_id && isMainAdmin()) {
      $("negotiatedPrice")?.addEventListener("input", updateProfit);
      $("inventoryPrice")?.addEventListener("input", updateProfit);
      $("approveInventory")?.addEventListener("click", approveToInventory);
      updateProfit();
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
  let response = await fetch(url);
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
  try {
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please log in again.");
    let check = await supabase.from("tradein_requests").select("approved_car_id").eq("id", current.id).maybeSingle();
    if (check.error) throw check.error;
    if (check.data?.approved_car_id) throw new Error("This request has already been approved by another administrator.");
    let existing = await supabase.from("cars").select("id").eq("source_request_id", current.id).maybeSingle();
    if (existing.error) throw existing.error;
    let car;
    if (existing.data) {
      car = existing.data;
    } else {
      let carData = {
        make: current.vehicle_make || null, model: current.vehicle_model || null,
        year: current.vehicle_year ? Number(current.vehicle_year) : null,
        price: sell, purchase_price: buy,
        condition: current.condition || null, body_type: current.body_type || null,
        mileage: current.mileage != null && current.mileage !== "" ? Number(current.mileage) : null,
        fuel_type: current.fuel_type || null, transmission: current.transmission || null,
        registration_number: current.registration || null,
        location: current.location || null, city: current.location || null,
        exterior_color: current.colour || null,
        status: "available", featured: false, financing_available: false, test_drive_available: true,
        source_request_id: current.id, source_type: "trade_in",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      let r = await supabase.from("cars").insert(carData).select().single();
      if (r.error) {
        if (r.error.code === "23505") {
          let q = await supabase.from("cars").select("*").eq("source_request_id", current.id).single();
          if (q.error) throw q.error;
          car = q.data;
        } else throw r.error;
      } else car = r.data;
    }
    let images = imageFiles();
    if (!existing.data) for (let i = 0; i < images.length; i++) {
      let copied = await copyImageToCar(images[i], car.id, i);
      uploaded.push(copied.storage_path);
      let { error: imageError } = await supabase.from("car_images").insert({
        car_id: car.id, image_url: copied.image_url, storage_path: copied.storage_path,
        image_type: "gallery", display_order: i
      });
      if (imageError) throw imageError;
      if (i === 0) {
        let { error: displayError } = await supabase.from("cars").update({
          display_image_url: copied.image_url, display_image_path: copied.storage_path
        }).eq("id", car.id);
        if (displayError) throw displayError;
      }
    }
    let now = new Date().toISOString();
    let requestUpdate = {
      status: "approved", negotiated_price: buy, inventory_price: sell,
      approved_car_id: car.id, approved_at: now, approved_by: session.user.id, updated_at: now
    };
    let { error: updateError } = await supabase.from("tradein_requests").update(requestUpdate).eq("id", current.id).is("approved_car_id", null);
    if (updateError) throw updateError;
    current = { ...current, ...requestUpdate };
    requests = requests.map(x => x.id === current.id ? current : x);
    alert(`Vehicle approved and successfully added to inventory.${images.length ? ` ${images.length} image(s) were transferred.` : ""}`);
    closeDetail();
    load();
  } catch (e) {
    console.error(e);
    if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded);
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
  let x = requests.find(x => x.id === id);
  if (x) x.status = status;
  if (current) current.status = status;
  updateDetailStatus(current?.approved_car_id ? "approved" : status);
  stats();
  render();
  $("saveStatus").disabled = false;
}

async function deleteRequest() {
  if (!current) return;
  if (!confirm(`Delete trade-in request from ${current.full_name || "this customer"}? This cannot be undone.`)) return;
  const id = current.id;
  try {
    let { data: files, error } = await supabase.from("tradein_files").select("file_url,file_name").eq("tradein_id", id);
    if (error) throw error;
    let { error: e } = await supabase.from("tradein_requests").delete().eq("id", id);
    if (e) throw e;
    requests = requests.filter(x => x.id !== id);
    closeDetail();
    stats();
    render();
    alert("Trade-in request deleted successfully.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to delete trade-in request");
  }
}

function closeDetail() {
  $("tradeDetail").classList.remove("show");
  document.body.classList.remove("locked");
  current = null;
  currentFiles = [];
}

/* ---------------- EVENTS ---------------- */

grid.addEventListener("click", e => { let card = e.target.closest(".request-card"); if (card) viewRequest(card.dataset.id); });
$("searchInput").oninput = render;
$("statusFilter").onchange = render;
$("sortFilter").onchange = render;
$("refreshBtn").onclick = load;
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
window.addEventListener("load", () => setTimeout(() => $("loader")?.classList.add("hide"), 450));

requireAdmin("tradeins").then(async allowed => { if (!allowed) return; await auth(); load();markSectionSeen("tradeins");attachBadges(); });