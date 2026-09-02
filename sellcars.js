import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id),grid=$("requestsGrid"),esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),money=v=>Number(v||0).toLocaleString("en-KE"),date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—",BUCKET="car-images";

let requests=[],current=null,currentAdmin=null,adminEmails=new Set(),currentFiles=[];

async function auth(){
const{data:{session}}=await supabase.auth.getSession();
if(!session){location.replace("auth.html");return null}
const{data,error}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();
if(error||!data){await supabase.auth.signOut();location.replace("auth.html");return null}
currentAdmin=data;return data
}

async function loadAdmins(){
const{data,error}=await supabase.from("admin_users").select("email");
if(error)throw error;
adminEmails=new Set((data||[]).map(x=>String(x.email||"").trim().toLowerCase()).filter(Boolean))
}

const isAgent=x=>adminEmails.has(String(x?.email||"").trim().toLowerCase()),isMainAdmin=()=>currentAdmin?.is_main_admin===true;

async function load(){
$("loading")&&($("loading").style.display="block");grid&&(grid.innerHTML="");$("empty")&&($("empty").style.display="none");$("error")&&$("error").classList.remove("active");
try{
await auth();await loadAdmins();
const{data,error}=await supabase.from("sell_car_requests").select("*").order("created_at",{ascending:false});
if(error)throw error;
requests=data||[];stats();render()
}catch(e){
console.error(e);if($("error")){$("error").textContent=e.message||"Unable to load requests.";$("error").classList.add("active")}
}finally{$("loading")&&($("loading").style.display="none")}
}

function stats(){
$("totalRequests").textContent=requests.length;$("newRequests").textContent=requests.filter(x=>(x.status||"new")==="new").length;$("contactedRequests").textContent=requests.filter(x=>x.status==="contacted").length;$("inspectedRequests").textContent=requests.filter(x=>x.status==="inspected").length;$("completedRequests").textContent=requests.filter(x=>x.status==="approved"||x.approved_car_id).length
}

function render(){
const q=($("searchInput")?.value||"").toLowerCase().trim(),s=$("statusFilter")?.value||"all",o=$("sortFilter")?.value||"newest";
let l=requests.filter(x=>{const t=`${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.registration||""} ${x.make||""} ${x.model||""} ${x.location||""}`.toLowerCase(),st=x.approved_car_id?"approved":(x.status||"new");return(!q||t.includes(q))&&(s==="all"||st===s)});
l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):o==="price-high"?(b.asking_price||0)-(a.asking_price||0):o==="price-low"?(a.asking_price||0)-(b.asking_price||0):new Date(b.created_at)-new Date(a.created_at));
$("empty").style.display=l.length?"none":"block";
if(!l.length){grid.innerHTML="";return}
grid.innerHTML=l.map(x=>{const st=x.approved_car_id?"approved":(x.status||"new"),agent=isAgent(x),approved=!!x.approved_car_id;return`<article class="request-card ${agent?"agent-request":""} ${approved?"approved-request":""}" data-id="${esc(x.id)}"><div class="request-top"><div class="request-badges"><span class="request-status ${esc(st)}">${approved?"in inventory":esc(st)}</span>${agent?`<span class="agent-tag"><i class="fa-solid fa-user-tie"></i> AGENT</span>`:""}</div><small>${date(x.created_at)}</small></div><h3>${esc(x.make||"Vehicle")} ${esc(x.model||"")} ${esc(x.year||"")}</h3><p><i class="fa-solid fa-user"></i> ${esc(x.full_name||"—")}</p><p><i class="fa-solid fa-phone"></i> ${esc(x.phone||"—")}</p><p><i class="fa-solid fa-location-dot"></i> ${esc(x.location||"—")}</p><div class="request-meta"><span>${esc(x.registration||"No registration")} · ${Number(x.mileage||0).toLocaleString()} KM</span><strong>KES ${money(x.asking_price)}</strong></div>${approved?`<div class="inventory-mini"><i class="fa-solid fa-circle-check"></i> Added to Inventory</div>`:""}<div class="request-bottom"><span>${esc(x.condition||"Condition —")}</span><button type="button">View Request <i class="fa-solid fa-arrow-right"></i></button></div></article>`}).join("")
}

