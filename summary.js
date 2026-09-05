import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id);
const money=v=>`KES ${Number(v||0).toLocaleString("en-KE",{maximumFractionDigits:2})}`;
const date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—";
const day=v=>v?new Date(v).toLocaleDateString("en-KE",{year:"numeric",month:"short",day:"numeric"}):"—";
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const num=v=>Number(v||0);

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

let raw={},cars=[],ground=[],agentSubmissions=[],payments=[],activities=[],range={from:null,to:null,period:"30"};

const query=async table=>{
 try{
  const{data,error}=await supabase.from(table).select("*");
  if(error)throw error;
  return{data:data||[],error:null}
 }catch(error){return{data:[],error}}
};

const nameOf=(x,t)=>t==="vehicle_reservations"?x.customer_name||"Customer":t==="test_drive_bookings"?x.full_name||"Customer":x.full_name||x.customer_name||x.email||"Unnamed";

const statusOf=(x,t)=>{
 let s=String(x.status||"new").toLowerCase();
 if(t==="tradein_requests"&&x.approved_car_id)s="approved";
 if(t==="sell_car_requests"&&x.approved_car_id)s="approved";
 return s
};

const dateOf=(x,t)=>new Date(x.created_at||x.sale_date||x.updated_at||0);

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
 return ""
};

const valueOf=(x,t)=>{
 if(t==="vehicle_reservations")return num(x.deposit_amount);
 if(t==="test_drive_bookings")return num(x.fee);
 if(t==="sell_car_requests")return num(x.asking_price);
 if(t==="tradein_requests")return num(x.expected_value);
 if(t==="import_requests")return num(x.budget);
 if(t==="insurance_requests")return num(x.premium);
 if(t==="financing_requests")return num(x.budget||x.vehicle_price||x.loan_amount);
 return 0
};

const sourceLabel=t=>SOURCES.find(x=>x[0]===t)?.[1]||t;

const iconOf=t=>SOURCES.find(x=>x[0]===t)?.[2]||"fa-chart-line";

function toDateInput(d){
 return new Date(d).toISOString().slice(0,10)
}

function setPeriod(p){
 let now=new Date(),f=null,t=null;

 if(p==="today"){
  f=new Date(now);
  f.setHours(0,0,0,0);
  t=new Date(now);
  t.setHours(23,59,59,999)
 }else if(p!=="all"){
  if(p==="year")f=new Date(now.getFullYear(),0,1);
  else{
   f=new Date(now);
   f.setDate(f.getDate()-Number(p)+1)
  }
  t=new Date(now);
  t.setHours(23,59,59,999)
 }

 range={from:f,to:t,period:p};

 $("dateFrom").value=f?toDateInput(f):"";
 $("dateTo").value=t?toDateInput(t):"";

 document.querySelectorAll(".period-buttons button").forEach(b=>b.classList.toggle("active",b.dataset.period===p));

 $("periodLabel").textContent=
  p==="all"?"All time":
  p==="year"?"This year":
  p==="today"?"Today":
  `Last ${p} days`;

 renderAll()
}

function applyDates(){
 let f=$("dateFrom").value,t=$("dateTo").value;

 range={
  from:f?new Date(`${f}T00:00:00`):null,
  to:t?new Date(`${t}T23:59:59.999`):null,
  period:"custom"
 };

 document.querySelectorAll(".period-buttons button").forEach(b=>b.classList.remove("active"));

 $("periodLabel").textContent=f&&t?`${day(f)} – ${day(t)}`:"Custom range";

 renderAll()
}

const inRange=d=>{
 let z=new Date(d);
 return(!range.from||z>=range.from)&&(!range.to||z<=range.to)
};

async function load(){
 $("loading").style.display="block";
 $("error").classList.remove("active");

 try{
  let res=await requireAdmin("statistics");
  if(!res)return;

  let results=await Promise.all([
   ...SOURCES.map(x=>query(x[0])),
   query("cars"),
   query("ground_sales"),
   query("agent_vehicle_submissions"),
   query("admin_payments")
  ]);

  SOURCES.forEach((s,i)=>raw[s[0]]=results[i].data);

  cars=results[SOURCES.length].data;
  ground=results[SOURCES.length+1].data;
  agentSubmissions=results[SOURCES.length+2].data;
  payments=results[SOURCES.length+3].data;

  activities=[];

  SOURCES.forEach(([t])=>
   (raw[t]||[]).forEach(x=>
    activities.push({
     date:dateOf(x,t),
     source:t,
     customer:nameOf(x,t),
     reference:referenceOf(x,t),
     status:statusOf(x,t),
     value:valueOf(x,t),
     record:x
    })
   )
  );

  cars.forEach(x=>{
   if(x.status==="sold"){
    activities.push({
     date:dateOf(x,"cars"),
     source:"cars",
     customer:"Inventory Sale",
     reference:x.stock_number||`${x.make||""} ${x.model||""}`.trim(),
     status:"sold",
     value:num(x.price),
     record:x
    })
   }
  });

  ground.forEach(x=>{
   activities.push({
    date:dateOf(x,"ground_sales"),
    source:"ground_sales",
    customer:x.vehicle||"Ground Sale",
    reference:x.reference||"",
    status:"sold",
    value:num(x.amount),
    record:x
   })
  });

  activities.sort((a,b)=>b.date-a.date);

  syncSourceFilter();
  setPeriod("30")

 }catch(e){
  $("error").textContent=e.message||"Unable to load summary.";
  $("error").classList.add("active")
 }finally{
  $("loading").style.display="none";
  $("loader")?.classList.add("hide")
 }
}

