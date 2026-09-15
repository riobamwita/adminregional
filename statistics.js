import { supabase } from "./supabase.js";
import { requireAdmin } from "./admin-guard.js";
import { attachBadges } from "./admin-nav.js";
import {
  fetchSourcedRequests,
  buildIncomeSources,
  summariseIncomeSources
} from "./income-sources.js";

const $ = id => document.getElementById(id);

/* A vehicle bought through a Sell-In or Trade-In request costs real
   money before it earns any, so once it sells, that purchase price is
   taken off net income.

   If you already record those purchases by hand under the "Vehicle
   Purchase" deduction category, they would be counted twice. Set this to
   false in that case — the expected income panel still tracks
   everything, it just stops applying the cost to net income. The panel
   warns you on screen if it spots both. */
const COUNT_ACQUISITION_IN_NET = true;

let cars = [],
  ground = [],
  deductions = [],
  sourced = [],
  summary = summariseIncomeSources([]),
  sales = [],
  currentAdmin = null,
  dedFilter = "all",
  srcFilter = "all",
  sourcedError = null;

const money = n => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
const date = v => v ? new Date(v).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "—";
const msg = (id, t) => { const el = $(id); if (!el) return; el.textContent = t; el.classList.add("active"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("active"), 3500) };
const fail = e => { console.error(e); msg("error", e?.message || "Something went wrong.") };

const sourceLabel = s => s === "trade_in" ? "Trade-In" : "Sell-In";
const sourceIcon = s => s === "trade_in" ? "fa-right-left" : "fa-car-side";
const sign = n => Number(n || 0) < 0 ? "neg" : "pos";

/* ---------- data shaping ---------- */

function inventoryRecords() {
  /* Vehicles that arrived through a request carry their expected figure
     into the ledger, so a sold row can be read against what it was
     supposed to bring in. */
  const byCar = new Map(sourced.map(r => [String(r.car_id), r]));

  return cars.filter(x => x.status === "sold").map(x => {
    const src = byCar.get(String(x.id)) || null;
    return {
      id: `car-${x.id}`, source: "inventory",
      vehicle: `${x.make || ""} ${x.model || ""} ${x.year || ""}`.trim() || "Unnamed Vehicle",
      amount: Number(x.price || 0),
      /* sold_at when the column exists, otherwise the last change to the
         record — see income-sources.js for why. */
      sale_date: x.sold_at || x.updated_at || x.created_at,
      make: x.make || "", model: x.model || "", year: x.year || "",
      reference: x.stock_number || "", notes: x.location || "", car_id: x.id,
      origin: src?.source || null,
      expected: src ? src.expected : null,
      cost: src ? src.cost : null
    }
  })
}

function buildSales() {
  sales = [...inventoryRecords(), ...ground.map(x => ({ ...x, source: "ground" }))]
    .sort((a, b) => new Date(b.sale_date || b.created_at) - new Date(a.sale_date || a.created_at))
}

const deductionTotal = () => deductions.reduce((s, x) => s + Number(x.amount || 0), 0);

const acquisitionApplied = () => COUNT_ACQUISITION_IN_NET ? summary.costOfSold : 0;

/* ---------- stats ---------- */

