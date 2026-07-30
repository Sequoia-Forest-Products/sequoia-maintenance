// build-bust-v3-1783103048.2133203
import React, { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./supabase.js";

// ─── BRAND ───────────────────────────────────────────────────────────────────
const B = {
  orange:"#EE7425", rust:"#AD4C25", wine:"#4B1A21", gold:"#EFBA62",
  brick:"#902423", teal:"#004C56", ink:"#27211E", cream:"#EAD9CA",
  bg:"#F5F0EB", surface:"#FFFFFF", surface2:"#F0E8E0", border:"#DDD0C4",
  muted:"#9A8070", text:"#27211E", textDim:"#6B5448",
};
const sf = { fontFamily:"Montserrat, Arial, sans-serif" };
const TASK_KEY  = "sfp-tasks-v6"; // kept for migration only

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,9);
const PRIORITY_LABEL = p => p>=9?"Critical":p>=7?"High":p>=5?"Medium":p>=3?"Low":"Someday";
const PRIORITY_COLOR = p => p>=9?B.brick:p>=7?B.rust:p>=5?B.gold:p>=3?B.teal:B.muted;
const TYPE_COLOR = { Project:B.orange, PM:B.teal, Compliance:B.brick, Repair:B.gold };

// Schedule-tab progress cycle: On Track (green) → Marginal (yellow) → Behind (red)
const PROGRESS_STATUSES = ["On Track","Marginal","Behind"];
const PROGRESS_COLOR = { "On Track":"#2E7D32", "Marginal":B.gold, "Behind":B.brick };
const nextProgressStatus = (s) => PROGRESS_STATUSES[(PROGRESS_STATUSES.indexOf(s)+1)%PROGRESS_STATUSES.length];

// Task ID prefix — sequential per type, derived from existing tasks
const TASK_PREFIX = { Project:"P", PM:"M", Compliance:"C", Repair:"R" };
const nextTaskId = (type, existingTasks) => {
  const pre = TASK_PREFIX[type] || "T";
  const nums = (existingTasks||[])
    .map(t=>t.id||"")
    .filter(id=>id.startsWith(pre))
    .map(id=>parseInt(id.slice(pre.length))||0);
  const next = nums.length>0 ? Math.max(...nums)+1 : 1;
  return pre + next;
};

// Date helpers — timezone-safe
const monStart = (d) => {
  const s = typeof d==="string" ? d.replace(/T.*/,"") : new Date(d).toISOString().slice(0,10);
  const [y,m,day] = s.split("-").map(Number);
  const dt = new Date(y, m-1, day);
  const dow = dt.getDay();
  const diff = dow===0 ? -6 : 1-dow;
  dt.setDate(day+diff);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
};
const addDays = (s, n) => {
  const base = typeof s==="string" ? s.replace(/T.*/,"") : new Date(s).toISOString().slice(0,10);
  const [y,m,d] = base.split("-").map(Number);
  const dt = new Date(y, m-1, d+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
};
const fmtWeek = (s) => {
  const e = addDays(s,6);
  return new Date(s+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})
    +" – "+new Date(e+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const fmtDate = (d) => {
  if(!d) return "—";
  const dt = new Date(d+"T00:00:00");
  if(isNaN(dt)) return "—";
  return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const todayStr = () => new Date().toISOString().slice(0,10);
const nextMonday = () => monStart(addDays(todayStr(),7));
const normalizeDate = (d) => {
  if(!d) return "";
  if(/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,10);
  try { const dt=new Date(d); if(!isNaN(dt)) return dt.toISOString().slice(0,10); } catch{}
  return "";
};

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const lsGet  = (k) => { try{ const r=localStorage.getItem(k); return r?JSON.parse(r):null; }catch{return null;} };
const lsSet  = (k,v) => { try{ localStorage.setItem(k,JSON.stringify(v)); }catch{} };

// ─── API ──────────────────────────────────────────────────────────────────────
const gsGet  = (action) => fetch(`${API}?action=${action}`).then(r=>r.json()).catch(()=>null);
const gsPost = (action, payload) => fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({action,...payload})}).then(r=>r.json()).catch(()=>null);

const currentUser = () => window.__sfpCtx?.user?.name || window.__sfpCtx?.user?.email || "Unknown";

// ─── DEFAULT SETTINGS ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  team: {
    Millwright: [
      {name:"Will Gonzalez", hours:40},
      {name:"Jared Bonato",  hours:40},
      {name:"Sid Lindberg",  hours:40},
      {name:"Mike Kilroy",   hours:40},
      {name:"Ace Flowers",   hours:40},
    ],
    Electrical: [
      {name:"Travis Vance",  hours:40},
      {name:"Jayce Coovert", hours:40},
    ],
  },
  escalation: {
    emails: [],
    threshold: 4,
  },
};

