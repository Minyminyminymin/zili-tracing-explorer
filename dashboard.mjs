// Overview dashboard: add datasets, then pick a detected task and participants.
// Tasks, participants and comparisons only light up when the added data supports them.
import * as ses from './session.mjs';
import * as inv from './inventory.mjs';
import {groundTruth,loadTrefoil3DReference} from './session-geometry.mjs';
import {binnedPaths} from './paths.mjs';
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=(x,n=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const avg=a=>{const b=a.filter(Number.isFinite);return b.length?b.reduce((x,y)=>x+y,0)/b.length:null;};
const fmtDate=d=>d?`${+d.slice(6,8)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+d.slice(4,6)-1]} ${d.slice(0,4)}`:'';

export const GROUPS=[['Calibration',[['Cube_S','Cube_S','Static cube'],['Cube_R','Cube_R','Rotating cube'],['T3D_S','3D Trefoil_S','Static 3D trefoil'],['T3D_R','3D Trefoil_R','Rotating 3D trefoil']]],
 ['Main Experiment',[['Ellipse','Ellipse','Ellipse'],['Sphere','Sphere','Sphere'],['T2D','2D Trefoil','Main 2D trefoil']]]];
const TASKNAME=Object.fromEntries(GROUPS.flatMap(([,t])=>t.map(([k,,n])=>[k,n])));
const keyOf=r=>r.task==='Cube'?(r.cond==='Rotating'?'Cube_R':'Cube_S'):r.task==='Trefoil3D'?(r.cond==='Rotating'?'T3D_R':'T3D_S'):r.task==='Trefoil2D'?'T2D':r.task;
const PCOL=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6','#e34948'];

const st={datasets:[],task:null,people:new Set(),session:null,trial:null,cmp:'pp',pick:null,mean:true};
// Ellipse and sphere trials each have their own target (aspect ratio, equator or outline), so they are shown one at a time.
const PER_TRIAL=new Set(['Ellipse','Sphere']);
let groups=[],ref3D=null,peopleTouched=false;
export const hooks={onDrawings:null};

/* ---------- datasets ---------- */
const H=120,CUBE=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const TRACED=[[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,6],[6,7],[7,4]],DIM=[[1,5],[2,6],[3,7]];
const cubePaths=half=>[...TRACED.map(([a,b])=>({kind:'ground',label:'Ground truth',points:[CUBE[a].map(v=>v*half),CUBE[b].map(v=>v*half)]})),...DIM.map(([a,b])=>({kind:'secondary',label:'Ground truth (dim edges)',points:[CUBE[a].map(v=>v*half),CUBE[b].map(v=>v*half)]}))];

async function addBuiltin(){
 if(st.datasets.some(d=>d.kind==='builtin')){useDataset('builtin');return;}
 status('Loading the built-in summer calibration…');
 const D=await (await fetch('./data/calibration_trajectories.json')).json(),out=[];
 for(const [pid,conds] of Object.entries(D)){
  const byS=new Map();
  for(const [ck,list] of Object.entries(conds))for(const s of list){
   if(!byS.has(s.s))byS.set(s.s,{ds:'builtin',key:`summer_${pid}_${s.s}`,pid,order:s.s,date:s.date,label:`Session ${s.s}`,half:H,trials:[]});
   for(const t of s.trials)byS.get(s.s).trials.push({task:ck==='cube_static'?'Cube_S':'Cube_R',i:t.i,id:`${pid} s${s.s} trial ${t.i}`,p:t.x.map((x,k)=>[x,t.y[k],t.z[k]]),e:t.d,mean:t.mean,edges:t.edges,frame:'canonical'});
  }
  out.push(...byS.values());
 }
 st.datasets.push({id:'builtin',name:'Summer 2026 calibration (built in)',kind:'builtin',on:true,groups:out,note:'8 participants, cube only. Already cleaned: 6 trials excluded.'});
 status('');useDataset('builtin');
}
async function addFiles(files,name){
 files=[...files].filter(f=>/\.(csv|txt)$/i.test(f.name));
 if(!files.length){status('No CSV files in what was added.',true);return;}
 status(`Reading ${files.length} files…`);
 const id='ds'+Date.now();
 await inv.addFiles(files).catch(()=>null);
 const pick=files.filter(f=>/_(Trials|Samples|SessionInfo)_/i.test(f.name)||/^RotatingTrace(_Calib)?_/i.test(f.name));
 let sessions=[],note='';
 if(pick.length){try{const res=await ses.loadFiles(pick,(d,n)=>status(n>1?`Processing ${n} sessions in the background: ${d} of ${n} done…`:'Processing the session in the background…'));sessions=res.sessions;if(res.missing.length)note=res.missing.join('. ')+'.';}catch(e){note=e.message;}}
 else note='No session files that this site can analyse. See Data files for what was found.';
 if(!ref3D)ref3D=await loadTrefoil3DReference(new URL('./reference/coords_R2_1.5.csv',import.meta.url).href).catch(()=>null);
 // Builds are never mixed: summer and current-build sessions become separate datasets.
 const builds=[...new Set(sessions.map(s=>s.build||'current'))];
 if(!builds.length){st.datasets.push({id,name:name||`${files.length} files`,kind:'files',build:null,on:true,groups:[],note});status('');useDataset(id);return;}
 let firstId=null;
 for(const b of builds){
  const did=id+'_'+b,gs=mergeGroups(sessions.filter(s=>(s.build||'current')===b).map(groupOf)),kept=gs.filter(g=>g.trials.length);
  const dropped=gs.reduce((n,g)=>n+g.dropped,0),emptyS=gs.length-kept.length;
  const byP={};for(const g of kept)(byP[g.pid]??=[]).push(g);for(const a of Object.values(byP)){a.sort((x,y)=>(x.date||'').localeCompare(y.date||'')||(x.label||'').localeCompare(y.label||''));a.forEach((g,k)=>g.order=k+1);}
  const label=b==='summer'?'summer build':b==='current'?'current build':b.replace(/-/g,' ')+' build';
  const txt=`${Object.keys(byP).length} participant${Object.keys(byP).length===1?'':'s'}, ${kept.length} session${kept.length===1?'':'s'}.`+(dropped?` ${dropped} trial${dropped>1?'s':''} left out: the ground truth does not match the logged distance.`:'')+(emptyS?` ${emptyS} session${emptyS>1?'s':''} with nothing usable.`:'');
  st.datasets.push({id:did,name:`${name||`${files.length} files`}${builds.length>1?`, ${label}`:''}`,kind:'files',build:b,on:true,groups:kept,note:(builds.length>1?'':`${label[0].toUpperCase()+label.slice(1)}. `)+txt+(note?' '+note:'')});
  firstId??=did;
 }
 status('');useDataset(firstId);
}
// A cube trial is left out when its recomputed distance disagrees with the logged one (more than 1% of samples off by >1 mm),
// or when the rotating cube's angle could not be fitted confidently.
// Formatted sessions arrive as two parts (Calibration, MainExperiment) with the same participant, number and date.
function mergeGroups(gs){
 const m=new Map();
 for(const g of gs){const k=`${g.pid}|${g.session}|${g.date}`;const x=m.get(k);if(!x){m.set(k,g);continue;}x.trials.push(...g.trials);x.dropped+=g.dropped;x.parts=[...(x.parts||[x.raw]),g.raw];if(!x.half&&g.half)x.half=g.half;if(g.raw.drawings&&!x.raw.drawings)x.raw=g.raw;}
 return [...m.values()];
}
function groupOf(s){
 const date=s.date||(Object.values(s.files)[0]?.match(/_(\d{8})_\d{6}/)||[])[1]||null;
 const bad=r=>r.task==='Cube'&&(r.frame!=='canonical'||(r.check&&r.check.over1mmPct>1)||(r.spin&&!r.spin.confident));
 const keep=s.trials.filter(r=>!bad(r));
 return {ds:null,key:s.key,pid:s.participant,session:s.session,label:s.label?`${s.label}`:`Session ${s.session??'?'}`,date,geometry:s.geometry,raw:s,build:s.build,dropped:s.trials.length-keep.length,
  half:Number.isFinite(s.geometry.cubeWorldEdge)?s.geometry.cubeWorldEdge*500:null,
  trials:keep.map(r=>({task:keyOf(r),i:r.index,id:r.id,rec:r,p:r.frame==='canonical'?r.p:r.w,e:r.e,mean:r.err?.mean??null,p95:r.err?.p95??null,within2:r.err?.within2??null,edges:r.edges,shape:r.shape,expected:r.expected,frame:r.frame}))};
}
function useDataset(id){for(const d of st.datasets)d.on=d.id===id;st.session=null;st.trial=null;peopleTouched=false;rebuild();}
function status(msg,err=false){const el=$('upStatus');el.textContent=msg;el.className='upStatus'+(err?' error':'');}

/* ---------- derived state ---------- */
function rebuild(){
 groups=st.datasets.filter(d=>d.on).flatMap(d=>d.groups);
 // One session order per participant across every dataset, by date.
 const byP={};for(const g of groups)(byP[g.pid]??=[]).push(g);
 // Formatted and current-build files carry a session number; use it so labels match the file names. Otherwise count by date.
 const numbered=groups.every(g=>Number.isFinite(g.session));
 for(const a of Object.values(byP)){a.sort((x,y)=>(x.date||'').localeCompare(y.date||'')||(x.session??0)-(y.session??0)||(x.order||0)-(y.order||0));a.forEach((g,k)=>g.n=numbered?g.session:k+1);}
 if(st.task&&!available(st.task))st.task=null;
 const ppl=peopleFor(st.task);
 if(!peopleTouched)st.people=new Set(ppl);else st.people=new Set([...st.people].filter(p=>ppl.includes(p)));
 render();
}
const available=t=>groups.some(g=>g.trials.some(r=>r.task===t));
const allPeople=()=>[...new Set(groups.map(g=>g.pid))].sort();
const peopleFor=t=>t?[...new Set(groups.filter(g=>g.trials.some(r=>r.task===t)).map(g=>g.pid))].sort():allPeople();
const sessionsOf=(pid,t)=>groups.filter(g=>g.pid===pid&&g.trials.some(r=>r.task===t)).sort((a,b)=>a.n-b.n);
const chosenSession=(pid,t)=>{const s=sessionsOf(pid,t);return (st.session&&s.find(g=>g.key===st.session))||s.at(-1);};

/* ---------- left blocks ---------- */
function renderDatasets(){
 $('dsList').innerHTML=st.datasets.map(d=>`<li><button type="button" class="ds${d.on?' on':''}" data-ds="${d.id}" aria-pressed="${d.on}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z"/></svg><span>${esc(d.name)}</span></button><small>${esc(d.note)}</small></li>`).join('');
 $('dsNote').hidden=st.datasets.length>0;
 // One dataset at a time: summer and October builds are not compared with each other.
 $('dsList').querySelectorAll('[data-ds]').forEach(b=>b.onclick=()=>useDataset(b.dataset.ds));
}
function renderTasks(){
 $('tkBody').innerHTML=GROUPS.map(([g,ts])=>`<div class="grp"><p class="grpName">${g}</p><div class="chips">${ts.map(([k,l,n])=>{const ok=available(k);return `<button type="button" class="chip${st.task===k?' sel':''}" data-task="${k}" ${ok?'':'disabled'} aria-pressed="${st.task===k}" title="${esc(n)}${ok?'':': not in the added data'}">${l}</button>`;}).join('')}</div></div>`).join('')+(groups.length?'':'<p class="cardNote">Tasks found in the data become clickable.</p>');
 $('tkBody').querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{st.task=st.task===b.dataset.task?null:b.dataset.task;st.session=null;st.trial=null;peopleTouched=false;rebuild();});
}
function renderPeople(){
 const all=allPeople(),has=new Set(peopleFor(st.task));
 if(!all.length){$('ppBody').innerHTML='<p class="cardNote">Participants appear once data is added.</p>';return;}
 $('ppBody').innerHTML=`<p class="grpName">Total ${all.length}${st.task?`, ${has.size} with ${TASKNAME[st.task].toLowerCase()}`:''}</p><div class="chips">${all.map(p=>`<button type="button" class="chip${st.people.has(p)&&has.has(p)?' sel':''}" data-p="${esc(p)}" ${has.has(p)?'':'disabled'} aria-pressed="${st.people.has(p)}">${esc(p)}</button>`).join('')}</div>${st.task&&has.size>1?`<p class="chipAct"><button type="button" class="linkBtn" id="ppAll">All</button><button type="button" class="linkBtn" id="ppNone">None</button></p>`:''}`;
 $('ppBody').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{peopleTouched=true;const p=b.dataset.p;st.people.has(p)?st.people.delete(p):st.people.add(p);st.session=null;render();});
 $('ppAll')&&($('ppAll').onclick=()=>{peopleTouched=true;st.people=new Set(has);render();});
 $('ppNone')&&($('ppNone').onclick=()=>{peopleTouched=true;st.people=new Set();render();});
}

