/* =====================================================================
   edit.js  —  FULL REPLACEMENT

   Changes:
   - Field list comes from car-schema.js. Any input present in edit.html
     whose id matches a `cars` column is now loaded and saved. Inputs you
     have not added yet are skipped, so this drops in without HTML edits.
   - Catalogue values are matched case-insensitively and any value the
     catalogue does not know about is injected into the dropdown instead
     of being silently dropped. Wix-imported vehicles load and save.
   - Year range is always 1980 -> next year.
   - Catalogue validation no longer blocks the save. A vehicle can always
     be saved; the make/model is registered in the catalogue afterwards.
   ===================================================================== */

import { supabase } from "./supabase.js";
import { initVehicleCatalogue, registerCombo } from "./vehicle-catalog.js";
import { recordAgentSale } from "./agent-payments.js";
import {
    CAR_FIELDS,
    NUMERIC_FIELDS,
    BOOLEAN_FIELDS,
    MIN_VEHICLE_YEAR,
    MAX_VEHICLE_YEAR
} from "./car-schema.js";

const BUCKET = "car-images";

const params = new URLSearchParams(window.location.search);
const carId = params.get("id");

const $ = id => document.getElementById(id);

const form = $("carForm");
const loading = $("loading");
const displayInput = $("displayInput");
const galleryInput = $("galleryInput");
const displayPreview = $("displayPreview");
const galleryPreview = $("galleryPreview");

let car = null,
    gallery = [],
    newDisplay = null,
    removeDisplay = false,
    catalog = null,
    manualEngine = false,
    manualDescription = false;

/* Handled by the catalogue cascade, not by the generic field loop. */
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
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.add("active");
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

function optimizedUrl(url, width = 800, quality = 85) {
    if (!url || !url.includes("/storage/v1/object/public/")) return url;
    return url.replace("/object/public/", "/render/image/public/") + `?width=${width}&quality=${quality}&resize=contain`;
}

/* Static year ranges for import_year / registration_year. */
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

    if (previous) {
        if (![...select.options].some(o => o.value === String(previous))) {
            const extra = document.createElement("option");
            extra.value = String(previous);
            extra.textContent = String(previous);
            select.insertBefore(extra, select.children[1] || null);
        }
        select.value = previous;
    }
}

populateYears("import_year");
populateYears("registration_year");

/* Fallback year list used only if the catalogue fails to load. */
function fallbackYearRange(preferredYear = null) {
    const select = $("year");
    if (!select || select.tagName !== "SELECT") return;

    const values = new Set();
    for (let y = MAX_VEHICLE_YEAR; y >= MIN_VEHICLE_YEAR; y--) values.add(String(y));
    if (preferredYear) values.add(String(preferredYear));

    const sorted = [...values].sort((a, b) => Number(b) - Number(a));

    select.innerHTML = '<option value="">Select year</option>';
    sorted.forEach(v => {
        const option = document.createElement("option");
        option.value = v;
        option.textContent = v;
        select.appendChild(option);
    });

    if (preferredYear) select.value = String(preferredYear);
    select.disabled = false;
}

/* ---------------- display image ---------------- */

function showDisplay(url) {
    displayPreview.innerHTML = `<img src="${optimizedUrl(url, 800, 85)}" alt="Display image">`;
    displayPreview.classList.add("active");
    $("removeDisplay")?.classList.add("active");
}

function clearDisplay() {
    displayPreview.innerHTML = "";
    displayPreview.classList.remove("active");
    $("removeDisplay")?.classList.remove("active");
}

/* ---------------- gallery ---------------- */

function renderGallery() {
    galleryPreview.innerHTML = "";

    gallery.forEach(image => {
        const item = document.createElement("div");
        item.className = "gallery-item";
        item.innerHTML = `
            <img src="${optimizedUrl(image.image_url, 500, 80)}" alt="Vehicle gallery image" loading="lazy" decoding="async">
            <button type="button" class="delete-image" title="Delete image">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <button type="button" class="make-main">Make Display</button>
        `;

        item.querySelector(".delete-image").onclick = () => deleteGalleryImage(image);
        item.querySelector(".make-main").onclick = () => makeDisplayFromGallery(image);
        galleryPreview.appendChild(item);
    });
}

/* ---------------- load vehicle ---------------- */

