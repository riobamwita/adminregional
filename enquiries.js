import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";
const $=id=>document.getElementById(id),grid=$("requestsGrid"),esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),money=v=>Number(v||0).toLocaleString("en-KE"),fmt=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—",phone=v=>String(v||"").replace(/\D/g,"").replace(/^0/,"254");
let requests=[],cars=[],sellRequests=[],tradeRequests=[],adminEmails=new Set(),current=null;

async function load(){
$("loading").style.display="block";grid.innerHTML="";$("empty").style.display="none";$("error").classList.remove("active");
try{
let[r,c,s,t,a]=await Promise.all([
supabase.from("vehicle_enquiries").select("*").order("created_at",{ascending:false}),
supabase.from("cars").select("*"),
supabase.from("sell_car_requests").select("*"),
supabase.from("tradein_requests").select("*"),
supabase.from("admin_users").select("email")
]);
if(r.error)throw r.error;
if(c.error)throw c.error;
if(s.error)throw s.error;
if(t.error)throw t.error;
if(a.error)throw a.error;
requests=r.data||[];cars=c.data||[];sellRequests=s.data||[];tradeRequests=t.data||[];
adminEmails=new Set((a.data||[]).map(x=>String(x.email||"").trim().toLowerCase()).filter(Boolean));
stats();render();
}catch(e){console.error(e);$("error").textContent=e.message||"Unable to load enquiries.";$("error").classList.add("active")}
finally{$("loading").style.display="none"}
}

function stats(){
$("totalRequests").textContent=requests.length;
$("newRequests").textContent=requests.filter(x=>(x.status||"new")==="new").length;
$("contactedRequests").textContent=requests.filter(x=>x.status==="contacted").length;
$("completedRequests").textContent=requests.filter(x=>x.status==="completed").length;
$("closedRequests").textContent=requests.filter(x=>x.status==="closed").length;
}

function vehicle(x){return`${x.vehicle_make||""} ${x.vehicle_model||""} ${x.vehicle_year||""}`.trim()||"Vehicle not specified"}

function getCar(x){
let stock=String(x.stock_number||"").trim().toLowerCase();
return cars.find(c=>String(c.id||"")===String(x.car_id||x.vehicle_id||""))||cars.find(c=>stock&&String(c.stock_number||"").trim().toLowerCase()===stock)||cars.find(c=>`${c.make||""} ${c.model||""}`.trim().toLowerCase()===`${x.vehicle_make||""} ${x.vehicle_model||""}`.trim().toLowerCase()&&String(c.year||"")===String(x.vehicle_year||""));
}

function isAgentEmail(email){return adminEmails.has(String(email||"").trim().toLowerCase())}

function origin(x){
let car=getCar(x);
if(!car)return{type:"inventory",label:"Inventory",icon:"fa-warehouse",person:"Vehicle source unavailable",email:"",tag:"CLIENT",tagClass:"client"};

let source=String(car.source_type||"").toLowerCase(),id=car.source_request_id;

if(source==="sell_in"||source==="sellcar"||source==="sell_car"){
let r=sellRequests.find(x=>String(x.id)===String(id));
return{type:"sell",label:"Sell Your Car",icon:"fa-car-side",person:r?.full_name||"Seller information unavailable",phone:r?.phone||"",email:r?.email||"",tag:isAgentEmail(r?.email)?"AGENT":"CLIENT",tagClass:isAgentEmail(r?.email)?"agent":"client"};
}

if(source==="trade_in"||source==="tradein"||source==="trade-in"){
let r=tradeRequests.find(x=>String(x.id)===String(id));
return{type:"trade",label:"Trade-In",icon:"fa-right-left",person:r?.full_name||"Trade-in customer unavailable",phone:r?.phone||"",email:r?.email||"",tag:isAgentEmail(r?.email)?"AGENT":"CLIENT",tagClass:isAgentEmail(r?.email)?"agent":"client"};
}

return{type:"inventory",label:"Inventory",icon:"fa-warehouse",person:car.created_by_name||"Regional AutoSelections Inventory",phone:"",email:car.created_by_email||"",tag:"INVENTORY",tagClass:"inventory"};
}

function render(){
let q=$("searchInput").value.toLowerCase().trim(),s=$("statusFilter").value,o=$("sortFilter").value;
let l=requests.filter(x=>{
let z=origin(x),txt=`${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.stock_number||""} ${vehicle(x)} ${z.label} ${z.person} ${z.email}`.toLowerCase();
return txt.includes(q)&&(s==="all"||(x.status||"new")===s);
});
l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):new Date(b.created_at)-new Date(a.created_at));
if(!l.length){$("empty").style.display="block";grid.innerHTML="";return}
$("empty").style.display="none";

