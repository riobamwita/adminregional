import { supabase } from "./supabase.js";

const cache={catalog:null,cars:null,promise:null};
const $=id=>document.getElementById(id);
const ADD_NEW="__add_new__";

const norm=v=>String(v??"").trim().toLowerCase().replace(/\s+/g," ");

const uniqueSorted=values=>{
    const seen=new Map();
    (values||[]).forEach(v=>{
        if(v===null||v===undefined)return;
        const s=String(v).trim();
        if(!s)return;
        if(!seen.has(norm(s)))seen.set(norm(s),s);
    });
    return [...seen.values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
};

async function fetchAll(table,select="*"){
    const size=1000;
    const rows=[];
    for(let from=0;;from+=size){
        const {data,error}=await supabase.from(table).select(select).range(from,from+size-1);
        if(error)throw error;
        rows.push(...(data||[]));
        if(!data||data.length<size)break;
    }
    return rows;
}

function normalizeCatalog(rows){
    return (rows||[]).map(r=>({
        ...r,
        make:r.make?String(r.make).trim():"",
        model:r.model?String(r.model).trim():"",
        make_key:norm(r.make),
        model_key:norm(r.model),
        years:Array.isArray(r.years)?r.years.map(Number).filter(Number.isFinite):[],
        body_types:Array.isArray(r.body_types)?r.body_types.map(String):[],
        fuel_types:Array.isArray(r.fuel_types)?r.fuel_types.map(String):[],
        transmissions:Array.isArray(r.transmissions)?r.transmissions.map(String):[],
        drive_types:Array.isArray(r.drive_types)?r.drive_types.map(String):[]
    }));
}

async function getData(force=false){
    if(!force&&cache.catalog&&cache.cars)return {catalog:cache.catalog,cars:cache.cars};
    if(!force&&cache.promise)return cache.promise;

    cache.promise=(async()=>{
        const [catalog,cars]=await Promise.all([
            fetchAll("vehicle_catalog","*"),
            fetchAll("cars","make,model,year,body_type,fuel_type,transmission,drive_type,condition,exterior_color,interior_color,seats,doors,country_of_origin,auction_grade,previous_owners,number_of_keys,inspection_status,location,city,county,status")
        ]);
        cache.catalog=normalizeCatalog(catalog.filter(r=>r.active!==false));
        cache.cars=cars||[];
        cache.promise=null;
        return {catalog:cache.catalog,cars:cache.cars};
    })();

    return cache.promise;
}

export async function getCatalog({force=false}={}){
    const {catalog}=await getData(force);
    return catalog;
}

function ensureOption(select,value,label=value){
    if(!select||value===null||value===undefined||value==="")return;
    const match=[...select.options].find(o=>norm(o.value)===norm(value));
    if(match)return;
    const option=document.createElement("option");
    option.value=String(value);
    option.textContent=label||String(value);
    option.dataset.extra="true";
    const placeholder=select.options[0];
    if(placeholder&&placeholder.value==="")placeholder.insertAdjacentElement("afterend",option);
    else select.insertBefore(option,select.firstChild);
}

function setOptions(select,values,placeholder="Select",allowNew=true){
    if(!select)return;
    const previous=select.value;
    select.innerHTML="";

    const ph=document.createElement("option");
    ph.value="";
    ph.textContent=placeholder;
    select.appendChild(ph);

    uniqueSorted(values).forEach(value=>{
        const option=document.createElement("option");
        option.value=value;
        option.textContent=value;
        select.appendChild(option);
    });

    if(allowNew){
        const add=document.createElement("option");
        add.value=ADD_NEW;
        add.textContent="+ Add new...";
        add.dataset.addNew="true";
        select.appendChild(add);
    }

    select.disabled=false;

    if(previous&&previous!==ADD_NEW){
        ensureOption(select,previous);
        const match=[...select.options].find(o=>norm(o.value)===norm(previous));
        if(match)select.value=match.value;
    }
}

function attachFreeText(select,label){
    if(!select||select.dataset.freeText==="1")return;
    select.dataset.freeText="1";
    select.dataset.lastValue=select.value||"";

    select.addEventListener("change",()=>{
        if(select.value!==ADD_NEW){
            select.dataset.lastValue=select.value;
            return;
        }

        const value=(window.prompt(`Enter ${label}:`)||"").trim();

        if(!value){
            select.value=select.dataset.lastValue||"";
            return;
        }

        ensureOption(select,value);
        const match=[...select.options].find(o=>norm(o.value)===norm(value));
        select.value=match?match.value:value;
        select.dataset.lastValue=select.value;
        select.dispatchEvent(new Event("change",{bubbles:true}));
    });
}

function modelRows(make,rows){
    const key=norm(make);
    return rows.filter(r=>r.make_key===key);
}

function findModel(catalog,make,model){
    return catalog.find(r=>r.make_key===norm(make)&&r.model_key===norm(model))||null;
}

const CAR_SELECT_FIELDS={
    condition:"condition",
    exterior_color:"exterior_color",
    interior_color:"interior_color",
    seats:"seats",
    doors:"doors",
    country_of_origin:"country_of_origin",
    auction_grade:"auction_grade",
    previous_owners:"previous_owners",
    number_of_keys:"number_of_keys",
    inspection_status:"inspection_status",
    location:"location",
    city:"city",
    county:"county",
    status:"status"
};

function valuesFromCars(cars,key,make=null,model=null){
    let rows=cars||[];

    if(make!==null)rows=rows.filter(r=>norm(r.make)===norm(make));
    if(model!==null)rows=rows.filter(r=>norm(r.model)===norm(model));

    return rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="");
}

