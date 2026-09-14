import{supabase}from"./supabase.js";
import{attachBadges}from"./admin-nav.js";
const $=id=>document.getElementById(id);

const pages=[
 ["vehicles","Vehicle Listings","fa-car"],
 ["tradeins","Trade-In Requests","fa-right-left"],
 ["agent_submissions","Agent Submissions","fa-file-circle-check"],
 ["imports","Import Requests","fa-ship"],
 ["financing","Financing Requests","fa-coins"],
 ["diaspora","Diaspora Requests","fa-earth-africa"],
 ["sellcars","Sell Your Car Requests","fa-car-side"],
 ["accessiblecars","Accessible Cars","fa-wheelchair"],
 ["reservations","Reservation Requests","fa-calendar-check"],
 ["testdrives","Test Drives","fa-road"],
 ["insurance","Insurance Requests","fa-shield-halved"],
 ["statistics","Statistics","fa-chart-column"],
 ["admins","Manage Agents","fa-user-shield"],
 ["webpage","Manage Webpage","fa-globe"]
];

let admins=[],permissions={},me=null,agent=null,
 paymentRecords=[],paymentSettings={approval_amount:0,sale_amount:0},
 historyFilter="all",recordTab="approval",search="";

const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money=v=>`KES ${Number(v||0).toLocaleString("en-KE",{maximumFractionDigits:2})}`;
const date=v=>v?new Date(v).toLocaleDateString("en-KE",{day:"numeric",month:"short",year:"numeric"}):"—";
const nameOf=a=>a?.full_name||a?.email?.split("@")[0]||String(a?.id||"Agent");

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

/* ---------- modals ---------- */

const openModal=id=>$(id)?.classList.add("open");

const closeModal=el=>{
 if(!el)return;
 el.classList.remove("open");
 if(el.id==="agentModal")agent=null;
};

const closeTop=()=>{
 const open=[...document.querySelectorAll(".modal.open")];
 closeModal(open[open.length-1]);
};

/* ---------- auth ---------- */

const auth=async()=>{
 const{data:{session},error}=await supabase.auth.getSession();
 if(error||!session){location.replace("auth.html");return null}
 const{data,error:e}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();
 if(e||!data){await supabase.auth.signOut();location.replace("auth.html");return null}
 if(data.is_main_admin!==true){location.replace("index.html");return null}
 return data
};

/* ---------- data ---------- */

const loadAdmins=async()=>{
 const{data,error}=await supabase.from("admin_users").select("*").order("email",{ascending:true});
 if(error)throw error;
 const{data:perms,error:pe}=await supabase.from("admin_permissions").select("*");
 if(pe)throw pe;
 admins=data||[];
 permissions={};
 (perms||[]).forEach(x=>permissions[x.admin_id]=x.permissions||{});
};

const loadPaymentSettings=async()=>{
 const{data,error}=await supabase.from("admin_payment_settings").select("*").limit(1).maybeSingle();
 if(error&&error.code!=="PGRST116")throw error;
 paymentSettings={approval_amount:Number(data?.approval_amount||0),sale_amount:Number(data?.sale_amount||0)};
 if($("approvalPaymentAmount"))$("approvalPaymentAmount").value=paymentSettings.approval_amount||0;
 if($("salePaymentAmount"))$("salePaymentAmount").value=paymentSettings.sale_amount||0;
};

const loadPaymentRecords=async()=>{
 const{data,error}=await supabase.from("admin_payments").select("*").order("created_at",{ascending:false});
 if(error)throw error;
 paymentRecords=data||[];
};

const stats=id=>{
 const r=paymentRecords.filter(x=>String(x.admin_id)===String(id)),
  approvals=r.filter(x=>x.type==="approval"),
  sales=r.filter(x=>x.type==="sale"),
  approvalPaid=approvals.filter(x=>x.paid===true).length,
  salePaid=sales.filter(x=>x.paid===true).length,
  paid=r.filter(x=>x.paid===true),
  unpaid=r.filter(x=>x.paid!==true);
 return{
  approvals:approvals.length,
  sales:sales.length,
  approvalPaid,
  salePaid,
  approvalUnpaid:approvals.length-approvalPaid,
  saleUnpaid:sales.length-salePaid,
  earned:paid.reduce((s,x)=>s+Number(x.amount||0),0),
  pending:unpaid.reduce((s,x)=>s+Number(x.amount||0),0)
 }
};

