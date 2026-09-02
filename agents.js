import{supabase}from"./supabase.js";

const $=id=>document.getElementById(id);

const grid=$("submissionsGrid");

const AGENT_BUCKET="agent-vehicle-files";
const INVENTORY_BUCKET="car-images";

let admin=null;
let rows=[];
let current=null;
let settings={
approval_amount:0,
sale_amount:0
};
let filesBySubmission={};

const PHOTO_CATEGORIES=[
["front","Front"],
["front_left","Front-left"],
["left_side","Left side"],
["rear_left","Rear-left"],
["rear","Rear"],
["rear_right","Rear-right"],
["right_side","Right side"],
["front_right","Front-right"],
["interior_front","Interior – front"],
["interior_rear","Interior – rear"],
["dashboard","Dashboard"],
["odometer","Odometer"],
["engine_bay","Engine bay"],
["wheels_tyres","Wheels / tyres"],
["damage_feature","Damage / notable feature"]
];

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({
"&":"&amp;",
"<":"&lt;",
">":"&gt;",
'"':"&quot;",
"'":"&#039;"
}[m]));

const money=v=>
`KES ${Number(v||0).toLocaleString("en-KE")}`;

const date=v=>
v
?new Date(v).toLocaleString("en-KE",{
dateStyle:"medium",
timeStyle:"short"
})
:"—";

const showError=text=>{

const el=$("error");

if(!el)return;

el.textContent=text||"";
el.classList.toggle(
"active",
Boolean(text)
);

};

const auth=async()=>{

const{
data:{session},
error
}=await supabase.auth.getSession();

if(error)
throw error;

if(!session){

location.replace("auth.html");
return null;

}

const{
data,
error:adminError
}=await supabase
.from("admin_users")
.select(
"id,email,is_main_admin,full_name"
)
.eq("id",session.user.id)
.maybeSingle();

if(adminError)
throw adminError;

if(!data){

await supabase.auth.signOut();

location.replace("auth.html");

return null;

}

admin=data;

return data;

};

const loadSettings=async()=>{

try{

const{
data,
error
}=await supabase
.from("admin_payment_settings")
.select("*")
.limit(1)
.maybeSingle();

if(error){

console.warn(
"Payment settings unavailable:",
error
);

return;

}

settings={
approval_amount:Number(
data?.approval_amount||0
),
sale_amount:Number(
data?.sale_amount||0
)
};

}catch(e){

console.warn(
"Payment settings skipped:",
e
);

}

};

const loadFiles=async()=>{

const{
data,
error
}=await supabase
.from("agent_vehicle_files")
.select("*")
.order(
"display_order",
{ascending:true}
);

if(error)
throw error;

filesBySubmission={};

for(const f of data||[]){

if(!filesBySubmission[f.submission_id])
filesBySubmission[f.submission_id]=[];

filesBySubmission[
f.submission_id
].push(f);

}

};

const signedUrl=async path=>{

if(!path)return"";

try{

const{
data,
error
}=await supabase
.storage
.from(AGENT_BUCKET)
.createSignedUrl(
path,
3600
);

if(error){

console.warn(
"Unable to create signed URL:",
error
);

return"";

}

return data?.signedUrl||"";

}catch(e){

console.warn(
"Signed URL error:",
e
);

return"";

}

};

const getInventory=async()=>{

const{
data,
error
}=await supabase
.from("cars")
.select(
"id,status,source_request_id,source_type,registration_number"
);

if(error)
throw error;

return data||[];

};

const workflowStatus=x=>{

if(x._car?.status==="sold")
return"sold";

if(x._car?.status==="reserved")
return"reserved";

if(x._car)
return"approved";

if(x.approved_car_id)
return"approved";

return String(
x.status||"pending"
).toLowerCase();

};

const statusLabel=s=>({

pending:"Pending",

reviewing:"Under Review",

returned:"Returned",

rejected:"Rejected",

approved:"Approved",

sold:"Sold",

reserved:"Reserved"

}[s]||s);

