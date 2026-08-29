import{supabase}from"./supabase.js";

const $=id=>document.getElementById(id),pages=[["vehicles","Vehicle Listings","index.html","fa-car"],["tradeins","Trade-In Requests","tradeins.html","fa-right-left"],["imports","Import Requests","imports.html","fa-ship"],["financing","Financing Requests","financing.html","fa-coins"],["diaspora","Diaspora Requests","diaspora.html","fa-earth-africa"],["sellcars","Sell Your Car Requests","sellcars.html","fa-car-side"],["accessiblecars","Accessible Car Requests","accessiblecars.html","fa-wheelchair"],["reservations","Reservation Requests","reservations.html","fa-calendar-check"],["testdrives","Test Drives","testdrives.html","fa-road"],["insurance","Insurance Requests","insurance.html","fa-shield-halved"],["statistics","Statistics","statistics.html","fa-chart-column"],["admins","Manage Admins","admins.html","fa-user-shield"],["webpage","Manage Webpage","manage.html","fa-globe"]];

let admins=[],permissions={},me=null,currentAdmin=null,paymentAdmin=null,paymentRecords=[],paymentSettings={approval_amount:0,sale_amount:0},historyFilter="all",paymentTab="approval";

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money=v=>`KES ${Number(v||0).toLocaleString("en-KE",{maximumFractionDigits:2})}`;
const date=v=>v?new Date(v).toLocaleDateString("en-KE",{day:"numeric",month:"short",year:"numeric"}):"—";

const msg=(id,text)=>{
const el=$(id);
if(!el)return;
el.textContent=text;
el.classList.add("active");
clearTimeout(el._timer);
el._timer=setTimeout(()=>el.classList.remove("active"),4000);
};