/* ---------- overview ---------- */

const renderOverview=()=>{
 let approvals=0,sales=0,approvalPaid=0,salePaid=0,paid=0,pending=0;
 const staff=admins.filter(a=>!a.is_main_admin);
 staff.forEach(a=>{
  const s=stats(a.id);
  approvals+=s.approvals;sales+=s.sales;
  approvalPaid+=s.approvalPaid;salePaid+=s.salePaid;
  paid+=s.earned;pending+=s.pending;
 });
 if($("adminCount"))$("adminCount").textContent=admins.length;
 if($("agentBreakdown"))$("agentBreakdown").textContent=`${staff.length} agent${staff.length===1?"":"s"} · ${admins.length-staff.length} main admin`;
 if($("totalApprovals"))$("totalApprovals").textContent=approvals;
 if($("totalSales"))$("totalSales").textContent=sales;
 if($("totalPaidApprovals"))$("totalPaidApprovals").textContent=`${approvalPaid} paid · ${approvals-approvalPaid} unpaid`;
 if($("totalPaidSales"))$("totalPaidSales").textContent=`${salePaid} paid · ${sales-salePaid} unpaid`;
 if($("totalOutstanding"))$("totalOutstanding").textContent=money(pending);
 if($("totalPaidAmount"))$("totalPaidAmount").textContent=`${money(paid)} paid`;
 if($("rateSummary"))$("rateSummary").textContent=`${money(paymentSettings.approval_amount)} approval · ${money(paymentSettings.sale_amount)} sale`;
 if($("historySummary"))$("historySummary").textContent=`${paymentRecords.length} record${paymentRecords.length===1?"":"s"}`;
};

/* ---------- agents list ---------- */

const renderAgents=()=>{
 const list=$("adminsList");
 if(!list)return;
 const q=search.trim().toLowerCase();
 const rows=admins.filter(a=>!q||[a.full_name,a.email,a.id_number].some(v=>String(v||"").toLowerCase().includes(q)));

 if(!rows.length){
  list.innerHTML=`<div class="empty-block small"><i class="fa-solid fa-users"></i><h3>${q?"No match":"No agents yet"}</h3><p>${q?"Try a different name, email or ID.":"Use Add agent to create the first account."}</p></div>`;
  return
 }

 list.innerHTML=rows.map(a=>{
  const p=permissions[a.id]||{},
   isMain=a.is_main_admin===true,
   allowed=pages.filter(x=>p[x[0]]===true).length,
   s=stats(a.id);

  const chips=isMain
   ?`<span class="chip gold"><i class="fa-solid fa-crown"></i> Full dashboard access</span>`
   :[
     `<span class="chip">ID ${esc(a.id_number||"not set")}</span>`,
     `<span class="chip">${allowed}/${pages.length} pages</span>`,
     `<span class="chip">${s.approvals} approvals · ${s.sales} sales</span>`,
     s.pending>0?`<span class="chip warn">${money(s.pending)} unpaid</span>`:`<span class="chip ok">All paid</span>`
    ].join("");

  return`<article class="agent-row">
<div class="agent-avatar"><i class="fa-solid fa-user"></i></div>
<div class="agent-meta">
<strong>${esc(nameOf(a))}</strong>
<span>${esc(a.email||"—")}</span>
<div class="chips">${chips}</div>
</div>
${isMain
 ?`<span class="role locked"><i class="fa-solid fa-lock"></i> Main admin</span>`
 :`<button class="manage" data-manage="${esc(a.id)}" type="button"><i class="fa-solid fa-sliders"></i> Manage</button>`}
</article>`
 }).join("");

 list.querySelectorAll("[data-manage]").forEach(b=>b.onclick=()=>openAgent(b.dataset.manage));
};

/* ---------- agent workspace ---------- */

