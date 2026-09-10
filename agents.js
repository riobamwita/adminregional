/* ============================================================
   agents.js — Admin Agent Submissions
   Mirrors tradeins.js architecture, adapted for
   agent_vehicle_submissions + agent_vehicle_files
   ============================================================ */

import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";

/* ---------------- CONSTANTS ---------------- */

const $ = id => document.getElementById(id);
const grid = $("requestsGrid");

const SUBMISSION_BUCKET = "agent-vehicle-files";
const CAR_BUCKET = "car-images";

const CATS = {
  front: "Front",
  front_left: "Front-left",
  left_side: "Left side",
  rear_left: "Rear-left",
  rear: "Rear",
  rear_right: "Rear-right",
  right_side: "Right side",
  front_right: "Front-right",
  interior_front: "Interior – front",
  interior_rear: "Interior – rear",
  dashboard: "Dashboard",
  odometer: "Odometer",
  engine_bay: "Engine bay",
  wheels_tyres: "Wheels / tyres",
  damage_feature: "Damage / notable feature"
};

/* ---------------- HELPERS ---------------- */

const esc = v =>
  String(v ?? "").replace(
    /[&<>"']/g,
    m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );

const dash = v => (v === null || v === undefined || v === "" ? "—" : v);

const money = v => Number(v || 0).toLocaleString("en-KE");

const date = v =>
  v
    ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })
    : "—";

/* ---------------- STATE ---------------- */

let submissions = [];
let current = null;
let currentAdmin = null;
let adminEmails = new Set();
let currentFiles = [];

/* ---------------- AUTH ---------------- */

async function auth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace("auth.html");
    return null;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,full_name,is_main_admin")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data) {
    await supabase.auth.signOut();
    location.replace("auth.html");
    return null;
  }

  currentAdmin = data;
  return data;
}

async function loadAdmins() {
  const { data, error } = await supabase.from("admin_users").select("email");
  if (error) throw error;
  adminEmails = new Set(
    (data || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean)
  );
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
      _car:
        (cars || []).find(
          c => String(c.source_request_id) === String(x.id)
        ) || null
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
  $("pendingRequests").textContent = submissions.filter(
    x => !x._car && (x.status || "pending") === "pending"
  ).length;
  $("reviewingRequests").textContent = submissions.filter(
    x => !x._car && x.status === "reviewing"
  ).length;
  $("inventoryRequests").textContent = submissions.filter(x => !!x._car).length;
}

/* ---------------- RENDER GRID ---------------- */

function render() {
  const q = $("searchInput").value.toLowerCase().trim();
  const s = $("statusFilter").value;
  const o = $("sortFilter").value;

  let list = submissions.filter(x => {
    const text = `${x.agent_name || ""} ${x.agent_email || ""} ${
      x.registration_number || ""
    } ${x.make || ""} ${x.model || ""} ${x.town_area || ""} ${
      x.county || ""
    }`.toLowerCase();

    const st = x._car ? "approved" : x.status || "pending";

    return (!q || text.includes(q)) && (s === "all" || st === s);
  });

  list.sort((a, b) =>
    o === "oldest"
      ? new Date(a.created_at) - new Date(b.created_at)
      : o === "price-high"
      ? Number(b.asking_price || 0) - Number(a.asking_price || 0)
      : o === "price-low"
      ? Number(a.asking_price || 0) - Number(b.asking_price || 0)
      : new Date(b.created_at) - new Date(a.created_at)
  );

  if (!list.length) {
    $("empty").style.display = "block";
    grid.innerHTML = "";
    return;
  }

  $("empty").style.display = "none";

  grid.innerHTML = list
    .map(x => {
      const st = x._car ? "approved" : x.status || "pending";
      const label = x._car
        ? "in inventory"
        : st;

      const name =
        `${x.make || "Vehicle"} ${x.model || ""} ${x.year || ""}`.trim();

      return `
        <article class="request-card" data-id="${esc(x.id)}">
          <div class="request-top">
            <small>${esc(date(x.created_at))}</small>
            <span class="request-status ${esc(st)}">${esc(label)}</span>
          </div>
          <h3>${esc(name)}</h3>
          <p><i class="fa-solid fa-user-tie"></i> ${esc(x.agent_name || x.agent_email || "Agent")}</p>
          <p><i class="fa-solid fa-id-card"></i> ${esc(x.registration_number || "No registration")}</p>
          <div class="request-meta">
            <span>${Number(x.mileage || 0).toLocaleString()} KM</span>
            <strong>KES ${money(x.asking_price)}</strong>
          </div>
          <div class="request-bottom">
            <span>${esc(x.town_area || "Location not set")}</span>
            <button type="button">View <i class="fa-solid fa-arrow-right"></i></button>
          </div>
        </article>
      `;
    })
    .join("");
}

