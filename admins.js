import{supabase}from"./supabase.js";import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id),pages=[["vehicles","Vehicle Listings","index.html","fa-car"],["tradeins","Trade-In Requests","tradeins.html","fa-right-left"],["imports","Import Requests","imports.html","fa-ship"],["financing","Financing Requests","financing.html","fa-coins"],["diaspora","Diaspora Requests","diaspora.html","fa-earth-africa"],["sellcars","Sell In Cars Requests'","sellcars.html","fa-car-side"],["accessiblecars","Accessible Car Requests","accessiblecars.html","fa-wheelchair"],["reservations","Reservation Requests","reservations.html","fa-calendar-check"],["testdrives","Test Drives","testdrives.html","fa-road"],["insurance","Insurance Requests","insurance.html","fa-shield-halved"],["admins","Manage Admins","admins.html","fa-user-shield"],["webpage","Manage Webpage","manage.html","fa-globe"]];

let admins=[],permissions={},current=null,me=null,paymentSettings={approval_amount:0,sale_amount:0},paymentRecords=[],paymentAdmin=null,paymentTab="approval";

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

const msg=(id,t)=>{
let x=$(id);
if(!x)return;
x.textContent=t;
x.classList.add("active");
setTimeout(()=>x.classList.remove("active"),3500)
};

const money=v=>`KES ${Number(v||0).toLocaleString("en-KE",{minimumFractionDigits:0,maximumFractionDigits:2})}`;

const close=()=>{
$("permissionModal")?.classList.remove("open");
current=null
};

const auth=async()=>{
const{data:{session}}=await supabase.auth.getSession();

if(!session){
location.replace("auth.html");
return null
}

const{data,error}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();

if(error||!data){
await supabase.auth.signOut();
location.replace("auth.html");
return null
}

if(!data.is_main_admin){
location.replace("index.html");
return null
}

return data
};

const load=async()=>{
$("loading").style.display="block";
$("adminsGrid").innerHTML="";

try{
me=await auth();
if(!me)return;

const{data,error}=await supabase.from("admin_users").select("*").order("email");
if(error)throw error;

const{data:p,error:pe}=await supabase.from("admin_permissions").select("*");
if(pe)throw pe;

admins=data||[];
permissions={};

(p||[]).forEach(x=>permissions[x.admin_id]=x.permissions||{});

$("adminCount").textContent=admins.length;

render();
await loadPayments()

}catch(e){
console.error(e);
msg("error",e.message||"Unable to load administrators.")
}finally{
$("loading").style.display="none"
}
};

const render=()=>{
$("adminsGrid").innerHTML=admins.map(a=>{
const email=a.email||a.id,n=email.split("@")[0],isMain=a.is_main_admin===true,p=permissions[a.id]||{},allowed=pages.filter(x=>p[x[0]]).length;

return`<article class="admin-card">
<div class="admin-card-top">
<div class="admin-avatar"><i class="fa-solid fa-user"></i></div>
<div class="admin-details"><strong>${esc(n)}</strong><span>${esc(email)}</span></div>
<span class="admin-role">${isMain?"Main Admin":"Administrator"}</span>
</div>
<div class="admin-card-body">
<div class="access-title">
<span>PAGE ACCESS</span>
<small class="access-count">${isMain?"All Access":`${allowed}/${pages.length} Pages`}</small>
</div>
<div class="access-list">
${isMain?`<span class="access-tag all"><i class="fa-solid fa-check"></i> Full Dashboard Access</span>`:pages.filter(x=>p[x[0]]).map(x=>`<span class="access-tag">${esc(x[1])}</span>`).join("")||`<span class="access-tag">No pages assigned</span>`}
</div>
<div class="admin-card-actions">
${me.is_main_admin&&!isMain?`
<button class="manage-btn" data-id="${a.id}"><i class="fa-solid fa-sliders"></i> Manage Page Access</button>
<button class="delete-admin" data-id="${a.id}"><i class="fa-solid fa-trash"></i> Remove Admin</button>
`:isMain?`<div class="main-admin"><i class="fa-solid fa-crown"></i>&nbsp; Full Administrative Control</div>`:""}
</div>
</div>
</article>`
}).join("");

document.querySelectorAll(".manage-btn").forEach(b=>b.onclick=()=>open(b.dataset.id));
document.querySelectorAll(".delete-admin").forEach(b=>b.onclick=()=>removeAdmin(b.dataset.id))
};

