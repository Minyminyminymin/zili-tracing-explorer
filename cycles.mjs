// XY-only sequential curve tracking. Z is reported, never used to select a cycle.
export function extractCycles(t,curve){
 const N=curve.length,pts=t.points,wrap=d=>((d+1500)%1000)-500;
 const M=200,step=N/M,backs=[],costs=[];let previous=new Float64Array(M);
 for(let k=0;k<pts.length;k++){
  const p=pts[k],dt=k?p.t-pts[k-1].t:0,limit=Math.min(99,Math.max(4,Math.ceil(300*dt/1.8))),back=new Int16Array(M),cost=new Float64Array(M);
  for(let j=0;j<M;j++){
   const q=curve[j*step],d=Math.hypot(q[0]-p.canonical[0],q[1]-p.canonical[1]);let best=Infinity,bj=0;
   if(k&&dt<=.1){for(let off=-limit;off<=limit;off++){const h=(j+off+M)%M,v=previous[h]+.002*(off*step)**2;if(v<best){best=v;bj=h;}}}else{best=0;bj=-1;}
   cost[j]=d*d+best;back[j]=bj;
  }
  const min=Math.min(...cost);for(let j=0;j<M;j++)cost[j]-=min;
  backs.push(back);costs.push(cost);previous=cost;
 }
 const track=new Array(pts.length);let j=-1;
 for(let k=pts.length-1;k>=0;k--){if(j<0)j=costs[k].reduce((b,v,i)=>v<costs[k][b]?i:b,0);const idx=j*step,q=curve[idx];track[k]={idx,dist:Math.hypot(q[0]-pts[k].canonical[0],q[1]-pts[k].canonical[1]),reset:k>0&&backs[k][j]<0};j=backs[k][j];}
 let u=track[0].idx;track[0].u=u;for(let k=1;k<track.length;k++){u+=wrap(track[k].idx-track[k-1].idx);track[k].u=u;}
 const crossings=[];
 for(let k=1;k<track.length;k++){if(track[k].reset)continue;const a=track[k-1].u,b=track[k].u;if(Math.floor(a/1000)!==Math.floor(b/1000)){const dir=b>a?1:-1,level=dir>0?Math.ceil(a/1000):Math.floor(a/1000);const f=(level*1000-a)/(b-a),index=f<.5?k-1:k;crossings.push({index,dir,level});}}
 const candidates=[];for(let i=1;i<crossings.length;i++){
  const a=crossings[i-1],b=crossings[i];if(a.dir!==b.dir||Math.abs(b.level-a.level)!==1||b.index<=a.index)continue;
  const start=a.index,end=b.index,sub=track.slice(start,end+1);let forward=0,backward=0,maxGap=0;
  for(let k=start+1;k<=end;k++){const d=(track[k].u-track[k-1].u)*a.dir;if(d>=0)forward+=d;else backward-=d;maxGap=Math.max(maxGap,pts[k].t-pts[k-1].t);}
  const coverage=new Set(sub.map(v=>Math.floor(v.idx/10))).size;
  const d=pts[end].canonical.map((v,j)=>v-pts[start].canonical[j]);const xy=Math.hypot(d[0],d[1]),z=Math.abs(d[2]),xyz=Math.hypot(...d),off=sub.filter(v=>v.dist>2).length/sub.length;
  const reasons=[];if(sub.some(v=>v.reset))reasons.push('tracking break');if(maxGap>.100001)reasons.push('recording gap >100 ms');if(coverage<95)reasons.push('curve coverage <95%');if(backward/(forward||1)>.1)reasons.push('backtracking >10%');if(off>.05)reasons.push('more than 5% of samples >2 cm from curve');if(xy>1)reasons.push('XY endpoint gap >1 cm');
  candidates.push({start,end,startPoint:pts[start].sourceIndex,endPoint:pts[end].sourceIndex,startTimestamp:pts[start].t,endTimestamp:pts[end].t,startElapsed:pts[start].elapsed,endElapsed:pts[end].elapsed,duration:pts[end].t-pts[start].t,samples:end-start+1,direction:a.dir,progressDeg:Math.abs(track[end].u-track[start].u)*.36,coveragePct:coverage,backtrackingPct:100*backward/(forward||1),offCurvePct:100*off,maxGapSeconds:maxGap,xyClosureCm:xy,zClosureCm:z,closure3dCm:xyz,closed3d:xyz<=1,accepted:!reasons.length,reasons});
 }
 return {track,candidates,selected:candidates.findIndex(c=>c.accepted),criteria:'Consecutive φ=0 crossings in the same direction; one full turn; ≥95% curve-bin coverage; ≤10% backtracking; ≥95% samples within 2 cm; no gap >100 ms; endpoint XY gap ≤1 cm. Z is not a selection criterion. 3D closure is reported separately.'};
}
