import {extractCycles} from './cycles.mjs';
import {DEFAULTS,parseCSV,compare,allPairs} from './analysis.mjs';
// Presentation only. All numbers come from analysis.mjs and cycles.mjs unchanged.
// Trials are shown 1-based (Trial 1 = CSV TrialIndex 0); exports and provenance keep the CSV index.
export const hooks={onPair:null,onData:null};
let pending=null;
const T=id=>`Trial ${id+1}`;
const $=id=>document.getElementById(id),A='#2563c9',B='#e4472b',REF='#28343b',CAUTION='#8c5a00',PLAY='#4f46a8',EXCL='#cfd6d3';
const COLS=[A,B],SIDE=['A','B'],MONO='11px "Geist Mono","SF Mono",ui-monospace,Menlo,monospace';
let rows=[],model=null,result=null,pairResults=[],cfg={...DEFAULTS},mode='nearest',uiMode='corr',step=2,playFrame=1,view='3d',selected=0,yaw=.6,pitch=.4,zoom=1,job=0;
let placed=[],projectedRef=[],depthBox=null,timeBox=null,cycleHits=[],sourceLabel='Built-in pilot (2026-09-23)';
const worker=new Worker('./worker.mjs',{type:'module'});
const fmt=(x,n=2)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n);
const sfmt=x=>x<0?`(−${fmt(-x)})`:fmt(x);
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const status=(s,error=false)=>{$('status').textContent=s;$('status').className=s?'visible'+(error?' error':''):'';};
const pairTrials=()=>result?[result.ia,result.ib].map(id=>model.trials.find(t=>t.id===id)):[];
const isWorld=()=>(uiMode==='corr'&&step===0)||(uiMode==='play'&&playFrame===0);
function provenance(pairs){const d=el('details','prov');d.append(el('summary','','Provenance'),facts(pairs));return d;}
function facts(pairs){const dl=el('dl','facts');for(const [k,v] of pairs){dl.append(el('dt','',k),el('dd','',v));}return dl;}
function trialCard(side,t,extra='',sub='',state=null){
 const card=el('div','trialCard '+(side?'b':'a')),head=el('div','rowHead'),tile=el('span','tile '+(side?'b':'a')),text=el('div');
 tile.setAttribute('aria-hidden','true');tile.append(el('i'));text.append(el('h3','',`${SIDE[side]}: ${T(t.id)}${extra}`));if(sub)text.append(el('p','sub',sub));
 head.append(tile,text);if(state)head.append(el('span','state '+state[0],state[1]));card.append(head);return card;
}

/* ---------- data loading and recalculation ---------- */
function busy(v){document.body.classList.toggle('busy',v);$('export').disabled=v;$('applyGeometry').disabled=v;}
function recompute(){pauseReplay();if(!rows.length)return;busy(true);status('Recalculating XY correspondences and cycle candidates…');worker.postMessage({rows,cfg,id:++job});}
worker.onmessage=e=>{
 if(e.data.id!==job)return;busy(false);
 if(e.data.error){status(e.data.error,true);return;}
 model=e.data.model;
 for(const t of model.trials){t.cycles=extractCycles(t,model.curve);t.cycleChoice=t.cycles.selected>=0?t.cycles.selected:0;}
 const oldA=$('trialA').value,oldB=$('trialB').value;
 for(const id of ['trialA','trialB']){const sel=$(id);sel.replaceChildren();for(const t of model.trials){const o=el('option','',T(t.id));o.value=t.id;sel.append(o);}}
 $('trialA').value=model.trials.some(t=>String(t.id)===oldA)?oldA:model.trials[0].id;
 $('trialB').value=model.trials.some(t=>String(t.id)===oldB)&&oldB!==$('trialA').value?oldB:model.trials.find(t=>String(t.id)!==$('trialA').value).id;
 $('trialCount').textContent=model.trials.length;
 $('sampleCount').textContent=model.samples.toLocaleString('en-US');
 const hasHMD=rows.length&&['HMDWorldX','HMDQuatW'].every(k=>k in rows[0]);
 $('hmdState').textContent=hasHMD?'present, not analysed here':'not in this source';
 $('datasetLabel').textContent=sourceLabel;$('datasetLabel').title=sourceLabel;
 if(pending){const p=pending;pending=null;applyPair(p.a,p.b,p.view);}
 status('');refresh(true);hooks.onData?.();
};
worker.onerror=e=>{busy(false);status('Analysis failed. Check the CSV columns and the geometry settings.',true);console.error(e);};
async function loadPilotData(){const r=await fetch('./data.json');if(!r.ok)throw Error('Could not load the pilot data file.');return r.json();}
async function loadDefault(){
 status('Loading the 10 recorded pilot trials…');
 try{const data=await loadPilotData();rows=data.rows.map(v=>Object.fromEntries(data.columns.map((k,i)=>[k,v[i]])));cfg={...DEFAULTS};syncControls();sourceLabel='Built-in pilot (2026-09-23)';recompute();}
 catch(e){status(e.message,true);}
}
function settingsSummary(){const c=cfg;$('settingsSummary').textContent=`${c.gate>=1000?'no XY limit':c.gate+' cm limit'}, ambiguity ${c.ambiguity?'excluded':'kept'}, branch check ${c.branch?'on':'off'}${mode==='nearest'?'':`, ${c.bins} bins, min ${c.min}`}`;}
function syncControls(){for(const key of ['cx','cy','cz','scale','r1','r2','bins','min','gate'])$(key).value=cfg[key];$('ambiguity').checked=cfg.ambiguity;$('branch').checked=cfg.branch;}
$('upload').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{if(file.size>40*1024*1024)throw Error('Choose a CSV file smaller than 40 MB.');const parsed=parseCSV(await file.text());rows=parsed;cfg={...cfg,r1:parsed[0].R1??cfg.r1,r2:parsed[0].R2??cfg.r2};syncControls();sourceLabel=file.name;recompute();}
 catch(err){status(err.message,true);}finally{e.target.value='';}
});
$('restore').onclick=loadDefault;

/* ---------- global controls ---------- */
for(const id of ['trialA','trialB'])$(id).onchange=()=>{if($('trialA').value===$('trialB').value){const other=id==='trialA'?'trialB':'trialA';$(other).value=model.trials.find(t=>String(t.id)!==$(id).value).id;}refresh();};
$('swap').onclick=()=>{const a=$('trialA').value;$('trialA').value=$('trialB').value;$('trialB').value=a;refresh();};
$('mode').onchange=()=>{mode=$('mode').value;$('modeSum').value=mode;refresh(true);};
$('modeSum').onchange=()=>{mode=$('modeSum').value;$('mode').value=mode;refresh(true);};
for(const id of ['gate','bins','min','ambiguity','branch'])$(id).onchange=()=>{cfg[id]=['ambiguity','branch'].includes(id)?$(id).checked:Number($(id).value);settingsSummary();recompute();};
$('applyGeometry').onclick=()=>{
 const next={...cfg};
 for(const id of ['cx','cy','cz','scale','r1','r2']){if($(id).value.trim()===''){status('Fill in every geometry field before applying.',true);return;}next[id]=Number($(id).value);if(!Number.isFinite(next[id])){status('Geometry settings must be numbers.',true);return;}}
 if(next.scale<=0||next.scale>10||next.r1<=0||next.r2<=0){status('Scale must be above 0 and at most 10. R1 and R2 must be positive.',true);return;}
 cfg=next;recompute();
};

