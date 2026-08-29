import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id),grid=$("requestsGrid"),esc=v=>String(v??"—").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),money=v=>Number(v||0).toLocaleString("en-KE"),date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—",BUCKET="car-images";

let requests=[],current=null,adminEmails=new Set(),currentAdmin=null,currentFiles=[];

const statuses=["new","reviewing","valued","completed","rejected"];

async function auth(){
let{data:{session}}=await supabase.auth.getSession();
if(!session)return null;
let{data,error}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();
if(error||!data)return null;
currentAdmin=data;
return data;
}

async function loadAdmins(){
let{data,error}=await supabase.from("admin_users").select("email");
if(error)throw error;
adminEmails=new Set((data||[]).map(x=>String(x.email||"").trim().toLowerCase()).filter(Boolean));
}

const isAgent=x=>adminEmails.has(String(x.email||"").trim().toLowerCase());
const isMainAdmin=()=>currentAdmin?.is_main_admin===true;

async function load(){
$("loading").style.display="block";
grid.innerHTML="";
$("empty").style.display="none";
$("error").classList.remove("active");
try{
await auth();
let[{data,error}]=await Promise.all([
supabase.from("tradein_requests").select("*").order("created_at",{ascending:false}),
loadAdmins()
]);
if(error)throw error;
requests=data||[];
stats();
render();
}catch(e){
console.error(e);
$("error").textContent=e.message||"Unable to load requests.";
$("error").classList.add("active");
}finally{
$("loading").style.display="none";
}
}

function stats(){
$("totalRequests").textContent=requests.length;
$("newRequests").textContent=requests.filter(x=>(x.status||"new")==="new").length;
$("reviewingRequests").textContent=requests.filter(x=>x.status==="reviewing").length;
$("completedRequests").textContent=requests.filter(x=>x.approved_car_id||x.status==="approved").length;
}

function render(){
let q=$("searchInput").value.toLowerCase().trim(),s=$("statusFilter").value,o=$("sortFilter").value;
let l=requests.filter(x=>{let t=`${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.vehicle_make||""} ${x.vehicle_model||""} ${x.registration||""} ${x.location||""}`.toLowerCase(),st=x.approved_car_id?"approved":(x.status||"new");return(!q||t.includes(q))&&(s==="all"||st===s)});
l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):o==="value-high"?(b.expected_value||0)-(a.expected_value||0):o==="budget-high"?(b.max_budget||0)-(a.max_budget||0):new Date(b.created_at)-new Date(a.created_at));
if(!l.length){$("empty").style.display="block";grid.innerHTML="";return}
$("empty").style.display="none";
grid.innerHTML=l.map(x=>{let st=x.approved_car_id?"approved":(x.status||"new"),agent=isAgent(x);return`<article class="request-card ${agent?"agent-request":""}" data-id="${esc(x.id)}"><div class="request-top"><div class="customer"><h3>${esc(x.full_name)}</h3><p>${esc(x.phone)}</p></div><span class="request-status ${esc(st)}">${x.approved_car_id?"in inventory":esc(st)}</span></div><div class="request-body"><div class="vehicle-title"><i class="fa-solid fa-car"></i><span>${esc(x.vehicle_make)} ${esc(x.vehicle_model)}</span></div><div class="request-info"><span>${esc(x.vehicle_year)||"—"}</span><span>${esc(x.registration)||"No registration"}</span></div><div class="request-value"><span>Expected Value</span><strong>KES ${money(x.expected_value)}</strong></div></div></article>`}).join("");
}

function field(label,value){
return`<div class="detail-field"><span>${label}</span><strong>${esc(value)}</strong></div>`;
}

async function getFiles(id){
let{data,error}=await supabase.from("tradein_files").select("*").eq("tradein_id",id).order("created_at",{ascending:true});
if(error)throw error;
return data||[];
}

