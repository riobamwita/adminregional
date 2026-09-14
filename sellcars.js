import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";
import { markSectionSeen } from "./badges.js";import{attachBadges}from"./admin-nav.js";
const $ = id => document.getElementById(id);
const grid = $("requestsGrid");
const BUCKET = "car-images";
const SELL_BUCKET = "sell-car-files";

/* ---------------- helpers ---------------- */
const esc   = v => String(v ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
const money = v => Number(v || 0).toLocaleString("en-KE");
const date  = v => v ? new Date(v).toLocaleString("en-KE", { dateStyle:"medium", timeStyle:"short" }) : "—";
const phone = v => String(v || "").replace(/\D/g, "").replace(/^0/, "254");
const safe  = v => String(v || "image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g, "-");

/* ---------------- state ---------------- */
let requests = [];
let current = null;
let currentAdmin = null;
let adminEmails = new Set();
let currentFiles = [];
let editorCar = null;
let editorImages = [];
let editorIsInventory = false;
let lightboxImages = [];
let lightboxIndex = 0;

/* ---------------- editable fields ---------------- */
/* Each tuple: [key, label, type, full?] */
/* Full `cars` column set — every field on this page is editable. */
const carFields = [
  ["condition","Condition","text",true],
  ["make","Make","text"],
  ["model","Model","text"],
  ["trim","Trim / Grade","text"],
  ["year","Year","number"],
  ["price","Selling Price","number"],
  ["purchase_price","Purchase Price","number"],
  ["currency","Currency","text"],
  ["status","Status","select"],
  ["body_type","Body Type","text"],
  ["engine_size","Engine Size (L)","number"],
  ["engine_description","Engine Description","text",true],
  ["horsepower","Horsepower","number"],
  ["mileage","Mileage","number"],
  ["mileage_unit","Mileage Unit","text"],
  ["fuel_type","Fuel Type","text"],
  ["transmission","Transmission","text"],
  ["drive_type","Drive Type","text"],
  ["exterior_color","Exterior Colour","text"],
  ["interior_color","Interior Colour","text"],
  ["seats","Seats","number"],
  ["doors","Doors","number"],
  ["vin","VIN","text"],
  ["chassis_number","Chassis Number","text"],
  ["registration_number","Registration Number","text"],
  ["stock_number","Stock Number","text"],
  ["country_of_origin","Country Of Origin","text"],
  ["import_year","Import Year","number"],
  ["registration_year","Registration Year","number"],
  ["auction_grade","Auction Grade","text"],
  ["previous_owners","Previous Owners","number"],
  ["number_of_keys","Number Of Keys","number"],
  ["accident_history","Accident History","text",true],
  ["service_history","Service History","text",true],
  ["inspection_status","Inspection Status","text"],
  ["inspection_notes","Inspection Notes","textarea",true],
  ["location","Location","text"],
  ["city","City","text"],
  ["county","County","text"],
  ["showroom_name","Showroom / Yard","text"],
  ["latitude","Latitude","number"],
  ["longitude","Longitude","number"],
  ["agent_name","Agent Name","text"],
  ["agent_email","Agent Email","text"],
  ["key_features","Key Features","textarea",true],
  ["description","Description","textarea",true],
  ["model_3d_url","3D Model URL","text",true]
];
const numeric = new Set(carFields.filter(f => f[2] === "number").map(f => f[0]));
const statusOptions = ["available","reserved","sold"];

/* sell_car_requests column map — cars column → sell_car_requests column */
const requestMap = {
  make: "make", model: "model", year: "year", condition: "condition",
  body_type: "body_type", mileage: "mileage", fuel_type: "fuel_type",
  transmission: "transmission", exterior_color: "colour",
  registration_number: "registration", location: "location",
  price: "asking_price"
};

/* ---------------- auth ---------------- */
async function auth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace("auth.html"); return null; }
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,is_main_admin")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !data) { await supabase.auth.signOut(); location.replace("auth.html"); return null; }
  currentAdmin = data;
  return data;
}
async function loadAdmins() {
  const { data, error } = await supabase.from("admin_users").select("email");
  if (error) throw error;
  adminEmails = new Set((data || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean));
}
const isAgent     = x => adminEmails.has(String(x?.email || "").trim().toLowerCase());
const isMainAdmin = () => currentAdmin?.is_main_admin === true;

