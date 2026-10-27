// Calibration pages: cube tracing accuracy against the summer-build ground truth.
// All numbers are precomputed offline (data/calibration_summary.json, data/calibration_trajectories.json).
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=(x,n=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toFixed(n);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const COND={static:'Static cube',rotating:'Rotating cube'},KEY={static:'cube_static',rotating:'cube_rotating'};
const ENAME=['Front bottom','Front right','Front top','Front left','Connecting, bottom left','Back bottom','Back right','Back top','Back left'];
const H=120,V=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(v=>v.map(c=>c*H));
const TRACED=[[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,6],[6,7],[7,4]],DIM=[[1,5],[2,6],[3,7]];
const OUTCOME={err:['Mean distance','%'],on2cm:['Time within 2 cm','%p'],sdz:['Depth (z) variability','%'],edge:['Distance by edge','%']};
const TERM={rot:'Rotating instead of static',sess:'Twice as many sessions (static)',rotsess:'Extra change per doubling when rotating',trialpos:'Next trial in the same session',depthedge:'Depth edge 5, against front edges',backedge:'Back edges 6–9, against front edges'};
const GOOD_LOW={err:true,on2cm:false,sdz:true,edge:true};
export const LABELS={OUTCOME,TERM};

let S=null,D=null,dLoad=null;
export const state={cond:'static',outcome:'err'};
export async function loadSummary(){if(!S){const r=await fetch('./data/calibration_summary.json');if(!r.ok)throw Error('Could not load the calibration summary.');S=await r.json();}return S;}
function loadTraj(){if(!dLoad)dLoad=fetch('./data/calibration_trajectories.json').then(r=>{if(!r.ok)throw Error('Could not load calibration trajectories.');return r.json();}).then(j=>D=j);return dLoad;}
const person=id=>S.participants.find(p=>p.id===id);
const md=d=>{const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return `${+d.slice(6)} ${m[+d.slice(4,6)-1]}`;};

/* ---------- small UI helpers ---------- */
function seg(id,opts,value,cb){const el=$(id);el.replaceChildren();for(const [v,l] of opts){const b=document.createElement('button');b.type='button';b.textContent=l;b.setAttribute('aria-pressed',String(String(v)===String(value)));b.onclick=()=>cb(v);el.append(b);}}
const tip=$('calTip');
function showTip(e,html){tip.innerHTML=html;tip.hidden=false;const w=tip.offsetWidth,h=tip.offsetHeight;let x=e.clientX+14,y=e.clientY+14;if(x+w>innerWidth-8)x=e.clientX-14-w;if(y+h>innerHeight-8)y=e.clientY-14-h;tip.style.left=x+'px';tip.style.top=y+'px';}
function hideTip(){tip.hidden=true;}
function lerpHex(a,b,t){const pa=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16)),pb=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16));return '#'+pa.map((x,i)=>Math.round(x+(pb[i]-x)*t).toString(16).padStart(2,'0')).join('');}
// Sequential single-hue ramp for session means (light = close to the cube).
const RAMP=['#e9f1f4','#b9d3de','#7fadc3','#4a83a3','#245c80','#123b57'];
function ramp(v,lo=8,hi=26){const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo)))*(RAMP.length-1),i=Math.min(RAMP.length-2,Math.floor(t));return lerpHex(RAMP[i],RAMP[i+1],t-i);}
function inkOn(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4),L=.2126*c[0]+.7152*c[1]+.0722*c[2];return L>.28?'#1c2226':'#ffffff';}

/* ---------- summary page ---------- */
export async function renderSummary(){
 await loadSummary();const o=S.overall,c=state.cond,th=S.thresholds[c];
 const rot=S.model.find(m=>m.outcome==='err'&&m.term==='rot'),ses=S.model.find(m=>m.outcome==='err'&&m.term==='sess');
 $('calAnswer').textContent=`Mean distance from the cube edges is ${fmt(o.static.mean_mm)} mm for the static cube and ${fmt(o.rotating.mean_mm)} mm for the rotating cube. Rotation adds about ${fmt(rot.est,0)}%, and error drops by about ${fmt(-ses.est,0)}% each time the number of sessions doubles. ${o.participants} participants, ${o.sessions} sessions, ${o.trials} trials.`;
 seg('calCond',[['static','Static cube'],['rotating','Rotating cube']],c,v=>{state.cond=v;renderSummary();});
 $('calCondNote').textContent=`${COND[c]}: ${fmt(o[c].on2cm,0)}% of samples within 2 cm. Values are means of participant means.`;
 learnChart();peopleTable();
 seg('modelOutcome',Object.entries(OUTCOME).map(([k,v])=>[k,v[0]]),state.outcome,v=>{state.outcome=v;renderSummary();});
 forest();edgeChart();cubeKey();
}

