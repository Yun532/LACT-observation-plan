import { COLORS, separation } from './charts.js';

const D=Math.PI/180,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const neighborhoodRadius=c=>Math.max(5,c.fov)+(c.skyPadding??3);
export const knownRadius=s=>s.extension?.kind==='gaussian-r39'&&Number.isFinite(s.extension.radiusDeg)?s.extension.radiusDeg:0;
export function neighborEntries(focus,sources,radius){
  return sources.filter(s=>s.id!==focus.id).map(s=>({...s,separation:separation(focus,s)}))
    .filter(s=>s.separation<=radius+knownRadius(s)).sort((a,b)=>a.separation-b.separation||a.name.localeCompare(b.name));
}
export function extensionText(s){
  const e=s.extension;
  if(e?.kind==='gaussian-r39')return `r39 ${e.upperLimit?'≤ ':''}${e.radiusDeg}°${e.upperLimit?'（95% 上限）':''}`;
  if(e?.kind==='catalog-angular-size')return `目录角尺度 ${[e.xDeg,e.yDeg].filter(Number.isFinite).join(' × ')}°（定义未统一）`;
  return '未提供展宽';
}
function circle(s,radius){
  const d=s.dec*D,ra=s.ra*D,r=radius*D;
  return Array.from({length:73},(_,i)=>{
    const b=i*Math.PI/36,lat=Math.asin(Math.sin(d)*Math.cos(r)+Math.cos(d)*Math.sin(r)*Math.cos(b));
    return {dec:lat/D,ra:(ra+Math.atan2(Math.sin(b)*Math.sin(r)*Math.cos(d),Math.cos(r)-Math.sin(d)*Math.sin(lat)))/D};
  });
}
export function renderNeighborField(svg,focus,neighbors,stars,c,{showStars=true,showExtensions=true,positions=null}={}){
  const w=Math.max(260,Math.round(svg.getBoundingClientRect().width||500)),h=Math.min(420,w*.8),cx=w/2,cy=h/2+4;
  const radius=neighborhoodRadius(c),r=Math.min(w/2-35,h/2-32),scale=r/Math.tan(radius*D),clip='neighbor-field-clip';
  const project=s=>{
    const d=s.dec*D,d0=focus.dec*D,a=(s.ra-focus.ra)*D,den=Math.sin(d0)*Math.sin(d)+Math.cos(d0)*Math.cos(d)*Math.cos(a);
    return den<=0?null:[cx-scale*Math.cos(d)*Math.sin(a)/den,cy-scale*(Math.cos(d0)*Math.sin(d)-Math.sin(d0)*Math.cos(d)*Math.cos(a))/den];
  };
  const path=points=>points.map(project).filter(Boolean).map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')+'Z';
  let html=`<defs><clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs><text x="8" y="17">北 ↑ 东 ←</text><text x="${w-8}" y="17" text-anchor="end">半径 ${radius}° · 含外围 ${c.skyPadding}°</text><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fafbfd" stroke="#e3e9f3"/><g clip-path="url(#${clip})">`;
  html+=`<path d="M${cx-r} ${cy}H${cx+r}M${cx} ${cy-r}V${cy+r}" stroke="#e5eaf2"/>`;
  html+=`<circle cx="${cx}" cy="${cy}" r="${Math.tan(5*D)*scale}" fill="none" stroke="#b5bece" stroke-dasharray="2 5"><title>原 5° 参考天区</title></circle>`;
  html+=`<circle cx="${cx}" cy="${cy}" r="${Math.tan(c.fov*D)*scale}" fill="#edf2ff" fill-opacity=".55" stroke="${COLORS[0]}" stroke-opacity=".55" stroke-dasharray="6 4"><title>设置的视场半径 ${c.fov}°</title></circle>`;
  const nearbyStars=showStars?stars.map(s=>({...s,...positions?.get(s.id)})).filter(s=>separation(focus,s)<=radius).sort((a,b)=>b.mag-a.mag):[];
  for(const s of nearbyStars){
    const p=project(s);if(!p)continue;const [x,y]=p,k=Math.max(1.3,3.7-s.mag*.3),dim=s.alt<0;
    html+=`<path d="M${x-k} ${y}H${x+k}M${x} ${y-k}V${y+k}" stroke="#a17c37" stroke-width="1.1" opacity="${dim ? .3 : .8}"><title>${esc(s.name)} · V=${s.mag.toFixed(2)}${dim?' · 此刻地平线下':''}</title></path>`;
  }
  const list=[focus,...neighbors];
  if(showExtensions)for(const s of list){
    const er=knownRadius(s);if(!(er>0))continue;
    const col=s.plotColor||'#8793a7',upper=s.extension.upperLimit;
    html+=`<path d="${path(circle(s,er))}" fill="${upper?'none':col}" fill-opacity=".07" stroke="${col}" stroke-opacity=".65" stroke-width="1" ${upper?'stroke-dasharray="4 3"':''}><title>${esc(s.name+' · '+extensionText(s))}</title></path>`;
  }
  list.forEach((s,i)=>{
    const p=project(s);if(!p)return;const [x,y]=p,col=s.plotColor||'#8793a7',outside=s.separation>radius;
    if(outside)return;
    html+=`<circle cx="${x}" cy="${y}" r="${i?3:5}" fill="${col}" stroke="#fff" stroke-width="1.1" data-neighbor-source="${esc(s.id)}"><title>${esc(s.name+' · '+extensionText(s))}</title></circle>`;
    // Every source is plotted. Only number the nearest entries to limit crowding.
    if(i<=8){const a=i*Math.PI/3;html+=`<text x="${x+Math.cos(a)*13}" y="${y+Math.sin(a)*13+3}" text-anchor="middle" style="fill:${col};font-size:10px">${i||'◎'}</text>`;}
  });
  html+=`</g><text x="8" y="${h-6}" style="font-size:10px">蓝虚线：视场 ${c.fov}°　灰点线：5°参考圈</text>`;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('aria-label',`${focus.name} 周围半径${radius}度，含源展宽与${nearbyStars.length}颗V星等不大于${c.starLimit}的恒星，北上东左。`);svg.innerHTML=html;
  return nearbyStars.sort((a,b)=>a.mag-b.mag);
}
