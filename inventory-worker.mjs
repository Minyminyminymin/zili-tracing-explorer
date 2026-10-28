// Sorts dropped data files into participants and sessions and counts what each file holds.
// Reads headers and counts rows only; no analysis happens here.
const KINDS={
 trials:'Trials (current build)',samples:'Samples (current build)',info:'Session info',hmdTrial:'HMD per trial',hmdLog:'HMD log',
 calibLegacy:'Calibration, per-task export',mainLegacy:'Main trials, per-task export',ellipseSummary:'Ellipse summary',ellipseTraj:'Ellipse trajectories',
 sphereLegacy:'Sphere, per-task export',condition:'Condition note',unknown:'Not recognised'
};
const BIG=12*1024*1024;// larger files are read in part (first and last lines)

function kindOf(name,h){
 const has=(...k)=>k.every(x=>h.includes(x));
 if(/\.txt$/i.test(name))return 'condition';
 if(has('TrialID','Task','ExpectedDuration'))return 'trials';
 if(has('TrialID','Task','SampleIndex'))return 'samples';
 if(has('ParticipantID','SessionNumber'))return 'info';
 if(has('TrialID','HMDFrameIndex'))return 'hmdTrial';
 if(has('TimeSeconds','IsTracked','HMDWorldX'))return 'hmdLog';
 if(has('TrialType','TrialIndex','PointIndex'))return 'calibLegacy';
 if(has('TrialIndex','Block','TrialInBlock'))return 'mainLegacy';
 if(has('TrialIndex','ConfigId'))return 'ellipseSummary';
 if(has('TrialIndex','PointIndex','WorldX')&&(/Ellipse/i.test(name)||h.includes('DiskAngleDeg')))return 'ellipseTraj';
 if(has('TrialIndex','Task','Repetition','SphereCenterX'))return 'sphereLegacy';
 return 'unknown';
}
// File names: ZZ_S01_Samples_20261021_102311.csv (current), RotatingTrace_Calib_ZZ_20260815_S1.csv (summer),
// RotatingTrace_20260601_164111.csv (summer, no ID), HMD_Verification_20261021_094527.csv (HMD log).
function nameInfo(name){
 const base=name.replace(/^.*\//,'').replace(/\.(csv|txt)$/i,'');
 let m=base.match(/^([A-Za-z][A-Za-z.]*)_S(\d+)_([A-Za-z_]+?)_(\d{8})_(\d{6})(?:_.*)?$/);
 if(m)return {build:'current',pid:m[1].toUpperCase(),session:+m[2],date:m[4],time:m[5],label:`S${+m[2]}`};
 m=base.match(/^HMD_Verification_(\d{8})_(\d{6})$/);
 if(m)return {build:null,pid:null,session:null,date:m[1],time:m[2]};
 m=base.match(/^(?:RotatingTrace_Calib|RotatingTrace|EllipseCircle_Traj|EllipseCircle)_+(?:([A-Za-z][A-Za-z.]*)_)?(\d{8})_?(.*?)(?:_Condition)?$/);
 if(m){const rest=m[3]||'',t=rest.match(/^(\d{6})$/),s=rest.match(/^S(\d+)$/i);
  return {build:'summer',pid:m[1]?m[1].toUpperCase():null,session:s?+s[1]:null,date:m[2],time:t?t[1]:null,label:t?'':rest||''};}
 const d=base.match(/(20\d{6})/);return {build:null,pid:null,session:null,date:d?d[1]:null,time:null};
}
const splitLines=t=>t.split(/\r?\n/).filter(l=>l.trim());
async function readHead(file,n=4096){return (await file.slice(0,n).text());}
async function readTail(file,n=4096){return (await file.slice(Math.max(0,file.size-n)).text());}
function condFromTrialId(id){if(/^CUBE_ROT/.test(id))return 'Rotating';if(/^CUBE_STATIC/.test(id))return 'Static';if(/^T3D_ROT/.test(id))return 'Rotating';if(/^T3D_STATIC/.test(id))return 'Static';return '';}

async function scan(file){
 const head=await readHead(file),first=head.split(/\r?\n/)[0].replace(/^﻿/,''),h=first.split(',').map(s=>s.trim());
 const info={name:file.name,path:file.webkitRelativePath||file.name,size:file.size,kind:kindOf(file.name,h),...nameInfo(file.name)};
 info.kindLabel=KINDS[info.kind];
 const col=k=>h.indexOf(k);
 if(info.kind==='hmdLog'){
  const a=splitLines(head)[1]?.split(','),z=splitLines(await readTail(file)).at(-1)?.split(',');
  const t0=+a?.[0],t1=+z?.[0];info.summary={durationMin:Number.isFinite(t1-t0)?(t1-t0)/60:null};
  return info;
 }
 if(info.kind==='unknown'||info.kind==='condition'){if(info.kind==='condition')info.summary={text:head.slice(0,300)};return info;}
 if(file.size>BIG){info.summary={partial:true};return info;}
 const lines=splitLines(await file.text()),rows=lines.slice(1).map(l=>l.split(','));
 info.rows=rows.length;
 if(info.kind==='trials'){
  const T=col('Task'),C=col('Condition'),A=col('ActualDuration'),SV=col('StimulusViewingMode'),CV=col('CursorViewingMode'),tasks={};
  for(const r of rows){const t=r[T],c=r[C]||'';tasks[t]??={trials:0,conds:{},durations:[]};tasks[t].trials++;tasks[t].conds[c]=(tasks[t].conds[c]||0)+1;if(A>=0&&r[A]!=='')tasks[t].durations.push(+r[A]);}
  const B=col('Build');
  info.summary={tasks,builds:B>=0?[...new Set(rows.map(r=>r[B]).filter(Boolean))]:[],viewing:[...new Set(rows.map(r=>`${r[SV]||'?'} stimulus, ${r[CV]||'?'} cursor`))]};
 }else if(info.kind==='samples'){
  const ID=col('TrialID'),T=col('Task'),E=col('TargetError'),LX=col('LocalX'),tasks={};
  for(const r of rows){const t=r[T];tasks[t]??={ids:new Set(),rows:0,errEmpty:{},errRows:{},local:0};const k=tasks[t];k.ids.add(r[ID]);k.rows++;
   const c=condFromTrialId(r[ID]);k.errRows[c]=(k.errRows[c]||0)+1;if(E>=0&&r[E]==='')k.errEmpty[c]=(k.errEmpty[c]||0)+1;if(LX>=0&&r[LX]!=='')k.local++;}
  for(const t in tasks)tasks[t].trials=tasks[t].ids.size,delete tasks[t].ids;
  info.summary={tasks};
 }else if(info.kind==='info'){const r=rows[0]||[];info.summary={pid:r[col('ParticipantID')],session:+r[col('SessionNumber')],eye:r[col('DominantEye')],hand:r[col('DominantHand')]};}
 else if(info.kind==='calibLegacy'){
  const TT=col('TrialType'),TI=col('TrialIndex'),DC=col('DistanceToCurve'),types={};
  for(const r of rows){const t=r[TT];types[t]??={ids:new Set(),rows:0,distEmpty:0};types[t].ids.add(r[TI]);types[t].rows++;if(DC>=0&&r[DC]==='')types[t].distEmpty++;}
  for(const t in types)types[t].trials=types[t].ids.size,delete types[t].ids;
  info.summary={types};
 }else{
  const TI=col('TrialIndex'),ids=new Set(rows.map(r=>r[TI]));info.summary={trials:ids.size};
  if(info.kind==='sphereLegacy'){const T=col('Task');info.summary.tasks=[...new Set(rows.map(r=>r[T]))];}
 }
 return info;
}

self.onmessage=async e=>{
 const {id,files}=e.data,out=[];
 try{for(const f of files){try{out.push(await scan(f));}catch(err){out.push({name:f.name,size:f.size,kind:'unknown',kindLabel:'Could not be read: '+err.message});}}
  self.postMessage({id,files:out});}
 catch(err){self.postMessage({id,error:err.message});}
};
