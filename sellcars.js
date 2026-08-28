import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id),grid=$("requestsGrid"),esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),money=v=>Number(v||0).toLocaleString("en-KE"),date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—",BUCKET="car-images";

let requests=[],current=null,adminEmails=new Set(),currentAdmin=null,currentFiles=[];

async function auth(){
const{data:{session}}=await supabase.auth.getSession();
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
supabase.from("sell_car_requests").select("*").order("created_at",{ascending:false}),
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
$("contactedRequests").textContent=requests.filter(x=>x.status==="contacted").length;
$("inspectedRequests").textContent=requests.filter(x=>x.status==="inspected").length;
$("completedRequests").textContent=requests.filter(x=>x.status==="approved"||x.approved_car_id).length;
}

function render(){
let q=$("searchInput").value.toLowerCase().trim(),s=$("statusFilter").value,o=$("sortFilter").value;
let l=requests.filter(x=>{
let t=`${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.registration||""} ${x.make||""} ${x.model||""} ${x.location||""}`.toLowerCase();
let st=x.approved_car_id?"approved":(x.status||"new");
return(!q||t.includes(q))&&(s==="all"||st===s);
});

l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):o==="price-high"?(b.asking_price||0)-(a.asking_price||0):o==="price-low"?(a.asking_price||0)-(b.asking_price||0):new Date(b.created_at)-new Date(a.created_at));

$("empty").style.display=l.length?"none":"block";

if(!l.length){
grid.innerHTML="";
return;
}

grid.innerHTML=l.map(x=>{
let st=x.approved_car_id?"approved":(x.status||"new"),agent=isAgent(x),approved=!!x.approved_car_id;

return`<article class="request-card ${agent?"agent-request":""} ${approved?"approved-request":""}" onclick="openRequest('${x.id}')">
<div class="request-top">
<div class="request-badges">
<span class="request-status ${esc(st)}">${approved?"in inventory":esc(st)}</span>
${agent?`<span class="agent-tag"><i class="fa-solid fa-user-tie"></i> AGENT</span>`:""}
</div>
<small>${date(x.created_at)}</small>
</div>

<h3>${esc(x.make)} ${esc(x.model)} ${esc(x.year)}</h3>

<p><i class="fa-solid fa-user"></i> ${esc(x.full_name)}</p>
<p><i class="fa-solid fa-phone"></i> ${esc(x.phone)}</p>
<p><i class="fa-solid fa-location-dot"></i> ${esc(x.location)}</p>

<div class="request-meta">
<span>${esc(x.registration)} · ${Number(x.mileage||0).toLocaleString()} KM</span>
<strong>KES ${money(x.asking_price)}</strong>
</div>

${approved?`<div class="inventory-mini"><i class="fa-solid fa-circle-check"></i> Added to Inventory</div>`:""}

<div class="request-bottom">
<span>${esc(x.condition||"Condition —")}</span>
<button type="button" onclick="event.stopPropagation();openRequest('${x.id}')">View Request <i class="fa-solid fa-arrow-right"></i></button>
</div>
</article>`;
}).join("");
}

async function getFiles(id){
let{data,error}=await supabase.from("sell_car_files").select("*").eq("request_id",id).order("created_at",{ascending:true});
if(error)throw error;
return data||[];
}

function publicSellUrl(path){
return supabase.storage.from("sell-car-files").getPublicUrl(path).data.publicUrl;
}

