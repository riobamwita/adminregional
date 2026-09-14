import{supabase}from"./supabase.js";

const $=id=>document.getElementById(id),grid=$("propertiesGrid");

const CAR_COLUMNS="id,make,model,year,price,mileage,engine_size,transmission,fuel_type,exterior_color,condition,body_type,location,city,status,featured,is_public,source_type,source_request_id,display_image_url,display_image_path,created_at";

/* Ranges start as null = "no bound chosen yet".
   They are filled from the real data in computeBounds(),
   never from hard-coded numbers. */
const blank=()=>({
  priceMin:null,priceMax:null,
  yearMin:null,yearMax:null,
  mileageMin:null,mileageMax:null,
  engineMin:null,engineMax:null,
  condition:[],make:[],body_type:[],fuel_type:[],transmission:[],exterior_color:[],status:[]
});

let cars=[],filters=blank(),bounds={},currentAdmin=null;

/* ---------- auth ---------- */
async function auth(){const{data:{session}}=await supabase.auth.getSession();if(!session){location.replace("auth.html");return false}const{data,error}=await supabase.from("admin_users").select("id,is_main_admin").eq("id",session.user.id).maybeSingle();if(error||!data){await supabase.auth.signOut();location.replace("auth.html");return false}currentAdmin=data;return true}

async function canManageVehicles(){if(currentAdmin?.is_main_admin)return true;let{data}=await supabase.from("admin_permissions").select("permissions").eq("admin_id",currentAdmin.id).maybeSingle();return data?.permissions?.vehicles===true}

/* ---------- data ---------- */
async function fetchAllCars(){
  const size=1000,rows=[];
  for(let from=0;;from+=size){
    const{data,error}=await supabase.from("cars").select(CAR_COLUMNS).order("created_at",{ascending:false}).range(from,from+size-1);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<size)break;
  }
  return rows;
}

async function load(){
  if(!await auth())return;
  $("loading").style.display="block";grid.innerHTML="";$("empty").style.display="none";$("error").classList.remove("active");
  try{
    cars=await fetchAllCars();
    computeBounds();
    stats();
    syncFilters();
    render();
  }catch(e){$("error").textContent=e.message;$("error").classList.add("active")}
  finally{$("loading").style.display="none"}
}

function stats(){$("totalCars").textContent=cars.length;$("availableCars").textContent=cars.filter(x=>x.status==="available").length;$("reservedCars").textContent=cars.filter(x=>x.status==="reserved").length;$("soldCars").textContent=cars.filter(x=>x.status==="sold").length;$("featuredCars").textContent=cars.filter(x=>x.featured).length}

/* ---------- helpers ---------- */
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const N=v=>String(v??"").trim().toLowerCase();
const M=v=>Number(v||0).toLocaleString("en-KE");
const CC=v=>{let n=Number(v||0);return n>0&&n<20?n*1000:n};
const conditionType=c=>{let v=N(c.condition);return v.includes("local")&&v.includes("used")?"local used":(v.includes("foreign")||v.includes("import"))&&v.includes("used")?"foreign used":v};
const slug=v=>N(v).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"available";
function optimizedUrl(url,width=640,quality=68){if(!url||!url.includes("/storage/v1/object/public/"))return url;return url.replace("/object/public/","/render/image/public/")+`?width=${width}&quality=${quality}&resize=contain`}

const SOURCES={
  sell_in:{label:"SELL-IN",icon:"fa-hand-holding-dollar",cls:"sell-in",title:"Came in through Sell Your Car"},
  trade_in:{label:"TRADE-IN",icon:"fa-right-left",cls:"trade-in",title:"Came in through Trade-In"},
  agent:{label:"AGENT",icon:"fa-user-tie",cls:"agent",title:"Added by an agent"}
};
const sourceOf=c=>SOURCES[N(c.source_type).replace(/[\s-]+/g,"_")]||null;
const isVisible=c=>c.is_public!==false;

/* ---------- ranges ---------- */
const RANGES=[
  {key:"price",  lo:"priceMin",  hi:"priceMax",  loText:"priceMinText",  hiText:"priceMaxText",  step:50000, get:c=>c.price==null?null:Number(c.price),        fmt:v=>`KES ${M(v)}`},
  {key:"year",   lo:"yearMin",   hi:"yearMax",   loText:"yearMinText",   hiText:"yearMaxText",   step:1,     get:c=>c.year?Number(c.year):null,               fmt:v=>String(v)},
  {key:"mileage",lo:"mileageMin",hi:"mileageMax",loText:"mileageMinText",hiText:"mileageMaxText",step:1000,  get:c=>c.mileage==null?null:Number(c.mileage),   fmt:v=>`${M(v)} km`},
  {key:"engine", lo:"engineMin", hi:"engineMax", loText:"engineMinText", hiText:"engineMaxText", step:100,   get:c=>c.engine_size==null?null:CC(c.engine_size),fmt:v=>`${M(v)} cc`}
];