const load=async()=>{

const logged=await auth();

if(!logged)
return;

$("loading").style.display="block";

showError("");

try{

await loadSettings();

const{
data:submissions,
error:submissionError
}=await supabase
.from("agent_vehicle_submissions")
.select("*")
.order(
"created_at",
{ascending:false}
);

if(submissionError)
throw submissionError;

let cars=[];

try{

cars=await getInventory();

}catch(e){

console.warn(
"Inventory query failed:",
e
);

}

try{

await loadFiles();

}catch(e){

console.warn(
"Agent files query failed:",
e
);

filesBySubmission={};

}

rows=(submissions||[]).map(x=>({

...x,

_car:cars.find(c=>
String(c.source_request_id)===
String(x.id)&&
c.source_type==="agent"
)||null

}));

renderStats();

await render();

}catch(e){

console.error(
"AGENT SUBMISSIONS LOAD ERROR:",
e
);

showError(
e.message||
"Unable to load agent submissions."
);

$("submissionsGrid").innerHTML="";

$("empty").style.display="block";

}finally{

$("loading").style.display="none";

$("loader")?.classList.add("hide");

}

};

const renderStats=()=>{

$("totalRequests").textContent=
rows.length;

$("pendingRequests").textContent=
rows.filter(x=>
["pending","reviewing"]
.includes(
workflowStatus(x)
)
).length;

$("approvedRequests").textContent=
rows.filter(x=>
workflowStatus(x)==="approved"
).length;

$("inventoryRequests").textContent=
rows.filter(x=>!!x._car).length;

$("soldRequests").textContent=
rows.filter(x=>
workflowStatus(x)==="sold"
).length;

};

const render=async()=>{

const q=(
$("searchInput").value||""
)
.toLowerCase()
.trim();

const filter=
$("statusFilter").value;

const sort=
$("sortFilter").value;

let list=rows.filter(x=>{

const text=`

${x.agent_name||""}
${x.agent_email||""}
${x.registration_number||""}
${x.make||""}
${x.model||""}
${x.year||""}
${x.town_area||""}
${x.county||""}

`.toLowerCase();

const s=workflowStatus(x);

return(
!q||
text.includes(q)
)&&(
filter==="all"||
s===filter
);

});

list.sort((a,b)=>{

if(sort==="oldest")
return new Date(a.created_at)-
new Date(b.created_at);

if(sort==="price-high")
return Number(b.asking_price||0)-
Number(a.asking_price||0);

if(sort==="price-low")
return Number(a.asking_price||0)-
Number(b.asking_price||0);

return new Date(b.created_at)-
new Date(a.created_at);

});

const html=await Promise.all(
list.map(async x=>{

const s=workflowStatus(x);

const name=
`${x.make||"Vehicle"} ${
x.model||""
} ${
x.year||""
}`.trim();

const files=
filesBySubmission[x.id]||[];

let image="";

if(files[0]?.storage_path)
image=await signedUrl(
files[0].storage_path
);

const agentName=
x.agent_name||
x.agent_email||
"Agent";

return`

<article
class="submission-card"
data-id="${esc(x.id)}"
>

<div class="submission-image">

${
image

?`

<img
src="${esc(image)}"
alt="${esc(name)}"
>

`

:`

<div class="no-image">
<i class="fa-solid fa-car"></i>
</div>

`
}

<span
class="submission-status ${esc(s)}"
>

${esc(statusLabel(s))}

</span>

<span class="submission-agent">

<i class="fa-solid fa-user-tie"></i>
AGENT

</span>

</div>

<div class="submission-body">

<h3>
${esc(name)}
</h3>

<p>
${esc(
x.registration_number||
"No registration"
)}
·
${esc(
x.town_area||
x.county||
"Location not set"
)}
</p>

<div class="submission-price">
${money(x.asking_price)}
</div>

</div>

</article>

`;

})
);

grid.innerHTML=html.join("");

$("empty").style.display=
list.length?"none":"block";

};

const field=(label,value)=>`

<div class="detail-field">

<span>
${esc(label)}
</span>

<strong>
${esc(
value===null||
value===undefined||
value===""
?"—"
:value
)}
</strong>

</div>

`;

