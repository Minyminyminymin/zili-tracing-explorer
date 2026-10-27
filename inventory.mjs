// "Data files" page: groups dropped files into participants and sessions and says which analyses each set supports.
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate=d=>d?`${+d.slice(6,8)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+d.slice(4,6)-1]} ${d.slice(0,4)}`:'—';
const fmtTime=t=>t?`${t.slice(0,2)}:${t.slice(2,4)}`:'';
const mb=b=>b>=1e6?`${(b/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(b/1e3))} kB`;
const LAB=new Set(['AA','AZ','EC','EM','IL','JP','MM','ZZ']);// built-in summer calibration participants
const TASKS=[['Cube','Cube'],['Trefoil3D','Trefoil 3D'],['Sphere','Sphere'],['Ellipse','Ellipse'],['Trefoil2D','Main trefoil']];
const LEGACY_TYPE={cube_static:['Cube','Static'],cube_rotating:['Cube','Rotating'],trefoil3d_static:['Trefoil3D','Static'],trefoil3d_rotating:['Trefoil3D','Rotating'],trefoil2d_static:['Trefoil2DCal','Static']};

let inv=null;const fileByName=new Map();
export const hooks={onOpen:null};
export function current(){return inv;}
const worker=new Worker(new URL('./inventory-worker.mjs',import.meta.url),{type:'module'});
let job=0;const waits=new Map();
worker.onmessage=e=>{const w=waits.get(e.data.id);if(!w)return;waits.delete(e.data.id);e.data.error?w.reject(Error(e.data.error)):w.resolve(e.data.files);};

export async function addFiles(list){
 const files=[...list].filter(f=>/\.(csv|txt)$/i.test(f.name));
 if(!files.length)throw Error('No CSV files were found in what was dropped.');
 for(const f of files)fileByName.set(f.name,f);
 const id=++job,scanned=await new Promise((resolve,reject)=>{waits.set(id,{resolve,reject});worker.postMessage({id,files});});
 const prev=inv?.files||[],names=new Set(scanned.map(f=>f.name));
 inv=build([...prev.filter(f=>!names.has(f.name)),...scanned]);
 return inv;
}
export function clear(){inv=null;fileByName.clear();}

