// Geometry and de-rotation helpers for the unified session inspector.
// Principles:
// 1) prefer values saved in the current unified CSVs;
// 2) use current Unity scene constants only where the CSV omits geometry;
// 3) never estimate a stimulus centre from the participant trace itself.

const PI2=Math.PI*2;
const n=v=>v===undefined||v===null||String(v).trim()===''?null:Number(v);
const finite=v=>Number.isFinite(v);
const xyz=(r,p='World')=>[n(r[p+'X']),n(r[p+'Y']),n(r[p+'Z'])];
const valid=p=>p&&p.every(finite);
const med=a=>{const b=a.filter(finite).sort((x,y)=>x-y);if(!b.length)return null;const m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2};
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);

export function rz(p,deg){
  const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]];
}
export function ry(p,deg){
  const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return [c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]];
}

export async function loadTrefoil3DReference(url='./reference/coords_R2_1.5.csv'){
  const res=await fetch(url);if(!res.ok)throw Error('Could not load 3D trefoil reference.');
  const lines=(await res.text()).trim().split(/\r?\n/).slice(1);
  return lines.map(line=>{const f=line.split(',').map(Number);return {phi:f[0],x:f[1],y:f[2],z:f[3]};});
}

function recoverEllipseCenter(joined){
  const c=[[],[],[]];
  for(const t of joined.filter(x=>x.meta.Task==='Ellipse')){
    for(const r of t.samples){
      const w=xyz(r),l=[n(r.LocalX),n(r.LocalY),n(r.LocalZ)],a=n(r.StimulusAngleDeg);
      if(!valid(w)||!valid(l)||!finite(a))continue;
      const spun=rz(l,a),q=sub(w,spun);for(let i=0;i<3;i++)c[i].push(q[i]);
    }
  }
  const out=c.map(med);return valid(out)?out:null;
}
function calibrationCenter(joined){
  const s=joined.find(x=>x.meta.Task==='Sphere');
  if(!s)return null;
  const p=[n(s.meta.SphereCenterX),n(s.meta.SphereCenterY),n(s.meta.SphereCenterZ)];
  return valid(p)?p:null;
}
function calibrationScale(joined,center){
  if(!center)return null;
  const ratios=[];
  for(const t of joined.filter(x=>x.meta.Task==='Trefoil3D'&&String(x.meta.Condition).toLowerCase()==='static')){
    const r1=n(t.meta.R1)??1,r2=n(t.meta.R2)??1.5;
    for(const r of t.samples){
      const phi=n(r.TargetPhi),ty=n(r.TargetY);if(!finite(phi)||!finite(ty))continue;
      const y=r1*Math.sin(phi)-r2*Math.sin(2*phi);if(Math.abs(y)<.2)continue;
      ratios.push((ty-center[1])/y);
    }
  }
  const s=med(ratios);return finite(s)&&s>0?s:null;
}
function formalScaleFactor(joined){
  const ds=joined.filter(x=>x.meta.Task==='Ellipse').map(x=>n(x.meta.EllipseWorldDiameter)).filter(finite);
  const d=med(ds);return finite(d)&&d>0?d/.4:null; // scene EllipseDisk world diameter at scale=1
}

export function deriveSessionGeometry(joined){
  const calibCenter=calibrationCenter(joined);
  const calibScale=calibrationScale(joined,calibCenter);
  const calibFactor=finite(calibScale)?calibScale/.072:null; // current scene CalibrationModel localScale
  const ellipseCenter=recoverEllipseCenter(joined);
  const mainFactor=formalScaleFactor(joined);
  return {
    calibCenter,
    calibScale,
    calibFactor,
    cubeWorldEdge:finite(calibFactor)?.3*.8*calibFactor:null, // edgeLength * scene scale * phase scale
    ellipseCenter,
    mainCenter:ellipseCenter,
    mainScale:finite(mainFactor)?.08*mainFactor:null,
    mainFactor
  };
}