const open=async id=>{

current=
rows.find(
x=>String(x.id)===String(id)
);

if(!current)
return;

try{

const s=workflowStatus(
current
);

const files=
filesBySubmission[current.id]||[];

$("modalTitle").textContent=
`${current.make||"Vehicle"} ${
current.model||""
} ${
current.year||""
}`.trim();

$("modalMeta").textContent=
`${current.listing_reference||
current.id}
·
${date(current.created_at)}`;

$("detailStatus").textContent=
statusLabel(s).toUpperCase();

$("detailStatus").className=
`status-badge ${s}`;

$("modalStatus").value=
[
"pending",
"reviewing",
"returned",
"rejected"
].includes(s)
?s
:"approved";

$("agentDetails").innerHTML=[

field(
"Agent Name",
current.agent_name
),

field(
"Agent Email",
current.agent_email
),

field(
"Agent ID",
current.agent_id
)

].join("");

$("vehicleDetails").innerHTML=[

field(
"Registration Number",
current.registration_number
),

field(
"Make",
current.make
),

field(
"Model",
current.model
),

field(
"Year of Manufacture",
current.year
),

field(
"Body Type",
current.body_type
),

field(
"Engine Capacity",
current.engine_cc
?`${Number(
current.engine_cc
).toLocaleString()} CC`
:"—"
),

field(
"Fuel Type",
current.fuel_type
),

field(
"Transmission",
current.transmission
),

field(
"Mileage",
current.mileage!=null
?`${Number(
current.mileage
).toLocaleString()} KM`
:"—"
),

field(
"Exterior Colour",
current.exterior_color
),

field(
"Drive Type",
current.drive_type
),

field(
"Number of Seats",
current.seats
),

field(
"Asking Price",
money(current.asking_price)
),

field(
"Condition",
current.condition
),

field(
"Key Features",
current.key_features
),

field(
"Photo Count",
current.photo_count
)

].join("");

$("locationDetails").innerHTML=[

field(
"Showroom / Car Yard",
current.showroom_name
),

field(
"Town / Area",
current.town_area
),

field(
"County",
current.county
),

field(
"Latitude",
current.latitude
),

field(
"Longitude",
current.longitude
),

field(
"GPS Accuracy",
current.location_accuracy
?`${Number(
current.location_accuracy
).toLocaleString()} metres`
:"—"
),

field(
"GPS Captured",
current.gps_captured_at
?date(current.gps_captured_at)
:"—"
),

field(
"Captured By",
current.gps_captured_by
)

].join("");

$("descriptionDetails").innerHTML=`

<div class="description-box">
${esc(
current.description||
"No description provided."
)}
</div>

<div style="
display:grid;
grid-template-columns:repeat(3,1fr);
gap:8px;
margin-top:10px;
">

<div class="approval-lock">
<strong>Vehicle Viewed</strong><br>
${
current.declaration_vehicle_viewed
?"Confirmed"
:"Not confirmed"
}
</div>

<div class="approval-lock">
<strong>Photos Authentic</strong><br>
${
current.declaration_photos_authentic
?"Confirmed"
:"Not confirmed"
}
</div>

<div class="approval-lock">
<strong>Unpublished</strong><br>
${
current.declaration_unpublished_ack
?"Acknowledged"
:"Not acknowledged"
}
</div>

</div>

`;

const photoHtml=await Promise.all(

files.map(async f=>{

const url=
await signedUrl(
f.storage_path
);

const label=
PHOTO_CATEGORIES.find(
x=>x[0]===
f.photo_category
)?.[1]||
f.photo_category||
"Photo";

return`

<div
style="
border:1px solid var(--line);
background:#fff;
overflow:hidden;
"
>

${
url

?`

<a
href="${esc(url)}"
target="_blank"
rel="noopener"
style="
display:block;
height:125px;
background:#edf2f5;
"
>

<img
src="${esc(url)}"
alt="${esc(label)}"
style="
width:100%;
height:100%;
object-fit:cover;
display:block;
"
>

</a>

`

:`

<div style="
height:125px;
display:grid;
place-items:center;
background:#edf2f5;
color:#9aabb7;
"
>

<i class="fa-solid fa-image"></i>

</div>

`
}

<div style="padding:8px">

<strong style="
display:block;
font-size:8px;
"
>

${esc(label)}

</strong>

<small style="
display:block;
margin-top:3px;
font-size:7px;
color:var(--muted);
overflow:hidden;
white-space:nowrap;
text-overflow:ellipsis;
"
>

${esc(
f.file_name||""
)}

</small>

</div>

</div>

`;

})

);

$("photoGrid").innerHTML=
photoHtml.length
?photoHtml.join("")
:`

<div class="approval-lock">
No submission photos found.
</div>

`;

if(current._car){

$("inventoryLink").innerHTML=`

<div class="inventory-link">

<span>
${esc(
current._car.registration_number||
current._car.id
)}
</span>

<a
href="edit.html?id=${encodeURIComponent(
current._car.id
)}"
>

Open Inventory

<i class="fa-solid fa-arrow-up-right-from-square"></i>

</a>

</div>

${
current._car.status==="sold"

?`

<div class="agent-sales-note">
Vehicle is sold and counts as an agent sale.
</div>

`
:""
}

`;

}else{

$("inventoryLink").innerHTML=`

<div class="approval-lock">
Not yet added to inventory.
</div>

`;

}

await renderPaymentEvents();

renderApproval();

$("detailModal")
.classList.add("show");

document.body.classList.add("locked");

}catch(e){

console.error(e);

alert(
e.message||
"Unable to open submission."
);

}

};

