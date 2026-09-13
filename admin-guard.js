import { supabase } from "../supabase.js";

const pages = {
  index: "vehicles",
  vehicles: "vehicles",
  tradeins: "tradeins",
  imports: "imports",
  financing: "financing",
  diaspora: "diaspora",
  sellcars: "sellcars",
  accessiblecars: "accessiblecars",
  reservations: "reservations",
  testdrives: "testdrives",
  insurance: "insurance",
  statistics: "statistics",
  admins: "admins",
  webpage: "webpage",
};

const NOTICE_ID = "accessNotice";
const NOTICE_STYLE_ID = "accessNoticeStyles";

function ensureNoticeStyles() {
  if (document.getElementById(NOTICE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = NOTICE_STYLE_ID;
  style.textContent = `
    #${NOTICE_ID} {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 230px;
      max-width: 360px;
      padding: 14px 18px;
      border-radius: 12px;
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.07);
      box-shadow: 0 12px 28px -8px rgba(15, 23, 42, 0.22), 0 2px 6px rgba(15, 23, 42, 0.06);
      font: 500 14px "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #0f172a;
      opacity: 0;
      transform: translateY(-10px);
      pointer-events: none;
      transition: opacity .25s ease, transform .25s ease;
      overflow: hidden;
    }
    #${NOTICE_ID}.show {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    #${NOTICE_ID} .an-icon {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${NOTICE_ID} .an-icon svg {
      width: 12px;
      height: 12px;
    }
    #${NOTICE_ID}.ok .an-icon { background: #dcfce7; }
    #${NOTICE_ID}.ok .an-icon svg { stroke: #16a34a; }
    #${NOTICE_ID}.err .an-icon { background: #fee2e2; }
    #${NOTICE_ID}.err .an-icon svg { stroke: #dc2626; }
    #${NOTICE_ID} .an-text {
      flex: 1 1 auto;
      line-height: 1.35;
    }
    #${NOTICE_ID} .an-bar {
      position: absolute;
      left: 0;
      bottom: 0;
      height: 3px;
      width: 100%;
      transform-origin: left;
    }
    #${NOTICE_ID}.show .an-bar {
      animation: an-shrink 3s linear forwards;
    }
    #${NOTICE_ID}.ok .an-bar { background: #16a34a; }
    #${NOTICE_ID}.err .an-bar { background: #dc2626; }
    @keyframes an-shrink {
      from { transform: scaleX(1); }
      to { transform: scaleX(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      #${NOTICE_ID} { transition: opacity .01s linear; transform: none !important; }
      #${NOTICE_ID}.show .an-bar { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

const ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

const notice = (ok, text) => {
  ensureNoticeStyles();
  let e = document.getElementById(NOTICE_ID);
  if (!e) {
    e = document.createElement("div");
    e.id = NOTICE_ID;
    e.innerHTML = `<span class="an-icon"></span><span class="an-text"></span><span class="an-bar"></span>`;
    document.body.appendChild(e);
  }

  e.className = ok ? "ok" : "err";
  e.querySelector(".an-icon").innerHTML = ok ? ICONS.ok : ICONS.err;
  e.querySelector(".an-text").textContent = text;

  // restart entrance + progress-bar animation on repeat calls
  e.classList.remove("show");
  void e.offsetWidth;
  requestAnimationFrame(() => e.classList.add("show"));

  clearTimeout(e._t);
  e._t = setTimeout(() => e.classList.remove("show"), 3000);
};

export async function requireAdmin(page) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace("auth.html");
    return null;
  }

  const { data: admin, error } = await supabase
    .from("admin_users")
    .select("id,email,is_main_admin")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !admin) {
    await supabase.auth.signOut();
    location.replace("auth.html");
    return null;
  }

  if (admin.is_main_admin) {
    notice(true, "Full Access");
    return admin;
  }

  const key = pages[page] || page;
  const { data: row, error: pe } = await supabase
    .from("admin_permissions")
    .select("permissions")
    .eq("admin_id", admin.id)
    .maybeSingle();

  if (pe || row?.permissions?.[key] !== true) {
    notice(false, "Access Denied");
    setTimeout(() => location.replace("index.html?access=denied"), 3000);
    return null;
  }

  notice(true, "Full Access");
  return admin;
}

export async function applyPageAccess() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace("auth.html");
    return null;
  }

  const { data: admin, error } = await supabase
    .from("admin_users")
    .select("id,is_main_admin")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !admin) {
    location.replace("auth.html");
    return null;
  }
  if (admin.is_main_admin) return admin;

  const { data: row } = await supabase
    .from("admin_permissions")
    .select("permissions")
    .eq("admin_id", admin.id)
    .maybeSingle();

  const p = row?.permissions || {};
  document.querySelectorAll("[data-permission]").forEach((el) => {
    if (p[el.dataset.permission] !== true) el.remove();
  });

  return admin;
}

export async function logout() {
  await supabase.auth.signOut();
  location.replace("auth.html");
}