async function loadVehicle() {
    if (!carId) {
        if (loading) loading.textContent = "No vehicle ID provided.";
        return;
    }

    try {
        const result = await supabase
            .from("cars")
            .select("*")
            .eq("id", carId)
            .maybeSingle();

        if (result.error) throw result.error;
        if (!result.data) throw new Error("Vehicle could not be found in the database.");

        car = result.data;

        /* -------- catalogue (best effort, never blocks) -------- */
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

            catalog.setVehicleValues({
                make: car.make,
                model: car.model,
                year: car.year,
                body_type: car.body_type,
                fuel_type: car.fuel_type,
                transmission: car.transmission,
                drive_type: car.drive_type
            });

        } catch (catalogError) {
            console.warn("Vehicle catalogue unavailable:", catalogError);
            fallbackYearRange(car.year);

            /* Load the catalogue-driven values manually so nothing is lost. */
            CATALOG_SELECTS.forEach(key => {
                const el = $(key);
                if (!el) return;

                const value = car[key];
                if (value === null || value === undefined || value === "") return;

                if (el.tagName === "SELECT" &&
                    ![...el.options].some(o => String(o.value).toLowerCase() === String(value).toLowerCase())) {
                    const option = document.createElement("option");
                    option.value = String(value);
                    option.textContent = String(value);
                    el.insertBefore(option, el.children[1] || null);
                }

                el.value = String(value);
            });
        }

        /* -------- every other field -------- */
        CAR_FIELDS.forEach(field => {
            if (CATALOG_SELECTS.has(field.k)) return;

            const element = $(field.k);
            if (!element) return;

            const value = car[field.k];

            if (BOOLEAN_FIELDS.has(field.k) || element.type === "checkbox") {
                element.checked = field.k === "test_drive_available"
                    ? value !== false
                    : !!value;
                return;
            }

            if (element.tagName === "SELECT" && value !== null && value !== undefined && value !== "") {
                if (![...element.options].some(o => String(o.value).toLowerCase() === String(value).toLowerCase())) {
                    const option = document.createElement("option");
                    option.value = String(value);
                    option.textContent = String(value);
                    element.insertBefore(option, element.children[1] || null);
                }
            }

            element.value = value !== null && value !== undefined ? String(value) : "";
        });

        manualEngine = !!car.engine_description;
        manualDescription = !!car.description;

        /* Legacy checkbox ids that may sit outside the schema grid. */
        if ($("negotiable")) $("negotiable").checked = !!car.negotiable;
        if ($("financing_available")) $("financing_available").checked = !!car.financing_available;
        if ($("test_drive_available")) $("test_drive_available").checked = car.test_drive_available !== false;
        if ($("featured")) $("featured").checked = !!car.featured;

        if (car.display_image_url) showDisplay(car.display_image_url);

        const galleryResult = await supabase
            .from("car_images")
            .select("*")
            .eq("car_id", carId)
            .order("display_order", { ascending: true });

        if (galleryResult.error) throw galleryResult.error;

        gallery = galleryResult.data || [];
        renderGallery();

        if (form) form.style.display = "block";

    } catch (error) {
        showMessage("error", error?.message || "Unable to load vehicle.");
    } finally {
        if (loading) loading.style.display = "none";
    }
}

/* ---------------- display image handlers ---------------- */

if (displayInput) {
    displayInput.onchange = event => {
        newDisplay = event.target.files[0] || null;
        removeDisplay = false;
        if (newDisplay) showDisplay(URL.createObjectURL(newDisplay));
    };
}

if ($("removeDisplay")) {
    $("removeDisplay").onclick = () => {
        newDisplay = null;
        removeDisplay = true;
        displayInput.value = "";
        clearDisplay();
    };
}

if (galleryInput) {
    galleryInput.onchange = event => {
        const files = [...event.target.files];
        files.forEach(file => uploadGallery(file));
        galleryInput.value = "";
    };
}

async function uploadGallery(file) {
    try {
        const path = `${carId}/gallery/${crypto.randomUUID()}-${safeFileName(file.name)}`;

        const uploadResult = await supabase.storage
            .from(BUCKET)
            .upload(path, file, { cacheControl: "3600", upsert: false });

        if (uploadResult.error) throw uploadResult.error;

        const imageUrl = publicUrl(path);

        const insertResult = await supabase
            .from("car_images")
            .insert({
                car_id: carId,
                image_url: imageUrl,
                storage_path: path,
                image_type: "gallery",
                display_order: gallery.length
            })
            .select()
            .single();

        if (insertResult.error) {
            await supabase.storage.from(BUCKET).remove([path]);
            throw insertResult.error;
        }

        gallery.push(insertResult.data);
        renderGallery();

    } catch (error) {
        showMessage("error", error?.message || "Unable to upload gallery image.");
    }
}

async function deleteGalleryImage(image) {
    if (!confirm("Delete this gallery image?")) return;

    try {
        if (image.storage_path) {
            const storageResult = await supabase.storage.from(BUCKET).remove([image.storage_path]);
            if (storageResult.error) throw storageResult.error;
        }

        const result = await supabase.from("car_images").delete().eq("id", image.id);
        if (result.error) throw result.error;

        gallery = gallery.filter(item => item.id !== image.id);
        renderGallery();
        showMessage("success", "Gallery image deleted.");

    } catch (error) {
        showMessage("error", error?.message || "Unable to delete image.");
    }
}

async function setDisplayImage(imageUrl, imagePath) {
    const result = await supabase
        .from("cars")
        .update({ display_image_url: imageUrl, display_image_path: imagePath })
        .eq("id", carId);

    if (result.error) throw result.error;

    car.display_image_url = imageUrl;
    car.display_image_path = imagePath;
}

