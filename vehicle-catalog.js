import { supabase } from "./supabase.js";

const cache = {
    rows: null
};

const $ = id => document.getElementById(id);

function uniqueSorted(values) {
    return [
        ...new Set(
            (values || [])
                .filter(v => v !== null && v !== undefined && String(v).trim() !== "")
                .map(v => String(v).trim())
        )
    ].sort((a, b) =>
        a.localeCompare(b, undefined, {
            numeric: true,
            sensitivity: "base"
        })
    );
}

function normalizeRows(rows) {
    return (rows || []).map(row => ({
        ...row,

        make: row.make ? String(row.make).trim() : "",
        model: row.model ? String(row.model).trim() : "",

        years: Array.isArray(row.years)
            ? row.years.map(Number).filter(Number.isFinite)
            : [],

        body_types: Array.isArray(row.body_types)
            ? row.body_types.map(String)
            : [],

        fuel_types: Array.isArray(row.fuel_types)
            ? row.fuel_types.map(String)
            : [],

        transmissions: Array.isArray(row.transmissions)
            ? row.transmissions.map(String)
            : [],

        drive_types: Array.isArray(row.drive_types)
            ? row.drive_types.map(String)
            : []
    }));
}

export async function getCatalog() {
    if (cache.rows) {
        return cache.rows;
    }

    const { data, error } = await supabase
        .from("vehicle_catalog")
        .select("*")
        .eq("active", true)
        .order("make", { ascending: true })
        .order("model", { ascending: true });

    if (error) {
        throw error;
    }

    cache.rows = normalizeRows(data || []);

    return cache.rows;
}

function setOptions(select, values, placeholder = "Select") {
    if (!select) {
        return;
    }

    select.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    uniqueSorted(values).forEach(value => {
        const option = document.createElement("option");

        option.value = value;
        option.textContent = value;

        select.appendChild(option);
    });

    select.disabled = false;
}

function ensureOption(select, value, label = value) {
    if (!select || value === null || value === undefined || value === "") {
        return;
    }

    const exists = [...select.options].some(
        option => String(option.value).toLowerCase() === String(value).toLowerCase()
    );

    if (!exists) {
        const option = document.createElement("option");

        option.value = value;
        option.textContent = label || value;
        option.dataset.legacy = "true";

        select.appendChild(option);
    }
}

function clearDependentFields(model, year, body, fuel, trans, drive) {
    setOptions(model, [], "Select model");
    setOptions(year, [], "Select model first");
    setOptions(body, [], "Select model first");
    setOptions(fuel, [], "Select model first");
    setOptions(trans, [], "Select model first");
    setOptions(drive, [], "Select model first");

    model.disabled = true;
    year.disabled = true;
    body.disabled = true;
    fuel.disabled = true;
    trans.disabled = true;
    drive.disabled = true;
}

export async function initVehicleCatalogue({
    makeId,
    modelId,
    yearId,
    bodyId,
    fuelId,
    transId,
    driveId
}) {
    const rows = await getCatalog();

    const make = $(makeId);
    const model = $(modelId);
    const year = $(yearId);
    const body = $(bodyId);
    const fuel = $(fuelId);
    const trans = $(transId);
    const drive = $(driveId);

    if (!make || !model || !year || !body || !fuel || !trans || !drive) {
        throw new Error("Vehicle catalogue fields are missing from the page.");
    }

    setOptions(
        make,
        rows.map(row => row.make),
        "Select make"
    );

    clearDependentFields(
        model,
        year,
        body,
        fuel,
        trans,
        drive
    );

    make.onchange = () => {
        const selectedMake = make.value;

        const matchingRows = rows.filter(
            row => row.make === selectedMake
        );

        setOptions(
            model,
            matchingRows.map(row => row.model),
            selectedMake ? "Select model" : "Select make first"
        );

        setOptions(year, [], "Select model first");
        setOptions(body, [], "Select model first");
        setOptions(fuel, [], "Select model first");
        setOptions(trans, [], "Select model first");
        setOptions(drive, [], "Select model first");

        model.disabled = !selectedMake;
        year.disabled = true;
        body.disabled = true;
        fuel.disabled = true;
        trans.disabled = true;
        drive.disabled = true;
    };

    model.onchange = () => {
        const selectedMake = make.value;
        const selectedModel = model.value;

        const matchingRows = rows.filter(
            row =>
                row.make === selectedMake &&
                row.model === selectedModel
        );

        setOptions(
            year,
            matchingRows.flatMap(row => row.years),
            "Select year"
        );

        setOptions(
            body,
            matchingRows.flatMap(row => row.body_types),
            "Select body type"
        );

        setOptions(
            fuel,
            matchingRows.flatMap(row => row.fuel_types),
            "Select fuel type"
        );

        setOptions(
            trans,
            matchingRows.flatMap(row => row.transmissions),
            "Select transmission"
        );

        setOptions(
            drive,
            matchingRows.flatMap(row => row.drive_types),
            "Select drive type"
        );

        year.disabled = !selectedModel;
        body.disabled = !selectedModel;
        fuel.disabled = !selectedModel;
        trans.disabled = !selectedModel;
        drive.disabled = !selectedModel;
    };

    function getModelRecord() {
        return rows.find(
            row =>
                row.make === make.value &&
                row.model === model.value
        );
    }

    function validate() {
        if (!make.value) {
            return "Please select a make.";
        }

        if (!model.value) {
            return "Please select a model.";
        }

        const record = getModelRecord();

        if (!record) {
            return "Please select a valid make and model from the vehicle catalogue.";
        }

        if (
            year.value &&
            record.years.length &&
            !record.years.includes(Number(year.value))
        ) {
            return "Selected year is not valid for this model.";
        }

        if (
            body.value &&
            record.body_types.length &&
            !record.body_types.includes(body.value)
        ) {
            return "Selected body type is not valid for this model.";
        }

        if (
            fuel.value &&
            record.fuel_types.length &&
            !record.fuel_types.includes(fuel.value)
        ) {
            return "Selected fuel type is not valid for this model.";
        }

        if (
            trans.value &&
            record.transmissions.length &&
            !record.transmissions.includes(trans.value)
        ) {
            return "Selected transmission is not valid for this model.";
        }

        if (
            drive.value &&
            record.drive_types.length &&
            !record.drive_types.includes(drive.value)
        ) {
            return "Selected drive type is not valid for this model.";
        }

        return null;
    }

    function setVehicleValues(values = {}) {
        const selectedMake = values.make || "";
        const selectedModel = values.model || "";

        if (selectedMake) {
            ensureOption(make, selectedMake);
            make.value = selectedMake;
        }

        make.dispatchEvent(new Event("change"));

        if (selectedModel) {
            ensureOption(model, selectedModel);
            model.value = selectedModel;
        }

        model.dispatchEvent(new Event("change"));

        const dependentFields = [
            ["year", values.year],
            ["body_type", values.body_type],
            ["fuel_type", values.fuel_type],
            ["transmission", values.transmission],
            ["drive_type", values.drive_type]
        ];

        dependentFields.forEach(([id, value]) => {
            if (value !== null && value !== undefined && value !== "") {
                const select = $(id);

                ensureOption(select, value);
                select.value = String(value);
            }
        });
    }

    return {
        rows,
        validate,
        setVehicleValues,
        getModelRecord
    };
}