const open=id=>{
current=admins.find(a=>a.id===id);

if(!current||current.is_main_admin)return;

const p=permissions[id]||{};

$("modalAdminName").textContent=current.email;

$("pagePermissions").innerHTML=pages.map(x=>`
<label class="permission">
<input type="checkbox" data-page="${x[0]}" ${p[x[0]]===true?"checked":""}>
<i class="fa-solid ${x[3]}"></i>
<span>${esc(x[1])}<small>Allow access to ${esc(x[1])}</small></span>
</label>
`).join("");

$("permissionModal").classList.add("open")
};

const save=async()=>{
if(!current)return;

const p={};

$("pagePermissions").querySelectorAll("input").forEach(x=>p[x.dataset.page]=x.checked);

const{error}=await supabase.from("admin_permissions").upsert({
admin_id:current.id,
permissions:p,
updated_at:new Date().toISOString()
},{onConflict:"admin_id"});

if(error)throw error;

permissions[current.id]=p;

close();

msg("success","Administrator permissions updated successfully.");

render()
};

const addAdmin=async()=>{
const email=$("newAdminEmail").value.trim(),password=$("newAdminPassword").value,confirm=$("confirmAdminPassword").value;

if(!email||!password||!confirm)return msg("error","Complete all administrator fields.");
if(password!==confirm)return msg("error","Passwords do not match.");
if(password.length<8)return msg("error","Password must be at least 8 characters.");

try{
$("addAdminBtn").disabled=true;
$("addAdminBtn").textContent="Creating...";

const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"create",email,password}});

if(error)throw error;
if(data?.error)throw new Error(data.error);

$("newAdminEmail").value="";
$("newAdminPassword").value="";
$("confirmAdminPassword").value="";

msg("success",`${email} was created as an administrator.`);

await load()

}catch(e){
msg("error",e.message||"Unable to create administrator.")
}finally{
$("addAdminBtn").disabled=false;
$("addAdminBtn").innerHTML='<i class="fa-solid fa-user-plus"></i> Create Administrator'
}
};

const removeAdmin=async id=>{
const a=admins.find(x=>x.id===id);

if(!a||a.is_main_admin)return;

if(!confirm(`Permanently delete administrator ${a.email}? This will also remove their login account.`))return;

try{
const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"delete",id}});

if(error)throw error;
if(data?.error)throw new Error(data.error);

delete permissions[id];

msg("success",`${a.email} was deleted.`);

await load()

}catch(e){
msg("error",e.message||"Unable to delete administrator.")
}
};

async function loadPaymentSettings(){
try{
const{data,error}=await supabase.from("admin_payment_settings").select("*").maybeSingle();

if(error&&error.code!=="PGRST116")throw error;

paymentSettings={
approval_amount:Number(data?.approval_amount||0),
sale_amount:Number(data?.sale_amount||0)
};

if($("approvalPaymentAmount"))$("approvalPaymentAmount").value=paymentSettings.approval_amount||"";
if($("salePaymentAmount"))$("salePaymentAmount").value=paymentSettings.sale_amount||"";

}catch(e){
console.error("Payment settings error:",e)
}
}

async function loadPaymentRecords(){
try{
const{data,error}=await supabase.from("admin_payments").select("*").order("created_at",{ascending:false});

if(error)throw error;

paymentRecords=data||[];

}catch(e){
console.error("Payment records error:",e);
paymentRecords=[]
}
}

async function loadPayments(){
await loadPaymentSettings();
await loadPaymentRecords();
renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory()
}