/* ---------------- load list ---------------- */
async function load() {
  $("loading").style.display = "block";
  grid.innerHTML = "";
  $("empty").style.display = "none";
  $("error").classList.remove("active");
  try {
    await auth();
    await loadAdmins();
    const { data, error } = await supabase
      .from("sell_car_requests")
      .select("*")
      .order("created_at", { ascending: false });
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
  $("contactedRequests").textContent = requests.filter(x => x.status === "contacted").length;
  $("inspectedRequests").textContent = requests.filter(x => x.status === "inspected").length;
  $("completedRequests").textContent = requests.filter(x => x.status === "approved" || x.approved_car_id).length;
}

const state = x => x.approved_car_id ? "approved" : (x.status || "new");

function render() {
  const q = ($("searchInput").value || "").toLowerCase().trim();
  const s = $("statusFilter").value;
  const o = $("sortFilter").value;

  let list = requests.filter(x => {
    const t = `${x.full_name || ""} ${x.phone || ""} ${x.email || ""} ${x.registration || ""} ${x.make || ""} ${x.model || ""} ${x.location || ""} ${x.condition || ""}`.toLowerCase();
    return (!q || t.includes(q)) && (s === "all" || state(x) === s);
  });

  list.sort((a, b) =>
    o === "oldest" ? new Date(a.created_at) - new Date(b.created_at)
    : o === "price-high" ? (b.asking_price || 0) - (a.asking_price || 0)
    : o === "price-low" ? (a.asking_price || 0) - (b.asking_price || 0)
    : new Date(b.created_at) - new Date(a.created_at));

  $("empty").style.display = list.length ? "none" : "block";

  grid.innerHTML = list.map(x => {
    const st = state(x);
    const agent = isAgent(x);
    const approved = !!x.approved_car_id;
    return `<article class="request-card ${agent ? "agent-request" : ""} ${approved ? "approved-request" : ""}" data-id="${esc(x.id)}"><div class="request-top"><div class="request-badges"><span class="request-status ${esc(st)}">${approved ? "in inventory" : esc(st)}</span>${agent ? `<span class="agent-tag"><i class="fa-solid fa-user-tie"></i> AGENT</span>` : ""}</div><small>${date(x.created_at)}</small></div><h3>${esc(x.make || "Vehicle")} ${esc(x.model || "")} ${esc(x.year || "")}</h3><p><i class="fa-solid fa-user"></i> ${esc(x.full_name || "—")}</p><p><i class="fa-solid fa-phone"></i> ${esc(x.phone || "—")}</p><div class="request-meta"><span>${esc(x.registration || "No registration")} · ${Number(x.mileage || 0).toLocaleString()} KM</span><strong>KES ${money(x.asking_price)}</strong></div><div class="request-bottom"><span>${esc(x.condition || "Condition —")}</span><button type="button">View <i class="fa-solid fa-arrow-right"></i></button></div></article>`;
  }).join("");
}

/* ---------------- detail modal ---------------- */
function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`;
}

function updateDetailStatus(s) {
  const b = $("detailStatusLabel");
  b.className = `large-status ${s || "new"}`;
  b.textContent = s === "approved" ? "IN INVENTORY" : String(s || "new").toUpperCase();
}

async function getFiles(id) {
  const { data, error } = await supabase
    .from("sell_car_files")
    .select("*")
    .eq("request_id", id)
    .order("created_at", { ascending: true });
  if (error) { console.error(error); return []; }
  return data || [];
}

function publicSellUrl(path) {
  return path ? supabase.storage.from(SELL_BUCKET).getPublicUrl(path).data.publicUrl : "";
}

function fileCard(f, i) {
  const url = publicSellUrl(f.storage_path);
  const type = f.file_type || "";
  const image = type.startsWith("image/");
  const video = type.startsWith("video/");
  const icon = video ? "fa-video" : type === "application/pdf" ? "fa-file-pdf" : "fa-file";
  return `<div class="file-item">
    ${image
      ? `<img src="${esc(url)}" data-lightbox-index="${i}" alt="${esc(f.file_name || "")}" loading="lazy">`
      : video
      ? `<video src="${esc(url)}" controls></video>`
      : `<div class="file-icon"><i class="fa-solid ${icon}"></i></div>`}
    <div class="file-info">
      <strong>${esc(f.field_name || "File")}</strong>
      <span>${esc(f.file_name || "")}</span>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open File</a>` : ""}
    </div>
  </div>`;
}

