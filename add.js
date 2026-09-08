import { supabase } from "./supabase.js";
import { initVehicleCatalogue } from "./vehicle-catalog.js";

const BUCKET = "car-images";

const $ = id => document.getElementById(id);

const form = $("carForm");
const displayInput = $("displayInput");
const galleryInput = $("galleryInput");
const displayPreview = $("displayPreview");
const galleryPreview = $("galleryPreview");

let newDisplay=null,gallery=[],catalog=null,manualEngine=false,manualDescription=false;

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

function generateVehicleText(){const v=id=>$(id)?.value?.trim()||"",make=v("make"),model=v("model"),trim=v("trim"),year=v("year"),body=v("body_type"),size=v("engine_size"),hp=v("horsepower"),fuel=v("fuel_type"),trans=v("transmission"),drive=v("drive_type"),mileage=v("mileage"),condition=v("condition"),ext=v("exterior_color"),int=v("interior_color"),seats=v("seats"),doors=v("doors"),origin=v("country_of_origin"),reg=v("registration_year"),service=v("service_history"),accident=v("accident_history"),engine=[size?`${size}L`:"",hp?`${hp} hp`:"",fuel,trans,drive].filter(Boolean).join(" • "),name=[year,make,model,trim].filter(Boolean).join(" ");if(!manualEngine&&$("engine_description"))$("engine_description").value=engine;if(!manualDescription&&$("description"))$("description").value=`${name||"This vehicle"}${body?` is a ${body.toLowerCase()}`:""}${engine?`, powered by ${engine}`:""}. ${mileage?`It has covered ${Number(mileage).toLocaleString("en-KE")} km. `:""}${condition?`The vehicle is in ${condition.toLowerCase()} condition. `:""}${ext?`The exterior is finished in ${ext}. `:""}${int?`The interior is ${int}. `:""}${seats?`It has ${seats} seats${doors?` and ${doors} doors`:""}. `:""}${origin?`Country of origin: ${origin}. `:""}${reg?`Registered in ${reg}. `:""}${service?`Service history: ${service}. `:""}${accident?`Accident history: ${accident}. `:""}`.trim()}
$("engine_description")?.addEventListener("input",()=>manualEngine=true);
$("description")?.addEventListener("input",()=>manualDescription=true);
["make","model","trim","year","body_type","engine_size","horsepower","fuel_type","transmission","drive_type","mileage","condition","exterior_color","interior_color","seats","doors","country_of_origin","registration_year","service_history","accident_history"].forEach(id=>$(id)?.addEventListener("change",()=>{manualEngine=false;manualDescription=false;generateVehicleText()}));

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
    for (let year = currentYear; year >= 1990; year--) {
        const option = document.createElement("option");
        option.value = year;
        option.textContent = year;
        select.appendChild(option);
    }
}
populateYears("year");
populateYears("import_year");
populateYears("registration_year");

function showDisplayPreview(url) {
    displayPreview.innerHTML = `
        <img src="${url}" alt="Display image">
    `;

    displayPreview.classList.add("active");
    $("removeDisplay").classList.add("active");
}

displayInput.onchange = event => {
    newDisplay = event.target.files[0] || null;

    if (newDisplay) {
        showDisplayPreview(URL.createObjectURL(newDisplay));
    }
};

$("removeDisplay").onclick = () => {
    newDisplay = null;
    displayInput.value = "";

    displayPreview.innerHTML = "";
    displayPreview.classList.remove("active");

    $("removeDisplay").classList.remove("active");
};

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

            gallery = gallery.filter(
                existingFile => existingFile !== file
            );
        };

        galleryPreview.appendChild(item);

        gallery.push(file);
    });

    galleryInput.value = "";
};

async function uploadImage(path, file) {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
            cacheControl: "3600",
            upsert: false
        });

    if (error) {
        throw error;
    }

    return publicUrl(path);
}

form.onsubmit = async event => {
    event.preventDefault();

    clearMessages();

    if (!catalog) {
        showMessage(
            "error",
            "Vehicle catalogue is not ready. Please refresh the page."
        );

        return;
    }

    const invalid = catalog.validate();

    if (invalid) {
        showMessage("error", invalid);
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
        const data = {
            id
        };

        fields.forEach(field => {
            const element = $(field);
            const value = element.value.trim();

            if (value === "") {
                data[field] = null;
            } else if (numericFields.has(field)) {
                data[field] = Number(value);
            } else {
                data[field] = value;
            }
        });

        data.negotiable = $("negotiable").checked;
        data.financing_available = $("financing_available").checked;
        data.test_drive_available = $("test_drive_available").checked;
        data.featured = $("featured").checked;

        let result = await supabase
            .from("cars")
            .insert(data);

        if (result.error) {
            throw result.error;
        }

        if (newDisplay) {
            const path =
                `${id}/display/` +
                `${crypto.randomUUID()}-${safeFileName(newDisplay.name)}`;

            const imageUrl = await uploadImage(path, newDisplay);

            uploadedPaths.push(path);

            result = await supabase
                .from("cars")
                .update({
                    display_image_url: imageUrl,
                    display_image_path: path
                })
                .eq("id", id);

            if (result.error) {
                throw result.error;
            }
        }

        for (let index = 0; index < gallery.length; index++) {
            const file = gallery[index];

            const path =
                `${id}/gallery/` +
                `${crypto.randomUUID()}-${safeFileName(file.name)}`;

            const imageUrl = await uploadImage(path, file);

            uploadedPaths.push(path);

            result = await supabase
                .from("car_images")
                .insert({
                    car_id: id,
                    image_url: imageUrl,
                    storage_path: path,
                    image_type: "gallery",
                    display_order: index
                });

            if (result.error) {
                throw result.error;
            }
        }

        showMessage(
            "success",
            "Vehicle added successfully."
        );

        saveButtons.forEach(button => {
            button.textContent = "Added";
        });

        setTimeout(() => {
            location.href = `edit.html?id=${encodeURIComponent(id)}`;
        }, 900);

    } catch (error) {
        if (uploadedPaths.length) {
            await supabase.storage
                .from(BUCKET)
                .remove(uploadedPaths);
        }

        await supabase
            .from("cars")
            .delete()
            .eq("id", id);

        showMessage(
            "error",
            error?.message || "Unable to save vehicle."
        );

        saveButtons.forEach(button => {
            button.disabled = false;
            button.textContent = "Add Vehicle";
        });
    }
};

async function initialise() {
    try {


catalog=await initVehicleCatalogue({makeId:"make",modelId:"model",yearId:"year",bodyId:"body_type",fuelId:"fuel_type",transId:"transmission",driveId:"drive_type"});generateVehicleText();


        if (!catalog.rows.length) {
            showMessage(
                "error",
                "The vehicle catalogue is currently empty. Add catalogue makes and models in Supabase before creating new vehicles."
            );
        }

    } catch (error) {
        showMessage(
            "error",
            `Vehicle catalogue could not load: ${error?.message || "Unknown error"}`
        );
    }
}

initialise();