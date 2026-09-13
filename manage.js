import{supabase}from"./supabase.js";

import{requireAdmin}from"./admin-guard.js";

import{attachBadges}from"./admin-nav.js";


const $=id=>document.getElementById(id);


const fmt=n=>
new Intl.NumberFormat("en-KE").format(Math.round(n));


const msg=(id,t)=>{

const el=$(id);

if(!el)return;

el.textContent=t;

el.classList.add("active");

setTimeout(()=>el.classList.remove("active"),3500);

};


const defaults={

facility_fee:10000,

min_deposit_pct:40,

min_repayment_months:3,

max_repayment_months:36,

usd_kes_rate:130

};



/* =========================
   PAGE CONTACTS
========================= */

async function loadContacts(){

const{data,error}=await supabase

.from("page_contacts")

.select("page_key,whatsapp,phone,email");


if(error){

msg("error",error.message);

return;

}


(data||[]).forEach(c=>{

const card=document.querySelector(
`.contact-page[data-page="${c.page_key}"]`
);

if(!card)return;


const whatsapp=
card.querySelector('[data-field="whatsapp"]');

const phone=
card.querySelector('[data-field="phone"]');

const email=
card.querySelector('[data-field="email"]');


if(whatsapp){

whatsapp.value=c.whatsapp||"";

}


if(phone){

phone.value=c.phone||"";

}


if(email){

email.value=c.email||"";

}

});

}



async function saveContact(card){

const page=card.dataset.page;

const button=
card.querySelector(".save-contact");


const whatsappField=
card.querySelector('[data-field="whatsapp"]');

const phoneField=
card.querySelector('[data-field="phone"]');

const emailField=
card.querySelector('[data-field="email"]');


const whatsapp=
whatsappField?.value
.trim()
.replace(/\D/g,"")||"";


const phone=
phoneField?.value
.trim()||"";


const email=
emailField?.value
.trim()||"";


/*
   WhatsApp is the required contact
   for every managed page.
*/

if(!whatsapp){

msg(
"error",
"Enter a valid WhatsApp number."
);

return;

}


if(whatsapp.length<10){

msg(
"error",
"Enter the full WhatsApp number in international format."
);

return;

}


button.disabled=true;

button.innerHTML=
'<i class="fa-solid fa-spinner fa-spin"></i> Saving...';


/*
   IMPORTANT:
   Only send phone/email when those
   fields actually exist on the card.

   This prevents Import, Trade-In and
   Financing saves from clearing their
   existing phone/email database values.
*/

const payload={

page_key:page,

whatsapp,

updated_at:new Date().toISOString()

};


if(phoneField){

payload.phone=phone;

}


if(emailField){

payload.email=email;

}


const{error}=await supabase

.from("page_contacts")

.upsert(

payload,

{

onConflict:"page_key"

}

);


button.disabled=false;


let buttonName;

if(page==="import"){

buttonName="Hero Number";

}else if(page==="tradein"){

buttonName="Trade-In";

}else if(page==="financing"){

buttonName="Financing";

}else{

buttonName=
card.querySelector("h3")?.textContent||
"Contacts";

}


button.innerHTML=
`<i class="fa-solid fa-floppy-disk"></i> Save ${buttonName}`;


if(error){

msg("error",error.message);

return;

}


let successName;

if(page==="import"){

successName="Import hero";

}else if(page==="tradein"){

successName="Trade-In";

}else if(page==="financing"){

successName="Financing";

}else{

successName=
card.querySelector("h3")?.textContent||
"Contacts";

}


msg(
"success",
`${successName} contact updated successfully.`
);

}



/* =========================
   HIRE PURCHASE SETTINGS
========================= */

function hpValues(){

return{

facility_fee:

Math.max(

0,

+$("facilityFee").value||0

),


min_deposit_pct:

Math.min(

90,

Math.max(

0,

+$("minDepositPct").value||0

)

),


min_repayment_months:

Math.max(

1,

+$("minRepaymentMonths").value||1

),


max_repayment_months:

Math.max(

1,

+$("maxRepaymentMonths").value||1

),


usd_kes_rate:

Math.max(

1,

+$("usdKesRate").value||130

)

};

}