function learnChart(){
 const c=state.cond,box=$('learnChart'),W=Math.max(320,box.clientWidth),Hh=300,m={l:46,r:16,t:16,b:48};
 const ppl=S.participants.map(p=>({id:p.id,s:p.cond[c].sessions})),L=S.learning[c],maxS=Math.max(...L.map(d=>d.s));
 const ymax=Math.max(30,Math.ceil(Math.max(...ppl.flatMap(p=>p.s.map(d=>d.mean)))/5)*5);
 const x=s=>m.l+(s-1)/(maxS-1)*(W-m.l-m.r),y=v=>Hh-m.b-v/ymax*(Hh-m.t-m.b),th=S.thresholds[c].error;
 let g=`<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Mean distance by session, ${COND[c]}">`;
 for(let v=0;v<=ymax;v+=10)g+=`<line class="grid" x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`;
 for(let s=1;s<=maxS;s++){if(maxS>12&&s%2===0&&s!==maxS)continue;g+=`<text class="tick" x="${x(s)}" y="${Hh-m.b+16}" text-anchor="middle">${s}</text>`;}
 g+=`<text class="axis" x="${m.l}" y="${Hh-6}">Session</text><text class="axis" x="4" y="${m.t-2}" >mm</text>`;
 L.forEach(d=>{g+=`<text class="nlab" x="${x(d.s)}" y="${Hh-m.b+30}" text-anchor="middle">${d.n}</text>`;});
 g+=`<text class="nlab" x="${W-m.r}" y="${Hh-6}" text-anchor="end">bottom row: participants contributing</text>`;
 g+=`<line class="bench" x1="${m.l}" x2="${W-m.r}" y1="${y(th)}" y2="${y(th)}"/><text class="benchLab" x="${W-m.r}" y="${y(th)-6}" text-anchor="end">ZZ benchmark ${fmt(th)} mm</text>`;
 for(const p of ppl)g+=`<polyline class="pline" data-id="${p.id}" points="${p.s.map(d=>x(d.s)+','+y(d.mean)).join(' ')}"/>`;
 g+=`<polyline class="mline" points="${L.map(d=>x(d.s)+','+y(d.mean)).join(' ')}"/>`;
 for(const d of L)g+=`<circle class="mdot" cx="${x(d.s)}" cy="${y(d.mean)}" r="3.5"/>`;
 g+=`<line class="cross" id="lcCross" x1="0" x2="0" y1="${m.t}" y2="${Hh-m.b}" visibility="hidden"/><rect class="hit" x="${m.l}" y="${m.t}" width="${W-m.l-m.r}" height="${Hh-m.t-m.b}"/></svg>`;
 box.innerHTML=g+`<ul class="legend static"><li><i class="lmean"></i>Mean of participants</li><li><i class="lperson"></i>One participant</li><li><i class="lbench"></i>Stability benchmark</li></ul>`;
 const svg=box.querySelector('svg'),cross=svg.querySelector('#lcCross');
 svg.querySelector('.hit').onpointermove=e=>{
  const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*W/r.width,s=Math.max(1,Math.min(maxS,Math.round(1+(px-m.l)/(W-m.l-m.r)*(maxS-1))));
  cross.setAttribute('x1',x(s));cross.setAttribute('x2',x(s));cross.setAttribute('visibility','visible');
  const rows=ppl.map(p=>[p.id,p.s.find(d=>d.s===s)]).filter(r=>r[1]).sort((a,b)=>a[1].mean-b[1].mean);
  svg.querySelectorAll('.pline').forEach(l=>l.classList.remove('on'));
  const mean=L.find(d=>d.s===s);
  showTip(e,`<strong>Session ${s}</strong><span class="lab">Mean</span><span class="val">${fmt(mean?.mean)} mm</span>`+rows.map(([id,d])=>`<span class="lab">${id}</span><span class="val">${fmt(d.mean)} mm</span>`).join(''));
 };
 svg.querySelector('.hit').onpointerleave=()=>{cross.setAttribute('visibility','hidden');hideTip();};
}