/* ---------- grouping ---------- */
function build(files){
 const sessions=new Map(),loose=[];
 for(const f of files){
  if(f.kind==='hmdLog'||f.kind==='unknown'){loose.push(f);continue;}
  const pid=f.pid||(f.kind==='info'?f.summary?.pid:null);
  const key=f.build==='current'?`${pid}_S${f.session}_${f.date}_${f.time}`:pid?`${pid}_${f.date}_${f.label||'?'}`:`noid_${f.date}_${f.time||f.label||'?'}`;
  if(!sessions.has(key))sessions.set(key,{key,pid,session:f.session,label:f.label,date:f.date,time:f.time,files:[],hmd:[]});
  sessions.get(key).files.push(f);
 }
 for(const s of sessions.values()){
  s.build=s.files.some(f=>f.kind==='trials'||f.kind==='samples')?'current':'summer';
  const infoF=s.files.find(f=>f.kind==='info');if(infoF?.summary){s.info=infoF.summary;s.pid=s.pid||infoF.summary.pid;}
  s.tasks=taskCounts(s);
  s.test=/^test/i.test(s.pid||'')||s.files.some(f=>/test/i.test(f.label||''));
 }
 // A continuous HMD log names no participant; attach it to the session saved soonest after it started, the same day.
 const list=[...sessions.values()];
 for(const f of loose.filter(f=>f.kind==='hmdLog')){
  const same=list.filter(s=>s.date===f.date);
  const timed=same.filter(s=>s.time&&f.time&&s.time>f.time).map(s=>({s,gap:secs(s.time)-secs(f.time)})).filter(x=>x.gap<=3*3600).sort((a,b)=>a.gap-b.gap);
  if(timed.length){timed[0].s.hmd.push({file:f,how:`started ${Math.round(timed[0].gap/60)} min before this session was saved`});f.attached=timed[0].s.key;}
  else if(same.length===1){same[0].hmd.push({file:f,how:'only session that day'});f.attached=same[0].key;}
  else f.candidates=same.map(s=>label(s));
 }
 for(const s of list)for(const f of s.files)if(f.kind==='hmdTrial')s.hmd.push({file:f,how:'per-trial HMD export'});
 // Session order per participant (by date, then label), as on the summer pages.
 const byP={};for(const s of list)(byP[s.pid||'(no ID)']??=[]).push(s);
 for(const arr of Object.values(byP)){arr.sort((a,b)=>(a.date+(a.time||'')+(a.label||'')).localeCompare(b.date+(b.time||'')+(b.label||'')));arr.forEach((s,i)=>s.order=i+1);}
 list.sort((a,b)=>(a.pid||'~').localeCompare(b.pid||'~')||a.order-b.order);
 for(const s of list)s.analyses=analyses(s);
 return {files,sessions:list,loose,participants:[...new Set(list.map(s=>s.pid).filter(Boolean))].sort(),dates:[...new Set(list.map(s=>s.date))].sort()};
}
const secs=t=>+t.slice(0,2)*3600+ +t.slice(2,4)*60+ +t.slice(4,6);
export const label=s=>`${s.pid||'No ID'} ${s.build==='current'?`S${s.session}`:s.label||fmtTime(s.time)||''}`.trim();
function taskCounts(s){
 const out={};const add=(t,c,n)=>{out[t]??={trials:0,conds:{}};out[t].trials+=n;if(c)out[t].conds[c]=(out[t].conds[c]||0)+n;};
 const tr=s.files.find(f=>f.kind==='trials'),sm=s.files.find(f=>f.kind==='samples');
 if(tr?.summary)for(const [t,v] of Object.entries(tr.summary.tasks))for(const [c,n] of Object.entries(v.conds))add(t,c,n);
 else if(sm?.summary)for(const [t,v] of Object.entries(sm.summary.tasks))add(t,'',v.trials);
 if(s.build==='summer'){
  for(const f of s.files){
   if(f.kind==='calibLegacy'&&f.summary)for(const [ty,v] of Object.entries(f.summary.types)){const [t,c]=LEGACY_TYPE[ty]||[ty,''];add(t,c,v.trials);}
   if(f.kind==='mainLegacy'&&f.summary)add('Trefoil2D','',f.summary.trials);
   if(f.kind==='ellipseSummary'&&f.summary&&!s.files.some(g=>g.kind==='ellipseTraj'))add('Ellipse','',f.summary.trials);
   if(f.kind==='ellipseTraj'&&f.summary)add('Ellipse','',f.summary.trials);
  }
 }
 return out;
}

