import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";
import{attachBadges}from"./admin-nav.js";

const $=id=>document.getElementById(id),msg=(id,t)=>{$(id).textContent=t;$(id).classList.add("active");setTimeout(()=>$ (id).classList.remove("active"),3500)};

async function loadImportContact(){let{data,error}=await supabase.from("page_contacts").select("whatsapp").eq("page_key","import").maybeSingle();if(error)return msg("error",error.message);let card=document.querySelector('.contact-page[data-page="import"]'),input=card?.querySelector('[data-field="whatsapp"]');if(input)input.value=data?.whatsapp||""}

async function saveImportContact(){let card=document.querySelector('.contact-page[data-page="import"]'),input=card?.querySelector('[data-field="whatsapp"]'),button=card?.querySelector(".save-contact"),whatsapp=input?.value.trim().replace(/\D/g,"");if(!whatsapp)return msg("error","Enter a valid WhatsApp number.");if(whatsapp.length<10)return msg("error","Enter the full WhatsApp number in international format.");button.disabled=true;button.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';let{error}=await supabase.from("page_contacts").upsert({page_key:"import",whatsapp,updated_at:new Date().toISOString()},{onConflict:"page_key"});button.disabled=false;button.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save WhatsApp Number';if(error)return msg("error",error.message);msg("success","Import hero WhatsApp number updated successfully.")}

document.querySelector('.contact-page[data-page="import"] .save-contact')?.addEventListener("click",saveImportContact);

$("menu")?.addEventListener("click",()=>$("sidebar").classList.add("open")||$("overlay").classList.add("show"));
$("closeMenu")?.addEventListener("click",()=>$("sidebar").classList.remove("open")||$("overlay").classList.remove("show"));
$("overlay")?.addEventListener("click",()=>$("sidebar").classList.remove("open")||$("overlay").classList.remove("show"));
$("logoutBtn")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("auth.html")});
window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),400));

requireAdmin("webpage").then(async ok=>{if(!ok)return;attachBadges?.().catch(e=>console.error("badges",e));await loadImportContact()});