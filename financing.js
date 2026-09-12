import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";import{markSectionSeen}from"./badges.js";
import{attachBadges}from"./admin-nav.js";
const $=id=>document.getElementById(id),grid=$("requestsGrid"),esc=v=>String(v??"—").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),money=v=>Number(v||0).toLocaleString("en-KE"),date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—",phone=v=>String(v||"").replace(/\D/g,"").replace(/^0/,"254");

let requests=[],cars=[],sellRequests=[],tradeRequests=[],current=null,currentSource=null,currentSourceImages=[];

function field(label,value){return`<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`}
function sourceRow(label,value){return`<div class="source-detail-row"><span>${esc(label)}</span><strong>${esc(value||"—")}</strong></div>`}
function vehicleName(x){return`${x.vehicle_make||x.make||""} ${x.vehicle_model||x.model||""}`.trim()||"Vehicle not specified"}

async function load(){
 $("loading").style.display="block";grid.innerHTML="";$("empty").style.display="none";$("error").classList.remove("active");
 try{
  const[a,b,c,d]=await Promise.all([
   supabase.from("financing_requests").select("*").order("created_at",{ascending:false}),
   supabase.from("cars").select("*"),
   supabase.from("sell_car_requests").select("*"),
   supabase.from("tradein_requests").select("*")
  ]);
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error;
  requests=a.data||[];cars=b.data||[];sellRequests=c.data||[];tradeRequests=d.data||[];stats();render();
 }catch(e){$("error").textContent=e.message;$("error").classList.add("active")}
 finally{$("loading").style.display="none"}
}

function stats(){
 $("totalRequests").textContent=requests.length;
 $("newRequests").textContent=requests.filter(x=>(x.status||"new")==="new").length;
 $("contactedRequests").textContent=requests.filter(x=>x.status==="contacted").length;
 $("approvedRequests").textContent=requests.filter(x=>x.status==="approved").length;
 $("rejectedRequests").textContent=requests.filter(x=>x.status==="rejected").length
}

function getCatalogueVehicle(x){
 const id=x.car_id||x.vehicle_id||x.inventory_car_id;
 if(id){const a=cars.find(c=>String(c.id)===String(id));if(a)return a}
 const stock=String(x.stock_number||"").trim().toLowerCase();
 if(stock){const a=cars.find(c=>String(c.stock_number||"").trim().toLowerCase()===stock);if(a)return a}
 const mk=String(x.vehicle_make||"").trim().toLowerCase(),md=String(x.vehicle_model||"").trim().toLowerCase(),yr=String(x.vehicle_year||"");
 return cars.find(c=>String(c.make||"").trim().toLowerCase()===mk&&String(c.model||"").trim().toLowerCase()===md&&(!yr||String(c.year||"")===yr))||null
}

function resolveSource(x){
 const car=getCatalogueVehicle(x),src=String(x.source_type||x.vehicle_source||x.source||car?.source_type||"").toLowerCase();
 const rid=car?.source_request_id||x.source_request_id||x.sell_request_id||x.tradein_request_id;
 if(["sell_in","sellcar","sell_car"].includes(src)){const r=sellRequests.find(i=>String(i.id)===String(rid));return{type:"sell",label:"Sell-In",icon:"fa-car-side",vehicle:car||r,car,request:r,person:r?{name:r.full_name,phone:r.phone,email:r.email}:null}}
 if(["trade_in","tradein","trade-in"].includes(src)){const r=tradeRequests.find(i=>String(i.id)===String(rid));return{type:"trade",label:"Trade-In",icon:"fa-right-left",vehicle:car||r,car,request:r,person:r?{name:r.full_name,phone:r.phone,email:r.email}:null}}
 if(car)return{type:"inventory",label:"Inventory",icon:"fa-warehouse",vehicle:car,car,request:null,person:{name:car.created_by_name||"Inventory Vehicle",email:car.created_by_email||""}}
 return{type:"inventory",label:"Vehicle",icon:"fa-car",vehicle:null,car:null,request:null,person:null}
}

async function loadSourceImages(source){
 if(!source?.car?.id)return[];
 const{data}=await supabase.from("car_images").select("*").eq("car_id",source.car.id).order("display_order",{ascending:true});
 let imgs=data||[];
 if(source.car.display_image_url&&!imgs.some(x=>x.image_url===source.car.display_image_url||x.file_url===source.car.display_image_url))imgs.unshift({image_url:source.car.display_image_url});
 return imgs.map(x=>({image_url:x.image_url||x.file_url||x.url})).filter(x=>x.image_url)
}

