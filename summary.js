import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id);
const money=v=>`KES ${Number(v||0).toLocaleString("en-KE",{maximumFractionDigits:2})}`;
const date=v=>v&&new Date(v).getTime()?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—";
const day=v=>v?new Date(v).toLocaleDateString("en-KE",{year:"numeric",month:"short",day:"numeric"}):"—";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const num=v=>Number(v)||0;

const SOURCES=[
["vehicle_enquiries","Vehicle Enquiries","fa-car"],
["tradein_requests","Trade-Ins","fa-right-left"],
["import_requests","Imports","fa-ship"],
["financing_requests","Financing","fa-coins"],
["returning_resident_requests","Diaspora","fa-earth-africa"],
["accessible_car_requests","Accessible Cars","fa-wheelchair"],
["vehicle_reservations","Reservations","fa-calendar-check"],
["test_drive_bookings","Test Drives","fa-road"],
["insurance_requests","Insurance","fa-shield-halved"],
["sell_car_requests","Sell Your Car","fa-car-side"]
];

const EXTRA=[
["cars","Inventory Sales","fa-car"],
["ground_sales","Ground Sales","fa-money-bill-transfer"],
["agent_vehicle_submissions","Agent Vehicles","fa-user-tie"],
["admin_payments","Admin Payments","fa-money-check-dollar"]
];

let raw={},cars=[],ground=[],agentSubmissions=[],payments=[],activities=[],range={from:null,to:null,period:"30"};

const query=async table=>{
 try{
  const{data,error}=await supabase.from(table).select("*");
  if(error){
   console.error(`[SUMMARY] ${table}:`,error);
   return[];
  }
  return data||[];
 }catch(e){
  console.error(`[SUMMARY] ${table}:`,e);
  return[];
 }
};

const nameOf=(x,t)=>{
 if(t==="vehicle_reservations")return x.customer_name||x.full_name||x.email||"Customer";
 if(t==="test_drive_bookings")return x.full_name||x.customer_name||x.email||"Customer";
 return x.full_name||x.customer_name||x.email||"Unnamed";
};

const statusOf=(x,t)=>{
 let s=String(x.status||"new").toLowerCase();
 if((t==="tradein_requests"||t==="sell_car_requests")&&x.approved_car_id)s="approved";
 return s;
};

const dateOf=(x,t)=>{
 const v=x.created_at||x.sale_date||x.updated_at||x.approved_at||null;
 return v?new Date(v):new Date(0);
};

const referenceOf=(x,t)=>{
 if(t==="vehicle_enquiries")return x.registration||x.stock_number||[x.vehicle_make,x.vehicle_model].filter(Boolean).join(" ");
 if(t==="vehicle_reservations")return x.stock_number||x.mpesa_reference||x.id;
 if(t==="test_drive_bookings")return x.mpesa_reference||x.car_id||x.id;
 if(t==="sell_car_requests")return x.registration||[x.make,x.model,x.year].filter(Boolean).join(" ");
 if(t==="tradein_requests")return x.registration||[x.vehicle_make,x.vehicle_model].filter(Boolean).join(" ");
 if(t==="import_requests")return [x.make,x.model,x.country].filter(Boolean).join(" ");
 if(t==="financing_requests")return x.stock_number||[x.vehicle_make,x.vehicle_model].filter(Boolean).join(" ");
 if(t==="returning_resident_requests")return x.country||x.kra_pin;
 if(t==="accessible_car_requests")return x.vehicle_type||x.disability_type;
 if(t==="insurance_requests")return x.registration||x.vehicle||"Insurance";
 return x.reference||x.id||"";
};

const valueOf=(x,t)=>{
 if(t==="vehicle_reservations")return num(x.deposit_amount);
 if(t==="test_drive_bookings")return num(x.fee);
 if(t==="sell_car_requests")return num(x.asking_price||x.expected_value);
 if(t==="tradein_requests")return num(x.expected_value);
 if(t==="import_requests")return num(x.budget);
 if(t==="insurance_requests")return num(x.premium);
 if(t==="financing_requests")return num(x.budget||x.vehicle_price||x.loan_amount);
 if(t==="cars")return num(x.price);
 if(t==="ground_sales")return num(x.amount||x.sale_amount||x.price);
 if(t==="admin_payments")return num(x.amount);
 return 0;
};