function peopleTable(){
 const c=state.cond,th=S.thresholds[c],maxS=Math.max(...S.participants.map(p=>p.sessions));
 $('peopleDesc').textContent=`Each cell is one session's mean distance for the ${COND[c].toLowerCase()}; the number is mm. "Stable from" is the first session that starts ${S.window} trials in a row at or below ${fmt(th.error)} mm with a spread (SD) of at most ${fmt(th.sd,1)} mm, both taken from ZZ's sessions 11–22. Select a name for every trial, or a cell for that session.`;
 const order=[...S.participants].sort((a,b)=>(a.cond[c].onset??99)-(b.cond[c].onset??99)||a.id.localeCompare(b.id));
 let h=`<thead><tr><th scope="col">Participant</th><th scope="col" class="num">Sessions</th><th scope="col" class="cells">Session mean, mm</th><th scope="col">Stable from</th><th scope="col" class="num">Trials at or below benchmark after that</th></tr></thead><tbody>`;
 for(const p of order){
  const k=p.cond[c];let cells='';
  for(let s=1;s<=maxS;s++){const d=k.sessions.find(q=>q.s===s);if(!d){cells+=`<span class="cell none"></span>`;continue;}
   const bg=ramp(d.mean),on=k.onset===s?' onset':'';cells+=`<a class="cell${on}" href="#/calibration/${p.id}/${s}/${c}" style="background:${bg};color:${inkOn(bg)}" title="${p.id}, session ${s} (${md(d.date)}): ${fmt(d.mean)} mm, ${d.n} trial${d.n>1?'s':''}${k.onset===s?'. Stable from here':''}">${Math.round(d.mean)}</a>`;}
  h+=`<tr><th scope="row"><a href="#/calibration/${p.id}?c=${c}">${p.id}</a></th><td class="num">${p.sessions}</td><td class="cells"><div class="strip" style="--n:${maxS}">${cells}</div></td><td>${k.onset?`Session ${k.onset}`:'<span class="dim">Not reached</span>'}</td><td class="num">${k.after!=null?k.after+'%':'—'}</td></tr>`;
 }
 $('peopleTable').innerHTML=h+'</tbody>';
 $('peopleKey').innerHTML=`<span>8 mm</span><i style="background:linear-gradient(90deg,${RAMP.join(',')})"></i><span>26 mm or more</span><span class="dim">Outlined cell: first session of the stable run. Blank: no session.</span>`;
}

function forest(){
 const k=state.outcome,[name,unit]=OUTCOME[k],rows=S.model.filter(m=>m.outcome===k),box=$('forestChart');
 const W=Math.max(320,box.clientWidth),lab=Math.min(300,W*.42),rh=44,Hh=rows.length*rh+40,m={l:lab,r:90};
 const ext=Math.max(...rows.map(r=>Math.max(Math.abs(r.lo),Math.abs(r.hi))))*1.15,x=v=>m.l+(v+ext)/(2*ext)*(W-m.l-m.r);
 let g=`<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Model effects on ${name}">`;
 const step=ext>20?10:ext>8?5:ext>3?2:1;
 for(let v=-Math.floor(ext/step)*step;v<=ext;v+=step)g+=`<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="8" y2="${Hh-28}"/><text class="tick" x="${x(v)}" y="${Hh-10}" text-anchor="middle">${v>0?'+':''}${v}</text>`;
 g+=`<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="8" y2="${Hh-28}"/>`;
 rows.forEach((r,i)=>{
  const cy=20+i*rh,sig=!(r.lo<=0&&0<=r.hi),better=(r.est<0)===GOOD_LOW[k],cls=sig?(better?'better':'worse'):'ns';
  const word=sig?(better?'better':'worse'):'no clear change';
  g+=`<text class="rlab" x="0" y="${cy+4}">${esc(TERM[r.term])}</text>`;
  g+=`<line class="ci ${cls}" x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${cy}" y2="${cy}"/><circle class="est ${cls}" cx="${x(r.est)}" cy="${cy}" r="5.5"/>`;
  g+=`<text class="rval ${cls}" x="${W-m.r+10}" y="${cy+4}">${r.est>0?'+':''}${fmt(r.est)}${unit}</text><text class="rword" x="${W-m.r+10}" y="${cy+18}">${word}</text>`;
 });
 box.innerHTML=g+`</svg><p class="note">${name}: change in ${unit==='%'?'percent':'percentage points'}. "Better" means ${GOOD_LOW[k]?'smaller':'larger'}. Exact values are in Methods → Models.</p>`;
}

function edgeChart(){
 const c=state.cond,E=S.edges[c],box=$('edgeChart'),W=Math.max(300,box.clientWidth),rh=28,Hh=E.length*rh+30,lab=Math.min(190,W*.42),mx=Math.ceil(Math.max(...E.map(e=>e.mean))/5)*5;
 const x=v=>lab+v/mx*(W-lab-60);
 let g=`<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Mean distance by edge, ${COND[c]}">`;
 E.forEach((e,i)=>{const y=6+i*rh;g+=`<text class="rlab" x="0" y="${y+14}">${e.e} ${ENAME[e.e-1]}</text><rect class="bar${e.e===5?' depth':''}" x="${lab}" y="${y+3}" width="${Math.max(2,x(e.mean)-lab)}" height="16" rx="3"/><text class="rval" x="${x(e.mean)+6}" y="${y+15}">${fmt(e.mean)}</text>`;});
 g+=`<text class="tick" x="${lab}" y="${Hh-6}">0</text><text class="tick" x="${x(mx)}" y="${Hh-6}" text-anchor="end">${mx} mm</text></svg>`;
 box.innerHTML=g;
}