function renderGallery(images){
 currentSourceImages=images||[];
 if(!images.length){$("sourceImageGallery").innerHTML=`<div class="source-image-placeholder"><i class="fa-solid fa-car"></i><span>No vehicle images available</span></div>`;return}
 $("sourceImageGallery").innerHTML=`<img id="sourceMainImage" class="source-main-image" src="${esc(images[0].image_url)}" alt="Vehicle">${images.length>1?`<div class="source-thumbnails">${images.map((x,i)=>`<img class="source-thumb ${i===0?"active":""}" src="${esc(x.image_url)}" data-index="${i}" alt="">`).join("")}</div>`:""}`;
 document.querySelectorAll(".source-thumb").forEach(t=>t.onclick=()=>{const x=currentSourceImages[Number(t.dataset.index)];if(!x)return;$("sourceMainImage").src=x.image_url;document.querySelectorAll(".source-thumb").forEach(a=>a.classList.remove("active"));t.classList.add("active")})
}

function sourceDetails(source){
 const c=source?.car||source?.vehicle||{};
 return[
  ["Make",c.make||c.vehicle_make],["Model",c.model||c.vehicle_model],["Year",c.year||c.vehicle_year],
  ["Stock Number",c.stock_number],["Registration",c.registration_number||c.registration],
  ["Mileage",c.mileage!=null?`${Number(c.mileage).toLocaleString()} km`:null],["Body Type",c.body_type],
  ["Fuel",c.fuel_type],["Transmission",c.transmission],["Colour",c.exterior_color||c.colour],
  ["Condition",c.condition],["Location",c.location||c.city],["Price",c.price?`KES ${money(c.price)}`:null],["Status",c.status]
 ].map(x=>sourceRow(x[0],x[1])).join("")
}

function sourcePersonHTML(source){
 if(!source?.person)return`<div class="source-person-contact"><span><i class="fa-solid fa-circle-info"></i> Source contact unavailable</span></div>`;
 const p=source.person;
 return`<div class="source-person-name"><strong>${esc(p.name||"Unknown")}</strong><span class="person-tag inventory">${esc(source.type==="inventory"?"INVENTORY":"CLIENT")}</span></div><div class="source-person-contact">${p.phone?`<a href="tel:+${esc(phone(p.phone))}"><i class="fa-solid fa-phone"></i>${esc(p.phone)}</a>`:""}${p.email?`<a href="mailto:${esc(p.email)}"><i class="fa-solid fa-envelope"></i>${esc(p.email)}</a>`:""}</div>`
}

async function renderSource(source){
 currentSource=source;
 $("sourceTypeBadge").className=`source-type-badge ${source.type}`;
 $("sourceTypeBadge").innerHTML=`<i class="fa-solid ${source.icon}"></i>${esc(source.label)}`;
 const c=source.car||source.vehicle||{};
 $("sourceVehicleName").textContent=vehicleName(c);
 $("sourceVehicleMeta").textContent=[c.year||c.vehicle_year,c.stock_number,c.registration_number||c.registration].filter(Boolean).join(" • ")||source.label;
 renderGallery(await loadSourceImages(source));
 $("sourceVehicleDetails").innerHTML=sourceDetails(source);
 $("sourcePerson").innerHTML=sourcePersonHTML(source);
 $("sourcePersonTitle").textContent=source.type==="sell"?"Seller":source.type==="trade"?"Trade-In Customer":"Inventory Source";
 $("sourceActionCard").innerHTML=source.car?.id?`<span class="section-kicker">VEHICLE RECORD</span><h3>Inventory Vehicle</h3><p>This vehicle exists in the catalogue inventory.</p><button class="source-open-button" type="button" onclick="openSourceVehicle()"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Vehicle</button>`:`<span class="section-kicker">VEHICLE SOURCE</span><h3>${esc(source.label)}</h3><p>This financing request is connected to a ${esc(source.label)} source.</p>`
}

function renderRequestedVehicle(){
 const c=getCatalogueVehicle(current);
 const make=current.vehicle_make||c?.make||"Vehicle",model=current.vehicle_model||c?.model||"Not specified";
 $("requestedVehicle").innerHTML=`<div class="requested-vehicle-title"><i class="fa-solid fa-car"></i><div><h4>${esc(make)} ${esc(model)}</h4><p>Customer's requested vehicle</p></div></div><div class="requested-vehicle-meta"><div><span>Year</span><strong>${esc(current.vehicle_year||c?.year)}</strong></div><div><span>Stock</span><strong>${esc(current.stock_number||c?.stock_number)}</strong></div><div><span>Make</span><strong>${esc(make)}</strong></div><div><span>Model</span><strong>${esc(model)}</strong></div></div>`
}

function renderContacts(){
 const p=phone(current.phone),e=current.email||"";
 $("contactActions").innerHTML=`${p?`<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Customer</a><a class="contact-action-large whatsapp" target="_blank" rel="noopener" href="https://wa.me/${esc(p)}"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>`:""}${e?`<a class="contact-action-large" href="mailto:${esc(e)}"><i class="fa-solid fa-envelope"></i>Email Customer</a>`:""}`
}

function updateBadge(s){$("detailStatusBadge").className=`large-status ${s}`;$("detailStatusBadge").textContent=s.toUpperCase()}

