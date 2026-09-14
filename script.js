import{supabase}from"./supabase.js";

const $=id=>document.getElementById(id),grid=$("propertiesGrid"),YEAR=new Date().getFullYear();
const blank=()=>({priceMin:0,priceMax:15000000,yearMin:1990,yearMax:YEAR,mileageMin:0,mileageMax:500000,engineMin:500,engineMax:8000,condition:[],make:[],body_type:[],fuel_type:[],transmission:[],exterior_color:[],status:[]});
let cars=[],filters=blank(),currentAdmin=null;

/* ---------- auth ---------- */
async function auth(){const{data:{session}}=await supabase.auth.getSession();if(!session){location.replace("auth.html");return false}const{data,error}=await supabase.from("admin_users").select("id,is_main_admin").eq("id",session.user.id).maybeSingle();if(error||!data){await supabase.auth.signOut();location.replace("auth.html");return false}currentAdmin=data;return true}

async function canManageVehicles(){if(currentAdmin?.is_main_admin)return true;let{data}=await supabase.from("admin_permissions").select("permissions").eq("admin_id",currentAdmin.id).maybeSingle();return data?.permissions?.vehicles===true}

/* ---------- data ---------- */
async function load(){if(!await auth())return;$("loading").style.display="block";grid.innerHTML="";$("empty").style.display="none";$("error").classList.remove("active");try{let{data,error}=await supabase.from("cars").select("id,make,model,year,price,mileage,engine_size,transmission,fuel_type,exterior_color,condition,body_type,location,city,status,featured,display_image_url,display_image_path,created_at").order("created_at",{ascending:false});if(error)throw error;cars=data||[];stats();syncFilters();render()}catch(e){$("error").textContent=e.message;$("error").classList.add("active")}finally{$("loading").style.display="none"}}

function stats(){$("totalCars").textContent=cars.length;$("availableCars").textContent=cars.filter(x=>x.status==="available").length;$("reservedCars").textContent=cars.filter(x=>x.status==="reserved").length;$("soldCars").textContent=cars.filter(x=>x.status==="sold").length;$("featuredCars").textContent=cars.filter(x=>x.featured).length}

/* ---------- helpers ---------- */
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const N=v=>String(v??"").trim().toLowerCase();
const M=v=>Number(v||0).toLocaleString("en-KE");
const CC=v=>{let n=Number(v||0);return n>0&&n<20?n*1000:n};
const conditionType=c=>{let v=N(c.condition);return v.includes("local")&&v.includes("used")?"local used":(v.includes("foreign")||v.includes("import"))&&v.includes("used")?"foreign used":v};
const slug=v=>N(v).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"available";
function optimizedUrl(url,width=640,quality=68){if(!url||!url.includes("/storage/v1/object/public/"))return url;return url.replace("/object/public/","/render/image/public/")+`?width=${width}&quality=${quality}&resize=contain`}

/* ---------- matching ---------- */
function textMatch(c,q){return!q||Object.entries(c).filter(([,v])=>v!==null&&typeof v!=="object").map(([k,v])=>`${k} ${v}`).join(" ").toLowerCase().includes(q)}
function arrayMatch(c){for(let f of["make","body_type","fuel_type","transmission","exterior_color","status"]){let a=filters[f];if(a?.length&&!a.map(N).includes(N(c[f])))return false}return true}
function rangeMatch(c){let p=Number(c.price||0),y=Number(c.year||0),m=Number(c.mileage||0),e=CC(c.engine_size);return!(p<filters.priceMin||p>filters.priceMax||y&&(y<filters.yearMin||y>filters.yearMax)||c.mileage!=null&&(m<filters.mileageMin||m>filters.mileageMax)||c.engine_size!=null&&(e<filters.engineMin||e>filters.engineMax))}
function match(c){let q=N($("searchInput")?.value),cs=filters.condition||[];return(!cs.length||cs.includes(conditionType(c)))&&textMatch(c,q)&&arrayMatch(c)&&rangeMatch(c)}

/* ---------- filter UI ---------- */
function selected(f,v){return(filters[f]||[]).map(N).includes(N(v))}
function values(f){return[...new Map(cars.map(c=>[N(c[f]),c[f]]).filter(([k,v])=>k&&v!=null)).values()].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))}
function toggle(f,v,checked){let a=filters[f]||[];filters[f]=checked?[...a,v]:a.filter(x=>N(x)!==N(v));syncFilters();render()}

function syncCheckList(id,f){let el=$(id);if(!el)return;el.innerHTML=values(f).map(v=>`<label class="check-row"><span><input type="checkbox" value="${esc(v)}" ${selected(f,v)?"checked":""}> ${esc(v)}</span><small>${cars.filter(c=>N(c[f])===N(v)).length}</small></label>`).join("")||`<span class="filter-none">No options</span>`;el.querySelectorAll("input").forEach(x=>x.onchange=()=>toggle(f,x.value,x.checked))}

