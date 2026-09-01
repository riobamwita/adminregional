import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";

const $ = id => document.getElementById(id);

const grid = $("requestsGrid");

const money = value =>
  Number(value || 0).toLocaleString("en-KE");

const date = value =>
  value
    ? new Date(value).toLocaleString("en-KE", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "—";

const esc = value =>
  String(value ?? "—").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));

const phone = value =>
  String(value || "")
    .replace(/\D/g, "")
    .replace(/^0/, "254");

let requests = [];
let cars = [];
let sellRequests = [];
let tradeRequests = [];
let adminEmails = new Set();

let current = null;
let currentSource = null;
let currentSourceImages = [];

let currentAdmin = null;


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


/* =========================================================
   LOAD
   ========================================================= */

async function load() {

  $("loading").style.display = "block";

  grid.innerHTML = "";

  $("empty").style.display = "none";

  $("error").classList.remove("active");

  try {

    await auth();

    const [
      requestsResult,
      carsResult,
      sellResult,
      tradeResult,
      adminsResult
    ] = await Promise.all([

      supabase
        .from("vehicle_enquiries")
        .select("*")
        .order("created_at", { ascending: false }),

      supabase
        .from("cars")
        .select("*"),

      supabase
        .from("sell_car_requests")
        .select("*"),

      supabase
        .from("tradein_requests")
        .select("*"),

      supabase
        .from("admin_users")
        .select("email")

    ]);

    if (requestsResult.error)
      throw requestsResult.error;

    if (carsResult.error)
      throw carsResult.error;

    if (sellResult.error)
      throw sellResult.error;

    if (tradeResult.error)
      throw tradeResult.error;

    if (adminsResult.error)
      throw adminsResult.error;


    requests = requestsResult.data || [];

    cars = carsResult.data || [];

    sellRequests = sellResult.data || [];

    tradeRequests = tradeResult.data || [];


    adminEmails = new Set(
      (adminsResult.data || [])
        .map(x =>
          String(x.email || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );


    stats();

    render();

  } catch (error) {

    console.error(error);

    $("error").textContent =
      error.message || "Unable to load enquiries.";

    $("error").classList.add("active");

  } finally {

    $("loading").style.display = "none";

  }
}


/* =========================================================
   STATS
   ========================================================= */

function stats() {

  $("totalRequests").textContent =
    requests.length;

  $("newRequests").textContent =
    requests.filter(
      x => (x.status || "new") === "new"
    ).length;

  $("contactedRequests").textContent =
    requests.filter(
      x => x.status === "contacted"
    ).length;

  $("completedRequests").textContent =
    requests.filter(
      x => x.status === "completed"
    ).length;

  $("closedRequests").textContent =
    requests.filter(
      x => x.status === "closed"
    ).length;
}


/* =========================================================
   VEHICLE MATCHING
   ========================================================= */

function vehicleName(x) {

  return [
    x.vehicle_make,
    x.vehicle_model,
    x.vehicle_year
  ]
    .filter(Boolean)
    .join(" ")
    .trim() || "Vehicle not specified";
}


function getCatalogueVehicle(enquiry) {

  const carId =
    enquiry.car_id ||
    enquiry.vehicle_id;

  if (carId) {

    const direct = cars.find(
      car => String(car.id) === String(carId)
    );

    if (direct) return direct;
  }


  const stock =
    String(enquiry.stock_number || "")
      .trim()
      .toLowerCase();

  if (stock) {

    const stockMatch = cars.find(
      car =>
        String(car.stock_number || "")
          .trim()
          .toLowerCase() === stock
    );

    if (stockMatch) return stockMatch;
  }


  const makeModel =
    `${enquiry.vehicle_make || ""}
      ${enquiry.vehicle_model || ""}`
      .trim()
      .toLowerCase();

  return cars.find(car => {

    const carName =
      `${car.make || ""}
        ${car.model || ""}`
        .trim()
        .toLowerCase();

    return (
      carName === makeModel &&
      String(car.year || "") ===
        String(enquiry.vehicle_year || "")
    );

  }) || null;
}


/* =========================================================
   SOURCE RESOLVER
   ========================================================= */

function resolveVehicleSource(enquiry) {

  /*
   * 1. Direct source information on enquiry
   */

  const explicitSource =
    String(
      enquiry.source_type ||
      enquiry.vehicle_source ||
      enquiry.source ||
      ""
    )
      .trim()
      .toLowerCase();


  /*
   * 2. Find catalogue vehicle
   */

  const catalogueVehicle =
    getCatalogueVehicle(enquiry);


  /*
   * 3. Sell-In
   */

  if (
    explicitSource === "sell_in" ||
    explicitSource === "sellcar" ||
    explicitSource === "sell_car"
  ) {

    const sourceRequest =
      sellRequests.find(
        item =>
          String(item.id) ===
          String(
            catalogueVehicle?.source_request_id ||
            enquiry.source_request_id ||
            enquiry.sell_request_id
          )
      );

    return buildSellSource(
      sourceRequest,
      catalogueVehicle
    );
  }


  /*
   * 4. Trade-In
   */

  if (
    explicitSource === "trade_in" ||
    explicitSource === "tradein" ||
    explicitSource === "trade-in"
  ) {

    const sourceRequest =
      tradeRequests.find(
        item =>
          String(item.id) ===
          String(
            catalogueVehicle?.source_request_id ||
            enquiry.source_request_id ||
            enquiry.tradein_request_id
          )
      );

    return buildTradeSource(
      sourceRequest,
      catalogueVehicle
    );
  }


  /*
   * 5. If the matched catalogue car itself
   *    contains source metadata.
   */

  if (catalogueVehicle) {

    const sourceType =
      String(
        catalogueVehicle.source_type || ""
      ).toLowerCase();


    if (
      sourceType === "sell_in" ||
      sourceType === "sellcar" ||
      sourceType === "sell_car"
    ) {

      const sourceRequest =
        sellRequests.find(
          item =>
            String(item.id) ===
            String(catalogueVehicle.source_request_id)
        );

      return buildSellSource(
        sourceRequest,
        catalogueVehicle
      );
    }


    if (
      sourceType === "trade_in" ||
      sourceType === "tradein" ||
      sourceType === "trade-in"
    ) {

      const sourceRequest =
        tradeRequests.find(
          item =>
            String(item.id) ===
            String(catalogueVehicle.source_request_id)
        );

      return buildTradeSource(
        sourceRequest,
        catalogueVehicle
      );
    }


    /*
     * Catalogue vehicle with no acquisition
     * source = catalogue/import.
     */

    return buildCatalogueSource(
      catalogueVehicle
    );
  }


  /*
   * 6. Fallback
   */

  return {

    type: "inventory",

    label: "Catalogue",

    icon: "fa-warehouse",

    vehicle: null,

    person: null,

    images: [],

    editable: false

  };
}


/* =========================================================
   SOURCE BUILDERS
   ========================================================= */

function buildSellSource(request, car) {

  return {

    type: "sell",

    label: "Sell-In",

    icon: "fa-car-side",

    vehicle: car || request,

    person: request
      ? {
          name: request.full_name,
          phone: request.phone,
          email: request.email,
          tag: isAgent(request.email)
            ? "AGENT"
            : "CLIENT"
        }
      : null,

    request,

    car,

    images: [],

    editable: !!car

  };
}


function buildTradeSource(request, car) {

  return {

    type: "trade",

    label: "Trade-In",

    icon: "fa-right-left",

    vehicle: car || request,

    person: request
      ? {
          name: request.full_name,
          phone: request.phone,
          email: request.email,
          tag: isAgent(request.email)
            ? "AGENT"
            : "CLIENT"
        }
      : null,

    request,

    car,

    images: [],

    editable: !!car

  };
}


function buildCatalogueSource(car) {

  return {

    type: "inventory",

    label: "Catalogue",

    icon: "fa-warehouse",

    vehicle: car,

    person: car
      ? {
          name:
            car.created_by_name ||
            "Catalogue Vehicle",

          email:
            car.created_by_email || "",

          tag: "INVENTORY"
        }
      : null,

    request: null,

    car,

    images: [],

    editable: !!car

  };
}


function isAgent(email) {

  return adminEmails.has(
    String(email || "")
      .trim()
      .toLowerCase()
  );
}


/* =========================================================
   SOURCE IMAGES
   ========================================================= */

async function loadSourceImages(source) {

  if (!source?.car?.id) {
    return [];
  }

  const { data, error } =
    await supabase
      .from("car_images")
      .select("*")
      .eq("car_id", source.car.id)
      .order("display_order", {
        ascending: true
      });

  if (error) {
    console.error(
      "Unable to load catalogue images:",
      error
    );

    return [];
  }

  const images = data || [];


  /*
   * Include display image if it isn't already
   * present in car_images.
   */

  if (
    source.car.display_image_url &&
    !images.some(
      image =>
        image.image_url ===
        source.car.display_image_url
    )
  ) {

    images.unshift({
      image_url:
        source.car.display_image_url
    });
  }


  return images;
}


/* =========================================================
   FIELD HELPER
   ========================================================= */

function field(label, value) {

  return `
    <div class="detail-field">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `;
}


/* =========================================================
   SOURCE VEHICLE DETAIL
   ========================================================= */

function sourceVehicleDetails(source) {

  const car =
    source?.car ||
    source?.vehicle ||
    {};

  return `

    ${sourceRow(
      "Make",
      car.make ||
      car.vehicle_make
    )}

    ${sourceRow(
      "Model",
      car.model ||
      car.vehicle_model
    )}

    ${sourceRow(
      "Year",
      car.year ||
      car.vehicle_year
    )}

    ${sourceRow(
      "Stock Number",
      car.stock_number
    )}

    ${sourceRow(
      "Registration",
      car.registration_number ||
      car.registration
    )}

    ${sourceRow(
      "Mileage",
      car.mileage != null
        ? `${Number(car.mileage).toLocaleString()} km`
        : "—"
    )}

    ${sourceRow(
      "Body Type",
      car.body_type
    )}

    ${sourceRow(
      "Fuel",
      car.fuel_type
    )}

    ${sourceRow(
      "Transmission",
      car.transmission
    )}

    ${sourceRow(
      "Colour",
      car.exterior_color ||
      car.colour
    )}

    ${sourceRow(
      "Condition",
      car.condition
    )}

    ${sourceRow(
      "Location",
      car.location ||
      car.city
    )}

    ${sourceRow(
      "Price",
      car.price
        ? `KES ${money(car.price)}`
        : "—"
    )}

    ${sourceRow(
      "Status",
      car.status
    )}

  `;
}


function sourceRow(label, value) {

  return `
    <div class="source-detail-row">
      <span>${esc(label)}</span>
      <strong>${esc(value)}</strong>
    </div>
  `;
}


/* =========================================================
   SOURCE PERSON
   ========================================================= */

function sourcePersonHTML(source) {

  if (!source?.person) {

    return `
      <div class="source-person-contact">
        <span>
          <i class="fa-solid fa-circle-info"></i>
          Source contact unavailable
        </span>
      </div>
    `;
  }


  const person = source.person;

  const tagClass =
    person.tag === "AGENT"
      ? "agent"
      : person.tag === "INVENTORY"
        ? "inventory"
        : "client";


  return `

    <div class="source-person-name">

      <strong>
        ${esc(person.name || "Unknown")}
      </strong>

      <span class="person-tag ${tagClass}">
        ${esc(person.tag || "CLIENT")}
      </span>

    </div>

    <div class="source-person-contact">

      ${
        person.phone
          ? `
            <a href="tel:${esc(phone(person.phone))}">
              <i class="fa-solid fa-phone"></i>
              ${esc(person.phone)}
            </a>
          `
          : ""
      }

      ${
        person.email
          ? `
            <a href="mailto:${esc(person.email)}">
              <i class="fa-solid fa-envelope"></i>
              ${esc(person.email)}
            </a>
          `
          : ""
      }

    </div>
  `;
}


/* =========================================================
   SOURCE GALLERY
   ========================================================= */

function renderSourceGallery(images) {

  currentSourceImages = images || [];

  if (!images.length) {

    $("sourceImageGallery").innerHTML = `
      <div class="source-image-placeholder">
        <i class="fa-solid fa-car"></i>
        <span>No vehicle images available</span>
      </div>
    `;

    return;
  }


  const first =
    images[0].image_url;


  $("sourceImageGallery").innerHTML = `

    <img
      id="sourceMainImage"
      class="source-main-image"
      src="${esc(first)}"
      alt="Vehicle"
    >

    ${
      images.length > 1
        ? `
          <div class="source-thumbnails">

            ${images.map((image, index) => `

              <img
                class="source-thumb ${index === 0 ? "active" : ""}"
                src="${esc(image.image_url)}"
                data-index="${index}"
                alt=""
              >

            `).join("")}

          </div>
        `
        : ""
    }
  `;


  document
    .querySelectorAll(".source-thumb")
    .forEach(thumb => {

      thumb.addEventListener(
        "click",
        () => {

          const index =
            Number(thumb.dataset.index);

          const image =
            currentSourceImages[index];

          if (!image) return;

          $("sourceMainImage").src =
            image.image_url;


          document
            .querySelectorAll(".source-thumb")
            .forEach(x =>
              x.classList.remove("active")
            );

          thumb.classList.add("active");

        }
      );

    });
}


/* =========================================================
   SOURCE ACTION
   ========================================================= */

function renderSourceAction(source) {

  if (!source) {

    $("sourceActionCard").innerHTML = "";

    return;
  }


  if (source.car?.id) {

    $("sourceActionCard").innerHTML = `

      <span class="section-kicker">
        VEHICLE RECORD
      </span>

      <h3>
        ${
          source.type === "inventory"
            ? "Catalogue Vehicle"
            : "Inventory Vehicle"
        }
      </h3>

      <p>
        This source vehicle exists as a catalogue
        inventory record.
      </p>

      <button
        class="source-open-button"
        type="button"
        onclick="openSourceVehicle()"
      >
        <i class="fa-solid fa-arrow-up-right-from-square"></i>
        Open Vehicle
      </button>
    `;

    return;
  }


  $("sourceActionCard").innerHTML = `

    <span class="section-kicker">
      VEHICLE SOURCE
    </span>

    <h3>
      ${esc(source.label)}
    </h3>

    <p>
      This enquiry is connected to a
      ${esc(source.label)} source record.
    </p>

  `;
}


/* =========================================================
   RENDER SOURCE
   ========================================================= */

async function renderSource(source) {

  currentSource = source;


  /*
   * Header
   */

  $("sourceTypeBadge").className =
    `source-type-badge ${source.type}`;

  $("sourceTypeBadge").innerHTML = `

    <i class="fa-solid ${source.icon}"></i>

    ${esc(source.label)}

  `;


  /*
   * Vehicle
   */

  const vehicle =
    source.car ||
    source.vehicle ||
    {};


  const name =
    `${vehicle.make || vehicle.vehicle_make || ""}
      ${vehicle.model || vehicle.vehicle_model || ""}`
      .trim() ||
      "Vehicle Source";


  $("sourceVehicleName").textContent =
    name;


  $("sourceVehicleMeta").textContent =
    [
      vehicle.year || vehicle.vehicle_year,
      vehicle.stock_number,
      vehicle.registration_number ||
        vehicle.registration
    ]
      .filter(Boolean)
      .join(" • ") ||
      source.label;


  /*
   * Images
   */

  const images =
    await loadSourceImages(source);

  renderSourceGallery(images);


  /*
   * Details
   */

  $("sourceVehicleDetails").innerHTML =
    sourceVehicleDetails(source);


  /*
   * Person
   */

  $("sourcePerson").innerHTML =
    sourcePersonHTML(source);


  $("sourcePersonTitle").textContent =
    source.type === "sell"
      ? "Seller"
      : source.type === "trade"
        ? "Trade-In Customer"
        : "Catalogue Source";


  /*
   * Action
   */

  renderSourceAction(source);
}


/* =========================================================
   MAIN ENQUIRY
   ========================================================= */

async function openRequest(id) {

  current =
    requests.find(
      item => String(item.id) === String(id)
    );

  if (!current) return;


  $("modalTitle").textContent =
    `${current.full_name || "Customer"} — Enquiry`;


  $("modalSubtitle").textContent =
    `${vehicleName(current)} • ${date(current.created_at)}`;


  /*
   * STATUS
   */

  const status =
    current.status || "new";

  $("modalStatus").value =
    status;

  updateStatusBadge(status);


  /*
   * CUSTOMER
   */

  $("customerDetails").innerHTML = `

    ${field(
      "Full Name",
      current.full_name
    )}

    ${field(
      "Phone",
      current.phone
    )}

    ${field(
      "Email",
      current.email
    )}

    ${field(
      "Location",
      current.location
    )}

  `;


  /*
   * ENQUIRY
   */

  $("enquiryDetails").innerHTML = `

    ${field(
      "Enquiry Type",
      current.enquiry_type ||
      current.type ||
      "Vehicle Enquiry"
    )}

    ${field(
      "Created",
      date(current.created_at)
    )}

    ${field(
      "Updated",
      date(current.updated_at)
    )}

    ${field(
      "Stock Number",
      current.stock_number
    )}

  `;


  /*
   * MESSAGE
   */

  const messageBox =
    $("enquiryMessage");

  const message =
    current.message ||
    current.notes ||
    "";


  if (message.trim()) {

    messageBox.hidden = false;

    messageBox.querySelector("p")
      .textContent = message;

  } else {

    messageBox.hidden = true;

  }


  /*
   * REQUESTED VEHICLE
   */

  renderRequestedVehicle();


  /*
   * CONTACT ACTIONS
   */

  renderContactActions();


  /*
   * META
   */

  $("requestMeta").innerHTML = `

    ${field(
      "Enquiry ID",
      current.id
    )}

    ${field(
      "Created At",
      date(current.created_at)
    )}

    ${field(
      "Status",
      status
    )}

    ${field(
      "Customer Email",
      current.email
    )}

  `;


  /*
   * SOURCE
   */

  const source =
    resolveVehicleSource(current);

  await renderSource(source);


  /*
   * OPEN
   */

  $("requestModal").classList.add("show");

  $("requestModal")
    .setAttribute("aria-hidden", "false");

  document.body.classList.add("locked");
}


/* =========================================================
   REQUESTED VEHICLE
   ========================================================= */

function renderRequestedVehicle() {

  const make =
    current.vehicle_make ||
    "Vehicle";

  const model =
    current.vehicle_model ||
    "Not specified";

  $("requestedVehicle").innerHTML = `

    <div class="requested-vehicle-title">

      <i class="fa-solid fa-car"></i>

      <div>

        <h4>
          ${esc(make)} ${esc(model)}
        </h4>

        <p>
          Customer's requested vehicle
        </p>

      </div>

    </div>


    <div class="requested-vehicle-meta">

      <div>
        <span>Year</span>
        <strong>
          ${esc(current.vehicle_year)}
        </strong>
      </div>

      <div>
        <span>Stock</span>
        <strong>
          ${esc(current.stock_number)}
        </strong>
      </div>

      <div>
        <span>Make</span>
        <strong>
          ${esc(current.vehicle_make)}
        </strong>
      </div>

      <div>
        <span>Model</span>
        <strong>
          ${esc(current.vehicle_model)}
        </strong>
      </div>

    </div>
  `;
}


/* =========================================================
   CONTACT ACTIONS
   ========================================================= */

function renderContactActions() {

  const customerPhone =
    phone(current.phone);

  const customerEmail =
    current.email || "";


  $("contactActions").innerHTML = `

    ${
      customerPhone
        ? `
          <a
            class="contact-action-large"
            href="tel:+${esc(customerPhone)}"
          >
            <i class="fa-solid fa-phone"></i>
            Call Customer
          </a>
        `
        : ""
    }


    ${
      customerPhone
        ? `
          <a
            class="contact-action-large whatsapp"
            target="_blank"
            rel="noopener"
            href="https://wa.me/${esc(customerPhone)}"
          >
            <i class="fa-brands fa-whatsapp"></i>
            WhatsApp
          </a>
        `
        : ""
    }


    ${
      customerEmail
        ? `
          <a
            class="contact-action-large"
            href="mailto:${esc(customerEmail)}"
          >
            <i class="fa-solid fa-envelope"></i>
            Email Customer
          </a>
        `
        : ""
    }

  `;
}


/* =========================================================
   STATUS BADGE
   ========================================================= */

function updateStatusBadge(status) {

  const badge =
    $("detailStatusBadge");

  badge.className =
    `large-status ${status}`;

  badge.textContent =
    status.toUpperCase();
}


/* =========================================================
   SAVE STATUS
   ========================================================= */

async function saveStatus() {

  if (!current) return;

  const status =
    $("modalStatus").value;


  const { error } =
    await supabase
      .from("vehicle_enquiries")
      .update({
        status,
        updated_at:
          new Date().toISOString()
      })
      .eq("id", current.id);


  if (error) {

    alert(error.message);

    return;
  }


  current.status =
    status;


  const index =
    requests.findIndex(
      x => x.id === current.id
    );

  if (index !== -1) {

    requests[index] = {
      ...requests[index],
      status
    };

  }


  updateStatusBadge(status);

  stats();

  render();

}


/* =========================================================
   DELETE
   ========================================================= */

async function deleteRequest() {

  if (!current) return;


  if (
    !confirm(
      `Delete enquiry from ${
        current.full_name ||
        "this customer"
      }?`
    )
  ) return;


  const { error } =
    await supabase
      .from("vehicle_enquiries")
      .delete()
      .eq("id", current.id);


  if (error) {

    alert(error.message);

    return;
  }


  closeRequest();

  load();
}


/* =========================================================
   OPEN SOURCE VEHICLE
   ========================================================= */

window.openSourceVehicle = () => {

  if (!currentSource?.car?.id) {
    return;
  }

  location.href =
    `edit.html?id=${encodeURIComponent(
      currentSource.car.id
    )}`;
};


/* =========================================================
   CLOSE
   ========================================================= */

function closeRequest() {

  $("requestModal")
    .classList.remove("show");

  $("requestModal")
    .setAttribute("aria-hidden", "true");

  document.body.classList.remove("locked");

  current = null;

  currentSource = null;

  currentSourceImages = [];
}


/* =========================================================
   EVENTS
   ========================================================= */

grid.addEventListener(
  "click",
  event => {

    const card =
      event.target.closest(".request-card");

    if (!card) return;

    const id =
      card.dataset.id;

    if (id) {
      openRequest(id);
    }

  }
);


$("modalStatus").onchange =
  event =>
    updateStatusBadge(
      event.target.value
    );


$("saveStatus").onclick =
  saveStatus;


$("deleteRequest").onclick =
  deleteRequest;


$("closeRequest").onclick =
  closeRequest;


$("closeRequestBg").onclick =
  closeRequest;


document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape" &&
      current
    ) {
      closeRequest();
    }

  }
);


