const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const scope=params.get('scope')==='full'?'full':'calibration';
const CALIB_TASKS=new Set(['Cube','Trefoil3D','Sphere']);
const fmt=(v,n=3)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toFixed(n);
const num=v=>v===undefined||v===null||String(v).trim()===''?null:Number(v);
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const quantile=(a,q)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),p=(b.length-1)*q,i=Math.floor(p),f=p-i;return b[i+1]===undefined?b[i]:b[i]+f*(b[i+1]-b[i])};
const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x};
let sessions=new Map(),active=null,frame='world',view='3d',playTime=Infinity,playing=false,raf=null,lastTs=null,yaw=.65,pitch=.45,zoom=1,projected=[];

$('scopeBadge').textContent=scope==='calibration'?'Calibration-only':'Full session';
$('scopeBadge').className='badge '+scope;
$('scopeNote').textContent=scope==='calibration'
  ?'Calibration-only scope: Cube, Trefoil3D and Sphere are available. Ellipse and all Trefoil2D main trials are intentionally excluded from the loaded in-memory view.'
  :'Full scope: Cube, Trefoil3D, Sphere, Ellipse and Trefoil2D are available.';
$('privacyNote').textContent=scope==='calibration'
  ?'This is a viewing restriction, not a security boundary: if someone possesses the original full CSV files, they can still open those files outside this page.'
  :'Full-session mode includes main and ellipse data.';
$('fullOnly').hidden=scope!=='full';
if(scope==='calibration'){
  document.querySelector('a[href="index.html"]').hidden=true;
}

function status(s,error=false){$('status').textContent=s;$('status').className=error?'error':''}
function parseCSV(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(ch===','&&!quoted){row.push(cell);cell=''}
    else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}
    else cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  if(rows.length<2)throw Error('CSV has no data rows.');
  const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
