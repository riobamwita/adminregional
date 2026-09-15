/* =====================================================================
   income-sources.js  —  NEW FILE

   One place that answers: which vehicles came into inventory through a
   Sell Your Car or a Trade-In request, what were we expecting to make
   on them, and has that money actually come in yet?

   Both request tables store the same two numbers at approval time:

     negotiated_price  what we agreed to pay the customer
     inventory_price   what we intended to sell the vehicle for

   Those are the expected figures, written by sellcars.js and
   tradeins.js. The money only counts as received once the linked row in
   `cars` reads status = "sold" — at which point the vehicle's own
   `price` is what actually came in, which may differ from what was
   expected at approval.

   statistics.js reads all of this through here. Nothing else should
   hand-roll the mapping between the two request tables.
   ===================================================================== */

import { supabase } from "./supabase.js";

const SELL_COLUMNS = [
    "id",
    "full_name",
    "make",
    "model",
    "year",
    "registration",
    "negotiated_price",
    "inventory_price",
    "approved_car_id",
    "approved_at"
].join(",");

const TRADE_COLUMNS = [
    "id",
    "full_name",
    "vehicle_make",
    "vehicle_model",
    "vehicle_year",
    "registration",
    "negotiated_price",
    "inventory_price",
    "approved_car_id",
    "approved_at"
].join(",");

const num = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const has = v => v !== null && v !== undefined && v !== "";

/* Both tables, only the rows that actually reached inventory, in one
   round trip. Normalised into a single shape so nothing downstream has
   to care which table a row came from. */
export async function fetchSourcedRequests() {
    const [sell, trade] = await Promise.all([
        supabase
            .from("sell_car_requests")
            .select(SELL_COLUMNS)
            .not("approved_car_id", "is", null),
        supabase
            .from("tradein_requests")
            .select(TRADE_COLUMNS)
            .not("approved_car_id", "is", null)
    ]);

    if (sell.error) throw sell.error;
    if (trade.error) throw trade.error;

    const common = (row, source, make, model, year) => ({
        source,
        request_id: row.id,
        customer: row.full_name || "Customer",
        make: make || "",
        model: model || "",
        year: year || "",
        registration: row.registration || "",
        negotiated_price: row.negotiated_price,
        inventory_price: row.inventory_price,
        approved_car_id: row.approved_car_id,
        approved_at: row.approved_at
    });

    return [
        ...(sell.data || []).map(r =>
            common(r, "sell_in", r.make, r.model, r.year)
        ),
        ...(trade.data || []).map(r =>
            common(r, "trade_in", r.vehicle_make, r.vehicle_model, r.vehicle_year)
        )
    ];
}

/*
  Joins the normalised requests to the cars already loaded by the page,
  so no extra query is needed.

  A record is in one of three states:
    pending   the vehicle is in inventory, unsold — income still expected
    received  the vehicle is sold — the money is in
    missing   the linked car row no longer exists, so neither the
              expected nor the received figure can be trusted; these are
              shown but left out of every total.
*/
export function buildIncomeSources(requests, cars) {
    const carsById = new Map(
        (cars || []).map(c => [String(c.id), c])
    );

    const records = (requests || [])
        .filter(r => r.approved_car_id)
        .map(r => {
            const car = carsById.get(String(r.approved_car_id)) || null;
            const missing = !car;
            const sold = !missing && car.status === "sold";

            /* The request holds the agreed numbers. The car row is the
               fallback for older rows approved before those fields were
               being written. */
            const cost = has(r.negotiated_price)
                ? num(r.negotiated_price)
                : num(car?.purchase_price);

            const expected = has(r.inventory_price)
                ? num(r.inventory_price)
                : num(car?.price);

            /* What actually came in is the vehicle's price at the time
               it was marked sold — the listing price may have been
               negotiated down from the figure set at approval. */
            const received = sold ? num(car.price) : 0;

            /* `sold_at` is the honest answer and is used when the column
               exists. Without it the best available stamp is when the
               vehicle record last changed, which is usually the sale but
               moves again on any later edit. */
            const receivedAt = sold
                ? (car.sold_at || car.updated_at || car.created_at || null)
                : null;

            return {
                id: `${r.source}-${r.request_id}`,
                source: r.source,
                request_id: r.request_id,
                car_id: r.approved_car_id,
                customer: r.customer,
                registration: r.registration,
                vehicle:
                    [r.make, r.model, r.year].filter(Boolean).join(" ").trim() ||
                    [car?.make, car?.model, car?.year].filter(Boolean).join(" ").trim() ||
                    "Unnamed Vehicle",
                approved_at: r.approved_at,
                missing,
                sold,
                cost,
                expected,
                expectedProfit: expected - cost,
                received,
                receivedAt,
                realisedProfit: sold ? received - cost : 0,
                variance: sold ? received - expected : 0
            };
        });

    /* Awaiting sale first — those are the ones that still need chasing —
       then received newest first, then anything broken. */
    const rank = r => (r.missing ? 2 : r.sold ? 1 : 0);
    const stamp = r =>
        new Date(r.receivedAt || r.approved_at || 0).getTime() || 0;

    return records.sort(
        (a, b) => rank(a) - rank(b) || stamp(b) - stamp(a)
    );
}

export function summariseIncomeSources(records) {
    const all = records || [];
    const pending = all.filter(r => !r.sold && !r.missing);
    const received = all.filter(r => r.sold);
    const missing = all.filter(r => r.missing);

    const sum = (list, pick) =>
        list.reduce((total, r) => total + num(pick(r)), 0);

    return {
        records: all,
        pending,
        received,
        missing,

        /* Still to come in */
        expectedPending: sum(pending, r => r.expected),
        expectedProfitPending: sum(pending, r => r.expectedProfit),
        capitalInStock: sum(pending, r => r.cost),

        /* Already in */
        receivedTotal: sum(received, r => r.received),
        expectedOnReceived: sum(received, r => r.expected),
        costOfSold: sum(received, r => r.cost),
        realisedProfit: sum(received, r => r.realisedProfit),
        variance: sum(received, r => r.variance)
    };
}