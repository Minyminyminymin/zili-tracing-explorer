// Site shell: hash router, navigation, breadcrumbs and the overview page.
import * as drw from './drawings.mjs';
import * as cal from './calibration.mjs';
import * as ses from './session.mjs';
import * as inv from './inventory.mjs';
const $=id=>document.getElementById(id);
const fmt=(x,n=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n);
const COND={static:'Static',rotating:'Rotating'};
let page='overview';

function parse(){
 const raw=location.hash.replace(/^#\/?/,''),[path,q]=raw.split('?'),seg=path.split('/').filter(Boolean).map(decodeURIComponent),params=new URLSearchParams(q||'');
 if(seg[0]==='calibration'){
  if(seg.length===1)return {page:'cal-summary'};
  if(seg.length===2)return {page:'cal-participant',pid:seg[1],cond:params.get('c')};
  return {page:'cal-session',pid:seg[1],s:+seg[2],cond:seg[3]||'static',trial:seg[4]?+seg[4]:null};
 }
 if(seg[0]==='drawings'){
  if(seg[1]==='pair'){const [a,b]=(seg[2]||'1-2').split('-').map(Number);return {page:'drw-pair',a:a-1,b:b-1,view:params.get('view')||'corr'};}
  return {page:'drw-summary'};
 }
 if(seg[0]==='s'){
  if(seg[1]==='trial')return {page:'s-trial',id:seg[2]};
  if(seg[1]==='ellipse')return {page:'s-ellipse'};
  if(ses.SLUG[seg[1]])return {page:'s-task',task:ses.SLUG[seg[1]]};
 }
 if(seg[0]==='data')return {page:'data'};
 if(seg[0]==='methods')return {page:'methods'};
 return {page:'overview'};
}
const link=(href,text)=>`<a href="${href}">${text}</a>`;
function crumbs(r){
 const parts=[];
 if(r.page.startsWith('cal')){parts.push(link('#/calibration','Calibration'));
  if(r.pid)parts.push(r.page==='cal-participant'?`<span aria-current="page">${r.pid}</span>`:link(`#/calibration/${r.pid}?c=${r.cond}`,r.pid));
  if(r.page==='cal-session')parts.push(`<span aria-current="page">Session ${r.s}, ${COND[r.cond]?.toLowerCase()??r.cond}</span>`);
  if(r.page==='cal-summary')parts.push('<span aria-current="page">Summary</span>');}
 else if(r.page.startsWith('drw')){parts.push(link('#/drawings','Drawings'));parts.push(r.page==='drw-pair'?`<span aria-current="page">Trial ${r.a+1} vs trial ${r.b+1}</span>`:'<span aria-current="page">Summary</span>');}
 else if(r.page.startsWith('s-')&&ses.current()){const tr=r.page==='s-trial'?ses.current().trials.find(x=>x.id===r.id):null,task=r.task||(r.page==='s-ellipse'?'Ellipse':tr?.task);
  parts.push(link('#/',ses.label()));
  if(r.page==='s-trial'&&task){parts.push(task==='Trefoil2D'?link('#/drawings','Drawings'):link(`#/s/${ses.TASKS[task].slug}`,ses.TASKS[task].label));parts.push(`<span aria-current="page">${r.id}</span>`);}
  else if(task)parts.push(`<span aria-current="page">${ses.TASKS[task].label}</span>`);}
 else if(r.page==='data')parts.push('<span aria-current="page">Data files</span>');
 else if(r.page==='methods')parts.push('<span aria-current="page">Methods</span>');
 else parts.push('<span aria-current="page">Overview</span>');
 $('crumbs').innerHTML=parts.join('<span class="sep" aria-hidden="true">/</span>');
}
function navState(r){
 const sk=r.page==='s-task'?'s-'+ses.TASKS[r.task].slug:r.page==='s-ellipse'?'s-ellipse':r.page==='s-trial'?'s-'+(ses.TASKS[ses.current()?.trials.find(x=>x.id===r.id)?.task]?.slug||''):null;
 document.querySelectorAll('[data-nav]').forEach(a=>{const k=a.dataset.nav,on=k===r.page||k===sk||(k==='cal'&&r.page.startsWith('cal'))||(k==='drw'&&r.page.startsWith('drw'));a.classList.toggle('on',on);if(k===r.page||k===sk)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 document.querySelectorAll('#pidLinks a').forEach(a=>a.classList.toggle('on',a.dataset.pid===r.pid));
}
async function route(){
 const r=parse(),prev=page;
 if(r.page.startsWith('s-')&&!ses.current()){location.replace('#/');setStatus('Open a session on the Overview page first.');return;}
 page=r.page;
 if(prev==='cal-session'||prev==='cal-participant')cal.leave();
 if(prev==='s-trial')ses.leave();
 document.querySelectorAll('.page').forEach(s=>s.hidden=s.dataset.page!==page);document.body.dataset.page=page;
 crumbs(r);navState(r);
 if(prev!==page){window.scrollTo(0,0);}
 try{
  if(page==='overview')overview();
  else if(page==='cal-summary')await cal.renderSummary();
  else if(page==='cal-participant')await cal.renderParticipant(r.pid,r.cond);
  else if(page==='cal-session')await cal.renderSession(r.pid,r.s,r.cond,r.trial);
  else if(page==='drw-pair'){drw.showPair(r.a,r.b,r.view);requestAnimationFrame(()=>drw.redraw());}
  else if(page==='drw-summary')requestAnimationFrame(()=>drw.redraw());
  else if(page==='methods')methods();
  else if(page==='data')inv.render();
  else if(page==='s-task')ses.renderTask(r.task);
  else if(page==='s-ellipse')ses.renderEllipse();
  else if(page==='s-trial')ses.renderTrial(r.id);
 }catch(e){$('status').textContent=e.message;$('status').className='visible error';console.error(e);}
}
addEventListener('hashchange',route);

// Keep the address bar and headings in step with choices made inside the pair page.
drw.hooks.onPair=(a,b,view)=>{
 if(page!=='drw-pair'||a===undefined)return;
 const h=`#/drawings/pair/${a+1}-${b+1}${view&&view!=='corr'?'?view='+view:''}`;
 if(location.hash!==h)history.replaceState(null,'',h);
 $('pairNav').href=h;$('pairHead').textContent=`Trial ${a+1} vs trial ${b+1}`;
 $('pairAnswer').textContent=`Mean depth difference ${$('metric').textContent} cm, over ${$('coverage').textContent} of the curve where both drawings have a valid match. ${view==='play'?'Over time replays both trials on their own clocks; it does not change the score.':view==='cycle'?'Full-turn candidates are experimental and do not change the score.':'Select a spot on the curve to see the two samples behind it.'}`;
 crumbs({page:'drw-pair',a,b});
};
drw.hooks.onData=()=>{if(page==='overview')overview();};

async function overview(){
 ses.overviewBlock();
 const S=await cal.loadSummary(),o=S.overall;
 $('ovCalAnswer').textContent=`About ${fmt(o.static.mean_mm,0)} mm from the edges for the static cube and ${fmt(o.rotating.mean_mm,0)} mm for the rotating cube. Error falls with practice, and depth is the least stable axis.`;
 const stable=c=>S.participants.filter(p=>p.cond[c].onset).length;
 $('ovCalFigs').innerHTML=`<div><dt>Participants</dt><dd>${o.participants}</dd></div><div><dt>Sessions</dt><dd>${o.sessions}</dd></div><div><dt>Trials kept</dt><dd>${o.trials}</dd></div><div><dt>Stable, static / rotating</dt><dd>${stable('static')} / ${stable('rotating')}</dd></div>`;
 $('ovCalPeople').innerHTML=' or a participant: '+S.participants.map(p=>`<a href="#/calibration/${p.id}">${p.id}</a>`).join(' ');
 $('ovExcluded').innerHTML=`<strong>${S.excluded.length} rotating trials are excluded</strong> because the recomputed cube distance disagreed with the logged value: ${S.excluded.map(e=>`${e.pid} session ${e.s} trial ${e.i}`).join(', ')}.`;
 const d=drw.summary();
 if(d){$('ovDrwAnswer').textContent=`Two whole trials differ in depth by ${fmt(d.mean,2)} cm on average, between ${fmt(d.min,1)} and ${fmt(d.max,1)} cm depending on the pair.`;
  $('ovDrwFigs').innerHTML=`<div><dt>Participants</dt><dd>1</dd></div><div><dt>Trials</dt><dd>${d.trials}</dd></div><div><dt>Pairs</dt><dd>${d.pairs}</dd></div><div><dt>Samples</dt><dd>${d.samples.toLocaleString('en-US')}</dd></div>`;}
}
async function methods(){
 const S=await cal.loadSummary(),th=S.thresholds;
 $('mExcl').textContent=`${S.excluded.length} rotating trials had more than 1% of samples off by over 1 mm, inflating their mean by 3–8 mm; they are excluded everywhere: ${S.excluded.map(e=>`${e.pid} s${e.s} trial ${e.i}`).join(', ')}.`;
 $('mBench').textContent=`ZZ traced the most sessions (22). From ZZ's sessions 11–22, the 90th percentile of trial mean distance gives the benchmark: ${fmt(th.static.error)} mm static (${th.static.n} trials) and ${fmt(th.rotating.error)} mm rotating (${th.rotating.n} trials). The spread limit is the 90th percentile of the SD over ${S.window} consecutive ZZ trials: ${fmt(th.static.sd,2)} mm static and ${fmt(th.rotating.sd,2)} mm rotating. A participant is stable from the first trial of the first ${S.window}-trial run that is entirely at or below the benchmark and within the spread limit; the share of later trials at or below the benchmark is reported alongside. Both values are provisional choices, not validated cut-offs.`;
 const rows=S.model.map(m=>`<tr><td>${cal.LABELS.OUTCOME[m.outcome][0]}</td><td>${cal.LABELS.TERM[m.term]}</td><td>${m.est>0?'+':''}${fmt(m.est,2)}${m.unit}</td><td>${fmt(m.lo,2)} to ${fmt(m.hi,2)}</td><td>${m.p<.001?'< 0.001':fmt(m.p,3)}</td></tr>`).join('');
 if(!$('mModelTable')){const t=document.createElement('table');t.id='mModelTable';t.className='modelTable';t.innerHTML=`<thead><tr><th>Outcome</th><th>Term</th><th>Estimate</th><th>95% CI</th><th>p</th></tr></thead><tbody>${rows}</tbody>`;$('mBench').parentElement.querySelector('h3:last-of-type').nextElementSibling.after(t);}
}
document.querySelectorAll('[data-jump]').forEach(a=>a.onclick=e=>{e.preventDefault();$(a.dataset.jump).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});

let rt;addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(()=>{if(page.startsWith('cal'))cal.redraw(page);else if(page.startsWith('s-'))ses.redraw(page);else if(page.startsWith('drw'))drw.redraw();},150);});

cal.loadSummary().then(S=>{$('pidLinks').innerHTML=S.participants.map(p=>`<a href="#/calibration/${p.id}" data-pid="${p.id}">${p.id}</a>`).join('');navState(parse());}).catch(()=>{});
/* ---------- uploaded sessions ---------- */
function setStatus(msg,error=false){$('status').textContent=msg;$('status').className=msg?'visible'+(error?' error':''):'';}
function sessionNav(){
 const s=ses.current(),box=$('navSession');box.hidden=!s;
 const hasDrw=!!s?.drawings;$('navDrw').hidden=hasDrw;
 if(!s)return;
 $('navSessName').textContent=ses.label(s);
 $('navSessTasks').innerHTML=ses.tasksIn(s).map(t=>t==='Trefoil2D'?`<li><a href="#/drawings" data-nav="drw-summary">Drawings, main trials</a></li><li><a href="#/drawings/pair/1-2" data-nav="drw-pair">Pair detail</a></li>`:`<li><a href="#/s/${ses.TASKS[t].slug}" data-nav="s-${ses.TASKS[t].slug}">${ses.TASKS[t].label}</a></li>`).join('');
 const all=ses.list();$('navSessPick').hidden=all.length<2;
 $('sessSelect').innerHTML=all.map(x=>`<option value="${x.key}"${x===s?' selected':''}>${ses.label(x)}</option>`).join('');
}
ses.hooks.onChange=s=>{
 sessionNav();
 if(s?.drawings)drw.useRows(s.drawings.rows,`${ses.label(s)}, main trials`,s.drawings.cfg);else drw.usePilot();
 navState(parse());
 if(page==='overview')overview();
};
async function addFiles(list){
 const st=$('upStatus');st.className='upStatus';st.textContent=`Reading ${list.length} file${list.length>1?'s':''}…`;
 try{const r=await inv.addFiles(list);st.textContent=`Sorted ${r.files.length} files into ${r.sessions.length} sessions.`;$('navData').hidden=false;if(page==='data')inv.render();else location.hash='#/data';}
 catch(e){st.className='upStatus error';st.textContent=e.message;}
}
inv.hooks.onOpen=async files=>{
 try{const res=await ses.loadFiles(files),s=ses.current(),first=ses.tasksIn(s)[0];
  setStatus('');location.hash=first&&first!=='Trefoil2D'?`#/s/${ses.TASKS[first].slug}`:'#/';void res;}
 catch(e){setStatus(e.message,true);}
};
// Folders dropped on the zone arrive as directory entries; walk them for files.
async function filesFromDrop(dt){
 const items=[...dt.items||[]].map(i=>i.webkitGetAsEntry?.()).filter(Boolean);
 if(!items.length)return [...dt.files];
 const out=[];
 const walk=async e=>{if(e.isFile)out.push(await new Promise((res,rej)=>e.file(res,rej)));else if(e.isDirectory){const r=e.createReader();let batch;do{batch=await new Promise((res,rej)=>r.readEntries(res,rej));for(const x of batch)await walk(x);}while(batch.length);}};
 for(const e of items)await walk(e);
 return out;
}
$('sessFiles').onchange=e=>{if(e.target.files.length)addFiles([...e.target.files]);e.target.value='';};
$('sessFolder').onchange=e=>{if(e.target.files.length)addFiles([...e.target.files]);e.target.value='';};
{const z=$('dropZone');
 for(const ev of ['dragenter','dragover'])z.addEventListener(ev,e=>{e.preventDefault();z.classList.add('over');});
 for(const ev of ['dragleave','drop'])z.addEventListener(ev,e=>{e.preventDefault();z.classList.remove('over');});
 z.addEventListener('drop',async e=>{const f=await filesFromDrop(e.dataTransfer);if(f.length)addFiles(f);});}
$('dCsv').onclick=()=>{const t=inv.csv();if(!t)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+t],{type:'text/csv'}));a.download='data_inventory.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('dClear').onclick=()=>{inv.clear();$('navData').hidden=true;$('upStatus').textContent='';location.hash='#/';};
$('sessClose').onclick=()=>{ses.activate(null);$('upStatus').textContent='';location.hash='#/';};
$('sessSelect').onchange=e=>ses.activate(e.target.value);

route();
