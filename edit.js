import { supabase } from "./supabase.js";
import { initVehicleCatalogue } from "./vehicle-catalog.js";
import { recordAgentSale } from "./agent-payments.js";

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

const fields = [
    "make","model","trim","year","price","condition","body_type","status",
    "engine_size","engine_description","horsepower","mileage","fuel_type",
    "transmission","drive_type","exterior_color","interior_color","seats",
    "doors","vin","chassis_number","registration_number","stock_number",
    "country_of_origin","import_year","registration_year","auction_grade",
    "previous_owners","accident_history","service_history","number_of_keys",
    "inspection_status","inspection_notes","location","city","county","description"
];

const numericFields = new Set([
    "year","price","engine_size","horsepower","mileage","seats","doors",
    "import_year","registration_year"
]);

/* ---------------- AUTO DESCRIPTION ---------------- */

function generateVehicleText() {
    const v = id => $(id)?.value?.trim() || "";
    const make = v("make"), model = v("model"), trim = v("trim"), year = v("year"),
          body = v("body_type"), size = v("engine_size"), hp = v("horsepower"),
          fuel = v("fuel_type"), trans = v("transmission"), drive = v("drive_type"),
          mileage = v("mileage"), condition = v("condition"),
          ext = v("exterior_color"), int = v("interior_color"),
          seats = v("seats"), doors = v("doors"), origin = v("country_of_origin"),
          reg = v("registration_year"), service = v("service_history"),
          accident = v("accident_history"),
          engine = [size ? `${size}L` : "", hp ? `${hp} hp` : "", fuel, trans, drive]
                     .filter(Boolean).join(" • "),
          name = [year, make, model, trim].filter(Boolean).join(" ");

    if (!manualEngine && $("engine_description")) $("engine_description").value = engine;

    if (!manualDescription && $("description")) {
        $("description").value =
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
            `${accident ? `Accident history: ${accident}. ` : ""}`.trim();
    }
}

$("engine_description")?.addEventListener("input", () => (manualEngine = true));
$("description")?.addEventListener("input", () => (manualDescription = true));

[
    "make","model","trim","year","body_type","engine_size","horsepower","fuel_type",
    "transmission","drive_type","mileage","condition","exterior_color",
    "interior_color","seats","doors","country_of_origin","registration_year",
    "service_history","accident_history"
].forEach(id =>
    $(id)?.addEventListener("change", () => {
        manualEngine = false;
        manualDescription = false;
        generateVehicleText();
    })
);

/* ---------------- MESSAGES ---------------- */

function showMessage(id, text) {
    const el = $(id);
    el.textContent = text;
    el.classList.add("active");
}

function clearMessages() {
    $("error").classList.remove("active");
    $("success").classList.remove("active");
}

/* ---------------- UTIL ---------------- */

