/* =====================================================================
   add.js  —  FULL REPLACEMENT

   Changes:
   - Field list now comes from car-schema.js, so every editable column on
     `cars` is picked up automatically if the input exists in add.html.
     Missing inputs are skipped silently, so this file is safe to drop in
     without touching your HTML.
   - The year dropdown is owned by the vehicle catalogue and always runs
     from 1980 to next year. The old hard-coded 1990 floor is gone.
   - An empty or unmatched catalogue no longer blocks saving. Only a
     missing make or model stops the form.
   - After a successful save the make/model combination is registered in
     the catalogue so it appears on every page from then on.
   - NEW: a completion pill in the navbar, opposite "Back to Listings",
     tracks how much of the form has been filled in. The counting logic
     lives in form-progress.js so add.js and edit.js can't drift apart
     on it — this file just tells it when to recompute.
   ===================================================================== */

import { supabase } from "./supabase.js";
import { initVehicleCatalogue, registerCombo } from "./vehicle-catalog.js";
import { initFormProgress } from "./form-progress.js";
import {
    CAR_FIELDS,
    NUMERIC_FIELDS,
    BOOLEAN_FIELDS,
    MIN_VEHICLE_YEAR,
    MAX_VEHICLE_YEAR
} from "./car-schema.js";

const BUCKET = "car-images";

const $ = id => document.getElementById(id);

const form = $("carForm");
const displayInput = $("displayInput");
const galleryInput = $("galleryInput");
const displayPreview = $("displayPreview");
const galleryPreview = $("galleryPreview");

/* Recomputes the navbar completion pill. Safe to call as often as you
   like — it just re-reads the DOM each time. */
const updateFormProgress = initFormProgress(form);

let newDisplay = null,
    gallery = [],
    catalog = null,
    manualEngine = false,
    manualDescription = false;

/* Fields the catalogue cascade owns — never year-populated here. */
const CATALOG_SELECTS = new Set(["make", "model", "year", "body_type", "fuel_type", "transmission", "drive_type"]);

/* ---------------- auto description ---------------- */

function generateVehicleText() {
    const v = id => $(id)?.value?.trim() || "";

    const make = v("make"), model = v("model"), trim = v("trim"), year = v("year"),
          body = v("body_type"), size = v("engine_size"), hp = v("horsepower"),
          fuel = v("fuel_type"), trans = v("transmission"), drive = v("drive_type"),
          mileage = v("mileage"), condition = v("condition"),
          ext = v("exterior_color"), int = v("interior_color"),
          seats = v("seats"), doors = v("doors"), origin = v("country_of_origin"),
          reg = v("registration_year"), service = v("service_history"),
          accident = v("accident_history");

    const engine = [size ? `${size}L` : "", hp ? `${hp} hp` : "", fuel, trans, drive]
        .filter(Boolean).join(" \u2022 ");

    const name = [year, make, model, trim].filter(Boolean).join(" ");

    if (!manualEngine && $("engine_description")) {
        $("engine_description").value = engine;
    }

    if (!manualDescription && $("description")) {
        $("description").value = (
            `${name || "This vehicle"}${body ? ` is a ${body.toLowerCase()}` : ""}` +
            `${engine ? `, powered by ${engine}` : ""}. ` +
            `${mileage ? `It has covered ${Number(mileage).toLocaleString("en-KE")} km. ` : ""}` +
            `${condition ? `The vehicle is in ${condition.toLowerCase()} condition. ` : ""}` +
            `${ext ? `The exterior is finished in ${ext}. ` : ""}` +
            `${int ? `The interior is ${int}. ` : ""}` +
            `${seats ? `It has ${seats} seats${doors ? ` and ${doors} doors` : ""}. ` : ""}` +
            `${origin ? `Country of origin: ${origin}. ` : ""}` +
            `${reg ? `Registered in ${reg}. ` : ""}` +
            `${service ? `Service history: ${service}. ` : ""}` +
            `${accident ? `Accident history: ${accident}. ` : ""}`
        ).trim();
    }
}

$("engine_description")?.addEventListener("input", () => (manualEngine = true));
$("description")?.addEventListener("input", () => (manualDescription = true));

[
    "make", "model", "trim", "year", "body_type", "engine_size", "horsepower",
    "fuel_type", "transmission", "drive_type", "mileage", "condition",
    "exterior_color", "interior_color", "seats", "doors", "country_of_origin",
    "registration_year", "service_history", "accident_history"
].forEach(id =>
    $(id)?.addEventListener("change", () => {
        manualEngine = false;
        manualDescription = false;
        generateVehicleText();
    })
);

/* ---------------- messages ---------------- */

function showMessage(id, text) {
    const element = $(id);
    if (!element) return;
    element.textContent = text;
    element.classList.add("active");
}

function clearMessages() {
    $("error")?.classList.remove("active");
    $("success")?.classList.remove("active");
}

/* ---------------- utils ---------------- */

