/* =====================================================================
   form-progress.js  —  NEW FILE

   Drives the completion pill shown in the navbar, opposite "Back to
   Listings". Shared by add.js and edit.js so the two pages can never
   drift apart on how "percent complete" is worked out.

   Rules:
   - Every CAR_FIELDS entry that has a matching input on the page
     counts, except:
       - boolean fields (checkboxes always have a value one way or the
         other, so there's no meaningful "incomplete" state to show)
       - description / engine_description — these are derived from the
         other fields by generateVehicleText() in add.js/edit.js. Left
         in, they'd double-count information already tracked via the
         fields that feed them, and on add.html the description starts
         non-empty anyway (its own "This vehicle." fallback text), which
         would read as "filled" before anything is actually entered.
   - The display image counts as one further completable item, since a
     listing without one isn't really presentable.
   - Recomputes automatically on every input/change inside the form.
     Programmatic value changes — the vehicle catalogue populating a
     dropdown, the display image being cleared via its button, a saved
     vehicle's fields being restored on edit.html — don't fire those
     events, so callers should invoke the returned function directly
     right after any change like that.
   ===================================================================== */

import { CAR_FIELDS, BOOLEAN_FIELDS } from "./car-schema.js";

const DERIVED_FIELDS = new Set(["description", "engine_description"]);

export function initFormProgress(form) {
    const pill = document.getElementById("formProgress");
    const ring = document.getElementById("formProgressRingFill");
    const label = document.getElementById("formProgressLabel");

    /* Safe drop-in: if the markup hasn't been added to this page yet,
       do nothing rather than throw. */
    if (!form || !pill || !ring || !label) {
        return () => {};
    }

    const radius = Number(ring.getAttribute("r")) || 0;
    const circumference = 2 * Math.PI * radius;
    ring.style.strokeDasharray = `${circumference}`;

    const trackedFields = CAR_FIELDS.filter(field =>
        !BOOLEAN_FIELDS.has(field.k) &&
        !DERIVED_FIELDS.has(field.k) &&
        document.getElementById(field.k)
    );

    function update() {
        const total = trackedFields.length + 1; /* +1 for the display image */

        let filled = trackedFields.reduce((count, field) => {
            const value = document.getElementById(field.k)?.value?.trim();
            return value ? count + 1 : count;
        }, 0);

        if (document.getElementById("displayPreview")?.classList.contains("active")) {
            filled += 1;
        }

        const percent = total ? Math.round((filled / total) * 100) : 0;

        ring.style.strokeDashoffset = `${circumference * (1 - percent / 100)}`;
        label.textContent = `${percent}%`;
        pill.dataset.complete = String(percent === 100);
        pill.setAttribute("aria-label", `Form ${percent}% complete`);

        return percent;
    }

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();

    return update;
}