const setTab=tab=>{
 document.querySelectorAll("#agentModal .tabs:not(.sub) .tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
 document.querySelectorAll("#agentModal .pane").forEach(p=>p.classList.toggle("hidden",p.dataset.pane!==tab));
};

const openAgent=id=>{
 const a=admins.find(x=>String(x.id)===String(id));
 if(!a||a.is_main_admin)return;
 agent=a;

 $("agentModalName").textContent=nameOf(a);
 $("agentModalEmail").textContent=a.email||"—";
 $("editAdminIdNumber").value=a.id_number||"";
 $("editAdminName").value=a.full_name||"";
 $("editAdminEmail").value=a.email||"";
 $("editAdminPassword").value="";
 $("editAdminPasswordConfirm").value="";

 renderPermissions();
 recordTab="approval";
 renderAgentPayments();
 setTab("details");
 openModal("agentModal");
 setTimeout(()=>$("editAdminIdNumber")?.focus(),120);
};

const renderPermissions=()=>{
 if(!agent)return;
 const p=permissions[agent.id]||{};
 $("pagePermissions").innerHTML=pages.map(x=>
  `<label class="permission"><input type="checkbox" data-page="${x[0]}" ${p[x[0]]===true?"checked":""}><i class="fa-solid ${x[2]}"></i><span>${esc(x[1])}</span></label>`
 ).join("");
 $("pagePermissions").querySelectorAll("[data-page]").forEach(c=>c.addEventListener("change",countPermissions));
 countPermissions();
};

const countPermissions=()=>{
 const boxes=[...document.querySelectorAll("#pagePermissions [data-page]")];
 if($("permissionCount"))$("permissionCount").textContent=`${boxes.filter(b=>b.checked).length} of ${boxes.length} pages allowed`;
};

const setAllPermissions=value=>{
 document.querySelectorAll("#pagePermissions [data-page]").forEach(c=>c.checked=value);
 countPermissions();
};

const renderAgentPayments=()=>{
 if(!agent)return;
 const records=paymentRecords.filter(x=>String(x.admin_id)===String(agent.id)),
  approvals=records.filter(x=>x.type==="approval"),
  sales=records.filter(x=>x.type==="sale"),
  s=stats(agent.id);

 if($("agentOutstanding"))$("agentOutstanding").textContent=money(s.pending);
 if($("agentEarned"))$("agentEarned").textContent=money(s.earned);
 if($("modalApprovalCount"))$("modalApprovalCount").textContent=approvals.filter(x=>x.paid!==true).length;
 if($("modalSalesCount"))$("modalSalesCount").textContent=sales.filter(x=>x.paid!==true).length;

 const draw=(data,type)=>{
  const el=type==="approval"?$("paymentApprovalRecords"):$("paymentSaleRecords");
  if(!el)return;
  el.innerHTML=data.length?data.map(r=>
   `<div class="record ${type==="sale"?"sale":""}">
<div class="record-icon"><i class="fa-solid ${type==="sale"?"fa-car":"fa-circle-check"}"></i></div>
<div class="record-info"><strong>${esc(r.vehicle||r.vehicle_name||r.vehicle_title||"Vehicle record")}</strong><span>${date(r.created_at)}</span></div>
<div class="record-amount"><strong>${money(r.amount)}</strong><span class="status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span></div>
<button class="record-toggle ${r.paid===true?"unpay":"pay"}" data-record="${esc(r.id)}" type="button">${r.paid===true?"Mark unpaid":"Mark paid"}</button>
</div>`).join("")
   :`<div class="empty-block small"><i class="fa-solid fa-receipt"></i><h3>No ${type==="sale"?"sales":"approvals"} yet</h3><p>Records appear here once this agent logs activity.</p></div>`;
  el.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record));
 };

 draw(approvals,"approval");
 draw(sales,"sale");

 document.querySelectorAll("[data-record-tab]").forEach(t=>t.classList.toggle("active",t.dataset.recordTab===recordTab));
 $("paymentApprovalRecords")?.classList.toggle("hidden",recordTab!=="approval");
 $("paymentSaleRecords")?.classList.toggle("hidden",recordTab!=="sale");
 $("markAllApprovalsPaid")?.classList.toggle("hidden",recordTab!=="approval");
 $("markAllSalesPaid")?.classList.toggle("hidden",recordTab!=="sale");
};

/* ---------- history ---------- */