/* ---------- cube drawing (shared by the key, session cards and the session view) ---------- */
const VIEWS={front:{lab:'Front',a:0,b:1,axes:'X → right, Y ↑'},top:{lab:'Top',a:0,b:2,axes:'X → right, Z (depth) ↑ farther'},side:{lab:'Side',a:2,b:1,axes:'Z (depth) → farther, Y ↑'},'3d':{lab:'3D',axes:'Drag to orbit'}};
function projector(view,cam){
 if(view!=='3d'){const v=VIEWS[view];return p=>[p[v.a],p[v.b]];}
 const {yaw,pitch}=cam;return p=>{const x=Math.cos(yaw)*p[0]+Math.sin(yaw)*p[2],z=-Math.sin(yaw)*p[0]+Math.cos(yaw)*p[2];return [x,Math.cos(pitch)*p[1]-Math.sin(pitch)*z];};
}
function setupCanvas(cv,h){const dpr=devicePixelRatio||1,W=cv.clientWidth,Hc=h??W;cv.width=Math.round(W*dpr);cv.height=Math.round(Hc*dpr);const g=cv.getContext('2d');g.scale(dpr,dpr);g.clearRect(0,0,W,Hc);return [g,W,Hc];}
function screenMap(W,Hc,R,pr,zoom=1){const sc=Math.min(W,Hc)/(2*R)*zoom;return p=>{const q=pr(p);return [W/2+q[0]*sc,Hc/2-q[1]*sc];};}
function drawCube(g,to,{labels=false,fs=11,hi=null}={}){
 g.lineCap='round';g.setLineDash([3,3]);g.strokeStyle=css('--gt-dim');g.lineWidth=1;
 for(const [a,b] of DIM){g.beginPath();g.moveTo(...to(V[a]));g.lineTo(...to(V[b]));g.stroke();}
 g.setLineDash([]);
 TRACED.forEach(([a,b],i)=>{g.strokeStyle=hi===i+1?css('--now'):css('--gt');g.lineWidth=hi===i+1?3:1.6;g.beginPath();g.moveTo(...to(V[a]));g.lineTo(...to(V[b]));g.stroke();});
 if(!labels)return;
 const ctr=to([0,0,0]),seen=new Map();
 TRACED.forEach(([a,b],i)=>{const q=to(V[a].map((c,j)=>(c+V[b][j])/2)),k=Math.round(q[0]/4)+','+Math.round(q[1]/4);if(!seen.has(k))seen.set(k,{q,n:[]});seen.get(k).n.push(i+1);});
 g.font=`500 ${fs}px "IBM Plex Sans",system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';
 for(const {q,n} of seen.values()){let dx=q[0]-ctr[0],dy=q[1]-ctr[1];const r=Math.hypot(dx,dy)||1;dx/=r;dy/=r;const x=q[0]+dx*fs*1.3,y=q[1]+dy*fs*1.3,t=n.join(' · '),w=g.measureText(t).width+fs*.9;
  g.fillStyle=css('--surface');g.strokeStyle=n.includes(hi)?css('--now'):css('--gt');g.lineWidth=1;g.beginPath();g.roundRect(x-w/2,y-fs*.8,w,fs*1.6,fs*.8);g.fill();g.stroke();g.fillStyle=n.includes(hi)?css('--now'):css('--ink');g.fillText(t,x,y+.5);}
}
function cubeKey(){const cv=$('cubeKey');if(!cv.clientWidth)return;const [g,W]=setupCanvas(cv);drawCube(g,screenMap(W,W,215,projector('3d',{yaw:.5,pitch:-.4})),{labels:true,fs:11});}
const TCOL=i=>css(`--t${i}`);
const pt=(t,k)=>[t.x[k],t.y[k],t.z[k]];
function path(g,to,t,{upto=null,alpha=.85,width=1.3,color=null,dist=false}={}){
 const n=upto??t.x.length;
 if(dist){g.globalAlpha=alpha;for(let k=0;k<n;k++){const q=to(pt(t,k));g.fillStyle=distColor(t.d[k]);g.fillRect(q[0]-1.2,q[1]-1.2,2.4,2.4);}g.globalAlpha=1;return;}
 g.strokeStyle=color||TCOL(t.i);g.globalAlpha=alpha;g.lineWidth=width;g.beginPath();for(let k=0;k<n;k++){const q=to(pt(t,k));k?g.lineTo(...q):g.moveTo(...q);}g.stroke();g.globalAlpha=1;
}
function distColor(d){return lerpHex(css('--d0'),css('--d1'),Math.min(d,40)/40);}
function endMarks(g,to,t,color,r=4){const L=t.x.length-1,a=to(pt(t,0)),b=to(pt(t,L));g.fillStyle=color;g.strokeStyle=css('--surface');g.lineWidth=1.5;g.beginPath();g.arc(a[0],a[1],r,0,Math.PI*2);g.fill();g.stroke();g.beginPath();g.rect(b[0]-r*.85,b[1]-r*.85,r*1.7,r*1.7);g.fill();g.stroke();}

/* ---------- participant page ---------- */
export async function renderParticipant(pid,cond){
 await loadSummary();const p=person(pid);if(!p){$('pHead').textContent=`No participant ${pid}`;$('pAnswer').textContent='Choose a participant from the menu.';return;}
 if(cond)state.cond=cond;const c=state.cond,k=p.cond[c],th=S.thresholds[c];
 $('pHead').textContent=pid;
 const st=['static','rotating'].map(cc=>`${COND[cc].toLowerCase()} ${p.cond[cc].onset?`stable from session ${p.cond[cc].onset}`:'not stable yet'}`).join(', ');
 $('pAnswer').textContent=`${p.sessions} sessions from ${md(p.first)} to ${md(p.last)}, ${p.trials} trials kept. ${st[0].toUpperCase()+st.slice(1)}.`;
 seg('pCond',[['static','Static cube'],['rotating','Rotating cube']],c,v=>{location.hash=`#/calibration/${pid}?c=${v}`;});
 $('pChartDesc').textContent=`One point per trial, mean distance in mm. Filled points are at or below the ${fmt(th.error)} mm benchmark. ${k.onset?`The dashed line marks session ${k.onset}, where ${S.window} trials in a row first stayed at or below the benchmark with an SD of at most ${fmt(th.sd,1)} mm; ${k.after}% of trials from there on are at or below it.`:`No run of ${S.window} trials met the benchmark.`}`;
 trialChart(p,c);
 const grid=$('pSessions');
 if(!D){grid.innerHTML='<p class="desc">Loading trajectories…</p>';await loadTraj();}
 sessionCards(pid,c);
}
function trialChart(p,c){
 const k=p.cond[c],th=S.thresholds[c],box=$('pChart'),W=Math.max(320,box.clientWidth),Hh=300,m={l:46,r:16,t:22,b:36},maxS=Math.max(4,p.sessions),CAP=c==='static'?30:40;
 const byS={};k.trials.forEach(t=>{(byS[t.s]??=[]).push(t);});
 const pts=k.trials.map(t=>{const arr=byS[t.s],j=arr.indexOf(t);return {...t,xv:t.s-1+(j+.5)/arr.length};});
 const x=v=>m.l+v/maxS*(W-m.l-m.r),y=v=>Hh-m.b-Math.min(v,CAP)/CAP*(Hh-m.t-m.b);
 let g=`<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" role="img" aria-label="Trial distances for ${p.id}, ${COND[c]}">`;
 g+=`<rect class="band" x="${m.l}" y="${y(th.error)}" width="${W-m.l-m.r}" height="${y(0)-y(th.error)}"/>`;
 for(let v=0;v<=CAP;v+=10)g+=`<line class="grid" x1="${m.l}" x2="${W-m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`;
 const every=maxS>12?2:1;for(let s=1;s<=p.sessions;s+=every)g+=`<text class="tick" x="${x(s-.5)}" y="${Hh-m.b+16}" text-anchor="middle">${s}</text>`;
 g+=`<text class="axis" x="${m.l}" y="${Hh-4}">Session</text><text class="axis" x="4" y="12">mm</text>`;
 g+=`<line class="bench" x1="${m.l}" x2="${W-m.r}" y1="${y(th.error)}" y2="${y(th.error)}"/>`;
 if(k.onset){const first=pts.findIndex(t=>t.s>=k.onset),i0=findOnset(k.trials,th),xo=x(pts[i0]?.xv??(k.onset-1))-4;g+=`<line class="onset" x1="${xo}" x2="${xo}" y1="${m.t-10}" y2="${Hh-m.b}"/><text class="onLab" x="${xo+6}" y="${m.t-2}">Stable from session ${k.onset}, then ${k.after}% at or below</text>`;void first;}
 g+=`<polyline class="tline" points="${pts.map(t=>x(t.xv)+','+y(t.mean)).join(' ')}"/>`;
 for(const t of pts){const ok=t.mean<=th.error;g+=`<a href="#/calibration/${p.id}/${t.s}/${c}/${t.i}"><circle class="tdot ${ok?'ok':'over'}" cx="${x(t.xv)}" cy="${y(t.mean)}" r="4.5" data-s="${t.s}" data-i="${t.i}" data-v="${t.mean}" data-on="${t.on2cm}"/></a>`;if(t.mean>CAP)g+=`<text class="clip" x="${x(t.xv)}" y="${m.t-4}" text-anchor="middle">${Math.round(t.mean)}↑</text>`;}
 box.innerHTML=g+`</svg><ul class="legend static"><li><i class="ldot"></i>At or below benchmark</li><li><i class="lring"></i>Above benchmark</li><li><i class="lband"></i>Benchmark ${fmt(th.error)} mm</li>${k.onset?'<li><i class="lonset"></i>Start of stable run</li>':''}<li class="dim">Values above ${CAP} mm are drawn at the top with the value.</li></ul>`;
 box.querySelectorAll('.tdot').forEach(d=>{d.onpointerenter=e=>showTip(e,`<strong>Session ${d.dataset.s}, trial ${d.dataset.i}</strong><span class="lab">Mean distance</span><span class="val">${fmt(+d.dataset.v)} mm</span><span class="lab">Within 2 cm</span><span class="val">${fmt(+d.dataset.on,0)}%</span>`);d.onpointerleave=hideTip;});
}
function findOnset(tr,th){const W=S.window;for(let i=0;i+W<=tr.length;i++){const w=tr.slice(i,i+W).map(t=>t.mean),mu=w.reduce((a,b)=>a+b,0)/W,sd=Math.sqrt(w.reduce((a,b)=>a+(b-mu)**2,0)/(W-1));if(Math.max(...w)<=th.error&&sd<=th.sd)return i;}return -1;}
function sessionCards(pid,c){
 const grid=$('pSessions'),list=D[pid][KEY[c]];grid.replaceChildren();
 for(const s of list){
  const a=document.createElement('a');a.className='sCard';a.href=`#/calibration/${pid}/${s.s}/${c}`;
  const miss=3-s.trials.length;
  a.innerHTML=`<span class="sTop"><strong>Session ${s.s}</strong><span>${md(s.date)}</span></span><canvas aria-hidden="true"></canvas><span class="sBot"><span>${fmt(s.mean)} mm</span><span class="dim">${s.trials.length} trial${s.trials.length>1?'s':''}${miss?`, ${miss} excluded`:''}</span></span>`;
  grid.append(a);const cv=a.querySelector('canvas'),[g,W]=setupCanvas(cv),to=screenMap(W,W,190,projector('front'));
  drawCube(g,to);for(const t of s.trials)path(g,to,t,{alpha:.75,width:1});drawCube(g,to);
 }
}

