import{supabase}from"./supabase.js";
import{loadBadgeCounts}from"./badges.js";

const $=id=>document.getElementById(id);

/* Map each sidebar link's href to its notification/badge section key.
   These hrefs are a best guess based on your admin permission keys —
   check them against your real sidebar.html filenames and fix any
   that don't match; a mismatch just means that badge won't render,
   nothing else breaks. */
const SECTION_BY_HREF={
"accessiblecars.html":"accessiblecars",
"agents.html":"agent_submissions",
"diaspora.html":"diaspora",
"enquiries.html":"enquiries",
"general-enquiries.html":"general_enquiries",
"financing.html":"financing",
"imports.html":"imports",
"insurance.html":"insurance",
"reservations.html":"reservations",
"sellcars.html":"sellcars",
"testdrives.html":"testdrives",
"tradeins.html":"tradeins"
};

export async function attachBadges(){
try{
const counts=await loadBadgeCounts();
document.querySelectorAll(".side-link[href]").forEach(a=>{
const key=SECTION_BY_HREF[a.getAttribute("href")];
if(!key)return;
const count=counts[key]||0;
let badge=a.querySelector(".nav-badge");
if(!count){badge?.remove();return}
if(!badge){badge=document.createElement("span");badge.className="nav-badge";a.appendChild(badge)}
badge.textContent=count>99?"99+":String(count)
})
}catch(e){console.error("admin-nav: attachBadges failed",e)}
}

export async function loadAdminNav(){
const r=await fetch("sidebar.html");
if(!r.ok)throw Error("Failed to load sidebar");
$("adminNav").innerHTML=await r.text();
const p=location.pathname.split("/").pop()||"index.html";
document.querySelectorAll(".side-link[href]").forEach(a=>a.classList.toggle("active",a.getAttribute("href")===p));
attachBadges();
const s=$("sidebar"),o=$("overlay"),m=$("menu"),c=$("closeMenu"),l=$("logoutBtn");
m?.addEventListener("click",()=>{s.classList.add("open");o.classList.add("show")});
const close=()=>{s.classList.remove("open");o.classList.remove("show")};
c?.addEventListener("click",close);
o?.addEventListener("click",close);
l?.addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("auth.html")})
}