import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";
import { markSectionSeen } from "./badges.js";
import { attachBadges } from "./admin-nav.js";

const $ = (id) => document.getElementById(id);

const grid = $("requestsGrid");

const BUCKET = "car-images";
const SELL_BUCKET = "sell-car-files";

/* =========================================================
   HELPERS
========================================================= */

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m])
  );

const money = (v) =>
  Number(v || 0).toLocaleString("en-KE");

const date = (v) =>
  v
    ? new Date(v).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "—";

const phone = (v) =>
  String(v || "")
    .replace(/\D/g, "")
    .replace(/^0/, "254");

const safe = (v) =>
  String(v || "image.jpg")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-");

/* =========================================================
   STATE
========================================================= */

let requests = [];
let current = null;
let currentAdmin = null;
let currentFiles = [];

let editorCar = null;
let editorImages = [];
let editorIsInventory = false;

let lightboxImages = [];
let lightboxIndex = 0;

let loadingPromise = null;

/* =========================================================
   DATABASE COLUMN LISTS
========================================================= */

/*
  Do NOT use select("*") for the request list.
  Keep this list limited to fields actually needed by cards,
  search, modal and approval.
*/

const REQUEST_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "status",

  "full_name",
  "phone",
  "email",
  "id_number",

  "contact_time",
  "location",

  "make",
  "model",
  "year",
  "condition",
  "body_type",
  "mileage",
  "fuel_type",
  "transmission",
  "colour",
  "engine_cc",
  "registration",

  "asking_price",
  "negotiable",
  "loan",
  "trade_in",

  "accident_history",
  "additional_info",

  "approved_car_id",
  "negotiated_price",
  "inventory_price",
  "approved_at",
  "approved_by"
].join(",");

/*
  Only fetch the columns needed when opening the full
  request details.
*/

const FILE_COLUMNS = [
  "id",
  "request_id",
  "storage_path",
  "file_name",
  "file_type",
  "field_name",
  "created_at"
].join(",");

/* =========================================================
   CAR EDITOR FIELDS
========================================================= */

const carFields = [
  ["condition", "Condition", "text", true],
  ["make", "Make", "text"],
  ["model", "Model", "text"],
  ["trim", "Trim / Grade", "text"],
  ["year", "Year", "number"],
  ["price", "Selling Price", "number"],
  ["purchase_price", "Purchase Price", "number"],
  ["currency", "Currency", "text"],
  ["status", "Status", "select"],
  ["body_type", "Body Type", "text"],
  ["engine_size", "Engine Size (L)", "number"],
  ["engine_description", "Engine Description", "text", true],
  ["horsepower", "Horsepower", "number"],
  ["mileage", "Mileage", "number"],
  ["mileage_unit", "Mileage Unit", "text"],
  ["fuel_type", "Fuel Type", "text"],
  ["transmission", "Transmission", "text"],
  ["drive_type", "Drive Type", "text"],
  ["exterior_color", "Exterior Colour", "text"],
  ["interior_color", "Interior Colour", "text"],
  ["seats", "Seats", "number"],
  ["doors", "Doors", "number"],
  ["vin", "VIN", "text"],
  ["chassis_number", "Chassis Number", "text"],
  ["registration_number", "Registration Number", "text"],
  ["stock_number", "Stock Number", "text"],
  ["country_of_origin", "Country Of Origin", "text"],
  ["import_year", "Import Year", "number"],
  ["registration_year", "Registration Year", "number"],
  ["auction_grade", "Auction Grade", "text"],
  ["previous_owners", "Previous Owners", "number"],
  ["number_of_keys", "Number Of Keys", "number"],
  ["accident_history", "Accident History", "text", true],
  ["service_history", "Service History", "text", true],
  ["inspection_status", "Inspection Status", "text"],
  ["inspection_notes", "Inspection Notes", "textarea", true],
  ["location", "Location", "text"],
  ["city", "City", "text"],
  ["county", "County", "text"],
  ["showroom_name", "Showroom / Yard", "text"],
  ["latitude", "Latitude", "number"],
  ["longitude", "Longitude", "number"],
  ["agent_name", "Agent Name", "text"],
  ["agent_email", "Agent Email", "text"],
  ["key_features", "Key Features", "textarea", true],
  ["description", "Description", "textarea", true],
  ["model_3d_url", "3D Model URL", "text", true]
];

const numeric = new Set(
  carFields
    .filter((f) => f[2] === "number")
    .map((f) => f[0])
);

const statusOptions = [
  "available",
  "reserved",
  "sold"
];

/* =========================================================
   REQUEST -> CAR MAPPING
========================================================= */

const requestMap = {
  make: "make",
  model: "model",
  year: "year",
  condition: "condition",
  body_type: "body_type",
  mileage: "mileage",
  fuel_type: "fuel_type",
  transmission: "transmission",
  exterior_color: "colour",
  registration_number: "registration",
  location: "location",
  price: "asking_price"
};

/* =========================================================
   AUTH
========================================================= */

