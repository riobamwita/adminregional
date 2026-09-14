/* =====================================================================
   tradein-sync.js

   Single source of truth for how a trade-in request maps onto an
   inventory vehicle, and for keeping the two rows in step.

   Used by:
     tradeins.js  - approve to inventory, edit vehicle on the request
     edit.js      - push inventory edits back to the request
     listings.js  - release the request when a vehicle is deleted

   Nothing else should hard-code a tradein -> cars field name.
   ===================================================================== */

import { supabase } from "./supabase.js";

/* tradein_requests column  ->  cars column */
export const TRADEIN_TO_CAR = {
    vehicle_make:  "make",
    vehicle_model: "model",
    vehicle_year:  "year",
    registration:  "registration_number",
    body_type:     "body_type",
    fuel_type:     "fuel_type",
    transmission:  "transmission",
    mileage:       "mileage",
    colour:        "exterior_color",
    condition:     "condition",
    location:      "location"
};

/* cars column -> tradein_requests column */
export const CAR_TO_TRADEIN = Object.fromEntries(
    Object.entries(TRADEIN_TO_CAR).map(([tradeinKey, carKey]) => [carKey, tradeinKey])
);

const NUMERIC_CAR_FIELDS = new Set(["year", "mileage", "price", "purchase_price"]);

const clean = value =>
    value === undefined || value === null || String(value).trim() === ""
        ? null
        : String(value).trim();