/* SEARCH */

$("searchInput").oninput =
  render;


/* STATUS FILTER */

$("statusFilter").onchange =
  render;


/* SORT */

$("sortFilter").onchange =
  render;


/* REFRESH */

$("refreshBtn").onclick =
  load;


/* MENU */

$("menu").onclick = () => {

  $("sidebar")
    .classList.add("open");

  $("overlay")
    .classList.add("show");

};


$("closeMenu").onclick =
$("overlay").onclick = () => {

  $("sidebar")
    .classList.remove("open");

  $("overlay")
    .classList.remove("show");

};


/* LOGOUT */

$("logoutBtn").onclick =
  async () => {

    await supabase.auth.signOut();

    location.replace("auth.html");

  };


/* LOADER */

window.addEventListener(
  "load",
  () => {

    setTimeout(
      () =>
        $("loader")
          ?.classList.add("hide"),
      450
    );

  }
);


/* =========================================================
   EXISTING CARD RENDER
   Keep your existing card rendering.
   Just make sure each card has:
   
   <article class="request-card" data-id="...">
   
   ========================================================= */

function render() {

  const q =
    $("searchInput")
      .value
      .toLowerCase()
      .trim();

  const statusFilter =
    $("statusFilter").value;

  const sort =
    $("sortFilter").value;


  let list =
    requests.filter(request => {

      const source =
        `${request.full_name || ""}
         ${request.phone || ""}
         ${request.email || ""}
         ${request.stock_number || ""}
         ${vehicleName(request)}`
          .toLowerCase();


      const status =
        request.status || "new";


      return (
        source.includes(q) &&
        (
          statusFilter === "all" ||
          status === statusFilter
        )
      );

    });


  list.sort(
    (a, b) =>
      sort === "oldest"
        ? new Date(a.created_at) -
          new Date(b.created_at)
        : new Date(b.created_at) -
          new Date(a.created_at)
  );


  if (!list.length) {

    $("empty").style.display =
      "block";

    grid.innerHTML = "";

    return;
  }


  $("empty").style.display =
    "none";


  /*
   * YOUR EXISTING CARD DESIGN
   *
   * The only important addition is data-id.
   */

  grid.innerHTML =
    list.map(request => {

      const status =
        request.status || "new";


      return `

        <article
          class="request-card"
          data-id="${esc(request.id)}"
        >

          <div class="request-top">

            <small>
              ${esc(
                date(request.created_at)
              )}
            </small>

            <span
              class="request-status ${esc(status)}"
            >
              ${esc(status)}
            </span>

          </div>


          <h3>
            ${esc(
              request.full_name ||
              "Customer"
            )}
          </h3>


          <p>
            <i class="fa-solid fa-phone"></i>
            ${esc(request.phone)}
          </p>


          <p>
            <i class="fa-solid fa-envelope"></i>
            ${esc(request.email)}
          </p>


          <div class="request-meta">

            <div>
              <span>Vehicle</span>

              <strong>
                ${esc(
                  vehicleName(request)
                )}
              </strong>
            </div>

          </div>


          <div class="request-bottom">

            <span>
              ${esc(
                request.stock_number ||
                "Vehicle enquiry"
              )}
            </span>

            <button
              type="button"
              tabindex="-1"
            >
              Open
              <i class="fa-solid fa-arrow-right"></i>
            </button>

          </div>

        </article>

      `;

    }).join("");
}


/* =========================================================
   START
   ========================================================= */

requireAdmin("enquiries")
  .then(allowed => {

    if (!allowed) return;

    load();

  });