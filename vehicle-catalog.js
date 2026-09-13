/* =====================================================================
   vehicle-catalog.js  —  FULL REPLACEMENT

   What changed and why:

   1. Matching is case- and whitespace-insensitive. "Nissan XTRAIL",
      "Nissan Xtrail" and "nissan xtrail" now resolve to one record, so
      Wix-imported vehicles stop failing validation.

   2. The year list is ALWAYS 1980 -> next year, on every page, whether or
      not a make/model is selected. Pre-2011 vehicles can be entered and
      saved normally.

   3. Dependent selects (body / fuel / transmission / drive) always carry
      a standard list merged with whatever the catalogue holds, so a
      sparse catalogue row can never leave a dropdown empty.

   4. Every select accepts free text via a "+ Add new..." option. New
      values are used immediately and registered in the catalogue in the
      background -- admin entry is never blocked.

   5. validate() is advisory only. It refuses an empty make or model and
      nothing else. It will never reject a year, body type, fuel type,
      transmission or drive type again.
   ===================================================================== */

import { supabase } from "./supabase.js";
import { MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR } from "./car-schema.js";

const cache = { rows: null, promise: null };
const $ = id => document.getElementById(id);

/* Fallback values merged into every dependent dropdown. */
const STANDARD = {
    body_types:    ["Sedan", "Hatchback", "SUV", "Wagon", "MPV", "Pickup", "Van", "Coupe", "Convertible", "Bus", "Truck"],
    fuel_types:    ["Petrol", "Diesel", "Hybrid", "Electric", "Plug-in Hybrid", "LPG"],
    transmissions: ["Automatic", "Manual", "CVT", "Semi-Automatic", "DCT"],
    drive_types:   ["2WD", "4WD", "AWD", "FWD", "RWD"]
};

const ADD_NEW = "__add_new__";

/* ---------------- helpers ---------------- */

const norm = v => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function uniqueSorted(values) {
    const seen = new Map();

    (values || []).forEach(v => {
        if (v === null || v === undefined) return;
        const s = String(v).trim();
        if (!s) return;
        if (!seen.has(norm(s))) seen.set(norm(s), s);
    });

    return [...seen.values()].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
}

function fullYearList() {
    const years = [];
    for (let y = MAX_VEHICLE_YEAR; y >= MIN_VEHICLE_YEAR; y--) years.push(y);
    return years;
}

function normalizeRows(rows) {
    return (rows || []).map(row => ({
        ...row,
        make: row.make ? String(row.make).trim() : "",
        model: row.model ? String(row.model).trim() : "",
        make_key: norm(row.make),
        model_key: norm(row.model),
        years: Array.isArray(row.years) ? row.years.map(Number).filter(Number.isFinite) : [],
        body_types:    Array.isArray(row.body_types)    ? row.body_types.map(String)    : [],
        fuel_types:    Array.isArray(row.fuel_types)    ? row.fuel_types.map(String)    : [],
        transmissions: Array.isArray(row.transmissions) ? row.transmissions.map(String) : [],
        drive_types:   Array.isArray(row.drive_types)   ? row.drive_types.map(String)   : []
    }));
}

export async function getCatalog({ force = false } = {}) {
    if (!force && cache.rows) return cache.rows;
    if (!force && cache.promise) return cache.promise;

    cache.promise = (async () => {
        const { data, error } = await supabase
            .from("vehicle_catalog")
            .select("*")
            .eq("active", true)
            .order("make", { ascending: true })
            .order("model", { ascending: true });

        if (error) throw error;

        cache.rows = normalizeRows(data || []);
        cache.promise = null;
        return cache.rows;
    })();

    return cache.promise;
}

/* ---------------- select plumbing ---------------- */

function ensureOption(select, value, label = value) {
    if (!select || value === null || value === undefined || value === "") return;

    const match = [...select.options].find(o => norm(o.value) === norm(value));
    if (match) return;

    const option = document.createElement("option");
    option.value = value;
    option.textContent = label || value;
    option.dataset.legacy = "true";

    const placeholder = select.options[0];
    if (placeholder && placeholder.value === "") {
        placeholder.insertAdjacentElement("afterend", option);
    } else {
        select.insertBefore(option, select.firstChild);
    }
}