const sourceLabel=t=>[...SOURCES,...EXTRA].find(x=>x[0]===t)?.[1]||t;
const iconOf=t=>[...SOURCES,...EXTRA].find(x=>x[0]===t)?.[2]||"fa-chart-line";

function toDateInput(d){
 const x=new Date(d);
 return Number.isNaN(x.getTime())?"":x.toISOString().slice(0,10);
}

function setPeriod(p){
 const now=new Date();
 let f=null,t=null;

 if(p==="today"){
  f=new Date(now);
  f.setHours(0,0,0,0);
  t=new Date(now);
  t.setHours(23,59,59,999);
 }else if(p!=="all"){
  if(p==="year")f=new Date(now.getFullYear(),0,1);
  else{
   f=new Date(now);
   f.setDate(f.getDate()-Number(p)+1);
   f.setHours(0,0,0,0);
  }
  t=new Date(now);
  t.setHours(23,59,59,999);
 }

 range={from:f,to:t,period:p};

 $("dateFrom").value=f?toDateInput(f):"";
 $("dateTo").value=t?toDateInput(t):"";

 document.querySelectorAll(".period-buttons button").forEach(b=>b.classList.toggle("active",b.dataset.period===p));

 $("periodLabel").textContent=p==="all"?"All time":p==="year"?"This year":p==="today"?"Today":`Last ${p} days`;

 renderAll();
}

function applyDates(){
 const f=$("dateFrom").value;
 const t=$("dateTo").value;

 range={
  from:f?new Date(`${f}T00:00:00`):null,
  to:t?new Date(`${t}T23:59:59.999`):null,
  period:"custom"
 };

 document.querySelectorAll(".period-buttons button").forEach(b=>b.classList.remove("active"));

 $("periodLabel").textContent=f&&t?`${day(f)} – ${day(t)}`:"Custom range";

 renderAll();
}

const inRange=d=>{
 const z=d instanceof Date?d:new Date(d);
 if(Number.isNaN(z.getTime()))return false;
 return(!range.from||z>=range.from)&&(!range.to||z<=range.to);
};

async function load(){
 try{
  $("loading").style.display="block";
  $("error").classList.remove("active");

  const admin=await requireAdmin("statistics");
  if(!admin)return;

  const results=await Promise.all([
   ...SOURCES.map(x=>query(x[0])),
   query("cars"),
   query("ground_sales"),
   query("agent_vehicle_submissions"),
   query("admin_payments")
  ]);

  SOURCES.forEach((s,i)=>raw[s[0]]=results[i]);

  cars=results[SOURCES.length]||[];
  ground=results[SOURCES.length+1]||[];
  agentSubmissions=results[SOURCES.length+2]||[];
  payments=results[SOURCES.length+3]||[];

  activities=[];

  SOURCES.forEach(([t])=>{
   (raw[t]||[]).forEach(x=>{
    activities.push({
     date:dateOf(x,t),
     source:t,
     customer:nameOf(x,t),
     reference:referenceOf(x,t),
     status:statusOf(x,t),
     value:valueOf(x,t),
     record:x
    });
   });
  });

  cars.filter(x=>x.status==="sold").forEach(x=>{
   activities.push({
    date:dateOf(x,"cars"),
    source:"cars",
    customer:"Inventory Sale",
    reference:x.stock_number||`${x.make||""} ${x.model||""}`.trim(),
    status:"sold",
    value:num(x.price),
    record:x
   });
  });

  ground.forEach(x=>{
   activities.push({
    date:dateOf(x,"ground_sales"),
    source:"ground_sales",
    customer:x.vehicle||x.customer_name||"Ground Sale",
    reference:x.reference||x.id||"",
    status:String(x.status||"sold").toLowerCase(),
    value:valueOf(x,"ground_sales"),
    record:x
   });
  });

  activities.sort((a,b)=>b.date-a.date);

  syncSourceFilter();
  setPeriod("30");

 }catch(e){
  console.error("[SUMMARY FATAL]",e);
  $("error").textContent=e?.message||"Unable to load summary.";
  $("error").classList.add("active");
 }finally{
  $("loading").style.display="none";
  $("loader")?.classList.add("hide");
 }
}

function syncSourceFilter(){
 const el=$("activitySource");
 if(!el)return;

 el.innerHTML=`<option value="all">All Sources</option>`+
 [...SOURCES,...EXTRA.slice(0,2)].map(x=>`<option value="${x[0]}">${esc(x[1])}</option>`).join("");
}