grid.innerHTML=l.map(x=>{
let z=origin(x);
return`<article class="request-card" onclick="openRequest('${esc(x.id)}')">
<div class="request-top"><span class="request-status ${esc(x.status||"new")}">${esc(x.status||"new")}</span><small>${fmt(x.created_at)}</small></div>
<div class="source-row"><span class="source-badge ${z.type}"><i class="fa-solid ${z.icon}"></i> ${esc(z.label)}</span></div>
<h3>${esc(x.full_name||"Unnamed Customer")}</h3>
<p><i class="fa-solid fa-phone"></i> ${esc(x.phone||"—")}</p>
<p><i class="fa-solid fa-car"></i> ${esc(vehicle(x))}</p>
<div class="request-meta"><span>${esc(x.stock_number||"No stock number")}</span><strong>KES ${money(x.vehicle_price)}</strong></div>
<div class="request-bottom"><span>${esc(x.proceed_option||"General enquiry")}</span><button type="button" onclick="event.stopPropagation();openRequest('${esc(x.id)}')">View Enquiry <i class="fa-solid fa-arrow-right"></i></button></div>
</article>`;
}).join("");
}

window.openRequest=id=>{
current=requests.find(x=>String(x.id)===String(id));
if(!current)return;

let v=vehicle(current),p=phone(current.phone),z=origin(current);
$("modalTitle").textContent=`${current.full_name||"Customer"}'s Enquiry`;
$("modalStatus").value=current.status||"new";

$("modalBody").innerHTML=`
<div class="vehicle-summary-admin">
<span>Vehicle Enquired About</span>
<strong>${esc(v)}</strong>
<br><small>Stock: ${esc(current.stock_number||"N/A")} · KES ${money(current.vehicle_price)}</small>
</div>

<div class="source-detail">
<div class="source-detail-head"><span><i class="fa-solid ${z.icon}"></i> VEHICLE SOURCE</span><strong>${esc(z.label)}</strong></div>
<div class="source-detail-person">
<div><span>Vehicle Submitted By</span><strong>${esc(z.person)}</strong>${z.phone?`<small>${esc(z.phone)}</small>`:""}${z.email?`<small>${esc(z.email)}</small>`:""} </div>
<b class="${z.tagClass}">${esc(z.tag)}</b>
</div>
</div>

<div class="detail-grid">
<div><span>Full Name</span><strong>${esc(current.full_name||"—")}</strong></div>
<div><span>Phone / WhatsApp</span><strong>${esc(current.phone||"—")}</strong></div>
<div><span>Email Address</span><strong>${esc(current.email||"—")}</strong></div>
<div><span>Preferred Contact</span><strong>${esc(current.preferred_contact_method||"—")}</strong></div>
<div><span>How They Want to Proceed</span><strong>${esc(current.proceed_option||"—")}</strong></div>
<div><span>Payment Preference</span><strong>${esc(current.payment_preference||"—")}</strong></div>
<div><span>Consent to Contact</span><strong>${current.consent?"Yes":"No"}</strong></div>
<div><span>Submitted</span><strong>${fmt(current.created_at)}</strong></div>
</div>

<div class="contact-actions">
<a class="contact-action whatsapp" href="https://wa.me/${p}?text=${encodeURIComponent(`Hello ${current.full_name||""}, this is Regional Auto Selections regarding your enquiry about the ${v}.`)}" target="_blank"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
<a class="contact-action" href="tel:${esc(current.phone||"")}"><i class="fa-solid fa-phone"></i> Call</a>
<a class="contact-action" href="mailto:${esc(current.email||"")}"><i class="fa-solid fa-envelope"></i> Email</a>
</div>

${current.message?`<div class="notes"><span>Additional Message</span><p>${esc(current.message)}</p></div>`:""}`;

$("requestModal").classList.add("show");
document.body.classList.add("locked");
};

async function saveStatus(){
if(!current)return;
let status=$("modalStatus").value,{error}=await supabase.from("vehicle_enquiries").update({status,updated_at:new Date().toISOString()}).eq("id",current.id);
if(error)return alert(error.message);
closeRequest();load();
}

async function deleteRequest(){
if(!current||!confirm(`Delete enquiry from ${current.full_name||"this customer"}?`))return;
let{error}=await supabase.from("vehicle_enquiries").delete().eq("id",current.id);
if(error)return alert(error.message);
closeRequest();load();
}

function closeRequest(){
$("requestModal").classList.remove("show");
document.body.classList.remove("locked");
current=null;
}

$("searchInput").oninput=render;
$("statusFilter").onchange=render;
$("sortFilter").onchange=render;
$("refreshBtn").onclick=load;
$("saveStatus").onclick=saveStatus;
$("deleteRequest").onclick=deleteRequest;
$("closeRequest").onclick=closeRequest;
$("closeRequestBg").onclick=closeRequest;
$("menu").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};
$("closeMenu").onclick=$("overlay").onclick=()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")};
$("logoutBtn").onclick=async()=>{await supabase.auth.signOut();location.href="auth.html"};
window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));
requireAdmin("enquiries").then(x=>x&&load());