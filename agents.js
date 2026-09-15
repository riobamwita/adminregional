import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";
import { insertSafe, updateSafe } from "./db-safe.js";
import{markSectionSeen}from"./badges.js";import{attachBadges}from"./admin-nav.js";
const $ = id => document.getElementById(id);
const grid = $("requestsGrid");

const SUBMISSION_BUCKET = "agent-vehicle-files";
const CAR_BUCKET = "car-images";
const SIGNED_URL_TTL = 60 * 60 * 24; // 24h

const CATS = {
  front: "Front", front_left: "Front-left", left_side: "Left side",
  rear_left: "Rear-left", rear: "Rear", rear_right: "Rear-right",
  right_side: "Right side", front_right: "Front-right",
  interior_front: "Interior – front", interior_rear: "Interior – rear",
  dashboard: "Dashboard", odometer: "Odometer", engine_bay: "Engine bay",
  wheels_tyres: "Wheels / tyres", damage_feature: "Damage / notable feature"
};

/* Submission column → cars column mapping, for mirroring edits into inventory */
const SUBMISSION_TO_CAR_FIELD={
listing_reference:"stock_number",make:"make",model:"model",trim:"trim",year:"year",body_type:"body_type",
engine_cc:"engine_size",engine_description:"engine_description",horsepower:"horsepower",fuel_type:"fuel_type",
transmission:"transmission",drive_type:"drive_type",mileage:"mileage",exterior_color:"exterior_color",
interior_color:"interior_color",seats:"seats",doors:"doors",vin:"vin",chassis_number:"chassis_number",
registration_number:"registration_number",stock_number:"stock_number",country_of_origin:"country_of_origin",
import_year:"import_year",registration_year:"registration_year",auction_grade:"auction_grade",
previous_owners:"previous_owners",accident_history:"accident_history",service_history:"service_history",
number_of_keys:"number_of_keys",condition:"condition",inspection_status:"inspection_status",
inspection_notes:"inspection_notes",location:"location",city:"city",county:"county",latitude:"latitude",
longitude:"longitude",location_accuracy:"location_accuracy",negotiable:"negotiable",
financing_available:"financing_available",test_drive_available:"test_drive_available",featured:"featured",
description:"description",key_features:"key_features",showroom_name:"showroom_name"
};

function buildCarUpdates(updates){
  const carUpdates={};
  Object.entries(SUBMISSION_TO_CAR_FIELD).forEach(([a,c])=>{
    if(a in updates) carUpdates[c]=updates[a];
  });
  if("inventory_price" in updates) carUpdates.price=updates.inventory_price;
  if("purchase_price" in updates) carUpdates.purchase_price=updates.purchase_price;
  if("town_area" in updates){
    carUpdates.location=updates.town_area;
    carUpdates.city=updates.town_area;
  }
  carUpdates.updated_at=new Date().toISOString();
  return carUpdates;
}

const esc = v => String(v ?? "").replace(/[&<>"']/g,
  m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const dash = v => (v === null || v === undefined || v === "" ? "—" : v);
const money = v => Number(v || 0).toLocaleString("en-KE");
const date = v => v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

/* Stable "RALxxxxxx" reference for submissions that don't have a real
   listing_reference yet — deterministic per submission id, so it never
   changes on re-render and never falls back to showing the raw UUID
   (which is also shown separately as the Submission ID). */
function hashDigits(str, len = 6) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return String(h % 10 ** len).padStart(len, "0");
}
const formatListingRef = sub =>
  sub?.listing_reference || `RAL${hashDigits(String(sub?.id || sub?.created_at || ""))}`;

/* Submission ID display uses the same RAL format but a different hash
   seed than formatListingRef, so the two labels never show an
   identical value even when listing_reference is unset. The real
   UUID (sub.id) is still used everywhere internally — queries, links,
   data-id attributes — this is display-only. */
const formatSubmissionRef = sub => `RAL${hashDigits(`SUB-${sub?.id || ""}`)}`;

let submissions = [];
let current = null;
let currentAdmin = null;
let adminEmails = new Set();
let currentFiles = [];

/* ---------------- AUTH ---------------- */
async function auth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace("auth.html"); return null; }
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,full_name,is_main_admin")
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
const isMainAdmin = () => currentAdmin?.is_main_admin === true;