function filteredActivities(){
 const q=($("activitySearch")?.value||"").toLowerCase().trim();
 const source=$("activitySource")?.value||"all";

 return activities.filter(a=>{
  const text=`${a.customer} ${a.reference} ${a.status} ${sourceLabel(a.source)}`.toLowerCase();
  return inRange(a.date)&&(!q||text.includes(q))&&(source==="all"||a.source===source);
 });
}

function pct(n,t){
 return t?Math.round(n/t*100):0;
}

function row(label,value,sub=""){
 return`<div class="metric-row"><div><span>${esc(label)}</span>${sub?`<small>${esc(sub)}</small>`:""}</div><strong>${esc(value)}</strong></div>`;
}

function bar(label,n,total,meta=""){
 const p=pct(n,total);
 return`<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><strong>${n.toLocaleString("en-KE")}</strong></div><div class="bar-track"><i style="width:${p}%"></i></div><small>${meta||p+"%"}</small></div>`;
}

function renderRequests(){
 const data=SOURCES.map(([t,l])=>[l,(raw[t]||[]).filter(x=>inRange(dateOf(x,t))).length]);
 const total=data.reduce((a,x)=>a+x[1],0);

 $("requestBreakdown").innerHTML=data.map(x=>row(x[0],x[1],`${pct(x[1],total)}% of tracked requests`)).join("");
}

function renderInventory(){
 const inv=cars.filter(x=>inRange(dateOf(x,"cars")));
 const available=inv.filter(x=>x.status==="available").length;
 const reserved=inv.filter(x=>x.status==="reserved").length;
 const sold=inv.filter(x=>x.status==="sold").length;
 const featured=inv.filter(x=>x.featured===true).length;

 $("inventoryBreakdown").innerHTML=[
  row("Total vehicles",inv.length),
  row("Available",available),
  row("Reserved",reserved),
  row("Sold",sold),
  row("Featured",featured)
 ].join("");
}

function renderRevenue(){
 const soldCars=cars.filter(x=>x.status==="sold"&&inRange(dateOf(x,"cars")));
 const groundSales=ground.filter(x=>inRange(dateOf(x,"ground_sales")));
 const inventoryRevenue=soldCars.reduce((a,x)=>a+num(x.price),0);
 const groundRevenue=groundSales.reduce((a,x)=>a+valueOf(x,"ground_sales"),0);
 const total=inventoryRevenue+groundRevenue;
 const count=soldCars.length+groundSales.length;
 const avg=count?total/count:0;

 $("revenueBreakdown").innerHTML=[
  row("Total sales value",money(total)),
  row("Inventory sales",money(inventoryRevenue),`${soldCars.length} vehicles`),
  row("Ground sales",money(groundRevenue),`${groundSales.length} records`),
  row("Average sale",money(avg)),
  row("Highest inventory sale",money(Math.max(0,...soldCars.map(x=>num(x.price)))))
].join("");

 $("salesCount").textContent=count;
 $("salesValue").textContent=money(total);
}

function renderOperations(){
 const groups=[
  ["test_drive_bookings","Test Drives"],
  ["vehicle_reservations","Reservations"],
  ["insurance_requests","Insurance"],
  ["agent_vehicle_submissions","Agent Vehicles"]
 ];

 const vals=groups.map(([t,l])=>[
  l,
  t==="agent_vehicle_submissions"
   ?agentSubmissions.filter(x=>inRange(dateOf(x,t))).length
   :(raw[t]||[]).filter(x=>inRange(dateOf(x,t))).length
 ]);

 const total=vals.reduce((a,x)=>a+x[1],0);

 $("operationsBreakdown").innerHTML=vals.map(x=>row(x[0],x[1],`${pct(x[1],total)}% of operational activity`)).join("");
}

function renderBars(){
 const sourceData=SOURCES.map(([t,l])=>[
  l,
  activities.filter(a=>a.source===t&&inRange(a.date)).length
 ]);

 const total=sourceData.reduce((a,x)=>a+x[1],0);
 $("sourceBars").innerHTML=sourceData.map(x=>bar(x[0],x[1],total)).join("");

 const status={};

 activities.filter(a=>inRange(a.date)).forEach(a=>{
  const s=a.status||"new";
  status[s]=(status[s]||0)+1;
 });

 const ss=Object.entries(status).sort((a,b)=>b[1]-a[1]);
 const st=ss.reduce((a,x)=>a+x[1],0);

 $("statusBars").innerHTML=ss.map(([k,n])=>bar(k.replaceAll("-"," "),n,st)).join("")||
 `<div class="empty-inline"><i class="fa-solid fa-chart-column"></i><span>No status data in this period.</span></div>`;
}