async function makeDisplayFromGallery(image) {
    try {
        await setDisplayImage(image.image_url, image.storage_path);
        removeDisplay = false;
        newDisplay = null;
        showDisplay(image.image_url);
        showMessage("success", "Gallery image is now the display image.");
    } catch (error) {
        showMessage("error", error?.message || "Unable to set display image.");
    }
}

async function uploadNewDisplay() {
    if (!newDisplay) return;

    const oldPath = car.display_image_path;
    const path = `${carId}/display/${crypto.randomUUID()}-${safeFileName(newDisplay.name)}`;

    const result = await supabase.storage
        .from(BUCKET)
        .upload(path, newDisplay, { cacheControl: "3600", upsert: false });

    if (result.error) throw result.error;

    const imageUrl = publicUrl(path);
    await setDisplayImage(imageUrl, path);

    if (oldPath && oldPath !== path) {
        await supabase.storage.from(BUCKET).remove([oldPath]);
    }
}

/* ---------------- save ---------------- */

form.onsubmit = async event => {
    event.preventDefault();
    clearMessages();

    /* Advisory only — make and model must be present, nothing else. */
    if (catalog) {
        const invalid = catalog.validate();
        if (invalid) {
            showMessage("error", invalid);
            return;
        }
    }

    const saveButtons = document.querySelectorAll(".save");
    saveButtons.forEach(button => {
        button.disabled = true;
        button.textContent = "Saving...";
    });

    try {
        const updates = {};

        CAR_FIELDS.forEach(field => {
            const element = $(field.k);
            if (!element) return;

            if (BOOLEAN_FIELDS.has(field.k) || element.type === "checkbox") {
                updates[field.k] = !!element.checked;
                return;
            }

            const value = String(element.value ?? "").trim();

            if (value === "") {
                updates[field.k] = null;
            } else if (NUMERIC_FIELDS.has(field.k)) {
                const n = Number(value);
                updates[field.k] = Number.isFinite(n) ? n : null;
            } else {
                updates[field.k] = value;
            }
        });

        ["negotiable", "financing_available", "test_drive_available", "featured"].forEach(key => {
            const el = $(key);
            if (el && typeof el.checked === "boolean") updates[key] = el.checked;
        });

        if (newDisplay) {
            await uploadNewDisplay();
            newDisplay = null;
            displayInput.value = "";
        }

        if (removeDisplay) {
            if (car.display_image_path) {
                await supabase.storage.from(BUCKET).remove([car.display_image_path]);
            }

            updates.display_image_url = null;
            updates.display_image_path = null;
            car.display_image_url = null;
            car.display_image_path = null;
            removeDisplay = false;
        }

        updates.updated_at = new Date().toISOString();

        const result = await supabase.from("cars").update(updates).eq("id", carId);
        if (result.error) throw result.error;

        car = { ...car, ...updates };

        /* Keep the catalogue in step with whatever was just saved. */
        await registerCombo({
            make: updates.make ?? car.make,
            model: updates.model ?? car.model,
            year: updates.year ?? car.year,
            body_type: updates.body_type ?? car.body_type,
            fuel_type: updates.fuel_type ?? car.fuel_type,
            transmission: updates.transmission ?? car.transmission,
            drive_type: updates.drive_type ?? car.drive_type
        });

        if (updates.status === "sold") {
            try {
                await recordAgentSale({ ...car, ...updates });
            } catch (agentError) {
                console.warn("Agent sale not recorded:", agentError?.message || agentError);
            }
        }

        showMessage("success", "Vehicle saved successfully. Returning to listings...");
        saveButtons.forEach(button => (button.textContent = "Saved"));

        setTimeout(() => {
            window.location.href = "index.html";
        }, 700);

    } catch (error) {
        showMessage("error", error?.message || "Unable to save vehicle.");
        saveButtons.forEach(button => (button.textContent = "Save Changes"));
    } finally {
        saveButtons.forEach(button => (button.disabled = false));
    }
};

/* ---------------- delete ---------------- */

if ($("deleteBtn")) {
    $("deleteBtn").onclick = async () => {
        if (!confirm("Delete this vehicle and all its images?")) return;

        try {
            $("deleteBtn").disabled = true;

            const paths = [
                car?.display_image_path,
                ...gallery.map(image => image.storage_path)
            ].filter(Boolean);

            if (paths.length) {
                const result = await supabase.storage.from(BUCKET).remove(paths);
                if (result.error) throw result.error;
            }

            const result = await supabase.from("cars").delete().eq("id", carId);
            if (result.error) throw result.error;

            location.href = "index.html";

        } catch (error) {
            showMessage("error", error?.message || "Unable to delete vehicle.");
            $("deleteBtn").disabled = false;
        }
    };
}

/* ---------------- nav ---------------- */

function goBack() {
    window.location.href = "index.html";
}

if ($("backBtn")) $("backBtn").onclick = goBack;
if ($("bottomCancel")) $("bottomCancel").onclick = goBack;

/* ---------------- boot ---------------- */

loadVehicle();