function updateStats() {
  const inv = inventoryRecords(),
    all = sales,
    amounts = all.map(x => Number(x.amount || 0)),
    total = amounts.reduce((a, b) => a + b, 0),
    highest = amounts.length ? Math.max(...amounts) : 0,
    lowest = amounts.length ? Math.min(...amounts) : 0,
    dedTotal = deductionTotal(),
    dedAmounts = deductions.map(x => Number(x.amount || 0)),
    acquisition = acquisitionApplied(),
    net = total - dedTotal - acquisition;

  $("totalRevenue").textContent = money(total);
  $("expectedIncome").textContent = money(summary.expectedPending);
  $("receivedIncome").textContent = money(summary.receivedTotal);
  $("totalDeductions").textContent = money(dedTotal);
  $("netIncome").textContent = money(net);
  $("netIncome").classList.toggle("negative", net < 0);
  $("totalSales").textContent = all.length;
  $("inventorySales").textContent = inv.length;
  $("groundSales").textContent = ground.length;
  $("averageSale").textContent = money(all.length ? total / all.length : 0);

  $("availableCount").textContent = cars.filter(x => x.status === "available").length;
  $("reservedCount").textContent = cars.filter(x => x.status === "reserved").length;
  $("soldCount").textContent = inv.length;
  $("inactiveCount").textContent = cars.filter(x => x.status === "inactive").length;

  $("highestSale").textContent = money(highest);
  $("lowestSale").textContent = money(lowest);
  $("latestSale").textContent = all.length ? `${all[0].vehicle} • ${date(all[0].sale_date)}` : "No sales yet";
  $("deductionCount").textContent = deductions.length;
  $("largestDeduction").textContent = money(dedAmounts.length ? Math.max(...dedAmounts) : 0);

  $("dedTotal").textContent = money(dedTotal);
  $("dedCount").textContent = deductions.length;
  $("dedTabCount").textContent = deductions.length;
  $("dedNet").textContent = money(net);
  $("dedNet").classList.toggle("negative", net < 0);
}

/* ---------- expected income ---------- */

function figure(label, value, cls) {
  return `<div><span>${esc(label)}</span><strong class="${cls || ""}">${money(value)}</strong></div>`;
}

function sourcedBadge(r) {
  if (r.missing) return `<span class="src-badge missing"><i class="fa-solid fa-link-slash"></i> Vehicle removed</span>`;
  if (r.sold) return `<span class="src-badge received"><i class="fa-solid fa-circle-check"></i> Received ${esc(date(r.receivedAt))}</span>`;
  return `<span class="src-badge pending"><i class="fa-solid fa-hourglass-half"></i> Awaiting sale</span>`;
}

function sourcedNote(r) {
  if (r.missing) return "The vehicle this request was linked to no longer exists, so it is left out of the totals.";
  if (!r.sold) return `Approved ${date(r.approved_at)} · still in inventory.`;
  if (!r.variance) return "Sold for exactly what was expected.";
  return `Sold ${money(Math.abs(r.variance))} ${r.variance > 0 ? "above" : "below"} the expected price.`;
}

function sourcedItem(r) {
  const state = r.missing ? "missing" : r.sold ? "received" : "pending";

  return `<article class="src-item ${state}">
<div class="src-head">
<div class="src-mark"><i class="fa-solid ${sourceIcon(r.source)}"></i></div>
<div class="src-title"><strong>${esc(r.vehicle)}</strong><span>${esc(sourceLabel(r.source))} · ${esc(r.customer)}${r.registration ? ` · ${esc(r.registration)}` : ""}</span></div>
${sourcedBadge(r)}
</div>
<div class="src-figures">
${figure("Paid to customer", r.cost)}
${figure("Expected sale", r.expected)}
${r.sold ? figure("Received", r.received) : ""}
${figure(r.sold ? "Profit" : "Expected profit", r.sold ? r.realisedProfit : r.expectedProfit, sign(r.sold ? r.realisedProfit : r.expectedProfit))}
</div>
<p class="src-note">${esc(sourcedNote(r))}${r.car_id && !r.missing ? ` <a href="edit.html?id=${encodeURIComponent(r.car_id)}">Open vehicle</a>` : ""}</p>
</article>`;
}

function filteredSourced() {
  if (srcFilter === "pending") return sourced.filter(r => !r.sold && !r.missing);
  if (srcFilter === "received") return sourced.filter(r => r.sold);
  return sourced;
}