function classify(name,rows){
  const h=rows[0]||{};
  if('TrialID' in h&&'ExpectedDuration' in h&&'Task' in h)return 'trials';
  if('TrialID' in h&&'SampleIndex' in h&&'WorldX' in h&&'Task' in h)return 'samples';
  if('TrialID' in h&&'HMDFrameIndex' in h)return 'hmd';
  if(/_Trials_/i.test(name))return 'trials';
  if(/_Samples_/i.test(name))return 'samples';
  if(/_HMD_/i.test(name))return 'hmd';
  return null;
}
function sessionKey(name,kind){
  const re=new RegExp('_(?:'+kind+')_(\\d{8}_\\d{6})\\.csv$','i');
  const m=name.match(re);
  if(m)return name.replace(re,'');
  return name.replace(/_(Trials|Samples|HMD)_.*\.csv$/i,'').replace(/\.csv$/i,'');
}
function visibleTask(task){return scope==='full'||CALIB_TASKS.has(task)}
function joinSession(s){
  if(!s.trials||!s.samples)return;
  const sampleGroups=new Map();
  for(const r of s.samples){
    if(!visibleTask(r.Task))continue;
    if(!sampleGroups.has(r.TrialID))sampleGroups.set(r.TrialID,[]);
    sampleGroups.get(r.TrialID).push(r);
  }
  const hmdGroups=new Map();
  for(const r of s.hmd||[]){
    if(!visibleTask(r.Task))continue;
    if(!hmdGroups.has(r.TrialID))hmdGroups.set(r.TrialID,[]);
    hmdGroups.get(r.TrialID).push(r);
  }
  s.joined=s.trials.filter(t=>visibleTask(t.Task)).map(t=>({
    meta:t,
    samples:(sampleGroups.get(t.TrialID)||[]).sort((a,b)=>(num(a.TimeSec)||0)-(num(b.TimeSec)||0)),
    hmd:(hmdGroups.get(t.TrialID)||[]).sort((a,b)=>(num(a.TrialTimeSec)||0)-(num(b.TrialTimeSec)||0))
  })).filter(t=>t.samples.length);
}
async function loadFiles(files){
  status('Reading session CSVs…');
  sessions=new Map();
  for(const f of files){
    if(f.size>60*1024*1024){status('A selected file is larger than 60 MB.',true);return}
    let rows;
    try{rows=parseCSV(await f.text())}catch(e){status(f.name+': '+e.message,true);return}
    const kind=classify(f.name,rows);if(!kind)continue;
    const key=sessionKey(f.name,kind);
    if(!sessions.has(key))sessions.set(key,{key,trials:null,samples:null,hmd:null,names:{}});
    const s=sessions.get(key);s[kind]=rows;s.names[kind]=f.name;
  }
  for(const s of sessions.values())joinSession(s);
  for(const [k,s] of [...sessions])if(!s.joined?.length)sessions.delete(k);
  if(!sessions.size){status('No complete unified session found. Select matching *_Trials_*.csv and *_Samples_*.csv files.',true);resetUI();return}
  status('');
  populateSessions();
}
function resetUI(){$('controls').hidden=true;$('viewer').hidden=true;$('errorPanel').hidden=true;$('sessionCount').textContent='0';$('trialCount').textContent='0';$('sampleCount').textContent='0';$('hmdState').textContent='not loaded'}
function populateSessions(){
  $('controls').hidden=false;
  const sel=$('sessionSelect');sel.replaceChildren();
  for(const s of sessions.values()){const o=el('option','',s.key);o.value=s.key;sel.append(o)}
  $('sessionCount').textContent=sessions.size;
  sel.onchange=populateTasks;
  populateTasks();
}
function currentSession(){return sessions.get($('sessionSelect').value)}
function populateTasks(){
  const s=currentSession();if(!s)return;
  const tasks=[...new Set(s.joined.map(x=>x.meta.Task))];
  const order=['Cube','Trefoil3D','Sphere','Ellipse','Trefoil2D'];
  tasks.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  $('taskSelect').replaceChildren(...tasks.map(x=>{const o=el('option','',labelTask(x));o.value=x;return o}));
  $('taskSelect').onchange=populateConditions;
  updateCounters(s);populateConditions();
}
function labelTask(t){return t==='Trefoil3D'?'3D Trefoil':t==='Trefoil2D'?'Main Trefoil':t}
function conditionLabel(t){
  const m=t.meta;
  if(m.Task==='Ellipse')return `${m.Condition||'Ellipse'} · dir ${num(m.Direction)>=0?'+':'−'}`;
  if(m.Task==='Sphere')return `${m.Condition||'Sphere'} · dir ${num(m.Direction)>=0?'+':'−'}`;
  return m.Condition||'—';
}
function populateConditions(){
  const s=currentSession(),task=$('taskSelect').value;
  const trials=s.joined.filter(x=>x.meta.Task===task);
  const conds=[...new Set(trials.map(conditionLabel))];
  $('conditionSelect').replaceChildren(...conds.map(c=>{const o=el('option','',c);o.value=c;return o}));
  $('conditionSelect').onchange=populateTrials;
  populateTrials();
}
function populateTrials(){
  const s=currentSession(),task=$('taskSelect').value,cond=$('conditionSelect').value;
  const trials=s.joined.filter(x=>x.meta.Task===task&&conditionLabel(x)===cond);
  $('trialSelect').replaceChildren(...trials.map(x=>{const o=el('option','',`${x.meta.TrialID} · trial ${x.meta.TrialIndex||'—'}`);o.value=x.meta.TrialID;return o}));
  $('trialSelect').onchange=selectTrial;
  selectTrial();
}
function selectTrial(){
  const s=currentSession(),id=$('trialSelect').value;
  active=s.joined.find(x=>x.meta.TrialID===id)||null;
  if(!active)return;
  playTime=duration(active);pause();$('viewer').hidden=false;
  buildMetadata();drawAll();updateCounters(s);
}
function updateCounters(s){
  const task=scope==='full'?s.joined:s.joined.filter(x=>CALIB_TASKS.has(x.meta.Task));
  $('trialCount').textContent=task.length;
  $('sampleCount').textContent=task.reduce((n,t)=>n+t.samples.length,0).toLocaleString();
  $('hmdState').textContent=s.hmd?.length?'loaded':'not loaded';
}
function duration(t){
  const d=num(t.meta.ActualDuration);if(d!==null)return d;
  return Math.max(0,...t.samples.map(x=>num(x.TimeSec)||0));
}
function sampleXYZ(r,prefix='World'){return [num(r[prefix+'X']),num(r[prefix+'Y']),num(r[prefix+'Z'])]}
function validXYZ(v){return v.every(Number.isFinite)}
function anchorFromSample(r){
  const a=[num(r.HMDAnchorWorldX),num(r.HMDAnchorWorldY),num(r.HMDAnchorWorldZ)];
  return validXYZ(a)?a:null;
}
function trialCenter(t){
  const m=t.meta;
  if(m.Task==='Sphere'){
    const c=[num(m.SphereCenterX),num(m.SphereCenterY),num(m.SphereCenterZ)];
    if(validXYZ(c))return c;
  }
  for(const r of t.samples){const a=anchorFromSample(r);if(a)return a}
  const targets=t.samples.map(r=>sampleXYZ(r,'Target')).filter(validXYZ);
  if(targets.length)return [0,1,2].map(i=>mean(targets.map(p=>p[i])));
  const pts=t.samples.map(r=>sampleXYZ(r)).filter(validXYZ);
  return [0,1,2].map(i=>mean(pts.map(p=>p[i])));
}
function rotateZ(v,deg){const a=-deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[1],s*v[0]+c*v[1],v[2]]}
function rotateY(v,deg){const a=-deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[2],v[1],s*v[0]+c*v[2]]}
function canonicalPoint(t,r,kind='trace'){
  const m=t.meta;
  if(m.Task==='Ellipse'){
    if(kind==='trace'){
      const p=[num(r.LocalX),num(r.LocalY),num(r.LocalZ)];
      if(validXYZ(p))return p;
    }
  }
  const p=sampleXYZ(r,kind==='target'?'Target':'World');if(!validXYZ(p))return null;
  const c=trialCenter(t);let v=p.map((x,i)=>x-c[i]);
  const angle=num(r.StimulusAngleDeg)||0;
  if(m.Task==='Trefoil3D'&&m.Condition==='Rotating')v=rotateZ(v,angle);
  else if(m.Task==='Trefoil2D')v=rotateZ(v,angle);
  else if(m.Task==='Sphere')v=rotateY(v,angle);
  return v;
}
function worldPoint(r,kind='trace'){const p=sampleXYZ(r,kind==='target'?'Target':'World');return validXYZ(p)?p:null}
function pointsFor(t,kind){
  return t.samples.map(r=>frame==='world'?worldPoint(r,kind):canonicalPoint(t,r,kind)).filter(Boolean);
}
function hmdPoints(t){
  if(frame==='canonical')return [];
  return t.hmd.map(r=>[num(r.HMDWorldX),num(r.HMDWorldY),num(r.HMDWorldZ)]).filter(validXYZ);
}
function buildMetadata(){
  const m=active.meta;
  $('trialKicker').textContent=scope==='calibration'?'Calibration trial':'Recorded trial';
  $('trialTitle').textContent=`${labelTask(m.Task)} — ${m.Condition||'—'}`;
  $('trialSubtitle').textContent=`${m.TrialID} · ${active.samples.length.toLocaleString()} samples · ${fmt(duration(active),2)} s`;
  const pairs=[
    ['Trial ID',m.TrialID],['Task',labelTask(m.Task)],['Condition',m.Condition||'—'],
    ['Trial index',m.TrialIndex||'—'],['Repetition',m.Repetition||'—'],['Direction',m.Direction||'—'],
    ['Expected duration',m.ExpectedDuration?fmt(m.ExpectedDuration,1)+' s':'—'],['Actual duration',fmt(duration(active),2)+' s'],
    ['Stimulus viewing',m.StimulusViewingMode||'—'],['Cursor viewing',m.CursorViewingMode||'—'],
    ['Rotation speed',m.RotationSpeed?fmt(m.RotationSpeed,1)+'°/s':'—']
  ];
  if(m.Task==='Sphere')pairs.push(['Sphere radius',fmt(m.SphereRadius,4)+' m']);
  if(m.Task==='Ellipse')pairs.push(['Aspect ratio',m.EllipseAspectRatio||'—'],['Implied slant',m.EllipseImpliedSlantDeg?fmt(m.EllipseImpliedSlantDeg,1)+'°':'—']);
  fillDL($('metadata'),pairs);
  const errors=active.samples.map(r=>num(r.TargetError)).filter(Number.isFinite);
  const metrics=[['Samples',active.samples.length.toLocaleString()]];
  if(errors.length){
    metrics.push(['Mean target error',fmt(mean(errors)*100,2)+' cm'],['Median',fmt(median(errors)*100,2)+' cm'],['95th percentile',fmt(quantile(errors,.95)*100,2)+' cm']);
  }else metrics.push(['Target error','not saved for this task']);
  if(active.hmd.length){
    const tracked=active.hmd.filter(r=>String(r.HMDIsTracked)==='1').length;
    metrics.push(['HMD frames',active.hmd.length.toLocaleString()],['HMD tracked',fmt(tracked/active.hmd.length*100,1)+'%']);
  }
  fillDL($('metrics'),metrics);
  $('errorPanel').hidden=!errors.length;
  const warns=[];
  if(m.Task==='Cube'&&m.Condition==='Rotating')warns.push('Rotating Cube does not save the cube rotation angle per sample. The viewer shows the saved target points and raw/world trace, but does not claim to reconstruct the full rotating cube pose.');
  if(frame==='canonical'&&m.Task==='Cube'&&m.Condition==='Rotating')warns.push('Canonical Cube view only recenters the trace; no rotation removal is applied.');
  if(frame==='canonical'&&m.Task==='Ellipse')warns.push('Ellipse canonical coordinates use the LocalXYZ values saved by the current experiment build.');
  $('warningBox').hidden=!warns.length;$('warningBox').textContent=warns.join(' ');
}
function fillDL(dl,pairs){dl.replaceChildren();for(const [k,v] of pairs){dl.append(el('dt','',k),el('dd','',String(v)))}}

