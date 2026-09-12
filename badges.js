import { supabase } from "./supabase.js";

/* section key (matches requireAdmin() permission keys) -> requests table */
const SECTIONS = [
  { key: "accessiblecars",    table: "accessible_car_requests" },
  { key: "agent_submissions", table: "agent_vehicle_submissions" },
  { key: "diaspora",          table: "returning_resident_requests" },
  { key: "enquiries",         table: "vehicle_enquiries" },
  { key: "financing",         table: "financing_requests" },
  { key: "imports",           table: "import_requests" },
  { key: "insurance",         table: "insurance_requests" },
  { key: "reservations",      table: "vehicle_reservations" },
  { key: "sellcars",          table: "sell_car_requests" },
  { key: "testdrives",        table: "test_drive_bookings" },
  { key: "tradeins",          table: "tradein_requests" }
];

async function getAdminId() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id || null;
  } catch (e) {
    console.warn("badges: getSession failed", e);
    return null;
  }
}

async function getSeenMap(adminId) {
  const { data, error } = await supabase
    .from("admin_notification_state")
    .select("section,last_seen_at")
    .eq("admin_id", adminId);
  if (error) { console.warn("notification state load failed:", error); return {}; }
  const map = {};
  (data || []).forEach(x => { map[x.section] = x.last_seen_at; });
  return map;
}

/**
 * Returns { [sectionKey]: count } — how many rows were created after this
 * admin last opened that section. Call this from admin-nav.js when
 * rendering the sidebar.
 */
export async function loadBadgeCounts() {
  try {
    const adminId = await getAdminId();
    if (!adminId) { console.warn("badges: no admin session yet, skipping badge counts"); return {}; }

    const seen = await getSeenMap(adminId);
    const counts = {};

    await Promise.all(SECTIONS.map(async ({ key, table }) => {
      try {
        const since = seen[key] || "1970-01-01T00:00:00Z";
        const { count, error } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .gt("created_at", since);
        if (error) console.warn(`badges: count failed for ${table}`, error);
        counts[key] = error ? 0 : (count || 0);
      } catch (e) {
        console.warn(`badges: count threw for ${table}`, e);
        counts[key] = 0;
      }
    }));

    return counts;
  } catch (e) {
    console.error("badges: loadBadgeCounts failed", e);
    return {};
  }
}

/**
 * Paints badge counts onto nav links. Expects each nav link to carry
 * data-section="<key>" matching the keys above. Call after the nav
 * markup exists in the DOM.
 */
export function renderBadges(counts, containerSelector = "#adminNav") {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  Object.entries(counts).forEach(([key, count]) => {
    const link = container.querySelector(`[data-section="${key}"]`);
    if (!link) return;

    let badge = link.querySelector(".nav-badge");
    if (!count) { badge?.remove(); return; }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
  });
}

/**
 * Marks a section as seen right now. Call this from each request-queue
 * page once it has loaded, so its own badge clears immediately.
 */
export async function markSectionSeen(sectionKey) {
  const adminId = await getAdminId();
  if (!adminId) return;

  const { error } = await supabase
    .from("admin_notification_state")
    .upsert(
      { admin_id: adminId, section: sectionKey, last_seen_at: new Date().toISOString() },
      { onConflict: "admin_id,section" }
    );
  if (error) console.warn(`badges: markSectionSeen(${sectionKey}) failed`, error);
}