/* ---------------- FIELD BUILDER ---------------- */

function field(label, value) {
  return `<div class="detail-field"><span>${esc(label)}</span><strong>${esc(
    dash(value)
  )}</strong></div>`;
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

function fileUrl(f) {
  if (f.file_url) return f.file_url;
  if (f.storage_path) {
    return supabase.storage.from(SUBMISSION_BUCKET).getPublicUrl(f.storage_path)
      .data.publicUrl;
  }
  return "";
}

function isImageFile(f) {
  const url = fileUrl(f);
  return (
    String(f.file_type || "").startsWith("image/") ||
    /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(url)
  );
}

function fileCard(f) {
  const url = fileUrl(f);
  const image = isImageFile(f);
  const video = String(f.file_type || "").startsWith("video/");
  const label =
    f.photo_category === "extra"
      ? "Extra Photo"
      : CATS[f.photo_category] || f.photo_category || "Photo";

  return `
    <div class="file-card">
      ${
        image
          ? `<img src="${esc(url)}" alt="${esc(label)}">`
          : video
          ? `<video src="${esc(url)}" controls></video>`
          : `<div class="file-icon"><i class="fa-solid fa-file"></i></div>`
      }
      <div class="file-info">
        <span>${esc(f.file_name || label)}</span>
        <small>${esc(label)}</small>
        <a href="${esc(url)}" target="_blank" rel="noopener">Open File <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
      </div>
    </div>
  `;
}

/* ---------------- EDIT FORM ---------------- */

const EDIT_FIELDS = [
  { k: "registration_number", l: "Registration Number", t: "text" },
  { k: "make", l: "Make", t: "text" },
  { k: "model", l: "Model", t: "text" },
  { k: "year", l: "Year", t: "number" },
  { k: "body_type", l: "Body Type", t: "text" },
  { k: "engine_cc", l: "Engine (CC)", t: "number" },
  { k: "fuel_type", l: "Fuel Type", t: "text" },
  { k: "transmission", l: "Transmission", t: "text" },
  { k: "drive_type", l: "Drive Type", t: "text" },
  { k: "mileage", l: "Mileage (KM)", t: "number" },
  { k: "exterior_color", l: "Exterior Colour", t: "text" },
  { k: "seats", l: "Seats", t: "number" },
  { k: "condition", l: "Condition", t: "text" },
  { k: "asking_price", l: "Asking Price (KES)", t: "number" },
  { k: "showroom_name", l: "Showroom / Yard", t: "text" },
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
        const input =
          f.t === "textarea"
            ? `<textarea id="ef_${f.k}" data-key="${esc(f.k)}">${esc(value)}</textarea>`
            : `<input id="ef_${f.k}" data-key="${esc(f.k)}" type="${esc(f.t)}"${
                f.step ? ` step="${esc(f.step)}"` : ""
              } value="${esc(value)}">`;

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
      Saved changes are written back to the agent submission and are used when the
      vehicle is approved into inventory.
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

    if (def.t === "number") {
      if (raw === "") {
        updates[key] = null;
      } else {
        const num = Number(raw);
        updates[key] = Number.isFinite(num) ? num : null;
      }
    } else {
      updates[key] = raw === "" ? null : raw;
    }
  });

  if (!updates.registration_number) {
    alert("Registration number is required.");
    return;
  }
  if (!updates.make || !updates.model) {
    alert("Make and model are required.");
    return;
  }
  if (!Number.isFinite(Number(updates.asking_price)) || Number(updates.asking_price) <= 0) {
    alert("Enter a valid asking price.");
    return;
  }

  button.disabled = true;
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("agent_vehicle_submissions")
      .update(updates)
      .eq("id", current.id);

    if (error) throw error;

    current = { ...current, ...updates };
    submissions = submissions.map(x => (x.id === current.id ? current : x));

    /* refresh header + right panel */
    $("detailTitle").textContent =
      `${current.full_name || current.agent_name || "Agent"} — ${
        current.make || ""
      } ${current.model || ""}`.trim();

    $("vehicleTitle").textContent =
      `${current.make || "Vehicle"} ${current.model || ""}`.trim();

    $("vehicleMeta").textContent =
      [current.year, current.registration_number].filter(Boolean).join(" • ") ||
      "Agent submitted vehicle";

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

/* ---------------- SUMMARY (right panel) ---------------- */

