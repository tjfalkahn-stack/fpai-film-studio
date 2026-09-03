
import React,{useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import{
  Film,Users,Camera,Play,HardDrive,WalletCards,ChevronRight,Search,Plus,
  LayoutGrid,List,Clock3,LockKeyhole,X,Brain,AlertTriangle,CheckCircle2,
  Upload,Image as ImageIcon,Trash2,Star,Video,ThumbsUp,ThumbsDown,
  ShieldCheck,PackageCheck,Route
}from"lucide-react";
import{
  CANONICAL_REFERENCE_CATEGORIES,
  GENERATION_TYPES,
  OWNER_ID,
  PROJECT_ID,
  adjustProductionBudget,
  calculateBudgetSummary,
  characterReferenceCount,
  isCharacterReferenceComplete,
  missingReferenceCategories,
  normalizeBudget,
  normalizeCharacter,
  normalizeLedger,
  normalizeLedgerEntry,
  setProductionBudget,
  lockProductionBudget
}from"./domain.js";
import"./styles.css";

const KEY="fpai-film-studio-v1.1F", DB="fpai-film-studio-media", STORE="media";
const REFS=CANONICAL_REFERENCE_CATEGORIES.map(({key,label})=>[key,label.toUpperCase()]);
const EXPRESSIONS=["Neutral","Suspicious","Controlled Anger","Hurt","Paternal","Exhausted"];

const seed={
 project:{id:PROJECT_ID,title:"ENEMIES CLOSER",subtitle:"IYKYK · EP01 · Houston crime thriller",runtime:1620,budget:1200,productionBudget:{original:1200,current:1200,locked:false,lockedAt:null,history:[]},openingBudget:165,drift:"STRICT",ownerId:OWNER_ID},
 characters:[
  {id:"marcus",name:"Marcus \"Kingpin\" Holloway",role:"Kingpin / protagonist",locked:false,refs:{},expressions:{},voice:"Quiet Houston baritone",wardrobe:"Tarmac Look 01",notes:"Calm enough to scare a room. Camera stabilizes when he takes control."},
  {id:"jasmine",name:"Jasmine",role:"Marcus's woman / secret architect",locked:false,refs:{},expressions:{},voice:"Soft, intelligent, guarded",wardrobe:"Tarmac Look 01",notes:"Never telegraph the betrayal."},
  {id:"turner",name:"Detective Turner",role:"Dirty cop / hidden accomplice",locked:false,refs:{},expressions:{},voice:"Weary public mask; precise privately",wardrobe:"HPD Look 01",notes:"History with Jasmine stays invisible."},
  {id:"mikey",name:"Mikey",role:"Marcus & Jasmine's son",locked:false,refs:{},expressions:{},voice:"Natural four-year-old",wardrobe:"Pajamas 01",notes:"Emotional POV anchor for the opening."}
 ],
 scenes:[{id:"001",title:"Tarmac / Night / Rain",purpose:"Aftermath → The Three → They're Coming → Convoy → The King.",location:"Private airfield · East Houston",weather:"Heavy rain",status:"POC"}],
 assets:[
  {id:"a1",type:"Location",name:"Tarmac Master 01",status:"Needed",locked:false,mediaKey:null},
  {id:"a2",type:"Vehicle",name:"Marcus Convoy",status:"Needed",locked:false,mediaKey:null},
  {id:"a3",type:"Prop",name:"Six Black Duffels",status:"Needed",locked:false,mediaKey:null},
  {id:"a4",type:"Prop",name:"Jasmine Crucifix",status:"Needed",locked:false,mediaKey:null},
  {id:"a5",type:"Audio",name:"Heavy Rain Master",status:"Needed",locked:false,mediaKey:null}
 ],
 providers:[
  {id:"none",name:"No provider connected",enabled:false},
  {id:"image",name:"Image generation provider",enabled:false},
  {id:"video",name:"Video generation provider",enabled:false}
 ],
 shots:[
  ["001",2,"CHAOS","BLACK / Mikey crying","Sound-first opening",[],[]],
  ["002",2,"CHAOS","Mikey wet eye — ECU","Micro handheld",["mikey"],[]],
  ["003",3,"CHAOS","Airfield aerial / fire / jet","Aggressive drone dive",[],["a1"]],
  ["010",3,"CHAOS","Jasmine holding Mikey","Handheld reveal",["jasmine","mikey"],["a1"]],
  ["012",3,"CHAOS","Turner wounded","Find through foreground",["turner"],["a1"]],
  ["020",3,"CHAOS","Convoy aerial","Top-down pursuit",[],["a1","a2"]],
  ["027",4.5,"CONTROL","Marcus hero reveal","Stabilized push-in",["marcus"],["a1"]],
  ["031",2,"CONTROL","MIKEY: Daddy!","Child-height close-up",["mikey"],["a1"]]
 ].map(r=>({id:r[0],scene:"001",sec:r[1],mode:r[2],subject:r[3],move:r[4],characters:r[5],assets:r[6],status:["003","010","012","020","027"].includes(r[0])?"Hero":"Planned",prompt:"",provider:"none",cost:0,approved:false,takes:[],drift:"STRICT"})),
 ledger:[]
};

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function putMedia(k,f){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction(STORE,"readwrite");t.objectStore(STORE).put(f,k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}
async function getMedia(k){const d=await openDB();return new Promise((res,rej)=>{const r=d.transaction(STORE).objectStore(STORE).get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function delMedia(k){const d=await openDB();return new Promise((res,rej)=>{const t=d.transaction(STORE,"readwrite");t.objectStore(STORE).delete(k);t.oncomplete=res;t.onerror=()=>rej(t.error)})}

function migrate(){
 let old=null;
 for(const k of[KEY,"fpai-film-studio-v1.1D","fpai-film-studio-v1.1C","fpai-film-studio-v1.1B","fpai-film-studio-v1.1A"]){
  try{old=JSON.parse(localStorage.getItem(k));if(old)break}catch{}
 }
 if(!old)return seed;
 const project={...seed.project,...old.project,id:old.project?.id||PROJECT_ID};
 project.productionBudget=normalizeBudget(project);
 return {...seed,...old,
  project,
  characters:(old.characters||seed.characters).map(normalizeCharacter),
  assets:old.assets||seed.assets,
  providers:old.providers||seed.providers,
  shots:(old.shots||seed.shots).map(s=>({...s,characters:s.characters||[],assets:s.assets||[],takes:s.takes||[],provider:s.provider||"none",drift:s.drift||"STRICT"})),
  ledger:normalizeLedger(old.ledger||[])
 };
}
function useData(){const[d,setD]=useState(migrate);useEffect(()=>localStorage.setItem(KEY,JSON.stringify(d)),[d]);return[d,setD]}
function fmt(sec){return`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,"0")}`}
function Mode({value}){return <span className={`mode ${value.toLowerCase()}`}>{value}</span>}
function Media({mediaKey,type="image"}){const[url,setUrl]=useState("");useEffect(()=>{let o="";if(mediaKey)getMedia(mediaKey).then(f=>{if(f){o=URL.createObjectURL(f);setUrl(o)}});return()=>o&&URL.revokeObjectURL(o)},[mediaKey]);if(!mediaKey)return <div className="emptyMedia"><ImageIcon/></div>;if(!url)return <div className="emptyMedia">Loading…</div>;return type==="video"?<video src={url} controls/>:<img src={url}/>}

function App(){
 const[data,setData]=useData(),[tab,setTab]=useState("Overview"),[char,setChar]=useState(null),[shot,setShot]=useState(null),[pkg,setPkg]=useState(null),[view,setView]=useState("Storyboard"),[dragTarget,setDragTarget]=useState(null),[budgetDraft,setBudgetDraft]=useState(""),[budgetNote,setBudgetNote]=useState("");
 const tabs=["Overview","Characters","Scenes","Shots","Takes","Assets","Continuity","Router","Budget"];
 const c=id=>data.characters.find(x=>x.id===id), a=id=>data.assets.find(x=>x.id===id);
 const budget=useMemo(()=>calculateBudgetSummary(data.project,data.ledger),[data.project,data.ledger]);
 const spent=budget.spent;
 const approved=useMemo(()=>data.shots.filter(s=>s.approved).reduce((n,s)=>n+s.sec,0),[data.shots]);
 const updateChar=(id,p)=>setData(d=>({...d,characters:d.characters.map(x=>x.id===id?{...x,...p}:x)}));
 const updateShot=(id,p)=>setData(d=>({...d,shots:d.shots.map(x=>x.id===id?{...x,...p}:x)}));
 const updateAsset=(id,p)=>setData(d=>({...d,assets:d.assets.map(x=>x.id===id?{...x,...p}:x)}));
 function refCount(x){return characterReferenceCount(x)}
 function lockReady(x){return isCharacterReferenceComplete(x)}
 function validate(s){
  const blockers=[],warnings=[];
  s.characters.forEach(id=>{const x=c(id);if(!x?.locked)blockers.push(`${x?.name||id} NOT LOCKED`);missingReferenceCategories(x).forEach(({label})=>blockers.push(`${x?.name||id} missing ${label}`))});
  s.assets.forEach(id=>{const x=a(id);if(!x?.locked)warnings.push(`${x?.name||id} not locked`)});
  if(s.provider==="none")blockers.push("No generation provider selected");
  const p=data.providers.find(x=>x.id===s.provider);if(s.provider!=="none"&&!p?.enabled)blockers.push(`${p?.name||s.provider} not connected`);
  return{blockers,warnings,ready:blockers.length===0};
 }
 function pack(s){return{shot:s,characters:s.characters.map(c),assets:s.assets.map(a),validation:validate(s),prompt:`${s.mode} mode · ${s.sec}s · ${s.subject} · ${s.move} · identity drift ${s.drift||data.project.drift}. ${s.prompt}`}}
 async function addRef(ch,slot,file){if(!file)return;const key=`char:${ch.id}:${slot}:${Date.now()}`;const previous=ch.refs?.[slot]?.key;await putMedia(key,file);if(previous)await delMedia(previous);const refs={...ch.refs,[slot]:{key,name:file.name,category:slot,uploadedAt:new Date().toISOString()}};updateChar(ch.id,{refs,locked:false});setChar({...ch,refs,locked:false})}
 async function removeRef(ch,slot){const ref=ch.refs?.[slot];if(ref?.key)await delMedia(ref.key);const refs={...ch.refs};delete refs[slot];updateChar(ch.id,{refs,locked:false});setChar({...ch,refs,locked:false})}
 async function addExpr(ch,name,file){if(!file)return;const key=`char:${ch.id}:expr:${name}:${Date.now()}`;await putMedia(key,file);const expressions={...ch.expressions,[name]:{key,name:file.name}};updateChar(ch.id,{expressions});setChar({...ch,expressions})}
 async function addTake(s,file){if(!file)return;const key=`shot:${s.id}:take:${Date.now()}`;await putMedia(key,file);const t={id:String(Date.now()),key,name:file.name,status:"Review",cost:0,continuity:0};const takes=[...s.takes,t];updateShot(s.id,{takes});setShot({...s,takes})}
 function setTake(s,id,p){const takes=s.takes.map(t=>t.id===id?{...t,...p}:t);updateShot(s.id,{takes});setShot({...s,takes})}
 function approveTake(s,id){const chosen=s.takes.find(t=>t.id===id);const takes=s.takes.map(t=>({...t,status:t.id===id?"Approved":t.status==="Approved"?"Rejected":t.status}));setData(d=>({...d,shots:d.shots.map(x=>x.id===s.id?{...x,takes,approved:true,cost:Number(chosen.cost||0)}:x),ledger:Number(chosen.cost||0)>0?[...d.ledger,normalizeLedgerEntry({id:`ledger:${s.id}:${id}:${Date.now()}`,projectId:d.project.id||PROJECT_ID,sceneId:s.scene,shotId:s.id,generationId:id,provider:s.provider||"manual",model:"uploaded-take",generationType:GENERATION_TYPES.FINAL_IMAGE,estimatedCost:Number(chosen.cost||0),actualCost:Number(chosen.cost||0),generationStatus:"completed",approvalStatus:"approved",timestamp:new Date().toISOString(),label:`Shot ${s.id} approved take`})]:d.ledger}));setShot({...s,takes,approved:true,cost:Number(chosen.cost||0)})}
 function applySetBudget(){try{setData(d=>({...d,project:setProductionBudget(d.project,budgetDraft||budget.currentBudget)}));setBudgetDraft("")}catch(e){alert(e.message)}}
 function applyLockBudget(){setData(d=>({...d,project:lockProductionBudget(d.project)}))}
 function applyAdjustBudget(){try{setData(d=>({...d,project:adjustProductionBudget(d.project,budgetDraft||budget.currentBudget,budgetNote,d.project.ownerId||OWNER_ID)}));setBudgetDraft("");setBudgetNote("")}catch(e){alert(e.message)}}
 const locked=data.characters.filter(x=>x.locked).length;
 return <div className="app"><aside><div className="brand"><div className="fp">FP</div><div><b>FPAI</b><span>FILM STUDIO v1.1D</span></div></div><nav>{tabs.map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t==="Characters"?<Users/>:t==="Shots"?<Camera/>:t==="Takes"?<Play/>:t==="Assets"?<HardDrive/>:t==="Continuity"?<ShieldCheck/>:t==="Router"?<Route/>:t==="Budget"?<WalletCards/>:<Film/>}{t}<ChevronRight/></button>)}</nav><div className="persist"><i/> FULL PIPELINE<small>Character → Continuity → Router</small></div></aside>
 <main><header><div><span className="eyebrow">ACTIVE PRODUCTION</span><h1>{data.project.title}</h1><p>{data.project.subtitle}</p></div><div className="actions"><button className="ghost"><Search/>Find shot</button><button className="primary" onClick={()=>setTab("Shots")}><Plus/>New Shot</button></div></header>
 <section className="metrics"><div><span>CAST LOCKED</span><b>{locked}/4</b><small>Principal cast</small></div><div><span>IDENTITY DRIFT</span><b>{data.project.drift}</b><small>Principal default</small></div><div><span>PROVIDERS</span><b>{data.providers.filter(p=>p.enabled).length} LIVE</b><small>Renderer connections</small></div><div className={`budgetMetric ${budget.warningState}`}><span>PRODUCTION SPEND</span><b>${spent.toFixed(2)}</b><small>{budget.percentageUsed.toFixed(1)}% of ${budget.currentBudget.toFixed(2)}</small></div></section>

 {tab==="Overview"&&<section className="two"><div className="panel"><span className="eyebrow">SCENE 001</span><h2>Tarmac / Night / Rain</h2><div className="heroinside"><div><h3>Opening Proof of Concept</h3><p>Aftermath → The Three → They're Coming → Convoy → The King.</p><div className="numbers"><b>{data.shots.length}<small>KEY SHOTS</small></b><b>{fmt(data.shots.reduce((n,s)=>n+s.sec,0))}<small>MAPPED</small></b><b>{locked}/4<small>CAST LOCKED</small></b></div></div><div><Mode value="CHAOS"/> <Mode value="SUSPICION"/> <Mode value="CONTROL"/></div></div></div><div className="panel"><span className="eyebrow">PIPELINE STATUS</span><h2>Production Readiness</h2><div className="intel"><p><CheckCircle2/>Continuity gate installed</p><p><AlertTriangle/>{4-locked} principal characters still unlocked</p><p><AlertTriangle/>0 generation providers connected</p><p><CheckCircle2/>No production spend yet</p></div></div></section>}

 {tab==="Characters"&&<div className="panel"><span className="eyebrow">VISUAL BIBLE</span><h2>Canonical Character Locks</h2><div className="charactergrid">{data.characters.map(x=><div className="charcard" key={x.id}><div className="portrait">{x.refs?.identityFront?.key?<Media mediaKey={x.refs.identityFront.key}/>:x.name[0]}</div><h3>{x.name}</h3><small>{x.role}</small><p>{refCount(x)}/5 required reference assets</p><span className={x.locked?"ok":"draft"}>{x.locked?"LOCKED":"NOT LOCKED"}</span><button className="ghost full" onClick={()=>setChar(x)}>Open character bible</button></div>)}</div></div>}

 {tab==="Scenes"&&<div className="panel"><span className="eyebrow">SCENES</span><h2>Screenplay Command Center</h2>{data.scenes.map(s=><div className="scenerow"><div><b>SCENE {s.id} · {s.title}</b><p>{s.purpose}</p><small>{s.location} · {s.weather}</small></div><span>{s.status}</span></div>)}</div>}

 {tab==="Shots"&&<div className="panel"><div className="panelhead"><div><span className="eyebrow">SHOT DIRECTOR</span><h2>Scene 001</h2></div><div className="viewtoggle"><button onClick={()=>setView("Storyboard")} className={view==="Storyboard"?"on":""}><LayoutGrid/></button><button onClick={()=>setView("List")} className={view==="List"?"on":""}><List/></button><button onClick={()=>setView("Timeline")} className={view==="Timeline"?"on":""}><Clock3/></button></div></div>{view==="Storyboard"?<div className="storyboard">{data.shots.map(s=><div className="shotcard" onClick={()=>setShot(s)}><div className="frame"><span>#{s.id}</span><b>{s.subject}</b></div><div className="shotmeta"><Mode value={s.mode}/><span>{s.sec}s</span><span>{validate(s).ready?"READY":"BLOCKED"}</span></div></div>)}</div>:<div className="rows">{data.shots.map(s=><div onClick={()=>setShot(s)}><b>#{s.id}</b><span>{s.subject}</span><span>{s.characters.map(id=>c(id)?.name).join(", ")||"No principal cast"}</span><strong className={validate(s).ready?"good":"bad"}>{validate(s).ready?"READY":"BLOCKED"}</strong></div>)}</div>}</div>}

 {tab==="Takes"&&<div className="panel"><span className="eyebrow">APPROVALS</span><h2>Take Review Room</h2>{data.shots.filter(s=>s.takes.length).length?data.shots.filter(s=>s.takes.length).map(s=><div className="takeIndexRow" onClick={()=>setShot(s)}><b>Shot #{s.id}</b><span>{s.subject}</span><span>{s.takes.length} takes</span></div>):<p className="sub">No takes yet. Good. Paid generation is still off.</p>}</div>}

 {tab==="Assets"&&<div className="panel"><span className="eyebrow">ASSET VAULT</span><h2>Production Assets</h2><div className="assetlist">{data.assets.map(x=><div><HardDrive/><div><b>{x.name}</b><small>{x.type}</small></div><span className={x.locked?"ok":"draft"}>{x.locked?"LOCKED":x.status}</span></div>)}</div></div>}

 {tab==="Continuity"&&<><div className="panel"><span className="eyebrow">CONTINUITY GATE</span><h2>Principal Cast</h2><div className="charactergrid">{data.characters.map(x=><div className="charcard"><div className="portrait small">{x.name[0]}</div><h3>{x.name}</h3><p>{refCount(x)}/5 reference assets</p><span className={x.locked?"ok":"draft"}>{x.locked?"LOCKED":"NOT LOCKED"}</span></div>)}</div></div><div className="panel"><h2>Pre-flight Shot Status</h2><div className="rows">{data.shots.map(s=><div onClick={()=>setPkg(pack(s))}><b>#{s.id}</b><span>{s.subject}</span><span>{s.characters.map(id=>c(id)?.name).join(", ")||"No principal cast"}</span><strong className={validate(s).ready?"good":"bad"}>{validate(s).ready?"READY":"BLOCKED"}</strong></div>)}</div></div></>}

 {tab==="Router"&&<div className="panel"><span className="eyebrow">PROVIDER ROUTER</span><h2>Renderers</h2><p className="sub">Architecture ready. Paid providers intentionally disconnected.</p>{data.providers.map(p=><div className="provider"><Route/><div><b>{p.name}</b><small>{p.id}</small></div><span className={p.enabled?"ok":"draft"}>{p.enabled?"CONNECTED":"DISCONNECTED"}</span></div>)}</div>}

 {tab==="Budget"&&<section className="two"><div className="panel"><span className="eyebrow">PRODUCTION LEDGER</span><h2>Owner Production Budget</h2><div className={`bigmoney budgetState ${budget.warningState}`}>${spent.toFixed(2)}<small>spent · {budget.percentageUsed.toFixed(1)}% used</small></div><div className="budgetrows"><div><span>Original Budget</span><b>${budget.originalBudget.toFixed(2)}</b></div><div><span>Current Budget</span><b>${budget.currentBudget.toFixed(2)}</b></div><div><span>Remaining</span><b>${budget.remaining.toFixed(2)}</b></div><div><span>Status</span><b>{budget.warningState==="over"?"OVER BUDGET":budget.warningState.toUpperCase()}</b></div><div><span>Approved footage</span><b>{fmt(approved)}</b></div></div><div className="budgetForm"><label>Budget Amount<input type="number" min="0" step=".01" value={budgetDraft} placeholder={budget.currentBudget.toFixed(2)} onChange={e=>setBudgetDraft(e.target.value)}/></label><label>Adjustment Note<input value={budgetNote} placeholder="Optional reason" onChange={e=>setBudgetNote(e.target.value)}/></label><div className="budgetActions"><button className="ghost" disabled={budget.locked} onClick={applySetBudget}>Set Budget</button><button className="primary" disabled={budget.locked} onClick={applyLockBudget}><LockKeyhole/>Lock Budget</button><button className="ghost" onClick={applyAdjustBudget}>Adjust Budget</button></div><p className="sub">{budget.locked?`Locked ceiling approved ${budget.lockedAt?new Date(budget.lockedAt).toLocaleString():""}. Owner can still approve additional spend.`:"Budget is editable until owner approval."}</p></div></div><div className="panel"><span className="eyebrow">GENERATION LEDGER</span><h2>Actual Spend</h2>{data.ledger.length?data.ledger.map(x=><div className="ledgerrow" key={x.id}><span>{new Date(x.timestamp).toLocaleString()} · {x.label||x.generationType}<small>{x.provider}/{x.model} · {x.generationStatus} · {x.approvalStatus}</small></span><b>${Number(x.actualCost||0).toFixed(2)}</b></div>):<p className="sub">No spend logged.</p>}<h3>Budget Audit History</h3>{budget.history.length?budget.history.map((x,i)=><div className="ledgerrow" key={`${x.timestamp}-${i}`}><span>{new Date(x.timestamp).toLocaleString()} · {x.actor||OWNER_ID}<small>{x.note||"No note"}</small></span><b>${Number(x.previousBudget).toFixed(2)} → ${Number(x.newBudget).toFixed(2)}</b></div>):<p className="sub">No budget adjustments yet.</p>}</div></section>}
 </main>

 {char&&<div className="overlay"><div className="drawer wide"><button className="close" onClick={()=>setChar(null)}><X/></button><span className="eyebrow">CHARACTER BIBLE</span><h2>{char.name}</h2><h3>Required Visual References</h3><p className="dropHint">Drag an image onto a slot, or click the slot to browse.</p><div className="refgrid">{REFS.map(([slot,label])=>{const ref=char.refs?.[slot];const key=`ref:${slot}`;return <div className={`refslot dropzone ${dragTarget===key?"dragging":""}`} key={slot} onDragEnter={e=>{e.preventDefault();setDragTarget(key)}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="copy"}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragTarget(null)}} onDrop={e=>{e.preventDefault();setDragTarget(null);const f=e.dataTransfer.files?.[0];if(f?.type?.startsWith("image/"))addRef(char,slot,f)}}><label><div className="refpreview">{ref?<Media mediaKey={ref.key}/>:<><Upload/><span>DROP IMAGE</span></>}</div><b>{label}</b><small>{ref?ref.name:"Required before lock"}</small><div className="slotAction">{ref?"DROP TO REPLACE · CLICK TO BROWSE":"DROP HERE · CLICK TO BROWSE"}</div><input type="file" accept="image/*" onChange={e=>addRef(char,slot,e.target.files?.[0])}/></label>{ref&&<button className="iconBtn" title="Remove reference" onClick={()=>removeRef(char,slot)}><Trash2/></button>}</div>})}</div><h3>Expression Bank</h3><p className="dropHint">Expressions support drag-and-drop too.</p><div className="expressiongrid">{EXPRESSIONS.map(n=>{const key=`expr:${n}`;return <label className={`expression dropzone ${dragTarget===key?"dragging":""}`} onDragEnter={e=>{e.preventDefault();setDragTarget(key)}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="copy"}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragTarget(null)}} onDrop={e=>{e.preventDefault();setDragTarget(null);const f=e.dataTransfer.files?.[0];if(f?.type?.startsWith("image/"))addExpr(char,n,f)}}><div>{char.expressions?.[n]?<Media mediaKey={char.expressions[n].key}/>:<><Upload/><span>DROP</span></>}</div><b>{n}</b><input type="file" accept="image/*" onChange={e=>addExpr(char,n,e.target.files?.[0])}/></label>})}</div><label>Role<input value={char.role} readOnly/></label><label>Voice<input value={char.voice} onChange={e=>{const v=e.target.value;setChar({...char,voice:v});updateChar(char.id,{voice:v})}}/></label><label>Wardrobe<input value={char.wardrobe} onChange={e=>{const v=e.target.value;setChar({...char,wardrobe:v});updateChar(char.id,{wardrobe:v})}}/></label><label>Continuity notes<textarea value={char.notes} onChange={e=>{const v=e.target.value;setChar({...char,notes:v});updateChar(char.id,{notes:v})}}/></label>{!lockReady(char)&&<div className="validation"><AlertTriangle/>Missing {missingReferenceCategories(char).map(x=>x.label).join(", ")}.</div>}<button disabled={!lockReady(char)} className="primary full" onClick={()=>{const locked=!char.locked;updateChar(char.id,{locked});setChar({...char,locked})}}><LockKeyhole/>{char.locked?"UNLOCK CHARACTER":"LOCK CHARACTER"}</button></div></div>}

 {shot&&<div className="overlay"><div className="drawer wide"><button className="close" onClick={()=>setShot(null)}><X/></button><span className="eyebrow">SHOT EDITOR</span><h2>Shot #{shot.id}</h2><h3>{shot.subject}</h3><div className="formtwo"><label>Duration<input value={shot.sec} readOnly/></label><label>Mode<input value={shot.mode} readOnly/></label></div><label>Camera<input value={shot.move} readOnly/></label><label>Prompt<textarea value={shot.prompt} onChange={e=>{const v=e.target.value;setShot({...shot,prompt:v});updateShot(shot.id,{prompt:v})}}/></label><button className="ghost full" onClick={()=>setPkg(pack(shot))}><PackageCheck/>Preview Generation Package</button><h3>Takes</h3><label className="primary uploadBtn"><Upload/>Upload Take<input type="file" accept="image/*,video/*" onChange={e=>addTake(shot,e.target.files?.[0])}/></label><div className="takegrid">{shot.takes.map(t=><div className="takecard"><Media mediaKey={t.key} type={t.name.match(/\.(mp4|mov|webm)$/i)?"video":"image"}/><input type="number" step=".01" value={t.cost} onChange={e=>setTake(shot,t.id,{cost:Number(e.target.value)})}/><input type="number" value={t.continuity} onChange={e=>setTake(shot,t.id,{continuity:Number(e.target.value)})}/><div><button onClick={()=>setTake(shot,t.id,{status:"Rejected"})}><ThumbsDown/></button><button onClick={()=>setTake(shot,t.id,{status:"Shortlist"})}><Star/></button><button onClick={()=>approveTake(shot,t.id)}><ThumbsUp/></button></div></div>)}</div></div></div>}

 {pkg&&<div className="overlay"><div className="drawer"><button className="close" onClick={()=>setPkg(null)}><X/></button><span className="eyebrow">GENERATION PACKAGE PREVIEW</span><h2>Shot #{pkg.shot.id}</h2><h3>{pkg.shot.subject}</h3><section><b>CHARACTER INHERITANCE</b>{pkg.characters.length?pkg.characters.map(x=><p>{x.name} — <strong className={x.locked?"good":"bad"}>{x.locked?"LOCKED":"BLOCKED"}</strong></p>):<p>No principal cast.</p>}</section><section><b>ASSET INHERITANCE</b>{pkg.assets.length?pkg.assets.map(x=><p>{x.name} — <strong className={x.locked?"good":"warn"}>{x.locked?"LOCKED":"WARNING"}</strong></p>):<p>No required assets.</p>}</section><section><b>ASSEMBLED PROMPT</b><pre>{pkg.prompt}</pre></section><section><b>VALIDATION</b>{pkg.validation.blockers.map(x=><p className="bad">BLOCKER · {x}</p>)}{pkg.validation.warnings.map(x=><p className="warn">WARNING · {x}</p>)}{pkg.validation.ready&&<p className="good">READY FOR ROUTER</p>}</section><button className="generate" disabled={!pkg.validation.ready}>GENERATE — DISABLED UNTIL READY</button></div></div>}
 </div>
}
createRoot(document.getElementById("root")).render(<App/>);
