// Uploaded-session pages: one session's unified Trials + Samples CSVs, processed in session-worker.mjs.
import {groundTruth,loadTrefoil3DReference} from './session-geometry.mjs';
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=(x,n=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const TASKS={Cube:{slug:'cube',label:'Cube',q:'How far is the traced hand from the cube edges?'},Trefoil3D:{slug:'trefoil3d',label:'Trefoil 3D',q:'How far is the traced hand from the 3D trefoil?'},Sphere:{slug:'sphere',label:'Sphere',q:'How far is the traced hand from the sphere target?'},Ellipse:{slug:'ellipse',label:'Ellipse',q:'Is the ellipse traced as a tilted circle?'},Trefoil2D:{slug:'drawings',label:'Main trefoil (drawings)'}};
export const SLUG=Object.fromEntries(Object.entries(TASKS).map(([k,v])=>[v.slug,k]));
const BENCH={Static:10.2,Rotating:11.5};// summer ZZ benchmark (Calibration › Methods), cube only
const ENAME=['Front bottom','Front right','Front top','Front left','Connecting, bottom left','Back bottom','Back right','Back top','Back left'];

const sessions=new Map();let active=null,ref3D=null,job=0;
export const hooks={onChange:null};
export function current(){return active;}
export function list(){return [...sessions.values()];}
export function activate(key){active=key?sessions.get(key)||null:null;hooks.onChange?.(active);}
const worker=new Worker(new URL('./session-worker.mjs',import.meta.url),{type:'module'});
const pending=new Map();
worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data);};
worker.onerror=e=>{for(const p of pending.values())p.reject(Error('Processing failed: '+(e.message||'worker error')));pending.clear();};

export async function loadFiles(fileList){
 const files=[...fileList];if(!files.length)throw Error('Choose at least one CSV file.');
 for(const f of files)if(f.size>80*1024*1024)throw Error(`${f.name} is larger than 80 MB.`);
 const payload=await Promise.all(files.map(async f=>({name:f.name,text:await f.text()})));
 const id=++job,res=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({id,files:payload});});
 if(!ref3D)ref3D=await loadTrefoil3DReference(new URL('./reference/coords_R2_1.5.csv',import.meta.url).href).catch(()=>null);
 for(const s of res.sessions)sessions.set(s.key,s);
 activate(res.sessions[0].key);
 return res;
}
export function tasksIn(s=active){if(!s)return [];return Object.keys(TASKS).filter(t=>s.trials.some(r=>r.task===t));}
const byTask=(t,s=active)=>s.trials.filter(r=>r.task===t);
const condLabel=r=>r.task==='Sphere'?`${r.cond[0]+r.cond.slice(1).toLowerCase()}, direction ${r.dir>=0?'+':'−'}`:r.task==='Ellipse'?`Aspect ${r.cond.replace('AspectRatio_','')}`:r.cond;
const groupKey=r=>r.task==='Sphere'?r.cond:r.cond;
const sessName=s=>`${s.participant}, session ${s.session??'?'}`;
export const label=s=>sessName(s||active);

