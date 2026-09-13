import{supabase}from"./supabase.js";const $=id=>document.getElementById(id),grid=$("propertiesGrid");let cars=[],filters={priceMin:0,priceMax:15000000,yearMin:1990,yearMax:new Date().getFullYear(),mileageMin:0,mileageMax:500000,engineMin:500,engineMax:8000,condition:[],make:[],body_type:[],fuel_type:[],transmission:[],exterior_color:[],status:[]};
let currentAdmin=null;async function auth(){const{data:{session}}=await supabase.auth.getSession();if(!session){location.replace("auth.html");return false}const{data,error}=await supabase.from("admin_users").select("id,is_main_admin").eq("id",session.user.id).maybeSingle();if(error||!data){await supabase.auth.signOut();location.replace("auth.html");return false}currentAdmin=data;return true}
async function canManageVehicles(){if(currentAdmin?.is_main_admin)return true;let{data}=await supabase.from("admin_permissions").select("permissions").eq("admin_id",currentAdmin.id).maybeSingle();return data?.permissions?.vehicles===true}
async function load(){if(!await auth())return;$("loading").style.display="block";grid.innerHTML="";$("empty").style.display="none";$("error").classList.remove("active");try{let{data,error}=await supabase.from("cars").select("id,make,model,year,price,mileage,engine_size,transmission,fuel_type,exterior_color,condition,body_type,location,city,status,featured,display_image_url,display_image_path,created_at").order("created_at",{ascending:false});if(error)throw error;cars=data||[];
stats();
syncFilters();
render();}catch(e){$("error").textContent=e.message;$("error").classList.add("active")}finally{$("loading").style.display="none"}}
function stats(){$("totalCars").textContent=cars.length;$("availableCars").textContent=cars.filter(x=>x.status==="available").length;$("reservedCars").textContent=cars.filter(x=>x.status==="reserved").length;$("soldCars").textContent=cars.filter(x=>x.status==="sold").length;$("featuredCars").textContent=cars.filter(x=>x.featured).length}
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
function optimizedUrl(url,width=400,quality=70){if(!url||!url.includes('/storage/v1/object/public/'))return url;return url.replace('/object/public/','/render/image/public/')+`?width=${width}&quality=${quality}`}
const N=v=>String(v??"").trim().toLowerCase(),M=v=>Number(v||0).toLocaleString("en-KE"),CC=v=>{let n=Number(v||0);return n>0&&n<20?n*1000:n},conditionType=c=>{let v=N(c.condition);return v.includes("local")&&v.includes("used")?"local used":(v.includes("foreign")||v.includes("import"))&&v.includes("used")?"foreign used":v};

function textMatch(c,q){return!q||Object.entries(c).filter(([,v])=>v!==null&&typeof v!=="object").map(([k,v])=>`${k} ${v}`).join(" ").toLowerCase().includes(q)}

function arrayMatch(c){for(let f of["make","body_type","fuel_type","transmission","exterior_color","status"]){let a=filters[f];if(a?.length&&!a.map(N).includes(N(c[f])))return false}return true}

function rangeMatch(c){let p=Number(c.price||0),y=Number(c.year||0),m=Number(c.mileage||0),e=CC(c.engine_size);return!(p<filters.priceMin||p>filters.priceMax||y&&(y<filters.yearMin||y>filters.yearMax)||c.mileage!=null&&(m<filters.mileageMin||m>filters.mileageMax)||c.engine_size!=null&&(e<filters.engineMin||e>filters.engineMax))}

function match(c){let q=N($("searchInput")?.value),cs=filters.condition||[];return(!cs.length||cs.includes(conditionType(c)))&&textMatch(c,q)&&arrayMatch(c)&&rangeMatch(c)}

function selected(f,v){return(filters[f]||[]).map(N).includes(N(v))}

function values(f){return[...new Map(cars.map(c=>[N(c[f]),c[f]]).filter(([k,v])=>k&&v!=null)).values()].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))}

function toggle(f,v,checked){let a=filters[f]||[];filters[f]=checked?[...a,v]:a.filter(x=>N(x)!==N(v));syncFilters();render()}

function syncCheckList(id,f){let el=$(id);if(!el)return;el.innerHTML=values(f).map(v=>`<label class="check-row"><span><input type="checkbox" value="${esc(v)}" ${selected(f,v)?"checked":""}> ${esc(v)}</span><small>${cars.filter(c=>N(c[f])===N(v)).length}</small></label>`).join("")||`<span class="filter-none">No options</span>`;el.querySelectorAll("input").forEach(x=>x.onchange=()=>toggle(f,x.value,x.checked))}