/* ---------- what each session supports ---------- */
const A=[
 ['cube','Cube accuracy','Distance from the cube edges, per trial and condition.'],
 ['t3d','Trefoil 3D accuracy','Distance from the 3D trefoil.'],
 ['sphere','Sphere accuracy','Distance from the sphere target (equator and outline).'],
 ['ellipse','Ellipse tilt','Traced tilt against the tilt a circle would need.'],
 ['drawings','Drawing consistency','Depth difference between repeated main-trefoil drawings.'],
 ['hmd','Head movement','Head position and rotation during the session.'],
];
function analyses(s){
 const r={},tr=s.files.find(f=>f.kind==='trials'),sm=s.files.find(f=>f.kind==='samples'),T=s.tasks,cur=s.build==='current';
 const empty=(task)=>{const st=sm?.summary?.tasks?.[task];if(!st)return null;return Object.entries(st.errRows).map(([c,n])=>({c,n,e:st.errEmpty[c]||0}));};
 const n=t=>T[t]?.trials||0;
 // accuracy tasks in the current build need Trials (geometry) + Samples (TargetError)
 const acc=(key,task)=>{
  if(!n(task)){r[key]={st:'none'};return;}
  if(!cur){r[key]=task==='Cube'&&LAB.has(s.pid)&&s.date>='20260623'&&s.date<='20260827'?{st:'yes',why:'Summer format. Included in the Summer calibration pages.',where:`#/calibration/${s.pid}`}:{st:'no',why:'Summer per-task format; only cube files from the 8 lab participants (23 Jun – 27 Aug) are analysed on this site.'};return;}
  if(!tr||!sm){r[key]={st:'no',why:`Needs both the Trials and the Samples file; ${tr?'Samples':'Trials'} is missing.`};return;}
  if(!sm.summary?.tasks?.[task]){r[key]={st:'no',why:`Trials lists ${n(task)} trials, but the Samples file has no samples for them.`};return;}
  const e=empty(task)||[],full=e.filter(x=>x.e===x.n),some=e.filter(x=>x.e>0&&x.e<x.n);
  if(full.length===e.length&&e.length){r[key]={st:'no',why:'TargetError is empty in every sample.'};return;}
  if(full.length||some.length){r[key]={st:'part',why:[...full.map(x=>`${x.c||'some'} trials: TargetError empty in every sample`),...some.map(x=>`${x.c||'some'} trials: TargetError empty in ${x.e} of ${x.n} samples`)].join('; ')+'.'};return;}
  r[key]={st:'yes',why:`${n(task)} trials.`};
 };
 acc('cube','Cube');acc('t3d','Trefoil3D');acc('sphere','Sphere');
 if(r.sphere?.st==='yes'&&!tr)r.sphere={st:'no',why:'Needs the Trials file for the sphere centre.'};
 // ellipse
 if(!n('Ellipse'))r.ellipse={st:'none'};
 else if(!cur)r.ellipse={st:'no',why:'Summer ellipse files use the older per-task format, which this site does not analyse.'};
 else if(!tr||!sm)r.ellipse={st:'no',why:'Needs the Trials file (aspect ratio) and the Samples file (local coordinates).'};
 else if(!sm.summary?.tasks?.Ellipse)r.ellipse={st:'no',why:'Trials lists ellipse trials, but the Samples file has no samples for them.'};
 else r.ellipse=sm.summary.tasks.Ellipse.local?{st:'yes',why:`${n('Ellipse')} trials.`}:{st:'no',why:'Samples has no local (disk-frame) coordinates.'};
 // main drawings
 const m=n('Trefoil2D');
 if(!m)r.drawings={st:'none'};
 else if(m<2)r.drawings={st:'no',why:'Needs at least two main trials.'};
 else if(cur){const k=sm?.summary?.tasks?.Trefoil2D?.trials||0;r.drawings=!(tr&&sm)?{st:'no',why:'Needs both the Trials and the Samples file.'}:k<2?{st:'no',why:`Trials lists ${m} main trials, but the Samples file has ${k===0?'none':'only one'}.`}:{st:'yes',why:`${k} trials, ${k*(k-1)/2} pairs.`};}
 else r.drawings={st:'part',why:'Summer main-trial file. The pair analysis runs on it, but the trefoil centre and scale must be set by hand under Methods.'};
 // HMD
 if(s.hmd.length)r.hmd={st:'part',why:`HMD data present (${s.hmd.map(h=>`${h.file.name}, ${h.how}`).join('; ')}). Not analysed on this site yet.`};
 else r.hmd={st:'no',why:'No HMD file for this session.'};
 r.open=cur&&tr&&sm&&sm.rows>0;
 return r;
}