async function openRequest(id) {
  current = requests.find(x => String(x.id) === String(id));
  if (!current) return;

  const status = state(current);
  const agent = isAgent(current);

  $("modalTitle").textContent = `${current.make || "Vehicle"} ${current.model || ""} ${current.year || ""} — ${current.full_name || "Customer"}`.trim();
  $("detailDate").textContent = date(current.created_at);
  $("modalStatus").value = status;
  updateDetailStatus(status);

  $("agentBanner").innerHTML = agent
    ? `<div class="agent-banner"><i class="fa-solid fa-user-tie"></i><div><strong>AGENT SUBMISSION</strong><span>This request was submitted using an administrator email.</span></div></div>`
    : "";

  $("customerDetails").innerHTML = [
    field("Full Name", current.full_name),
    field("Phone / WhatsApp", current.phone),
    field("Email", current.email),
    field("ID / Passport", current.id_number),
    field("Location", current.location),
    field("Contact Time", current.contact_time || "Any Time")
  ].join("");

  const p = phone(current.phone);
  $("contactActions").innerHTML = [
    p ? `<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Customer</a>` : "",
    p ? `<a class="contact-action-large whatsapp" href="https://wa.me/${esc(p)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>` : "",
    current.email ? `<a class="contact-action-large" href="mailto:${esc(current.email)}"><i class="fa-solid fa-envelope"></i>Email Customer</a>` : ""
  ].join("");

  $("financialDetails").innerHTML = [
    field("Asking Price", `KES ${money(current.asking_price)}`),
    field("Negotiable", current.negotiable),
    field("Outstanding Loan", current.loan),
    field("Open to Trade-In", current.trade_in)
  ].join("");

  $("additionalDetails").innerHTML = [
    field("Additional Information", current.additional_info),
    field("Submitted", date(current.created_at)),
    field("Request ID", current.id),
    field("Status", status)
  ].join("");

  $("vehicleTitle").textContent = `${current.make || "Vehicle"} ${current.model || ""} ${current.year || ""}`.trim();
  $("vehicleMeta").textContent = [current.registration, current.location].filter(Boolean).join(" • ") || "Sell-in vehicle";

  $("vehicleDetails").innerHTML = [
    field("Condition", current.condition),
    field("Make", current.make),
    field("Model", current.model),
    field("Year", current.year),
    field("Registration", current.registration),
    field("Colour", current.colour),
    field("Mileage", current.mileage != null ? `${Number(current.mileage).toLocaleString()} km` : "—"),
    field("Transmission", current.transmission),
    field("Fuel Type", current.fuel_type),
    field("Engine", current.engine_cc ? `${current.engine_cc} CC` : "—"),
    field("Body Type", current.body_type),
    field("Accident History", current.accident_history)
  ].join("");

  $("approvalContent").innerHTML = approvalPanel();

  /* files */
  currentFiles = await getFiles(id);
  lightboxImages = currentFiles
    .filter(f => String(f.file_type || "").startsWith("image/"))
    .map(f => publicSellUrl(f.storage_path))
    .filter(Boolean);
  $("filesContent").innerHTML = currentFiles.length
    ? `<div class="files-grid">${currentFiles.map(fileCard).join("")}</div>`
    : `<div class="notes"><p>No vehicle files were submitted.</p></div>`;

  bindRequestActions();
  $("requestModal").classList.add("show");
  document.body.classList.add("locked");
}

function bindRequestActions() {
  $("openInventoryBtn")?.addEventListener("click", () => openEditor(current.approved_car_id));
  $("negotiatedPrice")?.addEventListener("input", updateProfit);
  $("inventoryPrice")?.addEventListener("input", updateProfit);
  $("approveInventory")?.addEventListener("click", approveToInventory);
  document.querySelectorAll("[data-lightbox-index]").forEach(x => {
    x.onclick = () => openLightbox(Number(x.dataset.lightboxIndex));
  });
  updateProfit();
}