const renderPaymentEvents=async()=>{

if(!current)
return;

try{

const{
data,
error
}=await supabase
.from("admin_payments")
.select("*")
.eq(
"admin_id",
current.agent_id
)
.or(
`vehicle_id.eq.${current.id},source_request_id.eq.${current.id}`
)
.order(
"created_at",
{ascending:false}
);

if(error)
throw error;

const list=data||[];

const approval=list
.filter(x=>x.type==="approval")
.reduce(
(s,x)=>s+Number(x.amount||0),
0
);

const sale=list
.filter(x=>x.type==="sale")
.reduce(
(s,x)=>s+Number(x.amount||0),
0
);

const total=list.reduce(
(s,x)=>s+Number(x.amount||0),
0
);

$("approvalEarned").textContent=
money(approval);

$("saleEarned").textContent=
money(sale);

$("agentEarnings").textContent=
money(total);

$("paymentEvents").innerHTML=
list.length

?list.map(x=>`

<div class="payment-event">

<div>

<strong>
${x.type==="sale"
?"Sale"
:"Approval"}
</strong>

<span>
${date(x.created_at)}
</span>

</div>

<div>

<div class="payment-amount">
${money(x.amount)}
</div>

<div class="
payment-state
${x.paid?"paid":"unpaid"}
">

${x.paid?"Paid":"Unpaid"}

</div>

</div>

</div>

`).join("")

:`

<div class="approval-lock">
No payment events recorded.
</div>

`;

}catch(e){

console.warn(
"Payment events unavailable:",
e
);

$("approvalEarned").textContent=
"KES 0";

$("saleEarned").textContent=
"KES 0";

$("agentEarnings").textContent=
"KES 0";

$("paymentEvents").innerHTML=`

<div class="approval-lock">
Payment information unavailable.
</div>

`;

}

};