function hpPreview(){

const v=hpValues();


const vehicle=1000000;


const deposit=
vehicle*v.min_deposit_pct/100;


const balance=
vehicle-deposit;


const months=
Math.max(
v.min_repayment_months,
1
);


const principal=
balance/months;


const monthly=
principal+v.facility_fee;


$("previewFee").textContent=
`KES ${fmt(v.facility_fee)}`;


$("previewFee2").textContent=
`KES ${fmt(v.facility_fee)}`;


$("previewDeposit").textContent=
`${v.min_deposit_pct}% · KES ${fmt(deposit)}`;


$("previewBalance").textContent=
`KES ${fmt(balance)}`;


$("previewPrincipal").textContent=
`KES ${fmt(principal)}`;


$("previewExampleFee").textContent=
`KES ${fmt(v.facility_fee)}`;


$("previewInstallment").textContent=
`KES ${fmt(monthly)}`;

}



function fillSettings(v){

$("facilityFee").value=
v.facility_fee;


$("minDepositPct").value=
v.min_deposit_pct;


$("minRepaymentMonths").value=
v.min_repayment_months;


$("maxRepaymentMonths").value=
v.max_repayment_months;


$("usdKesRate").value=
v.usd_kes_rate;


hpPreview();

}



async function loadSettings(){

const{data,error}=await supabase

.from("financing_calculator_settings")

.select("*")

.eq("id",1)

.maybeSingle();


if(error){

msg("error",error.message);

return;

}


fillSettings(

data

?{...defaults,...data}

:defaults

);

}



async function saveSettings(){

const h=hpValues();


if(
h.max_repayment_months<
h.min_repayment_months
){

msg(
"error",
"HP maximum repayment period cannot be below minimum."
);

return;

}


const button=
$("saveAllFormula");


button.disabled=true;

button.innerHTML=
'<i class="fa-solid fa-spinner fa-spin"></i> Saving...';


const{error}=await supabase

.from("financing_calculator_settings")

.upsert(

{

id:1,

...h,

updated_at:new Date().toISOString()

},

{

onConflict:"id"

}

);


button.disabled=false;

button.innerHTML=
'<i class="fa-solid fa-floppy-disk"></i> Save All Calculator Settings';


if(error){

msg("error",error.message);

return;

}


msg(
"success",
"HP calculator updated successfully."
);

}



async function resetSettings(){

fillSettings(defaults);


const button=
$("resetAllFormula");


button.disabled=true;

button.innerHTML=
'<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';


const{error}=await supabase

.from("financing_calculator_settings")

.upsert(

{

id:1,

...defaults,

updated_at:new Date().toISOString()

},

{

onConflict:"id"

}

);


button.disabled=false;

button.innerHTML=
'<i class="fa-solid fa-rotate-left"></i> Reset All Defaults';


if(error){

msg("error",error.message);

return;

}


msg(
"success",
"HP calculator reset to defaults."
);

}



/* =========================
   CONTACT EVENTS
========================= */

document

.querySelectorAll(".contact-page")

.forEach(card=>{

card

.querySelector(".save-contact")

?.addEventListener(
"click",
()=>saveContact(card)
);

});



/* =========================
   CALCULATOR EVENTS
========================= */

[

"facilityFee",

"minDepositPct",

"minRepaymentMonths",

"maxRepaymentMonths",

"usdKesRate"

]

.forEach(id=>{

$(id)?.addEventListener(
"input",
hpPreview
);

$(id)?.addEventListener(
"change",
hpPreview
);

});



$("saveAllFormula")

?.addEventListener(
"click",
saveSettings
);



$("resetAllFormula")

?.addEventListener(
"click",
resetSettings
);



/* =========================
   MOBILE MENU
========================= */

$("menu").onclick=()=>{

$("sidebar").classList.add("open");

$("overlay").classList.add("show");

};


$("closeMenu").onclick=
$("overlay").onclick=()=>{

$("sidebar").classList.remove("open");

$("overlay").classList.remove("show");

};



/* =========================
   LOGOUT
========================= */

$("logoutBtn").onclick=async()=>{

await supabase.auth.signOut();

location.replace("auth.html");

};



/* =========================
   LOADER
========================= */

window.addEventListener(

"load",

()=>setTimeout(

()=>$("loader")?.classList.add("hide"),

400

)

);



/* =========================
   ADMIN INITIALIZATION
========================= */

requireAdmin("webpage")

.then(async ok=>{

if(!ok)return;


attachBadges?.()

.catch(
e=>console.error("badges",e)
);


await loadContacts();

await loadSettings();

});