/* ---------------- LOAD ---------------- */
async function load() {
  $("loading").style.display = "block";
  grid.innerHTML = "";
  $("empty").style.display = "none";
  $("error").classList.remove("active");

  try {
    await auth();
    await loadAdmins();

    const { data, error } = await supabase
      .from("agent_vehicle_submissions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const { data: cars, error: carError } = await supabase
      .from("cars")
      .select("id,status,source_request_id,source_type")
      .eq("source_type", "agent");
    if (carError) throw carError;

    submissions = (data || []).map(x => ({
      ...x,
      _car: (cars || []).find(c => String(c.source_request_id) === String(x.id)) || null
    }));

    stats();
    render();
  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load submissions.";
    $("error").classList.add("active");
  } finally {
    $("loading").style.display = "none";
  }
}

/* ---------------- STATS ---------------- */
function stats() {
  $("totalRequests").textContent = submissions.length;
  $("pendingRequests").textContent = submissions.filter(x => !x._car && (x.status || "pending") === "pending").length;
  $("reviewingRequests").textContent = submissions.filter(x => !x._car && x.status === "reviewing").length;
  $("inventoryRequests").textContent = submissions.filter(x => !!x._car).length;
}

/* ---------------- RENDER ---------------- */
function render() {
  const q = $("searchInput").value.toLowerCase().trim();
  const s = $("statusFilter").value;
  const o = $("sortFilter").value;

  let list = submissions.filter(x => {
    const text = `${x.agent_name || ""} ${x.agent_email || ""} ${x.registration_number || ""} ${x.make || ""} ${x.model || ""} ${x.town_area || ""} ${x.county || ""}`.toLowerCase();
    const st = x._car ? "approved" : x.status || "pending";
    return (!q || text.includes(q)) && (s === "all" || st === s);
  });

  list.sort((a, b) =>
    o === "oldest" ? new Date(a.created_at) - new Date(b.created_at)
    : o === "price-high" ? Number(b.asking_price || 0) - Number(a.asking_price || 0)
    : o === "price-low" ? Number(a.asking_price || 0) - Number(b.asking_price || 0)
    : new Date(b.created_at) - new Date(a.created_at));

  if (!list.length) { $("empty").style.display = "block"; grid.innerHTML = ""; return; }
  $("empty").style.display = "none";

  grid.innerHTML = list.map(x => {
    const st = x._car ? "approved" : x.status || "pending";
    const label = x._car ? "in inventory" : st;
    const name = `${x.make || "Vehicle"} ${x.model || ""} ${x.year || ""}`.trim();
    return `
      <article class="request-card" data-id="${esc(x.id)}"><div class="request-top"><span class="request-status ${esc(st)}">${esc(label)}</span><small>${esc(date(x.created_at))}</small></div><h3>${esc(name)}</h3><p><i class="fa-solid fa-user-tie"></i> ${esc(x.agent_name||x.agent_email||"Agent")}</p><p><i class="fa-solid fa-id-card"></i> ${esc(x.registration_number||"No registration")}</p><div class="request-meta"><span>${Number(x.mileage||0).toLocaleString()} KM</span><strong>KES ${money(x.asking_price)}</strong></div><div class="request-bottom"><span>${esc(x.town_area||"Location not set")}</span><button type="button">View <i class="fa-solid fa-arrow-right"></i></button></div></article>
    `;
  }).join("");
}

/* ---------------- FIELD ---------------- */
function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(dash(value))}</strong></div>`;
}

/* ---------------- LOCATION ---------------- */
function locationInfo(sub) {
  const c = sub || current;
  if (!c) return null;

  const lat = Number(c.latitude);
  const lng = Number(c.longitude);
  const hasGps =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  const place = [...new Set(
    [c.showroom_name, c.town_area || c.location || c.city, c.county]
      .map(v => String(v ?? "").trim())
      .filter(Boolean)
  )].join(", ");

  const vehicle = `${c.make || "Vehicle"} ${c.model || ""}`.trim();
  const label = [vehicle, c.registration_number].filter(Boolean).join(" · ");
  const accuracy = Number(c.location_accuracy);

  return { lat, lng, hasGps, place, vehicle, label, accuracy };
}

function buildMapsUrl(sub) {
  const info = locationInfo(sub);
  if (!info) return "";
  if (info.hasGps) return `https://www.google.com/maps/search/?api=1&query=${info.lat},${info.lng}`;
  if (info.place) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.place)}`;
  return "";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function flashButton(button, text, icon = "fa-circle-check") {
  if (!button) return;
  const original = button.innerHTML;
  button.innerHTML = `<i class="fa-solid ${icon}"></i> ${text}`;
  button.classList.add("done");
  setTimeout(() => {
    button.innerHTML = original;
    button.classList.remove("done");
  }, 1600);
}

async function shareLocation(button) {
  const info = locationInfo();
  const url = buildMapsUrl();
  if (!info || !url) return;

  const where = info.place || "the location pinned by the agent";
  const headline = `${info.label || "Vehicle"} is at ${where}.`;
  const payload = { title: `${info.vehicle} — location`, text: headline, url };

  if (navigator.share) {
    try {
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn("Share failed, falling back to copy:", e);
    }
  }

  if (await copyText(`${headline}\n${url}`)) {
    flashButton(button, "Copied to share");
    return;
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(`${headline} ${url}`)}`, "_blank", "noopener");
}

async function copyLocationLink(button) {
  const url = buildMapsUrl();
  if (!url) return;
  const ok = await copyText(url);
  flashButton(button, ok ? "Link copied" : "Copy failed", ok ? "fa-circle-check" : "fa-triangle-exclamation");
}

function renderLocationCard() {
  const host = document.querySelector(".vehicle-summary-card");
  if (!host || !current) return;

  let box = $("locationBlock");
  if (!box) {
    box = document.createElement("div");
    box.id = "locationBlock";
    box.className = "location-card";
    host.appendChild(box);
  }

  const info = locationInfo();
  const url = buildMapsUrl();

  if (!url) {
    box.innerHTML = `
      <div class="location-empty">
        <i class="fa-solid fa-location-crosshairs"></i>
        <span>No location was captured for this submission. Add a town or GPS coordinates in the edit form to enable maps.</span>
      </div>`;
    return;
  }

  const sub = info.hasGps
    ? `${info.lat.toFixed(6)}, ${info.lng.toFixed(6)}${Number.isFinite(info.accuracy) && info.accuracy > 0 ? ` · ±${Math.round(info.accuracy)} m` : ""}`
    : "No GPS pin — matched by town and county";

  box.innerHTML = `
    <div class="location-head">
      <i class="fa-solid fa-location-dot"></i>
      <div>
        <strong>${esc(info.place || "Pinned location")}</strong>
        <span>${esc(sub)}</span>
      </div>
    </div>
    <div class="location-actions">
      <a class="location-btn open" id="openLocation" href="${esc(url)}" target="_blank" rel="noopener">
        <i class="fa-solid fa-map-location-dot"></i> Open in Maps
      </a>
      <button class="location-btn share" id="shareLocation" type="button">
        <i class="fa-solid fa-share-nodes"></i> Share location
      </button>
      <button class="location-btn copy" id="copyLocation" type="button">
        <i class="fa-solid fa-link"></i> Copy link
      </button>
    </div>`;

  $("shareLocation").onclick = () => shareLocation($("shareLocation"));
  $("copyLocation").onclick = () => copyLocationLink($("copyLocation"));
}