function computeBounds(){
  bounds={};
  RANGES.forEach(r=>{
    const list=cars.map(r.get).filter(v=>Number.isFinite(v));
    if(!list.length)return;
    const lo=Math.floor(Math.min(...list)/r.step)*r.step;
    let hi=Math.ceil(Math.max(...list)/r.step)*r.step;
    if(lo===hi)hi=lo+r.step;
    bounds[r.key]={lo,hi};
  });
}

/* A slider only filters once it is moved off its end stop,
   and a car with no value for that field is never dropped. */
function rangeMatch(c){
  return RANGES.every(r=>{
    const b=bounds[r.key];
    if(!b)return true;
    const v=r.get(c);
    if(!Number.isFinite(v))return true;
    const min=filters[r.lo],max=filters[r.hi];
    if(Number.isFinite(min)&&min>b.lo&&v<min)return false;
    if(Number.isFinite(max)&&max<b.hi&&v>max)return false;
    return true;
  });
}

/* ---------- matching ---------- */
function textMatch(c,q){return!q||Object.entries(c).filter(([,v])=>v!==null&&typeof v!=="object").map(([k,v])=>`${k} ${v}`).join(" ").toLowerCase().includes(q)}
function arrayMatch(c){for(let f of["make","body_type","fuel_type","transmission","exterior_color","status"]){let a=filters[f];if(a?.length&&!a.map(N).includes(N(c[f])))return false}return true}
function match(c){let q=N($("searchInput")?.value),cs=filters.condition||[];return(!cs.length||cs.includes(conditionType(c)))&&textMatch(c,q)&&arrayMatch(c)&&rangeMatch(c)}

/* ---------- filter UI ---------- */
function selected(f,v){return(filters[f]||[]).map(N).includes(N(v))}
function values(f){return[...new Map(cars.map(c=>[N(c[f]),c[f]]).filter(([k,v])=>k&&v!=null)).values()].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))}
function toggle(f,v,checked){let a=filters[f]||[];filters[f]=checked?[...a,v]:a.filter(x=>N(x)!==N(v));syncFilters();render()}

function syncCheckList(id,f){let el=$(id);if(!el)return;el.innerHTML=values(f).map(v=>`<label class="check-row"><span><input type="checkbox" value="${esc(v)}" ${selected(f,v)?"checked":""}> ${esc(v)}</span><small>${cars.filter(c=>N(c[f])===N(v)).length}</small></label>`).join("")||`<span class="filter-none">No options</span>`;el.querySelectorAll("input").forEach(x=>x.onchange=()=>toggle(f,x.value,x.checked))}

function syncColor(){let el=$("colorFilter");if(!el)return;let cur=(filters.exterior_color||[])[0]||"";el.innerHTML=`<option value="">Any Colour</option>`+values("exterior_color").map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=cur;el.onchange=()=>{filters.exterior_color=el.value?[el.value]:[];render();updateCount()}}

function syncRanges(){
  RANGES.forEach(r=>{
    const b=bounds[r.key],minEl=$(r.lo),maxEl=$(r.hi),minTxt=$(r.loText),maxTxt=$(r.hiText);
    if(!minEl||!maxEl)return;

    if(!b){
      minEl.disabled=maxEl.disabled=true;
      if(minTxt)minTxt.textContent="Any";
      if(maxTxt)maxTxt.textContent="Any";
      return;
    }

    minEl.disabled=maxEl.disabled=false;

    const clamp=v=>Math.max(b.lo,Math.min(b.hi,v));
    let lo=Number.isFinite(filters[r.lo])?clamp(filters[r.lo]):b.lo;
    let hi=Number.isFinite(filters[r.hi])?clamp(filters[r.hi]):b.hi;
    if(lo>hi){lo=b.lo;hi=b.hi}
    filters[r.lo]=lo;filters[r.hi]=hi;

    minEl.min=maxEl.min=b.lo;
    minEl.max=maxEl.max=b.hi;
    minEl.step=maxEl.step=r.step;
    minEl.value=lo;maxEl.value=hi;

    const paint=()=>{
      if(minTxt)minTxt.textContent=filters[r.lo]===b.lo?"Any":r.fmt(filters[r.lo]);
      if(maxTxt)maxTxt.textContent=filters[r.hi]===b.hi?"Any":r.fmt(filters[r.hi]);
    };
    paint();

    minEl.oninput=()=>{filters[r.lo]=Math.min(Number(minEl.value),Number(maxEl.value));maxEl.value=Math.max(Number(maxEl.value),filters[r.lo]);filters[r.hi]=Number(maxEl.value);paint();render()};
    maxEl.oninput=()=>{filters[r.hi]=Math.max(Number(maxEl.value),Number(minEl.value));minEl.value=Math.min(Number(minEl.value),filters[r.hi]);filters[r.lo]=Number(minEl.value);paint();render()};
  });
}