function renderStats(){
 const req=activities.filter(a=>!["cars","ground_sales"].includes(a.source)&&inRange(a.date)).length;
 const inv=cars.filter(x=>["available","reserved"].includes(x.status)&&inRange(dateOf(x,"cars"))).length;
 const all=filteredActivities();

 $("totalActivity").textContent=all.length;
 $("totalRequests").textContent=req;
 $("activeInventory").textContent=inv;
}

function renderActivity(){
 const list=filteredActivities();
 const limit=num($("activityLimit")?.value||25);

 $("activityBody").innerHTML=list.slice(0,limit).map(a=>
 `<tr><td>${date(a.date)}</td><td><span class="source-chip"><i class="fa-solid ${iconOf(a.source)}"></i>${esc(sourceLabel(a.source))}</span></td><td><strong>${esc(a.customer)}</strong></td><td>${esc(a.reference||"—")}</td><td><span class="status-chip ${esc(a.status||"new")}">${esc(a.status||"new")}</span></td><td class="amount">${a.value?money(a.value):"—"}</td></tr>`
 ).join("");

 $("activityEmpty").style.display=list.length?"none":"flex";
}

function renderDetails(){
 const f=activities.filter(a=>inRange(a.date));
 const approval=payments.filter(x=>inRange(dateOf(x,"admin_payments")));
 const agent=agentSubmissions.filter(x=>inRange(dateOf(x,"agent_vehicle_submissions")));

 const newCount=f.filter(a=>["new","pending"].includes(a.status)).length;
 const approved=f.filter(a=>a.status==="approved").length;
 const completed=f.filter(a=>["completed","sold"].includes(a.status)).length;
 const cancelled=f.filter(a=>["cancelled","rejected"].includes(a.status)).length;

 const revenue=
  cars.filter(x=>x.status==="sold"&&inRange(dateOf(x,"cars"))).reduce((a,x)=>a+num(x.price),0)+
  ground.filter(x=>inRange(dateOf(x,"ground_sales"))).reduce((a,x)=>a+valueOf(x,"ground_sales"),0);

 $("detailMetrics").innerHTML=[
  ["New / Pending",newCount],
  ["Approved",approved],
  ["Completed / Sold",completed],
  ["Cancelled / Rejected",cancelled],
  ["Agent Submissions",agent.length],
  ["Agent Payment Records",approval.length],
  ["Reserved Inventory",cars.filter(x=>x.status==="reserved"&&inRange(dateOf(x,"cars"))).length],
  ["Gross Sales Value",money(revenue)]
 ].map(x=>`<div class="detail-metric"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join("");
}

function renderAll(){
 renderRequests();
 renderInventory();
 renderRevenue();
 renderOperations();
 renderBars();
 renderStats();
 renderActivity();
 renderDetails();
}

function exportCsv(){
 const list=filteredActivities();
 const lines=[
  ["Date","Source","Customer / Record","Reference","Status","Value"],
  ...list.map(a=>[a.date.toISOString(),sourceLabel(a.source),a.customer,a.reference,a.status,a.value])
 ];

 const csv=lines.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");

 a.href=url;
 a.download=`regional-autoselections-summary-${new Date().toISOString().slice(0,10)}.csv`;
 document.body.appendChild(a);
 a.click();
 a.remove();
 URL.revokeObjectURL(url);
}

$("refreshSummary")?.addEventListener("click",load);
$("exportCsv")?.addEventListener("click",exportCsv);
$("applyDates")?.addEventListener("click",applyDates);
$("clearDates")?.addEventListener("click",()=>setPeriod("all"));

document.querySelectorAll(".period-buttons button").forEach(b=>{
 b.addEventListener("click",()=>setPeriod(b.dataset.period));
});

$("activitySearch")?.addEventListener("input",renderActivity);
$("activitySource")?.addEventListener("change",renderActivity);
$("activityLimit")?.addEventListener("change",renderActivity);

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
 if(e.key==="Escape")closeMenu();
});

load();