function renderSummary() {
  if (!current) return;

  const carCount = currentFiles.length;

  $("summaryDetails").innerHTML = [
    field("Listing Reference", current.listing_reference || current.id),
    field("Submission Status", current._car ? "In Inventory" : current.status || "pending"),
    field("Asking Price", `KES ${money(current.asking_price)}`),
    field("Mileage", current.mileage != null ? `${Number(current.mileage).toLocaleString()} KM` : "—"),
    field("Condition", current.condition),
    field("Photos Uploaded", `${carCount}`),
    field("Submitted", date(current.created_at)),
    field("Last Updated", date(current.updated_at || current.created_at))
  ].join("");
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
  if (
    current?._car &&
    status !== "approved" &&
    !confirm(
      "This submission is already linked to an inventory vehicle. Change its request status anyway?"
    )
  ) {
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

  if (email) {
    html.push(
      `<a class="contact-action-large" href="mailto:${esc(email)}"><i class="fa-solid fa-envelope"></i>Email Agent</a>`
    );
  }

  if (current?.agent_phone) {
    const p = String(current.agent_phone).replace(/\D/g, "").replace(/^0/, "254");
    html.push(
      `<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Agent</a>`
    );
    html.push(
      `<a class="contact-action-large whatsapp" href="https://wa.me/${esc(p)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>`
    );
  }

  $("contactActions").innerHTML =
    html.length
      ? html.join("")
      : `<div class="notes"><p>No contact details were captured for this agent.</p></div>`;
}

/* ---------------- APPROVAL PANEL ---------------- */

function approvalPanel() {
  if (current._car) {
    const profit =
      Number(current.inventory_price || 0) - Number(current.negotiated_price || 0);

    return `
      <section class="approval-panel approved-panel">
        <div class="approval-title">
          <div><i class="fa-solid fa-circle-check"></i></div>
          <div>
            <span>INVENTORY STATUS</span>
            <h3>Vehicle Approved & Added</h3>
          </div>
        </div>
        <div class="approval-summary">
          <div><span>Agreed Value</span><strong>KES ${money(current.negotiated_price)}</strong></div>
          <div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div>
          <div>
            <span>Estimated Gross Profit</span>
            <strong class="${profit >= 0 ? "profit-positive" : "profit-negative"}">KES ${money(profit)}</strong>
          </div>
        </div>
        <div class="approved-actions">
          <button type="button" class="inventory-btn" onclick="openInventoryCar()">
            <i class="fa-solid fa-pen-to-square"></i> Open & Edit Inventory Vehicle
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
          <input id="negotiatedPrice" type="number" min="0" step="1"
            value="${esc(current.negotiated_price ?? "")}" placeholder="Final value agreed with agent">
        </div>
        <div>
          <label>Inventory Selling Price *</label>
          <input id="inventoryPrice" type="number" min="0" step="1"
            value="${esc(current.inventory_price ?? current.asking_price ?? "")}" placeholder="Vehicle listing price">
        </div>
      </div>

      <div class="profit-box">
        <div>
          <span>Estimated Gross Profit</span>
          <strong id="profitValue">KES 0</strong>
        </div>
        <small>Selling price minus agreed vehicle value.</small>
      </div>

      <button id="approveInventory" type="button" class="approve-btn">
        <i class="fa-solid fa-car-side"></i> Approve & Add to Inventory
      </button>
    </section>
  `;
}

function updateProfit() {
  const buy = Number($("negotiatedPrice")?.value || 0);
  const sell = Number($("inventoryPrice")?.value || 0);
  const profit = sell - buy;
  const el = $("profitValue");
  if (!el) return;
  el.textContent = `KES ${money(profit)}`;
  el.className = profit < 0 ? "profit-negative" : "profit-positive";
}

/* ---------------- PHOTO TRANSFER ---------------- */

function safeName(name) {
  return String(name || "image.jpg")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-");
}

async function copySubmissionPhoto(file, carId, index) {
  let blob = null;

  if (file.storage_path) {
    const { data, error } = await supabase.storage
      .from(SUBMISSION_BUCKET)
      .download(file.storage_path);

    if (error) throw error;
    blob = data;
  } else if (file.file_url) {
    const response = await fetch(file.file_url);
    if (!response.ok) throw new Error("Unable to download submitted photo.");
    blob = await response.blob();
  } else {
    throw new Error("Submitted photo has no storage path or URL.");
  }

  const name = safeName(file.file_name || `image-${index + 1}.jpg`);
  const target = `${carId}/gallery/${crypto.randomUUID()}-${name}`;

  const { error } = await supabase.storage
    .from(CAR_BUCKET)
    .upload(target, blob, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.file_type || blob.type || "image/jpeg"
    });

  if (error) throw error;

  return {
    storage_path: target,
    image_url: supabase.storage.from(CAR_BUCKET).getPublicUrl(target).data.publicUrl
  };
}

/* ---------------- APPROVE TO INVENTORY ---------------- */

async function updateSubmissionRow(id, payload) {
  let { error } = await supabase
    .from("agent_vehicle_submissions")
    .update(payload)
    .eq("id", id);

  if (error && /column|schema cache/i.test(error.message || "")) {
    /* Fallback for tables that do not yet have the approval columns */
    const fallback = { status: payload.status, updated_at: payload.updated_at };
    const retry = await supabase
      .from("agent_vehicle_submissions")
      .update(fallback)
      .eq("id", id);

    if (retry.error) throw retry.error;
    return fallback;
  }

  if (error) throw error;
  return payload;
}

async function approveToInventory() {
  if (!current || !isMainAdmin()) {
    return alert("Only the main administrator can approve vehicles into inventory.");
  }
  if (current._car) {
    return alert("This submission has already been added to inventory.");
  }

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

    /* Re-check to avoid double approval */
    const existing = await supabase
      .from("cars")
      .select("id")
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

      const description = [baseDescription, keyFeatures ? `Key Features: ${keyFeatures}` : ""]
        .filter(Boolean)
        .join("\n\n");

      const carData = {
        make: current.make || null,
        model: current.model || null,
        year: current.year ? Number(current.year) : null,
        price: sell,
        purchase_price: buy,
        condition: current.condition || null,
        body_type: current.body_type || null,
        mileage:
          current.mileage !== null && current.mileage !== undefined && current.mileage !== ""
            ? Number(current.mileage)
            : null,
        fuel_type: current.fuel_type || null,
        transmission: current.transmission || null,
        drive_type: current.drive_type || null,
        engine_size: current.engine_cc ? Number(current.engine_cc) : null,
        seats: current.seats ? Number(current.seats) : null,
        registration_number: current.registration_number || null,
        exterior_color: current.exterior_color || null,
        location: current.town_area || current.showroom_name || null,
        city: current.town_area || null,
        county: current.county || null,
        description: description || null,
        status: "available",
        featured: false,
        financing_available: false,
        test_drive_available: true,
        source_request_id: current.id,
        source_type: "agent",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const result = await supabase.from("cars").insert(carData).select().single();

      if (result.error) {
        if (result.error.code === "23505") {
          const query = await supabase
            .from("cars")
            .select("*")
            .eq("source_request_id", current.id)
            .single();
          if (query.error) throw query.error;
          car = query.data;
        } else {
          throw result.error;
        }
      } else {
        car = result.data;
      }
    }

    /* Transfer photos into car-images */
    if (!existing.data) {
      const images = currentFiles.filter(isImageFile);

      /* Prefer the front photo as the display image */
      const frontIndex = images.findIndex(f => f.photo_category === "front");
      const ordered =
        frontIndex > 0
          ? [images[frontIndex], ...images.filter((_, i) => i !== frontIndex)]
          : images;

      for (let i = 0; i < ordered.length; i++) {
        const copied = await copySubmissionPhoto(ordered[i], car.id, i);
        uploaded.push(copied.storage_path);

        const { error: imageError } = await supabase.from("car_images").insert({
          car_id: car.id,
          image_url: copied.image_url,
          storage_path: copied.storage_path,
          image_type: "gallery",
          display_order: i
        });

        if (imageError) throw imageError;

        if (i === 0) {
          const { error: displayError } = await supabase
            .from("cars")
            .update({
              display_image_url: copied.image_url,
              display_image_path: copied.storage_path
            })
            .eq("id", car.id);

          if (displayError) throw displayError;
        }
      }
    }

    /* Update the submission record */
    const now = new Date().toISOString();

    const saved = await updateSubmissionRow(current.id, {
      status: "approved",
      negotiated_price: buy,
      inventory_price: sell,
      approved_car_id: car.id,
      approved_at: now,
      approved_by: session.user.id,
      updated_at: now
    });

    current = { ...current, ...saved, _car: { id: car.id, status: "available", source_request_id: current.id, source_type: "agent" } };
    submissions = submissions.map(x => (x.id === current.id ? current : x));

    alert(
      `Vehicle approved and successfully added to inventory.${
        uploaded.length ? ` ${uploaded.length} photo(s) were transferred.` : ""
      }`
    );

    closeDetail();
    load();
  } catch (e) {
    console.error(e);

    if (uploaded.length) {
      await supabase.storage.from(CAR_BUCKET).remove(uploaded);
    }

    alert(e.message || "Unable to add vehicle to inventory.");

    if (button) {
      button.disabled = false;
      button.innerHTML = `<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`;
    }
  }
}