// ----- rotating cube angle recovery (ported from Ziyan inspector) -----
const CUBE_CORNERS=[
  [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],
  [-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]
];
export const CUBE_TRACED_EDGES=[[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,6],[6,7],[7,4]];
export const CUBE_OTHER_EDGES=[[1,5],[2,6],[3,7]];

function segments(half){
  return CUBE_TRACED_EDGES.map(([i,j])=>{
    const a=mul(CUBE_CORNERS[i],half),b=mul(CUBE_CORNERS[j],half),d=sub(b,a),len=Math.hypot(...d);
    return {a,u:mul(d,1/len),len};
  });
}
function distSegments(p,segs){
  let best=Infinity;
  for(const s of segs){
    const q=sub(p,s.a);let t=q[0]*s.u[0]+q[1]*s.u[1]+q[2]*s.u[2];t=Math.max(0,Math.min(s.len,t));
    const e=sub(q,mul(s.u,t));best=Math.min(best,Math.hypot(...e));
  }
  return best;
}
function residual(pts,dists,dts,segs,center,theta0,omega){
  let ss=0;
  for(let i=0;i<pts.length;i++){
    const q=rz(sub(pts[i],center),-(theta0+omega*dts[i]));
    const e=distSegments(q,segs)-dists[i];ss+=e*e;
  }
  return Math.sqrt(ss/pts.length);
}
function range(lo,hi,inc){const a=[];for(let v=lo;v<=hi+1e-9;v+=inc)a.push(v);return a}

export function fitCubeSpin(trial,geom){
  if(trial.meta.Task!=='Cube'||String(trial.meta.Condition).toLowerCase()!=='rotating')return null;
  if(!geom.calibCenter||!finite(geom.cubeWorldEdge))return null;
  const pts=[],dists=[],times=[];
  for(const r of trial.samples){
    const p=xyz(r),d=n(r.TargetError),t=n(r.TimeSec);if(valid(p)&&finite(d)&&finite(t)){pts.push(p);dists.push(d);times.push(t)}
  }
  if(pts.length<30)return null;
  const t0=times[0],dts=times.map(t=>t-t0),segs=segments(geom.cubeWorldEdge/2);
  const step=Math.max(1,Math.floor(pts.length/250)),cp=[],cd=[],ct=[];
  for(let i=0;i<pts.length;i+=step){cp.push(pts[i]);cd.push(dists[i]);ct.push(dts[i])}
  const speed=Math.abs(n(trial.meta.RotationSpeed)??30),coarse=[];
  for(const omega of [speed,-speed])for(let th=0;th<360;th++)coarse.push({theta0:th,omega,rms:residual(cp,cd,ct,segs,geom.calibCenter,th,omega)});
  coarse.sort((a,b)=>a.rms-b.rms);const top=coarse[0];
  const alias=coarse.find(c=>{if(c.omega!==top.omega)return true;const d=Math.abs(c.theta0-top.theta0)%360;return Math.min(d,360-d)>=45});
  let {theta0,omega}=top,rms=residual(pts,dists,dts,segs,geom.calibCenter,top.theta0,top.omega);
  const sweep=(vals,key)=>{for(const v of vals){const th=key==='theta0'?v:theta0,om=key==='omega'?v:omega,r=residual(pts,dists,dts,segs,geom.calibCenter,th,om);if(r<rms){rms=r;theta0=th;omega=om}}};
  sweep(range(theta0-1,theta0+1,.05),'theta0');sweep(range(omega-.5,omega+.5,.02),'omega');sweep(range(theta0-.2,theta0+.2,.01),'theta0');
  const angles=trial.samples.map(r=>theta0+omega*((n(r.TimeSec)??t0)-t0));
  const aliasRms=alias?.rms??Infinity;
  return {angles,theta0:((theta0%360)+360)%360,omega,rms,aliasRms,confident:aliasRms>Math.max(rms*5,.002),n:pts.length};
}

export function prepareTrial(trial,geom){
  if(trial.meta.Task==='Cube'&&String(trial.meta.Condition).toLowerCase()==='rotating'&&!trial.cubeSpinFit)trial.cubeSpinFit=fitCubeSpin(trial,geom);
}

