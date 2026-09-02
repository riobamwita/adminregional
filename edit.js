import { supabase } from "./supabase.js";
import { initVehicleCatalogue } from "./vehicle-catalog.js";
import{recordAgentSale}from"./agent-payments.js";

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

let car = null;
let gallery = [];
let newDisplay = null;
let removeDisplay = false;
let catalog = null;

const fields = [
    "make",
    "model",
    "trim",
    "year",
    "price",
    "condition",
    "body_type",
    "status",
    "engine_size",
    "engine_description",
    "horsepower",
    "mileage",
    "fuel_type",
    "transmission",
    "drive_type",
    "exterior_color",
    "interior_color",
    "seats",
    "doors",
    "vin",
    "chassis_number",
    "registration_number",
    "stock_number",
    "country_of_origin",
    "import_year",
    "registration_year",
    "auction_grade",
    "previous_owners",
    "accident_history",
    "service_history",
    "number_of_keys",
    "inspection_status",
    "inspection_notes",
    "location",
    "city",
    "county",
    "description"
];

const numericFields = new Set([
    "year",
    "price",
    "engine_size",
    "horsepower",
    "mileage",
    "seats",
    "doors",
    "import_year",
    "registration_year"
]);

function showMessage(id, text) {
    const element = $(id);

    element.textContent = text;
    element.classList.add("active");
}

function clearMessages() {
    $("error").classList.remove("active");
    $("success").classList.remove("active");
}

function publicUrl(path) {
    return supabase.storage
        .from(BUCKET)
        .getPublicUrl(path)
        .data.publicUrl;
}

function safeFileName(name) {
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-");
}

function populateYears(id) {
    const select = $(id);
    const currentYear = new Date().getFullYear();

    select.innerHTML = '<option value="">Select</option>';

    for (let year = currentYear; year >= 2016; year--) {
        const option = document.createElement("option");

        option.value = year;
        option.textContent = year;

        select.appendChild(option);
    }
}

populateYears("import_year");
populateYears("registration_year");

function showDisplay(url) {
    displayPreview.innerHTML = `
        <img src="${url}" alt="Display image">
    `;

    displayPreview.classList.add("active");
    $("removeDisplay").classList.add("active");
}

function clearDisplay() {
    displayPreview.innerHTML = "";
    displayPreview.classList.remove("active");
    $("removeDisplay").classList.remove("active");
}

function renderGallery() {
    galleryPreview.innerHTML = "";

    gallery.forEach(image => {
        const item = document.createElement("div");

        item.className = "gallery-item";

        item.innerHTML = `
            <img
                src="${image.image_url}"
                alt="Vehicle gallery image"
            >

            <button
                type="button"
                class="delete-image"
                title="Delete image"
            >
                <i class="fa-solid fa-xmark"></i>
            </button>

            <button
                type="button"
                class="make-main"
            >
                Make Display
            </button>
        `;

        item.querySelector(".delete-image").onclick = () => {
            deleteGalleryImage(image);
        };

        item.querySelector(".make-main").onclick = () => {
            makeDisplayFromGallery(image);
        };

        galleryPreview.appendChild(item);
    });
}

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

        if (result.error) {
            throw result.error;
        }

        if (!result.data) {
            throw new Error(
                "Vehicle could not be found in the database."
            );
        }

        car = result.data;

        /*
         * Load the catalogue separately.
         *
         * A missing/empty catalogue must NOT prevent an
         * existing vehicle from being edited.
         */
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
            /*
             * Catalogue failure is not allowed to block
             * existing vehicle editing.
             */
            console.warn(
                "Vehicle catalogue unavailable:",
                catalogError
            );

            showMessage(
                "error",
                "Vehicle catalogue is unavailable. Existing vehicle information can still be edited."
            );
        }

        /*
         * Populate all ordinary fields after the catalogue
         * has handled the dependent dropdowns.
         */
        fields.forEach(field => {
            if (
                field === "make" ||
                field === "model" ||
                field === "year" ||
                field === "body_type" ||
                field === "fuel_type" ||
                field === "transmission" ||
                field === "drive_type"
            ) {
                return;
            }

            const element = $(field);

            if (!element) {
                return;
            }

            element.value =
                car[field] !== null &&
                car[field] !== undefined
                    ? String(car[field])
                    : "";
        });

        $("negotiable").checked = !!car.negotiable;

        $("financing_available").checked =
            !!car.financing_available;

        $("test_drive_available").checked =
            car.test_drive_available !== false;

        $("featured").checked = !!car.featured;

        if (car.display_image_url) {
            showDisplay(car.display_image_url);
        }

        const galleryResult = await supabase
            .from("car_images")
            .select("*")
            .eq("car_id", carId)
            .order("display_order", {
                ascending: true
            });

        if (galleryResult.error) {
            throw galleryResult.error;
        }

        gallery = galleryResult.data || [];

        renderGallery();

        form.style.display = "block";

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to load vehicle."
        );

    } finally {
        loading.style.display = "none";
    }
}

displayInput.onchange = event => {
    newDisplay = event.target.files[0] || null;

    removeDisplay = false;

    if (newDisplay) {
        showDisplay(
            URL.createObjectURL(newDisplay)
        );
    }
};

$("removeDisplay").onclick = () => {
    newDisplay = null;
    removeDisplay = true;

    displayInput.value = "";

    clearDisplay();
};

galleryInput.onchange = event => {
    const files = [...event.target.files];

    files.forEach(file => {
        uploadGallery(file);
    });

    galleryInput.value = "";
};