/* ---------- session page ---------- */
const ss={pid:null,s:null,cond:'static',trial:1,view:'front',color:'trial',mean:true,speed:1,cam:{yaw:.5,pitch:-.35},zoom:1,t:0,playing:false,last:null};
export async function renderSession(pid,s,cond,trial){
 await loadSummary();ss.pid=pid;ss.s=+s;ss.cond=cond||state.cond;state.cond=ss.cond;
 $('sHead').textContent=`${pid}, session ${ss.s}`;$('sAnswer').textContent='Loading trajectories…';
 await loadTraj();
 const list=D[pid]?.[KEY[ss.cond]],sess=list?.find(x=>x.s===ss.s);
 if(!sess){$('sAnswer').textContent=`${pid} has no ${COND[ss.cond].toLowerCase()} session ${ss.s}.`;return;}
 const avail=sess.trials.map(t=>t.i);ss.trial=avail.includes(+trial)?+trial:avail[0];stop();ss.t=0;
 const ex=S.excluded.filter(e=>e.pid===pid&&e.s===ss.s&&e.cond===ss.cond);
 $('sHead').textContent=`${pid}, session ${ss.s}, ${COND[ss.cond].toLowerCase()}`;
 $('sAnswer').textContent=`${md(sess.date)}. Mean distance ${fmt(sess.mean)} mm over ${sess.trials.length} trial${sess.trials.length>1?'s':''}`+(ex.length?`; trial ${ex.map(e=>e.i).join(', ')} excluded because the recomputed distance disagreed with the logged value.`:'.');
 $('sExcl').textContent=ex.length?`Trial ${ex.map(e=>e.i).join(', ')} is excluded from every calculation on this site.`:'';
 seg('sCond',[['static','Static'],['rotating','Rotating']],ss.cond,v=>{location.hash=`#/calibration/${pid}/${ss.s}/${v}`;});
 viewSeg();colorSeg();
 speedSeg();
 const idx=list.indexOf(sess);
 $('sPrev').disabled=idx<=0;$('sNext').disabled=idx>=list.length-1;
 $('sPrev').onclick=()=>{if(idx>0)location.hash=`#/calibration/${pid}/${list[idx-1].s}/${ss.cond}`;};
 $('sNext').onclick=()=>{if(idx<list.length-1)location.hash=`#/calibration/${pid}/${list[idx+1].s}/${ss.cond}`;};
 $('sMean').checked=ss.mean;
 const summ=person(pid).cond[ss.cond].trials.filter(t=>t.s===ss.s);
 const tp=$('sTrials');tp.replaceChildren();
 for(let i=1;i<=3;i++){const t=sess.trials.find(q=>q.i===i),b=document.createElement('button');b.type='button';b.dataset.i=i;
  if(!t){b.disabled=true;b.innerHTML=`<span class="tk" style="--c:var(--t${i})"></span><span><strong>Trial ${i}</strong><small>Excluded</small></span>`;}
  else{const m=summ.find(q=>q.i===i);b.innerHTML=`<span class="tk" style="--c:var(--t${i})"></span><span><strong>Trial ${i}</strong><small>${fmt(t.mean)} mm, ${fmt(m?.on2cm,0)}% within 2 cm</small></span>`;b.setAttribute('aria-pressed',String(i===ss.trial));b.onclick=()=>{history.replaceState(null,'',`#/calibration/${pid}/${ss.s}/${ss.cond}/${i}`);ss.trial=i;stop();ss.t=0;trialUI(sess);drawSession();};}
  tp.append(b);}
 trialUI(sess);drawSession();
}
const SPEEDS=[[.5,'0.5×'],[1,'1×'],[2,'2×'],[4,'4×']];
function viewSeg(){seg('sView',Object.entries(VIEWS).map(([k,v])=>[k,v.lab]),ss.view,v=>{ss.view=v;viewSeg();drawSession();});}
function colorSeg(){seg('sColor',[['trial','By trial'],['dist','By distance']],ss.color,v=>{ss.color=v;colorSeg();drawSession();});}
function speedSeg(){seg('sSpeed',SPEEDS,ss.speed,v=>{ss.speed=+v;speedSeg();});}
function curSess(){return D[ss.pid][KEY[ss.cond]].find(x=>x.s===ss.s);}
function curTrial(){return curSess().trials.find(t=>t.i===ss.trial);}
function trialUI(sess){
 $('sTrials').querySelectorAll('button:not(:disabled)').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.i===ss.trial)));
 const t=curTrial();
 $('sEdges').innerHTML=t.edges.map(e=>`<tr data-e="${e.e}"><th scope="row"><span class="eid">${e.e}</span>${ENAME[e.e-1]}</th><td>${fmt(e.pct)}%</td>`+(e.n?`<td>${fmt(e.mean)}</td><td>${fmt(e.med)}</td><td>${fmt(e.p95)}</td>`:`<td colspan="3" class="dim">No samples</td>`)+`</tr>`).join('');
 $('sEdgeNote').textContent=`${t.edges.reduce((a,e)=>a+e.n,0).toLocaleString('en-US')} samples, trial mean ${fmt(t.mean)} mm, ${fmt(t.dur)} s.`;
 $('sScrub').max=Math.round(t.dur*100);$('sScrub').value=Math.round(ss.t*100);
}
function idxAt(t,sec){const T=t.t,x=sec*100;let lo=0,hi=T.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(T[m]<=x)lo=m;else hi=m-1;}return lo;}
function nearestEdgePoint(p){let best=[1e9,null,0];TRACED.forEach(([a,b],i)=>{const A=V[a],B=V[b],u=B.map((c,j)=>(c-A[j])/240);let s=u.reduce((acc,c,j)=>acc+c*(p[j]-A[j]),0);s=Math.max(0,Math.min(240,s));const q=A.map((c,j)=>c+u[j]*s),d=Math.hypot(...q.map((c,j)=>c-p[j]));if(d<best[0])best=[d,q,i+1];});return best;}
function meanPath(trials){
 const BIN=10,NB=240/BIN,acc=TRACED.map(()=>Array.from({length:NB},()=>[0,0,0,0])),out=[];
 for(const t of trials)for(let k=0;k<t.x.length;k++){if(t.d[k]>50)continue;const e=t.s[k]-1,[a,b]=TRACED[e],A=V[a],B=V[b],p=pt(t,k);let s=0;for(let j=0;j<3;j++)s+=(B[j]-A[j])/240*(p[j]-A[j]);const c=acc[e][Math.min(NB-1,Math.max(0,Math.floor(s/BIN)))];c[0]+=p[0];c[1]+=p[1];c[2]+=p[2];c[3]++;}
 acc.forEach(bins=>{const seg=[];for(const c of bins){if(c[3]<3){if(seg.length)out.push(seg.splice(0));continue;}seg.push([c[0]/c[3],c[1]/c[3],c[2]/c[3]]);}if(seg.length)out.push(seg);});
 return out;
}
function drawSession(){
 const cv=$('sCanvas');if(!cv.clientWidth||!D||!ss.pid)return;
 const sess=curSess(),cur=curTrial();if(!cur)return;
 const [g,W,Hc]=setupCanvas(cv,Math.min(cv.clientWidth,640)),pr=projector(ss.view,ss.cam),to=screenMap(W,Hc,ss.view==='3d'?230:190,pr,ss.view==='3d'?ss.zoom:1);
 const k=idxAt(cur,ss.t),p=pt(cur,k),[,q,e]=nearestEdgePoint(p),dist=ss.color==='dist';
 drawCube(g,to);
 for(const t of sess.trials)if(t!==cur)path(g,to,t,{alpha:.22,width:1,dist});
 if($('sMean').checked){g.strokeStyle=css('--avg');g.globalAlpha=.8;g.lineWidth=2.2;g.lineJoin='round';for(const s of meanPath(sess.trials)){g.beginPath();s.forEach((v,i)=>i?g.lineTo(...to(v)):g.moveTo(...to(v)));g.stroke();}g.globalAlpha=1;}
 const whole=!ss.playing&&ss.t===0;
 if(whole)path(g,to,cur,{alpha:.9,width:1.4,dist});else{path(g,to,cur,{alpha:.2,width:1,dist});path(g,to,cur,{upto:k+1,alpha:.95,width:1.6,dist});}
 drawCube(g,to,{labels:true,fs:12,hi:cur.s[k]});
 for(const t of sess.trials)endMarks(g,to,t,dist?css('--ink'):TCOL(t.i),t===cur?5:3.5);
 const a=to(p),b=to(q);g.strokeStyle=css('--now');g.lineWidth=1.5;g.setLineDash([4,3]);g.beginPath();g.moveTo(...a);g.lineTo(...b);g.stroke();g.setLineDash([]);
 g.fillStyle=css('--now');g.strokeStyle=css('--surface');g.lineWidth=2;g.beginPath();g.arc(a[0],a[1],6,0,Math.PI*2);g.fill();g.stroke();
 $('sLegend').innerHTML=(dist?`<li><i class="lramp"></i>Distance 0 → 40 mm or more</li>`:sess.trials.map(t=>`<li><i style="background:var(--t${t.i})"></i>Trial ${t.i}</li>`).join(''))+($('sMean').checked?`<li><i class="lavg"></i>Mean path</li>`:'')+`<li><i class="lhand"></i>Hand now</li><li>● start ■ end</li>`;
 $('sFrame').textContent=`${VIEWS[ss.view].lab} view: ${VIEWS[ss.view].axes}${ss.cond==='rotating'?'. Rotating trials are shown in the cube’s own frame.':''}`;
 $('sReadout').innerHTML=`<span><strong>${fmt(ss.t)}</strong> of ${fmt(cur.dur)} s</span><span>Nearest edge <strong>${cur.s[k]}</strong> ${ENAME[cur.s[k]-1].toLowerCase()}</span><span>Distance <strong>${cur.d[k]}</strong> mm</span><span>Position x ${p[0]}, y ${p[1]}, z ${p[2]} mm</span>`;
 document.querySelectorAll('#sEdges tr').forEach(r=>r.classList.toggle('now',+r.dataset.e===cur.s[k]));
 $('sScrub').value=Math.round(ss.t*100);void e;
}
function frame(ts){if(!ss.playing)return;const cur=curTrial();if(ss.last!=null)ss.t+=(ts-ss.last)/1000*ss.speed;ss.last=ts;if(ss.t>=cur.dur){ss.t=cur.dur;drawSession();stop();return;}drawSession();requestAnimationFrame(frame);}
function play(){const cur=curTrial();if(!cur)return;if(ss.t>=cur.dur)ss.t=0;ss.playing=true;ss.last=null;$('sPlay').textContent='Pause';requestAnimationFrame(frame);}
function stop(){ss.playing=false;$('sPlay').textContent='Play';}
export function leave(){stop();hideTip();}
$('sPlay').onclick=()=>ss.playing?stop():play();
$('sScrub').oninput=e=>{stop();ss.t=e.target.value/100;drawSession();};
$('sMean').onchange=()=>{ss.mean=$('sMean').checked;drawSession();};
{const cv=$('sCanvas');let drag=null;
 cv.onpointerdown=e=>{if(ss.view!=='3d')return;drag={x:e.clientX,y:e.clientY};cv.setPointerCapture(e.pointerId);};
 cv.onpointermove=e=>{if(!drag)return;ss.cam.yaw+=(e.clientX-drag.x)*.008;ss.cam.pitch=Math.max(-1.4,Math.min(1.4,ss.cam.pitch+(e.clientY-drag.y)*.008));drag={x:e.clientX,y:e.clientY};drawSession();};
 cv.onpointerup=cv.onpointercancel=()=>{drag=null;};
 cv.addEventListener('wheel',e=>{if(ss.view!=='3d')return;e.preventDefault();ss.zoom=Math.max(.5,Math.min(3,ss.zoom*Math.exp(-e.deltaY*.0015)));drawSession();},{passive:false});
 cv.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stop();ss.t=Math.max(0,Math.min(curTrial().dur,ss.t+(e.key==='ArrowRight'?.5:-.5)));drawSession();}if(e.key===' '){e.preventDefault();ss.playing?stop():play();}};
}
export function redraw(page){if(!S)return;if(page==='cal-summary')renderSummary();else if(page==='cal-session')drawSession();}
export function summaryData(){return S;}
