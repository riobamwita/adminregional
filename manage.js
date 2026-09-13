import { supabase } from "./supabase.js";

import { requireAdmin } from "./admin-guard.js";

import { attachBadges } from "./admin-nav.js";


const $ = id => document.getElementById(id);

const fmt = n => new Intl.NumberFormat("en-KE").format(Math.round(n));

const msg = (id, text) => {
  const el = $(id);
  if (!el) return;

  el.textContent = text;
  el.classList.add("active");

  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("active"), 4000);
};

const defaults = {
  facility_fee: 10000,
  min_deposit_pct: 40,
  min_repayment_months: 3,
  max_repayment_months: 36,
  usd_kes_rate: 130
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


/* ==================================================================
   PAGE CONTACTS

   Each card carries:
     data-page     canonical page_key the public page reads
     data-aliases  legacy keys kept in sync on every save
     data-label    wording for the button and toast

   Saving writes the same values to the canonical key and every alias
   in one upsert, so a public page still querying an older key
   resolves the current contact instead of silently falling back to a
   hard-coded number.
================================================================== */

const cardKeys = card => {
  const primary = (card.dataset.page || "").trim();

  const aliases = (card.dataset.aliases || "")
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);

  return [...new Set([primary, ...aliases])].filter(Boolean);
};

const cardLabel = card =>
  (card.dataset.label || card.querySelector("h3")?.textContent || "Contacts").trim();

const cardFields = card => ({
  whatsapp: card.querySelector('[data-field="whatsapp"]'),
  phone: card.querySelector('[data-field="phone"]'),
  email: card.querySelector('[data-field="email"]'),
  address: card.querySelector('[data-field="address"]'),
  hours: card.querySelector('[data-field="hours"]')
});


async function loadContacts() {
  const { data, error } = await supabase
    .from("page_contacts")
    .select("page_key,whatsapp,phone,email,address,hours");

  if (error) {
    msg("error", error.message);
    return false;
  }

  const rows = new Map((data || []).map(row => [row.page_key, row]));

  document.querySelectorAll(".contact-page").forEach(card => {
    const fields = cardFields(card);

    const row = cardKeys(card)
      .map(key => rows.get(key))
      .find(r => r && (r.whatsapp || r.phone || r.email)) || null;

        if (fields.whatsapp) fields.whatsapp.value = row?.whatsapp || "";
    if (fields.phone) fields.phone.value = row?.phone || "";
    if (fields.email) fields.email.value = row?.email || "";
    if (fields.address) fields.address.value = row?.address || "";
    if (fields.hours) fields.hours.value = row?.hours || "";
  });

  return true;
}


/* Returns { rows } on success, or { error } with a human message. */
function contactRows(card) {
  const fields = cardFields(card);
  const label = cardLabel(card);

  const whatsapp = (fields.whatsapp?.value || "").replace(/\D/g, "");
  const phoneRaw = (fields.phone?.value || "").trim();
  const email = (fields.email?.value || "").trim();
  const address = (fields.address?.value || "").trim();
  const hours = (fields.hours?.value || "").trim();

  if (!whatsapp) {
    return { error: `${label}: enter a WhatsApp number.` };
  }

  if (whatsapp.length < 10 || whatsapp.length > 15) {
    return {
      error: `${label}: enter the full WhatsApp number in international format, e.g. 254768888999.`
    };
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    return { error: `${label}: enter a valid email address.` };
  }

  const phone = phoneRaw
    ? phoneRaw.replace(/[^\d+]/g, "")
    : `+${whatsapp}`;

  const updated_at = new Date().toISOString();

  return {
    rows: cardKeys(card).map(page_key => ({
      page_key,
      whatsapp,
      phone,
      email,
      address: fields.address ? address : null,
      hours: fields.hours ? hours : null,
      updated_at
    }))
  };
}


async function saveContact(card) {
  const button = card.querySelector(".save-contact");
  const label = cardLabel(card);

  const built = contactRows(card);

  if (built.error) {
    msg("error", built.error);
    return false;
  }

  const original = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const { error } = await supabase
    .from("page_contacts")
    .upsert(built.rows, { onConflict: "page_key" });

  if (button) {
    button.disabled = false;
    button.innerHTML = original;
  }

  if (error) {
    msg("error", `${label}: ${error.message}`);
    return false;
  }

  /* Reflect the normalised values back into the card. */
  const fields = cardFields(card);
  const saved = built.rows[0];

    if (fields.whatsapp) fields.whatsapp.value = saved.whatsapp;
  if (fields.phone) fields.phone.value = saved.phone;
  if (fields.email) fields.email.value = saved.email;
  if (fields.address) fields.address.value = saved.address || "";
  if (fields.hours) fields.hours.value = saved.hours || "";

  msg("success", `${label} contact updated.`);
  return true;
}


async function saveAllContacts() {
  const cards = [...document.querySelectorAll(".contact-page")];

  const rows = [];

  for (const card of cards) {
    const built = contactRows(card);

    if (built.error) {
      msg("error", built.error);
      return;
    }

    rows.push(...built.rows);
  }

  const button = $("saveAllContacts");
  const original = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const { error } = await supabase
    .from("page_contacts")
    .upsert(rows, { onConflict: "page_key" });

  if (button) {
    button.disabled = false;
    button.innerHTML = original;
  }

  if (error) {
    msg("error", error.message);
    return;
  }

  await loadContacts();

  msg("success", `All ${cards.length} page contacts updated.`);
}