/* ---------- overview block ---------- */
export function overviewBlock(){
 const box=$('ovSession');if(!active){box.hidden=true;return;}
 box.hidden=false;const s=active;
 $('ovSessHead').textContent=`${sessName(s)}`;
 const files=Object.values(s.files).join(', ');
 $('ovSessFiles').textContent=`From ${files}. Processed in this browser; nothing was uploaded to a server.`;
 const rows=tasksIn().map(t=>{const T=TASKS[t],r=byTask(t),href=t==='Trefoil2D'?'#/drawings':`#/s/${T.slug}`;
  let headline='';
  if(t==='Ellipse'){const d=r.filter(x=>x.shape);headline=`traced tilt ${fmt(avg(d.map(x=>x.shape.slantDeg)),0)}° on average; a tilted circle would need ${fmt(avg(d.map(x=>x.expected.slantDeg)),0)}°`;}
  else if(t==='Trefoil2D')headline='pairwise depth comparison on the Drawings pages';
  else{const conds=[...new Set(r.map(groupKey))];headline=conds.map(c=>{const g=r.filter(x=>groupKey(x)===c&&x.err);return g.length?`${c.toLowerCase()} ${fmt(avg(g.map(x=>x.err.mean)))} mm`:`${c.toLowerCase()} not recorded`;}).join(', ');}
  return `<li><a href="${href}"><strong>${T.label}</strong></a><span class="cnt">${r.length} trial${r.length>1?'s':''}</span><span class="hl">${esc(headline)}</span></li>`;}).join('');
 $('ovSessTasks').innerHTML=rows;
 $('ovSessNotes').innerHTML=s.notes.map(n=>`<li>${esc(n)}</li>`).join('');
}
const avg=a=>{const b=a.filter(Number.isFinite);return b.length?b.reduce((x,y)=>x+y,0)/b.length:null;};

/* ---------- task summary (Cube, Trefoil 3D, Sphere) ---------- */
export function renderTask(task){
 const s=active,T=TASKS[task],r=byTask(task);
 $('tHead').textContent=T.q;
 if(!r.length){$('tAnswer').textContent=`${sessName(s)} has no ${T.label} trials.`;$('tBody').innerHTML='';return;}
 const conds=[...new Set(r.map(groupKey))];
 const parts=conds.map(c=>{const g=r.filter(x=>groupKey(x)===c&&x.err);return g.length?`${fmt(avg(g.map(x=>x.err.mean)))} mm ${c.toLowerCase()}`:`${c.toLowerCase()} not recorded`;});
 const empty=[...new Set(r.filter(x=>!x.err).map(x=>groupKey(x).toLowerCase()))];
 const src=empty.length?` TargetError is empty in the ${empty.join(' and ')} trials, so their distance is left blank.`:'';
 $('tAnswer').textContent=`${sessName(s)}: mean distance ${parts.join(', ')}, over ${r.length} trials.${task==='Cube'?` The summer stability benchmark is ${BENCH.Static} mm static and ${BENCH.Rotating} mm rotating.`:''}${src}`;
 let h=`<section class="section"><div class="sectionHead"><h2>By condition</h2><p class="desc">Means across trials. Axis columns are the spread (SD) of hand minus target along x (left–right), y (up–down) and z (depth), in the stimulus frame.</p></div><div class="tableWrap"><table class="data"><thead><tr><th scope="col">Condition</th><th class="num">Trials</th><th class="num">Mean, mm</th><th class="num">Within 2 cm</th><th class="num">SD x</th><th class="num">SD y</th><th class="num">SD z (depth)</th>${task==='Cube'?'<th class="num">At or below benchmark</th>':''}</tr></thead><tbody>`;
 for(const c of conds){const g=r.filter(x=>groupKey(x)===c),e=g.filter(x=>x.err),ax=k=>avg(g.filter(x=>x.axes).map(x=>x.axes[k].sd));
  h+=`<tr><th scope="row">${esc(c[0]+c.slice(1).toLowerCase())}</th><td class="num">${g.length}</td><td class="num">${fmt(avg(e.map(x=>x.err.mean)))}</td><td class="num">${e.length?fmt(avg(e.map(x=>x.err.within2)),0)+'%':'—'}</td><td class="num">${fmt(ax(0))}</td><td class="num">${fmt(ax(1))}</td><td class="num">${fmt(ax(2))}</td>${task==='Cube'?`<td class="num">${e.length?`${e.filter(x=>x.err.mean<=BENCH[c]).length} of ${e.length}`:'—'}</td>`:''}</tr>`;}
 h+=`</tbody></table></div></section>`;
 h+=`<section class="section"><div class="sectionHead"><h2>Trials</h2><p class="desc">Front view in the stimulus frame, against the ground truth. Select a trial to replay it.</p></div><div class="sessionGrid" id="tGrid"></div></section>`;
 if(task==='Cube'){const ck=r.filter(x=>x.check);h+=`<section class="section"><div class="sectionHead"><h2>Ground-truth check</h2><p class="desc">The cube distance recomputed from the derived geometry, against the game's logged TargetError. Rotating trials also need the cube angle, which the game does not save; it is fitted per trial.</p></div><div class="tableWrap"><table class="data"><thead><tr><th>Trial</th><th class="num">Median difference, mm</th><th class="num">Samples off by more than 1 mm</th><th>Rotation fit</th></tr></thead><tbody>${ck.map(x=>`<tr><th scope="row"><a href="#/s/trial/${x.id}">${x.id}</a></th><td class="num">${fmt(x.check.medianMM,2)}</td><td class="num">${fmt(x.check.over1mmPct,1)}%</td><td>${x.spin?`start ${fmt(x.spin.theta0,1)}°, ${fmt(x.spin.omega,2)}°/s${x.spin.confident?'':' (not confident)'}`:'—'}</td></tr>`).join('')}</tbody></table></div></section>`;}
 $('tBody').innerHTML=h;
 const grid=$('tGrid');
 for(const x of r){const a=document.createElement('a');a.className='sCard';a.href=`#/s/trial/${x.id}`;
  a.innerHTML=`<span class="sTop"><strong>${esc(x.id)}</strong><span>${esc(condLabel(x))}</span></span><canvas aria-hidden="true"></canvas><span class="sBot"><span>${x.err?fmt(x.err.mean)+' mm':'—'}</span><span class="dim">${x.err?fmt(x.err.within2,0)+'% within 2 cm':''}</span></span>`;
  grid.append(a);thumb(a.querySelector('canvas'),x,'front');}
}