const setLoading=(id,on,text)=>{
const el=$(id);
if(!el)return;
el.style.display=on?"block":"none";
if(text)el.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i> ${esc(text)}`;
};

const auth=async()=>{
const{data:{session},error}=await supabase.auth.getSession();
if(error||!session){
location.replace("auth.html");
return null;
}

const{data,error:e}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();

if(e||!data){
await supabase.auth.signOut();
location.replace("auth.html");
return null;
}

if(data.is_main_admin!==true){
location.replace("index.html");
return null;
}

return data;
};

const closePermissions=()=>{
$("permissionModal")?.classList.remove("open");
currentAdmin=null;
};

const closePaymentModal=()=>{
$("paymentModal")?.classList.remove("open");
paymentAdmin=null;
};

const loadAdmins=async()=>{
const{data,error}=await supabase.from("admin_users").select("*").order("email",{ascending:true});
if(error)throw error;

const{data:perms,error:pe}=await supabase.from("admin_permissions").select("*");
if(pe)throw pe;

admins=data||[];
permissions={};

(perms||[]).forEach(x=>permissions[x.admin_id]=x.permissions||{});

if($("adminCount"))$("adminCount").textContent=admins.length;

renderAdmins();
};

const renderAdmins=()=>{
const grid=$("adminsGrid");
if(!grid)return;

if(!admins.length){
grid.innerHTML=`<div class="payment-empty-record"><i class="fa-solid fa-users"></i>No administrators found.</div>`;
return;
}

grid.innerHTML=admins.map(a=>{
const p=permissions[a.id]||{},isMain=a.is_main_admin===true,name=(a.email||a.id).split("@")[0],allowed=pages.filter(x=>p[x[0]]===true).length;

return`<article class="admin-card">
<div class="admin-card-top">
<div class="admin-avatar"><i class="fa-solid fa-user"></i></div>
<div class="admin-details"><strong>${esc(name)}</strong><span>${esc(a.email||a.id)}</span></div>
<span class="admin-role">${isMain?"Main Admin":"Administrator"}</span>
</div>
<div class="admin-card-body">
<div class="access-title"><span>PAGE ACCESS</span><small class="access-count">${isMain?"All Access":`${allowed}/${pages.length} Pages`}</small></div>
<div class="access-list">
${isMain?`<span class="access-tag all"><i class="fa-solid fa-check"></i> Full Dashboard Access</span>`:pages.filter(x=>p[x[0]]===true).map(x=>`<span class="access-tag">${esc(x[1])}</span>`).join("")||`<span class="access-tag">No pages assigned</span>`}
</div>
<div class="admin-card-actions">
${!isMain?`<button class="manage-btn" data-manage="${esc(a.id)}" type="button"><i class="fa-solid fa-sliders"></i> Manage Page Access</button><button class="delete-admin" data-delete="${esc(a.id)}" type="button"><i class="fa-solid fa-trash"></i> Remove Admin</button>`:`<div class="main-admin"><i class="fa-solid fa-crown"></i>&nbsp; Full Administrative Control</div>`}
</div>
</div>
</article>`;
}).join("");

grid.querySelectorAll("[data-manage]").forEach(b=>b.onclick=()=>openPermissions(b.dataset.manage));
grid.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>removeAdmin(b.dataset.delete));
};

const openPermissions=id=>{
currentAdmin=admins.find(x=>String(x.id)===String(id));
if(!currentAdmin||currentAdmin.is_main_admin)return;

const p=permissions[currentAdmin.id]||{};

if($("modalAdminName"))$("modalAdminName").textContent=currentAdmin.email||currentAdmin.id;

$("pagePermissions").innerHTML=pages.map(x=>`<label class="permission"><input type="checkbox" data-page="${x[0]}" ${p[x[0]]===true?"checked":""}><i class="fa-solid ${x[3]}"></i><span>${esc(x[1])}<small>Allow access to ${esc(x[1])}</small></span></label>`).join("");

$("permissionModal")?.classList.add("open");
};

const savePermissions=async()=>{
if(!currentAdmin)return;

const p={};
$("pagePermissions")?.querySelectorAll("[data-page]").forEach(x=>p[x.dataset.page]=x.checked===true);

const{error}=await supabase.from("admin_permissions").upsert({
admin_id:currentAdmin.id,
permissions:p,
updated_at:new Date().toISOString()
},{onConflict:"admin_id"});

if(error)throw error;

permissions[currentAdmin.id]=p;
closePermissions();
renderAdmins();
msg("success","Administrator permissions updated successfully.");
};

const addAdmin=async()=>{
const email=$("newAdminEmail")?.value.trim(),password=$("newAdminPassword")?.value||"",confirmPassword=$("confirmAdminPassword")?.value||"",btn=$("addAdminBtn");

if(!email||!password||!confirmPassword)return msg("error","Complete all administrator fields.");
if(password!==confirmPassword)return msg("error","Passwords do not match.");
if(password.length<8)return msg("error","Password must be at least 8 characters.");

try{
if(btn){btn.disabled=true;btn.textContent="Creating...";}

const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"create",email,password}});
if(error)throw error;
if(data?.error)throw new Error(data.error);

$("newAdminEmail").value="";
$("newAdminPassword").value="";
$("confirmAdminPassword").value="";

msg("success",`${email} was created as an administrator.`);
await refreshAll();

}catch(e){
console.error(e);
msg("error",e.message||"Unable to create administrator.");
}finally{
if(btn){btn.disabled=false;btn.innerHTML=`<i class="fa-solid fa-user-plus"></i> Create Administrator`;}
}
};

const removeAdmin=async id=>{
const admin=admins.find(x=>String(x.id)===String(id));
if(!admin||admin.is_main_admin)return;

if(!confirm(`Permanently delete administrator ${admin.email}? This will also remove their login account.`))return;

try{
const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"delete",id:admin.id}});
if(error)throw error;
if(data?.error)throw new Error(data.error);

delete permissions[admin.id];
msg("success",`${admin.email} was deleted.`);
await refreshAll();

}catch(e){
console.error(e);
msg("error",e.message||"Unable to delete administrator.");
}
};

const loadPaymentSettings=async()=>{
const{data,error}=await supabase.from("admin_payment_settings").select("*").limit(1).maybeSingle();

if(error&&error.code!=="PGRST116")throw error;

paymentSettings={
approval_amount:Number(data?.approval_amount||0),
sale_amount:Number(data?.sale_amount||0)
};

if($("approvalPaymentAmount"))$("approvalPaymentAmount").value=paymentSettings.approval_amount||0;
if($("salePaymentAmount"))$("salePaymentAmount").value=paymentSettings.sale_amount||0;
};

const loadPaymentRecords=async()=>{
const{data,error}=await supabase.from("admin_payments").select("*").order("created_at",{ascending:false});
if(error)throw error;
paymentRecords=data||[];
};

const paymentStats=id=>{
const r=paymentRecords.filter(x=>String(x.admin_id)===String(id));
const approvals=r.filter(x=>x.type==="approval"),sales=r.filter(x=>x.type==="sale");
const approvalPaid=approvals.filter(x=>x.paid===true),salePaid=sales.filter(x=>x.paid===true);
const unpaid=r.filter(x=>x.paid!==true),paid=r.filter(x=>x.paid===true);

return{
approvals:approvals.length,
sales:sales.length,
approvalPaid:approvalPaid.length,
salePaid:salePaid.length,
approvalUnpaid:approvals.length-approvalPaid.length,
saleUnpaid:sales.length-salePaid.length,
earned:paid.reduce((s,x)=>s+Number(x.amount||0),0),
pending:unpaid.reduce((s,x)=>s+Number(x.amount||0),0)
};
};

const renderPaymentOverview=()=>{
let approvals=0,sales=0,approvalPaid=0,salePaid=0,paid=0,pending=0;

admins.filter(a=>!a.is_main_admin).forEach(a=>{
const s=paymentStats(a.id);
approvals+=s.approvals;
sales+=s.sales;
approvalPaid+=s.approvalPaid;
salePaid+=s.salePaid;
paid+=s.earned;
pending+=s.pending;
});

if($("totalApprovals"))$("totalApprovals").textContent=approvals;
if($("totalSales"))$("totalSales").textContent=sales;
if($("totalPaidApprovals"))$("totalPaidApprovals").textContent=`${approvalPaid} paid · ${approvals-approvalPaid} unpaid`;
if($("totalPaidSales"))$("totalPaidSales").textContent=`${salePaid} paid · ${sales-salePaid} unpaid`;
if($("totalOutstanding"))$("totalOutstanding").textContent=money(pending);
if($("totalPaidAmount"))$("totalPaidAmount").textContent=`${money(paid)} paid`;
};

const renderAdminPayments=()=>{
const grid=$("adminPaymentsGrid");
if(!grid)return;

const staff=admins.filter(a=>!a.is_main_admin);

if(!staff.length){
grid.innerHTML=`<div class="payment-empty-record"><i class="fa-solid fa-users"></i>No administrators available for payment management.</div>`;
return;
}

grid.innerHTML=staff.map(a=>{
const s=paymentStats(a.id),name=(a.email||a.id).split("@")[0];

return`<article class="admin-payment-card">
<div class="admin-payment-head">
<div class="admin-payment-avatar"><i class="fa-solid fa-user"></i></div>
<div class="admin-payment-info"><strong>${esc(name)}</strong><span>${esc(a.email||a.id)}</span></div>
</div>
<div class="admin-payment-body">
<div class="payment-stat-grid">
<div class="payment-stat approvals"><span>APPROVALS</span><strong>${s.approvals}</strong><small>${s.approvalPaid} paid · ${s.approvalUnpaid} unpaid</small></div>
<div class="payment-stat sales"><span>SALES</span><strong>${s.sales}</strong><small>${s.salePaid} paid · ${s.saleUnpaid} unpaid</small></div>
</div>
<div class="payment-card-total"><span>Paid Earnings</span><strong>${money(s.earned)}</strong></div>
<div class="payment-card-actions"><button class="manage-payment-btn" data-payment-admin="${esc(a.id)}" type="button"><i class="fa-solid fa-money-check-dollar"></i> Manage Payments</button></div>
</div>
</article>`;
}).join("");

grid.querySelectorAll("[data-payment-admin]").forEach(b=>b.onclick=()=>openPaymentAdmin(b.dataset.paymentAdmin));
};

const filteredRecords=()=>{
let r=[...paymentRecords];

if(historyFilter==="approval"||historyFilter==="sale")r=r.filter(x=>x.type===historyFilter);
if(historyFilter==="paid")r=r.filter(x=>x.paid===true);
if(historyFilter==="unpaid")r=r.filter(x=>x.paid!==true);

return r;
};

const renderPaymentHistory=()=>{
const body=$("paymentHistoryBody"),empty=$("paymentHistoryEmpty");
if(!body)return;

const records=filteredRecords();

if(empty)empty.style.display=records.length?"none":"block";

body.innerHTML=records.map(r=>{
const admin=admins.find(x=>String(x.id)===String(r.admin_id));
const name=(admin?.email||r.admin_email||"Unknown Admin").split("@")[0];
const vehicle=r.vehicle||r.vehicle_name||r.vehicle_title||"Vehicle record";

return`<tr>
<td class="payment-history-admin">${esc(name)}</td>
<td class="payment-history-vehicle">${esc(vehicle)}</td>
<td><span class="activity-badge ${r.type==="sale"?"sale":"approval"}">${r.type==="sale"?"Sale":"Approval"}</span></td>
<td>${money(r.amount)}</td>
<td><span class="payment-status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span></td>
<td>${date(r.created_at)}</td>
<td><button class="history-payment-action" data-record="${esc(r.id)}" type="button">${r.paid===true?"Mark Unpaid":"Mark Paid"}</button></td>
</tr>`;
}).join("");

body.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record));
};

const openPaymentAdmin=id=>{
paymentAdmin=admins.find(x=>String(x.id)===String(id));
if(!paymentAdmin)return;

if($("paymentAdminName"))$("paymentAdminName").textContent=(paymentAdmin.email||paymentAdmin.id).split("@")[0];
if($("paymentAdminEmail"))$("paymentAdminEmail").textContent=paymentAdmin.email||paymentAdmin.id;

paymentTab="approval";
renderPaymentModalRecords();
$("paymentModal")?.classList.add("open");
};

const renderPaymentModalRecords=()=>{
if(!paymentAdmin)return;

const approvalRecords=$("paymentApprovalRecords"),saleRecords=$("paymentSaleRecords");
const records=paymentRecords.filter(x=>String(x.admin_id)===String(paymentAdmin.id));
const approvals=records.filter(x=>x.type==="approval"),sales=records.filter(x=>x.type==="sale");
const pending=records.filter(x=>x.paid!==true).reduce((s,x)=>s+Number(x.amount||0),0);

if($("paymentAdminOutstanding"))$("paymentAdminOutstanding").textContent=money(pending);
if($("modalApprovalCount"))$("modalApprovalCount").textContent=approvals.filter(x=>x.paid!==true).length;
if($("modalSalesCount"))$("modalSalesCount").textContent=sales.filter(x=>x.paid!==true).length;

const render=(list,type)=>{
const el=type==="approval"?approvalRecords:saleRecords;
if(!el)return;

const data=list.filter(x=>x.type===type);

el.innerHTML=data.length?data.map(r=>`<div class="payment-record ${type==="sale"?"sale":""}">
<div class="payment-record-icon"><i class="fa-solid ${type==="sale"?"fa-car":"fa-circle-check"}"></i></div>
<div class="payment-record-info"><strong>${esc(r.vehicle||r.vehicle_name||r.vehicle_title||"Vehicle record")}</strong><span>${date(r.created_at)}</span></div>
<div class="payment-record-amount"><strong>${money(r.amount)}</strong><span class="payment-status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span></div>
<button class="record-toggle ${r.paid===true?"mark-unpaid":"mark-paid"}" data-record="${esc(r.id)}" type="button">${r.paid===true?"Mark Unpaid":"Mark Paid"}</button>
</div>`).join(""):`<div class="payment-empty-record"><i class="fa-solid fa-receipt"></i>No ${type} payment records found.</div>`;

el.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record));
};

render(approvals,"approval");
render(sales,"sale");

const approvalTab=document.querySelector('[data-payment-tab="approvals"]');
const saleTab=document.querySelector('[data-payment-tab="sales"]');

approvalTab?.classList.toggle("active",paymentTab==="approval");
saleTab?.classList.toggle("active",paymentTab==="sale");

approvalRecords?.classList.toggle("hidden",paymentTab!=="approval");
saleRecords?.classList.toggle("hidden",paymentTab!=="sale");

$("markAllApprovalsPaid")?.classList.toggle("hidden",paymentTab!=="approval");
$("markAllSalesPaid")?.classList.toggle("hidden",paymentTab!=="sale");
};

const togglePayment=async id=>{
const record=paymentRecords.find(x=>String(x.id)===String(id));
if(!record)return;

const paid=record.paid!==true;
const now=paid?new Date().toISOString():null;

try{
const{error}=await supabase.from("admin_payments").update({paid,paid_at:now}).eq("id",record.id);
if(error)throw error;

record.paid=paid;
record.paid_at=now;

renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory();
if(paymentAdmin)renderPaymentModalRecords();

msg("success",paid?"Payment marked as paid.":"Payment marked as unpaid.");

}catch(e){
console.error(e);
msg("error",e.message||"Unable to update payment.");
}
};

const markAllPayments=async type=>{
if(!paymentAdmin)return;

const records=paymentRecords.filter(x=>String(x.admin_id)===String(paymentAdmin.id)&&x.type===type&&x.paid!==true);
if(!records.length)return msg("error",`No unpaid ${type} payments found.`);

try{
const ids=records.map(x=>x.id),now=new Date().toISOString();
const{error}=await supabase.from("admin_payments").update({paid:true,paid_at:now}).in("id",ids);
if(error)throw error;

paymentRecords.forEach(x=>{
if(ids.some(id=>String(id)===String(x.id))){
x.paid=true;
x.paid_at=now;
}
});

renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory();
renderPaymentModalRecords();

msg("success",`All ${type} payments marked as paid.`);

}catch(e){
console.error(e);
msg("error",e.message||"Unable to update payments.");
}
};

const savePaymentSettings=async()=>{
const approval=Number($("approvalPaymentAmount")?.value||0),sale=Number($("salePaymentAmount")?.value||0),btn=$("savePaymentSettings");

if(!Number.isFinite(approval)||!Number.isFinite(sale)||approval<0||sale<0)return msg("error","Payment amounts must be valid positive numbers.");

try{
if(btn){btn.disabled=true;btn.textContent="Saving...";}

const{data,error:findError}=await supabase.from("admin_payment_settings").select("id").limit(1).maybeSingle();
if(findError&&findError.code!=="PGRST116")throw findError;

let error;

if(data?.id){
({error}=await supabase.from("admin_payment_settings").update({
approval_amount:approval,
sale_amount:sale,
updated_at:new Date().toISOString()
}).eq("id",data.id));
}else{
({error}=await supabase.from("admin_payment_settings").insert({
approval_amount:approval,
sale_amount:sale
}));
}

if(error)throw error;

paymentSettings={approval_amount:approval,sale_amount:sale};
msg("success","Payment rates updated successfully.");

}catch(e){
console.error(e);
msg("error",e.message||"Unable to save payment settings.");
}finally{
if(btn){btn.disabled=false;btn.innerHTML=`<i class="fa-solid fa-floppy-disk"></i> Save Payment Rates`;}
}
};

const loadPayments=async()=>{
setLoading("paymentsLoading",true,"Loading administrator payment records...");
setLoading("paymentHistoryLoading",true,"Loading payment history...");

try{
await Promise.all([loadPaymentSettings(),loadPaymentRecords()]);
renderPaymentOverview();
renderAdminPayments();
renderPaymentHistory();
}catch(e){
console.error(e);
msg("error",e.message||"Unable to load payment information.");
}finally{
setLoading("paymentsLoading",false);
setLoading("paymentHistoryLoading",false);
}
};

const refreshAll=async()=>{
setLoading("loading",true,"Loading administrators...");

try{
await loadAdmins();
await loadPayments();
}catch(e){
console.error(e);
msg("error",e.message||"Unable to load administrator information.");
}finally{
setLoading("loading",false);
}
};

const init=async()=>{
$("addAdminBtn")?.addEventListener("click",addAdmin);

$("savePermissions")?.addEventListener("click",async()=>{
const btn=$("savePermissions");
try{
if(btn){btn.disabled=true;btn.textContent="Saving...";}
await savePermissions();
}catch(e){
console.error(e);
msg("error",e.message||"Unable to save permissions.");
}finally{
if(btn){btn.disabled=false;btn.innerHTML=`<i class="fa-solid fa-floppy-disk"></i> Save Permissions`;}
}
});

$("closeModal")?.addEventListener("click",closePermissions);
$("cancelPermissions")?.addEventListener("click",closePermissions);
$("modalBg")?.addEventListener("click",closePermissions);

$("refreshAdmins")?.addEventListener("click",refreshAll);
$("refreshPayments")?.addEventListener("click",loadPayments);
$("refreshPaymentHistory")?.addEventListener("click",loadPayments);
$("savePaymentSettings")?.addEventListener("click",savePaymentSettings);

document.querySelector('[data-payment-tab="approvals"]')?.addEventListener("click",()=>{
paymentTab="approval";
renderPaymentModalRecords();
});

document.querySelector('[data-payment-tab="sales"]')?.addEventListener("click",()=>{
paymentTab="sale";
renderPaymentModalRecords();
});

$("markAllApprovalsPaid")?.addEventListener("click",()=>markAllPayments("approval"));
$("markAllSalesPaid")?.addEventListener("click",()=>markAllPayments("sale"));

$("closePaymentModal")?.addEventListener("click",closePaymentModal);
$("paymentModalBg")?.addEventListener("click",closePaymentModal);

document.querySelectorAll("[data-payment-filter]").forEach(b=>{
b.addEventListener("click",()=>{
historyFilter=b.dataset.paymentFilter||"all";
document.querySelectorAll("[data-payment-filter]").forEach(x=>x.classList.toggle("active",x===b));
renderPaymentHistory();
});
});

$("menu")?.addEventListener("click",()=>{
$("sidebar")?.classList.add("open");
$("overlay")?.classList.add("show");
});

const closeMenu=()=>{
$("sidebar")?.classList.remove("open");
$("overlay")?.classList.remove("show");
};

$("closeMenu")?.addEventListener("click",closeMenu);
$("overlay")?.addEventListener("click",closeMenu);

$("logoutBtn")?.addEventListener("click",async()=>{
await supabase.auth.signOut();
location.replace("auth.html");
});

document.addEventListener("keydown",e=>{
if(e.key!=="Escape")return;
if($("permissionModal")?.classList.contains("open"))closePermissions();
if($("paymentModal")?.classList.contains("open"))closePaymentModal();
});

window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),400));

try{
me=await auth();
if(!me)return;
await refreshAll();
}catch(e){
console.error(e);
msg("error",e.message||"Unable to initialize administrator management.");
}
};

init();