function renderSourced() {
  $("srcExpected").textContent = money(summary.expectedPending);
  $("srcExpectedProfit").textContent = money(summary.expectedProfitPending);
  $("srcExpectedProfit").classList.toggle("negative", summary.expectedProfitPending < 0);
  $("srcReceived").textContent = money(summary.receivedTotal);
  $("srcRealised").textContent = money(summary.realisedProfit);
  $("srcRealised").classList.toggle("negative", summary.realisedProfit < 0);

  $("srcPendingCount").textContent = summary.pending.length;
  $("srcReceivedCount").textContent = summary.received.length;
  $("srcCapital").textContent = money(summary.capitalInStock);

  $("srcCostNote").textContent = COUNT_ACQUISITION_IN_NET
    ? `${money(summary.costOfSold)} of vehicle purchase cost is taken off net income.`
    : "Vehicle purchase cost is not applied to net income.";

  /* Same money entered twice gives a net income that is quietly wrong,
     so say so rather than letting it pass. */
  const manualPurchases = deductions.filter(x => String(x.category || "").toLowerCase() === "vehicle purchase");
  const warning = $("sourcedWarning");

  if (sourcedError) {
    warning.className = "src-warning active";
    warning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sell-In and Trade-In records could not be loaded, so expected income is not being counted. ${esc(sourcedError.message || "")}`;
  } else if (COUNT_ACQUISITION_IN_NET && manualPurchases.length && summary.received.length) {
    warning.className = "src-warning active";
    warning.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> You have ${manualPurchases.length} deduction${manualPurchases.length === 1 ? "" : "s"} filed under Vehicle Purchase. If any of them cover the vehicles below, that money is being subtracted twice — delete the manual entries, or ask your developer to switch off the automatic cost.`;
  } else {
    warning.className = "src-warning";
    warning.innerHTML = "";
  }

  const list = filteredSourced();
  const el = $("sourcedList");

  if (!list.length) {
    el.innerHTML = `<div class="src-empty"><i class="fa-solid fa-file-invoice-dollar"></i><h3>${sourced.length ? "Nothing in this view" : "No approved requests yet"}</h3><p>Vehicles approved from Sell Your Car and Trade-In requests appear here with the income expected from each one.</p></div>`;
    return;
  }

  el.innerHTML = list.map(sourcedItem).join("");
}

function setSrcFilter(value) {
  srcFilter = value || "all";
  document.querySelectorAll("[data-src-filter]").forEach(b => b.classList.toggle("active", b.dataset.srcFilter === srcFilter));
  renderSourced();
}

/* ---------- ledger ---------- */

function filtered() {
  const q = $("searchInput").value.toLowerCase().trim(),
    source = $("sourceFilter").value,
    period = $("dateFilter").value,
    now = new Date();
  return sales.filter(x => {
    const d = new Date(x.sale_date || x.created_at),
      match = !q || `${x.vehicle || ""} ${x.make || ""} ${x.model || ""} ${x.notes || ""} ${x.reference || ""}`.toLowerCase().includes(q),
      s = source === "all" || x.source === source,
      p = period === "all"
        || period === "today" && d.toDateString() === now.toDateString()
        || period === "month" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        || period === "year" && d.getFullYear() === now.getFullYear();
    return match && s && p
  })
}

function render() {
  const list = filtered();
  $("empty").style.display = list.length ? "none" : "block";
  $("salesTable").innerHTML = list.map(x => `<tr>
<td><strong>${esc(x.vehicle)}</strong><small>${esc([x.make, x.model, x.year].filter(Boolean).join(" ") || "Vehicle sale record")}</small>${x.origin ? `<span class="origin-tag ${esc(x.origin)}"><i class="fa-solid ${sourceIcon(x.origin)}"></i> ${esc(sourceLabel(x.origin))}</span>` : ""}</td>
<td><span class="source ${x.source}"><i class="fa-solid ${x.source === "inventory" ? "fa-car" : "fa-handshake"}"></i> ${x.source === "inventory" ? "Inventory" : "Ground Sale"}</span></td>
<td class="amount">${money(x.amount)}</td>
<td>${date(x.sale_date || x.created_at)}</td>
<td><small>${x.expected != null ? `Expected ${esc(money(x.expected))}` : esc(x.reference || x.notes || "—")}</small></td>
<td>${x.source === "ground" ? `<button class="delete-sale" data-id="${esc(x.id)}" type="button"><i class="fa-solid fa-trash"></i></button>` : `<span class="auto">Automatic</span>`}</td>
</tr>`).join("");
  document.querySelectorAll(".delete-sale").forEach(b => b.onclick = () => removeSale(b.dataset.id));
}

/* ---------- deductions ---------- */