export async function initVehicleCatalogue({makeId,modelId,yearId,bodyId,fuelId,transId,driveId}){
    const {catalog:rows,cars}=await getData();

    const make=$(makeId);
    const model=$(modelId);
    const year=$(yearId);
    const body=$(bodyId);
    const fuel=$(fuelId);
    const trans=$(transId);
    const drive=$(driveId);

    if(!make||!model)throw new Error("Vehicle catalogue fields are missing from the page.");

    const auxiliary={};

    Object.keys(CAR_SELECT_FIELDS).forEach(id=>{
        const el=$(id);
        if(el)auxiliary[id]=el;
    });

    const allMakes=[
        ...rows.map(r=>r.make),
        ...cars.map(r=>r.make)
    ];

    const allModelsForMake=makeValue=>[
        ...modelRows(makeValue,rows).map(r=>r.model),
        ...cars.filter(r=>norm(r.make)===norm(makeValue)).map(r=>r.model)
    ];

    const modelRecord=()=>findModel(rows,make.value,model.value);

    const dependentValues=(record,key,carKey)=>{
        return [
            ...(record?.[key]||[]),
            ...valuesFromCars(cars,carKey,make.value,model.value)
        ];
    };

    function fillDependents(record){
        setOptions(body,dependentValues(record,"body_types","body_type"),"Select body type");
        setOptions(fuel,dependentValues(record,"fuel_types","fuel_type"),"Select fuel type");
        setOptions(trans,dependentValues(record,"transmissions","transmission"),"Select transmission");
        setOptions(drive,dependentValues(record,"drive_types","drive_type"),"Select drive type");

        const years=[
            ...(record?.years||[]),
            ...valuesFromCars(cars,"year",make.value,model.value)
        ];
        setOptions(year,years,"Select year");
    }

    setOptions(make,allMakes,"Select make");
    setOptions(model,[],"Select make first");
    fillDependents(null);

    Object.entries(CAR_SELECT_FIELDS).forEach(([id,key])=>{
        const el=auxiliary[id];
        if(!el)return;
        const values=valuesFromCars(cars,key);
        const existing=[...el.options].map(o=>o.value).filter(Boolean);
        setOptions(el,[...existing,...values],`Select ${id.replaceAll("_"," ")}`);
    });

    [
        [make,"make"],
        [model,"model"],
        [body,"body type"],
        [fuel,"fuel type"],
        [trans,"transmission"],
        [drive,"drive type"],
        ...Object.entries(auxiliary).map(([id,el])=>[el,id.replaceAll("_"," ")])
    ].forEach(([el,label])=>attachFreeText(el,label));

    make.addEventListener("change",()=>{
        if(make.value===ADD_NEW)return;

        const previous=model.value;
        setOptions(model,allModelsForMake(make.value),make.value?"Select model":"Select make first");

        if(previous){
            ensureOption(model,previous);
            const match=[...model.options].find(o=>norm(o.value)===norm(previous));
            if(match)model.value=match.value;
        }

        model.disabled=false;
        fillDependents(modelRecord());
    });

    model.addEventListener("change",()=>{
        if(model.value===ADD_NEW)return;
        fillDependents(modelRecord());
    });

    function validate(){
        if(!make.value||make.value===ADD_NEW)return "Please select or enter a make.";
        if(!model.value||model.value===ADD_NEW)return "Please select or enter a model.";
        return null;
    }

    function setVehicleValues(values={}){
        if(values.make){
            ensureOption(make,values.make);
            const m=[...make.options].find(o=>norm(o.value)===norm(values.make));
            make.value=m?m.value:String(values.make);
        }

        setOptions(model,allModelsForMake(make.value),make.value?"Select model":"Select make first");
        model.disabled=false;

        if(values.model){
            ensureOption(model,values.model);
            const m=[...model.options].find(o=>norm(o.value)===norm(values.model));
            model.value=m?m.value:String(values.model);
        }

        fillDependents(modelRecord());

        [
            [year,values.year],
            [body,values.body_type],
            [fuel,values.fuel_type],
            [trans,values.transmission],
            [drive,values.drive_type]
        ].forEach(([el,value])=>{
            if(!el||value===null||value===undefined||value==="")return;
            ensureOption(el,String(value));
            const match=[...el.options].find(o=>norm(o.value)===norm(value));
            el.value=match?match.value:String(value);
        });
    }

    function currentSelection(){
        const value=el=>el&&el.value!==ADD_NEW?el.value:"";
        return {
            make:value(make),
            model:value(model),
            year:value(year)?Number(value(year)):null,
            body_type:value(body),
            fuel_type:value(fuel),
            transmission:value(trans),
            drive_type:value(drive)
        };
    }

    return{
        rows,
        validate,
        setVehicleValues,
        currentSelection,
        getModelRecord:modelRecord,
        syncToCatalog:()=>registerCombo(currentSelection()),
        refresh:async()=>{
            cache.catalog=null;
            cache.cars=null;
            return getData(true);
        }
    };
}