/* ---------- modes and stages ---------- */
const STEPS=[
 ['01 Raw drawing','Recorded world XYZ. The dashed curve is the reference at θ=0°, not the stimulus at each sample.'],
 ['02 Remove stimulus rotation','Each sample is rotated by −θ so every drawing sits on the same stationary curve.'],
 ['03 XY matching','Grey samples fail the XY limit or ambiguity check. Dashed lines join each selected sample to its location.'],
 ['04 Compare Z','Depth of A and B at the selected location. The reference at Z=0 marks position, not a target depth.']
];
function setMode(next){
 if(next===uiMode)return;
 if(uiMode==='play')pauseReplay();
 if(next==='play')playFrame=uiMode==='corr'&&step===0?0:1;
 uiMode=next;updateStage();updateInspector();drawAll();hooks.onPair?.(result?.ia,result?.ib,uiMode);
}
document.querySelectorAll('button[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{const s=+b.dataset.step;if(s===4){setMode('cycle');return;}step=s;if(uiMode!=='corr')setMode('corr');else{updateStage();updateInspector();drawAll();}});
document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{playFrame=+b.dataset.frame;updateStage();drawAll();});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;updateStage();drawSpace();});
$('resetView').onclick=()=>{yaw=.6;pitch=.4;zoom=1;view='3d';updateStage();drawSpace();};
$('zoomIn').onclick=()=>{zoom=Math.min(4,zoom*1.2);drawSpace();};
$('zoomOut').onclick=()=>{zoom=Math.max(.4,zoom/1.2);drawSpace();};
$('space').addEventListener('wheel',e=>{if(view!=='3d')return;e.preventDefault();zoom=Math.max(.4,Math.min(4,zoom*Math.exp(-e.deltaY*.0015)));drawSpace();},{passive:false});
$('phi').oninput=()=>selectPhi(+$('phi').value);
$('showScatter').onchange=()=>{updateStage();drawDepth();};

function selectPhi(i){
 // Any φ interaction leaves playback or cycle review and restores the correspondence markers.
 selected=((i%1000)+1000)%1000;$('phi').value=selected;
 if(uiMode!=='corr'){if(uiMode==='play')pauseReplay();uiMode='corr';updateStage();}
 updateInspector();drawAll();
}