/* ---------- ellipse ---------- */
export function renderEllipse(){
 const s=active,r=byTask('Ellipse');
 $('eAnswer').textContent=r.length?`${sessName(s)}: traced tilt averages ${fmt(avg(r.map(x=>x.shape?.slantDeg)),1)}°. Drawing each ellipse as the circle it could be would need ${fmt(avg(r.map(x=>x.expected.slantDeg)),1)}° on average, so a tilt well below that means the ellipse was traced mostly flat.`:`${sessName(s)} has no ellipse trials.`;
 const rows=r.map(x=>`<tr><th scope="row"><a href="#/s/trial/${x.id}">${esc(x.id)}</a></th><td class="num">${fmt(x.expected.aspect,2)}</td><td class="num">${fmt(x.expected.slantDeg,1)}°</td><td class="num">${fmt(x.shape?.slantDeg,1)}°</td><td class="num">${fmt(x.shape?.r2,2)}</td><td class="num">${fmt(x.expected.predictedDepthMM,0)}</td><td class="num">${fmt(x.shape?.depthMM,0)}</td><td class="num">${x.dir>=0?'+':'−'}</td></tr>`).join('');
 $('eTable').innerHTML=`<thead><tr><th>Trial</th><th class="num">Aspect ratio</th><th class="num">Tilt for a circle</th><th class="num">Traced tilt</th><th class="num">Fit R²</th><th class="num">Depth for a circle, mm</th><th class="num">Traced depth, mm</th><th class="num">Spin</th></tr></thead><tbody>${rows}</tbody>`;
 scatter(r);
 const grid=$('eGrid');grid.replaceChildren();
 for(const x of r){const a=document.createElement('a');a.className='sCard';a.href=`#/s/trial/${x.id}`;a.innerHTML=`<span class="sTop"><strong>${esc(x.id)}</strong><span>aspect ${fmt(x.expected.aspect,1)}</span></span><canvas aria-hidden="true"></canvas><span class="sBot"><span>${fmt(x.shape?.slantDeg,0)}° traced</span><span class="dim">${fmt(x.expected.slantDeg,0)}° for a circle</span></span>`;grid.append(a);thumb(a.querySelector('canvas'),x,'side');}
}
function scatter(r){
 const box=$('eChart'),W=Math.max(300,Math.min(560,box.clientWidth)),H=W*.75,m={l:46,r:16,t:14,b:40},mx=90;
 const x=v=>m.l+v/mx*(W-m.l-m.r),y=v=>H-m.b-v/mx*(H-m.t-m.b);
 let g=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:${W}px" role="img" aria-label="Traced tilt against the tilt a circle would need">`;
 for(let v=0;v<=mx;v+=15)g+=`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H-m.b}"/><line class="grid" x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${x(v)}" y="${H-m.b+15}" text-anchor="middle">${v}°</text><text class="tick" x="${m.l-6}" y="${y(v)+4}" text-anchor="end">${v}°</text>`;
 g+=`<line class="bench" x1="${x(0)}" y1="${y(0)}" x2="${x(mx)}" y2="${y(mx)}"/><text class="benchLab" x="${x(mx)-4}" y="${y(mx)+14}" text-anchor="end">traced as the circle</text>`;
 g+=`<text class="axis" x="${W-m.r}" y="${H-6}" text-anchor="end">Tilt a circle would need</text><text class="axis" x="4" y="${m.t-2}">Traced tilt</text>`;
 for(const d of r)if(d.shape)g+=`<a href="#/s/trial/${d.id}"><circle class="tdot ok" cx="${x(d.expected.slantDeg)}" cy="${y(d.shape.slantDeg)}" r="5"><title>${d.id}: aspect ${d.expected.aspect}, traced ${fmt(d.shape.slantDeg,1)}°</title></circle></a>`;
 box.innerHTML=g+'</svg>';
}