function publicUrl(path) {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function safeFileName(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

function optimizedUrl(url, width = 800, quality = 85) {
    if (!url || !url.includes("/storage/v1/object/public/")) return url;
    return url.replace("/object/public/", "/render/image/public/") + `?width=${width}&quality=${quality}`;
}

/* ---------------- YEAR RANGE (import_year / registration_year only) ---------------- */
/*
   The vehicle <select id="year"> is managed by the catalogue cascade, so we
   do NOT populate it here. Only import_year and registration_year get a
   static range.
*/
function populateYears(id) {
    const select = $(id);
    if (!select) return;

    const currentYear = new Date().getFullYear();
    const minYear = 1990;
    const maxYear = currentYear + 1;
    const prev = select.value;

    select.innerHTML = '<option value="">Select</option>';

    for (let year = maxYear; year >= minYear; year--) {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        select.appendChild(option);
    }

    if (prev && !select.querySelector(`option[value="${prev}"]`)) {
        const extra = document.createElement("option");
        extra.value = String(prev);
        extra.textContent = String(prev);
        select.insertBefore(extra, select.children[1] || null);
    }

    if (prev) select.value = prev;
}

populateYears("import_year");
populateYears("registration_year");

/* ---------------- YEAR OVERRIDE (admin can pick any year) ---------------- */

/**
 * Rebuilds the year <select> with:
 *   - every year already provided by the catalogue cascade
 *   - every year from 1990 → (currentYear + 1)
 *   - the preferredYear (usually car.year) if provided
 *
 * Sorted descending. Restores the selection.
 *
 * Call with no args after cascade updates.
 * Call with car.year once on initial load.
 */
function expandYearRange(preferredYear = null) {
    const sel = $("year");
    if (!sel) return;

    const currentYear = new Date().getFullYear();
    const prevValue = sel.value;
    const values = new Set(
        [...sel.options].filter(o => o.value !== "").map(o => String(o.value))
    );

    for (let y = currentYear + 1; y >= 1990; y--) values.add(String(y));

    if (preferredYear !== null && preferredYear !== undefined && preferredYear !== "") {
        values.add(String(preferredYear));
    }

    const sorted = [...values].sort((a, b) => Number(b) - Number(a));

    sel.innerHTML = '<option value="">Select year</option>';
    for (const v of sorted) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
    }

    const target = (preferredYear !== null && preferredYear !== undefined && preferredYear !== "")
        ? String(preferredYear)
        : prevValue;

    if (target && sorted.includes(target)) sel.value = target;

    sel.disabled = false;
}

/**
 * Wraps make/model onchange so we re-expand the year range after every
 * cascade rewrite. Runs only once per element.
 */
function hookYearOverride() {
    const wrap = (el, key) => {
        if (!el || el.dataset[key]) return;
        const original = el.onchange;
        el.onchange = function (e) {
            if (original) original.call(this, e);
            setTimeout(() => expandYearRange(), 0);
        };
        el.dataset[key] = "1";
    };

    wrap($("make"), "yearHooked");
    wrap($("model"), "yearHooked");
}

/* ---------------- DISPLAY IMAGE ---------------- */

function showDisplay(url) {
    displayPreview.innerHTML = `<img src="${optimizedUrl(url, 800, 85)}" alt="Display image">`;
    displayPreview.classList.add("active");
    $("removeDisplay").classList.add("active");
}

function clearDisplay() {
    displayPreview.innerHTML = "";
    displayPreview.classList.remove("active");
    $("removeDisplay").classList.remove("active");
}

/* ---------------- GALLERY ---------------- */

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

/* ---------------- LOAD VEHICLE ---------------- */

async function loadVehicle() {
    if (!carId) {
        loading.textContent = "No vehicle ID provided.";
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

        /* -------- Vehicle catalogue (best-effort) -------- */
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
            showMessage(
                "error",
                "Vehicle catalogue is unavailable. Existing vehicle information can still be edited."
            );
        }

        /* -------- Year override: full range + hook future cascade updates -------- */
        hookYearOverride();
        expandYearRange(car.year);

        /* -------- Populate ordinary fields -------- */
        fields.forEach(field => {
            if (
                field === "make" ||
                field === "model" ||
                field === "year" ||
                field === "body_type" ||
                field === "fuel_type" ||
                field === "transmission" ||
                field === "drive_type"
            ) return;

            const element = $(field);
            if (!element) return;

            element.value =
                car[field] !== null && car[field] !== undefined
                    ? String(car[field])
                    : "";
        });

        manualEngine = !!car.engine_description;
        manualDescription = !!car.description;

        $("negotiable").checked = !!car.negotiable;
        $("financing_available").checked = !!car.financing_available;
        $("test_drive_available").checked = car.test_drive_available !== false;
        $("featured").checked = !!car.featured;

        if (car.display_image_url) showDisplay(car.display_image_url);

        const galleryResult = await supabase
            .from("car_images")
            .select("*")
            .eq("car_id", carId)
            .order("display_order", { ascending: true });

        if (galleryResult.error) throw galleryResult.error;

        gallery = galleryResult.data || [];
        renderGallery();

        form.style.display = "block";

    } catch (error) {
        showMessage("error", error?.message || "Unable to load vehicle.");
    } finally {
        loading.style.display = "none";
    }
}

/* ---------------- DISPLAY IMAGE HANDLERS ---------------- */

displayInput.onchange = event => {
    newDisplay = event.target.files[0] || null;
    removeDisplay = false;
    if (newDisplay) showDisplay(URL.createObjectURL(newDisplay));
};

$("removeDisplay").onclick = () => {
    newDisplay = null;
    removeDisplay = true;
    displayInput.value = "";
    clearDisplay();
};

galleryInput.onchange = event => {
    const files = [...event.target.files];
    files.forEach(file => uploadGallery(file));
    galleryInput.value = "";
};

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
            const storageResult = await supabase.storage
                .from(BUCKET)
                .remove([image.storage_path]);
            if (storageResult.error) throw storageResult.error;
        }

        const result = await supabase
            .from("car_images")
            .delete()
            .eq("id", image.id);

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
        .update({
            display_image_url: imageUrl,
            display_image_path: imagePath
        })
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

/* ---------------- SAVE ---------------- */

form.onsubmit = async event => {
    event.preventDefault();
    clearMessages();

    /*
     * Catalogue validation:
     *   skipYear = true → admin can save any year, even outside the catalogue.
     *   Other dependent fields (body / fuel / transmission / drive) still validated.
     */
    if (catalog && catalog.rows.length) {
        const invalid = catalog.validate({ skipYear: true });
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

        fields.forEach(field => {
            const element = $(field);
            if (!element) return;

            const value = element.value.trim();

            if (value === "") {
                updates[field] = null;
            } else if (numericFields.has(field)) {
                updates[field] = Number(value);
            } else {
                updates[field] = value;
            }
        });

        updates.negotiable = $("negotiable").checked;
        updates.financing_available = $("financing_available").checked;
        updates.test_drive_available = $("test_drive_available").checked;
        updates.featured = $("featured").checked;

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

        const result = await supabase
            .from("cars")
            .update(updates)
            .eq("id", carId);

        if (result.error) throw result.error;

        car = { ...car, ...updates };

        if (updates.status === "sold") {
            await recordAgentSale({ ...car, ...updates });
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

/* ---------------- DELETE ---------------- */

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

/* ---------------- NAV ---------------- */

function goBack() {
    window.location.href = "index.html";
}

$("backBtn").onclick = goBack;
$("bottomCancel").onclick = goBack;

/* ---------------- BOOT ---------------- */

loadVehicle();