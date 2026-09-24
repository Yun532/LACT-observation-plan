import './style.css';
import { computeNight, computeMonth, skyAt, DEFAULTS } from './astronomy.js';
import M from './planning.mjs';
import { matchesSource } from './source-search.js';
import { COLORS, renderTrajectory, renderAllSky, separation } from './charts.js';
import { renderSiteSky } from './sky-chart.js';
import { renderNeighborField, neighborEntries, neighborhoodRadius, extensionText } from './neighbor-chart.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hours = minutes => (minutes / 60).toFixed(2) + ' h';
const sum = values => values.reduce((a,b) => a+b, 0);
const timezoneLabel = c => 'UTC' + (c.timezone >= 0 ? '+' : '') + c.timezone;
const today = c => new Date(Date.now() + c.timezone * 3600000).toISOString().slice(0,10);
const statusNames = {established:'已确认',newly_announced:'新发布',disputed:'有争议',candidate:'候选'};
const SETTINGS_KEY = 'lact.preferences.v1', PLAN_KEY = 'lact.plans.v1';
const PRESET = {...M.defaults,...DEFAULTS,defaultDuration:60};
let saved = {}, plans = {}, storageWarned = false;
try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); plans = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); } catch { /* Corrupted local preferences do not prevent opening the app. */ }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
if (!plans || typeof plans !== 'object' || Array.isArray(plans)) plans = {};
let config = {...PRESET};
try { config = {...PRESET,...M.validateConfig(saved.config || PRESET),defaultDuration:Number(saved.config?.defaultDuration) || 60}; } catch { config = {...PRESET}; }
config.defaultDuration = Math.max(5,Math.min(600,config.defaultDuration));
const S = {config, sources:[], meta:{}, byId:new Map(), route:'overview', year:Number(today(config).slice(0,4)), month:Number(today(config).slice(5,7))-1, page:0, perPage:25, filter:'',catalog:'all',status:'published',sort:'month',view:'table', annual:null, worker:null, computeId:0, date:today(config), focus:'',visible:[],cursor:180,night:null,nightKey:'',blocks:[],selected:null,nextId:1,revision:1,history:[],priorities:saved.priorities && typeof saved.priorities==='object' ? saved.priorities : {},monthSource:'',monthYear:2026,monthIndex:0,monthSelected:'',monthData:null};
let toastTimer, drag = null, assessment = null, renderFrame;
const nightPicker = {key:'',rows:null,worker:null,error:''};
const sky = {stars:[],meta:null,loading:false,error:'',positions:null,key:'',hits:[],showStars:saved.sky?.showStars!==false,showTracks:saved.sky?.showTracks!==false,showExtensions:saved.sky?.showExtensions!==false};
const source = id => S.byId.get(id);
const nightConfig = () => ({...S.config,mode:'LACT',startHour:18});
const color = id => S.visible.includes(id) ? COLORS[S.visible.indexOf(id) % COLORS.length] : '#8793a7';
const priority = id => [1,2,3].includes(S.priorities[id]) ? S.priorities[id] : 0;
const label = s => s.name;
const short = s => s.name.replace(/^1LHAASO\s|^LHAASO\s|^TeV\s/g,'');
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function safeStore(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { if(!storageWarned){toast('浏览器无法保存本地草稿，请使用“保存草稿”下载计划。');storageWarned=true;} } }
function savePreferences(){safeStore(SETTINGS_KEY,{config:S.config,priorities:S.priorities,sky:{showStars:sky.showStars,showTracks:sky.showTracks,showExtensions:sky.showExtensions}});}
function snapshot(){return {version:1,date:S.date,config:nightConfig(),blocks:S.blocks.map(b=>({...b})),focus:S.focus,visible:[...S.visible]};}
function savePlan(){if(!S.sources.length)return;plans[S.date]={...snapshot(),revision:S.revision};safeStore(PLAN_KEY,plans);}
function remember(){S.history.push(JSON.stringify({blocks:S.blocks,selected:S.selected,visible:S.visible,focus:S.focus}));if(S.history.length>40)S.history.shift();}
function edited(message){S.revision++;savePlan();renderNight();if(message)$('schedule-message').textContent=message;}
function invalidateNight(){S.night=null;S.nightKey='';}
function conditions(c){return c.mode==='LHAASO' ? `LHAASO · z ≤ ${c.zmax}° · 全天过境，不应用日月限制` : `LACT · z ≤ ${c.zmax}° · 太阳 < ${c.sun}° · 月距 ${c.moon}°${c.moonMode==='warn'?'（仅提示）':c.moonMode==='up'?'（月在地平线上）':''}`;}
function renderConditions(){
  $('conditions-summary').textContent=conditions(S.config);
  $('night-conditions').textContent=conditions(nightConfig())+' · 18:00 — 次日08:00';
  $('site-label').textContent=(Math.abs(S.config.latitude-PRESET.latitude)<1e-6&&Math.abs(S.config.longitude-PRESET.longitude)<1e-6?'稻城':'自定义站址')+' · '+timezoneLabel(S.config);
  $('mode').value=S.config.mode;
  $('year').value=S.year;
}
function setRoute(route){
  S.route=route==='night'?'night':'overview';
  $('overview-page').hidden=S.route!=='overview';$('night-page').hidden=S.route!=='night';
  document.querySelectorAll('[data-route]').forEach(b=>{b.classList.toggle('active',b.dataset.route===S.route);b.setAttribute('aria-current',b.dataset.route===S.route?'page':'false');});
  if(location.hash!=='#'+S.route)history.replaceState(null,'','#'+S.route);
  document.title=(S.route==='night'?'单夜观测':'全年观测窗口')+' · LACT';
  if(S.route==='night')renderNight();else renderOverview();
}
function filteredSources(){
  const q=S.filter.trim().toLowerCase();
  let items=S.sources.filter(s=>(S.catalog==='all'||s.catalog===S.catalog)&&(S.status==='all'||S.status==='favorites'&&priority(s.id)>0||S.status==='published'&&s.defaultIncluded!==false)&&matchesSource(s,q));
  const annual=id=>S.annual?.monthly[id]||[];
  const flux=s=>s.catalog==='TeVCat'&&s.flux?.unit==='Crab'&&s.flux.value>0?s.flux.value:-Infinity;
  items.sort((a,b)=>{
    let difference=0;
    if(S.sort==='month')difference=(annual(b.id)[S.month]||0)-(annual(a.id)[S.month]||0);
    if(S.sort==='year')difference=sum(annual(b.id))-sum(annual(a.id));
    if(S.sort==='priority')difference=priority(b.id)-priority(a.id)||sum(annual(b.id))-sum(annual(a.id));
    if(S.sort==='flux')difference=flux(b)-flux(a);
    return (Number.isNaN(difference)?0:difference)||a.name.localeCompare(b.name);
  });
  return items;
}
function renderOverview(){
  if(!S.sources.length)return;
  const items=filteredSources(),pages=Math.max(1,Math.ceil(items.length/S.perPage));S.page=Math.min(S.page,pages-1);
  $('source-count').textContent=items.length+' 条目录记录';
  $('source-head').innerHTML='<tr><th>源 / 目录</th>'+Array.from({length:12},(_,i)=>`<th><button class="month-sort ${S.month===i?'active':''}" data-month-sort="${i}" aria-label="按${i+1}月可观测时长排序">${i+1}月${i===S.month&&S.sort==='month'?' ↓':''}</button></th>`).join('')+'<th>全年 / h</th></tr>';
  const maximum=S.annual?Math.max(60,...S.sources.flatMap(s=>S.annual.monthly[s.id]||[])):240;
  $('heat-max').textContent=Math.ceil(maximum/10)*10+' h';
  const pageItems=items.slice(S.page*S.perPage,(S.page+1)*S.perPage);
  $('source-body').innerHTML=pageItems.map(s=>{
    const monthly=S.annual?.monthly[s.id],p=priority(s.id),recordStatus=['candidate','disputed'].includes(s.status)?' · '+statusNames[s.status]:'';
    return `<tr><td><div class="source-name-cell"><button class="priority-button ${p?'marked':''}" data-priority="${esc(s.id)}" aria-label="${esc(s.name)} 优先级 ${p}，点击切换">${p?'★':'☆'}${p>1?'<small style="font-size:9px">'+p+'</small>':''}</button><button class="source-name" data-open-month="${esc(s.id)}"><strong>${esc(s.name)}</strong><span>${esc(s.catalog)} · ${esc(s.type||'未分类')}${recordStatus}</span></button></div></td>`+Array.from({length:12},(_,m)=>`<td>${monthly?`<button class="heat-cell ${monthly[m]<.05?'zero':''} ${s.id===S.focus&&m===S.month?'selected':''}" data-cell-source="${esc(s.id)}" data-cell-month="${m}" style="--v:${Math.min(240,monthly[m]/maximum*240).toFixed(1)}" aria-label="${esc(s.name)} ${m+1}月，可观测 ${monthly[m].toFixed(1)} 小时">${monthly[m]<.05?'·':Math.round(monthly[m])}</button>`:'<span class="skeleton-number" aria-label="计算中"></span>'}</td>`).join('')+`<td class="year-total">${monthly?Math.round(sum(monthly)):'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="14"><div class="empty-state">没有匹配的源。试试缩短关键词或调整筛选。</div></td></tr>';
  $('table-summary').textContent=items.length?`${S.page*S.perPage+1}–${Math.min(items.length,(S.page+1)*S.perPage)} / ${items.length} 条 · 点击月份查看逐夜窗口`:'0 条匹配记录';
  $('page-number').textContent=`${S.page+1} / ${pages}`;$('prev-page').disabled=S.page===0;$('next-page').disabled=S.page===pages-1;
  $('flux-note').hidden=S.sort!=='flux';$('table-view').hidden=S.view!=='table';$('sky-view').hidden=S.view!=='sky';
  $('table-title').textContent=S.view==='sky'?'目录源的天空位置':'月度可观测时间';
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
  if(S.view==='sky')renderAllSky($('all-sky'),items,S.focus);
}
function calculateAnnual(){
  if(!S.sources.length)return;
  S.worker?.terminate();S.annual=null;const id=++S.computeId;
  $('annual-progress').hidden=false;$('annual-progress').firstElementChild.style.width='0%';$('compute-status').textContent='正在计算全年窗口…';renderOverview();
  const worker=S.worker=new Worker(new URL('./visibility-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.id!==S.computeId)return;
    if(data.type==='progress'){$('annual-progress').firstElementChild.style.width=data.percent+'%';$('compute-status').textContent=`全年窗口 ${data.percent}%`;}
    if(data.type==='error'){annualFailed(data.error);worker.terminate();}
    if(data.type==='result'){S.annual=data.result;$('annual-progress').hidden=true;$('compute-status').textContent=`${S.year} · ${S.config.mode==='LACT'?'正午至次日正午':'00:00–24:00'} · 10 min 步长`;renderOverview();worker.terminate();}
  };
  worker.onerror=()=>annualFailed('计算未能完成，请重试或刷新页面。');
  worker.postMessage({id,type:'year',year:S.year,sources:S.sources.map(({id,name,ra,dec})=>({id,name,ra,dec})),config:S.config});
}
function annualFailed(message){$('annual-progress').hidden=true;$('compute-status').innerHTML=esc(message)+' <button class="text-button" data-action="retry">重试</button>';toast(message);}
function chooseFocus(id,{overlay=false,open=false}={}){
  if(!source(id))return;
  if(!S.visible.includes(id)){
    if(S.visible.length>=6){if(overlay){toast('最多同时比较 6 条轨迹；请先移除一条。');return;}S.visible=S.visible.slice(0,5);}
    S.visible.push(id);
  }
  if(!overlay)S.focus=id;
  if(open)setRoute('night');else if(S.route==='night')renderNight();
  savePlan();
}
function removeCurve(id){
  if(!S.visible.includes(id)||S.visible.length<=1)return;
  S.visible=S.visible.filter(value=>value!==id);
  if(S.focus===id)S.focus=S.visible[0];
  renderNight();savePlan();
}
function openNightPicker(){
  const dialog=$('night-picker-dialog'),c=nightConfig(),key=S.date+JSON.stringify(c);
  $('night-search-results').hidden=true;
  $('night-picker-context').textContent=`${S.date} · 18:00 至次日 08:00 · ${timezoneLabel(c)}`;
  $('night-picker-conditions').textContent=conditions(c);
  if(nightPicker.key!==key){nightPicker.worker?.terminate();Object.assign(nightPicker,{key,rows:null,worker:null,error:''});}
  if(!dialog.open)dialog.showModal();
  renderNightPicker();
  if(nightPicker.rows||nightPicker.worker)return;
  nightPicker.error='';renderNightPicker();
  const worker=nightPicker.worker=new Worker(new URL('./visibility-worker.js',import.meta.url),{type:'module'});
  const finish=(rows,error='')=>{
    if(nightPicker.worker!==worker)return;
    Object.assign(nightPicker,{rows,error,worker:null});worker.terminate();renderNightPicker();
  };
  worker.onmessage=({data})=>{
    if(data.type==='result')finish(data.result);
    if(data.type==='error')finish(null,data.error);
  };
  worker.onerror=()=>finish(null,'当晚源表计算未完成，请重试。');
  worker.postMessage({type:'night-catalog',date:S.date,sources:S.sources.map(({id,name,ra,dec})=>({id,name,ra,dec})),config:c});
}
function renderNightPicker(){
  if(!$('night-picker-dialog').open)return;
  const c=nightConfig(),activeId=document.activeElement?.dataset.pickerSource;
  $('night-picker-selected').innerHTML=S.visible.map(id=>`<button class="picker-chip" data-picker-source="${esc(id)}" style="--source-color:${color(id)}" aria-label="从对比中移除 ${esc(source(id).name)}" ${S.visible.length===1?'disabled':''}><i class="legend-dot"></i>${esc(source(id).name)}<span aria-hidden="true">×</span></button>`).join('');
  $('night-picker-selection').textContent=`已叠加 ${S.visible.length} / 6${S.visible.length===6?' · 移除一个源后可继续添加':' · 点击叠加，多源对比'}`;
  $('night-picker-list').setAttribute('aria-busy',String(!nightPicker.rows&&!nightPicker.error));
  if(!nightPicker.rows){
    $('night-picker-count').textContent=nightPicker.error?'计算未完成':'正在计算当晚可观测源…';
    $('night-picker-list').innerHTML=nightPicker.error?`<div class="empty-state">${esc(nightPicker.error)}<br><button class="text-button" data-action="retry-night-picker">重新计算</button></div>`:'<div class="empty-state">正在按当前观测条件计算全部目录源…</div>';
    return;
  }
  const q=$('night-picker-search').value.trim().toLowerCase(),catalog=$('night-picker-catalog').value;
  const published=$('night-picker-status').value==='published',available=$('night-picker-available').checked;
  const rows=nightPicker.rows.filter(row=>{
    const s=source(row.id);
    return (!available||row.minutes>0)&&(!published||s.defaultIncluded!==false)&&(catalog==='all'||s.catalog===catalog)&&matchesSource(s,q);
  });
  $('night-picker-count').textContent=`${rows.length} 条匹配记录 · 可观测时长从长到短`;
  $('night-picker-list').innerHTML=rows.map(row=>{
    const s=source(row.id),selected=S.visible.includes(s.id),disabled=selected?S.visible.length===1:S.visible.length>=6;
    const windows=row.windows.map(([a,b])=>`${M.clock(a,c)}–${M.clock(b,c)}`).join(' / ');
    const extra=['candidate','disputed'].includes(s.status)?' · '+statusNames[s.status]:'';
    return `<div class="night-picker-row ${selected?'is-selected':''}" role="listitem" data-picker-row="${esc(s.id)}"><div class="picker-source"><strong>${esc(s.name)}</strong><small>${esc(s.catalog)} · ${esc(s.type||'未分类')}${extra}</small></div><div class="picker-window"><div class="picker-window-track" aria-hidden="true">${row.windows.map(([a,b])=>`<i style="left:${a/840*100}%;width:${(b-a)/840*100}%"></i>`).join('')}</div><small>${windows||'当前条件下无可用时段'}</small></div><div class="picker-hours">${hours(row.minutes)}<small>${row.minutes} min</small></div><button class="${selected?'quiet-button':'secondary-button'}" data-picker-source="${esc(s.id)}" aria-pressed="${selected}" aria-label="${selected?'移除':'叠加'} ${esc(s.name)}" ${disabled?'disabled':''}>${selected?'已叠加 −':'＋ 叠加'}</button></div>`;
  }).join('')||'<div class="empty-state">没有符合筛选的源。<br>可取消“仅可观测”，或调整目录、关键词与观测条件。</div>';
  if(activeId)[...$('night-picker-list').querySelectorAll('[data-picker-source]')].find(b=>b.dataset.pickerSource===activeId)?.focus({preventScroll:true});
}
function loadDate(date){
  if(!M.validDate(date)||Number(date.slice(0,4))<2000||Number(date.slice(0,4))>2100){toast('请选择 2000–2100 年之间的有效日期。');$('night-date').value=S.date;return;}
  if(date===S.date)return;
  savePlan();S.date=date;S.history=[];S.blocks=[];S.selected=null;S.revision=1;
  const oldConfig=JSON.stringify(S.config);
  if(plans[date]){try{const p=M.restorePlan(plans[date],S.sources);restoreSnapshot(p);S.revision=Number(plans[date].revision)||1;}catch{toast('这晚的本地草稿无法读取，已打开空计划。');}}
  if(JSON.stringify(S.config)!==oldConfig){savePreferences();renderConditions();calculateAnnual();toast('已恢复这晚草稿保存的观测参数。');}
  S.nextId=Math.max(0,...S.blocks.map(b=>b.id))+1;S.selected=S.blocks[0]?.id??null;invalidateNight();renderNight();
}
function restoreSnapshot(p){
  S.blocks=p.blocks;S.focus=p.focus;S.visible=p.visible.filter(id=>source(id)).slice(0,6);
  if(!S.visible.includes(S.focus))S.visible=[S.focus,...S.visible].slice(0,6);
  S.config={...p.config,mode:S.config.mode,startHour:18,defaultDuration:S.config.defaultDuration};
}
function ensureNight(){
  const ids=[...new Set([S.focus,...S.visible,...S.blocks.map(b=>b.source)])].filter(id=>source(id));
  const key=S.date+JSON.stringify(nightConfig())+ids.join('|');
  if(key!==S.nightKey){S.night=computeNight(S.date,ids.map(source),nightConfig());S.nightKey=key;}
}
function availableMinutes(id){return sum(M.mask(S.night,id,nightConfig()).map(Number));}
async function loadStars(){
  if(sky.loading||sky.meta)return;
  sky.loading=true;sky.error='';
  try{
    const response=await fetch(new URL('data/stars.json',document.baseURI));
    if(!response.ok)throw new Error('恒星目录载入失败');
    const data=await response.json();
    if(!Array.isArray(data.stars))throw new Error('恒星目录格式不正确');
    sky.stars=data.stars.filter(s=>typeof s.id==='string'&&s.band==='V'&&Number.isFinite(s.ra)&&s.ra>=0&&s.ra<360&&Number.isFinite(s.dec)&&Math.abs(s.dec)<=90&&Number.isFinite(s.mag)&&s.mag<=8);
    if(!sky.stars.length)throw new Error('恒星目录中没有有效的 V 波段记录');
    sky.meta=data.meta||{};sky.key='';
  }catch(error){sky.error=error instanceof SyntaxError?'恒星目录暂时无法载入':error.message;}
  sky.loading=false;if(S.route==='night')drawNightCharts();
}
function drawSiteSky(){
  const c=nightConfig(),stars=sky.showStars?sky.stars.filter(s=>s.mag<=c.starLimit):[];
  const key=S.night.startMs+'|'+S.cursor+'|'+[c.latitude,c.longitude,c.elevation,c.starLimit,sky.showStars,sky.stars.length].join('|');
  if(key!==sky.key){sky.positions=skyAt(S.night.startMs+S.cursor*60000,[...S.sources,...stars],c);sky.key=key;}
  const result=renderSiteSky($('site-sky'),{night:S.night,positions:sky.positions,sources:S.sources,visible:S.visible,focus:S.focus,cursor:S.cursor,config:c,stars,showTracks:sky.showTracks,showStars:sky.showStars,showExtensions:sky.showExtensions});
  sky.hits=result.hits;
  $('sky-time').textContent=M.clock(S.cursor,c)+' · '+timezoneLabel(c);
  $('sky-bodies').textContent=`太阳高 ${sky.positions.sun.alt.toFixed(1)}° · ${sky.positions.sun.alt<c.sun?'满足暗夜阈值':'未满足暗夜阈值'}　月亮高 ${sky.positions.moon.alt.toFixed(1)}°${sky.positions.moon.alt<0?'（地平线下）':''}`;
  $('star-limit').value=c.starLimit;$('sky-padding').value=c.skyPadding;
  $('show-stars').checked=sky.showStars;$('show-tracks').checked=sky.showTracks;$('show-extensions').checked=sky.showExtensions;
  $('star-status').innerHTML=!sky.showStars?'亮星显示已关闭':sky.meta?`V ≤ ${c.starLimit} · 地平线上 ${result.starCount} 条恒星记录 · 数值越小越亮` : sky.error?esc(sky.error)+' <button class="text-button" data-action="retry-stars">重试</button>':'正在载入亮星目录…';
  $('star-coverage').textContent=sky.meta?.coverage||'';
  const neighbors=neighborEntries(source(S.focus),S.sources,neighborhoodRadius(c));
  const positions=new Map(sky.positions.sources.map(s=>[s.id,s]));
  const nearStars=renderNeighborField($('neighbor-sky'),{...source(S.focus),plotColor:color(S.focus)},neighbors.map(s=>({...s,plotColor:color(s.id)})),stars,c,{showStars:sky.showStars,showExtensions:sky.showExtensions,positions});
  $('neighbor-radius').textContent=`半径 ${neighborhoodRadius(c)}° · 含外围 ${c.skyPadding}°`;
  $('neighbors').innerHTML=neighbors.map((s,i)=>`<div class="neighbor-row"><div><button data-focus="${esc(s.id)}"><span style="color:${color(s.id)}">${i+1}.</span> ${esc(s.name)}</button><small>${esc(s.catalog)} · ${esc(extensionText(s))}${s.separation<.1?' · 可能为关联条目':''}${s.separation>neighborhoodRadius(c)?' · 中心在图外，目录尺度圈或上限圈与天区相交':''}</small></div><div>${s.separation.toFixed(2)}°<button class="text-button" data-overlay="${esc(s.id)}">${S.visible.includes(s.id)?'已叠加':'叠加轨迹'}</button></div></div>`).join('')||'<div class="empty-state">该天区没有其他目录条目</div>';
  const starUnavailable=!sky.showStars?'亮星显示已关闭':!sky.meta?'亮星目录尚未载入':'';
  $('neighbor-stars-count').textContent=starUnavailable||`亮星 ${nearStars.length} 条记录 · V ≤ ${c.starLimit}`;
  $('neighbor-stars').innerHTML=starUnavailable?`<p class="footnote">${starUnavailable}</p>`:nearStars.map(s=>`<div class="neighbor-star-row"><span>✦ ${esc(s.name)}</span><span>V ${s.mag.toFixed(2)} · ${separation(source(S.focus),s).toFixed(2)}°${s.alt<0?' · 地平线下':''}</span></div>`).join('')||'<p class="footnote">所选星等阈值下，此天区没有收录的恒星。</p>';
}
function drawNightCharts(){
  if(S.route!=='night'||!S.night)return;
  renderTrajectory($('trajectory'),S.night,S.sources,S.visible,S.focus,S.cursor,nightConfig(),S.blocks,S.selected);
  renderReadout();
  drawSiteSky();
}
function renderReadout(){
  const n=S.night,c=nightConfig(),focus=source(S.focus),reason=M.reason(n,S.focus,Math.min(839.5,S.cursor),c);
  const current=S.blocks.filter(b=>S.cursor>=b.start&&S.cursor<b.start+b.duration);
  $('night-readout').innerHTML=`<div class="readout-item"><span>本地时刻 · ${timezoneLabel(c)}</span><strong>${M.clock(S.cursor,c)}</strong></div>`+S.visible.map(id=>`<div class="readout-item"><span><i class="legend-dot" style="--source-color:${color(id)}"></i> ${esc(short(source(id)))}</span><strong>${M.sample(n.sources[id].z,S.cursor).toFixed(1)}°${M.sample(n.sources[id].z,S.cursor)>90?' · 地平线下':''}</strong></div>`).join('')+`<div class="readout-item"><span>关注源月距 / 月高</span><strong>${M.sample(n.sources[S.focus].sep,S.cursor).toFixed(1)}° / ${M.sample(n.moon_alt,S.cursor).toFixed(1)}°</strong></div><div class="readout-status">${esc(focus.name)} · ${reason||'满足当前观测条件'}　 /　 ${current.length>1?'当前时刻有重叠任务':current.length?'任务 #'+current[0].id:'此刻未安排观测'}</div>`;
  $('cursor-value').textContent=M.clock(S.cursor,c);$('cursor').value=S.cursor;
}
function renderNight(){
  if(!S.sources.length||S.route!=='night')return;
  try{ensureNight();}catch(error){$('night-status').textContent='计算失败：'+error.message;toast(error.message);return;}
  const c=nightConfig(),f=source(S.focus);assessment=M.validate(S.night,S.blocks,c);
  $('night-date').value=S.date;$('draft-state').textContent=`草稿 v${S.revision} · 本机保存`;
  $('focus-name').textContent=f.name;$('focus-coordinates').textContent=`${f.catalog} · ${f.type}　 RA ${f.ra.toFixed(4)}° / Dec ${f.dec.toFixed(4)}° · ICRS`;
  $('night-status').textContent='几何轨迹 · 1 min 步长';
  const [a,b]=M.nightBounds(S.night,c);
  const eventTime=t=>Number.isFinite(t)?M.clock(t,c):'无此事件';
  $('solar-events').innerHTML=[['日落',S.night.events?.sunset,'solar'],['暗夜可用开始',b>a?a:null,'dark'],['暗夜可用结束',b>a?b:null,'dark'],['日出',S.night.events?.sunrise,'solar']].map(([name,t,kind])=>`<div class="solar-event ${kind}"><span>${name}</span><strong>${b<=a&&kind==='dark'?'无暗夜窗口':eventTime(t)}</strong></div>`).join('');
  $('solar-note').textContent=`日出日落采用太阳中心高度 −0.833° 的标准地平线近似；本时间轴暗夜窗采用太阳 < ${c.sun}°，两端裁剪 ${c.trim} min。各源还需满足天顶角和月距条件。`;
  $('trajectory-legend').innerHTML=S.visible.map((id,i)=>`<div class="legend-source"><span class="legend-dot" style="--source-color:${color(id)}"></span><button data-focus="${esc(id)}" class="${id===S.focus?'focused':''}" aria-pressed="${id===S.focus}">${i+1}. ${esc(source(id).name)}</button>${S.visible.length>1?`<button class="remove-curve" data-remove-curve="${esc(id)}" aria-label="移除${esc(source(id).name)}轨迹">×</button>`:''}</div>`).join('')+`<span class="legend-note">${b>a?'暗夜 '+M.clock(a,c)+' — '+M.clock(b,c):'本时段无暗夜窗口'}</span>`;
  $('candidates').innerHTML=S.visible.map(id=>`<div class="candidate" draggable="true" data-drag-source="${esc(id)}" style="--source-color:${color(id)}"><div class="candidate-name"><span class="legend-dot" style="--source-color:${color(id)}"></span>${esc(source(id).name)}</div><div class="candidate-hours">${hours(availableMinutes(id))}<small>当晚可用</small></div><button data-add="${esc(id)}">＋ 排入空档</button></div>`).join('');
  renderSchedule();renderHistogram();drawNightCharts();
  if(!sky.meta&&!sky.loading&&!sky.error)loadStars();
}
function renderSchedule(){
  const c=nightConfig();
  $('schedule-ticks').innerHTML=Array.from({length:8},(_,i)=>`<span style="left:${i/7*100}%;transform:${i===0?'none':i===7?'translateX(-100%)':'translateX(-50%)'}">${M.compact(i*120,c)}</span>`).join('');
  let blocks=Array.from({length:8},(_,i)=>`<span class="schedule-gridline" style="left:${i/7*100}%"></span>`).join('');
  assessment.sorted.forEach((b,i)=>{
    const previous=assessment.sorted[i-1],bad=assessment.byId.get(b.id).length>0;
    if(previous&&previous.source!==b.source&&b.start>=previous.start+previous.duration&&c.overhead)blocks+=`<div class="transition-block" style="left:${(b.start-c.overhead)/840*100}%;width:${c.overhead/840*100}%"></div>`;
    blocks+=`<div class="task-block ${bad?'invalid':''} ${b.id===S.selected?'selected':''}" data-block="${b.id}" style="left:${b.start/840*100}%;width:${b.duration/840*100}%;--source-color:${color(b.source)}"><button class="resize-handle" data-resize="left" aria-label="调整任务${b.id}开始时间"></button><button class="task-main" data-select-task="${b.id}" aria-label="任务${b.id} ${esc(source(b.source).name)} ${M.clock(b.start,c)}到${M.clock(b.start+b.duration,c)}">#${b.id}<small>${b.duration} min</small></button><button class="resize-handle" data-resize="right" aria-label="调整任务${b.id}结束时间"></button></div>`;
  });
  $('schedule-track').innerHTML=blocks+(S.blocks.length?'':'<span class="timeline-empty">拖入源，开始安排这一晚</span>');
  const dark=M.nightBounds(S.night,c),overhead=assessment.sorted.reduce((total,b,i)=>total+(i&&assessment.sorted[i-1].source!==b.source?c.overhead:0),0);
  $('schedule-metrics').innerHTML=[['计划观测',hours(assessment.scheduledMinutes)],['通过当前规则',hours(assessment.validMinutes)],['转场预留',overhead+' min'],['待修正任务',S.blocks.filter(b=>assessment.byId.get(b.id).length).length]].map(([name,value])=>`<div><span>${name}</span><strong>${value}</strong></div>`).join('');
  $('issues').innerHTML=assessment.issues.map(issue=>`<button data-select-task="${issue.id}">任务 #${issue.id} · ${esc(issue.message)}</button>`).join('');
  $('task-rows').innerHTML=assessment.sorted.map(b=>`<tr class="${b.id===S.selected?'selected':''}"><td><button class="text-button" data-select-task="${b.id}">#${b.id}</button></td><td>${esc(source(b.source).name)}</td><td>${M.clock(b.start,c)} — ${M.clock(b.start+b.duration,c)}</td><td>${b.duration} min</td><td>${assessment.byId.get(b.id).length?'<span class="danger">'+assessment.byId.get(b.id).length+' 项待修正</span>':'<span class="status-good">规则通过</span>'}</td></tr>`).join('')||'<tr><td colspan="5"><div class="empty-state">尚未安排任务。选择“安排当前源”，或拖动上方源卡片到时间轴。</div></td></tr>';
  if(!S.blocks.some(b=>b.id===S.selected))S.selected=S.blocks[0]?.id??null;
  $('task-select').innerHTML=S.blocks.map(b=>`<option value="${b.id}">任务 #${b.id}</option>`).join('');
  const choices=[...new Set([...S.visible,...S.blocks.map(b=>b.source)])];$('task-source').innerHTML=choices.map(id=>`<option value="${esc(id)}">${esc(source(id).name)}</option>`).join('');
  const selected=S.blocks.find(b=>b.id===S.selected);for(const element of $('task-form').elements)element.disabled=!selected;
  if(selected){$('task-select').value=selected.id;$('task-source').value=selected.source;$('task-day').value=selected.start>=360?'1':'0';$('task-time').value=M.clock(selected.start,c).replace('次日 ','');$('task-duration').value=selected.duration;}
  $('undo').disabled=!S.history.length;
  $('review-summary').textContent=`${S.blocks.length} 项任务 · ${hours(assessment.validMinutes)} 通过几何与排班规则${assessment.issues.length?' · '+assessment.issues.length+' 项问题待修正':''}`;
  $('review-plan').disabled=!S.blocks.length||assessment.issues.length>0;
}
function renderHistogram(){
  const h=M.histogram(S.night,S.focus,nightConfig(),S.blocks,assessment),maximum=Math.max(1,...h.available);
  document.querySelectorAll('.focus-short').forEach(el=>el.textContent=short(source(S.focus)));
  $('histogram').innerHTML=['0–30°','30–50°','50–90°'].map((name,i)=>`<div class="hist-row"><span>${name}</span><div class="hist-track"><span class="hist-available" style="width:${h.available[i]/maximum*100}%"></span><span class="hist-planned" style="width:${h.planned[i]/maximum*100}%"></span></div><span>${hours(h.available[i])} / ${hours(h.planned[i])}</span></div>`).join('');
  $('hist-caption').textContent=`可用 ${hours(sum(h.available))}，有效计划 ${hours(sum(h.planned))}。相同夜晚、相同条件；有冲突的任务整段不计入有效计划。`;
}
function addTask(id,start=null){
  chooseFocus(id);ensureNight();const c=nightConfig(),duration=Math.max(c.minBlock,S.config.defaultDuration);
  if(S.blocks.length>=64){toast('每晚最多安排 64 个任务。');return;}
  if(start===null){
    for(let t=0;t<=840-duration;t+=5){const test={id:S.nextId,source:id,start:t,duration};if(!M.validate(S.night,[...S.blocks,test],c).issues.length){start=t;break;}}
    if(start===null){toast('当前没有足够长的合法空档。可先修正任务，或拖入时间轴手动安排。');return;}
  }
  remember();const b={id:S.nextId++,source:id,start:Math.max(0,Math.min(840-duration,start)),duration};S.blocks.push(b);S.selected=b.id;edited('已添加任务 #'+b.id+'。时间轴按 5 分钟吸附，表单可精确到分钟。');
}
function openMonth(id,year=S.year,month=S.month){
  S.monthSource=id;S.monthYear=year;S.monthIndex=month;S.monthSelected=`${year}-${String(month+1).padStart(2,'0')}-01`;
  S.monthConfig=S.route==='night'?nightConfig():{...S.config};
  renderMonth();if(!$('month-dialog').open)$('month-dialog').showModal();
}
function fluxDescription(s){if(!s.flux)return '流强未提供';if(s.flux.qualityFlag)return '目录流强异常值，未作为有效流强使用';return `流强 ${Number(s.flux.value).toPrecision(3)} ${s.flux.unit}${s.flux.energy?' · '+s.flux.energy:''}`;}
function renderMonth(){
  const s=source(S.monthSource),year=S.monthYear,month=S.monthIndex;
  $('month-title').textContent=s.name;
  $('month-coordinates').textContent=`${s.catalog} · ${statusNames[s.status]||'已发布'} · RA ${s.ra.toFixed(4)}° / Dec ${s.dec.toFixed(4)}°`;
  $('month-label').textContent=`${year} 年 ${month+1} 月 · ${S.monthConfig.mode}`;
  S.monthData=computeMonth(year,month+1,[s],S.monthConfig);
  $('month-days').innerHTML=S.monthData.days.map((date,i)=>`<button class="month-day ${date===S.monthSelected?'selected':''}" data-month-day="${date}" aria-label="${date} 可观测 ${S.monthData.daily[s.id][i].toFixed(1)} 小时"><strong>${Number(date.slice(8))} 日</strong><span>${S.monthData.daily[s.id][i].toFixed(1)} h</span><i style="--hours:${S.monthData.daily[s.id][i]}"></i></button>`).join('');
  const caption=S.monthConfig.mode==='LACT'?'按当日正午至次日正午统计；单夜工作台显示18:00–次日08:00。':'LHAASO按当地00:00–24:00统计；单夜工作台使用LACT日月条件。';
  $('month-caption').innerHTML=`本月 ${sum(S.monthData.daily[s.id]).toFixed(1)} h · ${caption}<br>${esc(fluxDescription(s))} · <a href="${esc(s.reference)}" target="_blank" rel="noopener">目录原始记录 ↗</a>`;
  $('month-prev').disabled=year===2000&&month===0;$('month-next').disabled=year===2100&&month===11;
}
function openSettings(){
  for(const el of $('settings-form').elements)if(el.name)el.value=S.config[el.name];
  $('settings-dialog').showModal();
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([type.startsWith('text/csv')?'\ufeff':'',text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function fullPlan(){return {...snapshot(),kind:'geometric_planning_not_controller_commands',revision:S.revision,createdAt:new Date().toISOString(),catalogRetrievedAt:S.meta.retrievedAt,resource:'LACT synchronized array / one pointing',tracking:{mode:'ICRS_SOURCE_CENTER',azimuth:'north=0 east=90 degrees',refraction:false,samplingMinutes:10},deviceValidation:'NOT_IMPLEMENTED',sources:[...new Set(S.blocks.map(b=>b.source))].map(id=>{const s=source(id);return {id,name:s.name,ra:s.ra,dec:s.dec,catalog:s.catalog,reference:s.reference};})};}
function taskRows(){return assessment.sorted.map(b=>({task:b.id,source_id:b.source,source:source(b.source).name,start_utc:M.utc(S.date,b.start,nightConfig()),end_utc_exclusive:M.utc(S.date,b.start+b.duration,nightConfig()),start_local:M.local(S.date,b.start,nightConfig()),end_local_exclusive:M.local(S.date,b.start+b.duration,nightConfig()),duration_min:b.duration,ra_icrs_deg:source(b.source).ra,dec_icrs_deg:source(b.source).dec,mode:'ICRS_SOURCE_CENTER'}));}
function openReview(){
  ensureNight();assessment=M.validate(S.night,S.blocks,nightConfig());if(!S.blocks.length||assessment.issues.length){toast('请先安排任务并解决所有冲突。');return;}
  $('review-confirm').checked=false;document.querySelectorAll('[data-export]').forEach(b=>b.disabled=true);
  $('review-content').innerHTML=`<p class="muted">${S.date} · ${timezoneLabel(S.config)} · LACT 同步阵列 · 草稿 v${S.revision}</p><div class="review-summary-grid"><div><span>观测任务</span><strong>${S.blocks.length}</strong></div><div><span>有效计划</span><strong>${hours(assessment.validMinutes)}</strong></div><div><span>指向采样</span><strong>10 min</strong></div></div><div class="table-scroll"><table class="task-table"><thead><tr><th>任务</th><th>观测源</th><th>开始</th><th>结束</th></tr></thead><tbody>${assessment.sorted.map(b=>`<tr><td>#${b.id}</td><td>${esc(source(b.source).name)}</td><td>${M.clock(b.start,nightConfig())}</td><td>${M.clock(b.start+b.duration,nightConfig())}</td></tr>`).join('')}</tbody></table></div>`;
  $('review-dialog').showModal();
}
function showAbout(){
  const quality=S.meta.quality||{};
  $('about-content').innerHTML=`<div class="provenance-block"><h3>目录快照</h3><p>更新日期：${esc(S.meta.retrievedAt?.slice(0,10))}。${S.sources.length} 条目录记录，默认显示 ${S.sources.filter(s=>s.defaultIncluded!==false).length} 条已发布记录。目录记录不等同于独立物理天体。</p><ul>${(S.meta.catalogs||[]).map(c=>`<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a>：${c.recordCount} 条${c.componentCount?'，保留 '+c.componentCount+' 个探测器分量':''}。</li>`).join('')}</ul><p>TeVCat 包含已确认、新发布、候选和有争议条目。1LHAASO 主坐标采用已探测分量中 TS 较高者；WCDA 与 KM2A 的分量位置和流强保留在数据文件。</p><h3>计算与时间口径</h3><p>Astronomy Engine 2.1.19；目录 J2000 方向包含岁差与章动变换，日月使用台站位置。高度角不含大气折射，方位角北0°、东90°。全年/逐日以10分钟中点积分，单夜以1分钟计算，边界附近结果受采样分辨率限制。</p><p>LACT 月度统计：当日正午到次日正午；LHAASO：当地00:00到24:00，仅使用天顶角条件。单夜工作台固定为 LACT，展示18:00到次日08:00。跨午夜按观测夜归属统计。使用固定UTC时差，无夏令时自动换算。</p><h3>流强与近邻</h3><p>流强必须结合单位、能段与测量口径使用。${quality.TeVCatMissingFlux||0} 条 TeVCat 流强缺失，不补零。Crab 单位的积分阈值也可能不同，排序仅供目录检索。邻近位置不自动认定为独立源，也不代替扩展源和背景区分析。</p><h3>此刻天空与亮星</h3><p>天顶为中心、地平线为外圈，北上东左。亮星使用全天 V≤8 的 Gaia DR3 / SIMBAD 目录，默认显示 V≤3；Gaia 合成 V 与测量 V 的来源在数据中逐条保留。计数为目录记录数，跨目录或恒星系统分量仍可能重叠。亮星仅用于环境检查，不自动改变观测窗口或估算触发噪声。</p><p>日出日落使用太阳中心 −0.833° 的标准地平线近似，不包括本站山体遮挡；实际暗夜窗采用设置中的太阳阈值。邻近天区默认半径 8°，含原 5° 参考圈及外围 3°；视场圈采用可修改的视场半径。LHAASO r39 实测值画实线、95% 上限画虚线。TeVCat 未统一定义的角尺度仅列数值，不假定为半径。</p><h3>计划保存与导出</h3><p>参数、优先级与草稿保存在当前浏览器本地。可下载JSON备份并重新导入。导入后始终按当前目录坐标重新检查；导出指向在每个任务中每10分钟采样，并保留结束半开边界。计划不包含天气、机械限位、转速、wobble或控制系统指令。</p><p><a href="https://github.com/Yun532/LACT-observation-plan" target="_blank" rel="noopener">查看源码、完整数据来源及可复现检查 ↗</a></p></div>`;
  $('about-dialog').showModal();
}
function bindEvents(){
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.close!==undefined){b.closest('dialog').close();return;}
    if(b.dataset.route){setRoute(b.dataset.route);return;}
    if(b.dataset.action==='settings'){openSettings();return;}
    if(b.dataset.action==='retry'){calculateAnnual();return;}
    if(b.dataset.action==='retry-stars'){loadStars();return;}
    if(b.dataset.view){S.view=b.dataset.view;renderOverview();return;}
    if(b.dataset.monthSort!==undefined){S.month=+b.dataset.monthSort;S.sort='month';$('sort').value=S.sort;S.page=0;renderOverview();return;}
    if(b.dataset.priority){const id=b.dataset.priority;S.priorities[id]=(priority(id)+1)%4;savePreferences();renderOverview();toast(`${source(id).name} · ${priority(id)?'优先级 '+priority(id):'取消重点标记'}`);return;}
    if(b.dataset.openMonth){openMonth(b.dataset.openMonth);return;}
    if(b.dataset.cellSource){S.month=+b.dataset.cellMonth;openMonth(b.dataset.cellSource);renderOverview();return;}
    if(b.dataset.focus){chooseFocus(b.dataset.focus);return;}
    if(b.dataset.overlay){chooseFocus(b.dataset.overlay,{overlay:true});return;}
    if(b.dataset.removeCurve){removeCurve(b.dataset.removeCurve);return;}
    if(b.dataset.pickerSource){const id=b.dataset.pickerSource;if(S.visible.includes(id))removeCurve(id);else chooseFocus(id,{overlay:true});renderNightPicker();return;}
    if(b.dataset.action==='retry-night-picker'){openNightPicker();return;}
    if(b.dataset.add){addTask(b.dataset.add);return;}
    if(b.dataset.selectTask){S.selected=+b.dataset.selectTask;const task=S.blocks.find(x=>x.id===S.selected);if(task)chooseFocus(task.source);return;}
    if(b.dataset.monthDay){S.monthSelected=b.dataset.monthDay;$('month-days').querySelectorAll('button').forEach(el=>el.classList.toggle('selected',el.dataset.monthDay===S.monthSelected));return;}
    if(b.dataset.searchSource){chooseFocus(b.dataset.searchSource);$('night-search').value='';$('night-search-results').hidden=true;return;}
    if(b.dataset.export&&$('review-confirm').checked){
      try { const type=b.dataset.export,name=`LACT-${S.date}-v${S.revision}`;
        if(type==='json')download(name+'.json',JSON.stringify({...fullPlan(),pointingSamples:M.pointingRows(S.night,S.sources,S.blocks,nightConfig())},null,2),'application/json');
        else download(name+(type==='tasks'?'-tasks.csv':'-pointing.csv'),M.csv(type==='tasks'?taskRows():M.pointingRows(S.night,S.sources,S.blocks,nightConfig())),'text/csv;charset=utf-8');
        toast('已导出几何规划文件。');
      }catch(error){toast(error.message);}return;
    }
  });
  $('settings-button').onclick=openSettings;$('about-button').onclick=showAbout;
  $('source-search').oninput=event=>{S.filter=event.target.value;S.page=0;renderOverview();};
  $('catalog-filter').onchange=event=>{S.catalog=event.target.value;S.page=0;renderOverview();};
  $('status-filter').onchange=event=>{S.status=event.target.value;S.page=0;renderOverview();};
  $('sort').onchange=event=>{S.sort=event.target.value;S.page=0;renderOverview();};
  $('prev-page').onclick=()=>{S.page=Math.max(0,S.page-1);renderOverview();};$('next-page').onclick=()=>{S.page++;renderOverview();};
  $('year').onchange=event=>{const year=Number(event.target.value);if(!Number.isInteger(year)||year<2000||year>2100){toast('年份范围为 2000–2100。');event.target.value=S.year;return;}S.year=year;S.page=0;calculateAnnual();};
  $('mode').onchange=event=>{S.config.mode=event.target.value;renderConditions();savePreferences();calculateAnnual();};
  $('night-date').onchange=event=>loadDate(event.target.value);
  const shiftDate=amount=>loadDate(new Date(Date.parse(S.date+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10));
  $('previous-night').onclick=()=>shiftDate(-1);$('next-night').onclick=()=>shiftDate(1);
  $('month-button').onclick=()=>openMonth(S.focus,+S.date.slice(0,4),+S.date.slice(5,7)-1);
  $('month-prev').onclick=()=>{const d=new Date(Date.UTC(S.monthYear,S.monthIndex-1,1));openMonth(S.monthSource,d.getUTCFullYear(),d.getUTCMonth());};
  $('month-next').onclick=()=>{const d=new Date(Date.UTC(S.monthYear,S.monthIndex+1,1));openMonth(S.monthSource,d.getUTCFullYear(),d.getUTCMonth());};
  $('month-open-night').onclick=()=>{$('month-dialog').close();loadDate(S.monthSelected);chooseFocus(S.monthSource);setRoute('night');window.scrollTo({top:0,behavior:'instant'});};
  $('add-focused').onclick=()=>addTask(S.focus);
  $('night-picker-button').onclick=openNightPicker;
  $('night-picker-search').oninput=renderNightPicker;
  for(const id of ['night-picker-catalog','night-picker-status','night-picker-available'])$(id).onchange=renderNightPicker;
  $('night-picker-dialog').onclose=()=>{nightPicker.worker?.terminate();nightPicker.worker=null;};
  $('night-picker-settings').onclick=()=>{$('night-picker-dialog').close();openSettings();};
  $('night-search').oninput=event=>{const query=event.target.value.trim();$('night-search-results').hidden=!query;if(!query)return;const found=S.sources.filter(s=>matchesSource(s,query)).slice(0,8);$('night-search-results').innerHTML=found.map(s=>`<button data-search-source="${esc(s.id)}"><span>${esc(s.name)}</span><small>${s.catalog}</small></button>`).join('')||'<p>没有匹配的源</p>';};
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.source-picker-label'))$('night-search-results').hidden=true;});
  $('cursor').oninput=event=>{S.cursor=+event.target.value;cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(drawNightCharts);};
  for(const [id,key] of [['show-stars','showStars'],['show-tracks','showTracks'],['show-extensions','showExtensions']])$(id).onchange=event=>{sky[key]=event.target.checked;savePreferences();drawNightCharts();};
  for(const [id,key] of [['star-limit','starLimit'],['sky-padding','skyPadding']])$(id).onchange=event=>{
    const value=Number(event.target.value);
    if(!event.target.value||!event.target.reportValidity()){event.target.value=S.config[key];return;}
    try{M.validateConfig({...S.config,[key]:value});S.config[key]=value;savePreferences();savePlan();drawNightCharts();}catch(error){toast(error.message);event.target.value=S.config[key];}
  };
  const skyHit=event=>{
    const r=$('site-sky').getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
    const hits=sky.hits.map(h=>({...h,distance:Math.hypot(h.x-x,h.y-y)})).filter(h=>h.distance<=Math.max(5,h.r+3));
    const rank=h=>h.kind==='source'&&h.distance<=h.r?(h.selected?0:1):2;
    return hits.sort((a,b)=>rank(a)-rank(b)||a.distance-b.distance)[0];
  };
  $('site-sky').onpointermove=event=>{const h=skyHit(event);$('site-sky').style.cursor=h?.kind==='source'?'pointer':'default';$('sky-hover').textContent=h?`${h.name}${h.kind==='star'?' · V '+h.mag.toFixed(2):''} · 高度 ${h.alt.toFixed(1)}° / 方位 ${h.az.toFixed(1)}°${h.kind==='source'?' · '+extensionText(source(h.id)):''}`:'悬停查看源名、V 星等和位置；点击源切换关注。';};
  $('site-sky').onclick=event=>{const h=skyHit(event);if(h?.kind==='source')chooseFocus(h.id);};
  $('neighbor-sky').onclick=event=>{const id=event.target.closest('[data-neighbor-source]')?.dataset.neighborSource;if(id)chooseFocus(id);};
  $('trajectory').onpointerdown=event=>{const rect=event.currentTarget.getBoundingClientRect(),left=Number(event.currentTarget.dataset.plotLeft)||65,right=Number(event.currentTarget.dataset.plotRight)||20;S.cursor=Math.max(0,Math.min(840,Math.round((event.clientX-rect.left-left)/(rect.width-left-right)*840)));drawNightCharts();};
  $('all-sky').onclick=event=>{const node=event.target.closest('[data-source]');if(node)chooseFocus(node.dataset.source,{open:true});};
  $('all-sky').onkeydown=event=>{const node=event.target.closest('[data-source]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();chooseFocus(node.dataset.source,{open:true});}};
  $('task-select').onchange=event=>{S.selected=+event.target.value;chooseFocus(S.blocks.find(b=>b.id===S.selected).source);};
  $('task-form').onsubmit=event=>{
    event.preventDefault();const b=S.blocks.find(b=>b.id===S.selected);if(!b||!event.target.reportValidity())return;
    const [hour,minute]=$('task-time').value.split(':').map(Number),start=hour*60+minute+Number($('task-day').value)*1440-1080,duration=Number($('task-duration').value);
    if(!Number.isInteger(start)||!Number.isInteger(duration)||start<0||duration<=0||start+duration>840){toast('任务需位于当日18:00至次日08:00内，请核对日期和时长。');return;}
    remember();b.source=$('task-source').value;b.start=start;b.duration=duration;S.focus=b.source;if(!S.visible.includes(b.source))S.visible=[...S.visible.slice(0,5),b.source];edited('任务已更新，已重新检查整段观测条件。');
  };
  $('delete-task').onclick=()=>{if(S.selected===null)return;remember();S.blocks=S.blocks.filter(b=>b.id!==S.selected);S.selected=null;edited('任务已删除，可撤销。');};
  $('undo').onclick=()=>{const old=S.history.pop();if(!old)return;Object.assign(S,JSON.parse(old));edited('已撤销最近一次修改。');};
  $('settings-form').onsubmit=event=>{
    event.preventDefault();if(!event.target.reportValidity())return;
    try {const fields=Object.fromEntries(new FormData(event.target));const next={...S.config,...Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,key==='moonMode'?value:Number(value)]))};S.config={...M.validateConfig(next),defaultDuration:next.defaultDuration};S.config.startHour=18;savePreferences();renderConditions();invalidateNight();S.revision++;savePlan();$('settings-dialog').close();calculateAnnual();if(S.route==='night')renderNight();toast('条件已更新；任务保留原时刻并重新检查。');}catch(error){toast(error.message);}
  };
  $('reset-settings').onclick=()=>{for(const el of $('settings-form').elements)if(el.name)el.value=PRESET[el.name];};
  $('review-plan').onclick=openReview;$('review-confirm').onchange=event=>document.querySelectorAll('[data-export]').forEach(b=>b.disabled=!event.target.checked);
  $('save-draft').onclick=()=>download(`LACT-${S.date}-draft.json`,JSON.stringify(fullPlan(),null,2),'application/json');
  $('import-plan').onclick=()=>$('plan-file').click();
  $('plan-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    try {if(file.size>2000000)throw new Error('计划文件不能超过 2 MB');const plan=M.restorePlan(await file.text(),S.sources);if(plan.config.startHour!==18)throw new Error('本站单夜工作台仅支持18:00起始的计划');if(+plan.date.slice(0,4)<2000||+plan.date.slice(0,4)>2100)throw new Error('计划年份需在2000–2100范围内');savePlan();Object.assign(S,{date:plan.date,blocks:plan.blocks,focus:plan.focus,visible:plan.visible.slice(0,6),config:{...plan.config,mode:S.config.mode,defaultDuration:S.config.defaultDuration},history:[],revision:1,selected:plan.blocks[0]?.id??null,nextId:Math.max(0,...plan.blocks.map(b=>b.id))+1});if(!S.visible.includes(S.focus))S.visible=[S.focus,...S.visible].slice(0,6);invalidateNight();savePreferences();savePlan();renderConditions();calculateAnnual();setRoute('night');toast('计划已导入并按当前目录重新检查。');}catch(error){toast('导入失败：'+error.message);}event.target.value='';
  };
  const track=$('schedule-track');
  $('candidates').ondragstart=event=>{const el=event.target.closest('[data-drag-source]');if(!el)return;event.dataTransfer.setData('text/plain',el.dataset.dragSource);event.dataTransfer.effectAllowed='copy';};
  track.ondragover=event=>{event.preventDefault();track.classList.add('drop-over');};track.ondragleave=()=>track.classList.remove('drop-over');
  track.ondrop=event=>{event.preventDefault();track.classList.remove('drop-over');const id=event.dataTransfer.getData('text/plain');if(!source(id))return;const rect=track.getBoundingClientRect();addTask(id,Math.round((event.clientX-rect.left)/rect.width*840/5)*5);};
  track.onpointerdown=event=>{const element=event.target.closest('[data-block]');if(!element)return;const b=S.blocks.find(b=>b.id===+element.dataset.block);drag={id:b.id,x:event.clientX,start:b.start,duration:b.duration,mode:event.target.dataset.resize||'move',moved:false,element};track.setPointerCapture(event.pointerId);event.preventDefault();};
  track.onpointermove=event=>{if(!drag)return;const delta=Math.round((event.clientX-drag.x)/track.getBoundingClientRect().width*840/5)*5;if(!delta&&!drag.moved)return;drag.moved=true;let start=drag.start,duration=drag.duration;if(drag.mode==='move')start=Math.max(0,Math.min(840-duration,start+delta));if(drag.mode==='left'){start=Math.max(0,Math.min(start+duration-5,start+delta));duration=drag.start+drag.duration-start;}if(drag.mode==='right')duration=Math.max(5,Math.min(840-start,duration+delta));drag.next={start,duration};drag.element.style.left=start/840*100+'%';drag.element.style.width=duration/840*100+'%';$('schedule-message').textContent=`#${drag.id} → ${M.clock(start,nightConfig())} — ${M.clock(start+duration,nightConfig())}`;};
  track.onpointerup=()=>{if(!drag)return;const d=drag;drag=null;const b=S.blocks.find(b=>b.id===d.id);if(d.moved&&d.next){remember();Object.assign(b,d.next);S.selected=b.id;S.focus=b.source;if(!S.visible.includes(b.source))S.visible=[...S.visible.slice(0,5),b.source];edited('任务时段已调整，所有冲突已重新检查。');}else{S.selected=b.id;chooseFocus(b.source);}};
  track.onpointercancel=()=>{drag=null;renderNight();};
  window.addEventListener('resize',()=>{cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{if(S.route==='night')drawNightCharts();else if(S.view==='sky')renderAllSky($('all-sky'),filteredSources(),S.focus);});});
  window.addEventListener('hashchange',()=>setRoute(location.hash==='#night'?'night':'overview'));
}
async function boot(){
  try {
    const response=await fetch(new URL('data/sources.json',document.baseURI));if(!response.ok)throw new Error('源表载入失败（'+response.status+'）');
    const catalog=await response.json();if(!Array.isArray(catalog.sources)||!catalog.sources.length)throw new Error('源表为空');
    S.sources=catalog.sources;S.meta=catalog.meta;S.byId=new Map(S.sources.map(s=>[s.id,s]));
    S.focus=source('tevcat-87')?'tevcat-87':S.sources[0].id;S.visible=[S.focus,...['tevcat-424','tevcat-74'].filter(id=>source(id)&&id!==S.focus)];
    if(plans[S.date]){try{const plan=M.restorePlan(plans[S.date],S.sources);restoreSnapshot(plan);S.revision=Number(plans[S.date].revision)||1;}catch{ /* Ignore malformed saved drafts so the app remains usable. */ }}
    S.selected=S.blocks[0]?.id??null;S.nextId=Math.max(0,...S.blocks.map(b=>b.id))+1;
    $('catalog-foot').textContent=`TeVCat × 1LHAASO · ${S.sources.length} 条记录 · ${S.meta.retrievedAt.slice(0,10)}`;
    bindEvents();renderConditions();$('boot').hidden=true;setRoute(location.hash==='#night'?'night':'overview');calculateAnnual();
  }catch(error){$('boot').innerHTML='<h1>暂时无法打开观测源表</h1><p>'+esc(error.message)+'</p><button class="primary-button" id="reload-app">重新载入</button>';$('reload-app').onclick=()=>location.reload();}
}
boot();