/* ---------- drawing helpers ---------- */
const VIEWS={front:{lab:'Front',a:0,b:1,axes:'X → right, Y ↑'},top:{lab:'Top',a:0,b:2,axes:'X → right, Z (depth) ↑'},side:{lab:'Side',a:2,b:1,axes:'Z (depth) → , Y ↑'},'3d':{lab:'3D',axes:'Drag to orbit'}};
function proj(view,cam){if(view!=='3d'){const v=VIEWS[view];return p=>[p[v.a],p[v.b]];}return p=>{const x=Math.cos(cam.yaw)*p[0]+Math.sin(cam.yaw)*p[2],z=-Math.sin(cam.yaw)*p[0]+Math.cos(cam.yaw)*p[2];return [x,Math.cos(cam.pitch)*p[1]-Math.sin(cam.pitch)*z];};}
function setup(cv,h){const dpr=devicePixelRatio||1,W=cv.clientWidth,H=h??W;cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);const g=cv.getContext('2d');g.scale(dpr,dpr);g.clearRect(0,0,W,H);return [g,W,H];}
// Ground truth in mm, in the frame the trace is drawn in.
function gtPaths(tr,frame,angle){if(!active)return [];const T={meta:tr.meta};return groundTruth(T,active.geometry,frame==='world'?'world':'canonical',angle,ref3D).map(p=>({...p,points:p.points.map(q=>q.map(v=>v*1000))}));}
function fitter(paths,pts,pr,W,H,zoom=1){
 const all=[...paths.flatMap(p=>p.points),...pts.filter(Boolean)].map(pr);if(!all.length)return null;
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),20)*1.12,sc=Math.min(W,H)/span*zoom;
 return p=>{const q=pr(p);return [W/2+(q[0]-cx)*sc,H/2-(q[1]-cy)*sc];};
}
function drawGT(g,to,paths){for(const p of paths){g.beginPath();p.points.forEach((q,i)=>i?g.lineTo(...to(q)):g.moveTo(...to(q)));g.strokeStyle=p.kind==='secondary'?css('--gt-dim'):p.kind==='indicator'?css('--bandLine'):css('--gt');g.lineWidth=p.kind==='ground'?1.6:1.2;g.setLineDash(p.kind==='ground'?[]:[4,3]);g.stroke();}g.setLineDash([]);}
const errColor=e=>{if(e===null||e===undefined)return css('--t1');const t=Math.min(e,40)/40,a=css('--d0'),b=css('--d1'),pa=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16)),pb=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16));return `rgb(${pa.map((x,i)=>Math.round(x+(pb[i]-x)*t)).join(',')})`;};
function thumb(cv,tr,view){
 const [g,W]=setup(cv),pts=tr.frame==='canonical'?tr.p:tr.w,paths=tr.frame==='canonical'?gtPaths(tr,'canonical',0):[],to=fitter(paths,pts,proj(view),W,W);if(!to)return;
 drawGT(g,to,paths);g.strokeStyle=css('--t1');g.globalAlpha=.75;g.lineWidth=1;g.beginPath();let on=false;for(const q of pts){if(!q){on=false;continue;}on?g.lineTo(...to(q)):g.moveTo(...to(q));on=true;}g.stroke();g.globalAlpha=1;
}