/* ---------------- FILES ---------------- */
async function getFiles(id) {
  const { data, error } = await supabase
    .from("agent_vehicle_files")
    .select("*")
    .eq("submission_id", id)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getFileUrl(file) {
  if (!file) return "";
  if (file._url) return file._url;
  if (file.storage_path) {
    const { data, error } = await supabase.storage
      .from(SUBMISSION_BUCKET)
      .createSignedUrl(file.storage_path, SIGNED_URL_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
    return supabase.storage.from(SUBMISSION_BUCKET).getPublicUrl(file.storage_path).data.publicUrl;
  }
  return file.file_url || "";
}

function isImageFile(f) {
  if (String(f.file_type || "").startsWith("image/")) return true;
  const name = String(f.file_name || f.storage_path || "");
  return /\.(jpg|jpeg|png|webp|gif|avif|bmp|heic)(\?|$)/i.test(name);
}

function fileCard(f, index) {
  const url = f._url || "";
  const image = isImageFile(f);
  const video = String(f.file_type || "").startsWith("video/");
  const label = f.photo_category === "extra" ? "Extra Photo"
    : CATS[f.photo_category] || f.photo_category || "Photo";

  let media;
  if (image && url) {
    media = `<img src="${esc(url)}" alt="${esc(label)}" loading="lazy"
      data-lightbox-index="${index}" data-lightbox-url="${esc(url)}" data-lightbox-label="${esc(label)}"
      onerror="this.parentElement.innerHTML='<div class=\\'file-icon\\'><i class=\\'fa-solid fa-image\\'></i></div>'">`;
  } else if (video && url) {
    media = `<video src="${esc(url)}" controls></video>`;
  } else {
    media = `<div class="file-icon"><i class="fa-solid fa-file"></i></div>`;
  }

  return `
    <div class="file-card" ${image && url ? `data-lightbox-index="${index}"` : ""}>
      ${media}
      <div class="file-info">
        <span>${esc(f.file_name || label)}</span>
        <small>${esc(label)}</small>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open File <i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ""}
      </div>
    </div>
  `;
}

/* ---------------- EDIT FORM ---------------- */
const EDIT_FIELDS = [
  { k: "registration_number", l: "Registration Number", t: "text" },
  { k: "make", l: "Make", t: "text" },
  { k: "model", l: "Model", t: "text" },
  { k: "trim", l: "Trim / Grade", t: "text" },
  { k: "year", l: "Year", t: "number", min: "1900", max: "2100" },
  { k: "body_type", l: "Body Type", t: "text" },
  { k: "engine_cc", l: "Engine (CC)", t: "number" },
  { k: "engine_description", l: "Engine Description", t: "text", full: true },
  { k: "horsepower", l: "Horsepower", t: "number" },
  { k: "fuel_type", l: "Fuel Type", t: "text" },
  { k: "transmission", l: "Transmission", t: "text" },
  { k: "drive_type", l: "Drive Type", t: "text" },
  { k: "mileage", l: "Mileage (KM)", t: "number" },
  { k: "exterior_color", l: "Exterior Colour", t: "text" },
  { k: "interior_color", l: "Interior Colour", t: "text" },
  { k: "seats", l: "Seats", t: "number" },
  { k: "doors", l: "Doors", t: "number" },
  { k: "condition", l: "Condition", t: "text" },
  { k: "vin", l: "VIN", t: "text" },
  { k: "chassis_number", l: "Chassis Number", t: "text" },
  { k: "stock_number", l: "Stock Number", t: "text" },
  { k: "country_of_origin", l: "Country Of Origin", t: "text" },
  { k: "import_year", l: "Import Year", t: "number", min: "1900", max: "2100" },
  { k: "registration_year", l: "Registration Year", t: "number", min: "1900", max: "2100" },
  { k: "auction_grade", l: "Auction Grade", t: "text" },
  { k: "previous_owners", l: "Previous Owners", t: "number" },
  { k: "number_of_keys", l: "Number Of Keys", t: "number" },
  { k: "accident_history", l: "Accident History", t: "text", full: true },
  { k: "service_history", l: "Service History", t: "text", full: true },
  { k: "inspection_status", l: "Inspection Status", t: "text" },
  { k: "inspection_notes", l: "Inspection Notes", t: "textarea", full: true },
  { k: "asking_price", l: "Asking Price (KES)", t: "number" },
  { k: "purchase_price", l: "Purchase Price (KES)", t: "number" },
  { k: "inventory_price", l: "Inventory Price (KES)", t: "number" },
  { k: "showroom_name", l: "Showroom / Yard", t: "text" },
  { k: "location", l: "Location", t: "text" },
  { k: "city", l: "City", t: "text" },
  { k: "town_area", l: "Town / Area", t: "text" },
  { k: "county", l: "County", t: "text" },
  { k: "latitude", l: "Latitude", t: "number", step: "any" },
  { k: "longitude", l: "Longitude", t: "number", step: "any" },
  { k: "key_features", l: "Key Features", t: "text", full: true },
  { k: "description", l: "Description", t: "textarea", full: true }
];

function buildEditForm() {
  const container = $("vehicleEditForm");
  if (!container || !current) return;

  container.innerHTML = `
    <div class="edit-grid">
      ${EDIT_FIELDS.map(f => {
        const value = current[f.k] ?? "";
        const input = f.t === "textarea"
          ? `<textarea id="ef_${f.k}" data-key="${esc(f.k)}">${esc(value)}</textarea>`
          : `<input id="ef_${f.k}" data-key="${esc(f.k)}" type="${esc(f.t)}"
              ${f.step ? ` step="${esc(f.step)}"` : ""}
              ${f.min ? ` min="${esc(f.min)}"` : ""}
              ${f.max ? ` max="${esc(f.max)}"` : ""}
              value="${esc(value)}">`;
        return `
          <div class="edit-field ${f.full ? "full" : ""}">
            <label for="ef_${esc(f.k)}">${esc(f.l)}</label>
            ${input}
          </div>
        `;
      }).join("")}
    </div>
    <div class="edit-actions">
      <button type="button" class="edit-reset" id="resetVehicle">
        <i class="fa-solid fa-rotate-left"></i> Reset
      </button>
      <button type="button" class="edit-save" id="saveVehicle">
        <i class="fa-solid fa-floppy-disk"></i> Save Vehicle Details
      </button>
    </div>
    <p class="edit-note">
      Saved changes are written back to the agent submission. If this submission
      is already in inventory, the linked vehicle listing is updated too.
    </p>
  `;

  $("saveVehicle").onclick = saveVehicleEdits;
  $("resetVehicle").onclick = () => buildEditForm();
}

async function saveVehicleEdits() {
  if (!current) return;
  const button = $("saveVehicle");
  const updates = {};

  document.querySelectorAll("#vehicleEditForm [data-key]").forEach(el => {
    const key = el.dataset.key;
    const def = EDIT_FIELDS.find(f => f.k === key);
    const raw = el.value.trim();

    if (!def) return;
    if (def.t === "number") {
      updates[key] = raw === "" ? null : (Number.isFinite(Number(raw)) ? Number(raw) : null);
    } else {
      updates[key] = raw === "" ? null : raw;
    }
  });

  if (!updates.registration_number) return alert("Registration number is required.");
  if (!updates.make || !updates.model) return alert("Make and model are required.");
  if (!Number.isFinite(Number(updates.asking_price)) || Number(updates.asking_price) <= 0)
    return alert("Enter a valid asking price.");
  if (updates.year !== null && (updates.year < 1900 || updates.year > 2100))
    return alert("Year must be between 1900 and 2100.");

  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    updates.updated_at = new Date().toISOString();

    /* 1) Update the submission itself */
    const { error } = await supabase
      .from("agent_vehicle_submissions")
      .update(updates)
      .eq("id", current.id);
    if (error) throw error;

    /* 2) If already in inventory, mirror the fields to the linked car */
    if (current._car?.id) {
      const carUpdates = {};

      Object.entries(SUBMISSION_TO_CAR_FIELD).forEach(([subKey, carKey]) => {
        if (subKey in updates) carUpdates[carKey] = updates[subKey];
      });

      if ("town_area" in updates) {
        carUpdates.location = updates.town_area;
        carUpdates.city     = updates.town_area;
      }
      if ("county" in updates) {
        carUpdates.county = updates.county;
      }

      if (Object.keys(carUpdates).length) {
        carUpdates.updated_at = new Date().toISOString();
        const carRes = await supabase
          .from("cars")
          .update(carUpdates)
          .eq("id", current._car.id);
        if (carRes.error) {
          console.warn("Failed to sync to inventory car:", carRes.error);
          alert(
            "Submission saved, but the linked inventory vehicle could not be updated:\n\n" +
            carRes.error.message
          );
        }
      }
    }

    /* 3) Refresh local state */
    current = { ...current, ...updates };
    submissions = submissions.map(x => (x.id === current.id ? current : x));

    $("detailTitle").textContent =
      `${current.agent_name || current.agent_email || "Agent"} — ${current.make || ""} ${current.model || ""}`.trim();
    $("vehicleTitle").textContent = `${current.make || "Vehicle"} ${current.model || ""}`.trim();
    $("vehicleMeta").textContent =
      [current.year, current.registration_number].filter(Boolean).join(" • ") || "Agent submitted vehicle";

    renderSummary();
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

/* ---------------- SUMMARY ---------------- */
function renderSummary() {
  if (!current) return;
  const carCount = currentFiles.length;
  $("summaryDetails").innerHTML = [
    field("Listing Reference", formatListingRef(current)),
    field("Submission Status", current._car ? "In Inventory" : current.status || "pending"),
    field("Asking Price", `KES ${money(current.asking_price)}`),
    field("Mileage", current.mileage != null ? `${Number(current.mileage).toLocaleString()} KM` : "—"),
    field("Condition", current.condition),
    field("Photos Uploaded", `${carCount}`),
    field("Submitted", date(current.created_at)),
    field("Last Updated", date(current.updated_at || current.created_at))
  ].join("");

  renderLocationCard();
}

/* ---------------- STATUS ---------------- */
function updateDetailStatus(status) {
  const badge = $("detailStatusLabel");
  if (!badge) return;
  const effective = current?._car ? "approved" : status;
  badge.className = `large-status ${effective}`;
  badge.textContent = effective === "approved" ? "IN INVENTORY" : effective.toUpperCase();
}

async function updateStatus(id, status) {
  if (current?._car && status !== "approved" &&
      !confirm("This submission is already linked to an inventory vehicle. Change its request status anyway?")) {
    return;
  }
  const { error } = await supabase
    .from("agent_vehicle_submissions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return alert(error.message);

  const item = submissions.find(x => x.id === id);
  if (item) item.status = status;
  if (current) current.status = status;

  updateDetailStatus(status);
  stats();
  render();
}

/* ---------------- CONTACT ---------------- */
function renderContact() {
  const email = current?.agent_email || "";
  const html = [];
  if (email) html.push(`<a class="contact-action-large" href="mailto:${esc(email)}"><i class="fa-solid fa-envelope"></i>Email Agent</a>`);
  if (current?.agent_phone) {
    const p = String(current.agent_phone).replace(/\D/g, "").replace(/^0/, "254");
    html.push(`<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Agent</a>`);
    html.push(`<a class="contact-action-large whatsapp" href="https://wa.me/${esc(p)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>`);
  }
  $("contactActions").innerHTML = html.length ? html.join("")
    : `<div class="notes"><p>No contact details were captured for this agent.</p></div>`;
}

/* ---------------- APPROVAL PANEL ---------------- */
function approvalPanel() {
  if (current._car) {
    const profit = Number(current.inventory_price || 0) - Number(current.negotiated_price || 0);
    return `
      <section class="approval-panel approved-panel">
        <div class="approval-title">
          <div><i class="fa-solid fa-circle-check"></i></div>
          <div><span>INVENTORY STATUS</span><h3>Vehicle Approved & Added</h3></div>
        </div>
        <div class="approval-summary">
          <div><span>Agreed Value</span><strong>KES ${money(current.negotiated_price)}</strong></div>
          <div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div>
          <div><span>Estimated Gross Profit</span><strong class="${profit >= 0 ? "profit-positive" : "profit-negative"}">KES ${money(profit)}</strong></div>
        </div>
        <div class="approved-actions">
          <button type="button" class="inventory-btn" onclick="openInventoryCar()">
            <i class="fa-solid fa-pen-to-square"></i> Open & Edit Inventory Vehicle
          </button>
          <button type="button" class="download-btn" onclick="window.downloadAgentSubmission()">
            <i class="fa-solid fa-file-arrow-down"></i> Download Submission Form
          </button>
        </div>
      </section>
    `;
  }

  if (!isMainAdmin()) {
    return `
      <section class="approval-panel locked-panel">
        <div class="approval-title">
          <div><i class="fa-solid fa-lock"></i></div>
          <div>
            <span>INVENTORY APPROVAL</span>
            <h3>Main Admin Approval Required</h3>
            <p>Only the main administrator can approve this agent submission and move it into inventory.</p>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="approval-panel">
      <div class="approval-title">
        <div><i class="fa-solid fa-handshake"></i></div>
        <div>
          <span>INVENTORY APPROVAL</span>
          <h3>Approve & Add to Inventory</h3>
          <p>Enter the agreed value paid for this vehicle and the intended inventory selling price.</p>
        </div>
      </div>

      <div class="asking-price">
        <span>Agent Asking Price</span>
        <strong>KES ${money(current.asking_price)}</strong>
      </div>

      <div class="approval-grid">
        <div>
          <label>Agreed Vehicle Value *</label>
          <input id="negotiatedPrice" type="number" min="0" step="1" value="${esc(current.negotiated_price ?? "")}" placeholder="Final value agreed with agent">
        </div>
        <div>
          <label>Inventory Selling Price *</label>
          <input id="inventoryPrice" type="number" min="0" step="1" value="${esc(current.inventory_price ?? current.asking_price ?? "")}" placeholder="Vehicle listing price">
        </div>
      </div>

      <div class="profit-box">
        <div><span>Estimated Gross Profit</span><strong id="profitValue">KES 0</strong></div>
        <small>Selling price minus agreed vehicle value.</small>
      </div>

      <button id="approveInventory" type="button" class="approve-btn">
        <i class="fa-solid fa-car-side"></i> Approve & Add to Inventory
      </button>

      <div style="margin-top:12px">
        <button type="button" class="download-btn" onclick="window.downloadAgentSubmission()">
          <i class="fa-solid fa-file-arrow-down"></i> Download Submission Form
        </button>
      </div>
    </section>
  `;
}

/* ---------------- RETURN-TO-AGENT PANEL ---------------- */
function returnPanel() {
  if (current._car) {
    return `
      <div class="return-banner">
        <i class="fa-solid fa-circle-info"></i>
        <div>
          <strong>Already in inventory</strong>
          This submission has been approved and moved into inventory. It can no longer be returned for corrections.
        </div>
      </div>
    `;
  }

  if (current.status === "returned") {
    return `
      <div class="return-banner">
        <i class="fa-solid fa-rotate-left"></i>
        <div>
          <strong>Currently returned to agent</strong>
          ${esc(current.returned_reason || "Awaiting agent corrections.")}
        </div>
      </div>
    `;
  }

  return `
    <section class="return-panel">
      <div class="approval-title">
        <div><i class="fa-solid fa-rotate-left"></i></div>
        <div>
          <span>RETURN FOR CORRECTION</span>
          <h3>Send Back to Agent</h3>
          <p>Select what needs fixing and add a comment. The agent will see this in their Actions page.</p>
        </div>
      </div>

      <div class="return-reasons">
        <label><input type="checkbox" value="Vehicle details incorrect"> Vehicle details incorrect</label>
        <label><input type="checkbox" value="Photos missing or unclear"> Photos missing / unclear</label>
        <label><input type="checkbox" value="Price needs review"> Price needs review</label>
        <label><input type="checkbox" value="Location / GPS issue"> Location / GPS issue</label>
        <label><input type="checkbox" value="Description needs work"> Description needs work</label>
        <label><input type="checkbox" value="Other"> Other (specify below)</label>
      </div>

      <textarea id="returnComment" class="return-textarea" placeholder="Add detailed correction notes for the agent…"></textarea>

      <button id="returnBtn" type="button" class="return-btn">
        <i class="fa-solid fa-paper-plane"></i> Send Back to Agent
      </button>
    </section>
  `;
}

function wireReturnPanel() {
  const btn = $("returnBtn");
  if (!btn) return;
  btn.onclick = sendBackToAgent;
}

async function sendBackToAgent() {
  if (!current) return;
  if (current._car) return alert("Vehicle is already in inventory.");
  if (current.status === "returned") return alert("This submission is already returned to the agent.");

  const reasons = [...document.querySelectorAll(".return-reasons input:checked")].map(x => x.value);
  const comment = ($("returnComment")?.value || "").trim();

  if (!reasons.length && !comment) {
    return alert("Select at least one reason or add a comment before sending back.");
  }

  const summary = [reasons.join(", "), comment].filter(Boolean).join(" — ");
  const title = "Correction required on your vehicle submission";

  if (!confirm("Send this submission back to the agent for corrections?")) return;

  const btn = $("returnBtn");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending…`;

  try {
    const now = new Date().toISOString();

    /* insertSafe drops admin_id (or any other column PostgREST reports
       missing) and retries instead of failing the whole action — see
       db-safe.js for the real fix: add the column in Supabase. */
    const { error: actionError } = await insertSafe("agent_vehicle_actions", {
      agent_id: current.agent_id,
      submission_id: current.id,
      admin_id: currentAdmin?.id || null,
      action_type: "correction",
      title,
      message: summary || "Please review and correct the submitted details, then resubmit.",
      completed: false,
      created_at: now,
      updated_at: now
    });
    if (actionError) throw actionError;

    const { error: subError } = await updateSafe("agent_vehicle_submissions",
      { id: current.id },
      {
        status: "returned",
        returned_reason: summary || "Please review and correct the submitted details, then resubmit.",
        returned_at: now,
        returned_by: currentAdmin?.id || null,
        updated_at: now
      }
    );
    if (subError) throw subError;

    current.status = "returned";
    current.returned_reason = summary;
    submissions = submissions.map(x => (x.id === current.id ? { ...x, status: "returned", returned_reason: summary } : x));

    updateDetailStatus("returned");
    stats();
    render();

    alert("Submission returned to agent. They will see the correction request in their Actions page.");
    closeDetail();
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to send submission back to agent.");
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Back to Agent`;
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
  lbElement.className = "agents-lightbox";
  lbElement.innerHTML = `
    <div class="lb-topbar">
      <div class="lb-title" id="lbTitle"></div>
      <div class="lb-topbar-actions">
        <button class="lb-icon-btn" id="lbZoom" title="Zoom"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
        <button class="lb-icon-btn" id="lbClose" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="lb-stage" id="lbStage">
      <button class="lb-nav lb-prev" id="lbPrev"><i class="fa-solid fa-chevron-left"></i></button>
      <img class="lb-image" id="lbImage" src="" alt="">
      <button class="lb-nav lb-next" id="lbNext"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
    <div class="lb-thumbs" id="lbThumbs"></div>
    <div class="lb-counter" style="text-align:center;padding:6px 0 10px;background:rgba(0,0,0,.35);color:#a7bccd;font-size:10px;font-weight:700;" id="lbCounter"></div>
  `;
  document.body.appendChild(lbElement);
  document.body.classList.add("locked");

  const img = $("lbImage");
  const title = $("lbTitle");
  const counter = $("lbCounter");
  const thumbs = $("lbThumbs");
  const stage = $("lbStage");
  let zoomed = false;

  thumbs.innerHTML = images.map((im, i) => `
    <div class="lb-thumb ${i === lbIndex ? "active" : ""}" data-i="${i}">
      <img src="${esc(im.url)}" alt="">
    </div>
  `).join("");

  const renderActive = () => {
    const item = images[lbIndex];
    img.src = item.url;
    img.classList.toggle("zoomed", zoomed);
    title.textContent = item.label || "Photo";
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
  $("lbZoom").onclick = () => { zoomed = !zoomed; img.classList.toggle("zoomed", zoomed); };

  thumbs.onclick = (e) => {
    const t = e.target.closest(".lb-thumb");
    if (!t) return;
    lbIndex = Number(t.dataset.i);
    renderActive();
  };

  img.onclick = () => { zoomed = !zoomed; img.classList.toggle("zoomed", zoomed); };

  stage.onclick = (e) => { if (e.target === stage) close(); };
  document.addEventListener("keydown", onKey);

  renderActive();
}

/* ---------------- DOWNLOAD AS FORM ---------------- */
function buildPrintableHTML() {
  const c = current;
  const files = currentFiles || [];
  const info = locationInfo(c);
  const mapLink = buildMapsUrl(c);

  const row = (label, val) =>
    `<tr><th>${esc(label)}</th><td>${esc(dash(val))}</td></tr>`;

  const photoGrid = files
    .filter(isImageFile)
    .map(f => `
      <figure>
        <img src="${esc(f._url || "")}" alt="">
        <figcaption>${esc(f.photo_category === "extra" ? "Extra Photo" : CATS[f.photo_category] || f.photo_category || "Photo")}</figcaption>
      </figure>
    `).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Agent Submission — ${esc(c.make || "")} ${esc(c.model || "")}</title>
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
  td a { color: #0f6ea8; word-break: break-all; }
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
    <h1>Agent Vehicle Submission</h1>
    <span>Regional Autoselections Ltd — Admin Form</span>
  </div>
  <div style="text-align:right">
    <div class="badge">${esc(c._car ? "In Inventory" : c.status || "pending")}</div>
    <div style="font-size:9px;color:#657b8c;margin-top:4px">Ref: ${esc(formatListingRef(c))}</div>
    <div style="font-size:9px;color:#657b8c">${esc(date(c.created_at))}</div>
  </div>
</header>

<h2>Agent</h2>
<table>
  ${row("Agent Name", c.agent_name)}
  ${row("Agent Email", c.agent_email)}
  ${row("Listing Reference", formatListingRef(c))}
  ${row("Submission ID", formatSubmissionRef(c))}
  ${row("GPS Captured", c.gps_captured_at ? date(c.gps_captured_at) : "Not captured")}
</table>

<h2>Vehicle Identification</h2>
<table>
  ${row("Registration", c.registration_number)}
  ${row("Make", c.make)}
  ${row("Model", c.model)}
  ${row("Year", c.year)}
  ${row("Body Type", c.body_type)}
  ${row("Engine (CC)", c.engine_cc)}
  ${row("Fuel Type", c.fuel_type)}
  ${row("Transmission", c.transmission)}
  ${row("Drive Type", c.drive_type)}
  ${row("Mileage (KM)", c.mileage != null ? Number(c.mileage).toLocaleString() : "—")}
  ${row("Exterior Colour", c.exterior_color)}
  ${row("Seats", c.seats)}
  ${row("Condition", c.condition)}
</table>

<h2>Pricing & Location</h2>
<table>
  ${row("Asking Price", c.asking_price != null ? `KES ${money(c.asking_price)}` : "—")}
  ${row("Showroom / Yard", c.showroom_name)}
  ${row("Town / Area", c.town_area)}
  ${row("County", c.county)}
  ${row("Location", info?.place || "—")}
  ${row("GPS", info?.hasGps ? `${info.lat}, ${info.lng}` : "—")}
  <tr><th>Map Link</th><td>${mapLink ? `<a href="${esc(mapLink)}">${esc(mapLink)}</a>` : "—"}</td></tr>
</table>

<h2>Description</h2>
<table>${row("Description", c.description)}${row("Key Features", c.key_features)}</table>

<h2>Photos (${files.filter(isImageFile).length})</h2>
${photoGrid ? `<div class="photos">${photoGrid}</div>` : `<p>No photos submitted.</p>`}

<div class="sign">
  <div><div class="line">Admin Signature / Date</div></div>
  <div><div class="line">Agent Signature / Date</div></div>
</div>

<footer>Generated ${date(new Date().toISOString())} — Regional Autoselections Ltd</footer>

</body>
</html>`;
}

function downloadAgentSubmission() {
  if (!current) return;
  const html = buildPrintableHTML();
  const win = window.open("", "_blank");
  if (!win) return alert("Please allow pop-ups to download the submission form.");
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch(e) { /* user can print manually */ } }, 400);
}

window.downloadAgentSubmission = downloadAgentSubmission;
window.openInventoryCar = () => {
  if (current?._car?.id) location.href = `edit.html?id=${encodeURIComponent(current._car.id)}`;
};

/* ---------------- APPROVE ---------------- */
function updateProfit() {
  const buy = Number($("negotiatedPrice")?.value || 0);
  const sell = Number($("inventoryPrice")?.value || 0);
  const profit = sell - buy;
  const el = $("profitValue");
  if (!el) return;
  el.textContent = `KES ${money(profit)}`;
  el.className = profit < 0 ? "profit-negative" : "profit-positive";
}

function safeName(name) { return String(name || "image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g, "-"); }

async function copySubmissionPhoto(file, carId, index) {
  let blob = null;
  const url = file._url || (await getFileUrl(file));
  if (url) {
    try { const r = await fetch(url); if (r.ok) blob = await r.blob(); }
    catch (e) { console.warn("Signed URL fetch failed, trying download:", e); }
  }
  if (!blob && file.storage_path) {
    const { data, error } = await supabase.storage.from(SUBMISSION_BUCKET).download(file.storage_path);
    if (error) throw error;
    blob = data;
  }
  if (!blob) throw new Error("Unable to fetch submitted photo.");

  const name = safeName(file.file_name || `image-${index + 1}.jpg`);
  const target = `${carId}/gallery/${crypto.randomUUID()}-${name}`;

  const { error } = await supabase.storage.from(CAR_BUCKET).upload(target, blob, {
    cacheControl: "3600", upsert: false,
    contentType: file.file_type || blob.type || "image/jpeg"
  });
  if (error) throw error;

  return {
    storage_path: target,
    image_url: supabase.storage.from(CAR_BUCKET).getPublicUrl(target).data.publicUrl
  };
}

/* Retained for compatibility, now backed by the generic helper.
   Returns whatever fields actually made it into the row (columns
   PostgREST reported missing are silently dropped — see db-safe.js). */
async function updateSubmissionRow(id, payload) {
  const { error, appliedPayload } = await updateSafe("agent_vehicle_submissions", { id }, payload);
  if (error) throw error;
  return appliedPayload;
}

async function approveToInventory() {
  if (!current || !isMainAdmin()) return alert("Only the main administrator can approve vehicles into inventory.");
  if (current._car) return alert("This submission has already been added to inventory.");

  const buy = Number($("negotiatedPrice")?.value);
  const sell = Number($("inventoryPrice")?.value);
  if (!Number.isFinite(buy) || buy < 0) return alert("Enter a valid agreed vehicle value.");
  if (!Number.isFinite(sell) || sell <= 0) return alert("Enter a valid inventory selling price.");

  const name = `${current.make || ""} ${current.model || ""}`.trim() || "this vehicle";
  if (!confirm(`Approve ${name} and add it to inventory for KES ${money(sell)}?`)) return;

  const button = $("approveInventory");
  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding to Inventory...`;

  const uploaded = [];

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Your session has expired. Please log in again.");

    const existing = await supabase
      .from("cars").select("id")
      .eq("source_request_id", current.id)
      .eq("source_type", "agent")
      .maybeSingle();
    if (existing.error) throw existing.error;

    let car;
    if (existing.data) {
      car = existing.data;
    } else {
      const keyFeatures = current.key_features ? String(current.key_features).trim() : "";
      const baseDescription = current.description ? String(current.description).trim() : "";
      const description = [baseDescription, keyFeatures ? `Key Features: ${keyFeatures}` : ""].filter(Boolean).join("\n\n");

      const carData={
  make:current.make||null,
  model:current.model||null,
  trim:current.trim||null,
  year:current.year?Number(current.year):null,
  price:sell,
  purchase_price:buy,
  condition:current.condition||null,
  body_type:current.body_type||null,
  engine_size:current.engine_cc?Number(current.engine_cc):null,
  engine_description:current.engine_description||null,
  horsepower:current.horsepower?Number(current.horsepower):null,
  fuel_type:current.fuel_type||null,
  transmission:current.transmission||null,
  drive_type:current.drive_type||null,
  mileage:current.mileage!==null&&current.mileage!==undefined&&current.mileage!==""?Number(current.mileage):null,
  mileage_unit:"km",
  exterior_color:current.exterior_color||null,
  interior_color:current.interior_color||null,
  seats:current.seats?Number(current.seats):null,
  doors:current.doors?Number(current.doors):null,
  vin:current.vin||null,
  chassis_number:current.chassis_number||null,
  registration_number:current.registration_number||null,
  stock_number:current.stock_number||null,
  country_of_origin:current.country_of_origin||null,
  import_year:current.import_year?Number(current.import_year):null,
  registration_year:current.registration_year?Number(current.registration_year):null,
  auction_grade:current.auction_grade||null,
  previous_owners:current.previous_owners?Number(current.previous_owners):null,
  accident_history:current.accident_history||null,
  service_history:current.service_history||null,
  number_of_keys:current.number_of_keys?Number(current.number_of_keys):null,
  inspection_status:current.inspection_status||null,
  inspection_notes:current.inspection_notes||null,
  location:current.town_area||current.location||current.showroom_name||null,
  city:current.city||current.town_area||null,
  county:current.county||null,
  latitude:current.latitude??null,
  longitude:current.longitude??null,
  location_accuracy:current.location_accuracy??null,
  description:current.description||null,
  key_features:current.key_features||null,
  showroom_name:current.showroom_name||null,
  negotiable:current.negotiable??false,
  financing_available:current.financing_available??false,
  test_drive_available:current.test_drive_available??true,
  featured:current.featured??false,
  status:"available",
  source_request_id:current.id,
  source_type:"agent",
  agent_id:current.agent_id||null,
  agent_email:current.agent_email||null,
  agent_name:current.agent_name||null,
  created_at:new Date().toISOString(),
  updated_at:new Date().toISOString()
};

      const result = await supabase.from("cars").insert(carData).select().single();
      if (result.error) {
        if (result.error.code === "23505") {
          const query = await supabase.from("cars").select("*").eq("source_request_id", current.id).single();
          if (query.error) throw query.error;
          car = query.data;
        } else throw result.error;
      } else car = result.data;
    }

    if (!existing.data) {
      const images = currentFiles.filter(isImageFile);
      const frontIndex = images.findIndex(f => f.photo_category === "front");
      const ordered = frontIndex > 0 ? [images[frontIndex], ...images.filter((_, i) => i !== frontIndex)] : images;

      for (let i = 0; i < ordered.length; i++) {
        const copied = await copySubmissionPhoto(ordered[i], car.id, i);
        uploaded.push(copied.storage_path);
        const { error: imageError } = await supabase.from("car_images").insert({
          car_id: car.id, image_url: copied.image_url, storage_path: copied.storage_path,
          image_type: "gallery", display_order: i
        });
        if (imageError) throw imageError;

        if (i === 0) {
          const { error: displayError } = await supabase.from("cars").update({
            display_image_url: copied.image_url, display_image_path: copied.storage_path
          }).eq("id", car.id);
          if (displayError) throw displayError;
        }
      }
    }

    const now = new Date().toISOString();
    const saved = await updateSubmissionRow(current.id, {
      status: "approved", negotiated_price: buy, inventory_price: sell,
      approved_car_id: car.id, approved_at: now, approved_by: session.user.id, updated_at: now
    });

    current = { ...current, ...saved, _car: { id: car.id, status: "available", source_request_id: current.id, source_type: "agent" } };
    submissions = submissions.map(x => (x.id === current.id ? current : x));

    /* Uses the same schema-cache-safe update as "Send Back to Agent" —
       if completed_at (or any other column here) isn't on the table,
       this drops it and retries rather than leaving the approval
       half-done. */
    await updateSafe("agent_vehicle_actions",
      { submission_id: current.id, completed: false },
      { completed: true, completed_at: now, updated_at: now }
    );

    alert(`Vehicle approved and successfully added to inventory.${uploaded.length ? ` ${uploaded.length} photo(s) were transferred.` : ""}`);
    closeDetail();
    load();
  } catch (e) {
    console.error(e);
    if (uploaded.length) await supabase.storage.from(CAR_BUCKET).remove(uploaded);
    alert(e.message || "Unable to add vehicle to inventory.");
    if (button) { button.disabled = false; button.innerHTML = `<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`; }
  }
}

/* ---------------- VIEW ---------------- */
async function viewRequest(id) {
  current = submissions.find(x => String(x.id) === String(id));
  if (!current) return;

  try {
    const rawFiles = await getFiles(id);
    currentFiles = await Promise.all(rawFiles.map(async f => ({ ...f, _url: await getFileUrl(f) })));

    const status = current._car ? "approved" : current.status || "pending";
    $("detailTitle").textContent = `${current.agent_name || current.agent_email || "Agent"} — ${current.make || ""} ${current.model || ""}`.trim();
    $("detailDate").textContent = date(current.created_at);
    $("detailStatus").value = current.status || "pending";
    updateDetailStatus(status);

    $("agentBanner").innerHTML = `
      <div class="agent-banner">
        <i class="fa-solid fa-user-tie"></i>
        <div>
          <strong>AGENT SUBMISSION</strong>
          <span>${esc(current.agent_name || "Unknown agent")} · ${esc(current.agent_email || "No email")}</span>
        </div>
      </div>
    `;

    $("agentDetails").innerHTML = [
      field("Agent Name", current.agent_name),
      field("Agent Email", current.agent_email),
      field("Listing Reference", formatListingRef(current)),
      field("Submission ID", formatSubmissionRef(current)),
      field("Submitted", date(current.created_at)),
      field("Last Updated", date(current.updated_at || current.created_at)),
      field("GPS Captured", current.gps_captured_at ? date(current.gps_captured_at) : "Not captured"),
      field("Photo Count", current.photo_count ?? currentFiles.length)
    ].join("");

    buildEditForm();
    renderContact();
    $("approvalContent").innerHTML = approvalPanel() + returnPanel();

    $("vehicleTitle").textContent = `${current.make || "Vehicle"} ${current.model || ""}`.trim();
    $("vehicleMeta").textContent = [current.year, current.registration_number].filter(Boolean).join(" • ") || "Agent submitted vehicle";
    renderSummary();

    $("filesContent").innerHTML = currentFiles.length
      ? `<div class="files-grid">${currentFiles.map((f, i) => fileCard(f, i)).join("")}</div>`
      : `<div class="notes"><p>No photos were submitted with this vehicle.</p></div>`;

    const statusCard = document.querySelector(".status-card .status-controls");
    if (statusCard && !statusCard.querySelector(".download-btn")) {
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "download-btn";
      dl.innerHTML = `<i class="fa-solid fa-file-arrow-down"></i> Download`;
      dl.onclick = downloadAgentSubmission;
      statusCard.appendChild(dl);
    }

    $("agentDetail").classList.add("show");
    document.body.classList.add("locked");

    if (!current._car && isMainAdmin()) {
      $("negotiatedPrice")?.addEventListener("input", updateProfit);
      $("inventoryPrice")?.addEventListener("input", updateProfit);
      $("approveInventory")?.addEventListener("click", approveToInventory);
      updateProfit();
    }

    wireReturnPanel();

    $("filesContent").onclick = (e) => {
      const card = e.target.closest("[data-lightbox-index]");
      if (!card) return;
      const images = currentFiles.filter(isImageFile).map(f => ({
        url: f._url, label: f.photo_category === "extra" ? "Extra Photo" : CATS[f.photo_category] || f.photo_category || "Photo"
      }));
      const idx = Number(card.dataset.lightboxIndex);
      openLightbox(images, isNaN(idx) ? 0 : idx);
    };
  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load submission.";
    $("error").classList.add("active");
  }
}

/* ---------------- DELETE ---------------- */
async function deleteRequest() {
  if (!current) return;
  if (!confirm(`Delete submission from ${current.agent_name || current.agent_email || "this agent"}? This cannot be undone.`)) return;

  const id = current.id;
  try {
    const files = currentFiles.length ? currentFiles : await getFiles(id);
    const paths = files.map(f => f.storage_path).filter(Boolean);

    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(SUBMISSION_BUCKET).remove(paths);
      if (storageError) console.warn("Storage cleanup warning:", storageError);
    }

    await supabase.from("agent_vehicle_files").delete().eq("submission_id", id);
    await supabase.from("agent_vehicle_actions").delete().eq("submission_id", id);

    const { error } = await supabase.from("agent_vehicle_submissions").delete().eq("id", id);
    if (error) throw error;

    submissions = submissions.filter(x => x.id !== id);
    closeDetail();
    stats();
    render();
    alert("Agent submission deleted successfully.");
  } catch (e) {
    console.error(e);
    alert(e.message || "Unable to delete agent submission.");
  }
}

/* ---------------- CLOSE ---------------- */
function closeDetail() {
  $("agentDetail").classList.remove("show");
  document.body.classList.remove("locked");
  current = null;
  currentFiles = [];
}

/* ---------------- EVENTS ---------------- */
grid.addEventListener("click", e => {
  const card = e.target.closest(".request-card");
  if (card) viewRequest(card.dataset.id);
});

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
  if (e.key === "Escape" && current && !document.querySelector(".agents-lightbox")) closeDetail();
});

$("menu").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show"); };
$("closeMenu").onclick = $("overlay").onclick = () => { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show"); };
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); location.replace("auth.html"); };

/* loader: fires even if the window "load" event already happened */
const hideLoader = () => setTimeout(() => $("loader")?.classList.add("hide"), 450);
document.readyState === "complete" ? hideLoader() : window.addEventListener("load", hideLoader);

/* ---------------- BOOT ---------------- */
requireAdmin("agent_submissions").then(async allowed => {
  if (!allowed) return;
  await auth();
  load();markSectionSeen("agent_submissions");attachBadges();
});