const renderApproval=()=>{

if(!current)
return;

const approved=
Boolean(
current._car||
current.approved_car_id
);

if(approved){

$("approvalCard").innerHTML=`

<div class="detail-card-head">

<div>

<span class="section-kicker">
INVENTORY
</span>

<h3>
Approved Vehicle
</h3>

</div>

<i class="fa-solid fa-circle-check"></i>

</div>

<div class="agent-sales-note">

This submission has been approved and linked to inventory.

</div>

`;

return;

}

if(current.status==="returned"){

$("approvalCard").innerHTML=`

<div class="detail-card-head">

<div>

<span class="section-kicker">
ACTION REQUIRED
</span>

<h3>
Returned Listing
</h3>

</div>

<i class="fa-solid fa-rotate-left"></i>

</div>

<div class="approval-lock">

<strong>
Return Reason
</strong>

<p style="margin:6px 0 0">
${esc(
current.returned_reason||
"No return reason recorded."
)}
</p>

</div>

`;

}

if(
admin?.is_main_admin!==true
){

if(current.status!=="returned"){

$("approvalCard").innerHTML=`

<div class="detail-card-head">

<div>

<span class="section-kicker">
APPROVAL
</span>

<h3>
Main Admin Approval Required
</h3>

</div>

<i class="fa-solid fa-lock"></i>

</div>

<div class="approval-lock">

Only the main administrator can approve this agent submission into inventory.

</div>

`;

}

return;

}

$("approvalCard").innerHTML=`

<div class="detail-card-head">

<div>

<span class="section-kicker">
INVENTORY APPROVAL
</span>

<h3>
Approve & Add to Inventory
</h3>

</div>

<i class="fa-solid fa-car-side"></i>

</div>

<div class="approval-grid">

<div>

<label>
Purchase Price
</label>

<input
id="buyPrice"
type="number"
min="0"
value="${Number(
current.purchase_price||
current.asking_price||
0
)}"
>

</div>

<div>

<label>
Inventory Selling Price
</label>

<input
id="sellPrice"
type="number"
min="1"
value="${Number(
current.inventory_price||
current.asking_price||
0
)}"
>

</div>

</div>

<div class="profit-box">

<span>
Estimated Gross Profit
</span>

<strong id="profitValue">
KES 0
</strong>

</div>

<div style="
display:grid;
grid-template-columns:1fr 1fr;
gap:8px;
margin-top:10px;
">

<button
id="returnBtn"
class="approval-action"
type="button"
style="
background:#fff;
border:1px solid #d89b9b;
color:#b42318;
"
>

<i class="fa-solid fa-rotate-left"></i>

Return Listing

</button>

<button
id="approveBtn"
class="approval-action"
type="button"
>

<i class="fa-solid fa-circle-check"></i>

Approve & Add to Inventory

</button>

</div>

`;

$("buyPrice").oninput=
$("sellPrice").oninput=()=>{

$("profitValue").textContent=
money(
Number(
$("sellPrice").value||0
)-
Number(
$("buyPrice").value||0
)
);

};

$("buyPrice").oninput();

$("approveBtn").onclick=
approve;

$("returnBtn").onclick=
returnListing;

};

const returnListing=async()=>{

if(!current)
return;

if(admin?.is_main_admin!==true){

alert(
"Only the main administrator can return agent listings."
);

return;

}

const reason=prompt(
"Enter the reason for returning this listing:"
);

if(!reason?.trim())
return;

const button=$("returnBtn");

if(button){

button.disabled=true;

button.innerHTML=
'<i class="fa-solid fa-spinner fa-spin"></i> Returning...';

}

try{

const now=
new Date().toISOString();

const{
error
}=await supabase
.from("agent_vehicle_submissions")
.update({

status:"returned",

returned_reason:
reason.trim(),

returned_at:now,

returned_by:admin.id,

updated_at:now

})
.eq("id",current.id);

if(error)
throw error;

const{
error:actionError
}=await supabase
.from("agent_vehicle_actions")
.insert({

agent_id:current.agent_id,

submission_id:current.id,

action_type:"correction",

title:"Action Required",

message:reason.trim(),

completed:false,

created_at:now

});

if(actionError){

console.warn(
"Action record failed:",
actionError
);

}

alert(
"Listing returned to the agent."
);

close();

await load();

}catch(e){

console.error(e);

alert(
e.message||
"Unable to return listing."
);

if(button){

button.disabled=false;

button.innerHTML=
'<i class="fa-solid fa-rotate-left"></i> Return Listing';

}

}

};