// ─── SEED DATA (PM Register - 25 machines) ────────────────────────────────────
const SEED_PM = [
  {id:"pm1",  machine:"Debarker",          dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"5",  formUrl:""},
  {id:"pm2",  machine:"Cutoff Saw",        dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"3",  formUrl:""},
  {id:"pm3",  machine:"Twin Infeed",       dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"5",  formUrl:""},
  {id:"pm4",  machine:"Gang Edger",        dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"5",  formUrl:""},
  {id:"pm5",  machine:"Trim Line",         dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"4",  formUrl:""},
  {id:"pm6",  machine:"G Machine",         dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"4",  formUrl:""},
  {id:"pm7",  machine:"Green Chain 1",     dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"3",  formUrl:""},
  {id:"pm8",  machine:"Green Chain 2",     dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"3",  formUrl:""},
  {id:"pm9",  machine:"Quad Resaw",        dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-19", defaultHours:"6",  formUrl:""},
  {id:"pm10", machine:"Waste System",      dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"3",  formUrl:""},
  {id:"pm11", machine:"Hog",              dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"5",  formUrl:""},
  {id:"pm12", machine:"Chipper",          dept:"Millwright", type:"Mechanical", frequency:"Weekly",   lastDone:"2026-06-23", defaultHours:"6",  formUrl:""},
  {id:"pm13", machine:"Bakerville",       dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-06-19", defaultHours:"8",  formUrl:""},
  {id:"pm14", machine:"Single Resaw",     dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-06-19", defaultHours:"6",  formUrl:""},
  {id:"pm15", machine:"Landing Table",    dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-05-31", defaultHours:"4",  formUrl:""},
  {id:"pm16", machine:"Dog Ear Machine",  dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-05-31", defaultHours:"4",  formUrl:""},
  {id:"pm17", machine:"Dip Tank",         dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-05-31", defaultHours:"3",  formUrl:""},
  {id:"pm18", machine:"Forklifts",        dept:"Millwright", type:"Mechanical", frequency:"Monthly",  lastDone:"2026-05-31", defaultHours:"8",  formUrl:""},
  {id:"pm19", machine:"Board Edger",      dept:"Electrical", type:"Electrical", frequency:"Monthly",  lastDone:"2026-05-31", defaultHours:"5",  formUrl:""},
  {id:"pm20", machine:"MCC Stations",     dept:"Electrical", type:"Electrical", frequency:"Quarterly",lastDone:"2026-04-01", defaultHours:"8",  formUrl:""},
  {id:"pm21", machine:"VFDs",             dept:"Electrical", type:"Electrical", frequency:"Quarterly",lastDone:"2026-04-01", defaultHours:"6",  formUrl:""},
  {id:"pm22", machine:"Control Panels",   dept:"Electrical", type:"Electrical", frequency:"Quarterly",lastDone:"2026-04-01", defaultHours:"6",  formUrl:""},
  {id:"pm23", machine:"Lighting",         dept:"Electrical", type:"Electrical", frequency:"Quarterly",lastDone:"2026-04-01", defaultHours:"4",  formUrl:""},
  {id:"pm24", machine:"Emergency Systems",dept:"Electrical", type:"Electrical", frequency:"Biannual", lastDone:"2026-01-01", defaultHours:"8",  formUrl:""},
  {id:"pm25", machine:"Compressors",      dept:"Millwright", type:"Mechanical", frequency:"Biannual", lastDone:"2026-01-01", defaultHours:"6",  formUrl:""},
];

// ─── PM HELPERS ───────────────────────────────────────────────────────────────
const FREQ_DAYS = { Weekly:7, Biweekly:14, Monthly:30, Quarterly:91, Biannual:182, Annual:365 };
const daysUntilDue = (lastDone, freq) => {
  if(!lastDone) return -999;
  const last = new Date(lastDone+"T00:00:00");
  const due  = new Date(last.getTime() + (FREQ_DAYS[freq]||30)*86400000);
  return Math.round((due - new Date())/86400000);
};
const nextDueDate = (lastDone, freq) => {
  if(!lastDone) return "";
  const d = new Date(lastDone+"T00:00:00");
  d.setDate(d.getDate()+(FREQ_DAYS[freq]||30));
  return d.toISOString().slice(0,10);
};
const pmStatus = (days) => days<0?"overdue":days<=7?"due-soon":"ok";

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
const Btn = ({onClick,variant="primary",children,style={},disabled=false})=>{
  const v = {
    primary:{background:B.orange,color:"#fff",border:"none"},
    secondary:{background:"transparent",color:B.textDim,border:`1px solid ${B.border}`},
    danger:{background:"transparent",color:B.brick,border:`1px solid ${B.brick}44`},
    teal:{background:B.teal,color:"#fff",border:"none"},
  };
  return <button onClick={onClick} disabled={disabled}
    style={{padding:"7px 14px",borderRadius:4,cursor:disabled?"not-allowed":"pointer",
      fontSize:12,fontWeight:700,opacity:disabled?0.5:1,...sf,...v[variant],...style}}>
    {children}
  </button>;
};
const Badge = ({color,children})=>(
  <span style={{background:color+"22",color,border:`1px solid ${color}44`,
    borderRadius:3,padding:"2px 7px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",...sf}}>
    {children}
  </span>
);
const Field = ({label,children,col})=>(
  <div style={{gridColumn:col,marginBottom:12}}>
    <div style={{color:B.textDim,fontSize:10,fontWeight:700,textTransform:"uppercase",
      letterSpacing:1,marginBottom:4,...sf}}>{label}</div>
    {children}
  </div>
);
const Input = ({value,onChange,type="text",placeholder=""})=>(
  <input value={value} onChange={onChange} type={type} placeholder={placeholder}
    style={{width:"100%",background:"#fff",border:`1px solid ${B.border}`,borderRadius:4,
      color:B.text,padding:"7px 10px",fontSize:13,boxSizing:"border-box",...sf}}/>
);
const Sel = ({value,onChange,children})=>(
  <select value={value} onChange={onChange}
    style={{width:"100%",background:"#fff",border:`1px solid ${B.border}`,borderRadius:4,
      color:B.text,padding:"7px 10px",fontSize:13,...sf}}>
    {children}
  </select>
);
const Textarea = ({value,onChange,rows=3,placeholder=""})=>(
  <textarea value={value} onChange={onChange} rows={rows} placeholder={placeholder}
    style={{width:"100%",background:"#fff",border:`1px solid ${B.border}`,borderRadius:4,
      color:B.text,padding:"7px 10px",fontSize:13,resize:"vertical",boxSizing:"border-box",...sf}}/>
);
const Modal = ({title,onClose,children,wide})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,
    display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:"#fff",borderRadius:6,width:"100%",maxWidth:wide?740:520,
      maxHeight:"90vh",overflowY:"auto",padding:28,boxShadow:"0 8px 32px rgba(0,0,0,.2)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h3 style={{margin:0,color:B.text,fontSize:15,fontWeight:700,...sf}}>{title}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",color:B.muted,
          cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
      </div>
      {children}
    </div>
  </div>
);

// ─── TASK FORM ────────────────────────────────────────────────────────────────
function TaskForm({task, settings, onSave, onClose, pmItems}) {
  const isNew = !task;
  const blank = {type:"Project",status:"Inbox",title:"",dept:"Millwright",assignee:"",
    estHours:"",weeklyHours:"",weekOf:"",hoursLogged:"0",priority:5,dueDate:"",
    machine:"",notes:"",source:"",completedBy:"",pmId:""};
  const [form,setForm] = useState(task?{...task}:blank);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const allDepts = Object.keys(settings?.team||DEFAULT_SETTINGS.team);
  const deptPeople = (settings?.team||DEFAULT_SETTINGS.team)[form.dept]||[];

  // When PM machine is selected, auto-fill title, hours, pmId
  const onPMSelect = (pmId) => {
    const pm = (pmItems||[]).find(p=>p.id===pmId);
    if(!pm) return;
    setForm(f=>({...f,
      pmId:   pm.id,
      machine: pm.machine,
      dept:    pm.dept,
      estHours: pm.defaultHours||"5",
      title:   `${pm.machine} — ${pm.type} PM`,
    }));
  };

  return (
    <Modal title={isNew?"Add Task":"Edit Task"} onClose={onClose} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Title / Description" col="1 / -1">
          <Textarea value={form.title} onChange={f("title")} rows={2}/>
        </Field>
        <Field label="Type">
          <Sel value={form.type} onChange={e=>{
            setForm(p=>({...p,type:e.target.value,pmId:"",machine:""}));
          }}>
            {["Project","PM","Compliance","Repair"].map(t=><option key={t}>{t}</option>)}
          </Sel>
        </Field>
        {!isNew && (
          <Field label="Status">
            <Sel value={form.status} onChange={f("status")}>
              {["Inbox","Queue","Projects Register","Repair Register","Compliance Register","Scheduled","Complete"].map(s=><option key={s}>{s}</option>)}
            </Sel>
          </Field>
        )}
        <Field label={`Priority — ${form.priority} · ${PRIORITY_LABEL(+form.priority)}`} col="1 / -1">
          <input type="range" min={1} max={10} value={form.priority}
            onChange={e=>setForm(p=>({...p,priority:+e.target.value}))}
            style={{width:"100%",accentColor:PRIORITY_COLOR(+form.priority)}}/>
        </Field>
        {form.type==="PM" ? (
          <Field label="Machine (from PM Register)" col="1 / -1">
            <Sel value={form.pmId||""} onChange={e=>onPMSelect(e.target.value)}>
              <option value="">— Select machine —</option>
              {(pmItems||[]).map(p=>(
                <option key={p.id} value={p.id}>{p.machine} ({p.dept})</option>
              ))}
            </Sel>
          </Field>
        ) : (
          <>
            <Field label="Department">
              <Sel value={form.dept} onChange={e=>setForm(p=>({...p,dept:e.target.value,assignee:""}))}>
                {allDepts.map(d=><option key={d}>{d}</option>)}
              </Sel>
            </Field>
            <Field label="Machine Center">
              <Input value={form.machine} onChange={f("machine")}/>
            </Field>
          </>
        )}
        {form.type==="Compliance" && (
          <Field label="Source">
            <Sel value={form.source||""} onChange={f("source")}>
              <option value="">— Select —</option>
              <option>OSHA</option><option>Hanover</option><option>Other</option>
            </Sel>
          </Field>
        )}
        <Field label="Est. Total Hours">
          <Input type="number" value={form.estHours} onChange={f("estHours")} placeholder="0"/>
        </Field>
        {!isNew && form.status==="Scheduled" && (
          <Field label="Assigned To">
            <Sel value={form.assignee} onChange={f("assignee")}>
              <option value="">Unassigned</option>
              {deptPeople.map(p=><option key={p.name}>{p.name}</option>)}
            </Sel>
          </Field>
        )}
        <Field label="Notes" col="1 / -1">
          <Textarea value={form.notes} onChange={f("notes")} rows={2}/>
        </Field>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={()=>{
          if(form.type==="PM" && !form.pmId) {
            alert("Please select a machine from the PM Register before saving.");
            return;
          }
          onSave({...form,priority:+form.priority});
        }}>          {isNew?"Add Task":"Save Changes"}
        </Btn>
      </div>
    </Modal>
  );
}

// ─── SCHEDULE MODAL ───────────────────────────────────────────────────────────
function ScheduleModal({task, settings, onSave, onClose}) {
  const [weekOf,  setWeekOf]  = useState(task?.weekOf || nextMonday());
  const [assignee,setAssignee]= useState(task?.assignee||"");
  const team = settings?.team||DEFAULT_SETTINGS.team;
  const allPeople = Object.entries(team).flatMap(([dept,ms])=>ms.map(m=>({...m,dept})));

  return (
    <Modal title={`Schedule — ${task?.title?.slice(0,40)||"Task"}`} onClose={onClose}>
      <Field label="Assign To">
        <Sel value={assignee} onChange={e=>setAssignee(e.target.value)}>
          <option value="">— Select person —</option>
          {allPeople.map(p=><option key={p.name} value={p.name}>{p.name} ({p.dept})</option>)}
        </Sel>
      </Field>
      <Field label="Week Of">
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Btn variant="secondary" onClick={()=>setWeekOf(monStart(addDays(weekOf,-7)))}
            style={{padding:"5px 10px"}}>←</Btn>
          <div style={{flex:1,background:B.surface2,border:`1px solid ${B.border}`,borderRadius:4,
            padding:"7px 12px",fontSize:13,textAlign:"center",...sf}}>
            {fmtWeek(weekOf)}
          </div>
          <Btn variant="secondary" onClick={()=>setWeekOf(monStart(addDays(weekOf,7)))}
            style={{padding:"5px 10px"}}>→</Btn>
        </div>
      </Field>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!assignee} onClick={()=>onSave({
          ...task, status:"Scheduled", assignee, weekOf,
          scheduledBy: currentUser(),
        })}>Schedule</Btn>
      </div>
    </Modal>
  );
}

// ─── TASK CARD ────────────────────────────────────────────────────────────────
function TaskCard({task, actions}) {
  return (
    <div style={{background:"#fff",border:`1px solid ${B.border}`,borderRadius:5,
      padding:"12px 14px",marginBottom:8,borderLeft:`3px solid ${TYPE_COLOR[task.type]||B.muted}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
            <Badge color={TYPE_COLOR[task.type]||B.muted}>{task.type}</Badge>
            <Badge color={PRIORITY_COLOR(+task.priority||5)}>P{task.priority} · {PRIORITY_LABEL(+task.priority||5)}</Badge>
            {task.dept && <Badge color={B.textDim}>{task.dept}</Badge>}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"baseline",marginBottom:4,minWidth:0}}>
            {task.id && task.type!=="PM" && <span style={{color:B.rust,fontSize:13,fontWeight:800,flexShrink:0,...sf}}>{task.id}</span>}
            <span style={{color:B.text,fontSize:13,fontWeight:600,...sf,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{task.title}</span>
          </div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:B.muted,...sf}}>
            {task.machine    && <span>⚙ {task.machine}</span>}
            {task.estHours   && <span>⏱ {task.estHours}h est.</span>}
            {task.addedBy    && <span>Added by {task.addedBy}</span>}
            {task.status==="Scheduled" && task.assignee   && <span>👤 {task.assignee}</span>}
            {task.status==="Complete"  && task.completedBy && <span>✓ {task.completedBy}</span>}
            {task.status==="Complete"  && task.assignee && !task.completedBy && <span>👤 {task.assignee}</span>}
            {task.status==="Complete"  && task.completedAt && <span>📅 {fmtDate(task.completedAt.slice(0,10))}</span>}
          </div>
        </div>
        {actions && <div style={{display:"flex",gap:4,flexShrink:0,flexWrap:"wrap"}}>{actions}</div>}
      </div>
    </div>
  );
}

// ─── INBOX VIEW ───────────────────────────────────────────────────────────────
function InboxView({tasks, setTasks, settings, onEdit}) {
  const inbox = tasks.filter(t=>t.status==="Inbox");
  const move  = (id,status) => setTasks(ts=>ts.map(t=>t.id===id?{...t,status}:t));
  const del   = (id) => { if(window.confirm("Delete this task?")) {
    setTasks(ts=>ts.filter(t=>t.id!==id));
  }};

  return (
    <div>
      <div style={{marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Inbox</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{inbox.length} item{inbox.length!==1?"s":""} waiting to be triaged</div>
        </div>
        {inbox.length>0 && <span style={{background:B.brick,color:"#fff",borderRadius:12,
          padding:"2px 10px",fontSize:12,fontWeight:700,...sf}}>{inbox.length} unreviewed</span>}
      </div>
      {inbox.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf}}>
            Inbox is empty. Add tasks with + Add Task.
          </div>
        : inbox.map(t=>(
          <TaskCard key={t.id} task={t} actions={<>
            <Btn style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Queue")}>→ Queue</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Projects Register")}>→ Projects</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Repair Register")}>→ Repairs</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Compliance Register")}>→ Compliance</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Complete")}>✓ Done</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>onEdit(t)}>Edit</Btn>
            <Btn variant="danger" style={{padding:"3px 10px",fontSize:11}} onClick={()=>del(t.id)}>🗑</Btn>
          </>}/>
        ))
      }
    </div>
  );
}

// ─── QUEUE VIEW ───────────────────────────────────────────────────────────────
function QueueView({tasks, setTasks, settings, onEdit, onSchedule}) {
  const [filterType,  setFilterType]  = useState("All");
  const [filterDept,  setFilterDept]  = useState("All");
  const [filterPri,   setFilterPri]   = useState("All");

  const queue = tasks.filter(t=>t.status==="Queue");
  const filtered = queue.filter(t=>
    (filterType==="All"||t.type===filterType) &&
    (filterDept==="All"||t.dept===filterDept) &&
    (filterPri==="All"||(filterPri==="Critical"&&+t.priority>=9)||(filterPri==="High"&&+t.priority>=7&&+t.priority<9)||(filterPri==="Medium"&&+t.priority>=5&&+t.priority<7))
  ).sort((a,b)=>(+b.priority||5)-(+a.priority||5));

  const move = (id,status) => setTasks(ts=>ts.map(t=>t.id===id?{...t,status}:t));
  const del  = (id) => { if(window.confirm("Delete this task?")) {
    setTasks(ts=>ts.filter(t=>t.id!==id));
  }};

  const filterBtn = (val,cur,set,label) => (
    <button onClick={()=>set(v=>v===val?"All":val)}
      style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
        border:`1px solid ${cur===val?B.orange:B.border}`,
        background:cur===val?B.orange+"22":"transparent",
        color:cur===val?B.orange:B.textDim,...sf}}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Queue</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{filtered.length} of {queue.length} items</div>
        </div>
      </div>
      <div style={{marginBottom:12,display:"flex",gap:6,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:B.muted,alignSelf:"center",...sf}}>TYPE</span>
        {["Project","PM","Compliance","Repair"].map(t=>filterBtn(t,filterType,setFilterType,t))}
        <span style={{fontSize:11,color:B.muted,alignSelf:"center",marginLeft:8,...sf}}>PRI</span>
        {["Critical","High","Medium"].map(p=>filterBtn(p,filterPri,setFilterPri,p))}
        <span style={{fontSize:11,color:B.muted,alignSelf:"center",marginLeft:8,...sf}}>DEPT</span>
        {Object.keys(settings?.team||DEFAULT_SETTINGS.team).map(d=>filterBtn(d,filterDept,setFilterDept,d))}
      </div>
      {filtered.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf}}>
            No items in Queue. Pull from registers or Inbox.
          </div>
        : filtered.map(t=>(
          <TaskCard key={t.id} task={t} actions={<>
            <Btn style={{padding:"3px 10px",fontSize:11}} onClick={()=>onSchedule(t)}>→ Schedule</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>onEdit(t)}>Edit</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Inbox")}>↩</Btn>
            <Btn variant="danger" style={{padding:"3px 10px",fontSize:11}} onClick={()=>del(t.id)}>🗑</Btn>
          </>}/>
        ))
      }
    </div>
  );
}

// ─── SCHEDULE VIEW ────────────────────────────────────────────────────────────
function ScheduleView({tasks, setTasks, pmItems, setPMItems, settings, selectedWeek, setSelectedWeek, onEdit, onReschedule}) {
  const team = settings?.team||DEFAULT_SETTINGS.team;
  const codeRedThreshold = +(settings?.escalation?.threshold) || 4;

  const weekTasks = tasks.filter(t=>t.status==="Scheduled" && t.weekOf===selectedWeek);
  const codeRedTasks = tasks.filter(t=>t.status==="Scheduled" && (+t.rescheduleCount||0)>=codeRedThreshold);

  const markDone = (id) => {
    const task = tasks.find(t=>t.id===id);
    if(!task) return;
    const completed = {...task, status:"Complete",
      completedBy: task.assignee||currentUser(),
      completedAt: new Date().toISOString()};
    setTasks(ts=>ts.map(t=>t.id===id?completed:t), completed);
    // If PM task, update lastDone in register with flexible machine matching
    if(task.type==="PM" && task.machine) {
      const match = (pmItems||[]).find(p=>p.machine===task.machine ||
        (p.dept===task.dept && (
          p.machine.toLowerCase().includes((task.machine||"").toLowerCase()) ||
          (task.machine||"").toLowerCase().includes(p.machine.toLowerCase())
        )));
      if(match) {
        const updatedPM = {...match, lastDone:todayStr()};
        setPMItems(pms=>pms.map(p=>p.id===match.id?updatedPM:p), updatedPM);
      }
    }
  };
  const cycleProgress = (id) => {
    const task = tasks.find(t=>t.id===id);
    if(!task) return;
    const updated = {...task, progressStatus: nextProgressStatus(task.progressStatus||"On Track")};
    setTasks(ts=>ts.map(t=>t.id===id?updated:t), updated);
  };
  const returnToQueue = (id) => setTasks(ts=>ts.map(t=>t.id===id
    ?{...t,status:"Queue",assignee:"",weekOf:"",weeklyHours:""}:t));

  const deptSummary = (dept) => {
    const members = team[dept]||[];
    const cap = members.reduce((s,m)=>s+(+m.hours||40),0);
    const sched = weekTasks.filter(t=>members.some(m=>m.name===t.assignee))
      .reduce((s,t)=>s+(+t.estHours||0),0);
    return {cap,sched,bal:cap-sched};
  };

  const printSchedule = () => {
    const esc = (s) => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const deptSections = Object.entries(team).map(([dept,members])=>{
      const memberBlocks = members.map(member=>{
        const myTasks = weekTasks.filter(t=>t.assignee===member.name)
          .sort((a,b)=>(+b.priority||5)-(+a.priority||5));
        const myHrs = myTasks.reduce((s,t)=>s+(+t.estHours||0),0);
        const rows = myTasks.length===0
          ? `<tr><td colspan="6" class="empty">No tasks scheduled</td></tr>`
          : myTasks.map(t=>`
            <tr>
              <td class="chk">☐</td>
              <td class="id">${esc(t.id)}</td>
              <td>${esc(t.title)}${t.machine?`<div class="machine">⚙ ${esc(t.machine)}</div>`:""}</td>
              <td class="type">${esc(t.type)}</td>
              <td class="pri">P${esc(t.priority||5)} · ${esc(PRIORITY_LABEL(+t.priority||5))}</td>
              <td class="hrs">${esc(t.estHours||0)}h</td>
            </tr>`).join("");
        return `
          <div class="member">
            <div class="member-head"><strong>${esc(member.name)}</strong><span>${myHrs}h / ${esc(member.hours)}h</span></div>
            <table><thead><tr><th></th><th>#</th><th>Task</th><th>Type</th><th>Priority</th><th>Est.</th></tr></thead>
            <tbody>${rows}</tbody></table>
          </div>`;
      }).join("");
      return `<div class="dept"><h2>${esc(dept)}</h2>${memberBlocks}</div>`;
    }).join("");

    const w = window.open("", "_blank", "width=900,height=700");
    if(!w) { alert("Pop-up blocked — allow pop-ups for this site to print."); return; }
    w.document.write(`<!doctype html><html><head><title>Weekly Schedule — ${esc(fmtWeek(selectedWeek))}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
        .head{display:flex;justify-content:space-between;align-items:baseline;
          border-bottom:3px solid #AD4C25;padding-bottom:8px;margin-bottom:16px}
        .head h1{margin:0;font-size:18px}
        .head .brand{font-weight:900;letter-spacing:2px;color:#AD4C25;font-size:13px}
        .dept{margin-bottom:20px;page-break-inside:avoid}
        .dept h2{font-size:14px;background:#eee;padding:6px 10px;margin:0 0 8px;border-left:4px solid #EE7425}
        .member{margin:0 0 12px 10px;page-break-inside:avoid}
        .member-head{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
        table{width:100%;border-collapse:collapse}
        th{font-size:9px;text-transform:uppercase;letter-spacing:.5px;text-align:left;
          border-bottom:1px solid #999;padding:3px 6px;color:#555}
        td{border-bottom:1px solid #ddd;padding:5px 6px;vertical-align:top}
        td.chk{width:20px;font-size:14px}
        td.id{width:36px;font-weight:700;color:#AD4C25;white-space:nowrap}
        td.type{width:70px}
        td.pri{width:90px;white-space:nowrap}
        td.hrs{width:40px;text-align:right;white-space:nowrap}
        td.empty{color:#999;font-style:italic}
        .machine{color:#666;font-size:10px;margin-top:2px}
        .foot{margin-top:20px;color:#888;font-size:10px;text-align:right}
        @media print{ .noprint{display:none} }
      </style></head><body>
      <div class="head">
        <div><div class="brand">SEQUOIA FOREST PRODUCTS</div><h1>Weekly Maintenance Schedule</h1></div>
        <div style="font-size:14px;font-weight:700">${esc(fmtWeek(selectedWeek))}</div>
      </div>
      ${deptSections}
      <div class="foot">Printed ${new Date().toLocaleString("en-US")} · Sequoia Maintenance System</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(()=>w.print(), 250);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Weekly Schedule</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{fmtWeek(selectedWeek)}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Btn variant="secondary" onClick={()=>setSelectedWeek(monStart(addDays(selectedWeek,-7)))}>← Prev</Btn>
          <Btn variant="secondary" onClick={()=>setSelectedWeek(monStart(todayStr()))}>This Week</Btn>
          <Btn variant="secondary" onClick={()=>setSelectedWeek(monStart(addDays(selectedWeek,7)))}>Next →</Btn>
          <Btn variant="teal" onClick={printSchedule}>🖨 Print / PDF</Btn>
        </div>
      </div>

      {codeRedTasks.length>0 && (
        <div style={{background:B.brick+"15",border:`1px solid ${B.brick}55`,borderRadius:6,
          padding:"12px 16px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:16}}>🔴</span>
            <span style={{fontWeight:800,fontSize:13,color:B.brick,...sf}}>
              Code Red — {codeRedTasks.length} task{codeRedTasks.length!==1?"s":""} rescheduled {codeRedThreshold}+ times
            </span>
          </div>
          {codeRedTasks.map(t=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"6px 10px",background:"#fff",borderRadius:4,marginBottom:4,fontSize:12,...sf}}>
              <span style={{color:B.text,fontWeight:600}}>#{t.id} · {t.title}</span>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{color:B.brick,fontWeight:700}}>Rescheduled {t.rescheduleCount}×</span>
                <Btn variant="secondary" style={{padding:"3px 8px",fontSize:10}}
                  onClick={()=>setSelectedWeek(t.weekOf)}>View week</Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {Object.entries(team).map(([dept,members])=>{
        const {cap,sched,bal} = deptSummary(dept);
        const pct = cap>0?Math.round(sched/cap*100):0;
        // FIX #5: show target line at 60%
        const targetPct = 60;
        return (
          <div key={dept} style={{marginBottom:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"8px 12px",background:B.surface2,borderRadius:"5px 5px 0 0",
              border:`1px solid ${B.border}`,borderBottom:"none"}}>
              <span style={{fontWeight:700,fontSize:13,color:B.text,...sf}}>{dept}</span>
              <div style={{display:"flex",gap:16,fontSize:12,...sf}}>
                <span style={{color:B.muted}}>CAPACITY <strong style={{color:B.text}}>{cap}h</strong></span>
                <span style={{color:B.muted}}>SCHEDULED <strong style={{color:pct>100?B.brick:pct>80?B.gold:B.orange}}>{sched}h</strong></span>
                <span style={{color:B.muted}}>BALANCE <strong style={{color:bal<0?B.brick:B.teal}}>+{bal}h</strong></span>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",
              gap:12,padding:12,border:`1px solid ${B.border}`,borderTop:"none",borderRadius:"0 0 5px 5px"}}>
              {members.map(member=>{
                const myTasks = weekTasks.filter(t=>t.assignee===member.name)
                  .sort((a,b)=>(+b.priority||5)-(+a.priority||5));
                const myHrs = myTasks.reduce((s,t)=>s+(+t.estHours||0),0);
                const myPct = member.hours>0?Math.round(myHrs/member.hours*100):0;
                const barColor = myPct>100?B.brick:myPct>80?B.gold:B.orange;
                return (
                  <div key={member.name} style={{background:"#fff",border:`1px solid ${B.border}`,
                    borderRadius:5,padding:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:B.text,...sf}}>{member.name}</div>
                        <div style={{fontSize:11,color:B.muted,...sf}}>{dept}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:13,fontWeight:700,color:B.text,...sf}}>{myHrs}h / {member.hours}h</div>
                        <div style={{fontSize:11,color:B.muted,...sf}}>{myPct}% capacity</div>
                      </div>
                    </div>
                    {/* Capacity bar with 60% target line */}
                    <div style={{position:"relative",height:8,background:B.surface2,borderRadius:4,marginBottom:8}}>
                      <div style={{height:"100%",width:`${Math.min(myPct,100)}%`,background:barColor,borderRadius:4,transition:"width .3s"}}/>
                      {/* 60% target marker */}
                      <div style={{position:"absolute",top:-2,left:"60%",width:2,height:12,
                        background:B.textDim,borderRadius:1,opacity:0.5}}/>
                      <div style={{position:"absolute",top:-14,left:"58%",fontSize:9,color:B.muted,...sf}}>60%</div>
                    </div>
                    {myTasks.length===0
                      ? <div style={{color:B.muted,fontSize:12,fontStyle:"italic",...sf}}>No tasks scheduled</div>
                      : myTasks.map(t=>{
                        const progress = t.progressStatus||"On Track";
                        const isCodeRed = (+t.rescheduleCount||0)>=codeRedThreshold;
                        return (
                        <div key={t.id} style={{borderTop:`1px solid ${B.border}`,paddingTop:8,marginTop:8}}>
                          <div style={{display:"flex",gap:4,marginBottom:4,alignItems:"center",flexWrap:"wrap"}}>
                            <Badge color={TYPE_COLOR[t.type]||B.muted}>{t.type}</Badge>
                            <Badge color={PRIORITY_COLOR(+t.priority||5)}>P{t.priority||5} · {PRIORITY_LABEL(+t.priority||5)}</Badge>
                            <span style={{fontSize:10,color:B.muted,...sf}}>#{t.id}</span>
                            {isCodeRed && <Badge color={B.brick}>🔴 Code Red</Badge>}
                            <button onClick={()=>cycleProgress(t.id)} title="Click to cycle status"
                              style={{marginLeft:"auto",cursor:"pointer",border:`1px solid ${PROGRESS_COLOR[progress]}66`,
                                background:PROGRESS_COLOR[progress]+"22",color:PROGRESS_COLOR[progress],
                                borderRadius:3,padding:"2px 8px",fontSize:10,fontWeight:700,...sf}}>
                              ● {progress}
                            </button>
                          </div>
                          <div style={{fontSize:12,color:B.text,fontWeight:600,marginBottom:4,...sf}}>{t.title}</div>
                          <div style={{fontSize:11,color:B.muted,marginBottom:6,...sf}}>
                            {t.estHours||0}h est.
                          </div>
                          {(t.originalScheduledDate || +t.rescheduleCount>0) && (
                            <div style={{fontSize:10,color:B.muted,marginBottom:6,...sf}}>
                              {t.originalScheduledDate && <>First scheduled {fmtDate(t.originalScheduledDate)}</>}
                              {t.originalScheduledDate && +t.rescheduleCount>0 && " · "}
                              {+t.rescheduleCount>0 && <>Rescheduled {t.rescheduleCount}×</>}
                            </div>
                          )}
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            <Btn style={{padding:"3px 8px",fontSize:10}} onClick={()=>markDone(t.id)}>✓ Done</Btn>
                            <Btn variant="secondary" style={{padding:"3px 8px",fontSize:10}} onClick={()=>onEdit(t)}>Edit</Btn>
                            {onReschedule && <Btn variant="secondary" style={{padding:"3px 8px",fontSize:10}} onClick={()=>onReschedule(t)}>Reschedule</Btn>}
                            <Btn variant="secondary" style={{padding:"3px 8px",fontSize:10}} onClick={()=>returnToQueue(t.id)}>↩</Btn>
                          </div>
                        </div>
                      );})
                    }
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {weekTasks.length===0 && (
        <div style={{textAlign:"center",padding:"32px",background:"#fff",
          border:`1px solid ${B.border}`,borderRadius:5,color:B.muted,fontSize:14,...sf}}>
          Nothing scheduled for this week yet. Pull tasks from the Queue.
        </div>
      )}
    </div>
  );
}

// ─── PROJECTS REGISTER ────────────────────────────────────────────────────────
function ProjectsRegisterView({tasks, setTasks, settings, onEdit}) {
  const [filterDept, setFilterDept] = useState("All");
  const [filterPri,  setFilterPri]  = useState("All");
  const [sortBy,     setSortBy]     = useState("priority");
  const [sortDir,    setSortDir]    = useState("desc");

  const toggle = (col) => {
    if(sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortBy(col); setSortDir(col==="id"?"asc":"desc"); }
  };

  const sorters = {
    priority: (a,b) => (+b.priority||5)-(+a.priority||5),
    id:       (a,b) => (a.id||"").localeCompare(b.id||"", undefined, {numeric:true}),
    title:    (a,b) => (a.title||"").localeCompare(b.title||""),
    hours:    (a,b) => (+b.estHours||0)-(+a.estHours||0),
    dept:     (a,b) => (a.dept||"").localeCompare(b.dept||""),
    machine:  (a,b) => (a.machine||"").localeCompare(b.machine||""),
  };

  const priMatch = (t) => {
    const p = +t.priority||5;
    if(filterPri==="All") return true;
    if(filterPri==="Critical") return p>=9;
    if(filterPri==="High")     return p>=7 && p<9;
    if(filterPri==="Medium")   return p>=5 && p<7;
    if(filterPri==="Low")      return p>=3 && p<5;
    if(filterPri==="Someday")  return p<3;
    return true;
  };

  const items = tasks
    .filter(t=>t.status==="Projects Register"||t.status==="Register")
    .filter(t=>filterDept==="All"||t.dept===filterDept)
    .filter(priMatch)
    .sort((a,b)=>sortDir==="asc"?-sorters[sortBy](a,b):sorters[sortBy](a,b));

  const move = (id,status) => setTasks(ts=>ts.map(t=>t.id===id?{...t,status}:t));
  const depts = Object.keys(settings?.team||DEFAULT_SETTINGS.team);

  const SortBtn = ({col,label}) => (
    <button onClick={()=>toggle(col)}
      style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
        border:`1px solid ${sortBy===col?B.teal:B.border}`,
        background:sortBy===col?B.teal+"22":"transparent",
        color:sortBy===col?B.teal:B.textDim,...sf}}>
      {label} {sortBy===col?(sortDir==="asc"?"↑":"↓"):""}
    </button>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Projects Register</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{items.length} projects in backlog</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {["All","Millwright","Electrical"].map(d=>(
            <button key={d} onClick={()=>setFilterDept(d)}
              style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
                border:`1px solid ${filterDept===d?B.orange:B.border}`,
                background:filterDept===d?B.orange+"22":"transparent",
                color:filterDept===d?B.orange:B.textDim,...sf}}>{d}</button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:B.muted,...sf}}>PRIORITY</span>
        {["Critical","High","Medium","Low","Someday"].map(p=>(
          <button key={p} onClick={()=>setFilterPri(v=>v===p?"All":p)}
            style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`1px solid ${filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1):B.border}`,
              background:filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1)+"22":"transparent",
              color:filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1):B.textDim,...sf}}>{p}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:B.muted,...sf}}>SORT</span>
        <SortBtn col="priority" label="Priority"/>
        <SortBtn col="id"       label="Number"/>
        <SortBtn col="title"    label="Title"/>
        <SortBtn col="hours"    label="Hours"/>
        <SortBtn col="dept"     label="Dept"/>
        <SortBtn col="machine"  label="Machine"/>
      </div>
      {items.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf}}>No projects in register.</div>
        : items.map(t=>(
          <TaskCard key={t.id} task={t} actions={<>
            <Btn style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Queue")}>→ Queue</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>onEdit(t)}>Edit</Btn>
          </>}/>
        ))
      }
    </div>
  );
}

// ─── REPAIR REGISTER ─────────────────────────────────────────────────────────
function RepairsView({tasks, setTasks, onEdit}) {
  const [sortBy,     setSortBy]     = useState("priority");
  const [sortDir,    setSortDir]    = useState("desc");
  const [filterDept, setFilterDept] = useState("All");
  const [filterPri,  setFilterPri]  = useState("All");

  const toggle = (col) => {
    if(sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortBy(col); setSortDir("desc"); }
  };
  const sorters = {
    priority: (a,b)=>(+b.priority||5)-(+a.priority||5),
    id:       (a,b)=>(a.id||"").localeCompare(b.id||"",undefined,{numeric:true}),
    title:    (a,b)=>(a.title||"").localeCompare(b.title||""),
    hours:    (a,b)=>(+b.estHours||0)-(+a.estHours||0),
    machine:  (a,b)=>(a.machine||"").localeCompare(b.machine||""),
  };
  const depts = ["Millwright","Electrical"];
  const priMatchR = (t) => {
    const p = +t.priority||5;
    if(filterPri==="All") return true;
    if(filterPri==="Critical") return p>=9;
    if(filterPri==="High")     return p>=7 && p<9;
    if(filterPri==="Medium")   return p>=5 && p<7;
    if(filterPri==="Low")      return p>=3 && p<5;
    if(filterPri==="Someday")  return p<3;
    return true;
  };
  const items = tasks.filter(t=>t.status==="Repair Register")
    .filter(t=>filterDept==="All"||t.dept===filterDept)
    .filter(priMatchR)
    .sort((a,b)=>sortDir==="asc"?-sorters[sortBy](a,b):sorters[sortBy](a,b));
  const move = (id,status) => setTasks(ts=>ts.map(t=>t.id===id?{...t,status}:t));

  const SortBtn = ({col,label}) => (
    <button onClick={()=>toggle(col)}
      style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
        border:`1px solid ${sortBy===col?B.teal:B.border}`,
        background:sortBy===col?B.teal+"22":"transparent",
        color:sortBy===col?B.teal:B.textDim,...sf}}>
      {label}{sortBy===col?(sortDir==="asc"?" ↑":" ↓"):""}
    </button>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Repair Register</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{items.length} repairs in backlog</div>
        </div>
        {depts.length>0 && <div style={{display:"flex",gap:6}}>
          {["All",...depts].map(d=>(
            <button key={d} onClick={()=>setFilterDept(d)}
              style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
                border:`1px solid ${filterDept===d?B.gold:B.border}`,
                background:filterDept===d?B.gold+"22":"transparent",
                color:filterDept===d?B.gold:B.textDim,...sf}}>{d}</button>
          ))}
        </div>}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:B.muted,...sf}}>PRIORITY</span>
        {["Critical","High","Medium","Low","Someday"].map(p=>(
          <button key={p} onClick={()=>setFilterPri(v=>v===p?"All":p)}
            style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`1px solid ${filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1):B.border}`,
              background:filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1)+"22":"transparent",
              color:filterPri===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:p==="Low"?3:1):B.textDim,...sf}}>{p}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
        <span style={{fontSize:11,color:B.muted,...sf}}>SORT</span>
        <SortBtn col="priority" label="Priority"/>
        <SortBtn col="id"       label="Number"/>
        <SortBtn col="title"    label="Title"/>
        <SortBtn col="hours"    label="Hours"/>
        <SortBtn col="machine"  label="Machine"/>
      </div>
      {items.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf}}>No repairs logged.</div>
        : items.map(t=>(
          <TaskCard key={t.id} task={t} actions={<>
            <Btn style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Queue")}>→ Queue</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>onEdit(t)}>Edit</Btn>
          </>}/>
        ))
      }
    </div>
  );
}

// ─── COMPLIANCE REGISTER ─────────────────────────────────────────────────────
function ComplianceView({tasks, setTasks, onEdit}) {
  const [filterSource, setFilterSource] = useState("All");
  const [filterDept,   setFilterDept]   = useState("All");
  const [filterPriC,   setFilterPriC]   = useState("All");
  const [sortBy,       setSortBy]       = useState("priority");
  const [sortDir,      setSortDir]      = useState("desc");

  const toggleSort = (col) => {
    if(sortBy===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortBy(col); setSortDir("desc"); }
  };
  const sorters = {
    priority: (a,b)=>(+b.priority||5)-(+a.priority||5),
    id:       (a,b)=>(a.id||"").localeCompare(b.id||"",undefined,{numeric:true}),
    title:    (a,b)=>(a.title||"").localeCompare(b.title||""),
    source:   (a,b)=>(a.source||"").localeCompare(b.source||""),
  };

  const items = tasks.filter(t=>t.status==="Compliance Register")
    .filter(t=>filterSource==="All"||(t.source||"Other").toLowerCase()===(filterSource).toLowerCase())
    .filter(t=>filterDept==="All"||t.dept===filterDept)
    .filter(t=>{
      const p=+t.priority||5;
      if(filterPriC==="All") return true;
      if(filterPriC==="Critical") return p>=9;
      if(filterPriC==="High")     return p>=7&&p<9;
      if(filterPriC==="Medium")   return p>=5&&p<7;
      if(filterPriC==="Low")      return p<5;
      return true;
    })
    .sort((a,b)=>sortDir==="asc"?-sorters[sortBy](a,b):sorters[sortBy](a,b));

  const move = (id,status) => setTasks(ts=>ts.map(t=>t.id===id?{...t,status}:t));

  const complianceTasks = tasks.filter(t=>t.type==="Compliance");
  const daysAgo = (n) => { const d=new Date(); d.setDate(d.getDate()-n); return d; };
  const completedSince = (n) => complianceTasks.filter(t=>
    t.status==="Complete" && t.completedAt && new Date(t.completedAt)>=daysAgo(n)).length;
  const tiles = [
    {label:"Outstanding",              value:tasks.filter(t=>t.status==="Compliance Register").length, color:B.brick},
    {label:"Completed Last 7 Days",    value:completedSince(7),  color:B.teal},
    {label:"Completed Last 30 Days",   value:completedSince(30), color:B.teal},
    {label:"Total Remaining",          value:complianceTasks.filter(t=>t.status!=="Complete").length, color:B.rust},
  ];

  const fBtn = (val,cur,set,color=B.brick) => (
    <button onClick={()=>set(v=>v===val?"All":val)}
      style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
        border:`1px solid ${cur===val?color:B.border}`,
        background:cur===val?color+"22":"transparent",
        color:cur===val?color:B.textDim,...sf}}>{val}</button>
  );
  const SortBtn = ({col,label}) => (
    <button onClick={()=>toggleSort(col)}
      style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
        border:`1px solid ${sortBy===col?B.teal:B.border}`,
        background:sortBy===col?B.teal+"22":"transparent",
        color:sortBy===col?B.teal:B.textDim,...sf}}>
      {label}{sortBy===col?(sortDir==="asc"?" ↑":" ↓"):""}
    </button>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>Compliance Register</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{items.length} open items</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",
        gap:10,marginBottom:16}}>
        {tiles.map(({label,value,color})=>(
          <div key={label} style={{background:"#fff",border:`1px solid ${B.border}`,
            borderLeft:`3px solid ${color}`,borderRadius:5,padding:"10px 14px"}}>
            <div style={{fontSize:10,color:B.muted,textTransform:"uppercase",letterSpacing:1,
              marginBottom:4,...sf}}>{label}</div>
            <div style={{fontSize:22,fontWeight:800,color,...sf}}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{background:B.surface2,border:`1px solid ${B.border}`,borderRadius:5,
        padding:12,marginBottom:12}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,
              color:B.muted,marginBottom:6,...sf}}>SOURCE</div>
            <div style={{display:"flex",gap:6}}>
              {["OSHA","Hanover","Other"].map(s=>fBtn(s,filterSource,setFilterSource,B.brick))}
            </div>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,
              color:B.muted,marginBottom:6,...sf}}>DEPARTMENT</div>
            <div style={{display:"flex",gap:6}}>
              {["Millwright","Electrical"].map(d=>fBtn(d,filterDept,setFilterDept,B.rust))}
            </div>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,
              color:B.muted,marginBottom:6,...sf}}>PRIORITY</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {["Critical","High","Medium","Low"].map(p=>(
                <button key={p} onClick={()=>setFilterPriC(v=>v===p?"All":p)}
                  style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
                    border:`1px solid ${filterPriC===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:3):B.border}`,
                    background:filterPriC===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:3)+"22":"transparent",
                    color:filterPriC===p?PRIORITY_COLOR(p==="Critical"?9:p==="High"?7:p==="Medium"?5:3):B.textDim,...sf}}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,
              color:B.muted,marginBottom:6,...sf}}>SORT</div>
            <div style={{display:"flex",gap:6}}>
              <SortBtn col="priority" label="Priority"/>
              <SortBtn col="id"       label="Number"/>
              <SortBtn col="title"    label="Title"/>
              <SortBtn col="source"   label="Source"/>
            </div>
          </div>
        </div>
      </div>
      {items.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf,
            background:"#fff",border:`1px solid ${B.border}`,borderRadius:5}}>
            No compliance items. Add from Inbox or + Add Task.
          </div>
        : items.map(t=>(
          <TaskCard key={t.id} task={t} actions={<>
            <Btn style={{padding:"3px 10px",fontSize:11}} onClick={()=>move(t.id,"Queue")}>→ Queue</Btn>
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>onEdit(t)}>Edit</Btn>
          </>}/>
        ))
      }
    </div>
  );
}