function fileCard(f){
let url=publicSellUrl(f.storage_path),type=f.file_type||"",image=type.startsWith("image/"),video=type.startsWith("video/"),icon=video?"fa-video":type==="application/pdf"?"fa-file-pdf":"fa-file";

return`<div class="file-item">
${image?`<img src="${esc(url)}" alt="${esc(f.file_name)}" loading="lazy">`:video?`<video src="${esc(url)}" controls></video>`:`<div class="file-icon"><i class="fa-solid ${icon}"></i></div>`}
<div class="file-info">
<strong>${esc(f.field_name||"File")}</strong>
<span>${esc(f.file_name)}</span>
<a href="${esc(url)}" target="_blank" rel="noopener">Open File</a>
</div>
</div>`;
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
<div><span>Purchase Price</span><strong>KES ${money(current.negotiated_price)}</strong></div>
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
<div><span>INVENTORY APPROVAL</span><h3>Main Admin Approval Required</h3><p>Only the main administrator can approve this vehicle and move it into inventory.</p></div>
</div>
</section>`;
}

return`<section class="approval-panel">
<div class="approval-title">
<div><i class="fa-solid fa-handshake"></i></div>
<div>
<span>INVENTORY APPROVAL</span>
<h3>Approve & Add to Inventory</h3>
<p>Enter the actual negotiated purchase price and the price Regional Autoselections will sell the vehicle for.</p>
</div>
</div>

<div class="asking-price">
<span>Seller Asking Price</span>
<strong>KES ${money(current.asking_price)}</strong>
</div>

<div class="approval-grid">
<div>
<label>Negotiated Purchase Price *</label>
<input id="negotiatedPrice" type="number" min="0" step="1" value="${current.negotiated_price??""}" placeholder="Actual amount paid for vehicle">
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
<small>Selling price minus negotiated purchase price.</small>
</div>

<button id="approveInventory" type="button" class="approve-btn">
<i class="fa-solid fa-car-side"></i>
Approve & Add to Inventory
</button>
</section>`;
}

window.openRequest=async id=>{
current=requests.find(x=>x.id===id);
if(!current)return;

let agent=isAgent(current);
$("modalTitle").textContent=`${current.make||""} ${current.model||""} — ${current.full_name||"Customer"}`;
$("modalStatus").value=current.approved_car_id?"approved":(current.status||"new");

try{
currentFiles=await getFiles(id);

let html=`
${agent?`<div class="agent-banner">
<i class="fa-solid fa-user-tie"></i>
<div>
<strong>AGENT SUBMISSION</strong>
<span>This request was submitted using an administrator email.</span>
</div>
</div>`:""}

<div class="detail-grid">
<div><span>Seller</span><strong>${esc(current.full_name)}</strong></div>
<div><span>Phone</span><strong>${esc(current.phone)}</strong></div>
<div><span>Email</span><strong>${esc(current.email||"—")}${agent?` <em class="agent-inline">AGENT</em>`:""}</strong></div>
<div><span>ID / Passport</span><strong>${esc(current.id_number||"—")}</strong></div>
<div><span>Location</span><strong>${esc(current.location)}</strong></div>
<div><span>Contact Time</span><strong>${esc(current.contact_time||"Any Time")}</strong></div>
<div><span>Vehicle</span><strong>${esc(current.make)} ${esc(current.model)} ${esc(current.year)}</strong></div>
<div><span>Registration</span><strong>${esc(current.registration)}</strong></div>
<div><span>Colour</span><strong>${esc(current.colour)}</strong></div>
<div><span>Mileage</span><strong>${Number(current.mileage||0).toLocaleString()} KM</strong></div>
<div><span>Transmission</span><strong>${esc(current.transmission)}</strong></div>
<div><span>Fuel Type</span><strong>${esc(current.fuel_type)}</strong></div>
<div><span>Engine</span><strong>${esc(current.engine_cc)} CC</strong></div>
<div><span>Body Type</span><strong>${esc(current.body_type)}</strong></div>
<div><span>Condition</span><strong>${esc(current.condition)}</strong></div>
<div><span>Accident History</span><strong>${esc(current.accident_history)}</strong></div>
<div><span>Asking Price</span><strong>KES ${money(current.asking_price)}</strong></div>
<div><span>Negotiable</span><strong>${esc(current.negotiable)}</strong></div>
<div><span>Outstanding Loan</span><strong>${esc(current.loan)}</strong></div>
<div><span>Trade-In</span><strong>${esc(current.trade_in)}</strong></div>
<div><span>Submitted</span><strong>${date(current.created_at)}</strong></div>
</div>

<div class="notes">
<span>Additional Information</span>
<p>${esc(current.additional_info||"No additional information.")}</p>
</div>

${approvalPanel()}

<h3 class="files-title">Submitted Documents & Photos (${currentFiles.length})</h3>

${currentFiles.length?`<div class="files-grid">${currentFiles.map(fileCard).join("")}</div>`:`<div class="notes"><p>No files were submitted.</p></div>`}
`;

$("modalBody").innerHTML=html;
$("requestModal").classList.add("show");
document.body.classList.add("locked");

if(!current.approved_car_id&&isMainAdmin()){
$("negotiatedPrice")?.addEventListener("input",updateProfit);
$("inventoryPrice")?.addEventListener("input",updateProfit);
$("approveInventory")?.addEventListener("click",approveToInventory);
updateProfit();
}

}catch(e){
console.error(e);
alert(e.message||"Unable to load request.");
}
};

function updateProfit(){
let buy=Number($("negotiatedPrice")?.value||0),sell=Number($("inventoryPrice")?.value||0),profit=sell-buy,el=$("profitValue");
if(!el)return;
el.textContent=`KES ${money(profit)}`;
el.className=profit<0?"profit-negative":"profit-positive";
}

function imageFiles(){
return currentFiles.filter(f=>String(f.file_type||"").startsWith("image/")&&f.storage_path);
}

function safeName(name){
return String(name||"image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g,"-");
}

async function copyImageToCar(file,carId,index){
let source=file.storage_path,name=safeName(file.file_name||`image-${index}.jpg`),target=`${carId}/gallery/${crypto.randomUUID()}-${name}`;

let download=await supabase.storage.from("sell-car-files").download(source);
if(download.error)throw download.error;

let upload=await supabase.storage.from(BUCKET).upload(target,download.data,{cacheControl:"3600",upsert:false});
if(upload.error)throw upload.error;

let url=supabase.storage.from(BUCKET).getPublicUrl(target).data.publicUrl;

return{storage_path:target,image_url:url};
}

async function approveToInventory(){
if(!current||!isMainAdmin())return alert("Only the main administrator can approve vehicles into inventory.");
if(current.approved_car_id)return alert("This request has already been added to inventory.");

let buy=Number($("negotiatedPrice")?.value),sell=Number($("inventoryPrice")?.value);

if(!Number.isFinite(buy)||buy<0)return alert("Enter a valid negotiated purchase price.");
if(!Number.isFinite(sell)||sell<=0)return alert("Enter a valid inventory selling price.");

let name=`${current.make||""} ${current.model||""}`.trim()||"this vehicle";
if(!confirm(`Approve ${name} and add it to inventory for KES ${money(sell)}?`))return;

let button=$("approveInventory");
button.disabled=true;
button.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Adding to Inventory...`;

let uploaded=[];

try{
let{data:{session}}=await supabase.auth.getSession();
if(!session)throw new Error("Your session has expired. Please log in again.");

let requestCheck=await supabase.from("sell_car_requests").select("approved_car_id").eq("id",current.id).maybeSingle();
if(requestCheck.error)throw requestCheck.error;
if(requestCheck.data?.approved_car_id)throw new Error("This request has already been approved by another administrator.");

let colour=current.colour||null;

let carData={
make:current.make||null,
model:current.model||null,
year:current.year?Number(current.year):null,
price:sell,
purchase_price:buy,
condition:current.condition||null,
body_type:current.body_type||null,
mileage:current.mileage!=null&&current.mileage!==""?Number(current.mileage):null,
fuel_type:current.fuel_type||null,
transmission:current.transmission||null,
engine_size:current.engine_cc!=null&&current.engine_cc!==""?Number(current.engine_cc)/1000:null,
registration_number:current.registration||null,
location:current.location||null,
city:current.location||null,
exterior_color:colour,
accident_history:current.accident_history||null,
negotiable:String(current.negotiable||"").toLowerCase()==="yes"||current.negotiable===true,
status:"available",
featured:false,
financing_available:false,
test_drive_available:true,
source_request_id:current.id,
source_type:"sell_in",
created_at:new Date().toISOString(),
updated_at:new Date().toISOString()
};

let{data:car,error:carError}=await supabase.from("cars").insert(carData).select().single();
if(carError)throw carError;

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

let{error:updateError}=await supabase.from("sell_car_requests").update(requestUpdate).eq("id",current.id).is("approved_car_id",null);

if(updateError)throw updateError;

current={...current,...requestUpdate};
requests=requests.map(x=>x.id===current.id?current:x);

alert(`Vehicle approved and successfully added to inventory.${images.length?` ${images.length} image(s) were transferred.`:""} You can now complete the remaining vehicle information in the Edit Vehicle page.`);

closeRequest();
load();

}catch(e){
console.error(e);

if(uploaded.length){
await supabase.storage.from(BUCKET).remove(uploaded);
}

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

async function saveStatus(){
if(!current)return;

if(current.approved_car_id&&$("modalStatus").value!=="approved"){
if(!confirm("This request is already linked to an inventory vehicle. Change its request status anyway?"))return;
}

let{error}=await supabase.from("sell_car_requests").update({
status:$("modalStatus").value,
updated_at:new Date().toISOString()
}).eq("id",current.id);

if(error)return alert(error.message);

current.status=$("modalStatus").value;
requests=requests.map(x=>x.id===current.id?current:x);

closeRequest();
load();
}

async function deleteRequest(){
if(!current||!confirm(`Delete sell request from ${current.full_name||"this customer"}?`))return;

if(current.approved_car_id){
return alert("This request has already been converted into an inventory vehicle. Delete the vehicle first if you want to remove the full record.");
}

try{
let{data:fs,error:e}=await supabase.from("sell_car_files").select("storage_path").eq("request_id",current.id);
if(e)throw e;

let paths=(fs||[]).map(x=>x.storage_path).filter(Boolean);

if(paths.length){
let{error}=await supabase.storage.from("sell-car-files").remove(paths);
if(error)throw error;
}

let{error}=await supabase.from("sell_car_requests").delete().eq("id",current.id);
if(error)throw error;

closeRequest();
load();

}catch(e){
alert(e.message);
}
}

function closeRequest(){
$("requestModal").classList.remove("show");
document.body.classList.remove("locked");
current=null;
currentFiles=[];
}

$("searchInput").oninput=render;
$("statusFilter").onchange=render;
$("sortFilter").onchange=render;
$("refreshBtn").onclick=load;
$("saveStatus").onclick=saveStatus;
$("deleteRequest").onclick=deleteRequest;
$("closeRequest").onclick=closeRequest;
$("closeRequestBg").onclick=closeRequest;

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
location.href="auth.html";
};

window.addEventListener("load",()=>setTimeout(()=>$("loader").classList.add("hide"),450));

requireAdmin("sellcars").then(async allowed=>{
if(!allowed)return;
await auth();
load();
});