const approve=async()=>{

if(!current)
return;

if(admin?.is_main_admin!==true){

alert(
"Only the main administrator can approve agent vehicles."
);

return;

}

const buy=
Number(
$("buyPrice")?.value||0
);

const sell=
Number(
$("sellPrice")?.value||0
);

if(
!Number.isFinite(buy)||
buy<0||
!Number.isFinite(sell)||
sell<=0
){

alert(
"Enter valid purchase and selling prices."
);

return;

}

const button=$("approveBtn");

if(!confirm(
`Approve ${
current.make||""
} ${
current.model||""
} and add it to inventory?`
))
return;

button.disabled=true;

button.innerHTML=
'<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

try{

const{
data:{session}
}=await supabase.auth.getSession();

if(!session)
throw new Error("Session expired.");

const{
data:existingSubmission,
error:submissionError
}=await supabase
.from("agent_vehicle_submissions")
.select("approved_car_id")
.eq("id",current.id)
.maybeSingle();

if(submissionError)
throw submissionError;

if(existingSubmission?.approved_car_id)
throw new Error(
"This submission is already approved."
);

let car=current._car;

if(!car){

const carData={

make:current.make||null,

model:current.model||null,

year:current.year
?Number(current.year)
:null,

price:sell,

purchase_price:buy,

condition:current.condition||null,

body_type:current.body_type||null,

mileage:current.mileage!=null
?Number(current.mileage)
:null,

fuel_type:current.fuel_type||null,

transmission:current.transmission||null,

engine_size:current.engine_cc
?Number(current.engine_cc)/1000
:null,

registration_number:
current.registration_number||
null,

location:
current.town_area||
null,

city:
current.town_area||
null,

exterior_color:
current.exterior_color||
null,

status:"available",

featured:false,

financing_available:false,

test_drive_available:true,

source_request_id:
current.id,

source_type:"agent",

agent_id:
current.agent_id||
null,

agent_email:
current.agent_email||
null,

agent_name:
current.agent_name||
null,

created_at:new Date()
.toISOString(),

updated_at:new Date()
.toISOString()

};

const{
data,
error
}=await supabase
.from("cars")
.insert(carData)
.select()
.single();

if(error)
throw error;

car=data;

}

const submissionFiles=
filesBySubmission[current.id]||[];

for(
let i=0;
i<submissionFiles.length;
i++
){

const f=submissionFiles[i];

if(!f.storage_path)
continue;

const download=
await supabase
.storage
.from(AGENT_BUCKET)
.download(
f.storage_path
);

if(download.error)
throw download.error;

const safe=
String(
f.file_name||
`image-${i+1}.jpg`
)
.toLowerCase()
.replace(
/[^a-z0-9.]+/g,
"-"
);

const target=
`${car.id}/gallery/${
String(i+1).padStart(2,"0")
}-${safe}`;

const upload=
await supabase
.storage
.from(INVENTORY_BUCKET)
.upload(
target,
download.data,
{
contentType:
f.file_type||
"image/jpeg",
cacheControl:"3600",
upsert:false
}
);

if(upload.error)
throw upload.error;

const publicUrl=
supabase
.storage
.from(INVENTORY_BUCKET)
.getPublicUrl(target)
.data
.publicUrl;

const{
error:imageError
}=await supabase
.from("car_images")
.insert({

car_id:car.id,

image_url:publicUrl,

storage_path:target,

image_type:"gallery",

display_order:i

});

if(imageError)
throw imageError;

if(i===0){

const{
error:coverError
}=await supabase
.from("cars")
.update({

display_image_url:
publicUrl,

display_image_path:
target,

updated_at:
new Date().toISOString()

})
.eq("id",car.id);

if(coverError)
throw coverError;

}

}

const now=
new Date().toISOString();

const{
error:updateError
}=await supabase
.from("agent_vehicle_submissions")
.update({

status:"approved",

purchase_price:buy,

inventory_price:sell,

approved_car_id:car.id,

approved_at:now,

approved_by:
session.user.id,

updated_at:now

})
.eq("id",current.id)
.is("approved_car_id",null);

if(updateError)
throw updateError;

const{
data:existingPayment,
error:paymentLookupError
}=await supabase
.from("admin_payments")
.select("id")
.eq(
"admin_id",
current.agent_id
)
.eq(
"type",
"approval"
)
.eq(
"source_request_id",
current.id
)
.maybeSingle();

if(
paymentLookupError&&
paymentLookupError.code!=="PGRST116"
)
throw paymentLookupError;

if(
!existingPayment&&
Number(settings.approval_amount)>0
){

const{
error:paymentError
}=await supabase
.from("admin_payments")
.insert({

admin_id:
current.agent_id,

type:"approval",

amount:
Number(
settings.approval_amount
),

vehicle:
`${current.make||""} ${
current.model||""
}`.trim(),

vehicle_id:
car.id,

source_request_id:
current.id,

paid:false,

created_at:now

});

if(paymentError)
throw paymentError;

}

alert(
"Agent vehicle approved and added to inventory."
);

close();

await load();

}catch(e){

console.error(e);

alert(
e.message||
"Unable to approve vehicle."
);

button.disabled=false;

button.innerHTML=
'<i class="fa-solid fa-circle-check"></i> Approve & Add to Inventory';

}

};