function syncSourceFilter(){
 let el=$("activitySource");
 if(!el)return;

 el.innerHTML=`<option value="all">All Sources</option>`+
 SOURCES.map(x=>`<option value="${x[0]}">${esc(x[1])}</option>`).join("")+
 `<option value="cars">Inventory Sales</option><option value="ground_sales">Ground Sales</option>`;
}

function filteredActivities(){
 let q=$("activitySearch").value.toLowerCase().trim();
 let source=$("activitySource").value;

 return activities.filter(a=>{
  let text=`${a.customer} ${a.reference} ${a.status} ${sourceLabel(a.source)}`.toLowerCase();

  return inRange(a.date)&&
   (!q||text.includes(q))&&
   (source==="all"||a.source===source)
 })
}

function pct(n,t){
 return t?Math.round(n/t*100):0
}

function row(label,value,sub=""){
 return`<div class="metric-row"><div><span>${esc(label)}</span>${sub?`<small>${esc(sub)}</small>`:""}</div><strong>${esc(value)}</strong></div>`
}

function bar(label,n,total,meta=""){
 let p=pct(n,total);

 return`<div class="bar-row">
 <div class="bar-label"><span>${esc(label)}</span><strong>${n.toLocaleString("en-KE")}</strong></div>
 <div class="bar-track"><i style="width:${p}%"></i></div>
 <small>${meta||p+"%"}</small>
 </div>`
}

function renderRequests(){
 let data=SOURCES.map(([t,l])=>[
  l,
  (raw[t]||[]).filter(x=>inRange(dateOf(x,t))).length,
  t
 ]);

 let total=data.reduce((a,x)=>a+x[1],0);

 $("requestBreakdown").innerHTML=data.map(x=>
  row(x[0],x[1],`${pct(x[1],total)}% of tracked requests`)
 ).join("")
}

function renderInventory(){
 let inv=cars.filter(x=>inRange(dateOf(x,"cars")));
 let available=inv.filter(x=>x.status==="available").length;
 let reserved=inv.filter(x=>x.status==="reserved").length;
 let sold=inv.filter(x=>x.status==="sold").length;
 let featured=inv.filter(x=>x.featured).length;

 $("inventoryBreakdown").innerHTML=[
  row("Total vehicles",inv.length),
  row("Available",available),
  row("Reserved",reserved),
  row("Sold",sold),
  row("Featured",featured)
 ].join("")
}

function renderRevenue(){
 let soldCars=cars.filter(x=>x.status==="sold"&&inRange(dateOf(x,"cars")));
 let groundSales=ground.filter(x=>inRange(dateOf(x,"ground_sales")));

 let inventoryRevenue=soldCars.reduce((a,x)=>a+num(x.price),0);
 let groundRevenue=groundSales.reduce((a,x)=>a+num(x.amount),0);
 let total=inventoryRevenue+groundRevenue;
 let count=soldCars.length+groundSales.length;
 let avg=count?total/count:0;

 $("revenueBreakdown").innerHTML=[
  row("Total sales value",money(total)),
  row("Inventory sales",money(inventoryRevenue),`${soldCars.length} vehicles`),
  row("Ground sales",money(groundRevenue),`${groundSales.length} records`),
  row("Average sale",money(avg)),
  row("Highest inventory sale",money(Math.max(0,...soldCars.map(x=>num(x.price)))))
 ].join("");

 $("salesCount").textContent=count;
 $("salesValue").textContent=money(total)
}

function renderOperations(){
 let groups=[
  ["test_drive_bookings","Test Drives"],
  ["vehicle_reservations","Reservations"],
  ["insurance_requests","Insurance"],
  ["agent_vehicle_submissions","Agent Vehicles"]
 ];

 let vals=groups.map(([t,l])=>{
  let a=t==="agent_vehicle_submissions"
   ?agentSubmissions.filter(x=>inRange(dateOf(x,t))).length
   :(raw[t]||[]).filter(x=>inRange(dateOf(x,t))).length;

  return[l,a]
 });

 let total=vals.reduce((a,x)=>a+x[1],0);

 $("operationsBreakdown").innerHTML=vals.map(x=>
  row(x[0],x[1],`${pct(x[1],total)}% of operational activity`)
 ).join("")
}