const renderHistory=()=>{
 const body=$("paymentHistoryBody"),empty=$("paymentHistoryEmpty");
 if(!body)return;
 let records=[...paymentRecords];
 if(historyFilter==="approval"||historyFilter==="sale")records=records.filter(x=>x.type===historyFilter);
 if(historyFilter==="paid")records=records.filter(x=>x.paid===true);
 if(historyFilter==="unpaid")records=records.filter(x=>x.paid!==true);

 if(empty)empty.style.display=records.length?"none":"block";
 document.querySelector(".table-wrap")?.classList.toggle("hidden",!records.length);

 body.innerHTML=records.map(r=>{
  const a=admins.find(x=>String(x.id)===String(r.admin_id)),
   who=a?nameOf(a):(r.admin_email||"Unknown agent").split("@")[0],
   vehicle=r.vehicle||r.vehicle_name||r.vehicle_title||"Vehicle record";
  return`<tr>
<td class="strong">${esc(who)}</td>
<td class="muted">${esc(vehicle)}</td>
<td><span class="badge ${r.type==="sale"?"sale":"approval"}">${r.type==="sale"?"Sale":"Approval"}</span></td>
<td>${money(r.amount)}</td>
<td><span class="status ${r.paid===true?"paid":"unpaid"}">${r.paid===true?"Paid":"Unpaid"}</span></td>
<td>${date(r.created_at)}</td>
<td><button class="row-action" data-record="${esc(r.id)}" type="button">${r.paid===true?"Mark unpaid":"Mark paid"}</button></td>
</tr>`
 }).join("");

 body.querySelectorAll("[data-record]").forEach(b=>b.onclick=()=>togglePayment(b.dataset.record));
};

/* ---------- actions ---------- */

const addAgent=async()=>{
 const full_name=$("newAdminName")?.value.trim(),
  id_number=$("newAdminIdNumber")?.value.trim(),
  email=$("newAdminEmail")?.value.trim().toLowerCase(),
  password=$("newAdminPassword")?.value||"",
  confirmPassword=$("confirmAdminPassword")?.value||"",
  btn=$("addAdminBtn");

 if(!full_name||!id_number||!email||!password||!confirmPassword)return msg("error","Fill in every field to create the agent.");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return msg("error","Enter a valid email address.");
 if(password.length<8)return msg("error","Password must be at least 8 characters.");
 if(password!==confirmPassword)return msg("error","Passwords do not match.");
 if(admins.some(a=>String(a.id_number||"").trim()===id_number))return msg("error","That agent ID number is already in use.");
 if(admins.some(a=>String(a.email||"").trim().toLowerCase()===email))return msg("error","That email is already in use.");

 try{
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Creating...'}
  const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"create",full_name,id_number,email,password}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  ["newAdminName","newAdminIdNumber","newAdminEmail","newAdminPassword","confirmAdminPassword"].forEach(id=>{if($(id))$(id).value=""});
  closeModal($("addAgentModal"));
  msg("success",`${full_name} was created.`);
  await refreshAll()
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not create the agent.")
 }finally{
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-user-plus"></i> Create agent'}
 }
};

const saveAgentEdit=async()=>{
 if(!agent)return;
 const full_name=$("editAdminName")?.value.trim(),
  id_number=$("editAdminIdNumber")?.value.trim(),
  email=$("editAdminEmail")?.value.trim().toLowerCase(),
  password=$("editAdminPassword")?.value||"",
  passwordConfirm=$("editAdminPasswordConfirm")?.value||"",
  btn=$("saveAgentEdit");

 if(!full_name||!id_number||!email)return msg("error","Full name, agent ID number and email are required.");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return msg("error","Enter a valid email address.");
 if(admins.some(a=>String(a.id)!==String(agent.id)&&String(a.id_number||"").trim()===id_number))return msg("error","That agent ID number belongs to another agent.");
 if(admins.some(a=>String(a.id)!==String(agent.id)&&String(a.email||"").trim().toLowerCase()===email))return msg("error","That email belongs to another agent.");
 if(password&&password.length<8)return msg("error","New password must be at least 8 characters.");
 if(password!==passwordConfirm)return msg("error","New passwords do not match.");

 try{
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...'}
  const{data,error}=await supabase.functions.invoke("admin-management",{
   body:{action:"update",id:agent.id,full_name,id_number,email,password:password||null}
  });
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  closeModal($("agentModal"));
  msg("success","Agent account updated.");
  await refreshAll()
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not update the agent.")
 }finally{
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save changes'}
 }
};

