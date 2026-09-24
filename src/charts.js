import M from './planning.mjs';

export const COLORS = ['#345fce','#8970bb','#278d83','#b27a33','#b65778','#5b8eaa'];
const DEG=Math.PI/180, LINE='#e6ebf3', MUTED='#7b879d', INK='#233047';
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=x=>Number(x).toFixed(2);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
let clipCount=0;
const widthOf=svg=>Math.max(240,Math.round(svg.getBoundingClientRect().width || 800));
const label=(x,y,text,attrs='')=>`<text x="${number(x)}" y="${number(y)}" ${attrs}>${escape(text)}</text>`;
const title=text=>`<title>${escape(text)}</title>`;
const line=(x1,y1,x2,y2,attrs='')=>`<path d="M${number(x1)} ${number(y1)}L${number(x2)} ${number(y2)}" fill="none" stroke="${LINE}" ${attrs}/>`;

function finish(svg,width,height,html,description) {
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',description);
  svg.innerHTML=title(description)+html;
}

function curve(values,x,y,start=0,end=840,stride=4) {
  const points=[];
  for(let t=start;t<end;t+=stride) points.push(`${points.length?'L':'M'}${number(x(t))} ${number(y(M.sample(values,t)))}`);
  points.push(`${points.length?'L':'M'}${number(x(end))} ${number(y(M.sample(values,end)))}`);
  return points.join(' ');
}