function syncFilters(){syncCheckList("statusFilters","status");syncCheckList("makeFilters","make");syncCheckList("bodyFilters","body_type");syncCheckList("fuelFilters","fuel_type");syncCheckList("transFilters","transmission");syncColor();syncRanges();$("foreignUsedFilter").checked=(filters.condition||[]).includes("foreign used");$("localUsedFilter").checked=(filters.condition||[]).includes("local used");updateCount()}

function updateCount(){
  let n=["make","body_type","fuel_type","transmission","exterior_color","status","condition"].reduce((a,f)=>a+(filters[f]?.length||0),0);
  n+=RANGES.reduce((a,r)=>{const b=bounds[r.key];if(!b)return a;return a+(filters[r.lo]>b.lo||filters[r.hi]<b.hi?1:0)},0);
  $("filterCount").textContent=n?`(${n})`:"";
}

function clearFilters(){filters=blank();$("searchInput").value="";syncFilters();render()}

/* ---------- render ---------- */
const chip=(icon,val)=>val?`<span><i class="fa-solid ${icon}"></i>${esc(val)}</span>`:"";

function card(c){
  const name=`${c.make||""} ${c.model||""}`.trim()||"Untitled vehicle",
        st=N(c.status||"available"),
        cls=slug(st),
        sold=st==="sold",
        img=c.display_image_url,
        src=sourceOf(c),
        vis=isVisible(c),
        meta=chip("fa-gauge",c.mileage!=null?`${M(c.mileage)} km`:"")+chip("fa-gears",c.transmission)+chip("fa-gas-pump",c.fuel_type);
    return`<article class="car-card ${esc(cls)}${vis?"":" not-public"}" data-id="${esc(c.id)}" role="button" tabindex="0" aria-label="Open ${esc(name)}">
<div class="car-image">${img?`<img src="${esc(optimizedUrl(img,720,74))}" alt="${esc(name)}" loading="lazy" decoding="async" onerror="this.remove()">`:`<div class="no-image"><i class="fa-solid fa-car"></i></div>`}${sold?"":`<span class="status ${esc(cls)}">${esc(st)}</span>`}<div class="card-flags">${src?`<span class="source-tag ${src.cls}" title="${esc(src.title)}"><i class="fa-solid ${src.icon}"></i>${src.label}</span>`:""}${c.featured?`<span class="featured" title="Featured"><i class="fa-solid fa-star"></i></span>`:""}${sold?"":`<button class="vis-toggle ${vis?"on":"off"}" type="button" data-vis="${esc(c.id)}" aria-pressed="${vis}" aria-label="${vis?"Hide from website":"Show on website"}" title="${vis?"Visible on the website — click to hide":"Hidden from the website — click to show"}"><i class="fa-solid ${vis?"fa-eye":"fa-eye-slash"}"></i></button>`}</div>${vis||sold?"":`<span class="hidden-tag"><i class="fa-solid fa-eye-slash"></i>Hidden</span>`}${sold?`<div class="sold-overlay"><span>SOLD</span></div>`:""}</div>
<div class="car-info">
<div class="car-head"><h3 title="${esc(name)}">${esc(name)}</h3><span class="car-year">${c.year||"—"}</span></div>
<p class="car-location"><i class="fa-solid fa-location-dot"></i>${esc(c.location||c.city||"Location not set")}</p>
${meta?`<div class="car-meta">${meta}</div>`:""}
<div class="car-foot"><div class="price"><small>KES</small>${c.price==null?"—":M(c.price)}</div><div class="car-actions"><button class="edit" type="button" onclick="editCar('${c.id}')"><i class="fa-solid fa-pen-to-square"></i><span>Edit</span></button><button class="delete" type="button" onclick="deleteCar('${c.id}')" title="Delete" aria-label="Delete vehicle"><i class="fa-solid fa-trash"></i></button></div></div>
</div></article>`}