function rowAngle(trial,row,index){
  if(trial.meta.Task==='Cube')return String(trial.meta.Condition).toLowerCase()==='rotating'?(trial.cubeSpinFit?.angles?.[index]??0):0;
  return n(row.StimulusAngleDeg)??0;
}
export function currentAngle(trial,rows){
  if(!rows.length)return 0;
  const r=rows[rows.length-1],i=trial.samples.indexOf(r);
  return rowAngle(trial,r,i);
}

export function canDerotate(trial,geom){
  const task=trial?.meta.Task;if(!task)return false;
  if(task==='Ellipse')return trial.samples.some(r=>valid([n(r.LocalX),n(r.LocalY),n(r.LocalZ)]));
  if(task==='Sphere')return !!geom.calibCenter;
  if(task==='Trefoil3D')return !!geom.calibCenter;
  if(task==='Trefoil2D')return !!geom.mainCenter&&finite(geom.mainScale);
  if(task==='Cube'){
    if(!geom.calibCenter||!finite(geom.cubeWorldEdge))return false;
    return String(trial.meta.Condition).toLowerCase()!=='rotating'||!!trial.cubeSpinFit?.confident;
  }
  return false;
}

export function tracePoint(trial,row,index,geom,frame){
  const w=xyz(row);if(!valid(w))return null;if(frame==='world')return w;
  const task=trial.meta.Task;
  if(task==='Ellipse'){
    const l=[n(row.LocalX),n(row.LocalY),n(row.LocalZ)];return valid(l)?l:null;
  }
  if(task==='Sphere')return ry(sub(w,geom.calibCenter),-rowAngle(trial,row,index));
  if(task==='Trefoil3D')return rz(sub(w,geom.calibCenter),-rowAngle(trial,row,index));
  if(task==='Trefoil2D')return rz(sub(w,geom.mainCenter),-rowAngle(trial,row,index));
  if(task==='Cube')return rz(sub(w,geom.calibCenter),-rowAngle(trial,row,index));
  return null;
}

export function savedTargetPoint(trial,row,index,geom,frame){
  const w=xyz(row,'Target');if(!valid(w))return null;if(frame==='world')return w;
  if(trial.meta.Task==='Sphere')return ry(sub(w,geom.calibCenter),-rowAngle(trial,row,index));
  if(trial.meta.Task==='Trefoil3D')return rz(sub(w,geom.calibCenter),-rowAngle(trial,row,index));
  return null;
}

function transformPath(path,center,angle,axis,frame){
  if(frame!=='world')return path;
  return path.map(p=>add(axis==='y'?ry(p,angle):rz(p,angle),center));
}
function circleBasis(normal){
  let nrm=normal;const L=Math.hypot(...nrm);if(!L)nrm=[0,0,1];else nrm=mul(nrm,1/L);
  let u=Math.abs(nrm[1])<.9?[0,1,0]:[1,0,0];
  const dot=u[0]*nrm[0]+u[1]*nrm[1]+u[2]*nrm[2];u=sub(u,mul(nrm,dot));const ul=Math.hypot(...u);u=mul(u,1/ul);
  const v=[nrm[1]*u[2]-nrm[2]*u[1],nrm[2]*u[0]-nrm[0]*u[2],nrm[0]*u[1]-nrm[1]*u[0]];
  return [u,v];
}
function circleInPlane(radius,normal,segments=160){
  const [u,v]=circleBasis(normal),pts=[];
  for(let i=0;i<=segments;i++){const a=i/segments*PI2;pts.push(add(mul(u,radius*Math.cos(a)),mul(v,radius*Math.sin(a))))}
  return pts;
}
function sphereWire(radius,segments=120){
  const paths=[];for(let m=0;m<5;m++){const yaw=m*36,base=[];for(let i=0;i<=segments;i++){const a=i/segments*PI2;base.push(ry([radius*Math.cos(a),radius*Math.sin(a),0],yaw))}paths.push(base)}
  return paths;
}
function trefoil2D(scale,r1=1,r2=1.5,segments=360){
  const p=[];for(let i=0;i<=segments;i++){const f=i/segments*PI2;p.push([(r1*Math.cos(f)+r2*Math.cos(2*f))*scale,(r1*Math.sin(f)-r2*Math.sin(2*f))*scale,0])}return p;
}
function trefoil3D(ref,scale,amp=1){
  return (ref||[]).map(q=>[q.z*amp*scale,q.y*scale,-q.x*scale]);
}
function cubePaths(edge){
  const h=edge/2,c=CUBE_CORNERS.map(p=>mul(p,h)),all=[...CUBE_TRACED_EDGES,...CUBE_OTHER_EDGES];
  return all.map((e,i)=>({points:[c[e[0]],c[e[1]]],secondary:i>=CUBE_TRACED_EDGES.length}));
}
function ellipseRefs(meta){
  const D=n(meta.EllipseWorldDiameter),a=n(meta.EllipseAspectRatio);if(!finite(D)||!finite(a))return [];
  const R=D/2,d=Math.sqrt(Math.max(0,1-a*a)),flat=[],pos=[],neg=[];
  for(let i=0;i<=180;i++){const t=i/180*PI2,c=Math.cos(t),s=Math.sin(t);flat.push([R*c,R*a*s,0]);pos.push([R*c,R*a*s,R*d*s]);neg.push([R*c,R*a*s,-R*d*s])}
  return [{label:'Displayed ellipse',kind:'ground',points:flat},{label:'Predicted tilted circle',kind:'indicator',points:pos},{label:'Mirror tilted circle',kind:'secondary',points:neg}];
}