async function uploadGallery(file) {
    try {
        const path =
            `${carId}/gallery/` +
            `${crypto.randomUUID()}-${safeFileName(file.name)}`;

        const uploadResult = await supabase.storage
            .from(BUCKET)
            .upload(path, file, {
                cacheControl: "3600",
                upsert: false
            });

        if (uploadResult.error) {
            throw uploadResult.error;
        }

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
            await supabase.storage
                .from(BUCKET)
                .remove([path]);

            throw insertResult.error;
        }

        gallery.push(insertResult.data);

        renderGallery();

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to upload gallery image."
        );
    }
}

async function deleteGalleryImage(image) {
    if (
        !confirm(
            "Delete this gallery image?"
        )
    ) {
        return;
    }

    try {
        if (image.storage_path) {
            const storageResult = await supabase.storage
                .from(BUCKET)
                .remove([image.storage_path]);

            if (storageResult.error) {
                throw storageResult.error;
            }
        }

        const result = await supabase
            .from("car_images")
            .delete()
            .eq("id", image.id);

        if (result.error) {
            throw result.error;
        }

        gallery = gallery.filter(
            item => item.id !== image.id
        );

        renderGallery();

        showMessage(
            "success",
            "Gallery image deleted."
        );

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to delete image."
        );
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

    if (result.error) {
        throw result.error;
    }

    car.display_image_url = imageUrl;
    car.display_image_path = imagePath;
}

async function makeDisplayFromGallery(image) {
    try {
        await setDisplayImage(
            image.image_url,
            image.storage_path
        );

        removeDisplay = false;
        newDisplay = null;

        showDisplay(image.image_url);

        showMessage(
            "success",
            "Gallery image is now the display image."
        );

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to set display image."
        );
    }
}

async function uploadNewDisplay() {
    if (!newDisplay) {
        return;
    }

    const oldPath = car.display_image_path;

    const path =
        `${carId}/display/` +
        `${crypto.randomUUID()}-${safeFileName(newDisplay.name)}`;

    const result = await supabase.storage
        .from(BUCKET)
        .upload(path, newDisplay, {
            cacheControl: "3600",
            upsert: false
        });

    if (result.error) {
        throw result.error;
    }

    const imageUrl = publicUrl(path);

    await setDisplayImage(
        imageUrl,
        path
    );

    if (
        oldPath &&
        oldPath !== path
    ) {
        await supabase.storage
            .from(BUCKET)
            .remove([oldPath]);
    }
}

form.onsubmit = async event => {
    event.preventDefault();

    clearMessages();

    /*
     * Catalogue validation is only applied when the
     * catalogue is available.
     *
     * This prevents old vehicles from becoming
     * impossible to edit.
     */
    if (catalog && catalog.rows.length) {
        const invalid = catalog.validate();

        if (invalid) {
            showMessage("error", invalid);
            return;
        }
    }

    const saveButtons =
        document.querySelectorAll(".save");

    saveButtons.forEach(button => {
        button.disabled = true;
        button.textContent = "Saving...";
    });

    try {
        const updates = {};

        fields.forEach(field => {
            const element = $(field);

            if (!element) {
                return;
            }

            const value = element.value.trim();

            if (value === "") {
                updates[field] = null;
            } else if (numericFields.has(field)) {
                updates[field] = Number(value);
            } else {
                updates[field] = value;
            }
        });

        updates.negotiable =
            $("negotiable").checked;

        updates.financing_available =
            $("financing_available").checked;

        updates.test_drive_available =
            $("test_drive_available").checked;

        updates.featured =
            $("featured").checked;

        /*
         * Upload a new display image first.
         */
        if (newDisplay) {
            await uploadNewDisplay();

            newDisplay = null;
            displayInput.value = "";
        }

        /*
         * Remove the display image if requested.
         */
        if (removeDisplay) {
            if (car.display_image_path) {
                await supabase.storage
                    .from(BUCKET)
                    .remove([
                        car.display_image_path
                    ]);
            }

            updates.display_image_url = null;
            updates.display_image_path = null;

            car.display_image_url = null;
            car.display_image_path = null;

            removeDisplay = false;
        }

        updates.updated_at =
            new Date().toISOString();

        const result = await supabase
            .from("cars")
            .update(updates)
            .eq("id", carId);

        if (result.error) {
            throw result.error;
        }

        car = {
            ...car,
            ...updates
        };
        if(updates.status==="sold")await recordAgentSale({...car,...updates});

        showMessage(
    "success",
    "Vehicle saved successfully. Returning to listings..."
);

saveButtons.forEach(button => {
    button.textContent = "Saved";
});

/* Automatically close the edit form and return to listings */
setTimeout(() => {
    window.location.href = "index.html";
}, 700);

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to save vehicle."
        );

        saveButtons.forEach(button => {
            button.textContent = "Save Changes";
        });

    } finally {
        saveButtons.forEach(button => {
            button.disabled = false;
        });
    }
};

$("deleteBtn").onclick = async () => {
    if (
        !confirm(
            "Delete this vehicle and all its images?"
        )
    ) {
        return;
    }

    try {
        $("deleteBtn").disabled = true;

        const paths = [
            car?.display_image_path,
            ...gallery.map(
                image => image.storage_path
            )
        ].filter(Boolean);

        if (paths.length) {
            const result = await supabase.storage
                .from(BUCKET)
                .remove(paths);

            if (result.error) {
                throw result.error;
            }
        }

        const result = await supabase
            .from("cars")
            .delete()
            .eq("id", carId);

        if (result.error) {
            throw result.error;
        }

        location.href = "index.html";

    } catch (error) {
        showMessage(
            "error",
            error?.message || "Unable to delete vehicle."
        );

        $("deleteBtn").disabled = false;
    }
};

function goBack() {
    window.location.href = "index.html";
}

$("backBtn").onclick = goBack;
$("bottomCancel").onclick = goBack;

/* Load the vehicle when the page opens */
loadVehicle();