function render(){
  const o=$("sortFilter").value,l=cars.filter(match);
  l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):o==="price-high"?(b.price||0)-(a.price||0):o==="price-low"?(a.price||0)-(b.price||0):o==="year-new"?(b.year||0)-(a.year||0):o==="mileage-low"?(a.mileage||0)-(b.mileage||0):new Date(b.created_at)-new Date(a.created_at));
  const rc=$("resultCount");if(rc)rc.textContent=l.length===cars.length?cars.length:`${l.length} / ${cars.length}`;
  $("empty").style.display=l.length?"none":"block";
  grid.innerHTML=l.length?l.map(card).join(""):"";
  updateCount();
}

/* ---------- actions ---------- */
window.editCar=async id=>{if(!await canManageVehicles()){alert("Access Denied: You do not have permission to edit vehicles.");return}location.href=`edit.html?id=${id}`};

window.deleteCar=async id=>{if(!await canManageVehicles()){alert("Access Denied: You do not have permission to delete vehicles.");return}let c=cars.find(x=>x.id===id);if(!c||!confirm(`Delete ${c.make||""} ${c.model||""}?`))return;try{let{data:imgs}=await supabase.from("car_images").select("storage_path").eq("car_id",id),paths=[c.display_image_path,...(imgs||[]).map(x=>x.storage_path)].filter(Boolean);if(paths.length){let r=await supabase.storage.from("car-images").remove(paths);if(r.error)throw r.error}let{error}=await supabase.from("cars").delete().eq("id",id);if(error)throw error;load()}catch(e){$("error").textContent=e.message;$("error").classList.add("active")}};

async function toggleVisibility(id,btn){
  if(!await canManageVehicles()){alert("Access Denied: You do not have permission to change vehicle visibility.");return}
  const c=cars.find(x=>x.id===id);
  if(!c)return;
  const next=!isVisible(c);
  btn.disabled=true;btn.classList.add("busy");
  try{
    const{error}=await supabase.from("cars").update({is_public:next,updated_at:new Date().toISOString()}).eq("id",id);
    if(error)throw error;
    c.is_public=next;
    $("error").classList.remove("active");
    render();
  }catch(e){
    $("error").textContent=`Visibility not saved: ${e.message}`;
    $("error").classList.add("active");
    btn.disabled=false;btn.classList.remove("busy");
  }
}

/* ---------- events ---------- */
let searchTimer;
$("searchInput").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,150)};
$("sortFilter").onchange=render;

grid.onclick=e=>{
  const eye=e.target.closest("[data-vis]");
  if(eye){e.preventDefault();e.stopPropagation();toggleVisibility(eye.dataset.vis,eye);return}
  if(e.target.closest("button, a"))return;
  const el=e.target.closest(".car-card");
  if(el)editCar(el.dataset.id);
};
grid.onkeydown=e=>{
  if(e.key!=="Enter"&&e.key!==" ")return;
  if(e.target.closest("[data-vis], button, a"))return;
  const el=e.target.closest(".car-card");
  if(!el)return;
  e.preventDefault();
  editCar(el.dataset.id);
};

$("filterToggle").onclick=()=>{
  const open=$("adminFilters").classList.toggle("open");
  $("filterToggle").classList.toggle("active",open);
  $("filterToggle").setAttribute("aria-expanded",String(open));
};

$("clearFilters").onclick=clearFilters;

document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if($("adminFilters").classList.contains("open")){$("adminFilters").classList.remove("open");$("filterToggle").classList.remove("active");$("filterToggle").setAttribute("aria-expanded","false")}});

["foreignUsedFilter","localUsedFilter"].forEach(id=>$(id).onchange=()=>{
  filters.condition=["foreignUsedFilter","localUsedFilter"].filter(x=>$(x).checked).map(x=>x==="foreignUsedFilter"?"foreign used":"local used");
  syncFilters();render();
});

$("refreshListings").onclick=load;

document.querySelectorAll(".add-vehicle").forEach(b=>b.onclick=async e=>{if(!await canManageVehicles()){e.preventDefault();alert("Access Denied: You do not have permission to add vehicles.")}});

/* loader: fires even if the window "load" event already happened */
const hideLoader=()=>setTimeout(()=>$("loader")?.classList.add("hide"),350);
document.readyState==="complete"?hideLoader():window.addEventListener("load",hideLoader);

load();