import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat("en-KE").format(Math.round(n)),msg=(id,t)=>{$(id).textContent=t;$(id).classList.add("active");setTimeout(()=>$(id).classList.remove("active"),3500)},defaults={facility_fee:10000,min_deposit_pct:40,min_repayment_months:3,max_repayment_months:36,usd_kes_rate:130};

async function loadContacts(){let{data,error}=await supabase.from("page_contacts").select("page_key,whatsapp,phone,email");if(error)return msg("error",error.message);(data||[]).forEach(c=>{let card=document.querySelector(`.contact-page[data-page="${c.page_key}"]`);if(!card)return;card.querySelector('[data-field="whatsapp"]').value=c.whatsapp||"";card.querySelector('[data-field="phone"]').value=c.phone||"";card.querySelector('[data-field="email"]').value=c.email||""})}

async function saveContact(card){let page=card.dataset.page,b=card.querySelector(".save-contact"),whatsapp=card.querySelector('[data-field="whatsapp"]').value.trim(),phone=card.querySelector('[data-field="phone"]').value.trim(),email=card.querySelector('[data-field="email"]').value.trim();b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';let{error}=await supabase.from("page_contacts").upsert({page_key:page,whatsapp,phone,email,updated_at:new Date().toISOString()},{onConflict:"page_key"});b.disabled=false;b.innerHTML=`<i class="fa-solid fa-floppy-disk"></i> Save ${card.querySelector("h3").textContent}`;if(error)return msg("error",error.message);msg("success",`${card.querySelector("h3").textContent} contacts updated successfully.`)}

function hpValues(){return{facility_fee:Math.max(0,+$("facilityFee").value||0),min_deposit_pct:Math.min(90,Math.max(0,+$("minDepositPct").value||0)),min_repayment_months:Math.max(1,+$("minRepaymentMonths").value||1),max_repayment_months:Math.max(1,+$("maxRepaymentMonths").value||1),usd_kes_rate:Math.max(1,+$("usdKesRate").value||130)}}

function hpPreview(){let v=hpValues(),vehicle=1000000,deposit=vehicle*v.min_deposit_pct/100,balance=vehicle-deposit,months=Math.max(v.min_repayment_months,1),principal=balance/months,monthly=principal+v.facility_fee;$("previewFee").textContent=`KES ${fmt(v.facility_fee)}`;$("previewFee2").textContent=`KES ${fmt(v.facility_fee)}`;$("previewDeposit").textContent=`${v.min_deposit_pct}% · KES ${fmt(deposit)}`;$("previewBalance").textContent=`KES ${fmt(balance)}`;$("previewPrincipal").textContent=`KES ${fmt(principal)}`;$("previewExampleFee").textContent=`KES ${fmt(v.facility_fee)}`;$("previewInstallment").textContent=`KES ${fmt(monthly)}`}

function fillSettings(v){$("facilityFee").value=v.facility_fee;$("minDepositPct").value=v.min_deposit_pct;$("minRepaymentMonths").value=v.min_repayment_months;$("maxRepaymentMonths").value=v.max_repayment_months;$("usdKesRate").value=v.usd_kes_rate;hpPreview()}

async function loadSettings(){let{data,error}=await supabase.from("financing_calculator_settings").select("*").eq("id",1).maybeSingle();if(error)return msg("error",error.message);fillSettings(data?{...defaults,...data}:defaults)}

async function saveSettings(){let h=hpValues();if(h.max_repayment_months<h.min_repayment_months)return msg("error","HP maximum repayment period cannot be below minimum.");let b=$("saveAllFormula");b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';let{error}=await supabase.from("financing_calculator_settings").upsert({id:1,...h,updated_at:new Date().toISOString()},{onConflict:"id"});b.disabled=false;b.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save HP Calculator Settings';if(error)return msg("error",error.message);msg("success","HP calculator updated successfully.")}

async function resetSettings(){fillSettings(defaults);let b=$("resetAllFormula");b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';let{error}=await supabase.from("financing_calculator_settings").upsert({id:1,...defaults,updated_at:new Date().toISOString()},{onConflict:"id"});b.disabled=false;b.innerHTML='<i class="fa-solid fa-rotate-left"></i> Reset HP Defaults';if(error)return msg("error",error.message);msg("success","HP calculator reset to defaults.")}

document.querySelectorAll(".contact-page").forEach(c=>c.querySelector(".save-contact")?.addEventListener("click",()=>saveContact(c)));
["facilityFee","minDepositPct","minRepaymentMonths","maxRepaymentMonths","usdKesRate"].forEach(id=>$(id)?.addEventListener("input",hpPreview));
$("saveAllFormula")?.addEventListener("click",saveSettings);
$("resetAllFormula")?.addEventListener("click",resetSettings);
$("menu").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};
$("closeMenu").onclick=$("overlay").onclick=()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")};
$("logoutBtn").onclick=async()=>{await supabase.auth.signOut();location.replace("auth.html")};
window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),400));
requireAdmin("webpage").then(async ok=>{if(!ok)return;await loadContacts();await loadSettings()});