function setOptions(select, values, placeholder = "Select", { allowNew = true } = {}) {
    if (!select) return;

    const previous = select.value;
    select.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    select.appendChild(ph);

    uniqueSorted(values).forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });

    if (allowNew) {
        const addNew = document.createElement("option");
        addNew.value = ADD_NEW;
        addNew.textContent = "+ Add new...";
        addNew.dataset.addNew = "true";
        select.appendChild(addNew);
    }

    select.disabled = false;

    /* Keep whatever was already selected, even if it is not in the list. */
    if (previous && previous !== ADD_NEW) {
        ensureOption(select, previous);
        const match = [...select.options].find(o => norm(o.value) === norm(previous));
        if (match) select.value = match.value;
    }
}

/* Wires the "+ Add new..." behaviour onto a select. */
function attachFreeText(select, label) {
    if (!select || select.dataset.freeText === "1") return;
    select.dataset.freeText = "1";
    select.dataset.lastValue = select.value || "";

    select.addEventListener("change", () => {
        if (select.value !== ADD_NEW) {
            select.dataset.lastValue = select.value;
            return;
        }

        const entered = (window.prompt(`Enter ${label}:`) || "").trim();

        if (!entered) {
            select.value = select.dataset.lastValue || "";
            return;
        }

        ensureOption(select, entered);
        const match = [...select.options].find(o => norm(o.value) === norm(entered));
        select.value = match ? match.value : entered;
        select.dataset.lastValue = select.value;

        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

function setYearOptions(select, catalogYears = []) {
    if (!select) return;

    const previous = select.value;
    const merged = new Set(fullYearList().map(String));

    (catalogYears || []).forEach(y => {
        if (Number.isFinite(Number(y))) merged.add(String(Number(y)));
    });

    if (previous) merged.add(String(previous));

    const sorted = [...merged].sort((a, b) => Number(b) - Number(a));

    select.innerHTML = '<option value="">Select year</option>';
    sorted.forEach(y => {
        const option = document.createElement("option");
        option.value = y;
        option.textContent = y;
        select.appendChild(option);
    });

    if (previous) select.value = previous;
    select.disabled = false;
}

/* ---------------- background catalogue registration ---------------- */

export async function registerCombo({ make, model, year, body_type, fuel_type, transmission, drive_type } = {}) {
    const cleanMake = String(make || "").trim();
    const cleanModel = String(model || "").trim();
    if (!cleanMake || !cleanModel) return;

    try {
        const rows = await getCatalog();
        const existing = rows.find(r => r.make_key === norm(cleanMake) && r.model_key === norm(cleanModel));

        if (!existing) {
            const years = fullYearList().slice().sort((a, b) => a - b);

            const { error } = await supabase.from("vehicle_catalog").insert({
                make: cleanMake,
                model: cleanModel,
                years,
                body_types:    body_type    ? [String(body_type).trim()]    : [],
                fuel_types:    fuel_type    ? [String(fuel_type).trim()]    : [],
                transmissions: transmission ? [String(transmission).trim()] : [],
                drive_types:   drive_type   ? [String(drive_type).trim()]   : [],
                active: true
            });

            if (!error) cache.rows = null;
            return;
        }

        const merge = (current, value) => {
            const v = String(value || "").trim();
            if (!v) return null;
            if ((current || []).some(x => norm(x) === norm(v))) return null;
            return [...(current || []), v];
        };

        const patch = {};
        const b = merge(existing.body_types, body_type);
        const f = merge(existing.fuel_types, fuel_type);
        const t = merge(existing.transmissions, transmission);
        const d = merge(existing.drive_types, drive_type);
        const y = Number(year);

        if (b) patch.body_types = b;
        if (f) patch.fuel_types = f;
        if (t) patch.transmissions = t;
        if (d) patch.drive_types = d;
        if (Number.isFinite(y) && !existing.years.includes(y)) {
            patch.years = [...existing.years, y].sort((p, q) => p - q);
        }

        if (Object.keys(patch).length) {
            const { error } = await supabase
                .from("vehicle_catalog")
                .update(patch)
                .eq("id", existing.id);
            if (!error) cache.rows = null;
        }
    } catch (error) {
        /* Best effort only. A database trigger also absorbs any make and
           model saved on a car, so nothing is lost if this call is
           blocked by row level security. */
        console.warn("Catalogue registration skipped:", error?.message || error);
    }
}

/* ---------------- main entry point ---------------- */

export async function initVehicleCatalogue({
    makeId, modelId, yearId, bodyId, fuelId, transId, driveId
}) {
    const rows = await getCatalog();

    const make  = $(makeId);
    const model = $(modelId);
    const year  = $(yearId);
    const body  = $(bodyId);
    const fuel  = $(fuelId);
    const trans = $(transId);
    const drive = $(driveId);

    if (!make || !model) {
        throw new Error("Vehicle catalogue fields are missing from the page.");
    }

    function modelsFor(makeValue) {
        const key = norm(makeValue);
        return rows.filter(r => r.make_key === key).map(r => r.model);
    }

    function getModelRecord() {
        return rows.find(
            r => r.make_key === norm(make.value) && r.model_key === norm(model && model.value)
        ) || null;
    }

    /* Catalogue values first, standard values merged in, so nothing is
       ever empty or restrictive. */
    function fillDependents(record) {
        setOptions(body,  [...(record?.body_types    || []), ...STANDARD.body_types],    "Select body type");
        setOptions(fuel,  [...(record?.fuel_types    || []), ...STANDARD.fuel_types],    "Select fuel type");
        setOptions(trans, [...(record?.transmissions || []), ...STANDARD.transmissions], "Select transmission");
        setOptions(drive, [...(record?.drive_types   || []), ...STANDARD.drive_types],   "Select drive type");
        setYearOptions(year, record?.years || []);
    }

    /* ---- initial population ---- */
    setOptions(make, rows.map(r => r.make), "Select make");
    setOptions(model, [], "Select make first");
    fillDependents(null);

    attachFreeText(make,  "make");
    attachFreeText(model, "model");
    attachFreeText(body,  "body type");
    attachFreeText(fuel,  "fuel type");
    attachFreeText(trans, "transmission");
    attachFreeText(drive, "drive type");

    make.addEventListener("change", () => {
        if (make.value === ADD_NEW) return;

        const models = modelsFor(make.value);
        const previousModel = model.value;

        setOptions(model, models, make.value ? "Select model" : "Select make first");

        if (previousModel && models.some(m => norm(m) === norm(previousModel))) {
            ensureOption(model, previousModel);
            const match = [...model.options].find(o => norm(o.value) === norm(previousModel));
            if (match) model.value = match.value;
        }

        model.disabled = false;
        fillDependents(getModelRecord());
    });

    model.addEventListener("change", () => {
        if (model.value === ADD_NEW) return;
        fillDependents(getModelRecord());
    });

    /* ---- advisory validation ----
       Only an empty make or model is rejected. Years and every other
       attribute are always accepted, so legacy and pre-2011 vehicles
       save without complaint. */
    function validate() {
        if (!make.value || make.value === ADD_NEW) return "Please select or enter a make.";
        if (!model.value || model.value === ADD_NEW) return "Please select or enter a model.";
        return null;
    }

    /* Loads an existing vehicle's values into the selects, inserting any
       value the catalogue does not know about rather than dropping it. */
    function setVehicleValues(values = {}) {
        const selectedMake = values.make || "";
        const selectedModel = values.model || "";

        if (selectedMake) {
            ensureOption(make, selectedMake);
            const match = [...make.options].find(o => norm(o.value) === norm(selectedMake));
            make.value = match ? match.value : selectedMake;
        }

        const models = modelsFor(make.value);
        setOptions(model, models, make.value ? "Select model" : "Select make first");
        model.disabled = false;

        if (selectedModel) {
            ensureOption(model, selectedModel);
            const match = [...model.options].find(o => norm(o.value) === norm(selectedModel));
            model.value = match ? match.value : selectedModel;
        }

        fillDependents(getModelRecord());

        [
            [year,  values.year],
            [body,  values.body_type],
            [fuel,  values.fuel_type],
            [trans, values.transmission],
            [drive, values.drive_type]
        ].forEach(([select, value]) => {
            if (!select || value === null || value === undefined || value === "") return;
            ensureOption(select, String(value));
            const match = [...select.options].find(o => norm(o.value) === norm(value));
            select.value = match ? match.value : String(value);
        });
    }

    /* Reads the current selections back out, ignoring the sentinel. */
    function currentSelection() {
        const val = el => (el && el.value !== ADD_NEW ? el.value : "");
        return {
            make: val(make),
            model: val(model),
            year: val(year) ? Number(val(year)) : null,
            body_type: val(body),
            fuel_type: val(fuel),
            transmission: val(trans),
            drive_type: val(drive)
        };
    }

    /* Call after a successful save so new combinations are stored. */
    function syncToCatalog() {
        return registerCombo(currentSelection());
    }

    return {
        rows,
        validate,
        setVehicleValues,
        getModelRecord,
        currentSelection,
        syncToCatalog,
        refresh: () => getCatalog({ force: true })
    };
}