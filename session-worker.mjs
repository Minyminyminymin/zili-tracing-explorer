// Background processing for one uploaded session (unified *_Trials_* + *_Samples_* CSVs).
// Geometry and de-rotation come from session-geometry.mjs; logged TargetError is the primary error value.
import {deriveSessionGeometry,prepareTrial,canDerotate,tracePoint,savedTargetPoint,CUBE_TRACED_EDGES} from './session-geometry.mjs';

const num=v=>v===undefined||v===null||String(v).trim()===''?null:Number(v);
const fin=Number.isFinite;
const MAXPTS=900;
const ORDER=['Cube','Trefoil3D','Sphere','Ellipse','Trefoil2D'];

export function parseCSV(text){
 // Fast path: the exports never quote fields, so plain splitting is exact.
 if(!text.includes('"')){const lines=text.split(/\r?\n/).filter(l=>l.trim());if(!lines.length)return [];const h=lines[0].replace(/^\uFEFF/,'').split(',').map(x=>x.trim());
  const out=new Array(lines.length-1);for(let i=1;i<lines.length;i++){const f=lines[i].split(','),o={};for(let k=0;k<h.length;k++)o[h[k]]=f[k]??'';out[i-1]=o;}return out;}
 const rows=[];let row=[],cell='',q=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(ch==='"'){if(q&&text[i+1]==='"'){cell+='"';i++;}else q=!q;}
  else if(ch===','&&!q){row.push(cell);cell='';}
  else if((ch==='\n'||ch==='\r')&&!q){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
  else cell+=ch;}
 if(cell||row.length){row.push(cell);rows.push(row);}
 if(!rows.length)return [];
 const h=rows.shift().map(x=>x.replace(/^﻿/,'').trim());
 return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));
}
function headerOf(text){return text.slice(0,text.indexOf('\n')).replace(/^﻿/,'').split(',').map(s=>s.trim());}
function classify(name,h){
 if(h.includes('TrialID')&&h.includes('ExpectedDuration')&&h.includes('Task'))return 'trials';
 if(h.includes('TrialID')&&h.includes('SampleIndex')&&h.includes('Task'))return 'samples';
 if(h.includes('ParticipantID')&&h.includes('SessionNumber'))return 'info';
 if(h.includes('TrialID')&&h.includes('HMDFrameIndex'))return 'hmd';
 // Summer build: per-task exports. A current-build session also writes these as copies; those are skipped.
 if(/^[A-Za-z][A-Za-z.]*_S\d+_/.test(name))return null;
 if(h.includes('TrialType')&&h.includes('DistanceToCurve'))return 'calibLegacy';
 if(h.includes('TrialIndex')&&h.includes('TrialInBlock')&&h.includes('TrefoilAngleDeg'))return 'mainLegacy';
 return null;
}
// RotatingTrace_Calib_ZZ_20260815_S1 and RotatingTrace_ZZ_20260815_S1 are the same summer session.
export const keyOf=name=>{const b=name.replace(/\.csv$/i,'');const m=b.match(/^RotatingTrace(?:_Calib)?_+(.+)$/);return m?'summer_'+m[1]:b.replace(/_(Trials|Samples|HMD|SessionInfo)_.*$/i,'');};