const saveStatus=async()=>{

if(!current)
return;

const newStatus=
$("modalStatus").value;

if(newStatus==="approved"){

if(!current._car){

alert(
"Use Approve & Add to Inventory for this submission."
);

return;

}

}

if(newStatus==="returned"){

await returnListing();

return;

}

if(
newStatus!=="pending"&&
newStatus!=="reviewing"&&
newStatus!=="rejected"
){

alert("Invalid submission status.");

return;

}

const{
error
}=await supabase
.from("agent_vehicle_submissions")
.update({

status:newStatus,

updated_at:
new Date().toISOString()

})
.eq("id",current.id);

if(error){

alert(error.message);

return;

}

close();

await load();

};

const deleteSubmission=async()=>{
 if(!current||!confirm(`Delete ${current.make||"vehicle"} ${current.model||""} submission from ${current.agent_name||"this agent"}?`))return;
 const id=current.id;
 const files=filesBySubmission[id]||[];
 const button=$("deleteSubmission");
 if(button){button.disabled=true;button.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Deleting...'}
 try{
  const{error:fileError}=await supabase.from("agent_vehicle_files").delete().eq("submission_id",id);
  if(fileError)throw fileError;
  const{error:actionError}=await supabase.from("agent_vehicle_actions").delete().eq("submission_id",id);
  if(actionError)console.warn(actionError);
  for(const f of files)if(f.storage_path)await supabase.storage.from(AGENT_BUCKET).remove([f.storage_path]);
  const{error}=await supabase.from("agent_vehicle_submissions").delete().eq("id",id);
  if(error)throw error;
  close();
  await load();
 }catch(e){
  alert(e.message||"Unable to delete submission.");
  if(button){button.disabled=false;button.innerHTML='<i class="fa-solid fa-trash"></i> Delete'}
 }
};

const close=()=>{

$("detailModal")
?.classList.remove("show");

document.body.classList.remove("locked");

current=null;

};

grid.addEventListener(
"click",
e=>{

const card=
e.target.closest(
".submission-card"
);

if(card)
open(card.dataset.id);

}
);

$("searchInput").oninput=
render;

$("statusFilter").onchange=
render;

$("sortFilter").onchange=
render;

$("refreshBtn").onclick=
load;

$("saveStatus").onclick=
saveStatus;

$("deleteSubmission").onclick=deleteSubmission;

$("closeModal").onclick=
close;

$("modalBg").onclick=
close;

$("menu").onclick=()=>{

$("sidebar")
.classList.add("open");

$("overlay")
.classList.add("show");

};

$("closeMenu").onclick=
$("overlay").onclick=()=>{

$("sidebar")
.classList.remove("open");

$("overlay").classList.remove("show");

};

$("logoutBtn").onclick=async()=>{

await supabase.auth.signOut();

location.replace("auth.html");

};

window.addEventListener(
"load",
()=>{

setTimeout(
()=>$("loader")?.classList.add("hide"),
250
);

}
);

load();