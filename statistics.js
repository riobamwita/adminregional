import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";
import{attachBadges}from"./admin-nav.js";
const $=id=>document.getElementById(id);

let cars=[],ground=[],deductions=[],sales=[],currentAdmin=null,dedFilter="all";

const money=n=>`KES ${Number(n||0).toLocaleString("en-KE",{maximumFractionDigits:2})}`;
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const date=v=>v?new Date(v).toLocaleDateString("en-KE",{year:"numeric",month:"short",day:"numeric"}):"—";
const msg=(id,t)=>{const el=$(id);if(!el)return;el.textContent=t;el.classList.add("active");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("active"),3500)};
const fail=e=>{console.error(e);msg("error",e?.message||"Something went wrong.")};

/* ---------- data shaping ---------- */

function inventoryRecords(){
 return cars.filter(x=>x.status==="sold").map(x=>({
  id:`car-${x.id}`,source:"inventory",
  vehicle:`${x.make||""} ${x.model||""} ${x.year||""}`.trim()||"Unnamed Vehicle",
  amount:Number(x.price||0),
  sale_date:x.updated_at||x.created_at,
  make:x.make||"",model:x.model||"",year:x.year||"",
  reference:x.stock_number||"",notes:x.location||"",car_id:x.id
 }))
}

function buildSales(){
 sales=[...inventoryRecords(),...ground.map(x=>({...x,source:"ground"}))]
  .sort((a,b)=>new Date(b.sale_date||b.created_at)-new Date(a.sale_date||a.created_at))
}

const deductionTotal=()=>deductions.reduce((s,x)=>s+Number(x.amount||0),0);

/* ---------- stats ---------- */

function updateStats(){
 const inv=inventoryRecords(),
  all=sales,
  amounts=all.map(x=>Number(x.amount||0)),
  total=amounts.reduce((a,b)=>a+b,0),
  highest=amounts.length?Math.max(...amounts):0,
  lowest=amounts.length?Math.min(...amounts):0,
  dedTotal=deductionTotal(),
  dedAmounts=deductions.map(x=>Number(x.amount||0)),
  net=total-dedTotal;

 $("totalRevenue").textContent=money(total);
 $("totalDeductions").textContent=money(dedTotal);
 $("netIncome").textContent=money(net);
 $("netIncome").classList.toggle("negative",net<0);
 $("totalSales").textContent=all.length;
 $("inventorySales").textContent=inv.length;
 $("groundSales").textContent=ground.length;
 $("averageSale").textContent=money(all.length?total/all.length:0);

 $("availableCount").textContent=cars.filter(x=>x.status==="available").length;
 $("reservedCount").textContent=cars.filter(x=>x.status==="reserved").length;
 $("soldCount").textContent=inv.length;
 $("inactiveCount").textContent=cars.filter(x=>x.status==="inactive").length;

 $("highestSale").textContent=money(highest);
 $("lowestSale").textContent=money(lowest);
 $("latestSale").textContent=all.length?`${all[0].vehicle} • ${date(all[0].sale_date)}`:"No sales yet";
 $("deductionCount").textContent=deductions.length;
 $("largestDeduction").textContent=money(dedAmounts.length?Math.max(...dedAmounts):0);

 $("dedTotal").textContent=money(dedTotal);
 $("dedCount").textContent=deductions.length;
 $("dedTabCount").textContent=deductions.length;
 $("dedNet").textContent=money(net);
 $("dedNet").classList.toggle("negative",net<0);
}

/* ---------- ledger ---------- */

function filtered(){
 const q=$("searchInput").value.toLowerCase().trim(),
  source=$("sourceFilter").value,
  period=$("dateFilter").value,
  now=new Date();
 return sales.filter(x=>{
  const d=new Date(x.sale_date||x.created_at),
   match=!q||`${x.vehicle||""} ${x.make||""} ${x.model||""} ${x.notes||""} ${x.reference||""}`.toLowerCase().includes(q),
   s=source==="all"||x.source===source,
   p=period==="all"
    ||period==="today"&&d.toDateString()===now.toDateString()
    ||period==="month"&&d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()
    ||period==="year"&&d.getFullYear()===now.getFullYear();
  return match&&s&&p
 })
}