const paymentStats=id=>{
const records=paymentRecords.filter(x=>x.admin_id===id),
approvals=records.filter(x=>x.type==="approval"),
sales=records.filter(x=>x.type==="sale"),
approvalPaid=approvals.filter(x=>x.paid===true).length,
salePaid=sales.filter(x=>x.paid===true).length,
approvalUnpaid=approvals.filter(x=>x.paid!==true).length,
saleUnpaid=sales.filter(x=>x.paid!==true).length,
earned=records.filter(x=>x.paid===true).reduce((s,x)=>s+Number(x.amount||0),0),
pending=records.filter(x=>x.paid!==true).reduce((s,x)=>s+Number(x.amount||0),0);

return{
approvals:approvals.length,
sales:sales.length,
approvalPaid,
salePaid,
approvalUnpaid,
saleUnpaid,
earned,
pending
}
};

const renderPaymentOverview=()=>{
const el=$("paymentOverview");
if(!el)return;

const staff=admins.filter(a=>!a.is_main_admin);
let approvals=0,sales=0,paid=0,pending=0;

staff.forEach(a=>{
const s=paymentStats(a.id);
approvals+=s.approvals;
sales+=s.sales;
paid+=s.earned;
pending+=s.pending
});

el.innerHTML=`
<div class="payment-overview-card">
<div class="payment-overview-icon"><i class="fa-solid fa-circle-check"></i></div>
<div><span>Total Approvals</span><strong>${approvals}</strong><small>All administrator approvals</small></div>
</div>
<div class="payment-overview-card">
<div class="payment-overview-icon"><i class="fa-solid fa-car"></i></div>
<div><span>Total Sales</span><strong>${sales}</strong><small>All administrator sales</small></div>
</div>
<div class="payment-overview-card total-earnings-card">
<div class="payment-overview-icon"><i class="fa-solid fa-money-bill-wave"></i></div>
<div><span>Paid / Pending</span><strong>${money(paid)}</strong><small>${money(pending)} pending payment</small></div>
</div>`
};

const renderAdminPayments=()=>{
const grid=$("adminPaymentsGrid");
if(!grid)return;

const staff=admins.filter(a=>!a.is_main_admin);

if(!staff.length){
grid.innerHTML=`<div class="payment-empty-record"><i class="fa-solid fa-users"></i>No administrators available for payment management.</div>`;
return
}

grid.innerHTML=staff.map(a=>{
const s=paymentStats(a.id),name=(a.email||a.id).split("@")[0];

return`<article class="admin-payment-card">
<div class="admin-payment-head">
<div class="admin-payment-avatar"><i class="fa-solid fa-user"></i></div>
<div class="admin-payment-info">
<strong>${esc(name)}</strong>
<span>${esc(a.email||a.id)}</span>
</div>
</div>
<div class="admin-payment-body">
<div class="payment-stat-grid">
<div class="payment-stat approvals">
<span>APPROVALS</span>
<strong>${s.approvals}</strong>
<small>${s.approvalPaid} paid · ${s.approvalUnpaid} unpaid</small>
</div>
<div class="payment-stat sales">
<span>SALES</span>
<strong>${s.sales}</strong>
<small>${s.salePaid} paid · ${s.saleUnpaid} unpaid</small>
</div>
</div>
<div class="payment-card-total">
<span>Paid Earnings</span>
<strong>${money(s.earned)}</strong>
</div>
<div class="payment-card-actions">
<button class="manage-payment-btn" data-payment-admin="${a.id}">
<i class="fa-solid fa-money-check-dollar"></i> Manage Payments
</button>
</div>
</div>
</article>`
}).join("");

document.querySelectorAll("[data-payment-admin]").forEach(b=>b.onclick=()=>openPaymentAdmin(b.dataset.paymentAdmin))
};