// ─── COMPLETED VIEW ───────────────────────────────────────────────────────────
function CompletedView({tasks, setTasks}) {
  const [filterType,setFilterType] = useState("All");
  // FIX #3: filter by who completed it
  const completed = tasks.filter(t=>t.status==="Complete");
  const types = ["Project","PM","Compliance","Repair"];
  const people = [...new Set(completed.map(t=>t.completedBy||t.assignee||"").filter(Boolean))];

  const [sortCompleted, setSortCompleted] = useState("date");
  const filtered = completed
    .filter(t=>filterType==="All"||t.type===filterType)
    .sort((a,b)=>{
      if(sortCompleted==="date") return new Date(b.completedAt||0)-new Date(a.completedAt||0);
      if(sortCompleted==="type") return (a.type||"").localeCompare(b.type||"");
      if(sortCompleted==="person") return (a.completedBy||a.assignee||"").localeCompare(b.completedBy||b.assignee||"");
      return 0;
    });

  const restore = (t) => {
    const status = t.type==="Compliance"?"Compliance Register"
      :t.type==="Repair"?"Repair Register"
      :(+t.priority||5)>=7?"Queue":"Projects Register";
    setTasks(ts=>ts.map(x=>x.id===t.id?{...x,status,completedBy:"",completedAt:""}:x));
  };

  return (
    <div>
      <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:700,color:B.text,...sf}}>Completed</h2>
      {/* Summary cards */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[{label:"All",count:completed.length,color:B.textDim},...types.map(ty=>({
          label:ty,count:completed.filter(t=>t.type===ty).length,color:TYPE_COLOR[ty]||B.muted
        }))].map(({label,count,color})=>(
          <button key={label} onClick={()=>setFilterType(label==="All"?"All":label)}
            style={{padding:"8px 14px",borderRadius:4,cursor:"pointer",fontWeight:700,
              fontSize:12,border:`1px solid ${filterType===label||(!filterType&&label==="All")?color:B.border}`,
              background:filterType===label?color+"22":"transparent",color,...sf}}>
            {label} · {count}
          </button>
        ))}
      </div>

      <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center"}}>
        <span style={{fontSize:11,color:B.muted,...sf}}>SORT</span>
        {[["date","Completed Date"],["type","Type"],["person","Person"]].map(([val,label])=>(
          <button key={val} onClick={()=>setSortCompleted(val)}
            style={{padding:"4px 10px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
              border:`1px solid ${sortCompleted===val?B.teal:B.border}`,
              background:sortCompleted===val?B.teal+"22":"transparent",
              color:sortCompleted===val?B.teal:B.textDim,...sf}}>{label}</button>
        ))}
      </div>
      {filtered.length===0
        ? <div style={{textAlign:"center",padding:"40px 0",color:B.muted,fontSize:14,...sf}}>No completed tasks yet.</div>
        : filtered.map(t=>(
          <TaskCard key={t.id} task={t} actions={
            <Btn variant="secondary" style={{padding:"3px 10px",fontSize:11}} onClick={()=>restore(t)}>↩ Restore</Btn>
          }/>
        ))
      }
    </div>
  );
}