/* ---------------- VIEW REQUEST ---------------- */

async function viewRequest(id) {
  current = submissions.find(x => String(x.id) === String(id));
  if (!current) return;

  try {
    currentFiles = await getFiles(id);

    const status = current._car ? "approved" : current.status || "pending";

    $("detailTitle").textContent =
      `${current.agent_name || current.agent_email || "Agent"} — ${
        current.make || ""
      } ${current.model || ""}`.trim();

    $("detailDate").textContent = date(current.created_at);
    $("detailStatus").value = current.status || "pending";
    updateDetailStatus(status);

    /* Agent banner */
    $("agentBanner").innerHTML = `
      <div class="agent-banner">
        <i class="fa-solid fa-user-tie"></i>
        <div>
          <strong>AGENT SUBMISSION</strong>
          <span>${esc(current.agent_name || "Unknown agent")} · ${esc(
      current.agent_email || "No email"
    )}</span>
        </div>
      </div>
    `;

    /* Agent card */
    $("agentDetails").innerHTML = [
      field("Agent Name", current.agent_name),
      field("Agent Email", current.agent_email),
      field("Listing Reference", current.listing_reference || current.id),
      field("Submission ID", current.id),
      field("Submitted", date(current.created_at)),
      field("Last Updated", date(current.updated_at || current.created_at)),
      field("GPS Captured", current.gps_captured_at ? date(current.gps_captured_at) : "Not captured"),
      field("Photo Count", current.photo_count ?? currentFiles.length)
    ].join("");

    /* Editable vehicle form */
    buildEditForm();

    /* Contact */
    renderContact();

    /* Approval panel */
    $("approvalContent").innerHTML = approvalPanel();

    /* Right panel header */
    $("vehicleTitle").textContent =
      `${current.make || "Vehicle"} ${current.model || ""}`.trim();

    $("vehicleMeta").textContent =
      [current.year, current.registration_number].filter(Boolean).join(" • ") ||
      "Agent submitted vehicle";

    /* Right panel summary */
    renderSummary();

    /* Photos */
    $("filesContent").innerHTML = currentFiles.length
      ? `<div class="files-grid">${currentFiles.map(fileCard).join("")}</div>`
      : `<div class="notes"><p>No photos were submitted with this vehicle.</p></div>`;

    /* Open modal */
    $("agentDetail").classList.add("show");
    document.body.classList.add("locked");

    /* Wire approval controls */
    if (!current._car && isMainAdmin()) {
      $("negotiatedPrice")?.addEventListener("input", updateProfit);
      $("inventoryPrice")?.addEventListener("input", updateProfit);
      $("approveInventory")?.addEventListener("click", approveToInventory);
      updateProfit();
    }
  } catch (e) {
    console.error(e);
    $("error").textContent = e.message || "Unable to load submission.";
    $("error").classList.add("active");
  }
}

