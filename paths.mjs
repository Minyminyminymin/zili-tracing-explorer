// Mean path along the ground truth (dashboard.mjs; the cube's mean path).
// Each sample goes to its nearest point on the ground-truth curve; the curve is cut into equal-length bins,
// and each bin keeps the median (one trial) or mean (several trials) position of its samples.
// 2D trefoil and ellipse are matched on X–Y only, because depth is what the participant adds.
// Points and ground truth are in mm, in the stimulus frame.

export const XY_ONLY=new Set(['T2D','Trefoil2D','Ellipse']);
const med=a=>{const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return b.length%2?b[m]:(b[m-1]+b[m])/2;};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

export function binnedPaths(points,gt,task,{bins,minN,stat}){
 const ground=gt.filter(p=>p.kind==='ground');
 const paths=ground.map(p=>{const s=[0];for(let i=1;i<p.points.length;i++)s.push(s[i-1]+dist(p.points[i],p.points[i-1]));return {pts:p.points,s,closed:p.points.length>2&&dist(p.points[0],p.points.at(-1))<1};});
 const total=paths.reduce((x,p)=>x+p.s.at(-1),0);if(!total||!points.length)return [];
 const L=total/bins,step=Math.min(L/4,5),xy=XY_ONLY.has(task),dense=[];
 paths.forEach((p,pi)=>{for(let i=1;i<p.pts.length;i++){const a=p.pts[i-1],b=p.pts[i],len=p.s[i]-p.s[i-1],n=Math.max(1,Math.ceil(len/step));for(let k=0;k<n;k++){const f=k/n;dense.push({q:a.map((v,j)=>v+(b[j]-v)*f),pi,s:p.s[i-1]+len*f});}}});
 const ext=Math.max(...[0,1,2].map(k=>Math.max(...dense.map(d=>d.q[k]))-Math.min(...dense.map(d=>d.q[k])))),thr=task.startsWith('Cube')?ext*.21:ext*.35;
 const acc=paths.map(p=>Array.from({length:Math.max(1,Math.round(p.s.at(-1)/L))},()=>[]));
 for(const p of points){
  if(!p)continue;let bd=Infinity,bi=-1;
  const ds=new Float64Array(dense.length);
  for(let i=0;i<dense.length;i++){const q=dense[i].q,d=xy?Math.hypot(p[0]-q[0],p[1]-q[1]):dist(p,q);ds[i]=d;if(d<bd){bd=d;bi=i;}}
  if(bd>thr)continue;
  // Near a self-crossing (2D trefoil, ellipse in X–Y) a sample could belong to either branch; leave it out, as the pair analysis does.
  if(xy){const b0=dense[bi],far=total*.08;let alt=Infinity;for(let i=0;i<dense.length;i++){const d=dense[i];if(d.pi===b0.pi){const ds_=Math.abs(d.s-b0.s),len=paths[d.pi].s.at(-1);if(Math.min(ds_,paths[d.pi].closed?len-ds_:ds_)<far)continue;}if(ds[i]<alt)alt=ds[i];}if(alt-bd<3)continue;}const d=dense[bi],nb=acc[d.pi].length;acc[d.pi][Math.min(nb-1,Math.floor(d.s/(paths[d.pi].s.at(-1)/nb)))].push(p);
 }
 const out=[];
 acc.forEach((binsP,pi)=>{
  const v=binsP.map(c=>c.length>=minN?[0,1,2].map(k=>stat==='median'?med(c.map(p=>p[k])):c.reduce((x,p)=>x+p[k],0)/c.length):null);
  // Light smoothing: each bin is averaged with its filled neighbours (wrapping on closed curves).
  const n=v.length,closed=paths[pi].closed,sm=v.map((x,i)=>{if(!x)return null;const nb=[x];for(const j of [i-1,i+1]){const k=closed?(j+n)%n:j;if(k>=0&&k<n&&v[k])nb.push(v[k]);}return [0,1,2].map(c=>nb.reduce((s,q)=>s+q[c],0)/nb.length);});
  let segs=[],cur=[];for(const x of sm){if(!x){if(cur.length>1)segs.push(cur);cur=[];continue;}cur.push(x);}if(cur.length>1)segs.push(cur);
  if(closed&&segs.length&&sm[0]&&sm[n-1]){if(segs.length>1&&segs[0][0]===sm[0]&&segs.at(-1).at(-1)===sm[n-1]){const last=segs.pop();segs[0]=[...last,...segs[0]];}else if(segs.length===1&&segs[0].length===n)segs[0]=[...segs[0],segs[0][0]];}
  out.push(...segs);
 });
 return out;
}