function cast(carKey, value) {
    const v = clean(value);
    if (v === null) return null;
    if (NUMERIC_CAR_FIELDS.has(carKey)) {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return v;
}

/* The trade-in form collects a quality word ("good", "fair"); the
   listings filters expect an inventory condition. Recognised values are
   converted, anything else is passed through untouched. */
export function normalizeCondition(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const v = raw.toLowerCase();
    if (v.includes("brand new") || v === "new") return "Brand New";
    if (v.includes("foreign") || v.includes("import")) return "Foreign Used";
    if (v.includes("local") || v.includes("kenya")) return "Local Used";
    if (/^(excellent|very good|good|fair|average|poor|used)$/.test(v)) return "Local Used";
    return raw;
}

/* ---------------- payload builders ---------------- */

/* Build a `cars` patch from a trade-in request.
   `only` limits the patch to a list of trade-in field keys. */
export function carPatchFromTradein(request, only = null) {
    const patch = {};
    if (!request) return patch;

    for (const [tradeinKey, carKey] of Object.entries(TRADEIN_TO_CAR)) {
        if (only && !only.includes(tradeinKey)) continue;
        if (!(tradeinKey in request)) continue;
        patch[carKey] = carKey === "condition"
            ? normalizeCondition(request[tradeinKey])
            : cast(carKey, request[tradeinKey]);
    }

    /* cars carries both location and city */
    if ("location" in request && (!only || only.includes("location"))) {
        patch.city = clean(request.location);
    }

    return patch;
}

/* Build a `tradein_requests` patch from a car row. */
export function tradeinPatchFromCar(car) {
    const patch = {};
    if (!car) return patch;

    for (const [carKey, tradeinKey] of Object.entries(CAR_TO_TRADEIN)) {
        if (!(carKey in car)) continue;
        patch[tradeinKey] = cast(carKey, car[carKey]);
    }

    return patch;
}

/* Full insert payload for a brand new inventory vehicle. */
export function buildCarInsert(request, { buy, sell }) {
    const now = new Date().toISOString();
    return {
        ...carPatchFromTradein(request),
        price: cast("price", sell),
        purchase_price: cast("purchase_price", buy),
        status: "available",
        is_public: true,
        featured: false,
        financing_available: false,
        test_drive_available: true,
        source_request_id: request.id,
        source_type: "trade_in",
        created_at: now,
        updated_at: now
    };
}

/* ---------------- write-through ---------------- */

/* Request edited -> mirror onto the linked vehicle. */
export async function pushTradeinToCar(request, carId, only = null) {
    if (!carId) return { updated: false };

    const patch = carPatchFromTradein(request, only);
    if (!Object.keys(patch).length) return { updated: false };

    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("cars").update(patch).eq("id", carId);
    if (error) throw error;

    return { updated: true, patch };
}

/* Vehicle edited -> mirror back onto the originating request. */
export async function pushCarToTradein(car) {
    if (!car?.source_request_id) return { updated: false };

    const patch = tradeinPatchFromCar(car);
    if (!Object.keys(patch).length) return { updated: false };

    patch.updated_at = new Date().toISOString();

    const { error } = await supabase
        .from("tradein_requests")
        .update(patch)
        .eq("id", car.source_request_id);
    if (error) throw error;

    return { updated: true, patch };
}

/* Vehicle deleted -> release the request so it stops showing as
   "in inventory" while no vehicle exists. */
export async function unlinkCar(carId) {
    if (!carId) return;
    await supabase
        .from("tradein_requests")
        .update({
            approved_car_id: null,
            approved_at: null,
            status: "reviewing",
            updated_at: new Date().toISOString()
        })
        .eq("approved_car_id", carId);
}

/* ---------------- reconciliation ---------------- */

/*
   Repairs the three ways the link can drift:

   1. Request says approved, the vehicle no longer exists  -> unlink.
   2. Vehicle exists for the request, request not linked    -> link.
   3. Vehicle linked by id but never stamped with the
      request id (legacy rows)                             -> stamp it.

   Mutates the request objects in place and returns a Map of the
   requests it changed. Never unlinks on a failed read.
*/
export async function reconcileTradeinLinks(requests) {
    const changed = new Map();
    if (!Array.isArray(requests) || !requests.length) return changed;

    const requestIds = requests.map(r => r.id).filter(Boolean);
    const linkedIds = [...new Set(requests.map(r => r.approved_car_id).filter(Boolean))];

    const [bySource, byId] = await Promise.all([
        requestIds.length
            ? supabase.from("cars").select("id,source_request_id").in("source_request_id", requestIds)
            : Promise.resolve({ data: [], error: null }),
        linkedIds.length
            ? supabase.from("cars").select("id,source_request_id").in("id", linkedIds)
            : Promise.resolve({ data: [], error: null })
    ]);

    if (bySource.error || byId.error) {
        console.warn("Trade-in link check skipped:", bySource.error || byId.error);
        return changed;
    }

    const sourceMap = new Map((bySource.data || []).map(c => [String(c.source_request_id), c]));
    const liveIds = new Set((byId.data || []).map(c => String(c.id)));
    const now = new Date().toISOString();
    const jobs = [];

    for (const request of requests) {
        const found = sourceMap.get(String(request.id));
        const linkAlive = request.approved_car_id && liveIds.has(String(request.approved_car_id));

        if (found && String(found.id) !== String(request.approved_car_id || "")) {
            const patch = { approved_car_id: found.id, status: "approved", updated_at: now };
            if (!request.approved_at) patch.approved_at = now;
            jobs.push([request, patch]);
            continue;
        }

        if (!found && request.approved_car_id && !linkAlive) {
            jobs.push([request, {
                approved_car_id: null,
                approved_at: null,
                status: "reviewing",
                updated_at: now
            }]);
            continue;
        }

        if (!found && linkAlive) {
            await supabase
                .from("cars")
                .update({ source_request_id: request.id, source_type: "trade_in" })
                .eq("id", request.approved_car_id);
        }
    }

    for (const [request, patch] of jobs) {
        const { error } = await supabase.from("tradein_requests").update(patch).eq("id", request.id);
        if (error) {
            console.warn("Trade-in link not repaired:", error.message);
            continue;
        }
        Object.assign(request, patch);
        changed.set(request.id, patch);
    }

    return changed;
}