import{supabase}from"./supabase.js";
import{requireAdmin}from"./admin-guard.js";

const $=id=>document.getElementById(id);
const grid=$("grid"),modal=$("modal");
const esc=v=>String(v??"—").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const date=v=>v?new Date(v).toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}):"—";
const returnDate=v=>v?new Date(v+"T00:00:00").toLocaleDateString("en-KE",{dateStyle:"medium"}):"Not specified";

let data=[],current=null;

async function load(){
  $("loading").style.display="block";
  grid.innerHTML="";
  $("empty").style.display="none";
  $("error").classList.remove("active");
  $("error").textContent="";
  try{
    const{data:d,error}=await supabase.from("returning_resident_requests").select("*").order("created_at",{ascending:false});
    if(error)throw error;
    data=d||[];
    stats();
    render();
  }catch(e){
    $("error").textContent=e.message;
    $("error").classList.add("active");
  }finally{
    $("loading").style.display="none";
  }
}

function stats(){
  $("total").textContent=data.length;
  $("new").textContent=data.filter(x=>x.status==="new").length;
  $("contacted").textContent=data.filter(x=>x.status==="contacted").length;
  $("completed").textContent=data.filter(x=>x.status==="completed").length;
  $("vehicleCount").textContent=data.filter(x=>x.vehicle_interest).length;
}

function render(){
  const q=$("search").value.toLowerCase().trim();
  const s=$("filter").value;
  const o=$("sort").value;

  let list=data.filter(x=>
    `${x.full_name||""} ${x.phone||""} ${x.email||""} ${x.country||""} ${x.kra_pin||""} ${x.vehicle_interest||""}`.toLowerCase().includes(q)&&
    (s==="all"||x.status===s)
  );

  list.sort((a,b)=>
    o==="old"
      ?new Date(a.created_at)-new Date(b.created_at)
      :o==="return"
        ?new Date(a.expected_return_date||"9999-12-31")-new Date(b.expected_return_date||"9999-12-31")
        :new Date(b.created_at)-new Date(a.created_at)
  );

  if(!list.length){
    $("empty").style.display="block";
    return;
  }

  grid.innerHTML=list.map(x=>`
    <article class="diaspora-card" data-id="${esc(x.id)}">
      <div class="diaspora-card-top">
        <span class="diaspora-status ${esc(x.status||"new")}">${esc(x.status||"new")}</span>
        <small>${date(x.created_at)}</small>
      </div>
      <h3>${esc(x.full_name)}</h3>
      <p><i class="fa-solid fa-earth-africa"></i>${esc(x.country||"Country not provided")}</p>
      <p><i class="fa-solid fa-phone"></i>${esc(x.phone||"No phone")}</p>
      <p><i class="fa-solid fa-calendar"></i>Return: ${returnDate(x.expected_return_date)}</p>
      <div class="diaspora-card-meta">
      </div>
      <div class="diaspora-card-bottom">
        <span>${x.passport_url?'<i class="fa-solid fa-file-shield"></i> Passport uploaded':'No passport'}</span>
        <button type="button">View Request <i class="fa-solid fa-arrow-right"></i></button>
      </div>
    </article>
  `).join("");
}

function field(label,value){
  return `<div class="detail-field"><span>${label}</span><strong>${esc(value||"—")}</strong></div>`;
}