function publicUrl(path) {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function safeFileName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

/* Static year ranges for the non-catalogue year fields. 1980 floor. */
function populateYears(id) {
    const select = $(id);
    if (!select || select.tagName !== "SELECT") return;

    const previous = select.value;
    select.innerHTML = '<option value="">Select</option>';

    for (let year = MAX_VEHICLE_YEAR; year >= MIN_VEHICLE_YEAR; year--) {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        select.appendChild(option);
    }

    if (previous) select.value = previous;
}

populateYears("import_year");
populateYears("registration_year");

/* ---------------- display image ---------------- */

function showDisplayPreview(url) {
    displayPreview.innerHTML = `<img src="${url}" alt="Display image">`;
    displayPreview.classList.add("active");
    $("removeDisplay")?.classList.add("active");
    updateFormProgress();
}

if (displayInput) {
    displayInput.onchange = event => {
        newDisplay = event.target.files[0] || null;
        if (newDisplay) showDisplayPreview(URL.createObjectURL(newDisplay));
    };
}

if ($("removeDisplay")) {
    $("removeDisplay").onclick = () => {
        newDisplay = null;
        displayInput.value = "";
        displayPreview.innerHTML = "";
        displayPreview.classList.remove("active");
        $("removeDisplay").classList.remove("active");
        updateFormProgress();
    };
}

/* ---------------- gallery ---------------- */

if (galleryInput) {
    galleryInput.onchange = event => {
        const files = [...event.target.files];

        files.forEach(file => {
            const url = URL.createObjectURL(file);

            const item = document.createElement("div");
            item.className = "gallery-item";
            item.innerHTML = `
                <img src="${url}" alt="Gallery image">
                <button type="button" class="delete-image">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;

            item.querySelector(".delete-image").onclick = () => {
                URL.revokeObjectURL(url);
                item.remove();
                gallery = gallery.filter(existingFile => existingFile !== file);
            };

            galleryPreview.appendChild(item);
            gallery.push(file);
        });

        galleryInput.value = "";
    };
}

async function uploadImage(path, file) {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });

    if (error) throw error;

    return publicUrl(path);
}

/* ---------------- save ---------------- */

form.onsubmit = async event => {
    event.preventDefault();
    clearMessages();

    /* Catalogue validation is advisory: only make and model are required. */
    if (catalog) {
        const invalid = catalog.validate();
        if (invalid) {
            showMessage("error", invalid);
            return;
        }
    } else {
        if (!$("make")?.value || !$("model")?.value) {
            showMessage("error", "Make and model are required.");
            return;
        }
    }

    const price = Number($("price")?.value);
    if (!Number.isFinite(price) || price <= 0) {
        showMessage("error", "Enter a valid selling price.");
        return;
    }

    const saveButtons = document.querySelectorAll(".save");
    saveButtons.forEach(button => {
        button.disabled = true;
        button.textContent = "Saving...";
    });

    const id = crypto.randomUUID();
    const uploadedPaths = [];

    try {
        const data = { id };

        CAR_FIELDS.forEach(field => {
            const element = $(field.k);
            if (!element) return;

            if (BOOLEAN_FIELDS.has(field.k)) {
                data[field.k] = !!element.checked;
                return;
            }

            const value = String(element.value ?? "").trim();

            if (value === "") {
                data[field.k] = null;
            } else if (NUMERIC_FIELDS.has(field.k)) {
                const n = Number(value);
                data[field.k] = Number.isFinite(n) ? n : null;
            } else {
                data[field.k] = value;
            }
        });

        /* Checkboxes that may live outside the schema grid. */
        ["negotiable", "financing_available", "test_drive_available", "featured"].forEach(key => {
            const el = $(key);
            if (el && typeof el.checked === "boolean") data[key] = el.checked;
        });

        data.created_at = new Date().toISOString();
        data.updated_at = data.created_at;

        let result = await supabase.from("cars").insert(data);
        if (result.error) throw result.error;

        if (newDisplay) {
            const path = `${id}/display/${crypto.randomUUID()}-${safeFileName(newDisplay.name)}`;
            const imageUrl = await uploadImage(path, newDisplay);
            uploadedPaths.push(path);

            result = await supabase
                .from("cars")
                .update({ display_image_url: imageUrl, display_image_path: path })
                .eq("id", id);

            if (result.error) throw result.error;
        }

        for (let index = 0; index < gallery.length; index++) {
            const file = gallery[index];
            const path = `${id}/gallery/${crypto.randomUUID()}-${safeFileName(file.name)}`;
            const imageUrl = await uploadImage(path, file);
            uploadedPaths.push(path);

            result = await supabase.from("car_images").insert({
                car_id: id,
                image_url: imageUrl,
                storage_path: path,
                image_type: "gallery",
                display_order: index
            });

            if (result.error) throw result.error;

            if (!newDisplay && index === 0) {
                await supabase
                    .from("cars")
                    .update({ display_image_url: imageUrl, display_image_path: path })
                    .eq("id", id);
            }
        }

        /* Register the combination so it is selectable everywhere. */
        await registerCombo({
            make: data.make,
            model: data.model,
            year: data.year,
            body_type: data.body_type,
            fuel_type: data.fuel_type,
            transmission: data.transmission,
            drive_type: data.drive_type
        });

        showMessage("success", "Vehicle added successfully.");
        saveButtons.forEach(button => (button.textContent = "Added"));

        setTimeout(() => {
            location.href = `edit.html?id=${encodeURIComponent(id)}`;
        }, 900);

    } catch (error) {
        if (uploadedPaths.length) {
            await supabase.storage.from(BUCKET).remove(uploadedPaths);
        }

        await supabase.from("cars").delete().eq("id", id);

        showMessage("error", error?.message || "Unable to save vehicle.");

        saveButtons.forEach(button => {
            button.disabled = false;
            button.textContent = "Add Vehicle";
        });
    }
};

/* ---------------- boot ---------------- */

async function initialise() {
    try {
        catalog = await initVehicleCatalogue({
            makeId: "make",
            modelId: "model",
            yearId: "year",
            bodyId: "body_type",
            fuelId: "fuel_type",
            transId: "transmission",
            driveId: "drive_type"
        });

        generateVehicleText();
        updateFormProgress();

    } catch (error) {
        /* A catalogue failure must never stop a vehicle being added. */
        console.warn("Vehicle catalogue unavailable:", error);
        populateYears("year");
        updateFormProgress();
        showMessage(
            "error",
            "Vehicle catalogue is unavailable. You can still add the vehicle by typing the details manually."
        );
    }
}

initialise();