export function renderTrajectory(svg,n,sources,visibleIds,focusId,cursor,config,blocks=[],selectedTask=null) {
  const w=widthOf(svg),small=w<550,L=small?45:65,R=small?15:20,pw=w-L-R;
  const ids=visibleIds.filter(id=>n.sources[id]),focus=ids.includes(focusId)?focusId:ids[0];
  const byId=new Map(sources.map(s=>[s.id,s]));
  const color=id=>visibleIds.includes(id)?COLORS[visibleIds.indexOf(id)%COLORS.length]:'#8793a7';
  const x=t=>L+clamp(t,0,840)/840*pw,y=z=>40+z/100*172;
  const windowY=371,rowH=22,height=windowY+ids.length*rowH+20;
  svg.dataset.plotLeft=String(L); svg.dataset.plotRight=String(R);
  if(!focus) { finish(svg,w,180,label(w/2,90,'选择一个源查看当晚轨迹','text-anchor="middle"'),'尚未选择天体'); return; }
  const c={...M.defaults,...config},[a,b]=M.nightBounds(n,c),clip=`trajectory-${++clipCount}`;
  let html=`<defs><clipPath id="${clip}"><rect x="${L}" y="40" width="${pw}" height="172"/></clipPath></defs>`;
  html+=label(L,16,small?'天顶角 z / °':'天顶角 z / ° · 数值越小，越靠近天顶',`style="font-size:${small?11:12}px"`);
  html+=`<rect x="${L}" y="40" width="${pw}" height="172" rx="3" fill="${c.mode==='LHAASO'?'#f4f7fc':'#fff8ed'}"/>`;
  if(b>a) html+=`<rect x="${number(x(a))}" y="40" width="${number(x(b)-x(a))}" height="172" fill="#f1f5fc"/>`;
  for(const z of [0,30,50,70,90]) html+=line(L,y(z),w-R,y(z))+label(L-9,y(z)+4,`${z}°`,'text-anchor="end" style="font-size:11px"');
  const ticks=small?[0,240,480,720,840]:[0,120,240,360,480,600,720,840];
  for(const t of ticks) {
    html+=line(x(t),40,x(t),212,'opacity=".75"');
    // Keep the final 08:00 label without crowding the 06:00 tick on a phone.
    if(small&&t===720) continue;
    html+=label(x(t),234,M.compact(t),`text-anchor="${t===0?'start':t===840?'end':'middle'}" style="font-size:11px"`);
  }
  const markers=[['日落',n.events?.sunset,'#b27a33'],['日出',n.events?.sunrise,'#b27a33']];
  if(b>a)markers.push(['暗夜可用开始',a,COLORS[0]],['暗夜可用结束',b,COLORS[0]]);
  for(const [name,t,col] of markers)if(Number.isFinite(t)&&t>=0&&t<=840){
    html+=`<path d="M${number(x(t))} 40V212" stroke="${col}" stroke-width="1.2" stroke-dasharray="3 4" opacity=".8">${title(name+' '+M.clock(t,c))}</path>`;
  }
  for(const task of blocks) {
    if(!Number.isFinite(task.start)||!Number.isFinite(task.duration)) continue;
    const selected=String(task.id)===String(selectedTask);
    html+=`<g>${title(`任务 #${task.id} · ${byId.get(task.source)?.name || task.source} · ${M.compact(task.start)}–${M.compact(task.start+task.duration)}`)}<path d="M${number(x(task.start))} 34H${number(x(task.start+task.duration))}" stroke="${color(task.source)}" stroke-width="${selected?5:3}" stroke-linecap="round"/>`;
    if((x(task.start+task.duration)-x(task.start))>(small?15:20)) html+=label(x(task.start+task.duration/2),28,`#${task.id}`,`text-anchor="middle" style="fill:${color(task.source)};font-size:10px"`);
    html+='</g>';
  }
  const masks=new Map(ids.map(id=>[id,M.mask(n,id,c)]));
  html+=`<g clip-path="url(#${clip})">`;
  for(const id of [...ids.filter(id=>id!==focus),focus]) {
    const values=n.sources[id].z,col=color(id),name=byId.get(id)?.name || id;
    html+=`<path d="${curve(values,x,y)}" fill="none" stroke="${col}" stroke-width="1.4" stroke-dasharray="4 4" opacity=".43">${title(`${name}：完整几何轨迹，虚线时段未通过当前观测条件`)}</path>`;
    for(const [start,end] of M.windows(masks.get(id))) html+=`<path d="${curve(values,x,y,start,end,2)}" fill="none" stroke="${col}" stroke-width="${id===focus?3:2}" stroke-linecap="round" stroke-linejoin="round" opacity="${id===focus?1:.8}">${title(`${name}：${M.compact(start)}–${M.compact(end)} 满足当前条件`)}</path>`;
    const cy=y(M.sample(values,clamp(cursor,0,840)));
    html+=`<circle cx="${number(x(cursor))}" cy="${number(cy)}" r="${id===focus?4:3}" stroke="#fff" stroke-width="1.5" fill="${col}">${title(`${name} · z=${M.sample(values,cursor).toFixed(1)}°`)}</circle>`;
  }
  html+='</g>';
  const thresholdY=y(c.zmax);
  html+=`<path d="M${L} ${number(thresholdY)}H${w-R}" fill="none" stroke="#bc7180" stroke-width="1" stroke-dasharray="6 5"/>`;
  html+=`<rect x="${w-R-76}" y="${number(thresholdY-20)}" width="74" height="17" rx="3" fill="#f8fafde8"/>`;
  html+=label(w-R-4,thresholdY-8,`上限 ${c.zmax}°`,'text-anchor="end" style="fill:#a76170;font-size:10px"');

  const my=value=>278+(180-clamp(value,0,180))/180*54;
  const moonNote=c.mode==='LHAASO'?'仅供参考':c.moonMode==='warn'?'仅提示':c.moonMode==='up'?'月亮升起时限制':'全程限制';
  html+=label(L,262,`月亮角距 / ° · 当前源 · ${moonNote}`,'style="font-size:11px"');
  html+=`<rect x="${L}" y="278" width="${pw}" height="54" rx="3" fill="#f7f9fc"/>`;
  html+=label(L-8,285,'180°','text-anchor="end" style="font-size:10px"')+label(L-8,332,'0°','text-anchor="end" style="font-size:10px"');
  html+=`<path d="${curve(n.sources[focus].sep,x,my)}" fill="none" stroke="#b27a33" stroke-width="1.8">${title(`${byId.get(focus)?.name || focus} 与月亮的角距离`)}</path>`;
  if(c.mode!=='LHAASO') {
    html+=`<path d="M${L} ${number(my(c.moon))}H${w-R}" fill="none" stroke="#b27a33" stroke-width="1" stroke-dasharray="4 4" opacity=".65"/>`;
    html+=label(w-R,350,`${c.moonMode==='warn'?'提示角距':'月距下限'} ${c.moon}°`,'text-anchor="end" style="font-size:10px;fill:#a3763c"');
  }
  html+=label(L,358,'可用窗口 · 与上方源图例对应','style="font-size:11px"');
  ids.forEach((id,i)=>{
    const yy=windowY+i*rowH,name=byId.get(id)?.name || id;
    html+=label(L-9,yy+10,String(i+1),`text-anchor="end" style="fill:${color(id)};font-size:11px"`);
    html+=`<rect x="${L}" y="${yy}" width="${pw}" height="12" rx="3" fill="#f0f3f8">${title(`${i+1}. ${name}`)}</rect>`;
    for(const [start,end] of M.windows(masks.get(id))) html+=`<rect x="${number(x(start))}" y="${yy}" width="${Math.max(.5,x(end)-x(start)).toFixed(2)}" height="12" rx="2" fill="${color(id)}" opacity="${id===focus ? .85 : .62}">${title(`${name} · ${M.compact(start)}–${M.compact(end)} · ${((end-start)/60).toFixed(2)} h`)}</rect>`;
  });
  html+=`<path d="M${number(x(cursor))} 40V${height-12}" stroke="${INK}" stroke-width="1" stroke-dasharray="2 4" opacity=".38"/>`;
  finish(svg,w,height,html,'单夜天顶角轨迹、当前源月亮角距与逐源可观测窗口；时间为所设站址本地时刻，午夜后的时刻以加号表示。');
}