async function viewRequest(id){
  current=data.find(x=>String(x.id)===String(id));
  if(!current)return;

  $("modalTitle").textContent=current.full_name||"Registration";
  $("modalDate").textContent=`Submitted ${date(current.created_at)}`;
  $("status").value=current.status||"new";

  $("customerDetails").innerHTML=
    field("Full Name",current.full_name)+
    field("Phone",current.phone)+
    field("Email",current.email)+
    field("Country",current.country)+
    field("KRA PIN",current.kra_pin)+
    field("Contact Method",current.contact_method);

  $("vehicleName").textContent=current.vehicle_interest||"Vehicle interest not specified";
  $("vehicleMeta").textContent=current.country?`Returning from ${current.country}`:"Returning resident vehicle request";

  $("vehicleDetails").innerHTML=
    field("Vehicle Interest",current.vehicle_interest)+
    field("Expected Return",returnDate(current.expected_return_date))+
    field("Duration Abroad",current.duration_abroad)+
    field("Country",current.country)+
    field("Contact Method",current.contact_method)+
    field("Status",current.status);

  $("customerNotes").innerHTML=`<span>Additional Notes</span><p>${esc(current.notes||"No additional notes provided.")}</p>`;

  let actions=[];

  if(current.phone){
    const raw=String(current.phone).replace(/\D/g,"");
    const wa=raw.startsWith("254")?raw:raw.startsWith("0")?`254${raw.slice(1)}`:`254${raw}`;
    const tel=raw.startsWith("254")?`+${raw}`:raw.startsWith("0")?`+254${raw.slice(1)}`:`+254${raw}`;
    actions.push(`<a class="call-btn" href="tel:${esc(tel)}"><i class="fa-solid fa-phone"></i> Call Customer</a>`);
    actions.push(`<a class="whatsapp-btn" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>`);
    actions.push(`<button class="copy-btn" type="button" id="copyPhone"><i class="fa-solid fa-copy"></i> Copy Phone</button>`);
  }

  if(current.email){
    actions.push(`<a class="email-btn" href="mailto:${esc(current.email)}"><i class="fa-solid fa-envelope"></i> Email Customer</a>`);
  }

  $("contactActions").innerHTML=actions.join("");

  $("copyPhone")?.addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(current.phone);
      const b=$("copyPhone");
      b.innerHTML='<i class="fa-solid fa-check"></i> Copied';
      setTimeout(()=>b.innerHTML='<i class="fa-solid fa-copy"></i> Copy Phone',1200);
    }catch{}
  });

  if(current.passport_url){
    const{data:signed,error}=await supabase.storage.from("returning-resident-passports").createSignedUrl(current.passport_url,3600);
    if(!error&&signed?.signedUrl){
      $("passportDetails").innerHTML=`
        <div class="passport-box">
          <div><i class="fa-solid fa-passport"></i><span>${esc(current.passport_file_name||"Passport document")}</span></div>
          <a href="${esc(signed.signedUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open Passport</a>
        </div>`;
    }else{
      $("passportDetails").innerHTML=`<div class="passport-box unavailable"><i class="fa-solid fa-lock"></i> Passport document unavailable</div>`;
    }
  }else{
    $("passportDetails").innerHTML=`<div class="passport-box unavailable"><i class="fa-solid fa-file-circle-xmark"></i> No passport uploaded</div>`;
  }

  modal.classList.add("show");
  document.body.classList.add("locked");
}

async function save(){
  if(!current)return;
  const status=$("status").value;
  const{error}=await supabase.from("returning_resident_requests").update({
    status,
    updated_at:new Date().toISOString()
  }).eq("id",current.id);

  if(error)return alert(error.message);

  const x=data.find(x=>String(x.id)===String(current.id));
  if(x)x.status=status;
  current.status=status;
  close();
  stats();
  render();
}

async function remove(){
  if(!current||!confirm(`Delete registration from ${current.full_name}?`))return;
  const{error}=await supabase.from("returning_resident_requests").delete().eq("id",current.id);
  if(error)return alert(error.message);
  close();
  load();
}

function close(){
  modal.classList.remove("show");
  document.body.classList.remove("locked");
  current=null;
}

grid.addEventListener("click",e=>{
  const card=e.target.closest(".diaspora-card");
  if(card)viewRequest(card.dataset.id);
});

$("search").oninput=render;
$("filter").onchange=render;
$("sort").onchange=render;
$("refreshBtn").onclick=load;
$("save").onclick=save;
$("delete").onclick=remove;
$("close").onclick=close;
$("closeBg").onclick=close;

$("menu").onclick=()=>{
  $("sidebar").classList.add("open");
  $("overlay").classList.add("show");
};

$("closeMenu").onclick=$("overlay").onclick=()=>{
  $("sidebar").classList.remove("open");
  $("overlay").classList.remove("show");
};

$("logoutBtn").onclick=async()=>{
  await supabase.auth.signOut();
  location.replace("auth.html");
};

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&modal.classList.contains("show"))close();
});

window.addEventListener("load",()=>setTimeout(()=>$("loader")?.classList.add("hide"),450));

requireAdmin("diaspora").then(ok=>ok&&load());