function filteredDeductions() {
  const now = new Date();
  return deductions.filter(x => {
    if (dedFilter === "all") return true;
    const d = new Date(x.deduction_date || x.created_at);
    if (dedFilter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (dedFilter === "year") return d.getFullYear() === now.getFullYear();
    return true
  })
}

function renderDeductions() {
  const el = $("deductionList");
  if (!el) return;
  const list = filteredDeductions();
  if (!list.length) {
    el.innerHTML = `<div class="ded-empty"><i class="fa-solid fa-receipt"></i><h3>No deductions recorded</h3><p>Costs you record are subtracted from revenue right away.</p></div>`;
    return
  }
  el.innerHTML = list.map(x => `<div class="ded-item">
<div class="ded-icon"><i class="fa-solid fa-money-bill-transfer"></i></div>
<div class="ded-info">
<strong>${esc(x.title || "Deduction")}</strong>
<span>${esc(x.category || "Uncategorised")} · ${date(x.deduction_date || x.created_at)}${x.reference ? ` · ${esc(x.reference)}` : ""}</span>
${x.notes ? `<small>${esc(x.notes)}</small>` : ""}
</div>
<div class="ded-amount">${money(x.amount)}</div>
<button class="delete-ded" data-ded="${esc(x.id)}" type="button"><i class="fa-solid fa-trash"></i></button>
</div>`).join("");
  el.querySelectorAll("[data-ded]").forEach(b => b.onclick = () => removeDeduction(b.dataset.ded));
}

function setDedTab(tab) {
  document.querySelectorAll("[data-ded-tab]").forEach(t => t.classList.toggle("active", t.dataset.dedTab === tab));
  document.querySelectorAll("[data-ded-pane]").forEach(p => p.classList.toggle("hidden", p.dataset.dedPane !== tab));
}

async function removeDeduction(id) {
  if (!confirm("Delete this deduction? Net income will be recalculated.")) return;
  try {
    const { error } = await supabase.from("deductions").delete().eq("id", id);
    if (error) throw error;
    deductions = deductions.filter(x => String(x.id) !== String(id));
    updateStats();
    renderDeductions();
    renderSourced();
    msg("success", "Deduction deleted.")
  } catch (e) { fail(e) }
}

/* ---------- load ---------- */

async function load() {
  $("loading").style.display = "block";
  $("salesTable").innerHTML = "";
  sourcedError = null;

  try {
    /* The two request tables ride along with the rest, but a failure
       there must not take the whole page down — statistics admins do not
       necessarily have read access to them. */
    const [{ data: c, error: ce }, { data: g, error: ge }, { data: d, error: de }, requests] = await Promise.all([
      supabase.from("cars").select("*").order("created_at", { ascending: false }),
      supabase.from("ground_sales").select("*").order("sale_date", { ascending: false }),
      supabase.from("deductions").select("*").order("deduction_date", { ascending: false }),
      fetchSourcedRequests().catch(e => { console.warn("Sourced requests unavailable:", e); sourcedError = e; return []; })
    ]);
    if (ce) throw ce;
    if (ge) throw ge;
    if (de) throw de;

    cars = c || [];
    ground = g || [];
    deductions = d || [];

    sourced = buildIncomeSources(requests, cars);
    summary = summariseIncomeSources(sourced);

    buildSales();
    updateStats();
    render();
    renderDeductions();
    renderSourced()
  } catch (e) {
    fail(e)
  } finally {
    $("loading").style.display = "none"
  }
}

/* ---------- modals ---------- */

const today = () => new Date().toISOString().slice(0, 10);

function openSale() {
  $("saleModal").classList.add("open");
  document.body.classList.add("locked");
  $("saleDate").value = $("saleDate").value || today();
  setTimeout(() => $("saleVehicle").focus(), 120)
}
function closeSale() {
  $("saleModal").classList.remove("open");
  document.body.classList.remove("locked");
  $("groundSaleForm").reset();
  $("saleDate").value = today()
}
function openDeduction() {
  $("deductionModal").classList.add("open");
  document.body.classList.add("locked");
  $("dedDate").value = $("dedDate").value || today();
  setDedTab("add");
  renderDeductions();
  setTimeout(() => $("dedTitle").focus(), 120)
}
function closeDeduction() {
  $("deductionModal").classList.remove("open");
  document.body.classList.remove("locked");
  $("deductionForm").reset();
  $("dedDate").value = today()
}
const closeAll = () => {
  if ($("saleModal").classList.contains("open")) closeSale();
  if ($("deductionModal").classList.contains("open")) closeDeduction()
};

async function removeSale(id) {
  if (!confirm("Delete this manual sale record?")) return;
  try {
    const { error } = await supabase.from("ground_sales").delete().eq("id", id);
    if (error) throw error;
    msg("success", "Ground sale record deleted.");
    await load()
  } catch (e) { fail(e) }
}

/* ---------- forms ---------- */

$("groundSaleForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget), b = $("saveSale");
  try {
    b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    const { error } = await supabase.from("ground_sales").insert({
      vehicle: f.get("vehicle").trim(),
      amount: Number(f.get("amount")),
      sale_date: f.get("sale_date"),
      make: f.get("make").trim() || null,
      model: f.get("model").trim() || null,
      year: f.get("year") ? Number(f.get("year")) : null,
      reference: f.get("reference").trim() || null,
      notes: f.get("notes").trim() || null
    });
    if (error) throw error;
    closeSale();
    msg("success", "Ground sale recorded successfully.");
    await load()
  } catch (e) {
    fail(e)
  } finally {
    b.disabled = false; b.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Sale Record'
  }
};

$("deductionForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget), b = $("saveDeduction"), amount = Number(f.get("amount"));
  if (!Number.isFinite(amount) || amount < 0) return msg("error", "Enter a valid deduction amount.");
  try {
    b.disabled = true; b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    const { data, error } = await supabase.from("deductions").insert({
      title: f.get("title").trim(),
      amount,
      deduction_date: f.get("deduction_date"),
      category: f.get("category") || null,
      reference: f.get("reference").trim() || null,
      notes: f.get("notes").trim() || null
    }).select().single();
    if (error) throw error;
    if (data) deductions = [data, ...deductions];
    $("deductionForm").reset();
    $("dedDate").value = today();
    updateStats();
    renderDeductions();
    renderSourced();
    setDedTab("list");
    msg("success", "Deduction recorded.")
  } catch (e) {
    fail(e)
  } finally {
    b.disabled = false; b.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Deduction'
  }
};

/* ---------- events ---------- */

$("searchInput").oninput = render;
$("sourceFilter").onchange = render;
$("dateFilter").onchange = render;
$("refreshStats").onclick = load;

$("openSaleModal").onclick = openSale;
$("emptyAddSale").onclick = openSale;
$("closeSaleModal").onclick = closeSale;
$("cancelSale").onclick = closeSale;
$("saleModalBg").onclick = closeSale;

$("openDeductionModal").onclick = openDeduction;
$("closeDeductionModal").onclick = closeDeduction;
$("cancelDeduction").onclick = closeDeduction;
$("closeDeductionList").onclick = closeDeduction;
$("deductionModalBg").onclick = closeDeduction;

document.querySelectorAll("[data-ded-tab]").forEach(t => t.onclick = () => setDedTab(t.dataset.dedTab));
document.querySelectorAll("[data-ded-filter]").forEach(b => b.onclick = () => {
  dedFilter = b.dataset.dedFilter || "all";
  document.querySelectorAll("[data-ded-filter]").forEach(x => x.classList.toggle("active", x === b));
  renderDeductions()
});

document.querySelectorAll("[data-src-filter]").forEach(b => b.onclick = () => setSrcFilter(b.dataset.srcFilter));

$("menu").onclick = () => { $("sidebar").classList.add("open"); $("overlay").classList.add("show") };
$("closeMenu").onclick = $("overlay").onclick = () => { $("sidebar").classList.remove("open"); $("overlay").classList.remove("show") };
$("logoutBtn").onclick = async () => { await supabase.auth.signOut(); location.href = "auth.html" };

document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll() });

window.addEventListener("load", () => {
  setTimeout(() => $("loader")?.classList.add("hide"), 450);
  $("saleDate").value = today();
  $("dedDate").value = today()
});

/* same guard pattern as every other admin page */
requireAdmin("statistics").then(admin => {
  if (!admin) return;
  currentAdmin = admin;
  load();
  attachBadges()
});