function updateProfit() {
  const buy = Number($("negotiatedPrice")?.value || 0);
  const sell = Number($("inventoryPrice")?.value || 0);
  const p = sell - buy;
  const e = $("profitValue");
  if (e) { e.textContent = `KES ${money(p)}`; e.className = p < 0 ? "profit-negative" : "profit-positive"; }
}

/* ---------------- approval panel ---------------- */
function approvalPanel() {
  if (!current) return "";
  if (current.approved_car_id) {
    const p = Number(current.inventory_price || 0) - Number(current.negotiated_price || 0);
    return `<section class="approval-panel">
      <div class="approval-title">
        <div><i class="fa-solid fa-circle-check"></i></div>
        <div><span>INVENTORY STATUS</span><h3>Vehicle Approved & Added</h3></div>
      </div>
      <div class="approval-summary">
        <div><span>Purchase Price</span><strong>KES ${money(current.negotiated_price)}</strong></div>
        <div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div>
        <div><span>Estimated Gross Profit</span><strong class="${p >= 0 ? "profit-positive" : "profit-negative"}">KES ${money(p)}</strong></div>
      </div>
      <div style="margin-top:12px">
        <button type="button" class="inventory-btn" id="openInventoryBtn"><i class="fa-solid fa-pen-to-square"></i> Open Vehicle Editor</button>\r\n        <a class="inventory-btn" style="margin-left:8px;display:inline-block;text-decoration:none" href="edit.html?id=${encodeURIComponent(current.approved_car_id)}"><i class="fa-solid fa-up-right-from-square"></i> Open Full Inventory Page</a>
      </div>
    </section>`;
  }
  if (!isMainAdmin()) {
    return `<section class="approval-panel locked-panel">
      <div class="approval-title">
        <div><i class="fa-solid fa-lock"></i></div>
        <div><span>INVENTORY APPROVAL</span><h3>Main Admin Approval Required</h3>
        <p>Only the main administrator can approve this vehicle and move it into inventory.</p></div>
      </div>
    </section>`;
  }
  return `<section class="approval-panel">
    <div class="approval-title">
      <div><i class="fa-solid fa-handshake"></i></div>
      <div><span>INVENTORY APPROVAL</span><h3>Approve & Add to Inventory</h3>
      <p>Enter the actual negotiated purchase price and inventory selling price.</p></div>
    </div>
    <div class="asking-price">
      <span>Seller Asking Price</span>
      <strong>KES ${money(current.asking_price)}</strong>
    </div>
    <div class="approval-grid">
      <div><label>Negotiated Purchase Price *</label>
        <input id="negotiatedPrice" type="number" min="0" value="${current.negotiated_price ?? ""}"></div>
      <div><label>Inventory Selling Price *</label>
        <input id="inventoryPrice" type="number" min="0" value="${current.inventory_price ?? ""}"></div>
    </div>
    <div class="profit-box">
      <div><span>Estimated Gross Profit</span><strong id="profitValue">KES 0</strong></div>
      <small>Selling price minus negotiated purchase price.</small>
    </div>
    <button id="approveInventory" type="button" class="approve-btn"><i class="fa-solid fa-car-side"></i> Approve & Add to Inventory</button>
  </section>`;
}

/* ---------------- editor ---------------- */
function editorValue(key) {
  if (editorCar) return editorCar[key] ?? "";
  return current?.[requestMap[key] || key] ?? "";
}

function editorHTML() {
  return carFields.map(([key, label, type, priority]) => {
    const v = editorValue(key);
    const input = type === "textarea"
      ? `<textarea id="ed_${key}">${esc(v)}</textarea>`
      : type === "select"
      ? `<select id="ed_${key}">${statusOptions.map(o => `<option value="${o}" ${String(v) === o ? "selected" : ""}>${o}</option>`).join("")}</select>`
      : `<input id="ed_${key}" type="${type}" value="${esc(v)}">`;
    return `<div class="editor-field ${priority ? "priority" : ""}"><label>${esc(label)}</label>${input}</div>`;
  }).join("");
}