async function openRequest(id){
 current=requests.find(x=>String(x.id)===String(id));if(!current)return;
 const s=current.status||"new";
 $("modalTitle").textContent=`${current.full_name||"Customer"} — Financing`;
 $("modalSubtitle").textContent=`${vehicleName(current)} • ${date(current.created_at)}`;
 $("modalStatus").value=s;updateBadge(s);

 $("customerDetails").innerHTML=[
  ["Full Name",current.full_name],["Phone",current.phone],["Email",current.email],["Employment Status",current.employment_status],["Monthly Income",current.monthly_income?`KES ${money(current.monthly_income)}`:"—"],["Deposit",current.deposit?`KES ${money(current.deposit)}`:"—"]
 ].map(x=>field(x[0],x[1])).join("");

 $("financingDetails").innerHTML=[
  ["Financing Type",current.financing_type],["Purchase Timeline",current.purchase_timeline],["Vehicle Budget",current.vehicle_budget?`KES ${money(current.vehicle_budget)}`:"—"],["Vehicle",vehicleName(current)],["Vehicle Year",current.vehicle_year],["Submitted",date(current.created_at)]
 ].map(x=>field(x[0],x[1])).join("");

 const msg=current.message||current.notes||"";
 $("financingMessage").hidden=!msg.trim();
 if(msg.trim())$("financingMessage").querySelector("p").textContent=msg;

 renderRequestedVehicle();
 renderContacts();

 $("requestMeta").innerHTML=[
  ["Request ID",current.id],["Created At",date(current.created_at)],["Updated At",date(current.updated_at)],["Status",s]
 ].map(x=>field(x[0],x[1])).join("");

 await renderSource(resolveSource(current));

 $("requestModal").classList.add("show");
 $("requestModal").setAttribute("aria-hidden","false");
 document.body.classList.add("locked")
}

async function saveStatus(){
 if(!current)return;
 const status=$("modalStatus").value,{error}=await supabase.from("financing_requests").update({status,updated_at:new Date().toISOString()}).eq("id",current.id);
 if(error)return alert(error.message);
 current.status=status;
 const i=requests.findIndex(x=>x.id===current.id);if(i!==-1)requests[i].status=status;
 updateBadge(status);stats();render()
}

async function deleteRequest(){
 if(!current||!confirm(`Delete financing request from ${current.full_name||"this customer"}?`))return;
 const{error}=await supabase.from("financing_requests").delete().eq("id",current.id);
 if(error)return alert(error.message);
 closeRequest();load()
}

function closeRequest(){
 $("requestModal").classList.remove("show");
 $("requestModal").setAttribute("aria-hidden","true");
 document.body.classList.remove("locked");
 current=null;currentSource=null;currentSourceImages=[]
}

window.openRequest=openRequest;
window.openSourceVehicle=()=>{if(currentSource?.car?.id)location.href=`edit.html?id=${encodeURIComponent(currentSource.car.id)}`};

function render(){
 const q=$("searchInput").value.toLowerCase().trim(),s=$("statusFilter").value,o=$("sortFilter").value;
 let list=requests.filter(x=>`${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.vehicle||""} ${vehicleName(x)} ${x.stock_number||""}`.toLowerCase().includes(q)&&(s==="all"||(x.status||"new")===s));
 list.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):new Date(b.created_at)-new Date(a.created_at));
 if(!list.length){$("empty").style.display="block";grid.innerHTML="";return}
 $("empty").style.display="none";
 grid.innerHTML=list.map(x=>{const s=x.status||"new";return`<article class="request-card" data-id="${esc(x.id)}"><div class="request-top"><small>${esc(date(x.created_at))}</small><span class="request-status ${esc(s)}">${esc(s)}</span></div><h3>${esc(x.full_name||"Customer")}</h3><p><i class="fa-solid fa-phone"></i>${esc(x.phone||"—")}</p><p><i class="fa-solid fa-envelope"></i>${esc(x.email||"—")}</p><div class="request-meta"><span>${esc(vehicleName(x))}</span><strong>KES ${money(x.vehicle_budget)}</strong></div><div class="request-bottom"><span>${esc(x.financing_type||"Financing")}</span><button type="button">View Request <i class="fa-solid fa-arrow-right"></i></button></div></article>`}).join("")
}

grid.onclick=e=>{const c=e.target.closest(".request-card");if(c)openRequest(c.dataset.id)};
$("modalStatus").onchange=e=>updateBadge(e.target.value);
$("saveStatus").onclick=saveStatus;
$("deleteRequest").onclick=deleteRequest;
$("closeRequest").onclick=closeRequest;
$("closeRequestBg").onclick=closeRequest;
$("searchInput").oninput=render;
$("statusFilter").onchange=render;
$("sortFilter").onchange=render;
$("refreshBtn").onclick=load;
$("menu").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};
$("closeMenu").onclick=$("overlay").onclick=()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")};
$("logoutBtn").onclick=async()=>{await supabase.auth.signOut();location.replace("auth.html")};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&current)closeRequest()});
window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));
requireAdmin("financing").then(x=>{if(x){load();markSectionSeen("financing");attachBadges()}});