/* ---------------- DELETE ---------------- */

async function deleteRequest() {
  if (!current) return;

  if (
    !confirm(
      `Delete submission from ${current.agent_name || current.agent_email || "this agent"}? This cannot be undone.`
    )
  ) {
    return;
  }

  const id = current.id;

  try {
    const files = currentFiles.length ? currentFiles : await getFiles(id);
    const paths = files.map(f => f.storage_path).filter(Boolean);

    if (paths.length) {
      const { error: storageError } = await supabase.storage
        .from(SUBMISSION_BUCKET)
        .remove(paths);

      if (storageError) console.warn("Storage cleanup warning:", storageError);
    }

    await supabase.from("agent_vehicle_files").delete().eq("submission_id", id);

    const { error } = await supabase
      .from("agent_vehicle_submissions")
      .delete()
      .eq("id", id);

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

window.openInventoryCar = () => {
  if (current?._car?.id) {
    location.href = `edit.html?id=${encodeURIComponent(current._car.id)}`;
  }
};

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
  if (e.key === "Escape" && current) closeDetail();
});

$("menu").onclick = () => {
  $("sidebar").classList.add("open");
  $("overlay").classList.add("show");
};

$("closeMenu").onclick = $("overlay").onclick = () => {
  $("sidebar").classList.remove("open");
  $("overlay").classList.remove("show");
};

$("logoutBtn").onclick = async () => {
  await supabase.auth.signOut();
  location.replace("auth.html");
};

window.addEventListener("load", () =>
  setTimeout(() => $("loader")?.classList.add("hide"), 450)
);

/* ---------------- BOOT ---------------- */

requireAdmin("agent_submissions").then(async allowed => {
  if (!allowed) return;
  await auth();
  load();
});