async function loadEditorImages(carId) {
  if (!carId) return [];
  const { data, error } = await supabase
    .from("car_images").select("*").eq("car_id", carId).order("display_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

function editorGalleryHTML() {
  const display = editorCar?.display_image_url;
  return editorImages.map((x, i) => `
    <div class="editor-image">
      ${display && x.image_url === display ? `<span class="display-mark">DISPLAY</span>` : ""}
      <img src="${esc(x.image_url)}" data-editor-lightbox="${i}" alt="">
      <div class="editor-image-actions">
        <button class="make-display" data-display="${i}" type="button">Display</button>
        <button class="delete-editor-image" data-delete="${i}" type="button">Delete</button>
      </div>
    </div>
  `).join("");
}

function renderEditorGallery() {
  $("editorGallery").innerHTML = editorImages.length
    ? editorGalleryHTML()
    : "<p class='notes'>No gallery images.</p>";
  document.querySelectorAll("[data-editor-lightbox]").forEach(x => {
    x.onclick = () => {
      const imgs = editorImages.map(im => im.image_url);
      openLightboxUrl(imgs, Number(x.dataset.editorLightbox));
    };
  });
  document.querySelectorAll("[data-delete]").forEach(x => {
    x.onclick = () => deleteEditorImage(Number(x.dataset.delete));
  });
  document.querySelectorAll("[data-display]").forEach(x => {
    x.onclick = () => makeEditorDisplay(Number(x.dataset.display));
  });
}

async function openEditor(carId) {
  if (!current) return;
  try {
    if (carId) {
      const { data, error } = await supabase.from("cars").select("*").eq("id", carId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Inventory vehicle could not be found.");
      editorCar = data;
      editorImages = await loadEditorImages(carId);
      editorIsInventory = true;
      $("editorMode").textContent = "Editing the live inventory vehicle. Changes are saved to the cars record.";
    } else {
      editorCar = null;
      editorImages = [];
      editorIsInventory = false;
      $("editorMode").textContent = "Editing the incoming Sell-In vehicle information. Changes are saved to the request record.";
    }
    $("editorTitle").textContent = `Edit ${current.make || "Vehicle"} ${current.model || ""}`.trim();
    $("vehicleEditorFields").innerHTML = editorHTML();
    $("editorMessage").innerHTML = "";
    $("editorModal").classList.add("show");
    renderEditorGallery();
  } catch (e) {
    alert(e.message || "Unable to open vehicle editor.");
  }
}

async function saveEditor(e) {
  e.preventDefault();
  const btn = document.querySelector(".editor-save");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const updates = {};
    carFields.forEach(([key]) => {
      const el = $(`ed_${key}`);
      if (!el) return;
      const v = el.value.trim();
      updates[key] = v === "" ? null : numeric.has(key) ? Number(v) : v;
    });
    updates.updated_at = new Date().toISOString();

    if (editorCar) {
      const { error } = await supabase.from("cars").update(updates).eq("id", editorCar.id);
      if (error) throw error;
      editorCar = { ...editorCar, ...updates };
      if (current.approved_car_id === editorCar.id) {
        current = { ...current, ...requestMapUpdatesFromCar(updates) };
      }
    } else {
      const ru = {};
      Object.entries(updates).forEach(([k, v]) => {
        if (requestMap[k]) ru[requestMap[k]] = v;
      });
      const { error } = await supabase
        .from("sell_car_requests")
        .update({ ...ru, updated_at: new Date().toISOString() })
        .eq("id", current.id);
      if (error) throw error;
      current = { ...current, ...ru };
      requests = requests.map(x => x.id === current.id ? current : x);
    }

    $("editorMessage").innerHTML = `<div class="success active">Vehicle saved successfully.</div>`;
    setTimeout(() => { closeEditor(); openRequest(current.id); }, 500);
  } catch (e) {
    console.error(e);
    $("editorMessage").innerHTML = `<div class="error active">${esc(e.message || "Unable to save vehicle.")}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Changes`;
  }
}

function requestMapUpdatesFromCar(updates) {
  const out = {};
  Object.entries(updates).forEach(([k, v]) => {
    const rk = Object.entries(requestMap).find(([, value]) => value === k)?.[0];
    if (rk) out[rk] = v;
  });
  return out;
}

async function uploadEditorImages(files) {
  if (!editorCar?.id) return alert("Approve the vehicle into inventory before adding gallery images.");
  for (const file of files) {
    try {
      const path = `${editorCar.id}/gallery/${crypto.randomUUID()}-${safe(file.name)}`;
      const u = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", upsert: false });
      if (u.error) throw u.error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const r = await supabase.from("car_images").insert({
        car_id: editorCar.id,
        image_url: url,
        storage_path: path,
        image_type: "gallery",
        display_order: editorImages.length
      }).select().single();
      if (r.error) { await supabase.storage.from(BUCKET).remove([path]); throw r.error; }
      editorImages.push(r.data);
    } catch (e) {
      alert(e.message || "Unable to upload image.");
    }
  }
  renderEditorGallery();
}

async function deleteEditorImage(i) {
  const image = editorImages[i];
  if (!image || !confirm("Delete this gallery image?")) return;
  try {
    if (image.storage_path) {
      const r = await supabase.storage.from(BUCKET).remove([image.storage_path]);
      if (r.error) throw r.error;
    }
    const { error } = await supabase.from("car_images").delete().eq("id", image.id);
    if (error) throw error;
    editorImages.splice(i, 1);
    renderEditorGallery();
  } catch (e) {
    alert(e.message || "Unable to delete image.");
  }
}

async function makeEditorDisplay(i) {
  const image = editorImages[i];
  if (!image || !editorCar) return;
  try {
    const { error } = await supabase.from("cars").update({
      display_image_url: image.image_url,
      display_image_path: image.storage_path,
      updated_at: new Date().toISOString()
    }).eq("id", editorCar.id);
    if (error) throw error;
    editorCar = { ...editorCar, display_image_url: image.image_url, display_image_path: image.storage_path };
    renderEditorGallery();
  } catch (e) {
    alert(e.message || "Unable to set display image.");
  }
}

/* ---------------- approve into inventory ---------------- */
async function approveToInventory() {
  if (!current || !isMainAdmin()) return alert("Only the main administrator can approve vehicles into inventory.");
  if (current.approved_car_id) return alert("This request has already been added to inventory.");

  const buy = Number($("negotiatedPrice")?.value);
  const sell = Number($("inventoryPrice")?.value);
  if (!Number.isFinite(buy) || buy < 0) return alert("Enter a valid negotiated purchase price.");
  if (!Number.isFinite(sell) || sell <= 0) return alert("Enter a valid inventory selling price.");
  if (!confirm(`Approve ${current.make || "vehicle"} and add it to inventory for KES ${money(sell)}?`)) return;

  const b = $("approveInventory");
  b.disabled = true;
  b.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding...`;

  try {
    const { data: { session } } = await supabase.auth.getSession();

    const existing = await supabase
      .from("cars").select("*").eq("source_request_id", current.id).maybeSingle();
    if (existing.error) throw existing.error;

    let car = existing.data;

    if (!car) {
      const cd = {
        make: current.make || null,
        model: current.model || null,
        year: current.year ? Number(current.year) : null,
        price: sell,
        purchase_price: buy,
        condition: current.condition || null,
        body_type: current.body_type || null,
        mileage: current.mileage != null ? Number(current.mileage) : null,
        fuel_type: current.fuel_type || null,
        transmission: current.transmission || null,
        engine_size: current.engine_cc != null ? Number(current.engine_cc) / 1000 : null,
        registration_number: current.registration || null,
        location: current.location || null,
        city: current.location || null,
        exterior_color: current.colour || null,
        accident_history: current.accident_history || null,
        negotiable: String(current.negotiable || "").toLowerCase() === "yes" || current.negotiable === true,
        status: "available",
        featured: false,
        financing_available: false,
        test_drive_available: true,
        source_request_id: current.id,
        source_type: "sell_in",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const r = await supabase.from("cars").insert(cd).select().single();
      if (r.error) throw r.error;
      car = r.data;
    }

    /* move images */
    const imgs = currentFiles.filter(f => String(f.file_type || "").startsWith("image/") && f.storage_path);
    for (let i = 0; i < imgs.length && !existing.data; i++) {
      const d = await supabase.storage.from(SELL_BUCKET).download(imgs[i].storage_path);
      if (d.error) throw d.error;
      const path = `${car.id}/gallery/${crypto.randomUUID()}-${safe(imgs[i].file_name)}`;
      const u = await supabase.storage.from(BUCKET).upload(path, d.data, { cacheControl: "3600", upsert: false });
      if (u.error) throw u.error;
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const r = await supabase.from("car_images").insert({
        car_id: car.id, image_url: url, storage_path: path,
        image_type: "gallery", display_order: i
      });
      if (r.error) throw r.error;
      if (i === 0) {
        await supabase.from("cars").update({ display_image_url: url, display_image_path: path }).eq("id", car.id);
      }
    }

    const now = new Date().toISOString();
    const u = {
      status: "approved",
      negotiated_price: buy,
      inventory_price: sell,
      approved_car_id: car.id,
      approved_at: now,
      approved_by: session.user.id,
      updated_at: now
    };
    const { error } = await supabase.from("sell_car_requests").update(u).eq("id", current.id).is("approved_car_id", null);
    if (error) throw error;

    current = { ...current, ...u };
    requests = requests.map(x => x.id === current.id ? current : x);
    closeRequest();
    await load();
    alert("Vehicle approved and added to inventory.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to add vehicle to inventory.");
  } finally {
    b.disabled = false;
    b.innerHTML = `<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`;
  }
}

/* ---------------- status / delete ---------------- */
async function saveStatus() {
  if (!current) return;
  const s = $("modalStatus").value;
  if (current.approved_car_id && s !== "approved" && !confirm("This request is already linked to an inventory vehicle. Change its request status anyway?")) return;
  const { error } = await supabase.from("sell_car_requests")
    .update({ status: s, updated_at: new Date().toISOString() })
    .eq("id", current.id);
  if (error) return alert(error.message);
  current.status = s;
  requests = requests.map(x => x.id === current.id ? current : x);
  updateDetailStatus(s);
  stats();
  render();
}

async function deleteRequest() {
  if (!current || !confirm(`Delete sell request from ${current.full_name || "this customer"}?`)) return;
  if (current.approved_car_id) return alert("This request has already been converted into an inventory vehicle. Delete the vehicle first.");
  try {
    const { data, error: e } = await supabase.from("sell_car_files").select("storage_path").eq("request_id", current.id);
    if (e) throw e;
    const paths = (data || []).map(x => x.storage_path).filter(Boolean);
    if (paths.length) {
      const r = await supabase.storage.from(SELL_BUCKET).remove(paths);
      if (r.error) throw r.error;
    }
    const { error } = await supabase.from("sell_car_requests").delete().eq("id", current.id);
    if (error) throw error;
    closeRequest();
    load();
  } catch (e) {
    alert(e.message || "Unable to delete request.");
  }
}

/* ---------------- modal open/close ---------------- */
function closeRequest() {
  $("requestModal").classList.remove("show");
  document.body.classList.remove("locked");
  current = null;
  currentFiles = [];
}
function closeEditor() { $("editorModal").classList.remove("show"); }

/* ---------------- lightbox ---------------- */
function openLightbox(i) {
  openLightboxUrl(lightboxImages, i);
}
function openLightboxUrl(images, i) {
  lightboxImages = images.filter(Boolean);
  if (!lightboxImages.length) return;
  lightboxIndex = Math.max(0, Math.min(i, lightboxImages.length - 1));
  $("lightboxImage").src = lightboxImages[lightboxIndex];
  $("lightboxCount").textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  $("lightbox").classList.add("show");
}
function lightboxMove(n) {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex + n + lightboxImages.length) % lightboxImages.length;
  $("lightboxImage").src = lightboxImages[lightboxIndex];
  $("lightboxCount").textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
}
function closeLightbox() { $("lightbox").classList.remove("show"); }

/* ---------------- download form ---------------- */
function downloadForm() {
  if (!current) return;
  const rows = (title, obj) =>
    `<h2>${title}</h2><table>${Object.entries(obj).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v || "—")}</td></tr>`).join("")}</table>`;

  const imgs = lightboxImages.map(x => `<img class="print-image" src="${esc(x)}">`).join("");

  $("printForm").innerHTML = `
    <div class="print-head">
      <div><h1>REGIONAL AUTOSELECTIONS LTD</h1><div class="print-small">SELL-IN VEHICLE VALUATION FORM</div></div>
      <div class="print-small">Generated: ${date(new Date())}</div>
    </div>
    ${rows("Request Information", { "Request ID": current.id, "Date": date(current.created_at), "Status": state(current), "Agent Submission": isAgent(current) ? "Yes" : "No" })}
    ${rows("Seller Information", { "Full Name": current.full_name, "Phone": current.phone, "Email": current.email, "ID / Passport": current.id_number, "Location": current.location, "Contact Time": current.contact_time })}
    ${rows("Vehicle Information", { "Condition": current.condition, "Make": current.make, "Model": current.model, "Year": current.year, "Registration": current.registration, "Colour": current.colour, "Mileage": current.mileage ? `${Number(current.mileage).toLocaleString()} KM` : "—", "Transmission": current.transmission, "Fuel Type": current.fuel_type, "Engine": current.engine_cc ? `${current.engine_cc} CC` : "—", "Body Type": current.body_type, "Accident History": current.accident_history })}
    ${rows("Financial Information", { "Asking Price": `KES ${money(current.asking_price)}`, "Negotiable": current.negotiable, "Outstanding Loan": current.loan, "Open to Trade-In": current.trade_in, "Negotiated Purchase": current.negotiated_price ? `KES ${money(current.negotiated_price)}` : "—", "Inventory Price": current.inventory_price ? `KES ${money(current.inventory_price)}` : "—" })}
    ${rows("Additional Information", { "Additional Information": current.additional_info })}
    <h2>Submitted Photos</h2>
    <div>${imgs || "No photos submitted."}</div>
  `;
  window.print();
}

/* ---------------- events ---------------- */
grid.addEventListener("click", e => {
  const card = e.target.closest(".request-card");
  if (card) openRequest(card.dataset.id);
});
$("searchInput").oninput = render;
$("statusFilter").onchange = render;
$("sortFilter").onchange = render;
$("refreshBtn").onclick = load;
$("modalStatus").onchange = e => updateDetailStatus(e.target.value);
$("saveStatus").onclick = saveStatus;
$("deleteRequest").onclick = deleteRequest;
$("closeRequest").onclick = closeRequest;
$("closeRequestBg").onclick = closeRequest;
$("editVehicleBtn").onclick = () => openEditor(current?.approved_car_id);
$("downloadForm").onclick = downloadForm;

$("closeEditor").onclick = closeEditor;
$("cancelEditor").onclick = closeEditor;
$("closeEditorBg").onclick = closeEditor;
$("vehicleEditorForm").onsubmit = saveEditor;
$("editorGalleryInput").onchange = e => { uploadEditorImages([...e.target.files]); e.target.value = ""; };
$("editorDisplayInput").onchange = async e => {
  const f = e.target.files[0];
  if (!f || !editorCar) return;
  try {
    const path = `${editorCar.id}/display/${crypto.randomUUID()}-${safe(f.name)}`;
    const u = await supabase.storage.from(BUCKET).upload(path, f, { cacheControl: "3600", upsert: false });
    if (u.error) throw u.error;
    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const old = editorCar.display_image_path;
    const r = await supabase.from("cars").update({ display_image_url: url, display_image_path: path, updated_at: new Date().toISOString() }).eq("id", editorCar.id);
    if (r.error) throw r.error;
    editorCar = { ...editorCar, display_image_url: url, display_image_path: path };
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    renderEditorGallery();
  } catch (e) { alert(e.message || "Unable to replace display image."); }
  e.target.value = "";
};

$("lightboxClose").onclick = closeLightbox;
$("lightboxBg").onclick = closeLightbox;
$("lightboxPrev").onclick = () => lightboxMove(-1);
$("lightboxNext").onclick = () => lightboxMove(1);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if ($("lightbox").classList.contains("show")) closeLightbox();
    else if ($("editorModal").classList.contains("show")) closeEditor();
    else if (current) closeRequest();
  }
  if ($("lightbox").classList.contains("show")) {
    if (e.key === "ArrowLeft") lightboxMove(-1);
    if (e.key === "ArrowRight") lightboxMove(1);
  }
});

$("menu").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show"); };
$("closeMenu").onclick = $("overlay").onclick = () => { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show"); };
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); location.replace("auth.html"); };
window.addEventListener("load", () => setTimeout(() => $("loader")?.classList.add("hide"), 450));

/* ---------------- boot ---------------- */
requireAdmin("sellcars").then(async allowed => { if (!allowed) return; await auth(); load();markSectionSeen("sellcars");attachBadges(); });