export async function registerCombo({make,model,year,body_type,fuel_type,transmission,drive_type}={}){
    const cleanMake=String(make||"").trim();
    const cleanModel=String(model||"").trim();

    if(!cleanMake||!cleanModel)return;

    try{
        const rows=await getCatalog();
        const existing=rows.find(r=>r.make_key===norm(cleanMake)&&r.model_key===norm(cleanModel));

        if(!existing){
            const years=Number.isFinite(Number(year))?[Number(year)]:[];
            const {error}=await supabase.from("vehicle_catalog").insert({
                make:cleanMake,
                model:cleanModel,
                years,
                body_types:body_type?[String(body_type).trim()]:[],
                fuel_types:fuel_type?[String(fuel_type).trim()]:[],
                transmissions:transmission?[String(transmission).trim()]:[],
                drive_types:drive_type?[String(drive_type).trim()]:[],
                active:true
            });
            if(!error){
                cache.catalog=null;
                cache.cars=null;
            }
            return;
        }

        const merge=(current,value)=>{
            const v=String(value||"").trim();
            if(!v)return null;
            if((current||[]).some(x=>norm(x)===norm(v)))return null;
            return [...(current||[]),v];
        };

        const patch={};
        const b=merge(existing.body_types,body_type);
        const f=merge(existing.fuel_types,fuel_type);
        const t=merge(existing.transmissions,transmission);
        const d=merge(existing.drive_types,drive_type);
        const y=Number(year);

        if(b)patch.body_types=b;
        if(f)patch.fuel_types=f;
        if(t)patch.transmissions=t;
        if(d)patch.drive_types=d;
        if(Number.isFinite(y)&&!existing.years.includes(y))patch.years=[...(existing.years||[]),y].sort((a,b)=>a-b);

        if(Object.keys(patch).length){
            const {error}=await supabase.from("vehicle_catalog").update(patch).eq("id",existing.id);
            if(!error){
                cache.catalog=null;
                cache.cars=null;
            }
        }
    }catch(error){
        console.warn("Catalogue registration skipped:",error?.message||error);
    }
}