/* =====================================================================
   car-schema.js
   Single source of truth for every editable column on `public.cars`.

   Every admin page (add, edit, sellcars, tradeins, agents) imports this
   file, so one vehicle field list is used everywhere. Add a column here
   once and it becomes editable on all pages.
   ===================================================================== */

/* Each field: { k: column, l: label, t: type, full?: spans grid, opts?: [] } */
export const CAR_SECTIONS = [
    {
        title: "Identity",
        fields: [
            { k: "make",                l: "Make",                  t: "text" },
            { k: "model",               l: "Model",                 t: "text" },
            { k: "trim",                l: "Trim / Grade",          t: "text" },
            { k: "year",                l: "Year of Manufacture",   t: "number", min: "1900", max: "2100" },
            { k: "body_type",           l: "Body Type",             t: "text" },
            { k: "condition",           l: "Condition",             t: "text" }
        ]
    },
    {
        title: "Pricing & Status",
        fields: [
            { k: "price",               l: "Selling Price",         t: "number" },
            { k: "purchase_price",      l: "Purchase Price",        t: "number" },
            { k: "currency",            l: "Currency",              t: "select", opts: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"] },
            { k: "status",              l: "Status",                t: "select", opts: ["available", "reserved", "sold"] },
            { k: "negotiable",          l: "Negotiable",            t: "checkbox" },
            { k: "financing_available", l: "Financing Available",   t: "checkbox" },
            { k: "test_drive_available",l: "Test Drive Available",  t: "checkbox" },
            { k: "featured",            l: "Featured",              t: "checkbox" }
        ]
    },
    {
        title: "Mechanical",
        fields: [
            { k: "engine_size",         l: "Engine Size (L)",       t: "number", step: "0.1" },
            { k: "engine_description",  l: "Engine Description",    t: "text", full: true },
            { k: "horsepower",          l: "Horsepower",            t: "number" },
            { k: "fuel_type",           l: "Fuel Type",             t: "text" },
            { k: "transmission",        l: "Transmission",          t: "text" },
            { k: "drive_type",          l: "Drive Type",            t: "text" },
            { k: "mileage",             l: "Mileage",               t: "number" },
            { k: "mileage_unit",        l: "Mileage Unit",          t: "select", opts: ["km", "mi"] }
        ]
    },
    {
        title: "Body & Cabin",
        fields: [
            { k: "exterior_color",      l: "Exterior Colour",       t: "text" },
            { k: "interior_color",      l: "Interior Colour",       t: "text" },
            { k: "seats",               l: "Seats",                 t: "number" },
            { k: "doors",               l: "Doors",                 t: "number" }
        ]
    },
    {
        title: "Identification",
        fields: [
            { k: "vin",                 l: "VIN",                   t: "text" },
            { k: "chassis_number",      l: "Chassis Number",        t: "text" },
            { k: "registration_number", l: "Registration Number",   t: "text" },
            { k: "stock_number",        l: "Stock Number",          t: "text" }
        ]
    },
    {
        title: "Import & History",
        fields: [
            { k: "country_of_origin",   l: "Country of Origin",     t: "text" },
            { k: "import_year",         l: "Import Year",           t: "number", min: "1900", max: "2100" },
            { k: "registration_year",   l: "Registration Year",     t: "number", min: "1900", max: "2100" },
            { k: "auction_grade",       l: "Auction Grade",         t: "text" },
            { k: "previous_owners",     l: "Previous Owners",       t: "number" },
            { k: "number_of_keys",      l: "Number of Keys",        t: "number" },
            { k: "accident_history",    l: "Accident History",      t: "text", full: true },
            { k: "service_history",     l: "Service History",       t: "text", full: true }
        ]
    },
    {
        title: "Inspection",
        fields: [
            { k: "inspection_status",   l: "Inspection Status",     t: "text" },
            { k: "inspection_notes",    l: "Inspection Notes",      t: "textarea", full: true }
        ]
    },
    {
        title: "Location",
        fields: [
            { k: "location",            l: "Location",              t: "text" },
            { k: "city",                l: "City / Town",           t: "text" },
            { k: "county",              l: "County",                t: "text" },
            { k: "showroom_name",       l: "Showroom / Yard",       t: "text" },
            { k: "latitude",            l: "Latitude",              t: "number", step: "any" },
            { k: "longitude",           l: "Longitude",             t: "number", step: "any" }
        ]
    },
    {
        title: "Listing Content",
        fields: [
            { k: "key_features",        l: "Key Features",          t: "textarea", full: true },
            { k: "description",         l: "Description",           t: "textarea", full: true },
            { k: "model_3d_url",        l: "3D Model URL",          t: "text", full: true }
        ]
    },
    {
        title: "Sourcing",
        fields: [
            { k: "agent_name",          l: "Agent Name",            t: "text" },
            { k: "agent_email",         l: "Agent Email",           t: "text" }
        ]
    }
];

/* Flat list of every editable field. */
export const CAR_FIELDS = CAR_SECTIONS.flatMap(section => section.fields);

/* Column name lookups. */
export const CAR_FIELD_KEYS = CAR_FIELDS.map(f => f.k);

export const NUMERIC_FIELDS = new Set(
    CAR_FIELDS.filter(f => f.t === "number").map(f => f.k)
);

export const BOOLEAN_FIELDS = new Set(
    CAR_FIELDS.filter(f => f.t === "checkbox").map(f => f.k)
);

export const STATUS_OPTIONS = ["available", "reserved", "sold"];

/* Catalogue-driven selects. These are the only fields the vehicle
   catalogue cascade controls; everything else is free text. */
export const CATALOG_FIELDS = ["make", "model", "year", "body_type", "fuel_type", "transmission", "drive_type"];

export const MIN_VEHICLE_YEAR = 1980;
export const MAX_VEHICLE_YEAR = new Date().getFullYear() + 1;

export function fieldDef(key) {
    return CAR_FIELDS.find(f => f.k === key) || null;
}

/* Coerce a raw input string into the right type for Supabase. */
export function coerceValue(key, raw) {
    if (BOOLEAN_FIELDS.has(key)) return !!raw;

    const value = typeof raw === "string" ? raw.trim() : raw;

    if (value === "" || value === null || value === undefined) return null;

    if (NUMERIC_FIELDS.has(key)) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    return String(value);
}

/* Build a full `cars` update payload from a container of inputs.
   `prefix` is the id prefix used by the page, e.g. "ed_" or "ef_". */
export function collectCarUpdates(root = document, prefix = "") {
    const updates = {};

    CAR_FIELDS.forEach(f => {
        const el = root.querySelector(`#${prefix}${f.k}`) || root.querySelector(`[data-car-key="${f.k}"]`);
        if (!el) return;

        updates[f.k] = f.t === "checkbox"
            ? !!el.checked
            : coerceValue(f.k, el.value);
    });

    return updates;
}

export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
}