function legend(items,id='legend'){const ul=$(id);ul.replaceChildren();for(const [cls,text] of items){const li=el('li');li.append(el('i',cls),text);ul.append(li);}}
function updateStage(){
 document.body.dataset.mode=uiMode;
 document.querySelectorAll('button[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===uiMode)));
 document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 document.querySelectorAll('[data-frame]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.frame===playFrame)));
 const current=uiMode==='corr'?step:uiMode==='cycle'?4:null;
 document.querySelectorAll('[data-step]').forEach(b=>{const s=+b.dataset.step;if(s===current)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');b.classList.toggle('context',uiMode==='play'&&s===playFrame);});
 $('dockCorr').hidden=uiMode!=='corr';$('dockPlay').hidden=uiMode!=='play';
 $('inspCorr').hidden=uiMode!=='corr';$('inspPlay').hidden=uiMode!=='play';$('inspCycle').hidden=uiMode!=='cycle';
 $('cycleScopeNote').hidden=uiMode!=='cycle';
 $('scatterToggle').hidden=uiMode!=='corr';
 const world=isWorld();
 if(uiMode==='corr'){
  $('stageTitle').textContent=STEPS[step][0];$('stageHelp').textContent=STEPS[step][1];
  legend([['la','Drawing A'],['lb','Drawing B'],[world?'lrefd':'lref',world?'Reference at θ=0°':'Reference curve (Z=0)'],...(step>=2?[['lex','Excluded samples']]:[])]);
  $('dragHint').textContent=view==='3d'?'Drag to orbit. Click the curve to pick a location.':'Click the curve to pick a location.';
  $('lowerTitle').textContent='Where along the curve A and B differ';
  legend([['la','A selected Z'],['lb','B selected Z'],...($('showScatter').checked?[['ldots','Individual samples']]:[]),['lrefd','Selected φ']],'lowerLegend');
  $('depthHelp').textContent='Depth of each drawing along the curve. A wide gap between the lines is a large |ΔZ|. Click a spot to inspect it; gaps are locations with no valid match.';
 }else if(uiMode==='play'){
  $('stageTitle').textContent='Replay both drawings on recorded time';
  $('stageHelp').textContent='Both trials start at their own 0 s and advance on recorded timestamps. Timing only, not matching.';
  legend([['la','A, latest sample'],['lb','B, latest sample'],[world?'lrefd':'lref',world?'Reference at θ=0°':'Reference curve (Z=0)']]);
  $('dragHint').textContent=view==='3d'?'Drag to orbit. Clicking the curve returns to Correspondence.':'Clicking the curve returns to Correspondence.';
  $('lowerTitle').textContent='World Z over elapsed time';
  legend([['la','A world Z'],['lb','B world Z'],['lplay','Playhead']],'lowerLegend');
  $('depthHelp').textContent='World Z against elapsed time. Click to move the playhead.';
 }else{
  $('stageTitle').textContent='05 Complete-drawing candidates';
  $('stageHelp').textContent='One proposed full turn per trial, between consecutive φ=0 crossings. Not a verified complete drawing.';
  legend([['la','A candidate'],['lb','B candidate'],['lref','Reference curve (Z=0)'],['lcand','Endpoint gap']]);
  $('dragHint').textContent=view==='3d'?'Drag to orbit.':'';
  $('lowerTitle').textContent='Candidate timeline';
  legend([['la','A tracked φ'],['lb','B tracked φ'],['lfill','Inspected candidate'],['lhatch','Other candidates'],['lrefd','φ=0 crossing']],'lowerLegend');
  $('depthHelp').textContent='Bars are every candidate; the filled bar is the one inspected. Click a bar to inspect it.';
 }
}

/* ---------- pair comparison ---------- */
function refresh(matrix=false){
 pauseReplay();replayTime=0;if(!model)return;
 try{result=compare(model,+$('trialA').value,+$('trialB').value,mode);}catch(e){status(e.message,true);return;}
 $('binControls').hidden=mode==='nearest';settingsSummary();$('branch').disabled=mode!=='nearest';
 $('pairName').textContent=`${T(result.ia)} (A) vs ${T(result.ib)} (B)`;
 $('metric').textContent=fmt(result.mae);$('coverage').textContent=fmt(result.coverage,1)+'%';$('coverageBar').style.width=result.coverage+'%';
 $('metricLabel').textContent=mode==='mean'?'Mean |bin-mean ΔZ|':mode==='all'?'Mean |ΔZ|, all pairs per bin':'Mean |Z A − Z B|';
 $('metricNote').textContent=`${result.count} of ${result.total} ${mode==='nearest'?'locations':'bins'} jointly valid`;
 if(matrix||!pairResults.length)pairResults=allPairs(model,mode);
 drawMatrix();drawCards();updateStage();updateInspector();drawAll();hooks.onPair?.(result.ia,result.ib,uiMode);
}
const binIndex=ref=>Math.round(ref*model.cfg.bins/1000)%model.cfg.bins;
function chosen(){if(!result)return null;return result.points[mode==='nearest'?selected:binIndex(selected)];}
function sideStatus(t,cp){
 if(mode==='nearest'){const n=t.nearest[cp.ref];if(!t.points[n.k])return 'no candidate sample';if(n.d>model.cfg.gate)return 'XY distance exceeds limit';if(model.cfg.branch&&!n.branchOK)return 'different branch';return 'valid';}
 const bin=t.profile[binIndex(cp.ref)];return bin.n>=model.cfg.min?'valid':`too few samples (${bin.n} < ${model.cfg.min})`;
}
function updateInspector(){if(!model||!result)return;if(uiMode==='corr')updatePoint();else if(uiMode==='play')updateReplay();else updateCycles();}
function updatePoint(){
 const cp=chosen();
 $('phiValue').textContent=fmt(selected*.36,1)+'°';$('phiIndex').textContent=selected;
 $('selectedRef').textContent=mode==='nearest'?`φ ${fmt(cp.phi,1)}°`:`bin at φ ${fmt(cp.phi,1)}°`;
 const box=$('pointDetails');box.replaceChildren();
 pairTrials().forEach((t,side)=>{
  const st=sideStatus(t,cp),n=mode==='nearest'?t.nearest[cp.ref]:null,p=n?t.points[n.k]:null;
  const sub=mode==='nearest'?(p?`Z ${fmt(p.canonical[2])} cm, point ${p.sourceIndex}, ${fmt(p.elapsed,2)} s`:'No candidate sample'):`${cp[side?'bk':'ak'].length} samples in bin, mean Z ${fmt(cp[side?'b':'a'])} cm`;
  const card=trialCard(side,t,'',sub,st==='valid'?['ok','Valid']:['bad','Excluded']);
  if(st!=='valid')card.append(el('p','note subnote','Excluded: '+st));
  if(mode==='nearest'){
   if(p){card.append(provenance([['CSV TrialIndex',String(t.id)],['PointIndex',String(p.sourceIndex)],['Elapsed',`${fmt(p.elapsed,3)} s`],['CSV time',`${fmt(p.t,3)} s`],['World XYZ',p.world.map(v=>fmt(v)).join(', ')+' cm'],['De-rotated XYZ',p.canonical.map(v=>fmt(v)).join(', ')+' cm'],['θ at sample',`${fmt(p.theta%360,1)}°`],['XY distance',`${fmt(n.d,3)} cm (limit ${model.cfg.gate>=1000?'none':model.cfg.gate+' cm'})`],['Own nearest φ',`${fmt(p.idx*.36,1)}° (index ${p.idx})`]]));}
   else card.append(el('p','note','No non-ambiguous sample in this trial.'));
  }else{
   const ks=cp[side?'bk':'ak'],zs=ks.map(k=>t.points[k].canonical[2]);
   card.append(provenance([['Samples in bin',String(ks.length)],['Bin mean Z',`${fmt(cp[side?'b':'a'])} cm`],['Z range',zs.length?`${fmt(Math.min(...zs))} to ${fmt(Math.max(...zs))} cm`:'—'],['PointIndex',ks.length?ks.map(k=>t.points[k].sourceIndex).join(', '):'—']]));
  }
  box.append(card);
 });
 const f=$('pointFormula');f.replaceChildren();
 const fig=(value,label)=>{const d=el('div','fig');d.append(el('strong','',value),el('span','',label));return d;};
 if(cp.valid)f.append(fig(`${fmt(cp.delta)} cm`,mode==='all'?'Mean |ΔZ| in bin':'|ΔZ| at this φ'),fig(`${fmt(cp.phi,1)}°`,mode==='nearest'?'Curve position φ':'Bin centre φ'));
 if(cp.valid){f.append(el('div','eq',mode==='all'?`mean of ${cp.ak.length} × ${cp.bk.length} |Z A − Z B| = ${fmt(cp.delta)} cm`:`|${sfmt(cp.a)} − ${sfmt(cp.b)}| = ${fmt(cp.delta)} cm`));f.append(el('p','note',mode==='nearest'?'From the two samples below. De-rotated Z, not target depth.':mode==='mean'?'Difference of the two bin means.':'Every cross-trial pair of samples in this bin.'));}
 else f.append(el('p','note','No shared valid match here, so this location is left out of the score (not counted as zero).'));
}

/* ---------- cycle review ---------- */
const CHECKS=[
 ['Tracking continuity',c=>c.reasons.includes('tracking break')?'reset inside':'no reset','no reset','tracking break'],
 ['Largest time gap',c=>`${fmt(c.maxGapSeconds*1000,1)} ms`,'≤ 100 ms','recording gap >100 ms'],
 ['Curve bins sampled',c=>`${c.coveragePct} / 100`,'≥ 95','curve coverage <95%'],
 ['Backtracking',c=>`${fmt(c.backtrackingPct,1)}%`,'≤ 10%','backtracking >10%'],
 ['Samples >2 cm off curve',c=>`${fmt(c.offCurvePct,1)}%`,'≤ 5%','more than 5% of samples >2 cm from curve'],
 ['XY endpoint gap',c=>`${fmt(c.xyClosureCm)} cm`,'≤ 1 cm','XY endpoint gap >1 cm']
];
function candidateState(c){return c.accepted?['ok','Passes provisional XY checks']:['unverified',`Unverified: fails ${c.reasons.length} of 6 XY checks`];}
function chooseCandidate(t,i){const n=t.cycles.candidates.length;if(!n)return;t.cycleChoice=((i%n)+n)%n;updateCycles();drawAll();}
function updateCycles(){
 const box=$('cycleDetails');box.replaceChildren();
 pairTrials().forEach((t,side)=>{
  const cands=t.cycles.candidates,c=cands[t.cycleChoice],card=trialCard(side,t,c?`, candidate ${t.cycleChoice+1} of ${cands.length}`:'');
  if(!c){card.append(el('p','note','No full-turn candidate was proposed for this trial. That does not show the trial contains no complete drawing.'));box.append(card);return;}
  const nav=el('div','candNav'),prev=el('button','','‹'),next=el('button','','›'),sel=el('select');
  prev.type=next.type='button';prev.setAttribute('aria-label',`Previous candidate, ${T(t.id)}`);next.setAttribute('aria-label',`Next candidate, ${T(t.id)}`);
  sel.setAttribute('aria-label',`Candidate for ${T(t.id)}`);
  cands.forEach((k,i)=>{const o=el('option','',`#${i+1}: ${fmt(k.startElapsed)}–${fmt(k.endElapsed)} s, ${k.accepted?'passes XY checks':'unverified'}`);o.value=i;sel.append(o);});
  sel.value=t.cycleChoice;sel.onchange=()=>chooseCandidate(t,+sel.value);prev.onclick=()=>chooseCandidate(t,t.cycleChoice-1);next.onclick=()=>chooseCandidate(t,t.cycleChoice+1);
  nav.append(prev,sel,next);card.append(nav);
  const [cls,label]=candidateState(c);card.append(el('span','state '+cls,label));
  card.append(el('p','subhead','Source range (inclusive)'));
  card.append(facts([['PointIndex',`${c.startPoint} → ${c.endPoint} (${c.samples} samples)`],['CSV TimeStamp',`${fmt(c.startTimestamp,3)} → ${fmt(c.endTimestamp,3)} s`],['Trial elapsed',`${fmt(c.startElapsed,3)} → ${fmt(c.endElapsed,3)} s (${fmt(c.duration,3)} s)`],['Direction',c.direction>0?'increasing φ':'decreasing φ'],['Tracked progress',`${fmt(c.progressDeg,1)}°`]]));
  card.append(el('p','subhead','Provisional XY checks'));
  const table=el('table','checks'),thead=el('tr');for(const h of ['Check','Value','Needs','']){thead.append(el('th','',h));}table.append(thead);
  for(const [name,val,need,reason] of CHECKS){const tr=el('tr'),fail=c.reasons.includes(reason);tr.append(el('td','',name),el('td','',val(c)),el('td','',need),el('td',fail?'fail':'',fail?'✕ fail':'✓ pass'));table.append(tr);}
  card.append(table);
  card.append(el('p','subhead','Endpoint return (reported, never used to select)'));
  card.append(facts([['|ΔZ| start to end',`${fmt(c.zClosureCm)} cm`],['3D gap, de-rotated',`${fmt(c.closure3dCm)} cm`],['3D gap ≤ 1 cm',c.closed3d?'yes (a tolerance, not proof of a full loop)':'no']]));
  const btn=el('button','',c.accepted?'Export this candidate (CSV)':'Export as UNVERIFIED excerpt (CSV)');btn.type='button';btn.style.marginTop='10px';btn.onclick=()=>exportCycle(t,c);card.append(btn);
  box.append(card);
 });
 $('cycleSummary').textContent='All trials: '+model.trials.map(t=>`${T(t.id)}: ${t.cycles.candidates.length} candidates, ${t.cycles.candidates.filter(c=>c.accepted).length} pass`).join('; ')+'.';
}
function exportCycle(t,c){
 const rs=rows.filter(r=>r.TrialIndex===t.id).sort((a,b)=>a.TimeStamp-b.TimeStamp).slice(c.start,c.end+1),keys=Object.keys(rs[0]),lines=[keys.join(','),...rs.map(r=>keys.map(k=>r[k]??'').join(','))];
 download(lines.join('\n'),`trial_${t.id}_candidate_${t.cycleChoice+1}_${c.accepted?'xy_pass':'UNVERIFIED'}.csv`);
}
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

/* ---------- canvas helpers ---------- */
function canvas(id){const c=$(id),rect=c.getBoundingClientRect(),dpr=devicePixelRatio||1;c.width=Math.round(rect.width*dpr);c.height=Math.round(rect.height*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,rect.width,rect.height);return {ctx,w:rect.width,h:rect.height};}
function project(p){if(view==='xy')return [p[0],p[1]];if(view==='xz')return [p[0],p[2]];if(view==='yz')return [p[1],p[2]];const x=Math.cos(yaw)*p[0]+Math.sin(yaw)*p[2],z=-Math.sin(yaw)*p[0]+Math.cos(yaw)*p[2];return [x,Math.cos(pitch)*p[1]-Math.sin(pitch)*z];}
function marker(ctx,q,side,r,fill,stroke='#fff'){ctx.beginPath();if(side)ctx.rect(q[0]-r,q[1]-r,2*r,2*r);else ctx.arc(q[0],q[1],r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle=stroke;ctx.stroke();}
function callout(ctx,q,text,col,dx,dy,w,h){
 ctx.font='600 12px system-ui,sans-serif';const tw=ctx.measureText(text).width+12;let x=q[0]+dx,y=q[1]+dy;if(dx<0)x-=tw;x=Math.max(4,Math.min(w-tw-4,x));y=Math.max(22,Math.min(h-8,y));
 for(let tries=0;tries<12&&placed.some(r=>x<r[0]+r[2]&&r[0]<x+tw&&y-17<r[1]+20&&r[1]<y+3);tries++)y=y+22>h-8?y-44*(tries+1):y+22;
 placed.push([x,y-17,tw]);
 ctx.strokeStyle=col;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(...q);ctx.lineTo(x+(dx<0?tw:0),y-8);ctx.stroke();
 ctx.fillStyle='#ffffffee';ctx.fillRect(x,y-17,tw,20);ctx.strokeRect(x+.5,y-16.5,tw-1,19);ctx.fillStyle=REF;ctx.fillText(text,x+6,y-3);
}
// Draws recorded samples in time order without joining recording gaps over 100 ms.
function pathLine(ctx,pts,toXY,until=Infinity){let prev=null;ctx.beginPath();for(const p of pts){if(p.elapsed>until)break;const v=toXY(p);if(prev&&p.t-prev.t<=.1)ctx.lineTo(...v);else ctx.moveTo(...v);prev=p;}ctx.stroke();}

/* ---------- spatial plot ---------- */
function drawSpace(){
 if(!model||!result)return;
 placed=[];
 const {ctx,w,h}=canvas('space'),trials=pairTrials(),world=isWorld(),coords=p=>world?p.world:p.canonical,c0=model.cfg;
 const ref3=model.curve.map(p=>world?[p[0]+c0.cx*100,p[1]+c0.cy*100,c0.cz*100]:[...p,0]);
 const xyz=[...ref3,...trials.flatMap(t=>t.points.map(coords))];
 const low=[0,1,2].map(k=>Math.min(...xyz.map(p=>p[k]))),high=[0,1,2].map(k=>Math.max(...xyz.map(p=>p[k]))),center=low.map((v,k)=>(v+high[k])/2);
 const all=xyz.map(project),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
 let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
 if(xmax-xmin<1){xmin-=1;xmax+=1;}if(ymax-ymin<1){ymin-=1;ymax+=1;}
 const pad=56;let scale=Math.min((w-2*pad)/(xmax-xmin),(h-2*pad)/(ymax-ymin)),mx=(xmin+xmax)/2,my=(ymin+ymax)/2;
 if(view==='3d'){const radius=Math.max(1,...xyz.map(p=>Math.hypot(...p.map((v,k)=>v-center[k]))));scale=Math.min(w-2*pad,h-2*pad)/(2*radius)*zoom;[mx,my]=project(center);}
 const screen=p=>{const q=project(p);return [w/2+(q[0]-mx)*scale,h/2-(q[1]-my)*scale];};
 ctx.font=MONO;ctx.lineWidth=1;
 if(view!=='3d'){
  const vx=(xmax-xmin)/4,vy=(ymax-ymin)/4,axes={xy:['X','Y'],xz:['X','Z'],yz:['Y','Z']}[view];
  for(let k=0;k<=4;k++){const xx=xmin+k*vx,yy=ymin+k*vy,x=w/2+(xx-mx)*scale,y=h/2-(yy-my)*scale;ctx.strokeStyle='#e8ecea';ctx.beginPath();ctx.moveTo(x,40);ctx.lineTo(x,h-32);ctx.stroke();ctx.beginPath();ctx.moveTo(38,y);ctx.lineTo(w-20,y);ctx.stroke();ctx.fillStyle='#7a878d';ctx.fillText(fmt(xx,0),x-8,h-16);ctx.fillText(fmt(yy,0),6,y+4);}
 }else{
  const corners=Array.from({length:8},(_,i)=>[i&1?high[0]:low[0],i&2?high[1]:low[1],i&4?high[2]:low[2]]);ctx.strokeStyle='#e0e6e3';
  for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){ctx.beginPath();ctx.moveTo(...screen(corners[i]));ctx.lineTo(...screen(corners[i|bit]));ctx.stroke();}
  const origin=[w-70,h-60];
  for(const [axis,col,k] of [['X','#6b6b6b',0],['Y','#6b6b6b',1],['Z','#6b6b6b',2]]){const p=[0,0,0];p[k]=32;const q=project(p);ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...origin);ctx.lineTo(origin[0]+q[0],origin[1]-q[1]);ctx.stroke();ctx.fillText(axis,origin[0]+q[0]+4,origin[1]-q[1]+4);}
 }
 $('frameChip').textContent=`${world?'World':'Stimulus-de-rotated'} frame, ${view==='3d'?'X Y Z':{xy:'X → Y ↑',xz:'X → Z ↑',yz:'Y → Z ↑'}[view]}, cm`;
 $('space').style.cursor=view==='3d'?(pointer?'grabbing':'grab'):uiMode==='cycle'?'default':'crosshair';
 $('zoomValue').textContent=Math.round(zoom*100)+'%';
 $('viewAngles').textContent=view==='3d'?`3D orbit: yaw ${Math.round(yaw*180/Math.PI)}°, pitch ${Math.round(pitch*180/Math.PI)}°`:`Orthographic ${view.toUpperCase()}`;
 const excl=uiMode==='corr'&&step>=2,faint=uiMode==='corr'?.22:.12;
 trials.forEach((t,ti)=>{
  ctx.lineWidth=.8;ctx.strokeStyle=COLS[ti];ctx.globalAlpha=faint;pathLine(ctx,t.points,p=>screen(coords(p)));
  for(const p of t.points){const [x,y]=screen(coords(p));ctx.fillStyle=excl&&!p.valid?EXCL:COLS[ti];ctx.globalAlpha=uiMode!=='corr'?.2:excl&&!p.valid?.35:.45;ctx.fillRect(x-1,y-1,2,2);}
  ctx.globalAlpha=1;
 });
 ctx.strokeStyle=REF;ctx.lineWidth=1.4;ctx.setLineDash(world?[5,4]:[]);ctx.beginPath();ref3.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();ctx.stroke();ctx.setLineDash([]);
 projectedRef=ref3.map(screen);
 if(uiMode==='cycle')return drawCycleSegments(ctx,screen,coords,trials,w,h);
 if(uiMode==='play')return drawReplay(ctx,screen,coords,trials);
 const cp=chosen(),ref=screen(ref3[cp.ref]);
 ctx.fillStyle=REF;ctx.beginPath();ctx.arc(...ref,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
 const labels=[];
 trials.forEach((t,ti)=>{
  const ks=cp[ti?'bk':'ak'].filter(k=>t.points[k]),qs=ks.map(k=>screen(coords(t.points[k])));
  for(const q of qs){if(mode==='nearest'&&!world){ctx.strokeStyle=COLS[ti];ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(...ref);ctx.lineTo(...q);ctx.stroke();ctx.setLineDash([]);}marker(ctx,q,ti,mode==='nearest'?6:3.5,COLS[ti]);}
  if(!qs.length)return;
  const at=mode==='nearest'?qs[0]:[qs.reduce((s,q)=>s+q[0],0)/qs.length,qs.reduce((s,q)=>s+q[1],0)/qs.length],ok=sideStatus(t,cp)==='valid';
  const text=mode==='nearest'?`${SIDE[ti]} #${t.points[ks[0]].sourceIndex}  Z ${fmt(t.points[ks[0]].canonical[2])} cm${ok?'':' (excluded)'}`:`${SIDE[ti]} bin: ${ks.length} samples, mean Z ${fmt(cp[ti?'b':'a'])} cm`;
  labels.push([at,text,COLS[ti],ti?24:-24,ti?34:-18]);
 });
 for(const [q,text,col,dx,dy] of labels)callout(ctx,q,text,col,dx,dy,w,h);
}
function drawCycleSegments(ctx,screen,coords,ts,w,h){
 const labels=[];
 ts.forEach((t,i)=>{
  const c=t.cycles.candidates[t.cycleChoice];if(!c)return;
  ctx.strokeStyle=COLS[i];ctx.lineWidth=2.6;pathLine(ctx,t.points.slice(c.start,c.end+1),p=>screen(coords(p)));
  const s=screen(coords(t.points[c.start])),e=screen(coords(t.points[c.end]));
  ctx.strokeStyle=CAUTION;ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(...s);ctx.lineTo(...e);ctx.stroke();ctx.setLineDash([]);
  marker(ctx,s,i,6,'#fff',COLS[i]);marker(ctx,e,i,6,COLS[i]);
  labels.push([s,`${SIDE[i]} start #${c.startPoint}`,COLS[i],i?22:-22,i?-14:-18],[e,`${SIDE[i]} end #${c.endPoint}, 3D gap ${fmt(c.closure3dCm)} cm`,COLS[i],i?22:-22,i?34:30]);
 });
 for(const [q,text,col,dx,dy] of labels)callout(ctx,q,text,col,dx,dy,w,h);
}

/* ---------- playback ---------- */
let replayTime=0,replayRunning=false,replayFrame=null,replayLast=null;
function replayPoint(t){let lo=0,hi=t.points.length;while(lo<hi){const m=(lo+hi)>>1;if(t.points[m].elapsed<=replayTime)lo=m+1;else hi=m;}return t.points[Math.max(0,lo-1)];}
function pauseReplay(){replayRunning=false;replayLast=null;if(replayFrame!==null)cancelAnimationFrame(replayFrame);replayFrame=null;$('playPause').textContent='Play';}
function playEnd(){return Math.max(...pairTrials().map(t=>t.duration));}
function updateReplay(){
 const ts=pairTrials();if(!ts.length)return;const end=playEnd();
 $('replayTime').max=end;$('replayTime').value=replayTime;$('replayClock').textContent=`${fmt(replayTime)} of ${fmt(end)} s`;
 const box=$('replayDetails');box.replaceChildren();
 ts.forEach((t,i)=>{
  const p=replayPoint(t),prev=t.points[p.k-1],dt=prev?p.t-prev.t:0,dz=prev?p.world[2]-prev.world[2]:0;
  const dir=dt>0&&dt<=.1?(Math.abs(dz)<.001?'near zero':dz>0?'+Z':'−Z'):'unavailable';
  const state=replayTime>t.duration?'trial ended; holding last sample':replayTime-p.elapsed>.1?'recording gap; holding last sample':'recording';
  const card=trialCard(i,t,'',`World Z ${fmt(p.world[2])} cm, ${dir}, point ${p.sourceIndex}`,state==='recording'?['ok','Recording']:['bad',replayTime>t.duration?'Ended':'Gap']);card.append(provenance([['PointIndex',String(p.sourceIndex)],['Sample elapsed',`${fmt(p.elapsed,3)} s`],['World Z',`${fmt(p.world[2])} cm`],['Z direction',dir],['State',state]]));box.append(card);
 });
}
function drawReplay(ctx,screen,coords,ts){
 ts.forEach((t,i)=>{ctx.strokeStyle=COLS[i];ctx.lineWidth=2.2;pathLine(ctx,t.points,p=>screen(coords(p)),replayTime);const v=screen(coords(replayPoint(t)));marker(ctx,v,i,7,COLS[i]);ctx.font='bold 13px system-ui,sans-serif';ctx.fillStyle=COLS[i];ctx.fillText(SIDE[i],v[0]+11,v[1]-9);});
}
function tickReplay(now){
 if(!replayRunning)return;const end=playEnd();
 if(replayLast!==null)replayTime=Math.min(end,replayTime+(now-replayLast)/1000*Number($('playSpeed').value));
 replayLast=now;updateReplay();drawSpace();drawDepth();
 if(replayTime>=end){pauseReplay();return;}
 replayFrame=requestAnimationFrame(tickReplay);
}
$('playPause').onclick=()=>{if(!result)return;if(replayRunning){pauseReplay();return;}if(replayTime>=playEnd())replayTime=0;replayRunning=true;replayLast=null;$('playPause').textContent='Pause';replayFrame=requestAnimationFrame(tickReplay);};
$('replayReset').onclick=()=>{pauseReplay();setTime(0);};
$('replayTime').oninput=()=>{pauseReplay();setTime(Number($('replayTime').value));};
function setTime(v){replayTime=Math.max(0,Math.min(playEnd(),v));updateReplay();drawSpace();drawDepth();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseReplay();});

/* ---------- lower plot ---------- */
const PLOT_MARGIN={left:52,right:18,top:26,bottom:32};
let hoverX=null,hoverY=null;
function sampleAt(t,time){let lo=0,hi=t.points.length;while(lo<hi){const m=(lo+hi)>>1;if(t.points[m].elapsed<=time)lo=m+1;else hi=m;}return t.points[Math.max(0,lo-1)];}
function crosshair(ctx,x,top,bottom){ctx.strokeStyle='#8f9a95';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();}
function tip(x,title,rows){
 const box=$('lowerTip');if(x===null){box.hidden=true;return;}
 box.replaceChildren(el('strong','',title));
 for(const [side,label,value] of rows){const lab=el('span','lab');if(side!==null)lab.append(el('i','key '+(side?'b':'a')));lab.append(label);box.append(lab,el('span','val',value));}
 box.hidden=false;const wrap=box.parentElement.clientWidth,wBox=box.offsetWidth;box.style.left=`${x+14+wBox>wrap?x-14-wBox:x+14}px`;
}
function drawDepth(){if(!model||!result)return;if(uiMode==='cycle')return drawCycleProgress();if(uiMode==='play')return drawTimeZ();drawZProfile();}
function axesY(ctx,lo,hi,yy,left,w,right,n=0){ctx.font=MONO;ctx.lineWidth=1;ctx.setLineDash([3,4]);for(let i=0;i<=4;i++){const z=lo+(hi-lo)*i/4,y=yy(z);ctx.strokeStyle='#e3e3e3';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#6b6b6b';ctx.fillText(fmt(z,n),4,y+4);}ctx.setLineDash([]);}
function drawZProfile(){
 const {ctx,w,h}=canvas('depth'),ts=pairTrials(),vals=ts.flatMap(t=>t.points.filter(p=>p.valid).map(p=>p.canonical[2]));
 const lo=vals.length?Math.min(...vals)-2:-10,hi=vals.length?Math.max(...vals)+2:10;const {left,right,top,bottom}=PLOT_MARGIN;
 const xx=phi=>left+phi/360*(w-left-right),yy=z=>h-bottom-(z-lo)/(hi-lo)*(h-top-bottom);depthBox={left,right,w};
 axesY(ctx,lo,hi,yy,left,w,right);for(let i=0;i<=4;i++)ctx.fillText(`${i*90}°`,xx(i*90)-9,h-12);
 ctx.fillText('Z (cm)',4,11);
 ts.forEach((t,ti)=>{
  if($('showScatter').checked){ctx.fillStyle=COLS[ti];ctx.globalAlpha=.13;for(const p of t.points)if(p.valid){ctx.beginPath();ctx.arc(xx(p.idx*.36),yy(p.canonical[2]),1.8,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
  ctx.strokeStyle=COLS[ti];ctx.lineWidth=2;ctx.beginPath();let prev=false;
  for(const p of result.points){const z=ti?p.b:p.a;if(!p.valid||z===null){prev=false;continue;}prev?ctx.lineTo(xx(p.phi),yy(z)):ctx.moveTo(xx(p.phi),yy(z));prev=true;}ctx.stroke();
 });
 const cp=chosen();ctx.strokeStyle=REF;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(xx(cp.phi),top);ctx.lineTo(xx(cp.phi),h-bottom);ctx.stroke();ctx.setLineDash([]);
 if(cp.valid)[[cp.a,0],[cp.b,1]].forEach(([z,s])=>marker(ctx,[xx(cp.phi),yy(z)],s,4.5,COLS[s]));
 if(hoverX===null||hoverX<left||hoverX>w-right)return tip(null);
 const i=Math.max(0,Math.min(999,Math.round((hoverX-left)/(w-left-right)*1000))),hp=result.points[mode==='nearest'?i:binIndex(i)];
 crosshair(ctx,xx(hp.phi),top,h-bottom);
 tip(xx(hp.phi),`${mode==='nearest'?'':'Bin at '}φ ${fmt(hp.phi,1)}°`,hp.valid?[[0,'Drawing A Z',`${fmt(hp.a)} cm`],[1,'Drawing B Z',`${fmt(hp.b)} cm`],[null,'|ΔZ|',`${fmt(hp.delta)} cm`]]:[[null,'No shared valid match','']]);
}
function drawTimeZ(){
 const {ctx,w,h}=canvas('depth'),ts=pairTrials(),end=playEnd(),zs=ts.flatMap(t=>t.points.map(p=>p.world[2]));
 const lo=Math.min(...zs)-1,hi=Math.max(...zs)+1;const {left,right,top,bottom}=PLOT_MARGIN;
 const xx=v=>left+v/end*(w-left-right),yy=z=>h-bottom-(z-lo)/(hi-lo||1)*(h-top-bottom);timeBox={left,right,w,end};
 axesY(ctx,lo,hi,yy,left,w,right);for(let i=0;i<=5;i++)ctx.fillText(`${fmt(end*i/5,0)} s`,xx(end*i/5)-8,h-12);ctx.fillText('World Z (cm)',4,11);
 ts.forEach((t,i)=>{ctx.strokeStyle=COLS[i];ctx.lineWidth=2;pathLine(ctx,t.points,p=>[xx(p.elapsed),yy(p.world[2])]);const p=replayPoint(t);marker(ctx,[xx(p.elapsed),yy(p.world[2])],i,4.5,COLS[i]);});
 ctx.strokeStyle=PLAY;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xx(replayTime),top);ctx.lineTo(xx(replayTime),h-bottom);ctx.stroke();
 if(hoverX===null||hoverX<left||hoverX>w-right)return tip(null);
 const time=(hoverX-left)/(w-left-right)*end;crosshair(ctx,hoverX,top,h-bottom);
 tip(hoverX,`Elapsed ${fmt(time)} s`,ts.map((t,i)=>{const p=sampleAt(t,time),state=time>t.duration?', trial ended':time-p.elapsed>.1?', recording gap':'';return [i,`${SIDE[i]} #${p.sourceIndex}${state}`,`${fmt(p.world[2])} cm`];}));
}
function drawCycleProgress(){
 const {ctx,w,h}=canvas('depth'),ts=pairTrials(),all=ts.flatMap(t=>t.cycles.track.map(p=>p.u*.36)),lo=Math.min(...all),hi=Math.max(...all),end=Math.max(...ts.map(t=>t.duration));
 const left=52,right=18,laneTop=6,laneH=12,top=laneTop+2*(laneH+4)+10,bottom=32;
 const x=v=>left+v/end*(w-left-right),y=v=>h-bottom-(v-lo)/(hi-lo||1)*(h-top-bottom);cycleHits=[];
 ctx.font=MONO;
 for(let i=0;i<=5;i++){ctx.fillStyle='#6b6b6b';ctx.fillText(`${fmt(end*i/5,0)} s`,x(end*i/5)-8,h-12);}
 ctx.strokeStyle='#c9d0cc';ctx.setLineDash([4,4]);ctx.lineWidth=1;
 const k0=Math.ceil(lo/360),k1=Math.floor(hi/360),every=Math.max(1,Math.ceil((k1-k0+1)/6));
 for(let k=k0;k<=k1;k++){const yy=y(k*360);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();if(k%every===0){ctx.fillStyle='#6b787e';ctx.fillText(`${k*360}°`,4,yy+4);}}
 ctx.setLineDash([]);
 ts.forEach((t,i)=>{
  const ly=laneTop+i*(laneH+4);ctx.fillStyle=COLS[i];ctx.font='600 11px system-ui,sans-serif';ctx.fillText(SIDE[i],left-16,ly+10);
  t.cycles.candidates.forEach((c,ci)=>{const x0=x(c.startElapsed),x1=Math.max(x0+2,x(c.endElapsed)),on=ci===t.cycleChoice;ctx.fillStyle=on?COLS[i]:'#fff';ctx.strokeStyle=COLS[i];ctx.lineWidth=1;ctx.fillRect(x0,ly,x1-x0,laneH);ctx.strokeRect(x0+.5,ly+.5,x1-x0-1,laneH-1);if(!c.accepted&&!on){ctx.save();ctx.beginPath();ctx.rect(x0,ly,x1-x0,laneH);ctx.clip();ctx.strokeStyle=COLS[i]+'66';for(let s=x0-laneH;s<x1;s+=5){ctx.beginPath();ctx.moveTo(s,ly+laneH);ctx.lineTo(s+laneH,ly);ctx.stroke();}ctx.restore();}cycleHits.push({x0,x1,y0:ly-2,y1:ly+laneH+2,t,ci});});
  const c=t.cycles.candidates[t.cycleChoice];if(c){ctx.fillStyle=COLS[i]+'1c';ctx.fillRect(x(c.startElapsed),top,x(c.endElapsed)-x(c.startElapsed),h-bottom-top);}
  ctx.strokeStyle=COLS[i];ctx.lineWidth=2;ctx.beginPath();t.cycles.track.forEach((p,k)=>{const q=[x(t.points[k].elapsed),y(p.u*.36)];k&&!p.reset?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.stroke();
  if(c)for(const k of [c.start,c.end])marker(ctx,[x(t.points[k].elapsed),y(t.cycles.track[k].u*.36)],i,4,k===c.start?'#fff':COLS[i],COLS[i]);
 });
 const hit=hoverX===null?null:cycleHits.find(b=>hoverX>=b.x0-2&&hoverX<=b.x1+2&&hoverY>=b.y0&&hoverY<=b.y1);
 if(!hit)return tip(null);
 const hc=hit.t.cycles.candidates[hit.ci],side=pairTrials().indexOf(hit.t);
 tip(hoverX,`${SIDE[side]} candidate #${hit.ci+1}`,[[side,'Elapsed',`${fmt(hc.startElapsed)}–${fmt(hc.endElapsed)} s`],[null,'PointIndex',`${hc.startPoint}–${hc.endPoint}`],[null,'State',hc.accepted?'passes XY checks':'unverified']]);
}

/* ---------- drawing cards ---------- */
function drawCards(){
 pairTrials().forEach((t,i)=>{
  const {ctx,w,h}=canvas(i?'thumbB':'thumbA'),xs=model.curve.map(q=>q[0]),ys=model.curve.map(q=>q[1]);
  const span=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*1.25,sc=Math.min(w,h)/span,to=q=>[w/2+q[0]*sc,h/2-q[1]*sc];
  ctx.strokeStyle='#d6d6d6';ctx.lineWidth=1;ctx.beginPath();model.curve.forEach((q,k)=>k?ctx.lineTo(...to(q)):ctx.moveTo(...to(q)));ctx.closePath();ctx.stroke();
  ctx.strokeStyle=COLS[i];ctx.globalAlpha=.55;ctx.lineWidth=.7;pathLine(ctx,t.points,p=>to(p.canonical));ctx.globalAlpha=1;
  $(i?'descB':'descA').textContent=`${t.points.length.toLocaleString('en-US')} samples, ${fmt(t.duration,1)} s, ${fmt(100*t.kept/t.points.length,0)}% matchable`;
 });
}

/* ---------- pair matrix ---------- */
// Sequential ramp validated with the dataviz ordinal checks (light end ≥2:1 on white).
const RAMP_LIGHT=70,RAMP_DARK=16;
// Black or white, whichever contrasts more with the cell; the worse of the two is still ≥4.58:1 on any background.
function textOn(l){const L=l/100,lin=v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4,Y=lin(L);return (Y+.05)/.05>=1.05/(Y+.05)?'#000':'#fff';}
function drawMatrix(){
 const grid=el('div','gridMatrix');grid.style.gridTemplateColumns=`30px repeat(${model.trials.length},minmax(30px,1fr))`;
 const cell=text=>grid.append(el('span','matrixLabel',String(text)));
 cell('');for(const t of model.trials)cell(t.id+1);
 const finite=pairResults.filter(p=>p.mae!==null),min=Math.min(...finite.map(p=>p.mae)),max=Math.max(...finite.map(p=>p.mae)),span=max-min||1;
 for(const a of model.trials){cell(a.id+1);for(const b of model.trials){
  if(a.id===b.id){cell('—');continue;}
  const p=pairResults.find(p=>(p.ia===a.id&&p.ib===b.id)||(p.ia===b.id&&p.ib===a.id)),has=p&&p.mae!==null,btn=el('button','',has?fmt(p.mae,1):'—');btn.type='button';
  const L=has?RAMP_LIGHT-(p.mae-min)/span*(RAMP_LIGHT-RAMP_DARK):null;btn.style.background=has?`hsl(0 0% ${L}%)`:'#f4f4f4';btn.style.color=has?textOn(L):REF;
  btn.title=`${T(a.id)} vs ${T(b.id)}: ${has?fmt(p.mae)+' cm':'no valid correspondence'}, shared coverage ${fmt(p?.coverage,1)}%`;btn.setAttribute('aria-label',btn.title);
  if((result.ia===a.id&&result.ib===b.id)||(result.ia===b.id&&result.ib===a.id)){btn.classList.add('selected');btn.setAttribute('aria-pressed','true');}
  btn.onclick=()=>{location.hash=`#/drawings/pair/${a.id+1}-${b.id+1}`;};grid.append(btn);
 }}
 const key=el('div','scaleKey'),bar=el('i');bar.style.background=`linear-gradient(90deg,hsl(0 0% ${RAMP_LIGHT}%),hsl(0 0% ${RAMP_DARK}%))`;
 if(finite.length)key.append(el('span','',`${fmt(min,1)} cm`),bar,el('span','',`${fmt(max,1)} cm`),el('span','dim','Darker = larger mean |ΔZ|. Shading spans this method\'s smallest to largest pair; the cell numbers are the values.'));
 $('matrix').replaceChildren(grid,key);
 const avg=finite.length?finite.reduce((s,p)=>s+p.mae,0)/finite.length:null;
 $('overall').textContent=finite.length?`${finite.length} pairs, equal-weight mean ${fmt(avg)} cm`:'No valid pairs';
 $('drwAnswer').textContent=finite.length?`Across ${finite.length} trial pairs, two drawings differ in depth by ${fmt(avg)} cm on average (range ${fmt(min,1)}–${fmt(max,1)} cm). Pairs share trials, so they are not independent.`:'No trial pair has a valid correspondence with these settings.';
}

/* ---------- pointer and keyboard ---------- */
let pointer=null,moved=false;
$('space').onpointerdown=e=>{pointer={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};moved=false;if(view==='3d')$('space').setPointerCapture(e.pointerId);};
$('space').onpointermove=e=>{if(!pointer||view!=='3d')return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>3)moved=true;yaw+=dx*.008;pitch=Math.max(-1.5,Math.min(1.5,pitch+dy*.008));pointer={...pointer,x:e.clientX,y:e.clientY};drawSpace();};
$('space').onpointerup=e=>{
 pointer=null;if($('space').hasPointerCapture(e.pointerId))$('space').releasePointerCapture(e.pointerId);
 if(moved||!model||uiMode==='cycle'){drawSpace();return;}
 const r=$('space').getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=0,dd=Infinity;
 projectedRef.forEach((p,i)=>{const d=Math.hypot(p[0]-x,p[1]-y);if(d<dd){dd=d;best=i;}});selectPhi(best);
};
$('space').onpointercancel=()=>{pointer=null;drawSpace();};
$('depth').onpointermove=e=>{const r=$('depth').getBoundingClientRect();hoverX=e.clientX-r.left;hoverY=e.clientY-r.top;drawDepth();};
$('depth').onpointerleave=()=>{hoverX=hoverY=null;drawDepth();};
$('depth').onclick=e=>{
 if(!model)return;const r=$('depth').getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
 if(uiMode==='cycle'){const hit=cycleHits.find(b=>x>=b.x0-2&&x<=b.x1+2&&y>=b.y0&&y<=b.y1);if(hit)chooseCandidate(hit.t,hit.ci);return;}
 if(uiMode==='play'){if(timeBox){pauseReplay();setTime((x-timeBox.left)/(timeBox.w-timeBox.left-timeBox.right)*timeBox.end);}return;}
 if(depthBox)selectPhi(Math.max(0,Math.min(999,Math.round((x-depthBox.left)/(depthBox.w-depthBox.left-depthBox.right)*1000))));
};
for(const id of ['space','depth'])$(id).onkeydown=e=>{
 if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;const d=e.key==='ArrowRight'?1:-1;
 if(uiMode==='cycle'){if(id==='depth'){e.preventDefault();const t=pairTrials()[e.shiftKey?1:0];chooseCandidate(t,t.cycleChoice+d);}return;}
 e.preventDefault();if(uiMode==='play'&&id==='depth'){pauseReplay();setTime(replayTime+d*.1);return;}selectPhi(selected+d);
};

/* ---------- pair export ---------- */
$('export').onclick=()=>{
 if(!result)return;const ts=pairTrials(),c0=model.cfg;
 const lines=[['trial_a','trial_b','mode','curve_phi_deg','reference_index','valid','Z_A_cm','Z_B_cm','Z_absolute_difference_cm','A_point_indices','B_point_indices','xy_gate_cm','ambiguity_excluded','branch_check','bins','min_samples','center_X_m','center_Y_m','center_Z_m','scale','R1','R2','A_status','B_status'].join(',')];
 for(const p of result.points)lines.push([result.ia,result.ib,mode,p.phi,p.ref,p.valid,p.a??'',p.b??'',p.delta??'',`"${p.ak.map(k=>ts[0].points[k]?.sourceIndex??'').join(';')}"`,`"${p.bk.map(k=>ts[1].points[k]?.sourceIndex??'').join(';')}"`,c0.gate,c0.ambiguity,c0.branch,c0.bins,c0.min,c0.cx,c0.cy,c0.cz,c0.scale,c0.r1,c0.r2,`"${sideStatus(ts[0],p)}"`,`"${sideStatus(ts[1],p)}"`].join(','));
 download('﻿'+lines.join('\n'),`trials_${result.ia}_${result.ib}_${mode}.csv`);
};

function drawAll(){drawSpace();drawDepth();}
const observer=new ResizeObserver(()=>{if(model)requestAnimationFrame(drawAll);});observer.observe($('space'));observer.observe($('depth'));

if(document.modelContext?.registerTool){for(const tool of [
 {name:'read_trial_comparison',description:'Read the currently visible whole-trial comparison and its settings.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>{if(!result)throw Error('Data not ready');return {trialA:result.ia,trialB:result.ib,mode,maeCm:result.mae,coveragePercent:result.coverage,scope:'whole trial',settings:model.cfg};}},
 {name:'select_trial_comparison',description:'Select two trials and an analysis method in the visible interface.',inputSchema:{type:'object',properties:{trialA:{type:'number'},trialB:{type:'number'},mode:{enum:['nearest','mean','all']}},required:['trialA','trialB','mode'],additionalProperties:false},execute:input=>{if(!model||!input||!['nearest','mean','all'].includes(input.mode)||input.trialA===input.trialB||![input.trialA,input.trialB].every(i=>model.trials.some(t=>t.id===i)))throw Error('Invalid trial selection');$('trialA').value=input.trialA;$('trialB').value=input.trialB;mode=input.mode;$('mode').value=mode;refresh(true);return {trialA:result.ia,trialB:result.ib,mode,maeCm:result.mae,coveragePercent:result.coverage};}}
])try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}

/* ---------- page API for the site router ---------- */
function applyPair(a,b,view){
 if(!model)return;const ids=model.trials.map(t=>t.id);
 if(ids.includes(a))$('trialA').value=a;if(ids.includes(b)&&b!==a)$('trialB').value=b;
 if(view&&view!==uiMode){if(uiMode==='play')pauseReplay();uiMode=view;}
}
// a, b are CSV TrialIndex values.
export function showPair(a,b,view){if(!model){pending={a,b,view};return;}applyPair(a,b,view);refresh();}
export function redraw(){if(model&&result){drawCards();drawAll();}}
export function summary(){
 if(!model||!pairResults.length)return null;const f=pairResults.filter(p=>p.mae!==null).map(p=>p.mae);
 return {label:sourceLabel,trials:model.trials.length,samples:model.samples,pairs:f.length,mean:f.reduce((s,v)=>s+v,0)/f.length,min:Math.min(...f),max:Math.max(...f),mode};
}
export function currentPair(){return result?{a:result.ia,b:result.ib,view:uiMode}:null;}

updateStage();
loadDefault();