function syncColor(){let el=$("colorFilter");if(!el)return;let cur=(filters.exterior_color||[])[0]||"";el.innerHTML=`<option value="">Any Colour</option>`+values("exterior_color").map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");el.value=cur;el.onchange=()=>{filters.exterior_color=el.value?[el.value]:[];render();updateCount()}}

function syncRanges(){[["priceMin","priceMax","priceMinText","priceMaxText","price",c=>Number(c.price||0),50000,v=>`KES ${M(v)}`],["yearMin","yearMax","yearMinText","yearMaxText","year",c=>Number(c.year||0),1,v=>v],["mileageMin","mileageMax","mileageMinText","mileageMaxText","mileage",c=>Number(c.mileage||0),1000,v=>`${M(v)} km`],["engineMin","engineMax","engineMinText","engineMaxText","engine",c=>CC(c.engine_size),100,v=>`${M(v)} cc`]].forEach(([a,b,at,bt,key,get,step,fmt])=>{let min=$(a),max=$(b),x=$(at),y=$(bt),list=cars.map(get).filter(v=>Number.isFinite(v)&&v>0);if(!min||!max||!list.length)return;let lo=Math.floor(Math.min(...list)/step)*step,hi=Math.ceil(Math.max(...list)/step)*step;if(lo===hi)hi+=step;filters[a]=Math.max(lo,Math.min(hi,Number(filters[a]??lo)));filters[b]=Math.max(lo,Math.min(hi,Number(filters[b]??hi)));if(filters[a]>filters[b])filters[a]=lo;min.min=max.min=lo;min.max=max.max=hi;min.value=filters[a];max.value=filters[b];x.textContent=filters[a]===lo?"Any":fmt(filters[a]);y.textContent=filters[b]===hi?"Any":fmt(filters[b]);min.oninput=()=>{filters[a]=Math.min(Number(min.value),Number(max.value));max.value=Math.max(Number(max.value),filters[a]);render();updateCount()};max.oninput=()=>{filters[b]=Math.max(Number(max.value),Number(min.value));min.value=Math.min(Number(min.value),filters[b]);render();updateCount()}})}

function syncFilters(){syncCheckList("statusFilters","status");syncCheckList("makeFilters","make");syncCheckList("bodyFilters","body_type");syncCheckList("fuelFilters","fuel_type");syncCheckList("transFilters","transmission");syncColor();syncRanges();$("foreignUsedFilter").checked=(filters.condition||[]).includes("foreign used");$("localUsedFilter").checked=(filters.condition||[]).includes("local used");updateCount()}

function updateCount(){let n=["make","body_type","fuel_type","transmission","exterior_color","status","condition"].reduce((a,f)=>a+(filters[f]?.length||0),0);$("filterCount").textContent=n?`(${n})`:""}

function clearFilters(){let Y=new Date().getFullYear();filters={priceMin:0,priceMax:15000000,yearMin:1990,yearMax:Y,mileageMin:0,mileageMax:500000,engineMin:500,engineMax:8000,condition:[],make:[],body_type:[],fuel_type:[],transmission:[],exterior_color:[],status:[]};$("searchInput").value="";syncFilters();render()}function render(){let o=$("sortFilter").value,l=cars.filter(match);l.sort((a,b)=>o==="oldest"?new Date(a.created_at)-new Date(b.created_at):o==="price-high"?(b.price||0)-(a.price||0):o==="price-low"?(a.price||0)-(b.price||0):o==="year-new"?(b.year||0)-(a.year||0):o==="mileage-low"?(a.mileage||0)-(b.mileage||0):new Date(b.created_at)-new Date(a.created_at));grid.innerHTML="";$("empty").style.display=l.length?"none":"block";if(!l.length)return;grid.innerHTML=l.map(c=>{let n=`${c.make||""} ${c.model||""}`.trim(),im=c.display_image_url,st=c.status||"available";return`<article class="car-card ${esc(st)}"><div class="car-image">${im?`<img src="${esc(optimizedUrl(im))}" alt="${esc(n)}" loading="lazy" decoding="async" width="400" height="250" onerror="this.remove()">`:`<div class="no-image"><i class="fa-solid fa-car"></i></div>`}<span class="status ${esc(st)}">${esc(st)}</span>${c.featured?`<span class="featured" title="Featured"><i class="fa-solid fa-star"></i></span>`:""}</div><div class="car-info"><div class="car-head"><h3>${esc(n)}</h3><span class="car-year">${c.year||"—"}</span></div><p class="car-location"><i class="fa-solid fa-location-dot"></i> ${esc(c.location||c.city||"Location not set")}</p><div class="car-foot"><div class="price"><small>KES</small>${Number(c.price||0).toLocaleString("en-KE")}</div><div class="car-actions"><button class="edit" onclick="editCar('${c.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button><button class="delete" onclick="deleteCar('${c.id}')" title="Delete" aria-label="Delete vehicle"><i class="fa-solid fa-trash"></i></button></div></div></div></article>`}).join("")}
window.editCar=async id=>{if(!await canManageVehicles()){alert("Access Denied: You do not have permission to edit vehicles.");return}location.href=`edit.html?id=${id}`};window.deleteCar=async id=>{if(!await canManageVehicles()){alert("Access Denied: You do not have permission to delete vehicles.");return}let c=cars.find(x=>x.id===id);if(!c||!confirm(`Delete ${c.make||""} ${c.model||""}?`))return;try{let{data:imgs}=await supabase.from("car_images").select("storage_path").eq("car_id",id),paths=[c.display_image_path,...(imgs||[]).map(x=>x.storage_path)].filter(Boolean);if(paths.length){let r=await supabase.storage.from("car-images").remove(paths);if(r.error)throw r.error}let{error}=await supabase.from("cars").delete().eq("id",id);if(error)throw error;load()}catch(e){$("error").textContent=e.message;$("error").classList.add("active")}};
let searchTimer;$("searchInput").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,150)};
$("sortFilter").onchange=render;

$("filterToggle").onclick=()=>{
$("adminFilters").classList.toggle("open");
$("filterToggle").classList.toggle("active",$("adminFilters").classList.contains("open"));
};

$("clearFilters").onclick=clearFilters;

["foreignUsedFilter","localUsedFilter"].forEach(id=>$(id).onchange=()=>{
filters.condition=[...["foreignUsedFilter","localUsedFilter"].filter(x=>$(x).checked).map(x=>x==="foreignUsedFilter"?"foreign used":"local used")];
syncFilters();
render();
});$("refreshListings").onclick=load;window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));document.querySelectorAll(".add-vehicle").forEach(b=>b.onclick=async e=>{if(!await canManageVehicles()){e.preventDefault();alert("Access Denied: You do not have permission to add vehicles.")}});load();