function approvalPanel(){
if(!current)return"";

if(current.approved_car_id){
let profit=Number(current.inventory_price||0)-Number(current.negotiated_price||0);

return`<section class="approval-panel approved-panel">
<div class="approval-title">
<div><i class="fa-solid fa-circle-check"></i></div>
<div><span>INVENTORY STATUS</span><h3>Vehicle Approved & Added</h3></div>
</div>
<div class="approval-summary">
<div><span>Trade-In Value</span><strong>KES ${money(current.negotiated_price)}</strong></div>
<div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div>
<div><span>Estimated Gross Profit</span><strong class="${profit>=0?"profit-positive":"profit-negative"}">KES ${money(profit)}</strong></div>
</div>
<div class="approved-actions">
<button type="button" class="inventory-btn" onclick="openInventoryCar()"><i class="fa-solid fa-pen-to-square"></i> Open & Edit Inventory Vehicle</button>
</div>
</section>`;
}

if(!isMainAdmin()){
return`<section class="approval-panel locked-panel">
<div class="approval-title">
<div><i class="fa-solid fa-lock"></i></div>
<div><span>INVENTORY APPROVAL</span><h3>Main Admin Approval Required</h3><p>Only the main administrator can approve this trade-in vehicle and move it into inventory.</p></div>
</div>
</section>`;
}

return`<section class="approval-panel">
<div class="approval-title">
<div><i class="fa-solid fa-handshake"></i></div>
<div>
<span>INVENTORY APPROVAL</span>
<h3>Approve & Add to Inventory</h3>
<p>Enter the agreed trade-in value and the intended inventory selling price.</p>
</div>
</div>

<div class="asking-price">
<span>Customer Expected Trade-In Value</span>
<strong>KES ${money(current.expected_value)}</strong>
</div>

<div class="approval-grid">
<div>
<label>Agreed Trade-In Value *</label>
<input id="negotiatedPrice" type="number" min="0" step="1" value="${current.negotiated_price??""}" placeholder="Final value agreed">
</div>
<div>
<label>Inventory Selling Price *</label>
<input id="inventoryPrice" type="number" min="0" step="1" value="${current.inventory_price??""}" placeholder="Vehicle listing price">
</div>
</div>

<div class="profit-box">
<div>
<span>Estimated Gross Profit</span>
<strong id="profitValue">KES 0</strong>
</div>
<small>Selling price minus agreed trade-in value.</small>
</div>

<button id="approveInventory" type="button" class="approve-btn">
<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory
</button>
</section>`;
}

function fileCard(f){
let url=f.file_url||"",image=/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)||String(f.file_type||"").startsWith("image/"),video=String(f.file_type||"").startsWith("video/");
return`<div class="file-card">
${image?`<img src="${esc(url)}" alt="">`:video?`<video src="${esc(url)}" controls></video>`:`<div class="file-icon"><i class="fa-solid fa-file"></i></div>`}
<div class="file-info">
<span>${esc(f.file_name||f.file_type||"File")}</span>
<a href="${esc(url)}" target="_blank" rel="noopener">Open File <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
</div>
</div>`;
}