/* ---------- centre: 3D view of the selected task ---------- */
const selPeople=()=>[...st.people].filter(p=>peopleFor(st.task).includes(p)).sort();
function gtFor(g,t,only){
 if(t.startsWith('Cube'))return g.half?cubePaths(g.half):[];
 if(!g.geometry||!g.raw)return [];
 // The 3D trefoil reference was re-oriented in September; summer-build trials have no matching ground truth to draw.
 if(t.startsWith('T3D')&&g.build&&g.build!=='current')return [];
 const tr=only||g.trials.find(r=>r.task===t);if(!tr||tr.frame!=='canonical')return [];
 return groundTruth({meta:tr.rec.meta},g.geometry,'canonical',0,ref3D).map(p=>({...p,points:p.points.map(q=>q.map(v=>v*1000))}));
}
// 1 mm is the same length on every axis, and every sample stays in the scene. The camera starts zoomed onto the
// ground truth (or the central 96% of the samples when there is none); zoom out to see samples far outside it.
function camFor(traces){
 const all=[[],[],[]],ref=[[],[],[]];
 for(const tr of traces){if(tr.type!=='scatter3d'||tr.mode==='text')continue;const gt=/^Ground truth|ground truth|wireframe|ellipse|circle|target/i.test(tr.name||'')&&!/Trial|mean|AA|ZZ/.test(tr.name||'');
  ['x','y','z'].forEach((k,i)=>{for(const v of tr[k]||[])if(Number.isFinite(v)){all[i].push(v);if(gt)ref[i].push(v);}});}
 if(!all[0].length)return {eye:{x:.35,y:-1.9,z:.55},up:{x:0,y:0,z:1}};
 const q=(a,f)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor(f*(b.length-1))];};
 const lo=all.map(a=>Math.min(...a)),hi=all.map(a=>Math.max(...a)),mid=lo.map((v,i)=>(v+hi[i])/2),maxR=Math.max(...hi.map((v,i)=>v-lo[i]))||1;
 const R=ref[0].length?ref:all.map(a=>[q(a,.02),q(a,.98)]),rl=R.map(a=>Math.min(...a)),rh=R.map(a=>Math.max(...a)),c=rl.map((v,i)=>(v+rh[i])/2),span=Math.max(...rh.map((v,i)=>v-rl[i]))||maxR;
 const center=c.map((v,i)=>(v-mid[i])/maxR),k=Math.max(.5,3.4*span/maxR),d=[.18,-1,.29],n=Math.hypot(...d);
 return {center:{x:center[0],y:center[1],z:center[2]},eye:{x:center[0]+d[0]/n*k,y:center[1]+d[1]/n*k,z:center[2]+d[2]/n*k},up:{x:0,y:0,z:1}};
}
const line=(pts,o)=>({type:'scatter3d',mode:'lines',x:pts.map(p=>p?p[0]:null),y:pts.map(p=>p?p[2]:null),z:pts.map(p=>p?p[1]:null),...o});
function renderViz(){
 const plot=$('vizPlot'),empty=$('vizEmpty'),head=$('vizHead');
 if(!st.datasets.length){empty.textContent='Add a dataset to begin.';empty.hidden=false;plot.hidden=true;head.innerHTML='';return;}
 if(!st.task){empty.textContent='Click a task to analyse.';empty.hidden=false;plot.hidden=true;head.innerHTML='';return;}
 const P=selPeople();if(!P.length){empty.textContent='Select at least one participant.';empty.hidden=false;plot.hidden=true;head.innerHTML='';return;}
 if(PER_TRIAL.has(st.task)&&P.length>1){empty.textContent=`Each ${TASKNAME[st.task].toLowerCase()} trial has its own target. Select one participant to see their trials.`;empty.hidden=false;plot.hidden=true;head.innerHTML='';return;}
 empty.hidden=true;plot.hidden=false;
 const traces=[],t=st.task,single=P.length===1;let gtDone=false,info='',ctrl='';
 // Cubes differ between builds (summer 240 mm, October 144 mm); draw every path on the first participant's cube.
 const refHalf=t.startsWith('Cube')?chosenSession(P[0],t)?.half:null,halves=new Set(refHalf?P.map(p=>Math.round((chosenSession(p,t)?.half||0)*2)).filter(Boolean):[]);
 const sc=g=>refHalf&&g.half&&Math.abs(g.half/refHalf-1)>.01?refHalf/g.half:1,scaleP=(pts,k)=>k===1?pts:pts.map(p=>p&&p.map(v=>v*k));
 for(const [pi,pid] of P.entries()){
  const g=chosenSession(pid,t);if(!g)continue;let tr=g.trials.filter(r=>r.task===t).sort((a,b)=>a.i-b.i);
  const one=PER_TRIAL.has(t)?(tr.find(r=>r.id===st.trial)||tr[0]):null;if(one)tr=[one];
  if(!gtDone){const gt=gtFor(g,t,one);const seen=new Set();for(const p of gt){const first=!seen.has(p.label);seen.add(p.label);traces.push(line(p.points,{name:p.label,legendgroup:p.label,showlegend:first,hoverinfo:'skip',line:{color:p.kind==='secondary'?'#9aa4a8':p.kind==='indicator'?'#3b8a5f':'#1c2226',width:p.kind==='ground'?6:3,dash:p.kind==='ground'?'solid':'dash'}}));}
   if(t.startsWith('Cube')&&g.half){const mids=TRACED.map(([a,b])=>CUBE[a].map((v,k)=>(v+CUBE[b][k])/2*g.half*1.14));traces.push({type:'scatter3d',mode:'text',x:mids.map(m=>m[0]),y:mids.map(m=>m[2]),z:mids.map(m=>m[1]),text:mids.map((_,i)=>String(i+1)),textfont:{size:13,color:'#1c2226'},hoverinfo:'skip',showlegend:false});}
   gtDone=true;}
  if(single){
   const gt=gtFor(g,t,one),pickT=!one&&st.pick?tr.filter(r=>r.id===st.pick):[],shown=pickT.length?pickT:tr,cube=t.startsWith('Cube');
   shown.forEach(r=>{const k=tr.indexOf(r),c=PCOL[k%PCOL.length],nm=`Trial ${r.i}${Number.isFinite(r.mean)?` (${fmt(r.mean)} mm)`:''}`;
    traces.push(line(r.p,{name:nm,legendgroup:'t'+r.i,line:{color:c,width:2.5},opacity:.85,hovertemplate:`Trial ${r.i}<extra></extra>`}));
    const a=r.p.find(Boolean),z=[...r.p].reverse().find(Boolean);if(a&&z)traces.push({type:'scatter3d',mode:'markers',x:[a[0],z[0]],y:[a[2],z[2]],z:[a[1],z[1]],marker:{size:[8,7],symbol:['circle','square'],color:c,line:{color:'#fff',width:1.5}},legendgroup:'t'+r.i,showlegend:false,hovertemplate:'%{text}<extra></extra>',text:[`Trial ${r.i} start`,`Trial ${r.i} end`]});});
   // Mean path for the cube only: its edges make the average along the ground truth meaningful.
   if(cube&&st.mean&&shown.length>1&&gt.length)binnedPaths(shown.flatMap(r=>r.p),gt,t,{bins:90,minN:3,stat:'mean'}).forEach((sg,j)=>traces.push(line(sg,{name:`Mean path (${shown.length} trials)`,legendgroup:'mean',showlegend:j===0,line:{color:'#6250d6',width:6},opacity:.9,hoverinfo:'skip'})));
   const m=avg(tr.map(r=>r.mean)),all3=g.trials.filter(r=>r.task===t).sort((a,b)=>a.i-b.i);
   const stat=one&&t==='Ellipse'?`aspect ${fmt(one.expected?.aspect,2)}: traced tilt ${fmt(one.shape?.slantDeg,1)}°, ${fmt(one.expected?.slantDeg,1)}° for a circle`:one?`${esc(one.rec?.cond||'')}${one.rec?.dir!=null?`, direction ${one.rec.dir>=0?'+':'−'}`:''}: ${m===null?'distance not recorded':`mean ${fmt(m)} mm`}`:t==='T2D'?'compared between trials, not with a target':m===null?'Distance not recorded':`mean ${fmt(m)} mm`;
   // September files: the trefoil's depth position in that build is not confirmed, so only X–Y is meaningful against it.
   const sepNote=t==='T2D'&&g.build==='autumn-legacy'?'<span class="warn">September build: the trefoil\'s depth position is not confirmed. Compare in X–Y (look from the front).</span>':'';
   info=`<strong>${esc(TASKNAME[t])}</strong><span>${esc(pid)}, session ${g.n}${g.date?`, ${fmtDate(g.date)}`:''}</span><span>${one?`trial ${one.i} of ${all3.length}`:`${tr.length} trial${tr.length>1?'s':''}`}</span><span>${stat}</span>${sepNote}`;
   if(one)info+=`<span class="sessPick">Trial ${all3.map(x=>`<button type="button" class="chip mini${x===one?' sel':''}" data-trial="${esc(x.id)}">${x.i}</button>`).join('')}</span>`;
   const segB=(k,l,on,attr)=>`<button type="button" class="segB${on?' on':''}" ${attr}="${k}" aria-pressed="${on}">${l}</button>`;
   ctrl=`<span class="vizCtl">`+
    (one?'':`<span class="segG" role="group" aria-label="Trials">${segB('','All trials',!st.pick||!tr.some(r=>r.id===st.pick),'data-pick')}${tr.map(r=>segB(r.id,'Trial '+r.i,st.pick===r.id,'data-pick')).join('')}</span>`)+
    (cube&&tr.length>1?`<label class="check"><input type="checkbox" id="vizMean"${st.mean?' checked':''}> <span class="meanKey"></span>Mean path</label>`:'')+
    `<span class="dim">● start&nbsp;&nbsp;■ end</span></span>`;
   const all=sessionsOf(pid,t);
   if(all.length>1)info+=`<span class="sessPick">Session ${all.map(x=>`<button type="button" class="chip mini${x===g?' sel':''}" data-sess="${x.key}">${x.n}</button>`).join('')}</span>`;
  }else{
   const c=PCOL[pi%PCOL.length];
   const gt=gtFor(g,t,null);
   if(t.startsWith('Cube')&&st.mean&&gt.length)binnedPaths(tr.flatMap(r=>r.p),gt,t,{bins:90,minN:3,stat:'mean'}).forEach((sg,k)=>traces.push(line(scaleP(sg,sc(g)),{name:pid+' mean path'+(sc(g)!==1?' (scaled)':''),legendgroup:pid,showlegend:k===0,line:{color:c,width:4}})));
   else tr.forEach((r,k)=>traces.push(line(scaleP(r.p,sc(g)),{name:pid,legendgroup:pid,showlegend:k===0,line:{color:c,width:2},opacity:.6})));
  }
 }
 if(!single)ctrl=t.startsWith('Cube')?`<span class="vizCtl"><label class="check"><input type="checkbox" id="vizMean"${st.mean?' checked':''}> Mean path per participant</label></span>`:'';
 if(!single)info=`<strong>${esc(TASKNAME[t])}</strong><span>${P.length} participants, latest session each</span><span>${t.startsWith('Cube')&&st.mean?'Mean path per participant':'All trials, one colour per participant'}</span>${halves.size>1?`<span class="warn">Cube sizes differ between datasets (${[...halves].map(h=>h+' mm').join(', ')}); paths are scaled to a ${Math.round(refHalf*2)} mm cube.</span>`:''}`;
 head.innerHTML=`<div class="vizInfo">${info}</div>${ctrl}`;
 head.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{st.pick=b.dataset.pick||null;renderViz();});
 $('vizMean')&&($('vizMean').onchange=e=>{st.mean=e.target.checked;renderViz();});
 head.querySelectorAll('[data-sess]').forEach(b=>b.onclick=()=>{st.session=b.dataset.sess;st.trial=null;st.pick=null;render();});
 head.querySelectorAll('[data-trial]').forEach(b=>b.onclick=()=>{st.trial=b.dataset.trial;render();});
 const ax=n=>({title:{text:n,font:{size:12}},gridcolor:'#e6e9e9',zerolinecolor:'#d7dcdc',color:'#5d696f',backgroundcolor:'rgba(0,0,0,0)',showspikes:false});
 const layout={paper_bgcolor:'rgba(0,0,0,0)',font:{family:'Inter, system-ui, sans-serif',size:12,color:'#1c2226'},margin:{l:0,r:0,t:0,b:0},showlegend:true,legend:{x:0,y:1,bgcolor:'rgba(255,255,255,.7)',font:{size:11}},
  scene:{aspectmode:'data',xaxis:ax('X (mm)'),yaxis:ax('Z depth (mm)'),zaxis:ax('Y (mm)'),camera:camFor(traces)},uirevision:t+'|'+P.join(',')+'|'+(st.session||'')};
 const draw=()=>window.Plotly.react(plot,traces,layout,{displaylogo:false,responsive:true,scrollZoom:false,modeBarButtonsToRemove:['toImage']});
 if(window.Plotly)draw();else addEventListener('load',draw,{once:true});
}