const renderPaymentHistory=filter=>{
const body=$("paymentHistoryBody");
if(!body)return;

let records=[...paymentRecords];

if(filter==="approval"||filter==="sale")records=records.filter(x=>x.type===filter);
if(filter==="paid")records=records.filter(x=>x.paid===true);
if(filter==="unpaid")records=records.filter(x=>x.paid!==true);

body.innerHTML=records.map(r=>{
const a=admins.find(x=>x.id===r.admin_id),name=(a?.email||r.admin_email||"Unknown Admin").split("@")[0],vehicle=r.vehicle||r.vehicle_name||"Vehicle record",date=r.created_at?new Date(r.created_at).toLocaleDateString("en-KE",{day:"numeric",month:"short",year:"numeric"}):"—";

return`<tr>
<td class="payment-history-admin">${esc(name)}</td>
<td><span class="activity-badge ${r.type==="sale"?"sale":"approval"}">${r.type==="sale"?"Sale":"Approval"}</span></td>
<td class="payment-history-vehicle">${esc(vehicle)}</td>
<td>${money(r.amount)}</td>
<td><span class="payment-status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span></td>
<td>${date}</td>
<td><button class="history-payment-action" data-record="${r.id}">${r.paid===true?"Mark Unpaid":"Mark Paid"}</button></td>
</tr>`
}).join("");

document.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record))
};

const openPaymentAdmin=id=>{
paymentAdmin=admins.find(a=>a.id===id);

if(!paymentAdmin)return;

const modal=$("paymentModal");

if(!modal)return;

if($("paymentAdminName"))$("paymentAdminName").textContent=(paymentAdmin.email||paymentAdmin.id).split("@")[0];
if($("paymentAdminEmail"))$("paymentAdminEmail").textContent=paymentAdmin.email||paymentAdmin.id;

paymentTab="approval";
renderPaymentModalRecords();

modal.classList.add("open")
};

const closePaymentModal=()=>{
$("paymentModal")?.classList.remove("open");
paymentAdmin=null
};

const renderPaymentModalRecords=()=>{
const list=$("paymentRecords");

if(!list||!paymentAdmin)return;

const records=paymentRecords.filter(x=>x.admin_id===paymentAdmin.id&&x.type===paymentTab);

const tabApproval=$("paymentTabApproval"),tabSale=$("paymentTabSale");

tabApproval?.classList.toggle("active",paymentTab==="approval");
tabSale?.classList.toggle("active",paymentTab==="sale");

if(tabApproval)tabApproval.querySelector("span")&&(tabApproval.querySelector("span").textContent=paymentRecords.filter(x=>x.admin_id===paymentAdmin.id&&x.type==="approval"&&x.paid!==true).length);
if(tabSale)tabSale.querySelector("span")&&(tabSale.querySelector("span").textContent=paymentRecords.filter(x=>x.admin_id===paymentAdmin.id&&x.type==="sale"&&x.paid!==true).length);

if(!records.length){
list.innerHTML=`<div class="payment-empty-record"><i class="fa-solid fa-receipt"></i>No ${paymentTab} payment records found.</div>`;
return
}

list.innerHTML=records.map(r=>`
<div class="payment-record ${r.type==="sale"?"sale":""}">
<div class="payment-record-icon"><i class="fa-solid ${r.type==="sale"?"fa-car":"fa-circle-check"}"></i></div>
<div class="payment-record-info">
<strong>${esc(r.vehicle||r.vehicle_name||"Vehicle record")}</strong>
<span>${r.created_at?new Date(r.created_at).toLocaleDateString("en-KE"):"No date"}</span>
</div>
<div class="payment-record-amount">
<strong>${money(r.amount)}</strong>
<span class="payment-status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span>
</div>
<button class="record-toggle ${r.paid===true?"mark-unpaid":"mark-paid"}" data-record="${r.id}">
${r.paid===true?"Mark Unpaid":"Mark Paid"}
</button>
</div>
`).join("");

list.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record))
};

const togglePayment=async id=>{
const record=paymentRecords.find(x=>String(x.id)===String(id));

if(!record)return;

const paid=record.paid!==true;

try{
const{error}=await supabase.from("admin_payments").update({
paid,
paid_at:paid?new Date().toISOString():null
}).eq("id",id);

if(error)throw error;

record.paid=paid;
record.paid_at=paid?new Date().toISOString():null;

renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory();

if(paymentAdmin)renderPaymentModalRecords();

msg("success",paid?"Payment marked as paid.":"Payment marked as unpaid.")

}catch(e){
console.error(e);
msg("error",e.message||"Unable to update payment.")
}
};