const savePermissions=async()=>{
 if(!agent)return;
 const btn=$("savePermissions"),p={};
 document.querySelectorAll("#pagePermissions [data-page]").forEach(x=>p[x.dataset.page]=x.checked===true);
 try{
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...'}
  const{error}=await supabase.from("admin_permissions").upsert({admin_id:agent.id,permissions:p,updated_at:new Date().toISOString()},{onConflict:"admin_id"});
  if(error)throw error;
  permissions[agent.id]=p;
  closeModal($("agentModal"));
  renderAgents();
  msg("success","Page access updated.")
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not save page access.")
 }finally{
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save access'}
 }
};

const deleteAgent=async()=>{
 if(!agent)return;
 const target=agent;
 if(!confirm(`Permanently delete ${target.email}? This also removes their login.`))return;
 try{
  const{data,error}=await supabase.functions.invoke("admin-management",{body:{action:"delete",id:target.id}});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  delete permissions[target.id];
  closeModal($("agentModal"));
  msg("success",`${target.email} was deleted.`);
  await refreshAll()
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not delete the agent.")
 }
};

const savePaymentSettings=async()=>{
 const approval=Number($("approvalPaymentAmount")?.value||0),
  sale=Number($("salePaymentAmount")?.value||0),
  btn=$("savePaymentSettings");
 if(!Number.isFinite(approval)||!Number.isFinite(sale)||approval<0||sale<0)return msg("error","Payment rates must be positive numbers.");
 try{
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...'}
  const{data,error:findError}=await supabase.from("admin_payment_settings").select("id").limit(1).maybeSingle();
  if(findError&&findError.code!=="PGRST116")throw findError;
  let error;
  if(data?.id){
   ({error}=await supabase.from("admin_payment_settings").update({approval_amount:approval,sale_amount:sale,updated_at:new Date().toISOString()}).eq("id",data.id))
  }else{
   ({error}=await supabase.from("admin_payment_settings").insert({approval_amount:approval,sale_amount:sale}))
  }
  if(error)throw error;
  paymentSettings={approval_amount:approval,sale_amount:sale};
  renderOverview();
  closeModal($("ratesModal"));
  msg("success","Payment rates saved.")
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not save payment rates.")
 }finally{
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save rates'}
 }
};

const togglePayment=async id=>{
 const record=paymentRecords.find(x=>String(x.id)===String(id));
 if(!record)return;
 const paid=record.paid!==true,now=paid?new Date().toISOString():null;
 try{
  const{error}=await supabase.from("admin_payments").update({paid,paid_at:now}).eq("id",record.id);
  if(error)throw error;
  record.paid=paid;
  record.paid_at=now;
  renderOverview();
  renderAgents();
  renderHistory();
  if(agent)renderAgentPayments();
  msg("success",paid?"Marked as paid.":"Marked as unpaid.")
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not update the payment.")
 }
};

const markAllPayments=async type=>{
 if(!agent)return;
 const records=paymentRecords.filter(x=>String(x.admin_id)===String(agent.id)&&x.type===type&&x.paid!==true);
 if(!records.length)return msg("error",`No unpaid ${type==="sale"?"sales":"approvals"} for this agent.`);
 try{
  const ids=records.map(x=>x.id),now=new Date().toISOString();
  const{error}=await supabase.from("admin_payments").update({paid:true,paid_at:now}).in("id",ids);
  if(error)throw error;
  paymentRecords.forEach(x=>{if(ids.some(id=>String(id)===String(x.id))){x.paid=true;x.paid_at=now}});
  renderOverview();
  renderAgents();
  renderHistory();
  renderAgentPayments();
  msg("success",`All ${type==="sale"?"sales":"approvals"} marked as paid.`)
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not update the payments.")
 }
};

/* ---------- boot ---------- */