function render(){
 const list=filtered();
 $("empty").style.display=list.length?"none":"block";
 $("salesTable").innerHTML=list.map(x=>`<tr>
<td><strong>${esc(x.vehicle)}</strong><small>${esc([x.make,x.model,x.year].filter(Boolean).join(" ")||"Vehicle sale record")}</small></td>
<td><span class="source ${x.source}"><i class="fa-solid ${x.source==="inventory"?"fa-car":"fa-handshake"}"></i> ${x.source==="inventory"?"Inventory":"Ground Sale"}</span></td>
<td class="amount">${money(x.amount)}</td>
<td>${date(x.sale_date||x.created_at)}</td>
<td><small>${esc(x.reference||x.notes||"—")}</small></td>
<td>${x.source==="ground"?`<button class="delete-sale" data-id="${esc(x.id)}" type="button"><i class="fa-solid fa-trash"></i></button>`:`<span class="auto">Automatic</span>`}</td>
</tr>`).join("");
 document.querySelectorAll(".delete-sale").forEach(b=>b.onclick=()=>removeSale(b.dataset.id));
}

/* ---------- deductions ---------- */

function filteredDeductions(){
 const now=new Date();
 return deductions.filter(x=>{
  if(dedFilter==="all")return true;
  const d=new Date(x.deduction_date||x.created_at);
  if(dedFilter==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();
  if(dedFilter==="year")return d.getFullYear()===now.getFullYear();
  return true
 })
}

function renderDeductions(){
 const el=$("deductionList");
 if(!el)return;
 const list=filteredDeductions();
 if(!list.length){
  el.innerHTML=`<div class="ded-empty"><i class="fa-solid fa-receipt"></i><h3>No deductions recorded</h3><p>Costs you record are subtracted from revenue right away.</p></div>`;
  return
 }
 el.innerHTML=list.map(x=>`<div class="ded-item">
<div class="ded-icon"><i class="fa-solid fa-money-bill-transfer"></i></div>
<div class="ded-info">
<strong>${esc(x.title||"Deduction")}</strong>
<span>${esc(x.category||"Uncategorised")} · ${date(x.deduction_date||x.created_at)}${x.reference?` · ${esc(x.reference)}`:""}</span>
${x.notes?`<small>${esc(x.notes)}</small>`:""}
</div>
<div class="ded-amount">${money(x.amount)}</div>
<button class="delete-ded" data-ded="${esc(x.id)}" type="button"><i class="fa-solid fa-trash"></i></button>
</div>`).join("");
 el.querySelectorAll("[data-ded]").forEach(b=>b.onclick=()=>removeDeduction(b.dataset.ded));
}

function setDedTab(tab){
 document.querySelectorAll("[data-ded-tab]").forEach(t=>t.classList.toggle("active",t.dataset.dedTab===tab));
 document.querySelectorAll("[data-ded-pane]").forEach(p=>p.classList.toggle("hidden",p.dataset.dedPane!==tab));
}

async function removeDeduction(id){
 if(!confirm("Delete this deduction? Net income will be recalculated."))return;
 try{
  const{error}=await supabase.from("deductions").delete().eq("id",id);
  if(error)throw error;
  deductions=deductions.filter(x=>String(x.id)!==String(id));
  updateStats();
  renderDeductions();
  msg("success","Deduction deleted.")
 }catch(e){fail(e)}
}

/* ---------- load ---------- */

async function load(){
 $("loading").style.display="block";
 $("salesTable").innerHTML="";
 try{
  const[{data:c,error:ce},{data:g,error:ge},{data:d,error:de}]=await Promise.all([
   supabase.from("cars").select("*").order("created_at",{ascending:false}),
   supabase.from("ground_sales").select("*").order("sale_date",{ascending:false}),
   supabase.from("deductions").select("*").order("deduction_date",{ascending:false})
  ]);
  if(ce)throw ce;
  if(ge)throw ge;
  if(de)throw de;
  cars=c||[];
  ground=g||[];
  deductions=d||[];
  buildSales();
  updateStats();
  render();
  renderDeductions()
 }catch(e){
  fail(e)
 }finally{
  $("loading").style.display="none"
 }
}

/* ---------- modals ---------- */

const today=()=>new Date().toISOString().slice(0,10);

function openSale(){
 $("saleModal").classList.add("open");
 document.body.classList.add("locked");
 $("saleDate").value=$("saleDate").value||today();
 setTimeout(()=>$("saleVehicle").focus(),120)
}
function closeSale(){
 $("saleModal").classList.remove("open");
 document.body.classList.remove("locked");
 $("groundSaleForm").reset();
 $("saleDate").value=today()
}
function openDeduction(){
 $("deductionModal").classList.add("open");
 document.body.classList.add("locked");
 $("dedDate").value=$("dedDate").value||today();
 setDedTab("add");
 renderDeductions();
 setTimeout(()=>$("dedTitle").focus(),120)
}
function closeDeduction(){
 $("deductionModal").classList.remove("open");
 document.body.classList.remove("locked");
 $("deductionForm").reset();
 $("dedDate").value=today()
}
const closeAll=()=>{
 if($("saleModal").classList.contains("open"))closeSale();
 if($("deductionModal").classList.contains("open"))closeDeduction()
};

async function removeSale(id){
 if(!confirm("Delete this manual sale record?"))return;
 try{
  const{error}=await supabase.from("ground_sales").delete().eq("id",id);
  if(error)throw error;
  msg("success","Ground sale record deleted.");
  await load()
 }catch(e){fail(e)}
}

/* ---------- forms ---------- */

$("groundSaleForm").onsubmit=async e=>{
 e.preventDefault();
 const f=new FormData(e.currentTarget),b=$("saveSale");
 try{
  b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  const{error}=await supabase.from("ground_sales").insert({
   vehicle:f.get("vehicle").trim(),
   amount:Number(f.get("amount")),
   sale_date:f.get("sale_date"),
   make:f.get("make").trim()||null,
   model:f.get("model").trim()||null,
   year:f.get("year")?Number(f.get("year")):null,
   reference:f.get("reference").trim()||null,
   notes:f.get("notes").trim()||null
  });
  if(error)throw error;
  closeSale();
  msg("success","Ground sale recorded successfully.");
  await load()
 }catch(e){
  fail(e)
 }finally{
  b.disabled=false;b.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save Sale Record'
 }
};

$("deductionForm").onsubmit=async e=>{
 e.preventDefault();
 const f=new FormData(e.currentTarget),b=$("saveDeduction"),amount=Number(f.get("amount"));
 if(!Number.isFinite(amount)||amount<0)return msg("error","Enter a valid deduction amount.");
 try{
  b.disabled=true;b.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  const{data,error}=await supabase.from("deductions").insert({
   title:f.get("title").trim(),
   amount,
   deduction_date:f.get("deduction_date"),
   category:f.get("category")||null,
   reference:f.get("reference").trim()||null,
   notes:f.get("notes").trim()||null
  }).select().single();
  if(error)throw error;
  if(data)deductions=[data,...deductions];
  $("deductionForm").reset();
  $("dedDate").value=today();
  updateStats();
  renderDeductions();
  setDedTab("list");
  msg("success","Deduction recorded.")
 }catch(e){
  fail(e)
 }finally{
  b.disabled=false;b.innerHTML='<i class="fa-solid fa-floppy-disk"></i> Save Deduction'
 }
};

/* ---------- events ---------- */

$("searchInput").oninput=render;
$("sourceFilter").onchange=render;
$("dateFilter").onchange=render;
$("refreshStats").onclick=load;

$("openSaleModal").onclick=openSale;
$("emptyAddSale").onclick=openSale;
$("closeSaleModal").onclick=closeSale;
$("cancelSale").onclick=closeSale;
$("saleModalBg").onclick=closeSale;

$("openDeductionModal").onclick=openDeduction;
$("closeDeductionModal").onclick=closeDeduction;
$("cancelDeduction").onclick=closeDeduction;
$("closeDeductionList").onclick=closeDeduction;
$("deductionModalBg").onclick=closeDeduction;

document.querySelectorAll("[data-ded-tab]").forEach(t=>t.onclick=()=>setDedTab(t.dataset.dedTab));
document.querySelectorAll("[data-ded-filter]").forEach(b=>b.onclick=()=>{
 dedFilter=b.dataset.dedFilter||"all";
 document.querySelectorAll("[data-ded-filter]").forEach(x=>x.classList.toggle("active",x===b));
 renderDeductions()
});

$("menu").onclick=()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")};
$("closeMenu").onclick=$("overlay").onclick=()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")};
$("logoutBtn").onclick=async()=>{await supabase.auth.signOut();location.href="auth.html"};

document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll()});

window.addEventListener("load",()=>{
 setTimeout(()=>$("loader")?.classList.add("hide"),450);
 $("saleDate").value=today();
 $("dedDate").value=today()
});

/* same guard pattern as every other admin page */
requireAdmin("statistics").then(admin=>{
 if(!admin)return;
 currentAdmin=admin;
 load();
 attachBadges()
});