export function separation(a,b) {
  const dec1=Number(a.dec)*DEG,dec2=Number(b.dec)*DEG,ra=(Number(a.ra)-Number(b.ra))*DEG;
  const cosine=Math.sin(dec1)*Math.sin(dec2)+Math.cos(dec1)*Math.cos(dec2)*Math.cos(ra);
  return Math.acos(clamp(cosine,-1,1))/DEG;
}

export function renderAllSky(svg,sources,selectedId) {
  const w=widthOf(svg),small=w<550,L=small?39:54,R=small?15:26,top=30,height=small?280:Math.min(500,w*.39),bottom=height-38;
  const pw=w-L-R,ph=bottom-top,x=ra=>L+(360-ra)/360*pw,y=dec=>top+(90-dec)/180*ph;
  let html=`<rect x="${L}" y="${top}" width="${pw}" height="${ph}" rx="5" fill="#f8fafc" stroke="${LINE}"/>`;
  html+=label(L,15,'ICRS 源位置','style="font-size:11px"')+label(w-R,15,'赤经向左增大','text-anchor="end" style="font-size:11px"');
  const ras=small?[0,90,180,270,360]:[0,60,120,180,240,300,360];
  for(const ra of ras) html+=line(x(ra),top,x(ra),bottom)+label(x(ra),height-19,`${ra}°`,`text-anchor="${ra===360?'start':ra===0?'end':'middle'}" style="font-size:11px"`);
  for(const dec of [-90,-60,-30,0,30,60,90]) {
    if(small&&Math.abs(dec)===30) continue;
    html+=line(L,y(dec),w-R,y(dec))+label(L-7,y(dec)+4,`${dec>0?'+':''}${dec}°`,'text-anchor="end" style="font-size:10px"');
  }
  const ordered=[...sources.filter(s=>s.id!==selectedId),...sources.filter(s=>s.id===selectedId)];
  for(const s of ordered) {
    if(!Number.isFinite(s.ra)||!Number.isFinite(s.dec)) continue;
    const selected=s.id===selectedId,xx=x(s.ra),yy=y(s.dec);
    const catalog=Array.isArray(s.catalogs)?s.catalogs.join(' '):String(s.catalog || '');
    const color=catalog.toLowerCase().includes('lhaaso')?COLORS[2]:COLORS[0];
    html+=`<circle cx="${number(xx)}" cy="${number(yy)}" r="${selected?5:2.6}" fill="${selected?INK:color}" fill-opacity="${selected?1:.63}" stroke="${selected?'#fff':'none'}" stroke-width="2" data-source="${escape(s.id)}" tabindex="0" role="button" aria-label="${escape(`查看 ${s.name}`)}">${title(`${s.name} · RA ${s.ra.toFixed(3)}° · Dec ${s.dec.toFixed(3)}°`)}</circle>`;
    if(selected) {
      html+=`<circle cx="${number(xx)}" cy="${number(yy)}" r="9" fill="none" stroke="${INK}" stroke-opacity=".45" pointer-events="none"/>`;
      const right=xx<w/2;
      const space=right?w-R-xx-14:xx-L-14,maxChars=Math.max(8,Math.floor(space/6.2)),name=s.name.length>maxChars?s.name.slice(0,maxChars-1)+'…':s.name;
      html+=label(xx+(right?12:-12),clamp(yy-10,top+14,bottom-5),name,`text-anchor="${right?'start':'end'}" style="fill:${INK};font-size:11px;paint-order:stroke;stroke:#f8fafc;stroke-width:4px;stroke-linejoin:round" pointer-events="none"`);
    }
  }
  finish(svg,w,height,html,'全部源的 ICRS 赤经、赤纬分布。横轴为反向赤经，纵轴为赤纬；这是等距经纬坐标图，不表示等立体角。选择点可查看该源。');
  svg.setAttribute('role','group');
}