export function groundTruth(trial,geom,frame,angleDeg,ref3D){
  const m=trial.meta,task=m.Task,out=[];
  if(task==='Cube'&&geom.calibCenter&&finite(geom.cubeWorldEdge)){
    for(const p of cubePaths(geom.cubeWorldEdge))out.push({label:p.secondary?'Dim cube edges':'Cube wireframe',kind:p.secondary?'secondary':'ground',points:transformPath(p.points,geom.calibCenter,angleDeg,'z',frame)});
  }else if(task==='Trefoil3D'&&geom.calibCenter&&finite(geom.calibScale)&&ref3D?.length){
    const base=trefoil3D(ref3D,geom.calibScale,n(m.Amplitude)??1);
    out.push({label:'3D trefoil ground truth',kind:'ground',points:transformPath(base,geom.calibCenter,angleDeg,'z',frame)});
  }else if(task==='Trefoil2D'&&geom.mainCenter&&finite(geom.mainScale)){
    const base=trefoil2D(geom.mainScale,n(m.R1)??1,n(m.R2)??1.5);
    out.push({label:'2D trefoil ground truth',kind:'ground',points:transformPath(base,geom.mainCenter,angleDeg,'z',frame)});
  }else if(task==='Ellipse'&&geom.ellipseCenter){
    for(const r of ellipseRefs(m))out.push({...r,points:transformPath(r.points,geom.ellipseCenter,angleDeg,'z',frame)});
  }else if(task==='Sphere'&&geom.calibCenter){
    const radius=n(m.SphereRadius)??.1;
    const wires=sphereWire(radius).map(p=>frame==='world'?transformPath(p,geom.calibCenter,angleDeg,'y','world'):p);
    for(const p of wires)out.push({label:'Sphere wireframe',kind:'ground',points:p});
    let indicator;
    if(String(m.Condition).toLowerCase()==='equator')indicator=circleInPlane(radius,[0,1,0]);
    else{
      const normal=[n(m.ViewX)??0,n(m.ViewY)??0,n(m.ViewZ)??1],world=circleInPlane(radius,normal);
      indicator=frame==='world'?world.map(p=>add(p,geom.calibCenter)):world.map(p=>ry(p,-angleDeg));
    }
    if(String(m.Condition).toLowerCase()==='equator'&&frame==='world')indicator=indicator.map(p=>add(p,geom.calibCenter));
    out.push({label:String(m.Condition).toLowerCase()==='equator'?'Equator target':'Outline target',kind:'indicator',points:indicator});
  }
  return out;
}