async function auth() {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    location.replace("auth.html");
    return null;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,is_main_admin")
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

const isMainAdmin = () =>
  currentAdmin?.is_main_admin === true;

/* =========================================================
   REQUEST STATE
========================================================= */

const state = (x) =>
  x.approved_car_id
    ? "approved"
    : x.status || "new";

/* =========================================================
   LOAD REQUESTS
========================================================= */

async function load() {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    $("loading").style.display = "block";
    $("empty").style.display = "none";
    $("error").classList.remove("active");

    try {
      /*
        Auth is already performed by boot.
        DO NOT authenticate again here.
      */

      const { data, error } = await supabase
        .from("sell_car_requests")
        .select(REQUEST_COLUMNS)
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      requests = data || [];

      stats();

      /*
        Render immediately.
      */
      render();

    } catch (e) {
      console.error("Sell cars load error:", e);

      $("error").textContent =
        e.message || "Unable to load requests.";

      $("error").classList.add("active");

    } finally {
      $("loading").style.display = "none";
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/* =========================================================
   STATS
========================================================= */

function stats() {
  $("totalRequests").textContent =
    requests.length;

  $("newRequests").textContent =
    requests.filter(
      (x) => (x.status || "new") === "new"
    ).length;

  $("contactedRequests").textContent =
    requests.filter(
      (x) => x.status === "contacted"
    ).length;

  $("inspectedRequests").textContent =
    requests.filter(
      (x) => x.status === "inspected"
    ).length;

  $("completedRequests").textContent =
    requests.filter(
      (x) =>
        x.status === "approved" ||
        !!x.approved_car_id
    ).length;
}

/* =========================================================
   RENDER
========================================================= */

function render() {
  const search =
    ($("searchInput")?.value || "")
      .toLowerCase()
      .trim();

  const status =
    $("statusFilter")?.value || "all";

  const sort =
    $("sortFilter")?.value || "newest";

  let list = requests.filter((x) => {
    const text = [
      x.full_name,
      x.phone,
      x.email,
      x.registration,
      x.make,
      x.model,
      x.location,
      x.condition
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!search || text.includes(search)) &&
      (status === "all" ||
        state(x) === status)
    );
  });

  list.sort((a, b) => {
    if (sort === "oldest") {
      return (
        new Date(a.created_at) -
        new Date(b.created_at)
      );
    }

    if (sort === "price-high") {
      return (
        Number(b.asking_price || 0) -
        Number(a.asking_price || 0)
      );
    }

    if (sort === "price-low") {
      return (
        Number(a.asking_price || 0) -
        Number(b.asking_price || 0)
      );
    }

    return (
      new Date(b.created_at) -
      new Date(a.created_at)
    );
  });

  $("empty").style.display =
    list.length ? "none" : "block";

  const html = list
    .map((x) => {
      const st = state(x);
      const approved = !!x.approved_car_id;

      return `
        <article
          class="request-card ${approved ? "approved-request" : ""}"
          data-id="${esc(x.id)}"
        >
          <div class="request-top">
            <div class="request-badges">
              <span class="request-status ${esc(st)}">
                ${approved ? "IN INVENTORY" : esc(st)}
              </span>
            </div>

            <small>
              ${date(x.created_at)}
            </small>
          </div>

          <h3>
            ${esc(x.make || "Vehicle")}
            ${esc(x.model || "")}
            ${esc(x.year || "")}
          </h3>

          <p>
            <i class="fa-solid fa-user"></i>
            ${esc(x.full_name || "—")}
          </p>

          <p>
            <i class="fa-solid fa-phone"></i>
            ${esc(x.phone || "—")}
          </p>

          <div class="request-meta">
            <span>
              ${esc(x.registration || "No registration")}
              ·
              ${Number(x.mileage || 0).toLocaleString()}
              KM
            </span>

            <strong>
              KES ${money(x.asking_price)}
            </strong>
          </div>

          <div class="request-bottom">
            <span>
              ${esc(x.condition || "Condition —")}
            </span>

            <button type="button">
              View
              <i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  /*
    One DOM write instead of repeatedly changing innerHTML.
  */
  grid.innerHTML = html;
}

/* =========================================================
   DETAIL HELPERS
========================================================= */

function field(label, value) {
  return `
    <div class="detail-field">
      <span>${esc(label)}</span>
      <strong>${esc(value || "—")}</strong>
    </div>
  `;
}

function updateDetailStatus(s) {
  const b = $("detailStatusLabel");

  if (!b) return;

  b.className =
    `large-status ${s || "new"}`;

  b.textContent =
    s === "approved"
      ? "IN INVENTORY"
      : String(s || "new").toUpperCase();
}

/* =========================================================
   FILES
========================================================= */

async function getFiles(id) {
  const { data, error } = await supabase
    .from("sell_car_files")
    .select(FILE_COLUMNS)
    .eq("request_id", id)
    .order("created_at", {
      ascending: true
    });

  if (error) {
    console.error("File load error:", error);
    return [];
  }

  return data || [];
}

function publicSellUrl(path) {
  if (!path) return "";

  return supabase.storage
    .from(SELL_BUCKET)
    .getPublicUrl(path)
    .data.publicUrl;
}

/* =========================================================
   FILE CARDS
========================================================= */

function fileCard(f, i) {
  const url =
    publicSellUrl(f.storage_path);

  const type =
    String(f.file_type || "").toLowerCase();

  const image =
    type.startsWith("image/");

  const video =
    type.startsWith("video/");

  const icon =
    video
      ? "fa-video"
      : type === "application/pdf"
        ? "fa-file-pdf"
        : "fa-file";

  return `
    <div class="file-item">

      ${
        image
          ? `
            <img
              src="${esc(url)}"
              data-lightbox-index="${i}"
              alt="${esc(f.file_name || "")}"
              loading="lazy"
              decoding="async"
            >
          `
          : video
            ? `
              <video
                src="${esc(url)}"
                controls
                preload="metadata"
              ></video>
            `
            : `
              <div class="file-icon">
                <i class="fa-solid ${icon}"></i>
              </div>
            `
      }

      <div class="file-info">
        <strong>
          ${esc(f.field_name || "File")}
        </strong>

        <span>
          ${esc(f.file_name || "")}
        </span>

        ${
          url
            ? `
              <a
                href="${esc(url)}"
                target="_blank"
                rel="noopener"
              >
                Open File
              </a>
            `
            : ""
        }
      </div>
    </div>
  `;
}

/* =========================================================
   OPEN REQUEST
========================================================= */

async function openRequest(id) {
  const found =
    requests.find(
      (x) => String(x.id) === String(id)
    );

  if (!found) return;

  /*
    IMPORTANT:
    Set current and OPEN the modal immediately.
  */
  current = found;

  const status = state(current);

  $("modalTitle").textContent =
    `${current.make || "Vehicle"} ${
      current.model || ""
    } ${current.year || ""} — ${
      current.full_name || "Customer"
    }`.trim();

  $("detailDate").textContent =
    date(current.created_at);

  $("modalStatus").value = status;

  updateDetailStatus(status);

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
    p
      ? `
        <a
          class="contact-action-large"
          href="tel:+${esc(p)}"
        >
          <i class="fa-solid fa-phone"></i>
          Call Customer
        </a>
      `
      : "",

    p
      ? `
        <a
          class="contact-action-large whatsapp"
          href="https://wa.me/${esc(p)}"
          target="_blank"
          rel="noopener"
        >
          <i class="fa-brands fa-whatsapp"></i>
          WhatsApp
        </a>
      `
      : "",

    current.email
      ? `
        <a
          class="contact-action-large"
          href="mailto:${esc(current.email)}"
        >
          <i class="fa-solid fa-envelope"></i>
          Email Customer
        </a>
      `
      : ""
  ].join("");

  $("financialDetails").innerHTML = [
    field(
      "Asking Price",
      `KES ${money(current.asking_price)}`
    ),
    field("Negotiable", current.negotiable),
    field("Outstanding Loan", current.loan),
    field("Open to Trade-In", current.trade_in)
  ].join("");

  $("additionalDetails").innerHTML = [
    field(
      "Additional Information",
      current.additional_info
    ),
    field(
      "Submitted",
      date(current.created_at)
    ),
    field("Request ID", current.id),
    field("Status", status)
  ].join("");

  $("vehicleTitle").textContent =
    `${current.make || "Vehicle"} ${
      current.model || ""
    } ${current.year || ""}`.trim();

  $("vehicleMeta").textContent =
    [
      current.registration,
      current.location
    ]
      .filter(Boolean)
      .join(" • ") ||
    "Sell-in vehicle";

  $("vehicleDetails").innerHTML = [
    field("Condition", current.condition),
    field("Make", current.make),
    field("Model", current.model),
    field("Year", current.year),
    field("Registration", current.registration),
    field("Colour", current.colour),

    field(
      "Mileage",
      current.mileage != null
        ? `${Number(current.mileage).toLocaleString()} km`
        : "—"
    ),

    field(
      "Transmission",
      current.transmission
    ),

    field(
      "Fuel Type",
      current.fuel_type
    ),

    field(
      "Engine",
      current.engine_cc
        ? `${current.engine_cc} CC`
        : "—"
    ),

    field(
      "Body Type",
      current.body_type
    ),

    field(
      "Accident History",
      current.accident_history
    )
  ].join("");

  $("approvalContent").innerHTML =
    approvalPanel();

  /*
    OPEN NOW.
    Do not wait for files.
  */
  $("requestModal").classList.add("show");
  document.body.classList.add("locked");

  bindRequestActions();

  /*
    Load files AFTER modal is visible.
  */
  $("filesContent").innerHTML = `
    <div class="notes">
      <p>Loading vehicle files...</p>
    </div>
  `;

  currentFiles = [];

  try {
    const files = await getFiles(id);

    /*
      User may have closed/opened another request
      while files were loading.
    */
    if (
      !current ||
      String(current.id) !== String(id)
    ) {
      return;
    }

    currentFiles = files;

    lightboxImages = currentFiles
      .filter((f) =>
        String(f.file_type || "")
          .startsWith("image/")
      )
      .map((f) =>
        publicSellUrl(f.storage_path)
      )
      .filter(Boolean);

    $("filesContent").innerHTML =
      currentFiles.length
        ? `
          <div class="files-grid">
            ${currentFiles
              .map(fileCard)
              .join("")}
          </div>
        `
        : `
          <div class="notes">
            <p>No vehicle files were submitted.</p>
          </div>
        `;

    document
      .querySelectorAll("[data-lightbox-index]")
      .forEach((x) => {
        x.onclick = () =>
          openLightbox(
            Number(
              x.dataset.lightboxIndex
            )
          );
      });

  } catch (e) {
    console.error(e);

    $("filesContent").innerHTML = `
      <div class="notes">
        <p>Vehicle files could not be loaded.</p>
      </div>
    `;
  }
}

/* =========================================================
   REQUEST ACTIONS
========================================================= */

function bindRequestActions() {
  $("openInventoryBtn")?.addEventListener(
    "click",
    () =>
      openEditor(
        current?.approved_car_id
      )
  );

  $("negotiatedPrice")?.addEventListener(
    "input",
    updateProfit
  );

  $("inventoryPrice")?.addEventListener(
    "input",
    updateProfit
  );

  $("approveInventory")?.addEventListener(
    "click",
    approveToInventory
  );

  updateProfit();
}

function updateProfit() {
  const buy =
    Number(
      $("negotiatedPrice")?.value || 0
    );

  const sell =
    Number(
      $("inventoryPrice")?.value || 0
    );

  const profit = sell - buy;

  const el = $("profitValue");

  if (!el) return;

  el.textContent =
    `KES ${money(profit)}`;

  el.className =
    profit < 0
      ? "profit-negative"
      : "profit-positive";
}

/* =========================================================
   APPROVAL PANEL
========================================================= */

function approvalPanel() {
  if (!current) return "";

  if (current.approved_car_id) {
    const profit =
      Number(current.inventory_price || 0) -
      Number(current.negotiated_price || 0);

    return `
      <section class="approval-panel">

        <div class="approval-title">
          <div>
            <i class="fa-solid fa-circle-check"></i>
          </div>

          <div>
            <span>INVENTORY STATUS</span>
            <h3>Vehicle Approved & Added</h3>
          </div>
        </div>

        <div class="approval-summary">

          <div>
            <span>Purchase Price</span>
            <strong>
              KES ${money(current.negotiated_price)}
            </strong>
          </div>

          <div>
            <span>Inventory Price</span>
            <strong>
              KES ${money(current.inventory_price)}
            </strong>
          </div>

          <div>
            <span>Estimated Gross Profit</span>
            <strong class="${
              profit >= 0
                ? "profit-positive"
                : "profit-negative"
            }">
              KES ${money(profit)}
            </strong>
          </div>

        </div>

        <div style="margin-top:12px">

          <button
            type="button"
            class="inventory-btn"
            id="openInventoryBtn"
          >
            <i class="fa-solid fa-pen-to-square"></i>
            Open Vehicle Editor
          </button>

          <a
            class="inventory-btn"
            style="margin-left:8px;display:inline-block;text-decoration:none"
            href="edit.html?id=${encodeURIComponent(
              current.approved_car_id
            )}"
          >
            <i class="fa-solid fa-up-right-from-square"></i>
            Open Full Inventory Page
          </a>

        </div>

      </section>
    `;
  }

  if (!isMainAdmin()) {
    return `
      <section class="approval-panel locked-panel">

        <div class="approval-title">

          <div>
            <i class="fa-solid fa-lock"></i>
          </div>

          <div>
            <span>INVENTORY APPROVAL</span>

            <h3>
              Main Admin Approval Required
            </h3>

            <p>
              Only the main administrator can approve
              this vehicle and move it into inventory.
            </p>
          </div>

        </div>

      </section>
    `;
  }

  return `
    <section class="approval-panel">

      <div class="approval-title">

        <div>
          <i class="fa-solid fa-handshake"></i>
        </div>

        <div>
          <span>INVENTORY APPROVAL</span>

          <h3>
            Approve & Add to Inventory
          </h3>

          <p>
            Enter the actual negotiated purchase price
            and inventory selling price.
          </p>
        </div>

      </div>

      <div class="asking-price">
        <span>Seller Asking Price</span>

        <strong>
          KES ${money(current.asking_price)}
        </strong>
      </div>

      <div class="approval-grid">

        <div>
          <label>
            Negotiated Purchase Price *
          </label>

          <input
            id="negotiatedPrice"
            type="number"
            min="0"
            value="${
              current.negotiated_price ?? ""
            }"
          >
        </div>

        <div>
          <label>
            Inventory Selling Price *
          </label>

          <input
            id="inventoryPrice"
            type="number"
            min="0"
            value="${
              current.inventory_price ?? ""
            }"
          >
        </div>

      </div>

      <div class="profit-box">

        <div>
          <span>Estimated Gross Profit</span>

          <strong id="profitValue">
            KES 0
          </strong>
        </div>

        <small>
          Selling price minus negotiated purchase price.
        </small>

      </div>

      <button
        id="approveInventory"
        type="button"
        class="approve-btn"
      >
        <i class="fa-solid fa-car-side"></i>
        Approve & Add to Inventory
      </button>

    </section>
  `;
}

/* =========================================================
   EDITOR
========================================================= */

function editorValue(key) {
  if (editorCar) {
    return editorCar[key] ?? "";
  }

  return current?.[requestMap[key] || key] ?? "";
}

function editorHTML() {
  return carFields
    .map(
      ([key, label, type, priority]) => {
        const value =
          editorValue(key);

        let input;

        if (type === "textarea") {
          input = `
            <textarea id="ed_${key}">