async function viewRequest(id,focusStatus=false){
current=requests.find(x=>x.id===id);
if(!current)return;

try{
currentFiles=await getFiles(id);
let agent=isAgent(current);

$("detailTitle").textContent=`${current.full_name} — ${current.vehicle_make} ${current.vehicle_model}`;
$("detailDate").textContent=date(current.created_at);

$("detailContent").innerHTML=`
${agent?`<div class="agent-banner"><i class="fa-solid fa-user-tie"></i><div><strong>AGENT SUBMISSION</strong><span>This request was submitted using an administrator email.</span></div></div>`:""}

<div class="detail-section">
<div class="detail-section-head">
<h3>Status</h3>
<span class="detail-status-label ${esc(current.approved_car_id?"approved":(current.status||"new"))}">${esc(current.approved_car_id?"in inventory":(current.status||"new"))}</span>
</div>
<div class="detail-status">
<select id="detailStatus">
${statuses.map(s=>`<option value="${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join("")}
</select>
<button id="saveStatus" type="button"><i class="fa-solid fa-floppy-disk"></i> Save Status</button>
</div>
</div>

<div class="detail-section">
<h3>Customer Information</h3>
<div class="detail-fields">
${field("Full Name",current.full_name)}
${field("Phone",current.phone)}
${field("Email",current.email)}
${field("Location",current.location)}
${field("ID / Passport",current.id_number)}
${field("Contact Time",current.contact_time)}
</div>
</div>

<div class="detail-section">
<h3>Current Vehicle</h3>
<div class="detail-fields">
${field("Make",current.vehicle_make)}
${field("Model",current.vehicle_model)}
${field("Year",current.vehicle_year)}
${field("Body Type",current.body_type)}
${field("Fuel",current.fuel_type)}
${field("Transmission",current.transmission)}
${field("Mileage",current.mileage?Number(current.mileage).toLocaleString()+" km":"—")}
${field("Colour",current.colour)}
${field("Registration",current.registration)}
${field("Condition",current.condition)}
${field("Defects",Array.isArray(current.defects)?current.defects.join(", "):current.defects)}
${field("Defect Details",current.defect_details)}
</div>
</div>

<div class="detail-section">
<h3>Desired Upgrade</h3>
<div class="detail-fields">
${field("Identified Vehicle",current.identified_vehicle)}
${field("Make",current.upgrade_make)}
${field("Model",current.upgrade_model)}
${field("Max Budget","KES "+money(current.max_budget))}
</div>
</div>

<div class="detail-section">
<h3>Financial Information</h3>
<div class="detail-fields">
${field("Expected Trade-In","KES "+money(current.expected_value))}
${field("Loan Balance","KES "+money(current.loan_balance))}
${field("Top-Up","KES "+money(current.topup))}
${field("Financing",current.financing)}
</div>
</div>

<div class="detail-section">
<h3>Additional Information</h3>
<div class="detail-fields">
${field("Source",current.source)}
${field("Timeline",current.trade_timeline)}
${field("Notes",current.notes)}
</div>
</div>

${approvalPanel()}

<div class="detail-section">
<h3>Submitted Files <small>(${currentFiles.length})</small></h3>
${currentFiles.length?`<div class="files-grid">${currentFiles.map(fileCard).join("")}</div>`:`<div class="notes"><p>No files were submitted.</p></div>`}
</div>`;

$("detailStatus").value=current.status||"new";
$("saveStatus").onclick=()=>updateStatus(current.id,$("detailStatus").value);

if(!current.approved_car_id&&isMainAdmin()){
$("negotiatedPrice")?.addEventListener("input",updateProfit);
$("inventoryPrice")?.addEventListener("input",updateProfit);
$("approveInventory")?.addEventListener("click",approveToInventory);
updateProfit();
}

$("tradeDetail").classList.add("show");
document.body.classList.add("locked");

if(focusStatus)setTimeout(()=>$("detailStatus")?.focus(),100);

}catch(e){
console.error(e);
$("error").textContent=e.message;
$("error").classList.add("active");
}
}

function updateProfit(){
let buy=Number($("negotiatedPrice")?.value||0),sell=Number($("inventoryPrice")?.value||0),profit=sell-buy,el=$("profitValue");
if(!el)return;
el.textContent=`KES ${money(profit)}`;
el.className=profit<0?"profit-negative":"profit-positive";
}

function imageFiles(){
return currentFiles.filter(f=>String(f.file_type||"").startsWith("image/")||/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(f.file_url||""));
}

function safeName(name){
return String(name||"image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g,"-");
}

async function copyImageToCar(file,carId,index){
let url=file.file_url;
if(!url)throw new Error("Image URL is missing.");

let response=await fetch(url);
if(!response.ok)throw new Error("Unable to download submitted image.");

let blob=await response.blob();
let name=safeName(file.file_name||`image-${index}.jpg`);
let target=`${carId}/gallery/${crypto.randomUUID()}-${name}`;

let{error}=await supabase.storage.from(BUCKET).upload(target,blob,{cacheControl:"3600",upsert:false,contentType:file.file_type||blob.type});
if(error)throw error;

let image_url=supabase.storage.from(BUCKET).getPublicUrl(target).data.publicUrl;
return{storage_path:target,image_url};
}

async function approveToInventory(){
if(!current||!isMainAdmin())return alert("Only the main administrator can approve vehicles into inventory.");
if(current.approved_car_id)return alert("This request has already been added to inventory.");

let buy=Number($("negotiatedPrice")?.value),sell=Number($("inventoryPrice")?.value);

if(!Number.isFinite(buy)||buy<0)return alert("Enter a valid agreed trade-in value.");
if(!Number.isFinite(sell)||sell<=0)return alert("Enter a valid inventory selling price.");

let name=`${current.vehicle_make||""} ${current.vehicle_model||""}`.trim()||"this vehicle";
if(!confirm(`Approve ${name} and add it to inventory for KES ${money(sell)}?`))return;

let button=$("approveInventory");
button.disabled=true;
button.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Adding to Inventory...`;

let uploaded=[];

try{
let{data:{session}}=await supabase.auth.getSession();
if(!session)throw new Error("Your session has expired. Please log in again.");

let requestCheck=await supabase.from("tradein_requests").select("approved_car_id").eq("id",current.id).maybeSingle();
if(requestCheck.error)throw requestCheck.error;

let existingCar=await supabase.from("cars").select("id").eq("source_request_id",current.id).maybeSingle();
if(existingCar.error)throw existingCar.error;

if(existingCar.data){
let requestUpdate={status:"approved",negotiated_price:buy,inventory_price:sell,approved_car_id:existingCar.data.id,approved_at:new Date().toISOString(),approved_by:session.user.id,updated_at:new Date().toISOString()};

let{error}=await supabase.from("tradein_requests").update(requestUpdate).eq("id",current.id);
if(error)throw error;

current={...current,...requestUpdate};
requests=requests.map(x=>x.id===current.id?current:x);

alert("This vehicle was already in inventory. The request has been reconnected.");
closeDetail();
load();
return;
}

if(requestCheck.data?.approved_car_id)throw new Error("This request has already been approved by another administrator.");

let carData={
make:current.vehicle_make||null,
model:current.vehicle_model||null,
year:current.vehicle_year?Number(current.vehicle_year):null,
price:sell,
purchase_price:buy,
condition:current.condition||null,
body_type:current.body_type||null,
mileage:current.mileage!=null&&current.mileage!==""?Number(current.mileage):null,
fuel_type:current.fuel_type||null,
transmission:current.transmission||null,
registration_number:current.registration||null,
location:current.location||null,
city:current.location||null,
exterior_color:current.colour||null,
status:"available",
featured:false,
financing_available:false,
test_drive_available:true,
source_request_id:current.id,
source_type:"trade_in",
created_at:new Date().toISOString(),
updated_at:new Date().toISOString()
};

let{data:car,error:carError}=await supabase.from("cars").insert(carData).select().single();

if(carError){
if(carError.code==="23505"){
let{data:existing,error}=await supabase.from("cars").select("*").eq("source_request_id",current.id).single();
if(error)throw error;
car=existing;
}else throw carError;
}

let images=imageFiles();

for(let i=0;i<images.length;i++){
let copied=await copyImageToCar(images[i],car.id,i);
uploaded.push(copied.storage_path);

let{error:imageError}=await supabase.from("car_images").insert({
car_id:car.id,
image_url:copied.image_url,
storage_path:copied.storage_path,
image_type:"gallery",
display_order:i
});

if(imageError)throw imageError;

if(i===0){
let{error:displayError}=await supabase.from("cars").update({
display_image_url:copied.image_url,
display_image_path:copied.storage_path
}).eq("id",car.id);

if(displayError)throw displayError;
}
}

let requestUpdate={
status:"approved",
negotiated_price:buy,
inventory_price:sell,
approved_car_id:car.id,
approved_at:new Date().toISOString(),
approved_by:session.user.id,
updated_at:new Date().toISOString()
};

let{error:updateError}=await supabase.from("tradein_requests").update(requestUpdate).eq("id",current.id).is("approved_car_id",null);
if(updateError)throw updateError;

current={...current,...requestUpdate};
requests=requests.map(x=>x.id===current.id?current:x);

alert(`Vehicle approved and successfully added to inventory.${images.length?` ${images.length} image(s) were transferred.`:""}`);

closeDetail();
load();

}catch(e){
console.error(e);

if(uploaded.length)await supabase.storage.from(BUCKET).remove(uploaded);

alert(e.message||"Unable to add vehicle to inventory.");

if(button){
button.disabled=false;
button.innerHTML=`<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`;
}
}
}

window.openInventoryCar=()=>{
if(!current?.approved_car_id)return;
location.href=`edit.html?id=${current.approved_car_id}`;
};

async function updateStatus(id,status){
if(current?.approved_car_id&&status!=="approved"&&!confirm("This request is already linked to an inventory vehicle. Change its request status anyway?"))return;

let{error}=await supabase.from("tradein_requests").update({status,updated_at:new Date().toISOString()}).eq("id",id);

if(error){
alert(error.message);
return;
}

let x=requests.find(x=>x.id===id);
if(x)x.status=status;
if(current)current.status=status;

stats();
render();

let label=document.querySelector(".detail-status-label");
if(label){
label.textContent=status;
label.className=`detail-status-label ${status}`;
}

alert("Request status updated.");
}

function closeDetail(){
$("tradeDetail").classList.remove("show");
document.body.classList.remove("locked");
current=null;
currentFiles=[];
}

grid.addEventListener("click",e=>{
let card=e.target.closest(".request-card");
if(card)viewRequest(card.dataset.id);
});

$("searchInput").oninput=render;
$("statusFilter").onchange=render;
$("sortFilter").onchange=render;
$("refreshBtn").onclick=load;

$("closeDetail").onclick=e=>{
e.preventDefault();
e.stopPropagation();
closeDetail();
};

$("detailBg").onclick=closeDetail;

document.addEventListener("keydown",e=>{
if(e.key==="Escape")closeDetail();
});

$("menu").onclick=()=>{
$("sidebar").classList.add("open");
$("overlay").classList.add("show");
};

$("closeMenu").onclick=$("overlay").onclick=()=>{
$("sidebar").classList.remove("open");
$("overlay").classList.remove("show");
};

$("logoutBtn").onclick=async()=>{
await supabase.auth.signOut();
location.replace("auth.html");
};

window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));

requireAdmin("tradeins").then(async allowed=>{
if(!allowed)return;
await auth();
load();
});