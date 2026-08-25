import{supabase}from"./supabase.js";

const pages={
 index:"vehicles",tradeins:"tradeins",imports:"imports",financing:"financing",
 diaspora:"diaspora",sellcars:"sellcars",accessiblecars:"accessiblecars",
 reservations:"reservations",testdrives:"testdrives",insurance:"insurance",admins:"admins"
};

export async function requireAdmin(page){
 const{data:{session}}=await supabase.auth.getSession();
 if(!session)return location.replace("auth.html");

 const{data:admin,error}=await supabase.from("admin_users").select("id,email,is_main_admin").eq("id",session.user.id).maybeSingle();
 if(error||!admin)return location.replace("auth.html");

 if(admin.is_main_admin)return admin;

 const key=pages[page]||page;
 const{data:row,error:pe}=await supabase.from("admin_permissions").select("permissions").eq("admin_id",admin.id).maybeSingle();

 if(pe||!row?.permissions?.[key])return location.replace("index.html?access=denied");

 return admin;
}

export async function logout(){
 await supabase.auth.signOut();
 location.replace("auth.html");
}

export async function applyPageAccess(){
 const{data:{session}}=await supabase.auth.getSession();
 if(!session)return location.replace("auth.html");

 const{data:admin}=await supabase.from("admin_users").select("id,is_main_admin").eq("id",session.user.id).maybeSingle();
 if(!admin)return location.replace("auth.html");
 if(admin.is_main_admin)return admin;

 const{data:row}=await supabase.from("admin_permissions").select("permissions").eq("admin_id",admin.id).maybeSingle();
 const p=row?.permissions||{};

 document.querySelectorAll("[data-permission]").forEach(el=>{
   if(!p[el.dataset.permission])el.remove();
 });

 return admin;
}