function canvas(id){
  const c=$(id),dpr=devicePixelRatio||1,w=Math.max(1,c.clientWidth),h=Math.max(1,c.clientHeight);
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr)}
  const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);return {c,ctx,w,h};
}
function projectPoint(p,w,h,bounds){
  const center=bounds.center,span=bounds.span||1;
  let q=p.map((v,i)=>(v-center[i])/span);
  if(view==='3d'){
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const x=cy*q[0]+sy*q[2],z=-sy*q[0]+cy*q[2],y=cp*q[1]-sp*z;q=[x,y,sp*q[1]+cp*z];
    return [w/2+q[0]*Math.min(w,h)*.78*zoom,h/2-q[1]*Math.min(w,h)*.78*zoom,q[2]];
  }
  const axes=view==='xy'?[0,1]:view==='xz'?[0,2]:[1,2];
  return [w/2+q[axes[0]]*Math.min(w,h)*.78*zoom,h/2-q[axes[1]]*Math.min(w,h)*.78*zoom,0];
}
function bounds(all){
  if(!all.length)return {center:[0,0,0],span:1};
  const lo=[0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...all.map(p=>p[i])));
  return {center:lo.map((v,i)=>(v+hi[i])/2),span:Math.max(...lo.map((v,i)=>hi[i]-v),.01)};
}
function visibleSamples(t){const d=playTime;return t.samples.filter(r=>(num(r.TimeSec)||0)<=d)}
function drawPath(ctx,pts,to,color,width=2,alpha=1,dashed=false){
  if(pts.length<1)return;ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=width;ctx.setLineDash(dashed?[5,4]:[]);ctx.beginPath();
  pts.forEach((p,i)=>{const q=to(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])});ctx.stroke();ctx.restore();
}
function drawSpace(){
  if(!active)return;const {ctx,w,h}=canvas('space'),rows=visibleSamples(active);
  const trace=rows.map(r=>frame==='world'?worldPoint(r):canonicalPoint(active,r)).filter(Boolean);
  const targets=$('showTarget').checked?rows.map(r=>frame==='world'?worldPoint(r,'target'):canonicalPoint(active,r,'target')).filter(Boolean):[];
  const hmd=$('showHMD').checked?hmdPoints(active):[];
  const all=[...trace,...targets,...hmd];const b=bounds(all),to=p=>projectPoint(p,w,h,b);
  ctx.fillStyle='#fafafa';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#e5e5e5';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(w/2,0);ctx.lineTo(w/2,h);ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
  drawPath(ctx,targets,to,'#8a8f98',1.5,.85,true);drawPath(ctx,hmd,to,'#7a4aa8',1.5,.7,false);drawPath(ctx,trace,to,'#2563c9',2.2,.95,false);
  if(trace.length){const q=to(trace.at(-1));ctx.fillStyle='#2563c9';ctx.beginPath();ctx.arc(q[0],q[1],4.5,0,Math.PI*2);ctx.fill()}
  projected=trace.map(to);
  const lg=[['trace','Trace']];if(targets.length)lg.push(['target','Saved target']);if(hmd.length)lg.push(['hmd','HMD path']);
  const ul=$('legend');ul.replaceChildren(...lg.map(([c,t])=>{const li=el('li');li.append(el('i',c),t);return li}));
  $('frameNote').textContent=frame==='world'?'World coordinates':'Canonical / stimulus-relative coordinates';
  $('time').max=duration(active);$('time').value=Math.min(playTime,duration(active));$('clock').textContent=`${fmt(Math.min(playTime,duration(active)),2)} / ${fmt(duration(active),2)} s`;
}
function drawError(){
  if(!active||$('errorPanel').hidden)return;
  const errors=active.samples.map(r=>({t:num(r.TimeSec)||0,e:num(r.TargetError)})).filter(x=>Number.isFinite(x.e));
  const {ctx,w,h}=canvas('errorPlot');if(!errors.length)return;
  const pad={l:54,r:18,t:18,b:30},maxT=Math.max(...errors.map(x=>x.t),1),maxE=Math.max(...errors.map(x=>x.e),.001);
  const x=v=>pad.l+v/maxT*(w-pad.l-pad.r),y=v=>h-pad.b-v/maxE*(h-pad.t-pad.b);
  ctx.font='11px '+getComputedStyle(document.documentElement).getPropertyValue('--mono');ctx.strokeStyle='#e5e5e5';ctx.fillStyle='#666';
  for(let i=0;i<=4;i++){const e=maxE*i/4,yy=y(e);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.fillText(fmt(e*100,1)+' cm',5,yy+4)}
  for(let i=0;i<=5;i++){const t=maxT*i/5;ctx.fillText(fmt(t,0)+' s',x(t)-8,h-9)}
  ctx.strokeStyle='#2563c9';ctx.lineWidth=2;ctx.beginPath();errors.forEach((p,i)=>i?ctx.lineTo(x(p.t),y(p.e)):ctx.moveTo(x(p.t),y(p.e)));ctx.stroke();
}
function drawAll(){buildMetadata();drawSpace();drawError()}
document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{frame=b.dataset.frame;document.querySelectorAll('[data-frame]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawAll()});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawSpace()});
$('showTarget').onchange=drawSpace;$('showHMD').onchange=drawSpace;
$('time').oninput=()=>{pause();playTime=Number($('time').value);drawAll()};
$('restart').onclick=()=>{pause();playTime=0;drawAll()};
$('playPause').onclick=()=>{if(!active)return;if(playing){pause();return}if(playTime>=duration(active))playTime=0;playing=true;lastTs=null;$('playPause').textContent='Pause';raf=requestAnimationFrame(tick)};
function pause(){playing=false;lastTs=null;if(raf)cancelAnimationFrame(raf);raf=null;$('playPause').textContent='Play'}
function tick(ts){if(!playing)return;if(lastTs!==null)playTime=Math.min(duration(active),playTime+(ts-lastTs)/1000);lastTs=ts;drawAll();if(playTime>=duration(active)){pause();return}raf=requestAnimationFrame(tick)}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});