function syncColor(){let el=$("colorFilter");if(!el)return;let cur=(filters.exterior_color||[])[0]||"";el.innerHTML=`<option value="">Any Colour</option>`+values("exterior_color").map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=cur;el.onchange=()=>{filters.exterior_color=el.value?[el.value]:[];render();updateCount()}}

function syncRanges(){[["priceMin","priceMax","priceMinText","priceMaxText",c=>Number(c.price||0),50000,v=>`KES ${M(v)}`],["yearMin","yearMax","yearMinText","yearMaxText",c=>Number(c.year||0),1,v=>v],["mileageMin","mileageMax","mileageMinText","mileageMaxText",c=>Number(c.mileage||0),1000,v=>`${M(v)} km`],["engineMin","engineMax","engineMinText","engineMaxText",c=>CC(c.engine_size),100,v=>`${M(v)} cc`]].forEach(([a,b,at,bt,get,step,fmt])=>{let min=$(a),max=$(b),x=$(at),y=$(bt),list=cars.map(get).filter(v=>Number.isFinite(v)&&v>0);if(!min||!max||!list.length)return;let lo=Math.floor(Math.min(...list)/step)*step,hi=Math.ceil(Math.max(...list)/step)*step;if(lo===hi)hi+=step;filters[a]=Math.max(lo,Math.min(hi,Number(filters[a]??lo)));filters[b]=Math.max(lo,Math.min(hi,Number(filters[b]??hi)));if(filters[a]>filters[b])filters[a]=lo;min.min=max.min=lo;min.max=max.max=hi;min.step=max.step=step;min.value=filters[a];max.value=filters[b];x.textContent=filters[a]===lo?"Any":fmt(filters[a]);y.textContent=filters[b]===hi?"Any":fmt(filters[b]);min.oninput=()=>{filters[a]=Math.min(Number(min.value),Number(max.value));max.value=Math.max(Number(max.value),filters[a]);x.textContent=filters[a]===lo?"Any":fmt(filters[a]);render()};max.oninput=()=>{filters[b]=Math.max(Number(max.value),Number(min.value));min.value=Math.min(Number(min.value),filters[b]);y.textContent=filters[b]===hi?"Any":fmt(filters[b]);render()}})}

function syncFilters(){syncCheckList("statusFilters","status");syncCheckList("makeFilters","make");syncCheckList("bodyFilters","body_type");syncCheckList("fuelFilters","fuel_type");syncCheckList("transFilters","transmission");syncColor();syncRanges();$("foreignUsedFilter").checked=(filters.condition||[]).includes("foreign used");$("localUsedFilter").checked=(filters.condition||[]).includes("local used");updateCount()}

function updateCount(){let n=["make","body_type","fuel_type","transmission","exterior_color","status","condition"].reduce((a,f)=>a+(filters[f]?.length||0),0);$("filterCount").textContent=n?`(${n})`:""}

function clearFilters(){filters=blank();$("searchInput").value="";syncFilters();render()}

/* ---------- render ---------- */
const chip=(icon,val)=>val?`<span><i class="fa-solid ${icon}"></i>${esc(val)}</span>`:"";

function card(c){
  const name=`${c.make||""} ${c.model||""}`.trim()||"Untitled vehicle",
        st=N(c.status||"available"),
        cls=slug(st),
        sold=st==="sold",
        img=c.display_image_url,
        meta=chip("fa-gauge",c.mileage!=null?`${M(c.mileage)} km`:"")+chip("fa-gears",c.transmission)+chip("fa-gas-pump",c.fuel_type);
  return`<article class="car-card ${esc(cls)}">
<div class="car-image">${img?`<img src="${esc(optimizedUrl(img,720,74))}" alt="${esc(name)}" loading="lazy" decoding="async" onerror="this.remove()">`:`<div class="no-image"><i class="fa-solid fa-car"></i></div>`}${sold?"":`<span class="status ${esc(cls)}">${esc(st)}</span>`}${c.featured?`<span class="featured" title="Featured"><i class="fa-solid fa-star"></i></span>`:""}${sold?`<div class="sold-overlay"><span>SOLD</span></div>`:""}</div>
<div class="car-info">
<div class="car-head"><h3 title="${esc(name)}">${esc(name)}</h3><span class="car-year">${c.year||"—"}</span></div>
<p class="car-location"><i class="fa-solid fa-location-dot"></i>${esc(c.location||c.city||"Location not set")}</p>
${meta?`<div class="car-meta">${meta}</div>`:""}
<div class="car-foot"><div class="price"><small>KES</small>${M(c.price)}</div><div class="car-actions"><button class="edit" type="button" onclick="editCar('${c.id}')"><i class="fa-solid fa-pen-to-square"></i><span>Edit</span></button><button class="delete" type="button" onclick="deleteCar('${c.id}')" title="Delete" aria-label="Delete vehicle"><i class="fa-solid fa-trash"></i></button></div></div>
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

/* ---------- events ---------- */
let searchTimer;
$("searchInput").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,150)};
$("sortFilter").onchange=render;

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