// ─── PARTS MODAL ─────────────────────────────────────────────────────────────
function PartsModal({machine, parts, onSave, onClose}) {
  const [list,setList]     = useState(parts||[]);
  const [editing,setEditing] = useState(null);
  const [form,setForm]     = useState({name:"",partNo:"",description:"",vendor:""});
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const startNew  = () => { setForm({name:"",partNo:"",description:"",vendor:""}); setEditing("new"); };
  const startEdit = (p) => { setForm({...p}); setEditing(p.id); };
  const savePart = () => {
    if(!form.name.trim()) return;
    if(editing==="new") setList(l=>[...l,{...form,id:uid()}]);
    else setList(l=>l.map(p=>p.id===editing?{...form,id:editing}:p));
    setEditing(null);
  };
  const delPart = (id) => { if(window.confirm("Delete this part?")) setList(l=>l.filter(p=>p.id!==id)); };

  return (
    <Modal title={`Parts Library — ${machine}`} onClose={()=>onSave(list)} wide>
      {list.length>0 && (
        <div style={{overflowX:"auto",marginBottom:16}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:B.surface2}}>
                {["Part Name","Part #","Description","Vendor",""].map(h=>(
                  <th key={h} style={{padding:"7px 10px",color:B.textDim,fontWeight:700,
                    fontSize:10,textTransform:"uppercase",letterSpacing:0.5,
                    textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(p=>(
                <tr key={p.id} style={{borderBottom:`1px solid ${B.border}`}}>
                  <td style={{padding:"8px 10px",fontWeight:600,color:B.text,...sf}}>{p.name}</td>
                  <td style={{padding:"8px 10px",color:B.muted,fontFamily:"monospace",fontSize:11}}>{p.partNo}</td>
                  <td style={{padding:"8px 10px",color:B.muted,maxWidth:180}}>{p.description}</td>
                  <td style={{padding:"8px 10px",color:B.muted}}>{p.vendor}</td>
                  <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                    <button onClick={()=>startEdit(p)} style={{background:"none",border:"none",
                      color:B.orange,cursor:"pointer",fontSize:12,marginRight:8,...sf}}>Edit</button>
                    <button onClick={()=>delPart(p.id)} style={{background:"none",border:"none",
                      color:B.brick,cursor:"pointer",fontSize:12,...sf}}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length===0 && !editing && (
        <div style={{padding:"24px 0",textAlign:"center",color:B.muted,fontSize:13,...sf,marginBottom:16}}>
          No parts added yet for this machine.
        </div>
      )}
      {editing && (
        <div style={{background:B.surface2,border:`1px solid ${B.border}`,borderRadius:6,padding:16,marginBottom:16}}>
          <div style={{color:B.textDim,fontSize:11,fontWeight:700,textTransform:"uppercase",
            letterSpacing:1,marginBottom:12,...sf}}>{editing==="new"?"Add Part":"Edit Part"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Part Name"><Input value={form.name} onChange={f("name")} placeholder="e.g. Drive Belt"/></Field>
            <Field label="Part Number"><Input value={form.partNo} onChange={f("partNo")} placeholder="e.g. 6736-1042"/></Field>
            <Field label="Vendor"><Input value={form.vendor} onChange={f("vendor")} placeholder="e.g. Grainger"/></Field>
            <Field label="Description"><Input value={form.description} onChange={f("description")} placeholder="e.g. 3/8 x 42in V-belt"/></Field>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"flex-end"}}>
            <Btn variant="secondary" onClick={()=>setEditing(null)}>Cancel</Btn>
            <Btn onClick={savePart} disabled={!form.name.trim()}>{editing==="new"?"Add Part":"Save"}</Btn>
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        borderTop:`1px solid ${B.border}`,paddingTop:14}}>
        {!editing && <Btn onClick={startNew}>+ Add Part</Btn>}
        <Btn variant="secondary" onClick={()=>onSave(list)} style={{marginLeft:"auto"}}>Save & Close</Btn>
      </div>
    </Modal>
  );
}

// ─── PM FORM ──────────────────────────────────────────────────────────────────
function PMForm({item, onSave, onDelete, onClose}) {
  const blank = {machine:"",dept:"Millwright",type:"Mechanical",frequency:"Weekly",
    lastDone:"",defaultHours:"5",formUrl:""};
  const [form,setForm] = useState(item?{...item}:blank);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Field label="Machine Name" col="1 / -1">
        <Input value={form.machine} onChange={f("machine")} placeholder="e.g. Debarker"/>
      </Field>
      <Field label="Department">
        <Sel value={form.dept} onChange={f("dept")}>
          <option>Millwright</option><option>Electrical</option>
        </Sel>
      </Field>
      <Field label="PM Type">
        <Sel value={form.type} onChange={f("type")}>
          <option>Mechanical</option><option>Electrical</option><option>Lubrication</option>
        </Sel>
      </Field>
      <Field label="Frequency">
        <Sel value={form.frequency} onChange={f("frequency")}>
          {["Weekly","Biweekly","Monthly","Quarterly","Biannual","Annual"].map(f=><option key={f}>{f}</option>)}
        </Sel>
      </Field>
      <Field label="Default Hours">
        <Input type="number" value={form.defaultHours} onChange={f("defaultHours")} placeholder="5"/>
      </Field>
      <Field label="Last Done Date" col="1 / -1">
        <Input type="date" value={form.lastDone} onChange={f("lastDone")}/>
      </Field>
      <Field label="Work Order URL" col="1 / -1">
        <Input value={form.formUrl} onChange={f("formUrl")} placeholder="https://docs.google.com/..."/>
      </Field>
      <div style={{gridColumn:"1 / -1",display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
        {onDelete
          ? <Btn variant="danger" onClick={onDelete}>Delete Machine</Btn>
          : <div/>}
        <div style={{display:"flex",gap:8}}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={()=>onSave(form)} disabled={!form.machine.trim()}>
            {item?"Save Changes":"Add Machine"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── PM REGISTER VIEW ────────────────────────────────────────────────────────

// ─── PM HOURS CHART ───────────────────────────────────────────────────────────
function PMHoursChart({pmItems, onClose}) {
  const canvasRef = React.useRef(null);
  const chartRef  = React.useRef(null);

  function getWeeksForFreq(freq) {
    if(freq==="Weekly")    return Array.from({length:52},(_,i)=>i+1);
    if(freq==="Biweekly")  return Array.from({length:26},(_,i)=>i*2+1);
    if(freq==="Monthly")   return [1,5,9,14,18,22,27,31,35,40,44,48];
    if(freq==="Quarterly") return [1,14,27,40];
    if(freq==="Biannual")  return [1,27];
    if(freq==="Annual")    return [1];
    return [];
  }

  useEffect(()=>{
    if(!canvasRef.current) return;
    const mw = new Array(52).fill(0);
    const el = new Array(52).fill(0);
    pmItems.forEach(m=>{
      const hrs = +m.defaultHours||5;
      getWeeksForFreq(m.frequency).forEach(w=>{
        if(m.dept==="Electrical") el[w-1]+=hrs;
        else mw[w-1]+=hrs;
      });
    });
    const labels = Array.from({length:52},(_,i)=>`W${i+1}`);
    if(chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(canvasRef.current, {
      type:"bar",
      data:{labels, datasets:[
        {label:"Millwright", data:mw, backgroundColor:"#EE7425", stack:"s"},
        {label:"Electrical", data:el, backgroundColor:"#1baf7a", stack:"s"},
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{
            title:items=>`Week ${items[0].dataIndex+1}`,
            footer:items=>`Total: ${items.reduce((a,i)=>a+(i.raw||0),0)}h`
          }}
        },
        scales:{
          x:{stacked:true, grid:{display:false},
            ticks:{autoSkip:true,maxTicksLimit:13,color:"#898781",font:{size:10}}},
          y:{stacked:true, grid:{color:"#e1e0d9"},
            ticks:{color:"#898781",font:{size:11},callback:v=>v+"h"}}
        }
      }
    });
    return ()=>{ if(chartRef.current) chartRef.current.destroy(); };
  },[pmItems]);

  const total = new Array(52).fill(0);
  pmItems.forEach(m=>{
    const hrs = +m.defaultHours||5;
    getWeeksForFreq(m.frequency).forEach(w=>{ total[w-1]+=hrs; });
  });
  const maxH  = Math.max(...total);
  const minH  = Math.min(...total.filter(v=>v>0));
  const avgH  = Math.round(total.reduce((a,b)=>a+b,0)/52);
  const annH  = total.reduce((a,b)=>a+b,0);
  const peakWk= total.indexOf(maxH)+1;

  return (
    <Modal title="PM Hours by Week" onClose={onClose} wide>
      <div style={{marginBottom:12,display:"flex",gap:16,fontSize:12,color:B.muted,...sf}}>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{width:10,height:10,borderRadius:2,background:B.orange,display:"inline-block"}}/>Millwright
        </span>
        <span style={{display:"flex",alignItems:"center",gap:4}}>
          <span style={{width:10,height:10,borderRadius:2,background:"#1baf7a",display:"inline-block"}}/>Electrical
        </span>
      </div>
      <div style={{position:"relative",width:"100%",height:260,marginBottom:16}}>
        <canvas ref={canvasRef} role="img" aria-label="PM hours per week across 52 weeks"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {label:"Peak week",     value:`W${peakWk} — ${maxH}h`},
          {label:"Lightest week", value:`${minH}h`},
          {label:"Weekly avg",    value:`${avgH}h`},
          {label:"Annual total",  value:`${annH}h`},
        ].map(s=>(
          <div key={s.label} style={{background:B.surface2,border:`1px solid ${B.border}`,
            borderRadius:5,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:B.muted,textTransform:"uppercase",letterSpacing:1,
              marginBottom:4,...sf}}>{s.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:B.text,...sf}}>{s.value}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function PMRegisterView({pmItems, setPMItems, tasks, setTasks, partsData, setPartsData}) {
  const [partsModal,setPartsModal] = useState(null);
  const [editItem,  setEditItem]   = useState(null);
  const [showAdd,   setShowAdd]    = useState(false);
  const [filterDept,  setFilterDept]   = useState("All");
  const [showChart,   setShowChart]    = useState(false);
  const [sortCol,   setSortCol]    = useState("machine");
  const [sortDir,   setSortDir]    = useState("asc");

  const toggleSort = (col) => {
    if(sortCol===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else { setSortCol(col); setSortDir("asc"); }
  };
  const sortArrow = (col) => sortCol===col ? (sortDir==="asc"?" ↑":" ↓") : "";

  const markDone = (id) => {
    const today = todayStr();
    setPMItems(items=>items.map(p=>p.id===id?{...p,lastDone:today}:p));
  };

  // Early queue button - FIX #5
  const queueEarly = (pm) => {
    const existing = tasks.filter(t=>t.type==="PM"&&["Queue","Inbox","Scheduled"].includes(t.status)&&t.machine===pm.machine);
    if(existing.length>0) {
      if(!window.confirm(`${pm.machine} already has an active PM task (${existing[0].status}). Add another anyway?`)) return;
    }
    const newTask = {
      id: nextTaskId("PM", tasks),
      type:"PM", status:"Queue",
      title:`${pm.machine} — ${pm.type} PM`,
      dept:pm.dept, assignee:"", estHours:pm.defaultHours||"5",
      weeklyHours:pm.defaultHours||"5", weekOf:nextMonday(),
      hoursLogged:"0", priority:6,
      dueDate:nextDueDate(pm.lastDone,pm.frequency)||"",
      machine:pm.machine, notes:pm.formUrl?`Work order: ${pm.formUrl}`:"",
      pmId:pm.id, createdAt:new Date().toISOString(), addedBy:currentUser(),
    };
    setTasks(ts=>[...ts, newTask]);
    alert(`${pm.machine} PM added to Queue.`);
  };

  const daysColor = (days) => days<0?B.brick:days<=7?B.gold:B.teal;
  const daysLabel = (days) => days<0?`${Math.abs(days)}d overdue`:days===0?"Due today":`${days}d`;

  const pmMatchesTask = (t, p) => t.type==="PM" && t.dept===p.dept && (
    t.pmId===p.id ||
    t.machine===p.machine ||
    (t.machine||"").toLowerCase()===p.machine.toLowerCase() ||
    p.machine.toLowerCase().includes((t.machine||"").toLowerCase()) ||
    (t.machine||"").toLowerCase().includes(p.machine.toLowerCase())
  );
  const thisWeekMon = monStart(todayStr());
  const nextWeekMon = nextMonday();

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:B.text,...sf}}>PM Register</h2>
          <div style={{color:B.muted,fontSize:12,...sf}}>{pmItems.length} machines</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {["All","Millwright","Electrical"].map(d=>(
            <button key={d} onClick={()=>setFilterDept(d)}
              style={{padding:"4px 12px",borderRadius:3,fontSize:11,fontWeight:700,cursor:"pointer",
                border:`1px solid ${filterDept===d?B.orange:B.border}`,
                background:filterDept===d?B.orange+"22":"transparent",
                color:filterDept===d?B.orange:B.textDim,...sf}}>{d}</button>
          ))}
          <Btn variant="secondary" onClick={()=>setShowChart(true)}>📊 Hours Chart</Btn>
          <Btn onClick={()=>setShowAdd(true)}>+ Add Machine</Btn>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,background:"#fff",
          border:`1px solid ${B.border}`,borderRadius:5}}>
          <thead>
            <tr style={{background:B.surface2}}>
              {[
                ["Machine","machine"],["Dept","dept"],["Frequency","frequency"],
                ["Last Done","lastDone"],["Next Due","nextDue"],["Status","status"],
                ["Default Hrs",""],["",""],["",""]
              ].map(([label,col])=>(
                <th key={label} onClick={col?()=>toggleSort(col):undefined}
                  style={{padding:"10px 12px",color:col?B.text:B.textDim,fontWeight:700,
                  fontSize:10,textTransform:"uppercase",letterSpacing:0.5,textAlign:"left",
                  whiteSpace:"nowrap",borderBottom:`1px solid ${B.border}`,
                  cursor:col?"pointer":"default",userSelect:"none"}}>
                  {label}{col?sortArrow(col):""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...pmItems].filter(p=>filterDept==="All"||p.dept===filterDept).sort((a,b)=>{
              const dir = sortDir==="asc"?1:-1;
              if(sortCol==="machine")   return dir*a.machine.localeCompare(b.machine);
              if(sortCol==="dept")      return dir*a.dept.localeCompare(b.dept);
              if(sortCol==="frequency") return dir*a.frequency.localeCompare(b.frequency);
              if(sortCol==="lastDone")  return dir*(a.lastDone||"").localeCompare(b.lastDone||"");
              if(sortCol==="nextDue") {
                const da = daysUntilDue(a.lastDone,a.frequency);
                const db2 = daysUntilDue(b.lastDone,b.frequency);
                return dir*(da-db2);
              }
              if(sortCol==="status") {
                const da = daysUntilDue(a.lastDone,a.frequency);
                const db2 = daysUntilDue(b.lastDone,b.frequency);
                return dir*(da-db2);
              }
              return 0;
            }).map((p,i)=>{
              const days = daysUntilDue(p.lastDone, p.frequency);
              const status = pmStatus(days);
              const activeTask = tasks.find(t=>
                ["Queue","Inbox","Scheduled"].includes(t.status) && pmMatchesTask(t,p));
              const scheduledThisWeek = tasks.some(t=>
                t.status==="Scheduled" && t.weekOf===thisWeekMon && pmMatchesTask(t,p));
              const queuedNextWeek = tasks.some(t=>
                ["Queue","Inbox","Scheduled"].includes(t.status) && t.weekOf===nextWeekMon && pmMatchesTask(t,p));
              const showNextWeekPrompt = p.frequency==="Weekly" && scheduledThisWeek && !queuedNextWeek;
              return (
                <tr key={p.id} style={{borderBottom:i<pmItems.length-1?`1px solid ${B.border}`:"none",
                  background:i%2===0?"#fff":B.bg+"88"}}>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{fontWeight:600,color:B.text,...sf}}>{p.machine}</div>
                    <div style={{display:"flex",gap:8,marginTop:3}}>
                      {p.formUrl && <a href={p.formUrl} target="_blank" rel="noreferrer"
                        style={{color:B.orange,fontSize:11,textDecoration:"none"}}>📄 Work Order</a>}
                      <button onClick={()=>setPartsModal(p.id)}
                        style={{background:"none",border:"none",color:B.teal,cursor:"pointer",
                          fontSize:11,padding:0,...sf}}>
                        🔩 Parts ({(partsData[p.id]||[]).length})
                      </button>
                    </div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{
                      fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:3,
                      border:`1px solid ${p.dept==="Electrical"?B.teal:B.orange}`,
                      color:p.dept==="Electrical"?B.teal:B.orange,
                      background:p.dept==="Electrical"?B.teal+"15":B.orange+"15",
                      ...sf
                    }}>{p.dept}</span>
                  </td>
                  <td style={{padding:"10px 12px",color:B.muted}}>{p.frequency}</td>
                  <td style={{padding:"10px 12px",color:B.muted}}>{fmtDate(p.lastDone)}</td>
                  <td style={{padding:"10px 12px",color:B.muted}}>{fmtDate(nextDueDate(p.lastDone,p.frequency))}</td>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{background:daysColor(days)+"22",color:daysColor(days),
                      border:`1px solid ${daysColor(days)}44`,borderRadius:3,
                      padding:"2px 8px",fontSize:11,fontWeight:700,...sf}}>
                      {status==="overdue"?"Overdue":status==="due-soon"?"Due Soon":"On Track"}
                    </span>
                    <div style={{fontSize:10,color:daysColor(days),marginTop:2,...sf}}>{daysLabel(days)}</div>
                  </td>
                  <td style={{padding:"10px 12px",textAlign:"center"}}>
                    <input type="number" defaultValue={p.defaultHours}
                      onBlur={e=>{const v=e.target.value;if(v&&v!==p.defaultHours){
                        const u={...p,defaultHours:v};
                        setPMItems(items=>items.map(x=>x.id===p.id?u:x),u);}}}
                      onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                      style={{width:44,textAlign:"center",border:`1px solid ${B.border}`,
                        borderRadius:3,padding:"3px 4px",fontSize:12,background:"#fff",...sf}}/>
                    <span style={{color:B.muted,fontSize:11,...sf}}>h</span>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      <Btn style={{padding:"3px 8px",fontSize:10}} onClick={()=>markDone(p.id)}>✓ Done</Btn>
                      {!activeTask
                        ? <Btn variant="secondary" style={{padding:"3px 8px",fontSize:10,color:B.teal,borderColor:B.teal}}
                            onClick={()=>queueEarly(p)}>→ Queue</Btn>
                        : <span style={{fontSize:10,color:B.teal,...sf}}>
                            ● {activeTask.status==="Scheduled"?"Scheduled":"In Queue"}
                          </span>
                      }
                      {showNextWeekPrompt && (
                        <button onClick={()=>queueEarly(p)} title="No PM queued for next week yet"
                          style={{fontSize:10,color:B.gold,background:B.gold+"18",
                            border:`1px solid ${B.gold}55`,borderRadius:3,padding:"2px 7px",
                            cursor:"pointer",fontWeight:700,...sf}}>
                          Queue next week?
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <button onClick={()=>setEditItem(p)} style={{background:"none",border:"none",
                      color:B.muted,cursor:"pointer",fontSize:12,...sf}}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showChart && (
        <PMHoursChart pmItems={pmItems} onClose={()=>setShowChart(false)}/>
      )}
      {partsModal && (
        <PartsModal
          machine={pmItems.find(p=>p.id===partsModal)?.machine||""}
          parts={partsData[partsModal]||[]}
          onSave={(parts)=>{setPartsData(d=>({...d,[partsModal]:parts}),partsModal);setPartsModal(null);}}
          onClose={()=>setPartsModal(null)}
        />
      )}

      {(editItem||showAdd) && (
        <Modal title={editItem?"Edit Machine":"Add Machine"} onClose={()=>{setEditItem(null);setShowAdd(false);}}>
          <PMForm
            item={editItem}
            onSave={(updated)=>{
              if(editItem) setPMItems(items=>items.map(p=>p.id===updated.id?updated:p), updated);
              else { const ni={...updated,id:"pm-"+uid()}; setPMItems(items=>[...items,ni], ni); }
              setEditItem(null); setShowAdd(false);
            }}
            onDelete={editItem ? ()=>{
              if(window.confirm(`Delete ${editItem.machine} from PM Register?`)) {
                setPMItems(items=>items.filter(x=>x.id!==editItem.id));
                db.savePMItems(pmItems.filter(x=>x.id!==editItem.id)).catch(()=>{});
                setEditItem(null);
              }
            } : null}
            onClose={()=>{setEditItem(null);setShowAdd(false);}}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────
const REGISTER_TABS = ["projects","pm","repairs","compliance"];
function Sidebar({activeTab, setActiveTab, inboxCount}) {
  const [registersOpen, setRegistersOpen] = useState(REGISTER_TABS.includes(activeTab));

  const itemStyle = (id, indent=14) => ({
    display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
    textAlign:"left",padding:`8px 14px 8px ${indent}px`,border:"none",cursor:"pointer",
    background: activeTab===id ? B.orange+"22" : "transparent",
    borderLeft: activeTab===id ? `3px solid ${B.orange}` : "3px solid transparent",
    color: activeTab===id ? B.orange : "#cfc3b8",
    fontSize:12.5,fontWeight:700,...sf,
  });

  const Item = ({id,label,badge,indent}) => (
    <button onClick={()=>setActiveTab(id)} style={itemStyle(id,indent)}>
      <span>{label}</span>
      {badge>0 && <span style={{background:B.brick,color:"#fff",borderRadius:10,
        fontSize:10,padding:"1px 6px",fontWeight:700}}>{badge}</span>}
    </button>
  );

  return (
    <div style={{width:180,flexShrink:0,background:B.ink,display:"flex",
      flexDirection:"column",overflowY:"auto",borderRight:"1px solid #3A3028"}}>
      <div style={{padding:"18px 14px",marginBottom:8}}>
        <div style={{background:B.rust,borderRadius:4,padding:"4px 10px",display:"inline-block",
          fontWeight:900,fontSize:13,color:"#fff",letterSpacing:1,...sf}}>SEQUOIA</div>
      </div>
      <Item id="inbox"    label="📥 Inbox"    badge={inboxCount}/>
      <Item id="queue"    label="📋 Queue"/>
      <Item id="schedule" label="📅 Schedule"/>
      <button onClick={()=>setRegistersOpen(o=>!o)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",
          textAlign:"left",padding:"8px 14px",border:"none",borderLeft:"3px solid transparent",
          background:"transparent",cursor:"pointer",
          color:"#cfc3b8",fontSize:12.5,fontWeight:700,...sf}}>
        <span>🗂 Registers</span>
        <span style={{fontSize:10}}>{registersOpen?"▾":"▸"}</span>
      </button>
      {registersOpen && <>
        <Item id="pm"         label="Prev. Maint." indent={30}/>
        <Item id="projects"   label="Projects"     indent={30}/>
        <Item id="repairs"    label="Repairs"      indent={30}/>
        <Item id="compliance" label="Compliance"   indent={30}/>
      </>}
      <Item id="completed" label="✅ Completed"/>
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function SettingsPanel({settings, onSave, onClose, onRenameTeamMember}) {
  const [s,setS] = useState({...settings});
  const [newEmail, setNewEmail] = useState("");
  const escalation = s.escalation || DEFAULT_SETTINGS.escalation;

  const addEscalationEmail = () => {
    const email = newEmail.trim();
    if(!email) return;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("Enter a valid email address."); return; }
    setS(p=>{
      const esc = p.escalation || DEFAULT_SETTINGS.escalation;
      if(esc.emails.includes(email)) return p;
      return {...p, escalation:{...esc, emails:[...esc.emails, email]}};
    });
    setNewEmail("");
  };
  const removeEscalationEmail = (email) => {
    setS(p=>{
      const esc = p.escalation || DEFAULT_SETTINGS.escalation;
      return {...p, escalation:{...esc, emails:esc.emails.filter(e=>e!==email)}};
    });
  };
  const setEscalationThreshold = (v) => {
    setS(p=>{
      const esc = p.escalation || DEFAULT_SETTINGS.escalation;
      return {...p, escalation:{...esc, threshold: Math.max(1,+v||4)}};
    });
  };

  const addMember = (dept) => {
    const name = prompt("New team member name:");
    if(!name) return;
    setS(p=>({...p,team:{...p.team,[dept]:[...(p.team[dept]||[]),{name,hours:40}]}}));
  };
  const removeMember = (dept,name) => {
    if(!window.confirm(`Remove ${name}?`)) return;
    setS(p=>({...p,team:{...p.team,[dept]:(p.team[dept]||[]).filter(m=>m.name!==name)}}));
  };
  // FIX #1: rename member and update all tasks
  const renameMember = (dept,oldName) => {
    const newName = prompt("New name:",oldName);
    if(!newName||newName===oldName) return;
    setS(p=>({...p,team:{...p.team,[dept]:(p.team[dept]||[]).map(m=>m.name===oldName?{...m,name:newName}:m)}}));
    onRenameTeamMember(oldName, newName);
  };

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div style={{marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:13,color:B.text,marginBottom:12,...sf}}>Team Members</div>
        {Object.entries(s.team||{}).map(([dept,members])=>(
          <div key={dept} style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:1,
              color:B.muted,marginBottom:8,...sf}}>{dept}</div>
            {members.map(m=>(
              <div key={m.name} style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",padding:"6px 10px",background:B.surface2,
                borderRadius:4,marginBottom:4}}>
                <span style={{fontSize:13,color:B.text,...sf}}>{m.name}</span>
                <div style={{display:"flex",gap:6}}>
                  <input type="number" value={m.hours} onChange={e=>{
                    const v=+e.target.value;
                    setS(p=>({...p,team:{...p.team,[dept]:p.team[dept].map(x=>x.name===m.name?{...x,hours:v}:x)}}));
                  }} style={{width:48,border:`1px solid ${B.border}`,borderRadius:3,
                    padding:"3px 6px",fontSize:12,textAlign:"center",...sf}}/>
                  <span style={{color:B.muted,fontSize:12,alignSelf:"center",...sf}}>h/wk</span>
                  <button onClick={()=>renameMember(dept,m.name)}
                    style={{background:"none",border:"none",color:B.orange,cursor:"pointer",fontSize:12,...sf}}>Rename</button>
                  <button onClick={()=>removeMember(dept,m.name)}
                    style={{background:"none",border:"none",color:B.brick,cursor:"pointer",fontSize:12,...sf}}>✕</button>
                </div>
              </div>
            ))}
            <button onClick={()=>addMember(dept)}
              style={{fontSize:12,color:B.teal,background:"none",border:"none",
                cursor:"pointer",padding:"4px 0",...sf}}>+ Add {dept}</button>
          </div>
        ))}
      </div>

      <div style={{marginBottom:20}}>
        <div style={{fontWeight:700,fontSize:13,color:B.text,marginBottom:4,...sf}}>Escalation — Code Red Alerts</div>
        <div style={{color:B.muted,fontSize:11,marginBottom:12,...sf}}>
          Tasks rescheduled this many times in a row get flagged as Code Red on the Schedule tab.
        </div>
        <Field label="Reschedule threshold">
          <Input type="number" value={escalation.threshold} onChange={e=>setEscalationThreshold(e.target.value)}/>
        </Field>
        <div style={{color:B.textDim,fontSize:10,fontWeight:700,textTransform:"uppercase",
          letterSpacing:1,marginBottom:8,...sf}}>Recipients</div>
        {escalation.emails.length===0 && (
          <div style={{color:B.muted,fontSize:12,marginBottom:8,...sf}}>No recipients added yet.</div>
        )}
        {escalation.emails.map(email=>(
          <div key={email} style={{display:"flex",justifyContent:"space-between",
            alignItems:"center",padding:"6px 10px",background:B.surface2,
            borderRadius:4,marginBottom:4}}>
            <span style={{fontSize:13,color:B.text,...sf}}>{email}</span>
            <button onClick={()=>removeEscalationEmail(email)}
              style={{background:"none",border:"none",color:B.brick,cursor:"pointer",fontSize:12,...sf}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex",gap:6,marginTop:6}}>
          <Input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="name@sequoiafp.com"/>
          <Btn variant="secondary" onClick={addEscalationEmail} style={{whiteSpace:"nowrap"}}>+ Add</Btn>
        </div>
      </div>

      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={()=>onSave(s)}>Save Settings</Btn>
      </div>
    </Modal>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function App({user, idToken, accessToken}) {
  const [tasks,       setTasksRaw]    = useState([]);
  const [pmItems,     setPMItemsRaw]  = useState(SEED_PM);
  const [partsData,   setPartsDataRaw]= useState({});
  const [settings,    setSettingsRaw] = useState(DEFAULT_SETTINGS);
  const [activeTab,   setActiveTab]   = useState("inbox");
  const [selectedWeek,setSelectedWeek]= useState(nextMonday());
  const [editTask,    setEditTask]    = useState(null);
  const [scheduleTask,setScheduleTask]= useState(null);
  const [showSettings,setShowSettings]= useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [syncLabel,   setSyncLabel]   = useState("●  Synced");
  const [loading,     setLoading]     = useState(true);

  // ── Persist to Supabase ──────────────────────────────────────────────────────
  const pendingTasks = useRef({});
  const debounceTimers = useRef({});

  const persistTask = useCallback(async(task) => {
    setSyncLabel("● Saving…");
    try {
      await db.saveTask(task);
      setSyncLabel("●  Synced");
    } catch(e) {
      console.error("Save failed:", e);
      setSyncLabel("⚠ Save error");
    }
  }, []);

  const persistTaskDelete = useCallback(async(id) => {
    try { await db.deleteTask(id); } catch(e) { console.error("Delete failed:", e); }
  }, []);

  // setTasks — updates state and persists changed tasks to Supabase
  const setTasks = useCallback((updater, taskToSave=null)=>{
    setTasksRaw(prev=>{
      const next = typeof updater==="function"?updater(prev):updater;
      // If a specific task was changed, save just that one
      if(taskToSave) {
        persistTask(taskToSave);
      } else {
        // Find what changed and save only those tasks
        const prevMap = new Map(prev.map(t=>[t.id,t]));
        next.forEach(t=>{
          const old = prevMap.get(t.id);
          if(!old || JSON.stringify(old)!==JSON.stringify(t)) persistTask(t);
        });
        // Find deleted tasks
        const nextIds = new Set(next.map(t=>t.id));
        prev.forEach(t=>{ if(!nextIds.has(t.id)) persistTaskDelete(t.id); });
      }
      return next;
    });
  },[persistTask, persistTaskDelete]);

  const setPMItems = useCallback((updater, itemToSave=null)=>{
    setPMItemsRaw(prev=>{
      const next = typeof updater==="function"?updater(prev):updater;
      if(itemToSave) {
        db.updatePMItem(itemToSave).catch(e=>console.error("PM save failed:",e));
      } else {
        db.savePMItems(next).catch(e=>console.error("PM save failed:",e));
      }
      return next;
    });
  },[]);

  const setPartsData = useCallback((updater, pmId=null)=>{
    setPartsDataRaw(prev=>{
      const next = typeof updater==="function"?updater(prev):updater;
      if(pmId) {
        db.saveParts(pmId, next[pmId]||[]).catch(e=>console.error("Parts save failed:",e));
      }
      return next;
    });
  },[]);

  const setSettings = useCallback((s)=>{
    setSettingsRaw(s);
    db.saveSettings(s).catch(e=>console.error("Settings save failed:",e));
  },[]);


  // ── Load from Supabase + real-time subscriptions ────────────────────────────
  const pullFromDB = useCallback(async()=>{
    setSyncLabel("● Syncing…");
    try {
      let [tasks, pmItems, partsData, settings] = await Promise.all([
        db.getTasks(),
        db.getPMItems(),
        db.getParts(),
        db.getSettings(),
      ]);
      if(tasks.length > 0 || pmItems.length > 0) {
        setTasksRaw(tasks);
        if(pmItems.length > 0) {
          // Auto-register any PM task machines not in the PM register
          const registeredMachines = new Set(pmItems.map(p=>p.machine.toLowerCase()));
          const unregistered = tasks
            .filter(t=>t.type==="PM" && t.machine &&
              !pmItems.some(p=>
                t.pmId===p.id ||
                p.machine.toLowerCase()===t.machine.toLowerCase() ||
                p.machine.toLowerCase().includes(t.machine.toLowerCase()) ||
                t.machine.toLowerCase().includes(p.machine.toLowerCase())
              )
            )
            .reduce((acc,t)=>{
              const key = (t.machine||"").toLowerCase();
              if(!acc.some(x=>x.machine.toLowerCase()===key)) acc.push(t);
              return acc;
            },[]);
          if(unregistered.length>0) {
            const newPMs = unregistered.map(t=>({
              id:"pm-auto-"+uid(),
              machine: t.machine,
              dept: t.dept||"Millwright",
              type: "Mechanical",
              frequency: "Weekly",
              lastDone: "",
              defaultHours: t.estHours||"5",
              formUrl: "",
            }));
            const merged = [...pmItems, ...newPMs];
            await db.savePMItems(merged);
            // Use merged list for rest of load
            pmItems = merged;
          }

          // Always sync lastDone from most recent completed PM task
          // This ensures the register reflects actual completions
          const completedPMs = tasks.filter(t=>
            t.type==="PM" && t.status==="Complete" && t.machine && t.completedAt
          );
          const updatedPMs = pmItems.map(p=>{
            const matches = completedPMs
              .filter(t=>t.machine===p.machine || (t.dept===p.dept && (
                p.machine.toLowerCase().includes((t.machine||"").toLowerCase()) ||
                (t.machine||"").toLowerCase().includes(p.machine.toLowerCase())
              )))
              .sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
            if(matches.length>0) {
              const latestDate = matches[0].completedAt.slice(0,10);
              // Only update if completed date is more recent than stored lastDone
              if(!p.lastDone || latestDate > p.lastDone) {
                const updated = {...p, lastDone: latestDate};
                db.updatePMItem(updated).catch(()=>{});
                return updated;
              }
            }
            return p;
          });
          setPMItemsRaw(updatedPMs);
        } else setPMItemsRaw(SEED_PM);
        setPartsDataRaw(partsData);
        if(settings) setSettingsRaw(settings);
      } else {
        // First time — seed the database with PM data and default settings
        await db.savePMItems(SEED_PM);
        await db.saveSettings(DEFAULT_SETTINGS);
        setPMItemsRaw(SEED_PM);
      }
      setSyncLabel("●  Synced");
    } catch(e) {
      console.error("Load failed:", e);
      setSyncLabel("⚠ Load error");
    }
    setLoading(false);
  }, []);



  const renameTeamMember = useCallback((oldName, newName)=>{
    setTasksRaw(prev=>{
      const changed = prev.filter(t=>t.assignee===oldName).map(t=>({...t,assignee:newName}));
      const next = prev.map(t=>t.assignee===oldName?{...t,assignee:newName}:t);
      changed.forEach(t=>persistTask(t));
      return next;
    });
  },[persistTask]);

  // PM tasks are queued manually via the PM Register → Queue button

  // ── Save new task ─────────────────────────────────────────────────────────────
  // Legacy migration helper (kept for reference)
  const migrateIds = useCallback((ts) => {
    const counters = { Project:0, PM:0, Compliance:0, Repair:0 };
    const prefixes = { Project:"P", PM:"M", Compliance:"C", Repair:"R" };
    // Sort by createdAt so numbering is chronological
    const sorted = [...ts].sort((a,b)=>new Date(a.createdAt||0)-new Date(b.createdAt||0));
    const idMap = {};
    sorted.forEach(t => {
      const pre = prefixes[t.type] || "P";
      const typeKey = t.type || "Project";
      counters[typeKey] = (counters[typeKey]||0) + 1;
      const newId = pre + counters[typeKey];
      idMap[t.id] = newId;
    });
    return ts.map(t => ({...t, id: idMap[t.id] || t.id}));
  }, []);

  const saveTask = (t) => {
    const isNew = !t.id || !tasks.find(x=>x.id===t.id);
    const withId   = isNew ? {...t, id:nextTaskId(t.type, tasks)} : t;
    const withUser = isNew ? {...withId, addedBy:currentUser(), createdAt:new Date().toISOString()} : withId;
    setTasksRaw(prev=>isNew?[...prev,withUser]:prev.map(x=>x.id===withUser.id?withUser:x));
    persistTask(withUser);
    setEditTask(null); setShowAddTask(false);
  };

  const saveSchedule = (t) => {
    const prev = tasks.find(x=>x.id===t.id);
    const weekChanged = !!prev?.weekOf && prev.weekOf!==t.weekOf;
    const scheduled = {
      ...t,
      originalScheduledDate: prev?.originalScheduledDate || t.weekOf,
      rescheduleCount: weekChanged ? (+prev.rescheduleCount||0)+1 : (+prev?.rescheduleCount||0),
    };
    setTasksRaw(prevTasks=>prevTasks.map(x=>x.id===scheduled.id?scheduled:x));
    persistTask(scheduled);
    setScheduleTask(null);
  };

  const inboxCount = tasks.filter(t=>t.status==="Inbox").length;
  const safeSettings = settings||DEFAULT_SETTINGS;


  // ── Initial load + real-time subscriptions ──────────────────────────────────
  useEffect(()=>{
    pullFromDB();

    // Real-time: when another user changes a task, update our state
    const taskSub = db.subscribeToTasks((payload) => {
      const { eventType, new: newRow, old: oldRow } = payload;
      setTasksRaw(prev => {
        if(eventType === 'DELETE') return prev.filter(t=>t.id!==oldRow.id);
        const fromRow = (r) => ({
          id:r.id, type:r.type, status:r.status, title:r.title,
          dept:r.dept, assignee:r.assignee, estHours:r.est_hours,
          weeklyHours:r.weekly_hours, weekOf:r.week_of?r.week_of.slice(0,10):'',
          hoursLogged:r.hours_logged, priority:r.priority,
          dueDate:r.due_date?r.due_date.slice(0,10):'',
          machine:r.machine, notes:r.notes, source:r.source,
          addedBy:r.added_by, completedBy:r.completed_by,
          completedAt:r.completed_at, scheduledBy:r.scheduled_by,
          pmId:r.pm_id, createdAt:r.created_at,
          progressStatus:r.progress_status||'On Track',
          originalScheduledDate:r.original_scheduled_date?r.original_scheduled_date.slice(0,10):'',
          rescheduleCount:r.reschedule_count||0,
        });
        const updated = fromRow(newRow);
        if(eventType === 'INSERT') {
          if(prev.find(t=>t.id===updated.id)) return prev;
          return [...prev, updated];
        }
        if(eventType === 'UPDATE') return prev.map(t=>t.id===updated.id?updated:t);
        return prev;
      });
      setSyncLabel("●  Synced");
    });

    const pmSub = db.subscribeToPM((payload) => {
      if(payload.eventType==='UPDATE') {
        const r = payload.new;
        setPMItemsRaw(prev=>prev.map(p=>p.id===r.id
          ?{...p,lastDone:r.last_done?r.last_done.slice(0,10):'',defaultHours:r.default_hours}:p));
      }
    });

    return ()=>{ db.unsubscribe(taskSub); db.unsubscribe(pmSub); };
  },[pullFromDB]);


  return (
    <div style={{height:"100vh",background:B.bg,...sf,display:"flex",flexDirection:"column"}}>
      {loading && (
        <div style={{position:"fixed",inset:0,background:B.ink,display:"flex",
          alignItems:"center",justifyContent:"center",zIndex:9999,flexDirection:"column",gap:16}}>
          <div style={{color:B.orange,fontWeight:900,fontSize:18,letterSpacing:2,...sf}}>SEQUOIA</div>
          <div style={{color:"#fff",fontSize:14,...sf}}>Loading Work Planner…</div>
          <div style={{width:40,height:40,border:`3px solid ${B.rust}`,borderTopColor:B.orange,
            borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      {/* Header — stays fixed, never scrolls */}
      <div style={{flexShrink:0,background:B.ink,padding:"0 24px",display:"flex",
        justifyContent:"space-between",alignItems:"center",height:56}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{background:B.rust,borderRadius:4,padding:"4px 10px",
            fontWeight:900,fontSize:14,color:"#fff",letterSpacing:1}}>SEQUOIA</div>
          <div>
            <div style={{color:B.gold,fontSize:9,fontWeight:700,letterSpacing:2}}>SEQUOIA MAINTENANCE SYSTEM</div>
            <div style={{color:"#fff",fontSize:14,fontWeight:700}}>Work Planner <span style={{color:B.muted,fontSize:10,fontWeight:400}}>v4</span></div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:12,color:syncLabel.includes("Synced")?B.teal:syncLabel.includes("error")||syncLabel.includes("⚠")?B.brick:B.gold}}
            title="Syncs automatically on load and every 60 seconds">
            ● {syncLabel}
          </span>
          <Btn variant="secondary" style={{color:"#fff",borderColor:"#555"}}
            onClick={()=>setShowSettings(true)}>⚙ Settings</Btn>
          <Btn onClick={()=>setShowAddTask(true)}>+ Add Task</Btn>
          {user && <div style={{display:"flex",alignItems:"center",gap:8}}>
            {user.picture && <img src={user.picture} style={{width:28,height:28,borderRadius:"50%"}} alt=""/>}
            <span style={{fontSize:12,color:"#aaa"}}>{user.name?.split(" ")[0]} · <a href="#" onClick={e=>{e.preventDefault();window.google?.accounts?.id?.disableAutoSelect();window.location.reload();}} style={{color:B.muted,textDecoration:"none"}}>Sign out</a></span>
          </div>}
        </div>
      </div>

      {/* Sidebar + content — sidebar stays fixed, only content scrolls */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} inboxCount={inboxCount}/>
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{maxWidth:1100,margin:"0 auto",padding:24}}>
            {activeTab==="inbox"     && <InboxView tasks={tasks} setTasks={setTasks} settings={safeSettings} onEdit={setEditTask}/>}
            {activeTab==="queue"     && <QueueView tasks={tasks} setTasks={setTasks} settings={safeSettings} onEdit={setEditTask} onSchedule={setScheduleTask}/>}
            {activeTab==="schedule"  && <ScheduleView tasks={tasks} setTasks={setTasks} pmItems={pmItems} setPMItems={setPMItems} settings={safeSettings} selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} onEdit={setEditTask} onReschedule={setScheduleTask}/>}
            {activeTab==="projects"  && <ProjectsRegisterView tasks={tasks} setTasks={setTasks} settings={safeSettings} onEdit={setEditTask}/>}
            {activeTab==="pm"        && <PMRegisterView pmItems={pmItems} setPMItems={setPMItems} tasks={tasks} setTasks={setTasks} partsData={partsData} setPartsData={setPartsData}/>}
            {activeTab==="repairs"   && <RepairsView tasks={tasks} setTasks={setTasks} onEdit={setEditTask}/>}
            {activeTab==="compliance"&& <ComplianceView tasks={tasks} setTasks={setTasks} onEdit={setEditTask}/>}
            {activeTab==="completed" && <CompletedView tasks={tasks} setTasks={setTasks}/>}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddTask  && <TaskForm task={null} settings={safeSettings} pmItems={pmItems} onSave={saveTask} onClose={()=>setShowAddTask(false)}/>}
      {editTask     && <TaskForm task={editTask} settings={safeSettings} pmItems={pmItems} onSave={saveTask} onClose={()=>setEditTask(null)}/>}
      {scheduleTask && <ScheduleModal task={scheduleTask} settings={safeSettings} onSave={saveSchedule} onClose={()=>setScheduleTask(null)}/>}
      {showSettings && <SettingsPanel settings={safeSettings} onSave={s=>{setSettings(s);setShowSettings(false);}} onClose={()=>setShowSettings(false)} onRenameTeamMember={renameTeamMember}/>}
    </div>
  );
}