let pointer=null,moved=false;
$('space').onpointerdown=e=>{pointer={x:e.clientX,y:e.clientY,sx:e.clientX,sy:e.clientY};moved=false;if(view==='3d')$('space').setPointerCapture(e.pointerId)};
$('space').onpointermove=e=>{if(!pointer||view!=='3d')return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(e.clientX-pointer.sx,e.clientY-pointer.sy)>3)moved=true;yaw+=dx*.008;pitch=Math.max(-1.45,Math.min(1.45,pitch+dy*.008));pointer={...pointer,x:e.clientX,y:e.clientY};drawSpace()};
$('space').onpointerup=e=>{pointer=null;if($('space').hasPointerCapture(e.pointerId))$('space').releasePointerCapture(e.pointerId)};
$('space').onpointercancel=()=>{pointer=null};
$('space').onwheel=e=>{e.preventDefault();zoom=Math.max(.35,Math.min(4,zoom*Math.exp(-e.deltaY*.0015)));drawSpace()};

new ResizeObserver(()=>requestAnimationFrame(()=>{if(active)drawAll()})).observe($('space'));
new ResizeObserver(()=>requestAnimationFrame(()=>{if(active&&!$('errorPanel').hidden)drawError()})).observe($('errorPlot'));
$('files').addEventListener('change',e=>{const fs=[...e.target.files];if(fs.length)loadFiles(fs);e.target.value=''});

resetUI();