function field(label,value){return`<div class="detail-field"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`}

function updateDetailStatus(status){
const b=$("detailStatusLabel");if(!b)return;b.className=`large-status ${status||"new"}`;b.textContent=status==="approved"?"IN INVENTORY":String(status||"new").toUpperCase()
}

async function getFiles(id){
try{
const{data,error}=await supabase.from("sell_car_files").select("*").eq("request_id",id).order("created_at",{ascending:true});
if(error){console.error(error);return[]}
return data||[]
}catch(e){console.error(e);return[]}
}

function publicSellUrl(path){return path?supabase.storage.from("sell-car-files").getPublicUrl(path).data.publicUrl:""}

function fileCard(f){
const url=publicSellUrl(f.storage_path),type=f.file_type||"",image=type.startsWith("image/"),video=type.startsWith("video/"),icon=video?"fa-video":type==="application/pdf"?"fa-file-pdf":"fa-file";
return`<div class="file-item">${image?`<img src="${esc(url)}" alt="${esc(f.file_name||"")}" loading="lazy">`:video?`<video src="${esc(url)}" controls></video>`:`<div class="file-icon"><i class="fa-solid ${icon}"></i></div>`}<div class="file-info"><strong>${esc(f.field_name||"File")}</strong><span>${esc(f.file_name||"")}</span>${url?`<a href="${esc(url)}" target="_blank" rel="noopener">Open File</a>`:""}</div></div>`
}

function approvalPanel(){
if(!current)return"";
if(current.approved_car_id){
const profit=Number(current.inventory_price||0)-Number(current.negotiated_price||0);
return`<section class="approval-panel approved-panel"><div class="approval-title"><div><i class="fa-solid fa-circle-check"></i></div><div><span>INVENTORY STATUS</span><h3>Vehicle Approved & Added</h3></div></div><div class="approval-summary"><div><span>Purchase Price</span><strong>KES ${money(current.negotiated_price)}</strong></div><div><span>Inventory Price</span><strong>KES ${money(current.inventory_price)}</strong></div><div><span>Estimated Gross Profit</span><strong class="${profit>=0?"profit-positive":"profit-negative"}">KES ${money(profit)}</strong></div></div><div class="approved-actions"><button type="button" class="inventory-btn" id="openInventoryBtn"><i class="fa-solid fa-pen-to-square"></i> Open & Edit Inventory Vehicle</button></div></section>`
}
if(!isMainAdmin())return`<section class="approval-panel locked-panel"><div class="approval-title"><div><i class="fa-solid fa-lock"></i></div><div><span>INVENTORY APPROVAL</span><h3>Main Admin Approval Required</h3><p>Only the main administrator can approve this vehicle and move it into inventory.</p></div></div></section>`;
return`<section class="approval-panel"><div class="approval-title"><div><i class="fa-solid fa-handshake"></i></div><div><span>INVENTORY APPROVAL</span><h3>Approve & Add to Inventory</h3><p>Enter the actual negotiated purchase price and the price Regional Autoselections will sell the vehicle for.</p></div></div><div class="asking-price"><span>Seller Asking Price</span><strong>KES ${money(current.asking_price)}</strong></div><div class="approval-grid"><div><label>Negotiated Purchase Price *</label><input id="negotiatedPrice" type="number" min="0" step="1" value="${current.negotiated_price??""}" placeholder="Actual amount paid for vehicle"></div><div><label>Inventory Selling Price *</label><input id="inventoryPrice" type="number" min="0" step="1" value="${current.inventory_price??""}" placeholder="Vehicle listing price"></div></div><div class="profit-box"><div><span>Estimated Gross Profit</span><strong id="profitValue">KES 0</strong></div><small>Selling price minus negotiated purchase price.</small></div><button id="approveInventory" type="button" class="approve-btn"><i class="fa-solid fa-car-side"></i> Approve & Add to Inventory</button></section>`
}