${esc(value)}
            </textarea>
          `;
        } else if (type === "select") {
          input = `
            <select id="ed_${key}">
              ${statusOptions
                .map(
                  (o) => `
                    <option
                      value="${o}"
                      ${
                        String(value) === o
                          ? "selected"
                          : ""
                      }
                    >
                      ${o}
                    </option>
                  `
                )
                .join("")}
            </select>
          `;
        } else {
          input = `
            <input
              id="ed_${key}"
              type="${type}"
              value="${esc(value)}"
            >
          `;
        }

        return `
          <div
            class="editor-field ${
              priority ? "priority" : ""
            }"
          >
            <label>${esc(label)}</label>
            ${input}
          </div>
        `;
      }
    )
    .join("");
}

/* =========================================================
   INVENTORY IMAGE LOAD
========================================================= */

async function loadEditorImages(carId) {
  if (!carId) return [];

  const {
    data,
    error
  } = await supabase
    .from("car_images")
    .select(
      "id,car_id,image_url,storage_path,image_type,display_order"
    )
    .eq("car_id", carId)
    .order("display_order", {
      ascending: true
    });

  if (error) throw error;

  return data || [];
}

function editorGalleryHTML() {
  const display =
    editorCar?.display_image_url;

  return editorImages
    .map(
      (x, i) => `
        <div class="editor-image">

          ${
            display &&
            x.image_url === display
              ? `
                <span class="display-mark">
                  DISPLAY
                </span>
              `
              : ""
          }

          <img
            src="${esc(x.image_url)}"
            data-editor-lightbox="${i}"
            alt=""
            loading="lazy"
            decoding="async"
          >

          <div class="editor-image-actions">

            <button
              class="make-display"
              data-display="${i}"
              type="button"
            >
              Display
            </button>

            <button
              class="delete-editor-image"
              data-delete="${i}"
              type="button"
            >
              Delete
            </button>

          </div>

        </div>
      `
    )
    .join("");
}

function renderEditorGallery() {
  $("editorGallery").innerHTML =
    editorImages.length
      ? editorGalleryHTML()
      : "<p class='notes'>No gallery images.</p>";

  document
    .querySelectorAll(
      "[data-editor-lightbox]"
    )
    .forEach((x) => {
      x.onclick = () => {
        const imgs =
          editorImages.map(
            (im) => im.image_url
          );

        openLightboxUrl(
          imgs,
          Number(
            x.dataset.editorLightbox
          )
        );
      };
    });

  document
    .querySelectorAll("[data-delete]")
    .forEach((x) => {
      x.onclick = () =>
        deleteEditorImage(
          Number(x.dataset.delete)
        );
    });

  document
    .querySelectorAll("[data-display]")
    .forEach((x) => {
      x.onclick = () =>
        makeEditorDisplay(
          Number(x.dataset.display)
        );
    });
}

async function openEditor(carId) {
  if (!current) return;

  try {
    if (carId) {
      const {
        data,
        error
      } = await supabase
        .from("cars")
        .select("*")
        .eq("id", carId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new Error(
          "Inventory vehicle could not be found."
        );
      }

      editorCar = data;

      /*
        Load images in parallel with editor setup.
      */
      const imagePromise =
        loadEditorImages(carId);

      editorImages =
        await imagePromise;

      editorIsInventory = true;

      $("editorMode").textContent =
        "Editing the live inventory vehicle. Changes are saved to the cars record.";

    } else {
      editorCar = null;
      editorImages = [];
      editorIsInventory = false;

      $("editorMode").textContent =
        "Editing the incoming Sell-In vehicle information. Changes are saved to the request record.";
    }

    $("editorTitle").textContent =
      `Edit ${
        current.make || "Vehicle"
      } ${
        current.model || ""
      }`.trim();

    $("vehicleEditorFields").innerHTML =
      editorHTML();

    $("editorMessage").innerHTML = "";

    $("editorModal").classList.add("show");

    renderEditorGallery();

  } catch (e) {
    console.error(e);

    alert(
      e.message ||
      "Unable to open vehicle editor."
    );
  }
}

/* =========================================================
   SAVE EDITOR
========================================================= */

async function saveEditor(e) {
  e.preventDefault();

  const btn =
    document.querySelector(
      ".editor-save"
    );

  if (!btn) return;

  btn.disabled = true;

  btn.innerHTML = `
    <i class="fa-solid fa-spinner fa-spin"></i>
    Saving...
  `;

  try {
    const updates = {};

    carFields.forEach(([key]) => {
      const el = $(`ed_${key}`);

      if (!el) return;

      const value =
        el.value.trim();

      updates[key] =
        value === ""
          ? null
          : numeric.has(key)
            ? Number(value)
            : value;
    });

    updates.updated_at =
      new Date().toISOString();

    if (editorCar) {
      const {
        error
      } = await supabase
        .from("cars")
        .update(updates)
        .eq("id", editorCar.id);

      if (error) throw error;

      editorCar = {
        ...editorCar,
        ...updates
      };

    } else {
      const requestUpdates = {};

      Object.entries(updates)
        .forEach(([key, value]) => {
          if (requestMap[key]) {
            requestUpdates[
              requestMap[key]
            ] = value;
          }
        });

      const {
        error
      } = await supabase
        .from("sell_car_requests")
        .update({
          ...requestUpdates,
          updated_at:
            new Date().toISOString()
        })
        .eq("id", current.id);

      if (error) throw error;

      current = {
        ...current,
        ...requestUpdates
      };

      requests = requests.map(
        (x) =>
          x.id === current.id
            ? current
            : x
      );
    }

    $("editorMessage").innerHTML = `
      <div class="success active">
        Vehicle saved successfully.
      </div>
    `;

    render();

    setTimeout(() => {
      closeEditor();

      if (current) {
        openRequest(current.id);
      }
    }, 300);

  } catch (e) {
    console.error(e);

    $("editorMessage").innerHTML = `
      <div class="error active">
        ${esc(
          e.message ||
          "Unable to save vehicle."
        )}
      </div>
    `;

  } finally {
    btn.disabled = false;

    btn.innerHTML = `
      <i class="fa-solid fa-floppy-disk"></i>
      Save Changes
    `;
  }
}

/* =========================================================
   UPLOAD IMAGES
========================================================= */

async function uploadEditorImages(files) {
  if (!editorCar?.id) {
    return alert(
      "Approve the vehicle into inventory before adding gallery images."
    );
  }

  /*
    Upload in parallel rather than one image
    waiting for the previous image.
  */
  const results =
    await Promise.allSettled(
      files.map(async (file, index) => {
        const path =
          `${editorCar.id}/gallery/` +
          `${crypto.randomUUID()}-${safe(file.name)}`;

        const upload =
          await supabase.storage
            .from(BUCKET)
            .upload(
              path,
              file,
              {
                cacheControl: "3600",
                upsert: false
              }
            );

        if (upload.error) {
          throw upload.error;
        }

        const url =
          supabase.storage
            .from(BUCKET)
            .getPublicUrl(path)
            .data.publicUrl;

        const insert =
          await supabase
            .from("car_images")
            .insert({
              car_id: editorCar.id,
              image_url: url,
              storage_path: path,
              image_type: "gallery",
              display_order:
                editorImages.length +
                index
            })
            .select(
              "id,car_id,image_url,storage_path,image_type,display_order"
            )
            .single();

        if (insert.error) {
          await supabase.storage
            .from(BUCKET)
            .remove([path]);

          throw insert.error;
        }

        return insert.data;
      })
    );

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      editorImages.push(
        result.value
      );
    } else {
      console.error(
        "Image upload failed:",
        result.reason
      );
    }
  });

  renderEditorGallery();
}

/* =========================================================
   DELETE IMAGE
========================================================= */

async function deleteEditorImage(i) {
  const image =
    editorImages[i];

  if (
    !image ||
    !confirm(
      "Delete this gallery image?"
    )
  ) {
    return;
  }

  try {
    if (image.storage_path) {
      const {
        error
      } = await supabase.storage
        .from(BUCKET)
        .remove([
          image.storage_path
        ]);

      if (error) throw error;
    }

    const {
      error
    } = await supabase
      .from("car_images")
      .delete()
      .eq("id", image.id);

    if (error) throw error;

    editorImages.splice(i, 1);

    renderEditorGallery();

  } catch (e) {
    console.error(e);

    alert(
      e.message ||
      "Unable to delete image."
    );
  }
}

/* =========================================================
   DISPLAY IMAGE
========================================================= */

async function makeEditorDisplay(i) {
  const image =
    editorImages[i];

  if (!image || !editorCar) return;

  try {
    const {
      error
    } = await supabase
      .from("cars")
      .update({
        display_image_url:
          image.image_url,

        display_image_path:
          image.storage_path,

        updated_at:
          new Date().toISOString()
      })
      .eq("id", editorCar.id);

    if (error) throw error;

    editorCar = {
      ...editorCar,
      display_image_url:
        image.image_url,

      display_image_path:
        image.storage_path
    };

    renderEditorGallery();

  } catch (e) {
    console.error(e);

    alert(
      e.message ||
      "Unable to set display image."
    );
  }
}

/* =========================================================
   APPROVE INTO INVENTORY
========================================================= */

async function approveToInventory() {
  if (!current || !isMainAdmin()) {
    return alert(
      "Only the main administrator can approve vehicles into inventory."
    );
  }

  if (current.approved_car_id) {
    return alert(
      "This request has already been added to inventory."
    );
  }

  const buy =
    Number(
      $("negotiatedPrice")?.value
    );

  const sell =
    Number(
      $("inventoryPrice")?.value
    );

  if (
    !Number.isFinite(buy) ||
    buy < 0
  ) {
    return alert(
      "Enter a valid negotiated purchase price."
    );
  }

  if (
    !Number.isFinite(sell) ||
    sell <= 0
  ) {
    return alert(
      "Enter a valid inventory selling price."
    );
  }

  if (
    !confirm(
      `Approve ${
        current.make || "vehicle"
      } and add it to inventory for KES ${money(
        sell
      )}?`
    )
  ) {
    return;
  }

  const button =
    $("approveInventory");

  button.disabled = true;

  button.innerHTML = `
    <i class="fa-solid fa-spinner fa-spin"></i>
    Adding...
  `;

  try {
    const {
      data: {
        session
      }
    } =
      await supabase.auth.getSession();

    /*
      Check for an existing car using only
      the fields we actually need.
    */
    const {
      data: existing,
      error: existingError
    } = await supabase
      .from("cars")
      .select(
        "id,source_request_id"
      )
      .eq(
        "source_request_id",
        current.id
      )
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    let car = existing;

    if (!car) {
      const now =
        new Date().toISOString();

      const carData = {
        make:
          current.make || null,

        model:
          current.model || null,

        year:
          current.year
            ? Number(current.year)
            : null,

        price: sell,

        purchase_price: buy,

        condition:
          current.condition || null,

        body_type:
          current.body_type || null,

        mileage:
          current.mileage != null
            ? Number(current.mileage)
            : null,

        fuel_type:
          current.fuel_type || null,

        transmission:
          current.transmission || null,

        engine_size:
          current.engine_cc != null
            ? Number(current.engine_cc) /
              1000
            : null,

        registration_number:
          current.registration || null,

        location:
          current.location || null,

        city:
          current.location || null,

        exterior_color:
          current.colour || null,

        accident_history:
          current.accident_history ||
          null,

        negotiable:
          String(
            current.negotiable || ""
          ).toLowerCase() === "yes" ||
          current.negotiable === true,

        status: "available",

        featured: false,

        financing_available:
          false,

        test_drive_available:
          true,

        source_request_id:
          current.id,

        source_type:
          "sell_in",

        created_at: now,

        updated_at: now
      };

      const {
        data,
        error
      } = await supabase
        .from("cars")
        .insert(carData)
        .select("id")
        .single();

      if (error) throw error;

      car = data;
    }

    /*
      Image transfer.

      This is still necessarily more expensive because
      the browser must download the old object and upload
      it to the new bucket.

      We do the transfers in parallel.
    */
    if (!existing) {
      const images =
        currentFiles.filter(
          (f) =>
            String(
              f.file_type || ""
            ).startsWith("image/") &&
            f.storage_path
        );

      await Promise.all(
        images.map(
          async (image, index) => {
            const download =
              await supabase.storage
                .from(SELL_BUCKET)
                .download(
                  image.storage_path
                );

            if (download.error) {
              throw download.error;
            }

            const path =
              `${car.id}/gallery/` +
              `${crypto.randomUUID()}-${safe(
                image.file_name
              )}`;

            const upload =
              await supabase.storage
                .from(BUCKET)
                .upload(
                  path,
                  download.data,
                  {
                    cacheControl:
                      "3600",
                    upsert: false
                  }
                );

            if (upload.error) {
              throw upload.error;
            }

            const url =
              supabase.storage
                .from(BUCKET)
                .getPublicUrl(path)
                .data.publicUrl;

            const insert =
              await supabase
                .from("car_images")
                .insert({
                  car_id: car.id,
                  image_url: url,
                  storage_path: path,
                  image_type:
                    "gallery",
                  display_order:
                    index
                });

            if (insert.error) {
              throw insert.error;
            }

            if (index === 0) {
              await supabase
                .from("cars")
                .update({
                  display_image_url:
                    url,

                  display_image_path:
                    path
                })
                .eq(
                  "id",
                  car.id
                );
            }
          }
        )
      );
    }

    const now =
      new Date().toISOString();

    const update = {
      status: "approved",

      negotiated_price: buy,

      inventory_price: sell,

      approved_car_id:
        car.id,

      approved_at: now,

      approved_by:
        session.user.id,

      updated_at: now
    };

    /*
      Atomic-ish guard:
      only update if approved_car_id is still NULL.
    */
    const {
      data: updated,
      error
    } = await supabase
      .from("sell_car_requests")
      .update(update)
      .eq("id", current.id)
      .is("approved_car_id", null)
      .select("id")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!updated) {
      throw new Error(
        "This request was already approved by another administrator."
      );
    }

    current = {
      ...current,
      ...update
    };

    requests =
      requests.map(
        (x) =>
          x.id === current.id
            ? current
            : x
      );

    closeRequest();

    stats();

    render();

    alert(
      "Vehicle approved and added to inventory."
    );

  } catch (e) {
    console.error(
      "Approval error:",
      e
    );

    alert(
      e.message ||
      "Unable to add vehicle to inventory."
    );

  } finally {
    button.disabled = false;

    button.innerHTML = `
      <i class="fa-solid fa-car-side"></i>
      Approve & Add to Inventory
    `;
  }
}

/* =========================================================
   SAVE STATUS
========================================================= */

async function saveStatus() {
  if (!current) return;

  const status =
    $("modalStatus").value;

  if (
    current.approved_car_id &&
    status !== "approved" &&
    !confirm(
      "This request is already linked to an inventory vehicle. Change its request status anyway?"
    )
  ) {
    return;
  }

  const {
    error
  } = await supabase
    .from("sell_car_requests")
    .update({
      status,
      updated_at:
        new Date().toISOString()
    })
    .eq(
      "id",
      current.id
    );

  if (error) {
    return alert(
      error.message
    );
  }

  current.status = status;

  requests =
    requests.map(
      (x) =>
        x.id === current.id
          ? current
          : x
    );

  updateDetailStatus(status);

  stats();

  render();
}

/* =========================================================
   DELETE REQUEST
========================================================= */

async function deleteRequest() {
  if (
    !current ||
    !confirm(
      `Delete sell request from ${
        current.full_name ||
        "this customer"
      }?`
    )
  ) {
    return;
  }

  if (current.approved_car_id) {
    return alert(
      "This request has already been converted into an inventory vehicle. Delete the vehicle first."
    );
  }

  try {
    const {
      data,
      error
    } = await supabase
      .from("sell_car_files")
      .select("storage_path")
      .eq(
        "request_id",
        current.id
      );

    if (error) throw error;

    const paths =
      (data || [])
        .map(
          (x) =>
            x.storage_path
        )
        .filter(Boolean);

    if (paths.length) {
      const {
        error
      } = await supabase.storage
        .from(SELL_BUCKET)
        .remove(paths);

      if (error) throw error;
    }

    const {
      error: deleteError
    } = await supabase
      .from("sell_car_requests")
      .delete()
      .eq(
        "id",
        current.id
      );

    if (deleteError) {
      throw deleteError;
    }

    requests =
      requests.filter(
        (x) =>
          x.id !== current.id
      );

    closeRequest();

    stats();

    render();

  } catch (e) {
    console.error(e);

    alert(
      e.message ||
      "Unable to delete request."
    );
  }
}

/* =========================================================
   CLOSE MODALS
========================================================= */

function closeRequest() {
  $("requestModal")
    ?.classList.remove("show");

  document.body.classList.remove(
    "locked"
  );

  current = null;
  currentFiles = [];
}

function closeEditor() {
  $("editorModal")
    ?.classList.remove("show");
}

/* =========================================================
   LIGHTBOX
========================================================= */

function openLightbox(i) {
  openLightboxUrl(
    lightboxImages,
    i
  );
}

function openLightboxUrl(
  images,
  i
) {
  lightboxImages =
    images.filter(Boolean);

  if (!lightboxImages.length) {
    return;
  }

  lightboxIndex =
    Math.max(
      0,
      Math.min(
        i,
        lightboxImages.length - 1
      )
    );

  $("lightboxImage").src =
    lightboxImages[
      lightboxIndex
    ];

  $("lightboxCount").textContent =
    `${lightboxIndex + 1} / ${
      lightboxImages.length
    }`;

  $("lightbox").classList.add(
    "show"
  );
}

function lightboxMove(n) {
  if (!lightboxImages.length) {
    return;
  }

  lightboxIndex =
    (
      lightboxIndex +
      n +
      lightboxImages.length
    ) %
    lightboxImages.length;

  $("lightboxImage").src =
    lightboxImages[
      lightboxIndex
    ];

  $("lightboxCount").textContent =
    `${lightboxIndex + 1} / ${
      lightboxImages.length
    }`;
}

function closeLightbox() {
  $("lightbox")
    ?.classList.remove("show");
}

/* =========================================================
   PRINT FORM
========================================================= */

function downloadForm() {
  if (!current) return;

  const rows =
    (title, obj) =>
      `
        <h2>${title}</h2>
        <table>
          ${Object.entries(obj)
            .map(
              ([k, v]) =>
                `
                  <tr>
                    <td>${esc(k)}</td>
                    <td>${esc(v || "—")}</td>
                  </tr>
                `
            )
            .join("")}
        </table>
      `;

  const imgs =
    lightboxImages
      .map(
        (x) =>
          `<img class="print-image" src="${esc(x)}">`
      )
      .join("");

  $("printForm").innerHTML = `
    <div class="print-head">

      <div>
        <h1>
          REGIONAL AUTOSELECTIONS LTD
        </h1>

        <div class="print-small">
          SELL-IN VEHICLE VALUATION FORM
        </div>
      </div>

      <div class="print-small">
        Generated:
        ${date(new Date())}
      </div>

    </div>

    ${rows(
      "Request Information",
      {
        "Request ID":
          current.id,

        "Date":
          date(
            current.created_at
          ),

        "Status":
          state(current)
      }
    )}

    ${rows(
      "Seller Information",
      {
        "Full Name":
          current.full_name,

        "Phone":
          current.phone,

        "Email":
          current.email,

        "ID / Passport":
          current.id_number,

        "Location":
          current.location,

        "Contact Time":
          current.contact_time
      }
    )}

    ${rows(
      "Vehicle Information",
      {
        "Condition":
          current.condition,

        "Make":
          current.make,

        "Model":
          current.model,

        "Year":
          current.year,

        "Registration":
          current.registration,

        "Colour":
          current.colour,

        "Mileage":
          current.mileage
            ? `${Number(
                current.mileage
              ).toLocaleString()} KM`
            : "—",

        "Transmission":
          current.transmission,

        "Fuel Type":
          current.fuel_type,

        "Engine":
          current.engine_cc
            ? `${current.engine_cc} CC`
            : "—",

        "Body Type":
          current.body_type,

        "Accident History":
          current.accident_history
      }
    )}

    ${rows(
      "Financial Information",
      {
        "Asking Price":
          `KES ${money(
            current.asking_price
          )}`,

        "Negotiable":
          current.negotiable,

        "Outstanding Loan":
          current.loan,

        "Open to Trade-In":
          current.trade_in,

        "Negotiated Purchase":
          current.negotiated_price
            ? `KES ${money(
                current.negotiated_price
              )}`
            : "—",

        "Inventory Price":
          current.inventory_price
            ? `KES ${money(
                current.inventory_price
              )}`
            : "—"
      }
    )}

    ${rows(
      "Additional Information",
      {
        "Additional Information":
          current.additional_info
      }
    )}

    <h2>
      Submitted Photos
    </h2>

    <div>
      ${
        imgs ||
        "No photos submitted."
      }
    </div>
  `;

  window.print();
}

/* =========================================================
   EVENTS
========================================================= */

grid.addEventListener(
  "click",
  (e) => {
    const card =
      e.target.closest(
        ".request-card"
      );

    if (card) {
      openRequest(
        card.dataset.id
      );
    }
  }
);

$("searchInput").oninput =
  render;

$("statusFilter").onchange =
  render;

$("sortFilter").onchange =
  render;

$("refreshBtn").onclick =
  load;

$("modalStatus").onchange =
  (e) =>
    updateDetailStatus(
      e.target.value
    );

$("saveStatus").onclick =
  saveStatus;

$("deleteRequest").onclick =
  deleteRequest;

$("closeRequest").onclick =
  closeRequest;

$("closeRequestBg").onclick =
  closeRequest;

$("editVehicleBtn").onclick =
  () =>
    openEditor(
      current?.approved_car_id
    );

$("downloadForm").onclick =
  downloadForm;

$("closeEditor").onclick =
  closeEditor;

$("cancelEditor").onclick =
  closeEditor;

$("closeEditorBg").onclick =
  closeEditor;

$("vehicleEditorForm").onsubmit =
  saveEditor;

$("editorGalleryInput").onchange =
  (e) => {
    uploadEditorImages(
      [...e.target.files]
    );

    e.target.value = "";
  };

$("editorDisplayInput").onchange =
  async (e) => {
    const file =
      e.target.files[0];

    if (!file || !editorCar) {
      return;
    }

    try {
      const path =
        `${editorCar.id}/display/` +
        `${crypto.randomUUID()}-${safe(
          file.name
        )}`;

      const upload =
        await supabase.storage
          .from(BUCKET)
          .upload(
            path,
            file,
            {
              cacheControl:
                "3600",
              upsert: false
            }
          );

      if (upload.error) {
        throw upload.error;
      }

      const url =
        supabase.storage
          .from(BUCKET)
          .getPublicUrl(path)
          .data.publicUrl;

      const old =
        editorCar.display_image_path;

      const {
        error
      } = await supabase
        .from("cars")
        .update({
          display_image_url:
            url,

          display_image_path:
            path,

          updated_at:
            new Date().toISOString()
        })
        .eq(
          "id",
          editorCar.id
        );

      if (error) throw error;

      editorCar = {
        ...editorCar,

        display_image_url:
          url,

        display_image_path:
          path
      };

      /*
        Do not block the UI on deleting the old image.
      */
      if (old) {
        supabase.storage
          .from(BUCKET)
          .remove([old])
          .catch(
            (err) =>
              console.warn(
                "Old image cleanup failed:",
                err
              )
          );
      }

      renderEditorGallery();

    } catch (e) {
      console.error(e);

      alert(
        e.message ||
        "Unable to replace display image."
      );
    }

    e.target.value = "";
  };

$("lightboxClose").onclick =
  closeLightbox;

$("lightboxBg").onclick =
  closeLightbox;

$("lightboxPrev").onclick =
  () =>
    lightboxMove(-1);

$("lightboxNext").onclick =
  () =>
    lightboxMove(1);

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape") {
      if (
        $("lightbox")
          ?.classList.contains(
            "show"
          )
      ) {
        closeLightbox();
      } else if (
        $("editorModal")
          ?.classList.contains(
            "show"
          )
      ) {
        closeEditor();
      } else if (current) {
        closeRequest();
      }
    }

    if (
      $("lightbox")
        ?.classList.contains(
          "show"
        )
    ) {
      if (
        e.key === "ArrowLeft"
      ) {
        lightboxMove(-1);
      }

      if (
        e.key === "ArrowRight"
      ) {
        lightboxMove(1);
      }
    }
  }
);

$("menu").onclick = () => {
  $("sidebar")
    .classList.add("open");

  $("overlay")
    .classList.add("show");
};

$("closeMenu").onclick =
  $("overlay").onclick =
    () => {
      $("sidebar")
        .classList.remove(
          "open"
        );

      $("overlay")
        .classList.remove(
          "show"
        );
    };

$("logoutBtn").onclick =
  async () => {
    await supabase.auth.signOut();

    location.replace(
      "auth.html"
    );
  };

/* =========================================================
   LOADER
========================================================= */

window.addEventListener(
  "load",
  () =>
    setTimeout(
      () =>
        $("loader")
          ?.classList.add("hide"),
      300
    )
);

/* =========================================================
   BOOT
========================================================= */

(async function boot() {
  try {
    /*
      Authenticate ONCE.

      requireAdmin handles access.
      Then our auth gets the admin record once.
    */
    const allowed =
      await requireAdmin(
        "sellcars"
      );

    if (!allowed) return;

    const admin =
      await auth();

    if (!admin) return;

    /*
      Now load only once.
    */
    await load();

    /*
      These don't need to block page loading.
    */
    markSectionSeen(
      "sellcars"
    );

    attachBadges();

  } catch (e) {
    console.error(
      "Sell cars boot error:",
      e
    );

    $("error").textContent =
      e.message ||
      "Unable to load Sell Cars.";

    $("error")
      .classList.add("active");

  } finally {
    setTimeout(
      () =>
        $("loader")
          ?.classList.add("hide"),
      200
    );
  }
})();