const refreshAll=async()=>{
 setLoading("loading",true,"Loading agents...");
 setLoading("paymentHistoryLoading",true,"Loading payment history...");
 try{
  await Promise.all([loadAdmins(),loadPaymentSettings(),loadPaymentRecords()]);
  renderOverview();
  renderAgents();
  renderHistory();
  if(agent){
   agent=admins.find(x=>String(x.id)===String(agent.id))||null;
   if(agent){renderPermissions();renderAgentPayments()}
   else closeModal($("agentModal"));
  }
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not load agent information.")
 }finally{
  setLoading("loading",false);
  setLoading("paymentHistoryLoading",false)
 }
};

const init=async()=>{
 $("openAddAgent")?.addEventListener("click",()=>{openModal("addAgentModal");setTimeout(()=>$("newAdminName")?.focus(),120)});
 $("openRates")?.addEventListener("click",()=>openModal("ratesModal"));
 $("openHistory")?.addEventListener("click",()=>{renderHistory();openModal("historyModal")});
 $("refreshBtn")?.addEventListener("click",refreshAll);

 $("addAdminBtn")?.addEventListener("click",addAgent);
 $("savePaymentSettings")?.addEventListener("click",savePaymentSettings);
 $("saveAgentEdit")?.addEventListener("click",saveAgentEdit);
 $("savePermissions")?.addEventListener("click",savePermissions);
 $("deleteAgentBtn")?.addEventListener("click",deleteAgent);
 $("allowAllPerms")?.addEventListener("click",()=>setAllPermissions(true));
 $("clearAllPerms")?.addEventListener("click",()=>setAllPermissions(false));
 $("markAllApprovalsPaid")?.addEventListener("click",()=>markAllPayments("approval"));
 $("markAllSalesPaid")?.addEventListener("click",()=>markAllPayments("sale"));

 document.querySelectorAll("#agentModal .tabs:not(.sub) .tab").forEach(t=>t.addEventListener("click",()=>setTab(t.dataset.tab)));
 document.querySelectorAll("[data-record-tab]").forEach(t=>t.addEventListener("click",()=>{recordTab=t.dataset.recordTab;renderAgentPayments()}));

 document.querySelectorAll("[data-payment-filter]").forEach(b=>b.addEventListener("click",()=>{
  historyFilter=b.dataset.paymentFilter||"all";
  document.querySelectorAll("[data-payment-filter]").forEach(x=>x.classList.toggle("active",x===b));
  renderHistory()
 }));

 $("agentSearch")?.addEventListener("input",e=>{search=e.target.value||"";renderAgents()});

 const bindToggle=(btnId,inputId)=>$(btnId)?.addEventListener("click",()=>{
  const input=$(inputId),btn=$(btnId);
  if(!input||!btn)return;
  input.type=input.type==="password"?"text":"password";
  btn.innerHTML=input.type==="password"?'<i class="fa-solid fa-eye"></i>':'<i class="fa-solid fa-eye-slash"></i>';
 });
 bindToggle("toggleEditPassword","editAdminPassword");
 bindToggle("toggleEditPasswordConfirm","editAdminPasswordConfirm");

 document.addEventListener("click",e=>{
  const hit=e.target.closest("[data-close]");
  if(hit)closeModal(hit.closest(".modal"));
 });

 document.addEventListener("keydown",e=>{if(e.key==="Escape")closeTop()});

 $("menu")?.addEventListener("click",()=>{$("sidebar")?.classList.add("open");$("overlay")?.classList.add("show")});
 const closeMenu=()=>{$("sidebar")?.classList.remove("open");$("overlay")?.classList.remove("show")};
 $("closeMenu")?.addEventListener("click",closeMenu);
 $("overlay")?.addEventListener("click",closeMenu);

 $("logoutBtn")?.addEventListener("click",async()=>{await supabase.auth.signOut();location.replace("auth.html")});

 const hideLoader=()=>setTimeout(()=>$("loader")?.classList.add("hide"),400);
 document.readyState==="complete"?hideLoader():window.addEventListener("load",hideLoader);

  try{
  me=await auth();
  if(!me)return;
  attachBadges?.().catch(e=>console.error("badges",e));
  await refreshAll()
 }catch(e){
  console.error(e);
  msg("error",e.message||"Could not start agent management.")
 }
};

init();