async function openRequest(id){
current=requests.find(x=>String(x.id)===String(id));if(!current)return;
const modal=$("requestModal");if(!modal)return;
const status=current.approved_car_id?"approved":(current.status||"new"),agent=isAgent(current);

$("modalTitle").textContent=`${current.make||""} ${current.model||""} ${current.year||""} — ${current.full_name||"Customer"}`.trim();
$("detailDate").textContent=date(current.created_at);
$("modalStatus").value=status;
updateDetailStatus(status);

$("agentBanner").innerHTML=agent?`<div class="agent-banner"><i class="fa-solid fa-user-tie"></i><div><strong>AGENT SUBMISSION</strong><span>This request was submitted using an administrator email.</span></div></div>`:"";

$("customerDetails").innerHTML=[
field("Full Name",current.full_name),field("Phone / WhatsApp",current.phone),field("Email",current.email||"—"),field("ID / Passport",current.id_number||"—"),field("Location",current.location||"—"),field("Contact Time",current.contact_time||"Any Time")
].join("");

const p=String(current.phone||"").replace(/\D/g,"").replace(/^0/,"254");
$("contactActions").innerHTML=[
p?`<a class="contact-action-large" href="tel:+${esc(p)}"><i class="fa-solid fa-phone"></i>Call Customer</a>`:"",
p?`<a class="contact-action-large whatsapp" href="https://wa.me/${esc(p)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>`:"",
current.email?`<a class="contact-action-large" href="mailto:${esc(current.email)}"><i class="fa-solid fa-envelope"></i>Email Customer</a>`:""
].join("");

$("financialDetails").innerHTML=[
field("Asking Price",`KES ${money(current.asking_price)}`),field("Negotiable",current.negotiable||"—"),field("Outstanding Loan",current.loan||"—"),field("Open to Trade-In",current.trade_in||"—")
].join("");

$("additionalDetails").innerHTML=[
field("Additional Information",current.additional_info||"—"),field("Submitted",date(current.created_at)),field("Request ID",current.id),field("Status",status)
].join("");

$("vehicleTitle").textContent=`${current.make||"Vehicle"} ${current.model||""} ${current.year||""}`.trim();
$("vehicleMeta").textContent=[current.registration,current.location].filter(Boolean).join(" • ")||"Sell-in vehicle";

$("vehicleDetails").innerHTML=[
field("Make",current.make),field("Model",current.model),field("Year",current.year),field("Registration",current.registration),field("Colour",current.colour),field("Mileage",current.mileage!=null?`${Number(current.mileage).toLocaleString()} km`:"—"),field("Transmission",current.transmission),field("Fuel Type",current.fuel_type),field("Engine",current.engine_cc?`${current.engine_cc} CC`:"—"),field("Body Type",current.body_type),field("Condition",current.condition),field("Accident History",current.accident_history)
].join("");

$("approvalContent").innerHTML=approvalPanel();
$("requestModal").classList.add("show");
document.body.classList.add("locked");

currentFiles=await getFiles(id);
$("filesContent").innerHTML=currentFiles.length?`<div class="files-grid">${currentFiles.map(fileCard).join("")}</div>`:`<div class="notes"><p>No vehicle files were submitted.</p></div>`;

$("openInventoryBtn")?.addEventListener("click",openInventoryCar);

if(!current.approved_car_id&&isMainAdmin()){
$("negotiatedPrice")?.addEventListener("input",updateProfit);
$("inventoryPrice")?.addEventListener("input",updateProfit);
$("approveInventory")?.addEventListener("click",approveToInventory);
updateProfit()
}
}

