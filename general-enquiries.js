/* ============================================================
   REGIONAL AUTOSELECTIONS LTD — GENERAL ENQUIRIES
   Admin inbox for the website enquiry form (table: enquiries)
   Replies are written to enquiry_responses.
   ============================================================ */

import { supabase }       from "./supabase.js";
import { requireAdmin }   from "./admin-guard.js";
import { markSectionSeen } from "./badges.js";
import { attachBadges }   from "./admin-nav.js";

/* ---------- Config ---------- */
const BRAND      = "Regional Autoselections Ltd";
const SIGNATURE  = `\n\nRegards,\n${BRAND}`;
const SECTION    = "general_enquiries";   // badge / notification key
const PERMISSION = "enquiries";           // reuses the existing Enquiries permission

const QUICK_REPLIES = [
  { label: "Acknowledge",   text: "Hi {first}, thank you for getting in touch with Regional Autoselections. We have received your enquiry and a member of our sales team is looking into it now." },
  { label: "Ask for detail", text: "Hi {first}, thank you for your enquiry. So we can help properly, could you share your budget range, preferred make and model, and when you would like to have the vehicle?" },
  { label: "Options ready",  text: "Hi {first}, we have a few vehicles that match what you asked for. May I share the details and photos here, or would you prefer to visit the yard and see them in person?" },
  { label: "Book a visit",   text: "Hi {first}, we would be glad to host you at our yard. Which day and time this week works for you?" },
  { label: "Follow up",      text: "Hi {first}, following up on your enquiry with us. Are you still looking, and is there anything you would like us to source for you?" }
];

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);

const esc = v => String(v ?? "").replace(/[&<>"']/g, m =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

const fmt = v => v
  ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })
  : "—";

const ago = v => {
  if (!v) return "—";
  const mins = Math.floor((Date.now() - new Date(v)) / 60000);
  if (mins < 1)    return "just now";
  if (mins < 60)   return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days} day${days === 1 ? "" : "s"} ago` : fmt(v);
};

const firstName = n => String(n || "").trim().split(/\s+/)[0] || "there";
const waDigits  = p => String(p || "").replace(/\D/g, "");

const CHANNEL_ICON = {
  whatsapp: "fa-brands fa-whatsapp",
  email:    "fa-solid fa-envelope",
  phone:    "fa-solid fa-phone",
  sms:      "fa-solid fa-comment-sms",
  internal: "fa-solid fa-lock"
};

let enquiries = [];   // every row, newest first
let responses = {};   // enquiry_id -> [response, ...]
let current   = null; // open enquiry
let me        = null; // admin row from requireAdmin

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, kind = "") {
  const t = $("toast");
  t.querySelector("span").textContent = msg;
  t.className = `enq-toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
}

function fail(msg) {
  $("error").textContent = msg;
  $("error").classList.add("active");
}

/* ---------- Load ---------- */
async function load() {
  $("loading").style.display = "block";
  $("requestsGrid").innerHTML = "";
  $("empty").style.display = "none";
  $("error").classList.remove("active");

  try {
    const [eq, rs] = await Promise.all([
      supabase.from("enquiries").select("*").order("created_at", { ascending: false }),
      supabase.from("enquiry_responses").select("*").order("created_at", { ascending: false })
    ]);

    if (eq.error) throw eq.error;
    enquiries = eq.data || [];

    responses = {};
    if (!rs.error) {
      (rs.data || []).forEach(r => {
        (responses[r.enquiry_id] ||= []).push(r);
      });
    }

    stats();
    buildCategoryFilter();
    render();
  } catch (e) {
    fail(`Could not load enquiries: ${e.message}`);
  } finally {
    $("loading").style.display = "none";
  }
}

const awaitingReply = x =>
  !x.first_response_at && !["closed", "spam", "converted"].includes(x.status);

function stats() {
  $("totalRequests").textContent     = enquiries.length;
  $("awaitingRequests").textContent  = enquiries.filter(awaitingReply).length;
  $("newRequests").textContent       = enquiries.filter(x => x.status === "new").length;
  $("contactedRequests").textContent = enquiries.filter(x => x.status === "contacted").length;
  $("convertedRequests").textContent = enquiries.filter(x => x.status === "converted").length;
}

function buildCategoryFilter() {
  const sel  = $("categoryFilter");
  const keep = sel.value || "all";
  const cats = [...new Set(enquiries.map(x => x.category).filter(Boolean))].sort();
  sel.innerHTML = `<option value="all">All Categories</option>` +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = cats.includes(keep) ? keep : "all";
}

