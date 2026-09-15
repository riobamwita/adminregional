/* =====================================================================
   db-safe.js  —  NEW FILE

   The error you hit —

     Could not find the 'admin_id' column of 'agent_vehicle_actions'
     in the schema cache

   — is PostgREST (Supabase's API layer) saying one of two things:
     1. that column genuinely does not exist on the table yet, or
     2. it was just added and the API's schema cache hasn't picked it
        up (Supabase Dashboard → Settings → API → "Reload schema", or
        it refreshes on its own after a short while).

   Either way, the write as sent cannot succeed. These two helpers make
   writes to tables that tend to evolve (agent_vehicle_actions,
   agent_vehicle_submissions) resilient to that: on a missing-column
   error they drop exactly that column and retry, looping until the
   write succeeds or there's nothing left to drop. Every drop is logged
   so it's visible in devtools — this papers over the mismatch, it does
   not fix it. Treat a console warning from here as a to-do: add the
   column (see the bottom of this file for the one this project needs).

   Deliberately narrow: only a column PostgREST explicitly says it
   cannot find gets stripped. Any other error — a check constraint, a
   permissions error, a bad value — comes back untouched on the first
   try.
   ===================================================================== */

import { supabase } from "./supabase.js";

const MISSING_COLUMN = /Could not find the '([^']+)' column of '([^']+)'/i;

function extractMissingColumn(error, table) {
    const match = MISSING_COLUMN.exec(error?.message || "");
    if (!match || match[2] !== table) return null;
    return match[1];
}

/**
 * Insert a row, dropping any column PostgREST reports missing and
 * retrying, until it succeeds or there's nothing left to drop.
 * Returns { data, error, appliedPayload } — appliedPayload is whatever
 * was actually sent on the attempt that ran (after any drops), so
 * callers can merge it into local state instead of assuming every
 * field they asked to save actually landed.
 */
export async function insertSafe(table, payload, { select, maxAttempts = 6 } = {}) {
    let body = { ...payload };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let query = supabase.from(table).insert(body);
        if (select) query = query.select(select);

        const { data, error } = await query;
        if (!error) return { data, error: null, appliedPayload: body };

        const missing = extractMissingColumn(error, table);
        if (!missing || !(missing in body)) return { data: null, error, appliedPayload: body };

        console.warn(`${table}: column "${missing}" not found in schema cache — dropping it and retrying.`);
        delete body[missing];
    }

    return {
        data: null,
        error: new Error(`Unable to insert into ${table} after removing unknown columns.`),
        appliedPayload: body
    };
}

/**
 * Update rows matching `match` (column: value pairs, ANDed together),
 * dropping any column PostgREST reports missing and retrying.
 * Returns { data, error, appliedPayload }.
 */
export async function updateSafe(table, match, payload, { maxAttempts = 6 } = {}) {
    let body = { ...payload };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { data, error } = await supabase.from(table).update(body).match(match);
        if (!error) return { data, error: null, appliedPayload: body };

        const missing = extractMissingColumn(error, table);
        if (!missing || !(missing in body)) return { data: null, error, appliedPayload: body };

        console.warn(`${table}: column "${missing}" not found in schema cache — dropping it and retrying.`);
        delete body[missing];
    }

    return {
        data: null,
        error: new Error(`Unable to update ${table} after removing unknown columns.`),
        appliedPayload: body
    };
}

/* ---------------------------------------------------------------------
   The actual fix for the error in your screenshot: run this once in the
   Supabase SQL editor so admin_id is a real column instead of something
   these helpers have to quietly drop on every "Send Back to Agent":

     alter table agent_vehicle_actions
       add column if not exists admin_id uuid references admin_users(id);

   If the column already exists and you still see the error, it's the
   stale-cache case — Dashboard → Settings → API → "Reload schema", or
   just wait a minute and try again.
   --------------------------------------------------------------------- */