/* ---------- page ---------- */
const ST={yes:['Yes','yes'],part:['Partly','part'],no:['No','no'],none:['Not in data','none']};
export function render(){
 if(!inv){$('dAnswer').textContent='No files added yet. Drop data files on the Overview page.';['dSessions','dMatrix','dAcross','dFiles'].forEach(id=>$(id).innerHTML='');$('dNotes').innerHTML='';return;}
 const S=inv.sessions,P=inv.participants,hm=S.filter(s=>s.hmd.length).length,unk=inv.loose.filter(f=>f.kind==='unknown').length,noid=S.filter(s=>!s.pid).length;
 const range=inv.dates.length?inv.dates.length===1?fmtDate(inv.dates[0]):`${fmtDate(inv.dates[0])} to ${fmtDate(inv.dates.at(-1))}`:'';
 $('dAnswer').textContent=`${inv.files.length} files: ${P.length} participant${P.length===1?'':'s'} (${P.join(', ')||'none named'})${noid?` plus ${noid} session${noid>1?'s':''} without an ID`:''}, ${S.length} session${S.length===1?'':'s'}, ${range}. ${hm} of ${S.length} sessions have HMD data.${unk?` ${unk} file${unk>1?'s were':' was'} not recognised.`:''}`;
 // sessions table
 let h=`<thead><tr><th scope="col">Participant</th><th scope="col">Session</th><th scope="col">Date</th><th scope="col">Format</th>${TASKS.map(([,l])=>`<th scope="col" class="num">${l}</th>`).join('')}<th scope="col">HMD</th><th scope="col"></th></tr></thead><tbody>`;
 for(const s of S){
  const cell=t=>{const v=s.tasks[t];if(!v)return '<td class="num dim">—</td>';const c=Object.entries(v.conds).map(([k,n])=>`${n} ${k.replace('AspectRatio_','aspect ').toLowerCase()}`).join(', ');return `<td class="num" title="${esc(c)}">${v.trials}${c&&Object.keys(v.conds).length>1?`<small>${esc(c)}</small>`:''}</td>`;};
  h+=`<tr><th scope="row">${esc(s.pid||'No ID')}${s.test?' <small>test</small>':''}</th><td>${s.build==='current'?`S${s.session}`:esc(s.label||'')} <span class="dim">#${s.order}</span></td><td>${fmtDate(s.date)}${s.time?` <span class="dim">${fmtTime(s.time)}</span>`:''}</td><td>${s.build==='current'?'Current':'Summer'}</td>${TASKS.map(([t])=>cell(t)).join('')}<td>${s.hmd.length?'Yes':'<span class="dim">No</span>'}</td><td>${s.analyses.open?`<button class="btn small" type="button" data-open="${esc(s.key)}">Open</button>`:''}</td></tr>`;
 }
 $('dSessions').innerHTML=h+'</tbody>';
 $('dSessions').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openSession(b.dataset.open,b));
 // analysis matrix
 let mtx=`<thead><tr><th scope="col">Analysis</th>${S.map(s=>`<th scope="col">${esc(label(s))}<small>${fmtDate(s.date)}</small></th>`).join('')}</tr></thead><tbody>`;
 for(const [k,name,desc] of A){mtx+=`<tr><th scope="row">${name}<small>${desc}</small></th>`;for(const s of S){const a=s.analyses[k],[t,cls]=ST[a.st];mtx+=`<td class="st ${cls}" title="${esc(a.why||'')}">${a.where?`<a href="${a.where}">${t}</a>`:t}</td>`;}mtx+='</tr>';}
 $('dMatrix').innerHTML=mtx+'</tbody>';
 // reasons, grouped
 const reasons=new Map();
 for(const s of S)for(const [k,name] of A){const a=s.analyses[k];if((a.st==='no'||a.st==='part')&&a.why){const key=name+': '+a.why.replace(/\([^)]*\)/g,'').replace(/\d+ of \d+/g,'some');if(!reasons.has(key))reasons.set(key,{name,why:a.why,st:a.st,who:[]});reasons.get(key).who.push(label(s));}}
 $('dNotes').innerHTML=[...reasons.values()].map(r=>`<li><strong>${r.name}, ${ST[r.st][0].toLowerCase()}.</strong> ${esc(r.why)} <span class="dim">${esc(r.who.join(', '))}</span></li>`).join('')||'<li>Every analysis that has data in these files can run.</li>';
 // across sessions
 const acr=[],byP={};for(const s of S)if(s.pid&&!s.test)(byP[s.pid]??=[]).push(s);
 if(S.some(s=>s.test))acr.push(`<li><strong>Test sessions</strong> (${esc(S.filter(s=>s.test).map(label).join(', '))}) are listed but left out of the comparisons below.</li>`);
 const multi=Object.entries(byP).filter(([,a])=>a.length>1);
 acr.push(multi.length?`<li><strong>Change across sessions:</strong> possible for ${multi.map(([p,a])=>`${p} (${a.length} sessions)`).join(', ')}.${multi.some(([,a])=>new Set(a.map(x=>x.build)).size>1)?' Summer and current sessions use different stimulus geometry, so compare distances, not positions.':''}</li>`:'<li><strong>Change across sessions:</strong> not possible yet; every participant has one session in these files.</li>');
 const cube=Object.entries(byP).filter(([,a])=>a.some(x=>x.analyses.cube.st==='yes'));
 acr.push(cube.length>1?`<li><strong>Comparison between participants:</strong> possible for cube accuracy (${cube.map(([p])=>p).join(', ')}). With ${cube.length} participants, treat differences as descriptive.</li>`:'<li><strong>Comparison between participants:</strong> needs at least two participants with cube data.</li>');
 const views=[...new Set(S.filter(s=>!s.test).flatMap(s=>s.files.find(f=>f.kind==='trials')?.summary?.viewing||[]))].filter(v=>!v.includes('?'));
 if(views.length)acr.push(`<li><strong>Viewing modes recorded:</strong> ${esc(views.join('; '))}.</li>`);
 $('dAcross').innerHTML=acr.join('');
 // files
 const all=[...S.flatMap(s=>s.files.map(f=>({f,s}))),...inv.loose.map(f=>({f,s:f.attached?S.find(x=>x.key===f.attached):null}))];
 const dup=(f,s)=>s?.build==='current'&&['calibLegacy','mainLegacy','ellipseSummary','ellipseTraj','sphereLegacy'].includes(f.kind);
 $('dFiles').innerHTML=`<thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Session</th><th scope="col" class="num">Size</th><th scope="col">Note</th></tr></thead><tbody>${all.map(({f,s})=>`<tr><th scope="row" class="fname">${esc(f.name)}</th><td>${esc(f.kindLabel)}</td><td>${s?esc(label(s)):'<span class="dim">—</span>'}</td><td class="num">${mb(f.size)}</td><td class="dim">${dup(f,s)?'Older per-task copy of data that is also in Samples; not needed.':f.kind==='hmdLog'?(s?'Matched by time.':f.candidates?.length?`Same day as ${esc(f.candidates.join(', '))}; could not tell which.`:'No session that day in these files.'):f.kind==='unknown'?'Header not recognised.':f.summary?.partial?'Large file; read in part.':''}</td></tr>`).join('')}</tbody>`;
}
async function openSession(key,btn){
 const s=inv.sessions.find(x=>x.key===key);if(!s)return;
 const files=s.files.filter(f=>['trials','samples','info'].includes(f.kind)).map(f=>fileByName.get(f.name)).filter(Boolean);
 btn.disabled=true;btn.textContent='Opening…';
 try{await hooks.onOpen?.(files);}finally{btn.disabled=false;btn.textContent='Open';}
}
export function csv(){
 if(!inv)return '';
 const head=['participant','session','order','date','time','format',...TASKS.map(([t])=>t+'_trials'),'hmd',...A.map(([k])=>k),...A.map(([k])=>k+'_note')];
 const rows=inv.sessions.map(s=>[s.pid||'',s.build==='current'?s.session:s.label||'',s.order,s.date,s.time||'',s.build,...TASKS.map(([t])=>s.tasks[t]?.trials||0),s.hmd.length?'yes':'no',...A.map(([k])=>s.analyses[k].st),...A.map(([k])=>`"${(s.analyses[k].why||'').replace(/"/g,"'")}"`)]);
 return [head.join(','),...rows.map(r=>r.join(','))].join('\n');
}