// Summer build geometry, from README_Summer_RotatingTrace (Aug 24 version): cube and trefoils centred at (0, 1, 0.65),
// cube edge 0.3 × 0.8 = 0.24 m, 2D trefoil scale 0.08. Each cube trial is checked against the logged DistanceToCurve.
const SUMMER_GEOM={calibCenter:[0,1,.65],calibScale:null,calibFactor:null,cubeWorldEdge:.24,ellipseCenter:null,mainCenter:[0,1,.65],mainScale:.08,mainFactor:null,source:'summer README'};
function legacyBundle(b){
 const trials=[],samples=[];
 if(b.calibLegacy){
  const by=new Map();for(const r of b.calibLegacy){if(r.TrialType!=='cube_static'&&r.TrialType!=='cube_rotating')continue;const k=r.TrialType+'|'+r.TrialIndex;if(!by.has(k))by.set(k,[]);by.get(k).push(r);}
  for(const [k,rows] of by){const [ty,ti]=k.split('|'),rot=ty==='cube_rotating',id=`${rot?'CUBE_ROT':'CUBE_STATIC'}_${String(+ti+1).padStart(2,'0')}`,t0=num(rows[0].TimeStamp)??0;
   trials.push({TrialID:id,Task:'Cube',Condition:rot?'Rotating':'Static',TrialIndex:String(+ti+1),RotationSpeed:rot?'30':'0',ActualDuration:rows[0].TrialDuration});
   rows.forEach((r,i)=>samples.push({TrialID:id,Task:'Cube',SampleIndex:r.PointIndex??String(i),TimeSec:String((num(r.TimeStamp)??0)-t0),WorldX:r.WorldX,WorldY:r.WorldY,WorldZ:r.WorldZ,TargetError:r.DistanceToCurve}));}
 }
 if(b.mainLegacy){
  const by=new Map();for(const r of b.mainLegacy){if(!by.has(r.TrialIndex))by.set(r.TrialIndex,[]);by.get(r.TrialIndex).push(r);}
  for(const [ti,rows] of by){const id=`MAIN_${String(+ti+1).padStart(3,'0')}`,t0=num(rows[0].TimeStamp)??0;
   trials.push({TrialID:id,Task:'Trefoil2D',Condition:'Rotating',TrialIndex:String(+ti+1),Block:rows[0].Block,R1:rows[0].R1,R2:rows[0].R2,RotationSpeed:rows[0].RotationSpeed,ActualDuration:rows[0].TrialDuration});
   rows.forEach((r,i)=>samples.push({TrialID:id,Task:'Trefoil2D',SampleIndex:r.PointIndex??String(i),TimeSec:String((num(r.TimeStamp)??0)-t0),WorldX:r.WorldX,WorldY:r.WorldY,WorldZ:r.WorldZ,StimulusAngleDeg:r.TrefoilAngleDeg}));}
 }
 return {...b,trials,samples};
}
function summerSession(b){
 const s=processSession(legacyBundle(b),SUMMER_GEOM),k=b.key.replace(/^summer_/,''),m=k.match(/^(?:([A-Za-z][A-Za-z.]*)_)?(\d{8})_?(.*)$/);
 s.build='summer';s.participant=m?.[1]?m[1].toUpperCase():'No ID';s.session=null;s.label=m?.[3]||'';s.date=m?.[2]||null;
 s.notes.unshift('Summer build: geometry from the summer README; each cube trial is checked against the logged DistanceToCurve.');
 return s;
}

const quant=(a,p)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),i=(b.length-1)*p,f=Math.floor(i);return b[f+1]===undefined?b[f]:b[f]+(i-f)*(b[f+1]-b[f]);};
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const sd=a=>{if(a.length<2)return null;const m=mean(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1));};
function summary(errMM){return {n:errMM.length,mean:mean(errMM),median:quant(errMM,.5),p95:quant(errMM,.95),within2:errMM.length?100*errMM.filter(v=>v<=20).length/errMM.length:null};}
function axes(diffs){return [0,1,2].map(k=>{const v=diffs.map(d=>d[k]);return {bias:mean(v),sd:sd(v)};});}

// Nearest point on the traced cube edges, in the cube's own frame (metres).
function cubeNearest(p,half){
 let best=[Infinity,null,0];const C=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(c=>c.map(v=>v*half));
 CUBE_TRACED_EDGES.forEach(([i,j],e)=>{const a=C[i],b=C[j],d=b.map((v,k)=>v-a[k]),L=Math.hypot(...d),u=d.map(v=>v/L);let t=u.reduce((s,v,k)=>s+v*(p[k]-a[k]),0);t=Math.max(0,Math.min(L,t));const q=a.map((v,k)=>v+u[k]*t),dd=Math.hypot(...q.map((v,k)=>v-p[k]));if(dd<best[0])best=[dd,q,e+1];});
 return best;
}

function ellipseShape(local){
 const P=local.filter(p=>p&&p.every(fin));if(P.length<20)return null;
 const mx=mean(P.map(p=>p[0])),my=mean(P.map(p=>p[1])),mz=mean(P.map(p=>p[2]));
 let sxx=0,syy=0,sxy=0,syz=0,szz=0;for(const p of P){const x=p[0]-mx,y=p[1]-my,z=p[2]-mz;sxx+=x*x;syy+=y*y;sxy+=x*y;syz+=y*z;szz+=z*z;}
 const tr=sxx+syy,det=sxx*syy-sxy*sxy,disc=Math.sqrt(Math.max(0,tr*tr/4-det)),l1=tr/2+disc,l2=tr/2-disc;
 const slope=syz/syy,r2=syy&&szz?(syz*syz)/(syy*szz):null;
 return {aspect:Math.sqrt(Math.max(0,l2)/l1),slopeZY:slope,slantDeg:Math.atan(Math.abs(slope))*180/Math.PI,r2,depthMM:(quant(P.map(p=>p[2]),.95)-quant(P.map(p=>p[2]),.05))*1000};
}