/* ---------- comparison ---------- */
const CMP=[['pp','Participant vs participant'],['tt','Trial vs trial'],['tg','Trial vs ground truth']];
function cmpState(){
 const t=st.task,P=selPeople(),r={};
 if(!t){for(const [k] of CMP)r[k]={ok:false,why:'Pick a task first.'};return r;}
 const withDist=g=>g.trials.some(x=>x.task===t&&Number.isFinite(x.mean));
 const n=peopleFor(t).filter(p=>sessionsOf(p,t).some(withDist)).length;
 const nSel=P.length;
 r.pp=nSel<2?{ok:false,why:peopleFor(t).length>1?'Select two or more participants.':'Only one participant has this task.'}:t==='Ellipse'?{ok:true}:t==='T2D'?{ok:false,why:'Drawing consistency is compared within a session; open Main Experiment.'}:{ok:n>1,why:n?`Only ${n} participant has distances for this task.`:'TargetError is not recorded for this task.'};
 const g=P.length===1?chosenSession(P[0],t):null,trials=g?g.trials.filter(x=>x.task===t):[];
 r.tt=P.length!==1?{ok:false,why:'Select one participant.'}:t==='T2D'?{ok:trials.length>1,why:'Needs two main trials.',link:true}:{ok:trials.some(x=>Number.isFinite(x.mean))||t==='Ellipse',why:'TargetError is not recorded for these trials.'};
 const gp=P.map(p=>chosenSession(p,t)).filter(Boolean),tt=gp.flatMap(x=>x.trials.filter(q=>q.task===t));
 r.tg=!P.length?{ok:false,why:'Select a participant.'}:t==='T2D'?{ok:gp.some(x=>gtFor(x,t,null).length),why:'No ground truth for these trials.'}:{ok:t==='Ellipse'?tt.some(x=>x.shape):tt.some(x=>Number.isFinite(x.mean)),why:t==='T3D_R'?'TargetError is empty for rotating 3D trefoil trials.':'No distance in these trials.'};
 return r;
}
function renderCompare(){
 const S=cmpState();
 if(!S[st.cmp]?.ok){const first=CMP.find(([k])=>S[k].ok);if(first)st.cmp=first[0];}
 $('cmpList').innerHTML=CMP.map(([k,l])=>`<button type="button" class="cmpRow${st.cmp===k&&S[k].ok?' sel':''}" data-cmp="${k}" ${S[k].ok?'':'disabled'} aria-pressed="${st.cmp===k}"><span>${l}</span>${k==='pp'&&st.task?`<small class="chipLine">${peopleFor(st.task).map(p=>`<i class="${st.people.has(p)?'on':''}">${esc(p)}</i>`).join('')}</small>`:''}${S[k].ok?'':`<small>${esc(S[k].why)}</small>`}</button>`).join('');
 $('cmpList').querySelectorAll('[data-cmp]').forEach(b=>b.onclick=()=>{st.cmp=b.dataset.cmp;renderCompare();});
 const box=$('cmpChart');
 if(!S[st.cmp]?.ok){box.innerHTML=`<p class="cmpEmpty">${esc(st.task?'Nothing to compare with the current selection.':'Pick a task to compare.')}</p>`;return;}
 box.innerHTML='<div class="cmpCap"><h3></h3><p></p></div><div class="cmpFig chart"></div>';
 const fig=box.querySelector('.cmpFig'),t=st.task,P=selPeople(),many=P.length>1;
 const TITLE={pp:'Mean distance, participant by participant',tt:t==='Ellipse'?'Traced tilt, trial by trial':t==='T2D'?'Main trials in this session':'Distance of every trial, in order',
  tg:t.startsWith('Cube')?'Distance from each cube edge':t==='Ellipse'?'Traced tilt against the tilt a circle would need':t==='T2D'?'X–Y distance from the 2D trefoil, per trial':'Distance to the ground truth, per trial'};
 box.querySelector('.cmpCap h3').textContent=TITLE[st.cmp];
 if(st.cmp==='pp')chartPeople(fig);else if(st.cmp==='tt')chartTrials(fig);else chartGT(fig);
 // The chart's own note becomes the description above it.
 const note=fig.querySelector('p.note');box.querySelector('.cmpCap h3').textContent=TITLE[st.cmp];box.querySelector('.cmpCap p').innerHTML=note?note.innerHTML:'';note?.remove();void many;
}
// Charts fill the comparison block's height so the page never needs to scroll.
// Height left for the chart under its title and description (about two lines).
const chartH=box=>{const h=box.classList.contains('cmpFig')?box.parentElement.clientHeight-54:(box.clientHeight||230);return Math.max(100,Math.min(300,h-22));};
function svgFrame(W,Hh){return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" style="max-width:100%" role="img">`;}
// About four gridlines whatever the range: steps of 1, 2, 5, 10, 20, 50…
const niceStep=m=>{const r=m/4,p=10**Math.floor(Math.log10(r)),f=r/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;};
function axisY(g,ymax,y,l,r,W,unit='mm'){const st=niceStep(ymax);for(let v=0;v<=ymax+1e-9;v+=st)g.push(`<line class="grid" x1="${l}" x2="${W-r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${l-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`);g.push(`<text class="axis" x="4" y="10">${unit}</text>`);}
function chartPeople(box){
 const t=st.task,W=Math.max(320,box.clientWidth),Hh=chartH(box),m={l:40,r:44,t:14,b:30};
 if(t==='Ellipse'){chartEllipsePeople(box,W);return;}
 const P=peopleFor(t).filter(p=>st.people.has(p)),series=P.map(p=>({p,s:sessionsOf(p,t).map(g=>({o:g.n,v:avg(g.trials.filter(x=>x.task===t).map(x=>x.mean))})).filter(d=>d.v!==null)})).filter(x=>x.s.length);
 const maxO=Math.max(...series.flatMap(x=>x.s.map(d=>d.o)),1),trialMax=Math.max(0,...series.flatMap(x=>chosenSession(x.p,t).trials.filter(q=>q.task===t).map(q=>q.mean)).filter(Number.isFinite)),ymax=Math.max(20,Math.ceil(Math.max(trialMax,...series.flatMap(x=>x.s.map(d=>d.v)))/10)*10);
 const g=[];
 if(maxO>1){
  const x=o=>m.l+(o-1)/(maxO-1)*(W-m.l-m.r),y=v=>Hh-m.b-v/ymax*(Hh-m.t-m.b);axisY(g,ymax,y,m.l,m.r,W);
  for(let o=1;o<=maxO;o+=maxO>12?2:1)g.push(`<text class="tick" x="${x(o)}" y="${Hh-m.b+14}" text-anchor="middle">${o}</text>`);g.push(`<text class="axis" x="${W-m.r}" y="${Hh-2}" text-anchor="end">Session</text>`);
  series.forEach((sr,k)=>{const c=PCOL[peopleFor(t).indexOf(sr.p)%PCOL.length];g.push(`<polyline fill="none" stroke="${c}" stroke-width="1.6" points="${sr.s.map(d=>x(d.o)+','+y(d.v)).join(' ')}"/>`);const last=sr.s.at(-1);g.push(`<text class="rlab" x="${x(last.o)+4}" y="${y(last.v)+4}" fill="${c}">${esc(sr.p)}</text>`);});
  box.innerHTML=svgFrame(W,Hh)+g.join('')+`</svg><p class="note">Mean distance per session, ${TASKNAME[t].toLowerCase()}. One line per selected participant.</p>`;
 }else{
  const rh=26,H2=series.length*rh+36,mx=ymax,x=v=>70+v/mx*(W-90);
  for(let v=0;v<=mx;v+=mx>30?10:5)g.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="6" y2="${H2-22}"/><text class="tick" x="${x(v)}" y="${H2-8}" text-anchor="middle">${v}</text>`);
  series.sort((a,b)=>a.s[0].v-b.s[0].v).forEach((sr,k)=>{const yy=16+k*rh,c=PCOL[peopleFor(t).indexOf(sr.p)%PCOL.length],g0=chosenSession(sr.p,t);
   g.push(`<text class="rlab" x="0" y="${yy+4}">${esc(sr.p)}</text>`);for(const tr of g0.trials.filter(q=>q.task===t&&Number.isFinite(q.mean)))g.push(`<circle cx="${x(tr.mean)}" cy="${yy}" r="3.5" fill="${c}" opacity=".55"/>`);g.push(`<line x1="${x(sr.s[0].v)}" x2="${x(sr.s[0].v)}" y1="${yy-8}" y2="${yy+8}" stroke="${c}" stroke-width="2.5"/><text class="rval" x="${W-14}" y="${yy+4}" text-anchor="end">${fmt(sr.s[0].v)}</text>`);});
  box.innerHTML=svgFrame(W,H2)+g.join('')+`</svg><p class="note">Mean distance in mm: dots are trials, the bar is the participant's mean.</p>`;
 }
}
function chartEllipsePeople(box,W){
 const P=peopleFor('Ellipse').filter(p=>st.people.has(p)),rows=P.map(p=>({p,t:chosenSession(p,'Ellipse').trials.filter(x=>x.task==='Ellipse'&&x.shape)}));
 const Hh=Math.max(140,rows.length*30+40),x=v=>80+v/90*(W-100),g=[];
 for(let v=0;v<=90;v+=15)g.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="6" y2="${Hh-22}"/><text class="tick" x="${x(v)}" y="${Hh-8}" text-anchor="middle">${v}°</text>`);
 rows.forEach((r,k)=>{const yy=18+k*30,c=PCOL[k%PCOL.length];g.push(`<text class="rlab" x="0" y="${yy+4}">${esc(r.p)}</text>`);for(const t of r.t){g.push(`<circle cx="${x(t.shape.slantDeg)}" cy="${yy}" r="4" fill="${c}"/><circle cx="${x(t.expected.slantDeg)}" cy="${yy}" r="4" fill="none" stroke="#1c2226"/>`);}});
 box.innerHTML=svgFrame(W,Hh)+g.join('')+'</svg><p class="note">Filled: traced tilt per trial. Open circle: tilt a circle would need.</p>';
}
function chartTrials(box){
 const t=st.task,pid=selPeople()[0],W=Math.max(320,box.clientWidth),Hh=chartH(box),m={l:40,r:16,t:14,b:30},g=[];
 if(t==='T2D'){const g0=chosenSession(pid,t);box.innerHTML=`<p class="cmpEmpty">${g0.trials.filter(x=>x.task==='T2D').length} main trials in ${esc(pid)} session ${g0.n}. Depth agreement between every pair of trials is on the Main Experiment page.</p><p><button type="button" class="btn small" id="cmpOpenDrw">Open pair analysis for this session</button></p>`;$('cmpOpenDrw').onclick=()=>{hooks.onDrawings?.(g0.raw);};return;}
 if(t==='Ellipse'){const g0=chosenSession(pid,t),tr=g0.trials.filter(x=>x.task==='Ellipse'&&x.shape),x=i=>m.l+(i+.5)/tr.length*(W-m.l-m.r),y=v=>Hh-m.b-v/90*(Hh-m.t-m.b);
  for(let v=0;v<=90;v+=15)g.push(`<line class="grid" x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l-6}" y="${y(v)+4}" text-anchor="end">${v}°</text>`);
  tr.forEach((r,i)=>{g.push(`<rect x="${x(i)-4}" y="${y(r.shape.slantDeg)}" width="8" height="${y(0)-y(r.shape.slantDeg)}" rx="3" fill="#2a78d6"/><line x1="${x(i)-8}" x2="${x(i)+8}" y1="${y(r.expected.slantDeg)}" y2="${y(r.expected.slantDeg)}" stroke="#1c2226" stroke-width="2"/><text class="tick" x="${x(i)}" y="${Hh-m.b+14}" text-anchor="middle">${r.i}</text>`);});
  box.innerHTML=svgFrame(W,Hh)+g.join('')+'</svg><p class="note">Bars: traced tilt per trial. Black line: tilt a circle would need.</p>';return;}
 const S=sessionsOf(pid,t),pts=[];S.forEach(s=>s.trials.filter(x=>x.task===t&&Number.isFinite(x.mean)).forEach((r,k,a)=>pts.push({o:s.n,xo:s.n-1+(k+.5)/a.length,v:r.mean,cur:s===chosenSession(pid,t),i:r.i})));
 const maxO=Math.max(1,...S.map(s=>s.n)),ymax=Math.max(20,Math.ceil(Math.max(...pts.map(p=>p.v))/10)*10),x=v=>m.l+v/maxO*(W-m.l-m.r),y=v=>Hh-m.b-v/ymax*(Hh-m.t-m.b);
 axisY(g,ymax,y,m.l,m.r,W);
 if(maxO>1)for(let o=1;o<=maxO;o+=maxO>12?2:1)g.push(`<text class="tick" x="${x(o-.5)}" y="${Hh-m.b+14}" text-anchor="middle">${o}</text>`);else pts.forEach(p=>g.push(`<text class="tick" x="${x(p.xo)}" y="${Hh-m.b+14}" text-anchor="middle">Trial ${p.i}</text>`));
 g.push(`<polyline fill="none" stroke="#b6c0c3" stroke-width="1.2" points="${pts.map(p=>x(p.xo)+','+y(p.v)).join(' ')}"/>`);
 for(const p of pts)g.push(`<circle cx="${x(p.xo)}" cy="${y(p.v)}" r="${p.cur?5:3.5}" fill="${p.cur?'#2563c9':'#7f8b90'}"><title>Session ${p.o}, trial ${p.i}: ${fmt(p.v)} mm</title></circle>`);
 box.innerHTML=svgFrame(W,Hh)+g.join('')+`</svg><p class="note">Mean distance of every ${TASKNAME[t].toLowerCase()} trial for ${esc(pid)}${maxO>1?', in session order. Blue: the session shown above.':'.'}</p>`;
}
const ENAME=['Front bottom','Front right','Front top','Front left','Connecting','Back bottom','Back right','Back top','Back left'];
// Main 2D trefoil: depth is free, so the comparison with the ground truth is the X–Y distance to the curve.
function xyDistance(r,gt){
 if(r._xy)return r._xy;const pts=[];
 for(const p of gt.filter(q=>q.kind==='ground'))for(let i=1;i<p.points.length;i++){const a=p.points[i-1],b=p.points[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1));for(let k=0;k<n;k++)pts.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}
 const d=r.p.filter(Boolean).map(p=>{let m=Infinity;for(const q of pts){const v=Math.hypot(p[0]-q[0],p[1]-q[1]);if(v<m)m=v;}return m;}).sort((x,y)=>x-y);
 return r._xy=d.length?{mean:d.reduce((x,y)=>x+y,0)/d.length,p95:d[Math.floor(d.length*.95)]}:{mean:null,p95:null};
}
function gtValues(g0,t){
 const tr=g0.trials.filter(x=>x.task===t).sort((a,b)=>a.i-b.i);
 if(t==='T2D'){const gt=gtFor(g0,t,null);return tr.map(r=>({r,...xyDistance(r,gt)}));}
 return tr.map(r=>({r,mean:r.mean,p95:r.p95}));
}
function chartGT(box){
 const t=st.task,P=selPeople(),W=Math.max(320,box.clientWidth),g=[],unit=t==='T2D'?'X–Y distance to the 2D trefoil':'Distance to the ground truth';
 if(t==='Ellipse'){if(P.length===1)chartTrials(box);else chartEllipsePeople(box,W);return;}
 const col=p=>PCOL[peopleFor(t).indexOf(p)%PCOL.length];
 if(t.startsWith('Cube')){
  const rows=P.map(p=>{const g0=chosenSession(p,t),tr=g0.trials.filter(x=>x.task===t);return {p,g0,v:ENAME.map((_,e)=>avg(tr.map(x=>x.edges?.[e]?.mean)))};}).filter(x=>x.v.some(Number.isFinite));
  if(rows.length){
   const mx=Math.ceil(Math.max(...rows.flatMap(x=>x.v.filter(Number.isFinite)))/5)*5||5,rh=Math.max(13,Math.min(22,(chartH(box)-18)/9)),Hh=9*rh+20,x=v=>140+v/mx*(W-190);
   for(let v=0;v<=mx;v+=mx>20?10:5)g.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="2" y2="${Hh-20}"/><text class="tick" x="${x(v)}" y="${Hh-6}" text-anchor="middle">${v}</text>`);
   ENAME.forEach((n,e)=>{const yy=6+e*rh;g.push(`<text class="rlab" x="0" y="${yy+11}">${e+1} ${n}</text>`);
    if(rows.length===1){const v=rows[0].v[e];g.push(`<rect x="140" y="${yy+7-3}" width="${Math.max(2,x(v||0)-140)}" height="6" rx="3" fill="${e===4?'#245c80':'#7fa3b8'}"/><text class="rval" x="${x(v||0)+6}" y="${yy+11}">${fmt(v)}</text>`);}
    else rows.forEach(r=>{const v=r.v[e];if(Number.isFinite(v))g.push(`<circle cx="${x(v)}" cy="${yy+7}" r="4.5" fill="${col(r.p)}"><title>${esc(r.p)}, edge ${e+1}: ${fmt(v)} mm</title></circle>`);});});
   const key=rows.length>1?`<ul class="legend static">${rows.map(r=>`<li><i style="background:${col(r.p)};border-radius:50%"></i>${esc(r.p)}</li>`).join('')}</ul>`:'';
   box.innerHTML=svgFrame(W,Hh)+g.join('')+`</svg>${key}<p class="note">Mean distance from each cube edge, mm${rows.length===1?`, over the trials of ${esc(rows[0].p)} session ${rows[0].g0.n}`:', latest session of each participant'}. Edge 5 runs into depth.</p>`;return;}
 }
 if(P.length===1){
  const g0=chosenSession(P[0],t),ok=gtValues(g0,t).filter(x=>Number.isFinite(x.mean)),Hh=chartH(box),m={l:40,r:16,t:14,b:30},ymax=Math.max(10,Math.ceil(Math.max(...ok.map(x=>x.p95??x.mean))/10)*10),x=i=>m.l+(i+.5)/ok.length*(W-m.l-m.r),y=v=>Hh-m.b-v/ymax*(Hh-m.t-m.b);
  axisY(g,ymax,y,m.l,m.r,W);
  ok.forEach((d,i)=>{g.push(`<rect x="${x(i)-4}" y="${y(d.mean)}" width="8" height="${y(0)-y(d.mean)}" rx="3" fill="#2a78d6"><title>Trial ${d.r.i}: ${fmt(d.mean)} mm</title></rect>`);if(Number.isFinite(d.p95))g.push(`<line x1="${x(i)-7}" x2="${x(i)+7}" y1="${y(d.p95)}" y2="${y(d.p95)}" stroke="#1c2226" stroke-width="1.6"/>`);g.push(`<text class="tick" x="${x(i)}" y="${Hh-m.b+14}" text-anchor="middle">${d.r.i}</text>`);});
  box.innerHTML=svgFrame(W,Hh)+g.join('')+`</svg><p class="note">Bars: ${unit.toLowerCase()} per trial, mm. Tick: 95th percentile. ${esc(P[0])} session ${g0.n}.</p>`;return;}
 const rows=P.map(p=>({p,v:gtValues(chosenSession(p,t),t).map(d=>d.mean).filter(Number.isFinite)})).filter(x=>x.v.length),mx=Math.max(10,Math.ceil(Math.max(...rows.flatMap(x=>x.v))/10)*10),rh=26,Hh=rows.length*rh+30,x=v=>70+v/mx*(W-110);
 for(let v=0;v<=mx;v+=mx>30?10:5)g.push(`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="4" y2="${Hh-20}"/><text class="tick" x="${x(v)}" y="${Hh-6}" text-anchor="middle">${v}</text>`);
 rows.sort((a,b)=>avg(a.v)-avg(b.v)).forEach((r,k)=>{const yy=14+k*rh,c=col(r.p),m=avg(r.v);g.push(`<text class="rlab" x="0" y="${yy+4}">${esc(r.p)}</text>`);for(const v of r.v)g.push(`<circle cx="${x(v)}" cy="${yy}" r="3.5" fill="${c}" opacity=".55"/>`);g.push(`<line x1="${x(m)}" x2="${x(m)}" y1="${yy-8}" y2="${yy+8}" stroke="${c}" stroke-width="2.5"/><text class="rval" x="${W-8}" y="${yy+4}" text-anchor="end">${fmt(m)}</text>`);});
 box.innerHTML=svgFrame(W,Hh)+g.join('')+`</svg><p class="note">${unit}, mm: dots are trials, the bar is the participant's mean. Latest session of each participant.</p>`;
}

/* ---------- wiring ---------- */
export function render(){renderDatasets();renderTasks();renderPeople();renderViz();renderCompare();}
export function redraw(){if(window.Plotly&&!$('vizPlot').hidden)window.Plotly.Plots.resize($('vizPlot'));renderCompare();}
async function filesFromDrop(dt){
 const items=[...dt.items||[]].map(i=>i.webkitGetAsEntry?.()).filter(Boolean);if(!items.length)return {files:[...dt.files],name:null};
 const out=[];const walk=async e=>{if(e.isFile)out.push(await new Promise((r,j)=>e.file(r,j)));else if(e.isDirectory){const rd=e.createReader();let b;do{b=await new Promise((r,j)=>rd.readEntries(r,j));for(const x of b)await walk(x);}while(b.length);}};
 for(const e of items)await walk(e);return {files:out,name:items.length===1&&items[0].isDirectory?items[0].name:null};
}
export function init(){
 const menu=$('dsMenu'),add=$('dsAdd');
 add.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;add.setAttribute('aria-expanded',String(!menu.hidden));};
 document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==add){menu.hidden=true;add.setAttribute('aria-expanded','false');}});
 $('dsFiles').onchange=e=>{menu.hidden=true;if(e.target.files.length)addFiles(e.target.files,null);e.target.value='';};
 $('dsFolder').onchange=e=>{menu.hidden=true;const f=[...e.target.files];if(f.length)addFiles(f,(f[0].webkitRelativePath||'').split('/')[0]||null);e.target.value='';};
 document.querySelectorAll('.card .fold').forEach(b=>b.onclick=()=>{const body=$(b.getAttribute('aria-controls')),open=b.getAttribute('aria-expanded')==='true';body.hidden=open;b.setAttribute('aria-expanded',String(!open));b.classList.toggle('closed',open);});
 const zone=$('dash');
 for(const ev of ['dragenter','dragover'])zone.addEventListener(ev,e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();$('cardDatasets').classList.add('over');}});
 for(const ev of ['dragleave','drop'])zone.addEventListener(ev,e=>{if(ev==='dragleave'&&zone.contains(e.relatedTarget))return;$('cardDatasets').classList.remove('over');});
 zone.addEventListener('drop',async e=>{e.preventDefault();const {files,name}=await filesFromDrop(e.dataTransfer);if(files.length)addFiles(files,name);});
 render();
}
