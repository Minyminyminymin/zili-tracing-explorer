export const DEFAULTS={cx:0,cy:1,cz:.5,scale:.08,r1:1,r2:1.5,gate:1,ambiguity:true,branch:true,bins:100,min:3};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const sep=(a,b)=>Math.min(Math.abs(a-b),1000-Math.abs(a-b));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
export function parseCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quoted)throw Error('An opening CSV quote was not closed.');if(cell||row.length){row.push(cell);rows.push(row);}if(rows.length<2)throw Error('The CSV contains no data rows.');
 const header=rows.shift().map(s=>s.replace(/^\uFEFF/,'').trim());const required=['TrialIndex','WorldX','WorldY','WorldZ','TrefoilAngleDeg','TimeStamp'];for(const k of required)if(!header.includes(k))throw Error('Missing required column: '+k);
 if(rows.length>100000)throw Error('A file can contain up to 100,000 samples.');
 const data=rows.map((r,i)=>{const o={};header.forEach((k,j)=>{const x=r[j];o[k]=x===undefined||x.trim()===''?null:Number(x);});for(const k of required)if(o[k]===null||!Number.isFinite(o[k]))throw Error(`Invalid ${k} value in row ${i+2}.`);return o;});
 const ids=new Set(data.map(r=>r.TrialIndex));if(ids.size<2)throw Error('Include at least two different TrialIndex values.');if(ids.size>30)throw Error('Up to 30 trials can be loaded at once.');
 for(const k of ['R1','R2','RotationSpeed','RotationDirection']){const vals=new Set(data.map(r=>r[k]).filter(v=>v!==undefined&&v!==null));if(vals.size>1)throw Error(`Mixed ${k} conditions. Load trials recorded under the same conditions.`);}
 return data;
}
export function buildModel(rows,settings){
 const cfg={...DEFAULTS,...settings};const curve=Array.from({length:1000},(_,i)=>{const f=i*Math.PI/500;return [(cfg.r1*Math.cos(f)+cfg.r2*Math.cos(2*f))*cfg.scale*100,(cfg.r1*Math.sin(f)-cfg.r2*Math.sin(2*f))*cfg.scale*100];});
 const group=new Map();for(const r of rows){if(!group.has(r.TrialIndex))group.set(r.TrialIndex,[]);group.get(r.TrialIndex).push(r);}const trials=[];
 for(const [id,rs] of [...group].sort((a,b)=>a[0]-b[0])){
  rs.sort((a,b)=>a.TimeStamp-b.TimeStamp);const pts=[];let last=null;
  for(let k=0;k<rs.length;k++){
   const r=rs[k],a=r.TrefoilAngleDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=(r.WorldX-cfg.cx)*100,y=(r.WorldY-cfg.cy)*100,z=(r.WorldZ-cfg.cz)*100;
   const xy=[c*x+s*y,-s*x+c*y];let idx=0,min=Infinity;const ds=new Float64Array(1000);
   for(let j=0;j<1000;j++){const dd=dist(xy,curve[j]);ds[j]=dd;if(dd<min){min=dd;idx=j;}}
   let alt=Infinity;for(let j=0;j<1000;j++)if(sep(idx,j)>=84&&ds[j]<alt)alt=ds[j];
   const amb=alt-min<=.2,valid=min<=cfg.gate&&(!cfg.ambiguity||!amb);
   const world=[r.WorldX*100,r.WorldY*100,r.WorldZ*100];const dt=last?r.TimeStamp-last.t:null;
   const speed=dt>0&&dt<=.1?Math.hypot(...world.map((v,j)=>v-last.world[j]))/dt:null;
   const pt={k,sourceIndex:r.PointIndex??k,t:r.TimeStamp,elapsed:r.TimeStamp-rs[0].TimeStamp,theta:r.TrefoilAngleDeg,world,canonical:[...xy,z],idx,xyDistance:min,margin:alt-min,amb,valid,speed};pts.push(pt);last=pt;
  }
  const nearest=curve.map((q,i)=>{let best=-1,dd=Infinity;for(const p of pts){if(cfg.ambiguity&&p.amb)continue;const d=dist(q,p.canonical);if(d<dd){dd=d;best=p.k;}}const p=pts[best];return {k:best,d:dd,valid:!!p&&dd<=cfg.gate&&(!cfg.branch||sep(i,p.idx)<84),branchOK:!!p&&sep(i,p.idx)<84};});
  const bins=Array.from({length:cfg.bins},()=>[]);for(const p of pts)if(p.valid)bins[Math.floor((p.idx+500/cfg.bins)/(1000/cfg.bins))%cfg.bins].push(p.k);
  const profile=bins.map(ks=>({ks,n:ks.length,z:ks.length>=cfg.min?mean(ks.map(k=>pts[k].canonical[2])):null}));
  trials.push({id,block:rs[0].Block??null,points:pts,nearest,profile,kept:pts.filter(p=>p.valid).length,duration:rs.at(-1).TimeStamp-rs[0].TimeStamp});
 }
 return {cfg,curve,trials,samples:rows.length};
}
export function compare(model,ia,ib,mode='nearest'){
 const A=model.trials.find(t=>t.id===ia),B=model.trials.find(t=>t.id===ib);if(!A||!B||ia===ib)throw Error('Select two different trials.');const out=[];
 if(mode==='nearest')for(let i=0;i<1000;i++){const a=A.nearest[i],b=B.nearest[i],ok=a.valid&&b.valid;out.push({phi:i*.36,ref:i,a:ok?A.points[a.k].canonical[2]:null,b:ok?B.points[b.k].canonical[2]:null,delta:ok?Math.abs(A.points[a.k].canonical[2]-B.points[b.k].canonical[2]):null,ak:[a.k],bk:[b.k],valid:ok});}
 else for(let i=0;i<model.cfg.bins;i++){const a=A.profile[i],b=B.profile[i],ok=a.z!==null&&b.z!==null;let delta=null;if(ok){if(mode==='mean')delta=Math.abs(a.z-b.z);else{let sum=0;for(const ai of a.ks)for(const bi of b.ks)sum+=Math.abs(A.points[ai].canonical[2]-B.points[bi].canonical[2]);delta=sum/(a.n*b.n);}}out.push({phi:i*360/model.cfg.bins,ref:Math.round(i*1000/model.cfg.bins),a:a.z,b:b.z,delta,ak:a.ks,bk:b.ks,valid:ok});}
 const valid=out.filter(p=>p.valid);return {ia,ib,mode,points:out,mae:mean(valid.map(p=>p.delta)),coverage:valid.length/out.length*100,count:valid.length,total:out.length};
}
export function allPairs(model,mode){const out=[];for(let i=0;i<model.trials.length;i++)for(let j=i+1;j<model.trials.length;j++)out.push(compare(model,model.trials[i].id,model.trials[j].id,mode));return out;}