/* ==================================================================
   HIRE PURCHASE SETTINGS
================================================================== */

function hpValues() {
  return {
    facility_fee: Math.max(0, +$("facilityFee").value || 0),

    min_deposit_pct: Math.min(90, Math.max(0, +$("minDepositPct").value || 0)),

    min_repayment_months: Math.max(1, +$("minRepaymentMonths").value || 1),

    max_repayment_months: Math.max(1, +$("maxRepaymentMonths").value || 1),

    usd_kes_rate: Math.max(1, +$("usdKesRate").value || 130)
  };
}


function hpPreview() {
  const v = hpValues();

  const vehicle = 1000000;
  const deposit = vehicle * v.min_deposit_pct / 100;
  const balance = vehicle - deposit;
  const months = Math.max(v.min_repayment_months, 1);
  const principal = balance / months;
  const monthly = principal + v.facility_fee;

  $("previewFee").textContent = `KES ${fmt(v.facility_fee)}`;
  $("previewFee2").textContent = `KES ${fmt(v.facility_fee)}`;

  $("previewDeposit").textContent =
    `${v.min_deposit_pct}% · KES ${fmt(deposit)}`;

  $("previewBalance").textContent = `KES ${fmt(balance)}`;

  if ($("previewPeriod")) {
    $("previewPeriod").textContent =
      `${months} month${months === 1 ? "" : "s"}`;
  }

  $("previewPrincipal").textContent = `KES ${fmt(principal)}`;
  $("previewExampleFee").textContent = `KES ${fmt(v.facility_fee)}`;
  $("previewInstallment").textContent = `KES ${fmt(monthly)}`;
}


function fillSettings(v) {
  $("facilityFee").value = v.facility_fee;
  $("minDepositPct").value = v.min_deposit_pct;
  $("minRepaymentMonths").value = v.min_repayment_months;
  $("maxRepaymentMonths").value = v.max_repayment_months;
  $("usdKesRate").value = v.usd_kes_rate;

  hpPreview();
}


async function loadSettings() {
  const { data, error } = await supabase
    .from("financing_calculator_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    msg("error", error.message);
    return;
  }

  fillSettings(data ? { ...defaults, ...data } : defaults);
}


async function saveSettings() {
  const h = hpValues();

  if (h.max_repayment_months < h.min_repayment_months) {
    msg("error", "Maximum repayment period cannot be below the minimum.");
    return;
  }

  const button = $("saveAllFormula");

  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

  const { error } = await supabase
    .from("financing_calculator_settings")
    .upsert(
      { id: 1, ...h, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );

  button.disabled = false;
  button.innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Save All Calculator Settings';

  if (error) {
    msg("error", error.message);
    return;
  }

  msg("success", "HP calculator updated.");
}


async function resetSettings() {
  fillSettings(defaults);

  const button = $("resetAllFormula");

  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';

  const { error } = await supabase
    .from("financing_calculator_settings")
    .upsert(
      { id: 1, ...defaults, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );

  button.disabled = false;
  button.innerHTML =
    '<i class="fa-solid fa-rotate-left"></i> Reset All Defaults';

  if (error) {
    msg("error", error.message);
    return;
  }

  msg("success", "HP calculator reset to defaults.");
}


/* ==================================================================
   EVENTS
================================================================== */

document.querySelectorAll(".contact-page").forEach(card => {
  card
    .querySelector(".save-contact")
    ?.addEventListener("click", () => saveContact(card));

  card.querySelectorAll("input").forEach(input => {
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveContact(card);
      }
    });
  });
});


$("saveAllContacts")?.addEventListener("click", saveAllContacts);

$("reloadContacts")?.addEventListener("click", async () => {
  const button = $("reloadContacts");
  const original = button.innerHTML;

  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reloading...';

  const ok = await loadContacts();

  button.disabled = false;
  button.innerHTML = original;

  if (ok) msg("success", "Page contacts reloaded from the database.");
});


[
  "facilityFee",
  "minDepositPct",
  "minRepaymentMonths",
  "maxRepaymentMonths",
  "usdKesRate"
].forEach(id => {
  $(id)?.addEventListener("input", hpPreview);
  $(id)?.addEventListener("change", hpPreview);
});


$("saveAllFormula")?.addEventListener("click", saveSettings);

$("resetAllFormula")?.addEventListener("click", resetSettings);


/* ==================================================================
   SHELL
================================================================== */

$("menu")?.addEventListener("click", () => {
  $("sidebar")?.classList.add("open");
  $("overlay")?.classList.add("show");
});

const closeSidebar = () => {
  $("sidebar")?.classList.remove("open");
  $("overlay")?.classList.remove("show");
};

$("closeMenu")?.addEventListener("click", closeSidebar);
$("overlay")?.addEventListener("click", closeSidebar);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeSidebar();
});


$("logoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.replace("auth.html");
});


window.addEventListener("load", () =>
  setTimeout(() => $("loader")?.classList.add("hide"), 400)
);


/* ==================================================================
   INIT
================================================================== */

requireAdmin("webpage").then(async ok => {
  if (!ok) return;

  attachBadges?.().catch(e => console.error("badges", e));

  await loadContacts();
  await loadSettings();
});