function renderBars(){
 let sourceData=SOURCES.map(([t,l])=>[
  l,
  activities.filter(a=>a.source===t&&inRange(a.date)).length
 ]);

 let total=sourceData.reduce((a,x)=>a+x[1],0);

 $("sourceBars").innerHTML=sourceData.map(x=>bar(x[0],x[1],total)).join("");

 let status={};

 activities
 .filter(a=>inRange(a.date))
 .forEach(a=>{
  let s=a.status||"new";
  status[s]=(status[s]||0)+1
 });

 let ss=Object.entries(status).sort((a,b)=>b[1]-a[1]);
 let st=ss.reduce((a,x)=>a+x[1],0);

 $("statusBars").innerHTML=ss.map(([k,n])=>
  bar(k.replaceAll("-"," "),n,st)
 ).join("")||`<div class="empty-inline"><i class="fa-solid fa-chart-column"></i><span>No status data in this period.</span></div>`
}

function renderStats(){
 let req=activities.filter(a=>
  !["cars","ground_sales"].includes(a.source)&&inRange(a.date)
 ).length;

 let inv=cars.filter(x=>
  ["available","reserved"].includes(x.status)&&inRange(dateOf(x,"cars"))
 ).length;

 let all=filteredActivities();

 $("totalActivity").textContent=all.length;
 $("totalRequests").textContent=req;
 $("activeInventory").textContent=inv
}

function renderActivity(){
 let list=filteredActivities();
 let limit=num($("activityLimit").value);

 $("activityBody").innerHTML=list.slice(0,limit).map(a=>
 `<tr>
  <td>${date(a.date)}</td>
  <td><span class="source-chip"><i class="fa-solid ${iconOf(a.source)}"></i>${esc(sourceLabel(a.source))}</span></td>
  <td><strong>${esc(a.customer)}</strong></td>
  <td>${esc(a.reference||"—")}</td>
  <td><span class="status-chip ${esc(a.status||"new")}">${esc(a.status||"new")}</span></td>
  <td class="amount">${a.value?money(a.value):"—"}</td>
 </tr>`
 ).join("");

 $("activityEmpty").style.display=list.length?"none":"flex"
}

function renderDetails(){
 let f=activities.filter(a=>inRange(a.date));

 let approval=payments.filter(x=>inRange(dateOf(x,"admin_payments")));
 let agent=agentSubmissions.filter(x=>inRange(dateOf(x,"agent_vehicle_submissions")));

 let newCount=f.filter(a=>["new","pending"].includes(a.status||"new")).length;
 let approved=f.filter(a=>a.status==="approved").length;
 let completed=f.filter(a=>["completed","sold"].includes(a.status)).length;
 let cancelled=f.filter(a=>["cancelled","rejected"].includes(a.status)).length;

 let revenue=
  cars.filter(x=>x.status==="sold"&&inRange(dateOf(x,"cars"))).reduce((a,x)=>a+num(x.price),0)+
  ground.filter(x=>inRange(dateOf(x,"ground_sales"))).reduce((a,x)=>a+num(x.amount),0);

 $("detailMetrics").innerHTML=[
  ["New / Pending",newCount],
  ["Approved",approved],
  ["Completed / Sold",completed],
  ["Cancelled / Rejected",cancelled],
  ["Agent Submissions",agent.length],
  ["Agent Payment Records",approval.length],
  ["Reserved Inventory",cars.filter(x=>x.status==="reserved"&&inRange(dateOf(x,"cars"))).length],
  ["Gross Sales Value",money(revenue)]
 ].map(x=>`
  <div class="detail-metric">
   <span>${esc(x[0])}</span>
   <strong>${esc(x[1])}</strong>
  </div>
 `).join("")
}

function renderAll(){
 renderRequests();
 renderInventory();
 renderRevenue();
 renderOperations();
 renderBars();
 renderStats();
 renderActivity();
 renderDetails()
}

function exportCsv(){
 let list=filteredActivities();

 let lines=[
  ["Date","Source","Customer / Record","Reference","Status","Value"],
  ...list.map(a=>[
   a.date.toISOString(),
   sourceLabel(a.source),
   a.customer,
   a.reference,
   a.status,
   a.value
  ])
 ];

 let csv=lines.map(r=>
  r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")
 ).join("\n");

 let blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
 let url=URL.createObjectURL(blob);
 let a=document.createElement("a");

 a.href=url;
 a.download=`regional-autoselections-summary-${new Date().toISOString().slice(0,10)}.csv`;
 a.click();

 URL.revokeObjectURL(url)
}

$("refreshSummary").onclick=load;
$("exportCsv").onclick=exportCsv;
$("applyDates").onclick=applyDates;
$("clearDates").onclick=()=>setPeriod("all");

document.querySelectorAll(".period-buttons button").forEach(b=>
 b.onclick=()=>setPeriod(b.dataset.period)
);

$("activitySearch").oninput=renderActivity;
$("activitySource").onchange=renderActivity;
$("activityLimit").onchange=renderActivity;

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
 if(e.key==="Escape"&&$("sidebar")?.classList.contains("open")){
  $("sidebar").classList.remove("open");
  $("overlay").classList.remove("show")
 }
});

window.addEventListener("load",()=>{
 setTimeout(()=>$("loader")?.classList.add("hide"),450)
});

load();