function updateProfit(){
const buy=Number($("negotiatedPrice")?.value||0),sell=Number($("inventoryPrice")?.value||0),profit=sell-buy,el=$("profitValue");if(!el)return;el.textContent=`KES ${money(profit)}`;el.className=profit<0?"profit-negative":"profit-positive"
}

function imageFiles(){return currentFiles.filter(f=>String(f.file_type||"").startsWith("image/")&&f.storage_path)}

function safeName(name){return String(name||"image.jpg").toLowerCase().replace(/[^a-z0-9.]+/g,"-")}

async function copyImageToCar(file,carId,index){
const download=await supabase.storage.from("sell-car-files").download(file.storage_path);if(download.error)throw download.error;
const target=`${carId}/gallery/${crypto.randomUUID()}-${safeName(file.file_name||`image-${index}.jpg`)}`;
const upload=await supabase.storage.from(BUCKET).upload(target,download.data,{cacheControl:"3600",upsert:false});
if(upload.error)throw upload.error;
return{storage_path:target,image_url:supabase.storage.from(BUCKET).getPublicUrl(target).data.publicUrl}
}

async function approveToInventory(){
if(!current||!isMainAdmin())return alert("Only the main administrator can approve vehicles into inventory.");
if(current.approved_car_id)return alert("This request has already been added to inventory.");
const buy=Number($("negotiatedPrice")?.value),sell=Number($("inventoryPrice")?.value);
if(!Number.isFinite(buy)||buy<0)return alert("Enter a valid negotiated purchase price.");
if(!Number.isFinite(sell)||sell<=0)return alert("Enter a valid inventory selling price.");
const name=`${current.make||""} ${current.model||""}`.trim()||"this vehicle";
if(!confirm(`Approve ${name} and add it to inventory for KES ${money(sell)}?`))return;
const button=$("approveInventory");button.disabled=true;button.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> Adding to Inventory...`;
const uploaded=[];
try{
const{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("Your session has expired. Please log in again.");
const check=await supabase.from("sell_car_requests").select("approved_car_id").eq("id",current.id).maybeSingle();if(check.error)throw check.error;if(check.data?.approved_car_id)throw new Error("This request has already been approved by another administrator.");
const existing=await supabase.from("cars").select("*").eq("source_request_id",current.id).maybeSingle();if(existing.error)throw existing.error;
let car=existing.data;
if(!car){
const carData={make:current.make||null,model:current.model||null,year:current.year?Number(current.year):null,price:sell,purchase_price:buy,condition:current.condition||null,body_type:current.body_type||null,mileage:current.mileage!=null&&current.mileage!==""?Number(current.mileage):null,fuel_type:current.fuel_type||null,transmission:current.transmission||null,engine_size:current.engine_cc!=null&&current.engine_cc!==""?Number(current.engine_cc)/1000:null,registration_number:current.registration||null,location:current.location||null,city:current.location||null,exterior_color:current.colour||null,accident_history:current.accident_history||null,negotiable:String(current.negotiable||"").toLowerCase()==="yes"||current.negotiable===true,status:"available",featured:false,financing_available:false,test_drive_available:true,source_request_id:current.id,source_type:"sell_in",created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
const r=await supabase.from("cars").insert(carData).select().single();if(r.error){if(r.error.code==="23505"){const q=await supabase.from("cars").select("*").eq("source_request_id",current.id).single();if(q.error)throw q.error;car=q.data}else throw r.error}else car=r.data
}
if(!existing.data){
const images=imageFiles();
for(let i=0;i<images.length;i++){const copied=await copyImageToCar(images[i],car.id,i);uploaded.push(copied.storage_path);const{error:imageError}=await supabase.from("car_images").insert({car_id:car.id,image_url:copied.image_url,storage_path:copied.storage_path,image_type:"gallery",display_order:i});if(imageError)throw imageError;if(i===0){const{error:displayError}=await supabase.from("cars").update({display_image_url:copied.image_url,display_image_path:copied.storage_path}).eq("id",car.id);if(displayError)throw displayError}}
}
const now=new Date().toISOString(),requestUpdate={status:"approved",negotiated_price:buy,inventory_price:sell,approved_car_id:car.id,approved_at:now,approved_by:session.user.id,updated_at:now};
const{error:updateError}=await supabase.from("sell_car_requests").update(requestUpdate).eq("id",current.id).is("approved_car_id",null);if(updateError)throw updateError;
current={...current,...requestUpdate};requests=requests.map(x=>x.id===current.id?current:x);
alert(`Vehicle approved and successfully added to inventory.${imageFiles().length?` ${imageFiles().length} image(s) were transferred.`:""}`);closeRequest();load()
}catch(e){
console.error(e);if(uploaded.length)await supabase.storage.from(BUCKET).remove(uploaded);alert(e.message||"Unable to add vehicle to inventory.");if(button){button.disabled=false;button.innerHTML=`<i class="fa-solid fa-car-side"></i> Approve & Add to Inventory`}
}
}

function openInventoryCar(){if(!current?.approved_car_id)return;location.href=`edit.html?id=${encodeURIComponent(current.approved_car_id)}`}

async function saveStatus(){
if(!current)return;
const status=$("modalStatus")?.value||"new";
if(current.approved_car_id&&status!=="approved"&&!confirm("This request is already linked to an inventory vehicle. Change its request status anyway?"))return;
const{error}=await supabase.from("sell_car_requests").update({status,updated_at:new Date().toISOString()}).eq("id",current.id);
if(error)return alert(error.message);
current.status=status;requests=requests.map(x=>x.id===current.id?current:x);updateDetailStatus(status);closeRequest();load()
}

async function deleteRequest(){
if(!current||!confirm(`Delete sell request from ${current.full_name||"this customer"}?`))return;
if(current.approved_car_id)return alert("This request has already been converted into an inventory vehicle. Delete the vehicle first if you want to remove the full record.");
try{
const{data:fs,error:e}=await supabase.from("sell_car_files").select("storage_path").eq("request_id",current.id);if(e)throw e;
const paths=(fs||[]).map(x=>x.storage_path).filter(Boolean);if(paths.length){const{error}=await supabase.storage.from("sell-car-files").remove(paths);if(error)throw error}
const{error}=await supabase.from("sell_car_requests").delete().eq("id",current.id);if(error)throw error;
closeRequest();load()
}catch(e){alert(e.message||"Unable to delete request.")}
}

function closeRequest(){
$("requestModal")?.classList.remove("show");document.body.classList.remove("locked");current=null;currentFiles=[]
}

grid.addEventListener("click",e=>{const card=e.target.closest(".request-card");if(!card)return;openRequest(card.dataset.id)});
$("searchInput")?.addEventListener("input",render);
$("statusFilter")?.addEventListener("change",render);
$("sortFilter")?.addEventListener("change",render);
$("refreshBtn")?.addEventListener("click",load);
$("modalStatus")?.addEventListener("change",e=>updateDetailStatus(e.target.value));
$("saveStatus")?.addEventListener("click",saveStatus);
$("deleteRequest")?.addEventListener("click",deleteRequest);
$("closeRequest")?.addEventListener("click",closeRequest);
$("closeRequestBg")?.addEventListener("click",closeRequest);
$("menu")?.addEventListener("click",()=>{$("sidebar")?.classList.add("open");$("overlay")?.classList.add("show")});
$("closeMenu")?.addEventListener("click",()=>{$("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show")});
$("overlay")?.addEventListener("click",()=>{$("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show")});
$("logoutBtn")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("auth.html")});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&current)closeRequest()});
window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));

requireAdmin("sellcars").then(async allowed=>{if(!allowed)return;await auth();load()});