const markAllPayments=async()=>{
if(!paymentAdmin)return;

const records=paymentRecords.filter(x=>x.admin_id===paymentAdmin.id&&x.type===paymentTab&&x.paid!==true);

if(!records.length)return;

try{
const ids=records.map(x=>x.id),now=new Date().toISOString();

const{error}=await supabase.from("admin_payments").update({
paid:true,
paid_at:now
}).in("id",ids);

if(error)throw error;

paymentRecords.forEach(x=>{
if(ids.includes(x.id)){
x.paid=true;
x.paid_at=now
}
});

renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory();
renderPaymentModalRecords();

msg("success",`All ${paymentTab} payments marked as paid.`)

}catch(e){
console.error(e);
msg("error",e.message||"Unable to update payments.")
}
};

const savePaymentSettings=async()=>{
const approval=Number($("approvalPaymentAmount")?.value||0),sale=Number($("salePaymentAmount")?.value||0);

if(approval<0||sale<0)return msg("error","Payment amounts cannot be negative.");

const btn=$("savePaymentSettings");

try{
if(btn){
btn.disabled=true;
btn.textContent="Saving..."
}

let{data,error}=await supabase.from("admin_payment_settings").select("id").limit(1).maybeSingle();

if(error&&error.code!=="PGRST116")throw error;

if(data?.id){
({error}=await supabase.from("admin_payment_settings").update({
approval_amount:approval,
sale_amount:sale,
updated_at:new Date().toISOString()
}).eq("id",data.id))
}else{
({error}=await supabase.from("admin_payment_settings").insert({
approval_amount:approval,
sale_amount:sale
}))
}

if(error)throw error;

paymentSettings.approval_amount=approval;
paymentSettings.sale_amount=sale;

msg("success","Payment amounts updated successfully.")

}catch(e){
console.error(e);
msg("error",e.message||"Unable to save payment settings.")
}finally{
if(btn){
btn.disabled=false;
btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save Payment Rates'
}
}
};

$("addAdminBtn").onclick=addAdmin;

$("savePermissions").onclick=async()=>{
try{
$("savePermissions").disabled=true;
$("savePermissions").textContent="Saving...";

await save()

}catch(e){
msg("error",e.message)
}finally{
$("savePermissions").disabled=false;
$("savePermissions").innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save Permissions'
}
};

$("closeModal").onclick=close;
$("cancelPermissions").onclick=close;
$("modalBg").onclick=close;

$("refreshAdmins").onclick=load;

$("savePaymentSettings")?.addEventListener("click",savePaymentSettings);

$("paymentTabApproval")?.addEventListener("click",()=>{
paymentTab="approval";
renderPaymentModalRecords()
});

$("paymentTabSale")?.addEventListener("click",()=>{
paymentTab="sale";
renderPaymentModalRecords()
});

$("markAllPayments")?.addEventListener("click",markAllPayments);

$("closePaymentModal")?.addEventListener("click",closePaymentModal);
$("paymentModalBg")?.addEventListener("click",closePaymentModal);

$("paymentModal")?.addEventListener("click",e=>{
if(e.target===$("paymentModal"))closePaymentModal()
});

document.querySelectorAll("[data-payment-filter]").forEach(b=>{
b.addEventListener("click",()=>{
document.querySelectorAll("[data-payment-filter]").forEach(x=>x.classList.remove("active"));
b.classList.add("active");
renderPaymentHistory(b.dataset.paymentFilter)
})
});

$("menu").onclick=()=>{
$("sidebar").classList.add("open");
$("overlay").classList.add("show")
};

$("closeMenu").onclick=$("overlay").onclick=()=>{
$("sidebar").classList.remove("open");
$("overlay").classList.remove("show")
};

$("logoutBtn").onclick=async()=>{
await supabase.auth.signOut();
location.replace("auth.html")
};

document.addEventListener("keydown",e=>{
if(e.key==="Escape"){
if($("permissionModal")?.classList.contains("open"))close();
if($("paymentModal")?.classList.contains("open"))closePaymentModal()
}
});

window.addEventListener("load",()=>setTimeout(()=>$("loader").classList.add("hide"),400));

requireAdmin("manageweb").then(x=>x&&load());