/* ---------- Render list ---------- */
function render() {
  const q   = $("searchInput").value.toLowerCase().trim();
  const st  = $("statusFilter").value;
  const cat = $("categoryFilter").value;
  const ord = $("sortFilter").value;

  const list = enquiries.filter(x => {
    const hay = `${x.full_name || ""} ${x.phone || ""} ${x.email || ""} ${x.lead_ref || ""} ${x.category || ""} ${x.message || ""}`.toLowerCase();
    return hay.includes(q)
      && (st === "all" || x.status === st)
      && (cat === "all" || x.category === cat);
  });

  list.sort((a, b) => {
    if (ord === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (ord === "awaiting") {
      const d = Number(awaitingReply(b)) - Number(awaitingReply(a));
      if (d) return d;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (!list.length) {
    $("requestsGrid").innerHTML = "";
    $("empty").style.display = "block";
    return;
  }
  $("empty").style.display = "none";

  $("requestsGrid").innerHTML = list.map(x => {
    const waiting = awaitingReply(x);
    const count   = x.response_count || 0;
    return `
<article class="request-card" data-id="${x.id}" onclick="openRequest('${x.id}')"><div class="request-top"><span class="request-status ${esc(x.status || "new")}">${esc(x.status || "new")}</span><small>${ago(x.created_at)}</small></div><h3>${esc(x.full_name || "Unnamed customer")}</h3><p><i class="fa-solid fa-phone"></i> ${esc(x.phone || "—")}</p><p><i class="fa-solid fa-comment-dots"></i> Prefers ${esc(x.preferred_contact || "whatsapp")}</p><div class="request-meta"><span>${esc(x.category || "General Enquiry")}</span><strong>${count} repl${count === 1 ? "y" : "ies"}</strong></div><div class="request-bottom"><span class="reply-flag ${waiting ? "waiting" : "answered"}"><i class="fa-solid ${waiting ? "fa-circle-exclamation" : "fa-circle-check"}"></i> ${waiting ? "Awaiting reply" : "Answered"}</span><button type="button">View <i class="fa-solid fa-arrow-right"></i></button></div></article>`;
  }).join("");
}

/* ---------- Detail modal ---------- */
window.openRequest = id => {
  current = enquiries.find(x => x.id === id);
  if (!current) return;
  paint();
  $("requestModal").classList.add("show");
  document.body.classList.add("locked");
  $("requestModal").setAttribute("aria-hidden", "false");
};

function paint() {
  const x = current;
  const status = x.status || "new";

  $("modalRef").textContent = x.lead_ref || "ENQ-—";
  $("modalTitle").textContent = x.full_name || "Customer enquiry";
  $("modalSubtitle").textContent = `${x.category || "General Enquiry"} · received ${fmt(x.created_at)}`;

  $("detailStatusBadge").textContent = status.toUpperCase();
  $("detailStatusBadge").className = `big-status ${status}`;
  $("modalStatus").value = status;

  $("ownerLine").textContent = x.assigned_to
    ? (x.assigned_to === me?.id ? "Assigned to you" : "Assigned to another admin")
    : "Unassigned";

  $("customerDetails").innerHTML = `
    <div><span>Full name</span><strong>${esc(x.full_name || "—")}</strong></div>
    <div><span>Phone</span><strong>${esc(x.phone || "—")}</strong></div>
    <div><span>Email</span><strong>${esc(x.email || "—")}</strong></div>
    <div><span>Prefers</span><strong>${esc(x.preferred_contact || "—")}</strong></div>`;

  const wa = waDigits(x.phone);
  $("contactActions").innerHTML = [
    wa ? `<a class="wa" target="_blank" rel="noopener" href="https://wa.me/${wa}"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : "",
    x.phone ? `<a href="tel:${esc(x.phone)}"><i class="fa-solid fa-phone"></i> Call</a>` : "",
    x.email ? `<a href="mailto:${esc(x.email)}"><i class="fa-solid fa-envelope"></i> Email</a>` : ""
  ].filter(Boolean).join("");

  $("enquiryDetails").innerHTML = `
    <div><span>Reference</span><strong>${esc(x.lead_ref || "—")}</strong></div>
    <div><span>Category</span><strong>${esc(x.category || "—")}</strong></div>
    <div><span>Received</span><strong>${fmt(x.created_at)}</strong></div>
    <div><span>First reply</span><strong>${x.first_response_at ? fmt(x.first_response_at) : "Not yet answered"}</strong></div>`;
  $("enquiryMessage").textContent = x.message || "No message";

  $("sourceDetails").innerHTML = `
    <div><span>Source</span><strong>${esc(x.source || "website")}</strong></div>
    <div><span>Page</span><strong>${esc(x.page_url || "—")}</strong></div>
    <div><span>Referrer</span><strong>${esc(x.referrer || "Direct")}</strong></div>
    <div><span>Campaign</span><strong>${esc([x.utm_source, x.utm_medium, x.utm_campaign].filter(Boolean).join(" / ") || "None")}</strong></div>`;

  $("internalNotes").value = x.notes || "";

  // reply composer defaults to however the customer asked to be reached
  const pref = ["whatsapp", "email", "phone"].includes(x.preferred_contact) ? x.preferred_contact : "whatsapp";
  const radio = document.querySelector(`input[name="replyChannel"][value="${pref}"]`);
  if (radio) radio.checked = true;
  $("replyBody").value = "";
  channelHint();
  paintQuickReplies();
  paintThread();
}

function paintQuickReplies() {
  $("quickReplies").innerHTML = QUICK_REPLIES
    .map((r, i) => `<button type="button" data-quick="${i}">${esc(r.label)}</button>`).join("");
}

function paintThread() {
  const list = responses[current.id] || [];
  if (!list.length) {
    $("thread").innerHTML = `<div class="thread-empty">No replies logged yet. Send one below and it will show up here.</div>`;
    return;
  }
  $("thread").innerHTML = list.map(r => `
<div class="thread-item ${esc(r.channel)}">
  <div class="thread-top">
    <strong><i class="${CHANNEL_ICON[r.channel] || "fa-solid fa-comment"}"></i> ${esc(r.channel === "internal" ? "Internal note" : r.channel)}</strong>
    <small>${fmt(r.created_at)}</small>
  </div>
  <p>${esc(r.body)}</p>
  <div class="by">${esc(r.admin_email || "Admin")}</div>
</div>`).join("");
}

function closeRequest() {
  $("requestModal").classList.remove("show");
  $("requestModal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("locked");
  current = null;
}

/* ---------- Reply composer ---------- */
const channel = () => document.querySelector('input[name="replyChannel"]:checked').value;

function channelHint() {
  const c = channel();
  $("replyHint").textContent = {
    whatsapp: "WhatsApp opens with this message ready to send, then the reply is saved to the thread.",
    email:    "Your mail app opens with the message ready to send, then the reply is saved to the thread.",
    phone:    "Write what you agreed on the call. Nothing is sent — the note is saved to the thread.",
    internal: "Only the team sees this. It does not count as a reply to the customer."
  }[c];
  $("sendReply").style.display = (c === "phone" || c === "internal") ? "none" : "";
}

function applyQuick(i) {
  const tpl = QUICK_REPLIES[i];
  if (!tpl || !current) return;
  $("replyBody").value = tpl.text.replace("{first}", firstName(current.full_name));
  $("replyBody").focus();
}

function openChannel(body) {
  const c = channel();
  if (c === "whatsapp") {
    const wa = waDigits(current.phone);
    if (!wa) { toast("This customer has no usable phone number.", "bad"); return false; }
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(body + SIGNATURE)}`, "_blank");
    return true;
  }
  if (c === "email") {
    if (!current.email) { toast("This customer did not leave an email address.", "bad"); return false; }
    const subject = `Your enquiry with ${BRAND} — ${current.lead_ref || ""}`.trim();
    window.location.href =
      `mailto:${encodeURIComponent(current.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + SIGNATURE)}`;
    return true;
  }
  return true;
}

async function reply(alsoOpen) {
  if (!current) return;
  const body = $("replyBody").value.trim();
  if (body.length < 2) { toast("Write the reply first.", "bad"); return; }

  const c = channel();
  if (alsoOpen && !openChannel(body)) return;

  const btns = [$("sendReply"), $("logReply")];
  btns.forEach(b => b.disabled = true);

  try {
    const { error } = await supabase.from("enquiry_responses").insert({
      enquiry_id: current.id,
      admin_id: me?.id || null,
      admin_email: me?.email || null,
      channel: c,
      body
    });
    if (error) throw error;

    $("replyBody").value = "";
    toast(c === "internal" ? "Note saved." : "Reply logged.", "ok");
    await refreshOne(current.id);
  } catch (e) {
    toast(`Could not save that reply: ${e.message}`, "bad");
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

/* ---------- Row actions ---------- */
async function refreshOne(id) {
  const [eq, rs] = await Promise.all([
    supabase.from("enquiries").select("*").eq("id", id).maybeSingle(),
    supabase.from("enquiry_responses").select("*").eq("enquiry_id", id).order("created_at", { ascending: false })
  ]);
  if (eq.data) {
    const i = enquiries.findIndex(x => x.id === id);
    if (i > -1) enquiries[i] = eq.data; else enquiries.unshift(eq.data);
    if (current?.id === id) current = eq.data;
  }
  if (!rs.error) responses[id] = rs.data || [];
  stats();
  render();
  if (current?.id === id) paint();
}

async function saveStatus() {
  if (!current) return;
  const status = $("modalStatus").value;
  const { error } = await supabase.from("enquiries").update({ status }).eq("id", current.id);
  if (error) return toast(`Status not saved: ${error.message}`, "bad");
  toast(`Marked as ${status}.`, "ok");
  refreshOne(current.id);
}

async function assignMe() {
  if (!current || !me) return;
  const { error } = await supabase.from("enquiries").update({ assigned_to: me.id }).eq("id", current.id);
  if (error) return toast(`Could not assign: ${error.message}`, "bad");
  toast("Assigned to you.", "ok");
  refreshOne(current.id);
}

async function saveNotes() {
  if (!current) return;
  const notes = $("internalNotes").value.trim() || null;
  const { error } = await supabase.from("enquiries").update({ notes }).eq("id", current.id);
  if (error) return toast(`Notes not saved: ${error.message}`, "bad");
  toast("Notes saved.", "ok");
  refreshOne(current.id);
}

async function deleteRequest() {
  if (!current) return;
  if (!confirm(`Delete the enquiry from ${current.full_name || "this customer"} and its replies?`)) return;
  const { error } = await supabase.from("enquiries").delete().eq("id", current.id);
  if (error) return toast(`Could not delete: ${error.message}`, "bad");
  const id = current.id;
  closeRequest();
  enquiries = enquiries.filter(x => x.id !== id);
  delete responses[id];
  stats();
  render();
  toast("Enquiry deleted.", "ok");
}

/* ---------- Live updates ---------- */
function listen() {
  supabase.channel("admin-enquiries")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "enquiries" }, payload => {
      enquiries.unshift(payload.new);
      stats();
      buildCategoryFilter();
      render();
      attachBadges();
      toast(`New enquiry from ${payload.new.full_name || "a customer"}.`, "ok");
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "enquiries" }, payload => {
      const i = enquiries.findIndex(x => x.id === payload.new.id);
      if (i > -1) enquiries[i] = payload.new;
      if (current?.id === payload.new.id) { current = payload.new; paint(); }
      stats();
      render();
    })
    .subscribe(status => {
      $("liveDot").classList.toggle("on", status === "SUBSCRIBED");
    });
}

/* ---------- Wiring ---------- */
$("searchInput").oninput   = render;
$("statusFilter").onchange = render;
$("categoryFilter").onchange = render;
$("sortFilter").onchange   = render;
$("refreshBtn").onclick    = load;

$("saveStatus").onclick    = saveStatus;
$("assignMe").onclick      = assignMe;
$("saveNotes").onclick     = saveNotes;
$("deleteRequest").onclick = deleteRequest;
$("sendReply").onclick     = () => reply(true);
$("logReply").onclick      = () => reply(false);

$("replyChannels").addEventListener("change", channelHint);
$("quickReplies").addEventListener("click", e => {
  const b = e.target.closest("[data-quick]");
  if (b) applyQuick(Number(b.dataset.quick));
});

$("closeRequest").onclick   = closeRequest;
$("closeRequestBg").onclick = closeRequest;
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("requestModal").classList.contains("show")) closeRequest();
});

$("menu").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show") };
$("closeMenu").onclick = $("overlay").onclick = () => { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show") };
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); location.replace("auth.html") };

window.addEventListener("load", () => setTimeout(() => $("loader")?.classList.add("hide"), 450));

requireAdmin(PERMISSION).then(admin => {
  if (!admin) return;
  me = admin;
  load().then(() => { markSectionSeen(SECTION); attachBadges(); listen() });
});