/* Renders the whole editable field set as HTML. Used by the request
   pages (sellcars / tradeins / agents) so their modal editors expose
   exactly the same fields as the main inventory editor. */
export function renderCarFields(values = {}, { prefix = "ed_", disabled = false } = {}) {
    return CAR_SECTIONS.map(section => `
        <div class="editor-section">
            <h4 class="editor-section-title">${escapeHtml(section.title)}</h4>
            <div class="editor-grid">
                ${section.fields.map(f => {
                    const id = `${prefix}${f.k}`;
                    const v = values[f.k];
                    const off = disabled ? " disabled" : "";
                    let input;

                    if (f.t === "checkbox") {
                        input = `<label class="editor-check"><input id="${id}" data-car-key="${f.k}" type="checkbox"${v ? " checked" : ""}${off}> <span>${escapeHtml(f.l)}</span></label>`;
                        return `<div class="editor-field">${input}</div>`;
                    }

                    if (f.t === "textarea") {
                        input = `<textarea id="${id}" data-car-key="${f.k}" rows="3"${off}>${escapeHtml(v ?? "")}</textarea>`;
                    } else if (f.t === "select") {
                        const opts = f.opts || [];
                        const known = opts.some(o => String(o) === String(v ?? ""));
                        input = `<select id="${id}" data-car-key="${f.k}"${off}>
                            <option value="">Select</option>
                            ${(!known && v ? [String(v)] : []).concat(opts).map(o =>
                                `<option value="${escapeHtml(o)}"${String(v ?? "") === String(o) ? " selected" : ""}>${escapeHtml(o)}</option>`
                            ).join("")}
                        </select>`;
                    } else {
                        input = `<input id="${id}" data-car-key="${f.k}" type="${escapeHtml(f.t)}"${f.step ? ` step="${escapeHtml(f.step)}"` : ""}${f.min ? ` min="${escapeHtml(f.min)}"` : ""}${f.max ? ` max="${escapeHtml(f.max)}"` : ""} value="${escapeHtml(v ?? "")}"${off}>`;
                    }

                    return `<div class="editor-field${f.full ? " full" : ""}">
                        <label for="${id}">${escapeHtml(f.l)}</label>
                        ${input}
                    </div>`;
                }).join("")}
            </div>
        </div>
    `).join("");
}