/* ---------- trial viewer ---------- */
const v={id:null,frame:'canonical',view:'front',color:'error',cam:{yaw:.5,pitch:-.35},zoom:1,t:0,playing:false,last:null,speed:1};
const segBtns=(id,opts,val,cb)=>{const el=$(id);el.replaceChildren();for(const [k,l] of opts){const b=document.createElement('button');b.type='button';b.textContent=l;b.setAttribute('aria-pressed',String(k===val));b.onclick=()=>cb(k);el.append(b);}};
const cur=()=>active?.trials.find(x=>x.id===v.id);
export function renderTrial(id){
 const tr=active?.trials.find(x=>x.id===id);stop();
 if(!tr){$('vHead').textContent='Trial not found';$('vAnswer').textContent='Choose a trial from the session pages.';return;}
 v.id=id;v.t=0;if(tr.frame!=='canonical')v.frame='world';
 $('vHead').textContent=`${tr.id}, ${TASKS[tr.task].label.toLowerCase()}`;
 const e=tr.err;
 $('vAnswer').textContent=tr.task==='Ellipse'?`Aspect ratio ${fmt(tr.expected.aspect,2)}. Traced tilt ${fmt(tr.shape?.slantDeg,1)}°, against ${fmt(tr.expected.slantDeg,1)}° for a circle; traced depth ${fmt(tr.shape?.depthMM,0)} mm, against ${fmt(tr.expected.predictedDepthMM,0)} mm.`:tr.task==='Trefoil2D'?'Main-experiment trial. Depth agreement between trials is on the Drawings pages.':e?`${condLabel(tr)}. Mean distance ${fmt(e.mean)} mm, median ${fmt(e.median)} mm, ${fmt(e.within2,0)}% of samples within 2 cm.${tr.task==='Cube'&&BENCH[tr.cond]?` Summer benchmark ${BENCH[tr.cond]} mm.`:''}`:'TargetError is empty for every sample in this trial, so no distance is shown.';
 const sib=active.trials.filter(x=>x.task===tr.task),i=sib.indexOf(tr);
 $('vPrev').disabled=i<=0;$('vNext').disabled=i>=sib.length-1;
 $('vPrev').onclick=()=>{if(i>0)location.hash=`#/s/trial/${sib[i-1].id}`;};$('vNext').onclick=()=>{if(i<sib.length-1)location.hash=`#/s/trial/${sib[i+1].id}`;};
 controls();side(tr);draw();
}
function controls(){
 const tr=cur();
 segBtns('vFrame',[['canonical','Stimulus frame'],['world','World']],v.frame,k=>{if(k==='canonical'&&tr.frame!=='canonical')return;v.frame=k;controls();draw();});
 if(tr.frame!=='canonical')$('vFrame').querySelector('button').disabled=true;
 segBtns('vView',Object.entries(VIEWS).map(([k,o])=>[k,o.lab]),v.view,k=>{v.view=k;controls();draw();});
 segBtns('vColor',[['error','By distance'],['plain','Plain']],v.color,k=>{v.color=k;controls();draw();});
 segBtns('vSpeed',[[.5,'0.5×'],[1,'1×'],[2,'2×'],[4,'4×']],v.speed,k=>{v.speed=k;controls();});
 $('vScrub').max=tr.t.at(-1);$('vScrub').value=Math.round(v.t*100);
}
function side(tr){
 const rows=[['Condition',condLabel(tr)],['Samples',tr.n.toLocaleString('en-US')],['Duration',fmt(tr.dur,1)+' s'],['TargetError',tr.errMissing===0?'logged for every sample':tr.errMissing===tr.n?'empty in every sample':`empty in ${tr.errMissing.toLocaleString('en-US')} of ${tr.n.toLocaleString('en-US')} samples`]];
 if(tr.spin)rows.push(['Cube angle fit',`${fmt(tr.spin.theta0,1)}° + ${fmt(tr.spin.omega,2)}°/s${tr.spin.confident?'':', not confident'}`]);
 if(tr.check)rows.push(['Recomputed vs logged',`median ${fmt(tr.check.medianMM,2)} mm, ${fmt(tr.check.over1mmPct,1)}% off by >1 mm`]);
 let h=`<h2>This trial</h2><dl class="facts">${rows.map(([k,x])=>`<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>`;
 if(tr.axes)h+=`<h2>Hand minus target, mm</h2><table class="edges"><thead><tr><th>Axis</th><th>Bias</th><th>SD</th></tr></thead><tbody>${['x, left–right','y, up–down','z, depth'].map((n,k)=>`<tr><th scope="row">${n}</th><td>${fmt(tr.axes[k].bias)}</td><td>${fmt(tr.axes[k].sd)}</td></tr>`).join('')}</tbody></table>`;
 if(tr.edges)h+=`<h2>Distance by edge, mm</h2><table class="edges"><thead><tr><th>Edge</th><th>Share</th><th>Mean</th><th>95th</th></tr></thead><tbody id="vEdges">${tr.edges.map(e=>`<tr data-e="${e.e}"><th scope="row"><span class="eid">${e.e}</span>${ENAME[e.e-1]}</th><td>${fmt(e.pct)}%</td>${e.n?`<td>${fmt(e.mean)}</td><td>${fmt(e.p95)}</td>`:'<td colspan="2" class="dim">No samples</td>'}</tr>`).join('')}</tbody></table>`;
 $('vSide').innerHTML=h;
}
function idx(tr){const x=v.t*100;let lo=0,hi=tr.t.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(tr.t[m]<=x)lo=m;else hi=m-1;}return lo;}
function draw(){
 const tr=cur(),cv=$('vCanvas');if(!tr||!cv.clientWidth)return;
 const [g,W,H]=setup(cv,Math.min(cv.clientWidth,620)),k=idx(tr),world=v.frame==='world',pts=world?tr.w:tr.p;
 const paths=gtPaths(tr,world?'world':'canonical',world?tr.angle[k]:0),pr=proj(v.view,v.cam),to=fitter(paths,pts,pr,W,H,v.view==='3d'?v.zoom:1);if(!to)return;
 drawGT(g,to,paths);
 const whole=!v.playing&&v.t===0,end=whole?pts.length:k+1;
 g.globalAlpha=.18;g.strokeStyle=css('--t1');g.lineWidth=1;g.beginPath();let on=false;for(const q of pts){if(!q){on=false;continue;}on?g.lineTo(...to(q)):g.moveTo(...to(q));on=true;}g.stroke();g.globalAlpha=1;
 for(let i=1;i<end;i++){const a=pts[i-1],b=pts[i];if(!a||!b)continue;g.strokeStyle=v.color==='error'&&tr.e[i]!==null?errColor(tr.e[i]):css('--t1');g.lineWidth=1.6;g.beginPath();g.moveTo(...to(a));g.lineTo(...to(b));g.stroke();}
 const p=pts[k];
 if(p){if(tr.target&&tr.target[k]&&!world){const q=to(tr.target[k]),a=to(p);g.strokeStyle=css('--now');g.setLineDash([4,3]);g.beginPath();g.moveTo(...a);g.lineTo(...q);g.stroke();g.setLineDash([]);}
  const a=to(p);g.fillStyle=css('--now');g.strokeStyle=css('--surface');g.lineWidth=2;g.beginPath();g.arc(a[0],a[1],6,0,Math.PI*2);g.fill();g.stroke();}
 $('vLegend').innerHTML=(v.color==='error'?'<li><i class="lramp"></i>Distance 0 → 40 mm or more</li>':'<li><i style="background:var(--t1)"></i>Trace</li>')+[...new Set(paths.map(p=>p.label))].map(l=>`<li><i class="${paths.find(p=>p.label===l).kind==='ground'?'lmean':'lbench'}"></i>${esc(l)}</li>`).join('')+'<li><i class="lhand"></i>Hand now</li>';
 $('vFrameNote').textContent=`${VIEWS[v.view].lab} view, ${world?'world coordinates':'stimulus frame (rotation removed)'}: ${VIEWS[v.view].axes}. mm.`;
 $('vReadout').innerHTML=`<span><strong>${fmt(v.t)}</strong> of ${fmt(tr.t.at(-1)/100)} s</span>${tr.e[k]!==null?`<span>Distance <strong>${fmt(tr.e[k])}</strong> mm</span>`:''}${tr.seg?`<span>Nearest edge <strong>${tr.seg[k]}</strong></span>`:''}${p?`<span>x ${fmt(p[0])}, y ${fmt(p[1])}, z ${fmt(p[2])} mm</span>`:''}`;
 if(tr.seg)document.querySelectorAll('#vEdges tr').forEach(r=>r.classList.toggle('now',+r.dataset.e===tr.seg[k]));
 $('vScrub').value=Math.round(v.t*100);
}
function frame(ts){if(!v.playing)return;const tr=cur(),end=tr.t.at(-1)/100;if(v.last!=null)v.t+=(ts-v.last)/1000*v.speed;v.last=ts;if(v.t>=end){v.t=end;draw();stop();return;}draw();requestAnimationFrame(frame);}
function play(){const tr=cur();if(!tr)return;if(v.t>=tr.t.at(-1)/100)v.t=0;v.playing=true;v.last=null;$('vPlay').textContent='Pause';requestAnimationFrame(frame);}
function stop(){v.playing=false;$('vPlay').textContent='Play';}
export function leave(){stop();}
export function redraw(page){if(!active)return;if(page==='s-trial')draw();else if(page==='s-ellipse')renderEllipse();}
$('vPlay').onclick=()=>v.playing?stop():play();
$('vScrub').oninput=e=>{stop();v.t=e.target.value/100;draw();};
{const cv=$('vCanvas');let d=null;
 cv.onpointerdown=e=>{if(v.view!=='3d')return;d={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);};
 cv.onpointermove=e=>{if(!d)return;v.cam.yaw+=(e.clientX-d.x)*.008;v.cam.pitch=Math.max(-1.4,Math.min(1.4,v.cam.pitch+(e.clientY-d.y)*.008));d={x:e.clientX,y:e.clientY};draw();};
 cv.onpointerup=cv.onpointercancel=()=>{d=null;};
 cv.addEventListener('wheel',e=>{if(v.view!=='3d')return;e.preventDefault();v.zoom=Math.max(.5,Math.min(3,v.zoom*Math.exp(-e.deltaY*.0015)));draw();},{passive:false});
 cv.onkeydown=e=>{const tr=cur();if(!tr)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stop();v.t=Math.max(0,Math.min(tr.t.at(-1)/100,v.t+(e.key==='ArrowRight'?.5:-.5)));draw();}if(e.key===' '){e.preventDefault();v.playing?stop():play();}};
}