export function processSession(b,override=null){
 const groups=new Map();
 for(const r of b.samples){if(!groups.has(r.TrialID))groups.set(r.TrialID,[]);groups.get(r.TrialID).push(r);}
 const byTime=rows=>rows.map(r=>[num(r.TimeSec)??0,r]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
 const joined=b.trials.map(t=>({meta:t,samples:byTime(groups.get(t.TrialID)||[]),hmd:[]})).filter(t=>t.samples.length);
 const geom=override?{...override}:deriveSessionGeometry(joined),notes=[];
 if(!geom.calibCenter&&joined.some(t=>['Cube','Trefoil3D','Sphere'].includes(t.meta.Task)))notes.push('No sphere trial with a saved centre, so Cube, Trefoil 3D and Sphere can only be shown in world coordinates.');
 if(!Number.isFinite(geom.cubeWorldEdge)&&joined.some(t=>t.meta.Task==='Cube'))notes.push('Cube size could not be derived (needs static Trefoil 3D targets), so the cube outline is not drawn.');
 for(const t of joined)prepareTrial(t,geom);
 const out=[],rows2D=[];
 for(const t of joined){
  const m=t.meta,task=m.Task,S=t.samples,n=S.length,canon=canDerotate(t,geom),frame=canon?'canonical':'world';
  const step=Math.max(1,Math.ceil(n/MAXPTS)),pick=[];for(let i=0;i<n;i+=step)pick.push(i);if(pick.at(-1)!==n-1)pick.push(n-1);
  const P=i=>tracePoint(t,S[i],i,geom,frame),W=i=>[num(S[i].WorldX),num(S[i].WorldY),num(S[i].WorldZ)];
  // TargetError as logged. An empty cell stays null; nothing is substituted.
  const errLogged=S.map(r=>{const v=num(r.TargetError);return fin(v)?v*1000:null;});
  const rec={id:m.TrialID,task,cond:m.Condition||'',index:num(m.TrialIndex),rep:num(m.Repetition),dir:num(m.Direction),dur:num(m.ActualDuration)??num(S.at(-1).TimeSec),n,frame,meta:m};
  rec.errMissing=errLogged.filter(v=>v===null).length;
  // Recorded trace for drawing (downsampled), in the stimulus frame when available, plus world coordinates.
  rec.t=pick.map(i=>Math.round((num(S[i].TimeSec)??0)*100));
  rec.p=pick.map(i=>{const q=P(i);return q?q.map(v=>Math.round(v*10000)/10):null;});
  rec.w=pick.map(i=>W(i).map(v=>Math.round(v*10000)/10));
  rec.e=pick.map(i=>errLogged[i]===null?null:Math.round(errLogged[i]*10)/10);
  if(task==='Cube'&&t.cubeSpinFit)rec.spin={theta0:t.cubeSpinFit.theta0,omega:t.cubeSpinFit.omega,rmsMM:t.cubeSpinFit.rms*1000,confident:t.cubeSpinFit.confident};
  rec.angle=pick.map(i=>task==='Cube'?(t.cubeSpinFit?.angles?.[i]??0):(num(S[i].StimulusAngleDeg)??0));
  const valid=errLogged.filter(v=>v!==null);
  if(valid.length)rec.err=summary(valid);
  if(task==='Trefoil3D'||task==='Sphere'){
   const d=[];for(let i=0;i<n;i++){const a=tracePoint(t,S[i],i,geom,frame),b2=savedTargetPoint(t,S[i],i,geom,frame);if(a&&b2)d.push(a.map((v,k)=>(v-b2[k])*1000));}
   if(d.length)rec.axes=axes(d);
   rec.target=pick.map(i=>{const q=savedTargetPoint(t,S[i],i,geom,frame);return q?q.map(v=>Math.round(v*10000)/10):null;});
  }
  if(task==='Cube'&&canon&&fin(geom.cubeWorldEdge)){
   const half=geom.cubeWorldEdge/2,d=[],diff=[],seg=new Array(n),edgeD=Array.from({length:9},()=>[]);
   for(let i=0;i<n;i++){const q=P(i);if(!q)continue;const [dd,nq,e]=cubeNearest(q,half);seg[i]=e;edgeD[e-1].push(dd*1000);d.push(q.map((v,k)=>(v-nq[k])*1000));if(errLogged[i]!==null)diff.push(Math.abs(dd*1000-errLogged[i]));}
   rec.axes=axes(d);rec.seg=pick.map(i=>seg[i]??0);
   rec.edges=edgeD.map((a,k)=>({e:k+1,pct:100*a.length/n,mean:mean(a),med:quant(a,.5),p95:quant(a,.95),n:a.length}));
   rec.check={medianMM:quant(diff,.5),over1mmPct:diff.length?100*diff.filter(v=>v>1).length/diff.length:null};
  }
  if(task==='Ellipse'){
   const local=S.map(r=>[num(r.LocalX),num(r.LocalY),num(r.LocalZ)]);
   rec.shape=ellipseShape(local);
   rec.expected={aspect:num(m.EllipseAspectRatio),slantDeg:num(m.EllipseImpliedSlantDeg),diameterMM:num(m.EllipseWorldDiameter)*1000,predictedDepthMM:num(m.EllipsePredictedDepth)*1000};
  }
  if(task==='Trefoil2D'){
   const ti=(num(m.TrialIndex)??(+String(m.TrialID).replace(/\D/g,'')))-1;
   S.forEach((r,i)=>rows2D.push({TrialIndex:ti,Block:num(m.Block)??null,PointIndex:num(r.SampleIndex)??i,WorldX:num(r.WorldX),WorldY:num(r.WorldY),WorldZ:num(r.WorldZ),TrefoilAngleDeg:num(r.StimulusAngleDeg),TimeStamp:num(r.TimeSec),R1:num(m.R1)??1,R2:num(m.R2)??1.5}));
  }
  out.push(rec);
 }
 out.sort((a,b2)=>ORDER.indexOf(a.task)-ORDER.indexOf(b2.task)||(a.cond<b2.cond?-1:a.cond>b2.cond?1:0)||(a.index??0)-(b2.index??0));
 const info=b.info?.[0]||{};
 const m=b.key.match(/^(.*?)_S(\d+)$/);
 return {key:b.key,participant:info.ParticipantID||(m?m[1]:b.key),session:num(info.SessionNumber)??(m?+m[2]:null),files:b.names,geometry:geom,notes,trials:out,
  drawings:rows2D.length?{rows:rows2D,cfg:geom.mainCenter&&fin(geom.mainScale)?{cx:geom.mainCenter[0],cy:geom.mainCenter[1],cz:geom.mainCenter[2],scale:geom.mainScale}:null}:null};
}

if(typeof self!=='undefined')self.onmessage=async e=>{
 const {id,files}=e.data;
 try{
  const bundles=new Map(),skipped=[];
  for(const f of files){
   const kind=classify(f.name,headerOf(f.text));if(!kind){skipped.push(f.name+' (not a Trials, Samples or SessionInfo file)');continue;}
   if(kind==='hmd'){skipped.push(f.name+' (HMD poses are not analysed yet)');continue;}
   const k=keyOf(f.name);if(!bundles.has(k))bundles.set(k,{key:k,names:{}});
   const b=bundles.get(k);b[kind]=parseCSV(f.text);b.names[kind]=f.name;
  }
  const all=[...bundles.values()],legacy=all.filter(b=>b.calibLegacy||b.mainLegacy),cur=all.filter(b=>!(b.calibLegacy||b.mainLegacy));
  const complete=cur.filter(b=>b.trials&&b.samples),missing=cur.filter(b=>!(b.trials&&b.samples)&&(b.trials||b.samples)).map(b=>`${b.key}: add the matching ${b.trials?'Samples':'Trials'} file`);
  if(!complete.length&&!legacy.length)throw Error(missing.length?missing.join('. ')+'.':'No Trials or Samples file was recognised. Choose the *_Trials_*.csv and *_Samples_*.csv files from one session.');
  const sessions=[];for(const b of complete){const x=processSession(b);x.build='current';sessions.push(x);}
  for(const b of legacy)sessions.push(summerSession(b));
  self.postMessage({id,sessions,skipped,missing});
 }catch(err){self.postMessage({id,error:err.message});}
};
