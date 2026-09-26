import './style.css';
import './atlas.css';
import './source-info.css';
import './fermi-explorer.css';
import { renderSourceInfo, sourceSummary } from './source-info.js';
import { createFermiExplorer } from './fermi-explorer.js';
import { computeNight, computeMonth, skyAt, DEFAULTS } from './astronomy.js';
import M from './planning.mjs';
import { matchesSource } from './source-search.js';
import { COLORS, renderTrajectory, renderAllSky, separation } from './charts.js';
import { renderSiteSky, projectHorizontal } from './sky-chart.js';
import { bindSkyNavigation, limitSkyView, zoomSkyView, skyHitsAt } from './sky-navigation.js';
import { renderAtlas, projectAtlas, unprojectAtlas, equatorialToGalactic, limitAtlasView, reachDeclinationRange } from './atlas-chart.js';
import { renderNeighborField, neighborEntries, neighborhoodRadius, extensionText } from './neighbor-chart.js';
import { parsePrivateCatalog, PRIVATE_CATALOG_LIMITS } from './private-catalog.js';
import { catalogFingerprint, localCatalog, combineCatalogs, checkPlanCatalogIdentity, PRIVATE_PLAN_PREFIX, PRIVATE_PRIORITY_PREFIX } from './local-catalog-store.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hours = minutes => (minutes / 60).toFixed(2) + ' h';
const sum = values => values.reduce((a,b) => a+b, 0);
const timezoneLabel = c => 'UTC' + (c.timezone >= 0 ? '+' : '') + c.timezone;
const today = c => new Date(Date.now() + c.timezone * 3600000).toISOString().slice(0,10);
const statusNames = {established:'已确认',newly_announced:'新发布',disputed:'有争议',candidate:'候选',private:'本地私有'};
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
let publicCatalog=null,privateCatalog=null,privateFingerprint='',catalogRemembered=false,catalogBusy=false;
const CLEAR_PRIVATE_KEY='lact.private.clear.v1';
const clearEpoch=()=>{try{return Number(localStorage.getItem(CLEAR_PRIVATE_KEY))||0;}catch{return 0;}};
let privateEpoch=clearEpoch();
const nightPicker = {key:'',rows:null,worker:null,error:''};
const sky = {stars:[],meta:null,loading:false,error:'',positions:null,key:'',hits:[],view:{zoom:1,x:0,y:0},viewport:null,showStars:saved.sky?.showStars!==false,showNeighborStars:(saved.sky?.showNeighborStars??saved.sky?.showStars)!==false,showTracks:saved.sky?.showTracks!==false,showExtensions:saved.sky?.showExtensions!==false};
const atlas = {mode:'atlas',frame:'equatorial',colorBy:'catalog',showGrid:true,showPlane:true,showReach:true,showFov:true,showLabels:false,view:{zoom:1,x:0,y:0},inspected:'',limit:12,result:null,expanded:false};
const source = id => S.byId.get(id);
const nightConfig = () => ({...S.config,mode:'LACT',startHour:18});
const color = id => S.visible.includes(id) ? COLORS[S.visible.indexOf(id) % COLORS.length] : '#8793a7';
const priority = id => [1,2,3].includes(S.priorities[id]) ? S.priorities[id] : 0;
const label = s => s.name;
const short = s => s.name.replace(/^[12]LHAASO\s|^LHAASO\s|^TeV\s/g,'');
const isFermiId=id=>typeof id==='string'&&id.startsWith('fermi:4fgl:');
const fermiIds=new Set(Array.isArray(saved.fermiIds)?saved.fermiIds.filter(isFermiId):[]);
let fermiRecoveryPending=false;
const sourceFrame=s=>s.private||String(s.coordinateFrame).startsWith('FK5')?'FK5 / J2000':'ICRS';
const planFermiIds=p=>[p?.focus,...(Array.isArray(p?.visible)?p.visible:[]),...(Array.isArray(p?.blocks)?p.blocks.map(b=>b?.source):[])].filter(isFermiId);
const fermi=createFermiExplorer({getContext:()=>({config:S.config,selectedIds:[...fermiIds],focus:source(S.focus)}),onAdd:addFermiSource,onRemove:removeFermiSource,onInspect:sourceDetails});
async function openFermiLibrary(){
  await fermi.open();
  if(fermiRecoveryPending&&fermi.meta){
    activateCatalog(privateCatalog,privateFingerprint,catalogRemembered,{discard:true,recovered:true});
    toast('Fermi 源库已恢复，原有源选择与草稿已重新载入。');
  }
}
function savedPlanSets(){
  try{return Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k===PLAN_KEY||k?.startsWith(PRIVATE_PLAN_PREFIX)).map(readLocalObject);}catch{return [plans];}
}
function rebuildWorkingCatalog(){
  const base=combineCatalogs(publicCatalog,privateCatalog),extra=[...fermiIds].map(id=>fermi.getById(id)).filter(Boolean);
  S.sources=[...base.sources,...extra];S.byId=new Map(S.sources.map(s=>[s.id,s]));
  S.meta={...base.meta,catalogs:[...(base.meta.catalogs||[]),...(extra.length?[{id:'4FGL-DR4',label:'Fermi 4FGL-DR4 · 已选观测源',recordCount:extra.length,url:'https://fermi.gsfc.nasa.gov/ssc/data/access/lat/14yr_catalog/'}]:[])]};
}
function refreshFermiSelection(){
  rebuildWorkingCatalog();savePreferences();invalidateNight();sky.key='';
  nightPicker.worker?.terminate();Object.assign(nightPicker,{key:'',rows:null,worker:null,error:''});
  S.visible=S.visible.filter(id=>source(id));
  if(!source(S.focus))S.focus=S.visible[0]||S.sources[0].id;
  if(!S.visible.includes(S.focus))S.visible=[S.focus,...S.visible].slice(0,6);
  if(!S.sources.some(s=>s.catalog===S.catalog))S.catalog='all';
  renderCatalogState();calculateAnnual();if(S.route==='night')renderNight();
}
async function addFermiSource(id,{openNight=false}={}){
  const item=fermi.getById(id);if(!item)return false;
  if(!fermiIds.has(id)){fermiIds.add(id);refreshFermiSelection();toast('已加入观测源，可查看全年窗口与单夜轨迹。');}
  if(openNight)chooseFocus(id,{open:true});
  return true;
}
function removeFermiSource(id){
  if(S.blocks.some(b=>b.source===id)||savedPlanSets().some(set=>Object.values(set).some(p=>Array.isArray(p?.blocks)&&p.blocks.some(b=>b?.source===id)))){toast('这个源仍被观测任务使用；先移除相关任务并保存草稿，再从源库移除。');return false;}
  fermiIds.delete(id);S.history=S.history.filter(entry=>!planFermiIds(JSON.parse(entry)).includes(id));
  refreshFermiSelection();savePlan();return true;
}
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function safeStore(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch { if(!storageWarned){toast('浏览器无法保存本地草稿，请使用“保存草稿”下载计划。');storageWarned=true;} } }
function savePreferences(){
  if(privateCatalog){if(privateEpoch===clearEpoch())safeStore(PRIVATE_PRIORITY_PREFIX+privateFingerprint,S.priorities);}else saved.priorities=S.priorities;
  safeStore(SETTINGS_KEY,{config:S.config,fermiIds:[...fermiIds],priorities:saved.priorities||{},sky:{showStars:sky.showStars,showNeighborStars:sky.showNeighborStars,showTracks:sky.showTracks,showExtensions:sky.showExtensions}});
}
function snapshot(){return {version:1,date:S.date,catalogIdentity:privateCatalog?{private:true,fingerprint:privateFingerprint}:{private:false},config:nightConfig(),blocks:S.blocks.map(b=>({...b})),focus:S.focus,visible:[...S.visible]};}
function savePlan(){if(fermiRecoveryPending||!S.sources.length||(privateCatalog&&privateEpoch!==clearEpoch()))return;plans[S.date]={...snapshot(),revision:S.revision};safeStore(privateCatalog?PRIVATE_PLAN_PREFIX+privateFingerprint:PLAN_KEY,plans);}
function restoreCatalogPlan(payload){
  if(typeof payload==='string'){if(payload.length>2_000_000)throw new Error('计划文件过大');payload=JSON.parse(payload);}
  checkPlanCatalogIdentity(payload,privateCatalog?privateFingerprint:'');
  const restored=M.restorePlan(payload,[...S.sources,...fermi.sources]);
  if(restored.config.startHour!==18)throw new Error('本站单夜工作台仅支持18:00起始的计划');
  if(+restored.date.slice(0,4)<2000||+restored.date.slice(0,4)>2100)throw new Error('计划年份需在2000–2100范围内');
  for(const id of planFermiIds(restored))fermiIds.add(id);
  rebuildWorkingCatalog();return restored;
}
function remember(){S.history.push(JSON.stringify({blocks:S.blocks,selected:S.selected,visible:S.visible,focus:S.focus}));if(S.history.length>40)S.history.shift();}
function edited(message){S.revision++;savePlan();renderNight();if(message)$('schedule-message').textContent=message;}
function invalidateNight(){S.night=null;S.nightKey='';}
function conditions(c){return c.mode==='LHAASO' ? `LHAASO · z ≤ ${c.zmax}° · 全天过境，不应用日月限制` : `LACT · z ≤ ${c.zmax}° · 太阳 < ${c.sun}° · 月距 ${c.moon}°${c.moonMode==='warn'?'（仅提示）':c.moonMode==='up'?'（月在地平线上）':''}`;}
function readLocalObject(key){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function renderCatalogState(){
  const active=!!privateCatalog;
  $('catalog-state').textContent=(active?'本地私有 · TeVCat + 2LHAASO':'公开目录 · TeVCat + 1LHAASO')+(fermiRecoveryPending?' · Fermi 待重试':fermiIds.size?` + Fermi × ${fermiIds.size}`:'');
  $('catalog-bar').classList.toggle('is-private',active);
  $('catalog-summary').textContent=active?`已使用本地二期源表，${catalogRemembered?'此设备已记住目录':'仅本次打开有效'}。原始文件和解析数据均不上传。`:'当前使用随网站发布的公开源表。导入私有源表后，仅在本机替换 1LHAASO。';
  $('catalog-notes').hidden=!active;
  $('catalog-notes-list').innerHTML=active?[...(privateCatalog.meta.warnings||[]),...(privateCatalog.meta.notes||[])].map(note=>'<li>'+esc(note)+'</li>').join(''):'';
  $('catalog-revert').disabled=!active;$('catalog-remember').checked=catalogRemembered||!active;
  $('catalog-foot').textContent=`TeVCat × ${active?'2LHAASO · 本地私有':'1LHAASO'}${fermiIds.size?' × Fermi（已选）':''} · ${S.sources.length} 条记录`;
  document.querySelectorAll('[data-open-fermi]').forEach(b=>b.textContent=`Fermi 扩展源库${fermiIds.size?' · 已选 '+fermiIds.size:''}`);
  $('fermi-load-status').hidden=!fermiRecoveryPending;
  for(const id of ['catalog-filter','night-picker-catalog']){const old=$(id).value;$(id).innerHTML='<option value="all">全部目录</option>'+[...new Set(S.sources.map(s=>s.catalog))].map(c=>`<option value="${esc(c)}">${esc(c)}${c==='2LHAASO'?' · 本地':''}</option>`).join('');$(id).value=[...$(id).options].some(o=>o.value===old)?old:'all';}
  $('catalog-filter').value=S.catalog;
  for(const id of ['status-filter','night-picker-status'])$(id).querySelector('[value="published"]').textContent=active?'默认源（含本地）':'已发布源';
  $('private-export-note').hidden=!active;
}
function activateCatalog(catalog,fingerprint='',remembered=false,{initial=false,discard=false,recovered=false}={}){
  if(!initial){clearTimeout(toastTimer);$('toast').textContent='';$('toast').hidden=true;}
  if(!initial&&!discard){savePlan();savePreferences();}
  if(recovered)fermiRecoveryPending=false;
  S.worker?.terminate();nightPicker.worker?.terminate();S.computeId++;cancelAnimationFrame(renderFrame);
  privateCatalog=catalog;privateFingerprint=fingerprint;catalogRemembered=remembered;privateEpoch=clearEpoch();
  rebuildWorkingCatalog();
  plans=readLocalObject(catalog?PRIVATE_PLAN_PREFIX+fingerprint:PLAN_KEY);
  S.priorities=catalog?readLocalObject(PRIVATE_PRIORITY_PREFIX+fingerprint):(saved.priorities||{});
  Object.assign(S,{annual:null,worker:null,blocks:[],selected:null,nextId:1,revision:1,history:[],filter:'',catalog:'all',page:0,monthData:null,monthSource:''});
  S.focus=source('tevcat-87')?'tevcat-87':S.sources[0].id;S.visible=[S.focus,...['tevcat-424','tevcat-74'].filter(id=>source(id)&&id!==S.focus)];
  if(plans[S.date]&&!fermiRecoveryPending){try{restoreSnapshot(restoreCatalogPlan(plans[S.date]));S.revision=Number(plans[S.date].revision)||1;}catch{toast('此目录下的草稿无法恢复；已保留原草稿并打开空计划。');}}
  S.selected=S.blocks[0]?.id??null;S.nextId=Math.max(0,...S.blocks.map(b=>b.id))+1;
  invalidateNight();Object.assign(nightPicker,{key:'',rows:null,worker:null,error:''});Object.assign(sky,{key:'',positions:null,hits:[]});drag=null;assessment=null;
  for(const id of ['month-dialog','review-dialog','night-picker-dialog','about-dialog','source-dialog']){const dialog=$(id);if(dialog.open)dialog.close();}
  $('night-search-results').hidden=true;$('night-search-results').innerHTML='';$('night-search').value='';$('source-search').value='';$('night-picker-search').value='';
  $('source-details').innerHTML='';$('month-days').innerHTML='';$('review-content').innerHTML='';$('about-content').innerHTML='';$('sky-hover').textContent='悬停查看源名、V 星等和位置；点击源切换关注。';
  $('sky-picks').replaceChildren();$('sky-picks').hidden=true;
  atlas.inspected='';atlas.result=null;
  for(const id of ['atlas-detail','atlas-source-list','atlas-picks','atlas-sky'])$(id).replaceChildren();
  $('atlas-picks').hidden=true;$('atlas-readout').textContent='悬停查看坐标与源信息；点击源进入单夜工作台。';
  for(const id of ['source-title','month-title','month-coordinates','month-caption','night-picker-list','night-picker-selected','all-sky'])$(id).replaceChildren();
  $('review-confirm').checked=false;document.querySelectorAll('[data-export]').forEach(b=>b.disabled=true);
  fermi.refresh();renderCatalogState();renderConditions();
  if(!initial){const route=S.route;S.route='night';renderNight();S.route=route;setRoute(route);calculateAnnual();}
}
async function importLocalCatalog(file){
  if(catalogBusy||!file)return;catalogBusy=true;$('catalog-choose').disabled=true;$('catalog-message').textContent='正在本机解析源表…';
  try{
    const startedEpoch=clearEpoch();
    if(file.size>PRIVATE_CATALOG_LIMITS.bytes)throw new Error('源表不能超过 2 MiB');
    const text=await file.text(),parsed=parsePrivateCatalog(text,file.name),fingerprint=await catalogFingerprint(text);
    if(startedEpoch!==clearEpoch())throw new Error('另一页面已清除私有数据，请重新选择文件');
    if(Object.values(readLocalObject(PRIVATE_PLAN_PREFIX+fingerprint)).some(p=>planFermiIds(p).length))await fermi.load();
    let remembered=$('catalog-remember').checked;
    try{await localCatalog(remembered?'write':'remove',remembered?{text,filename:file.name,savedAt:Math.max(Date.now(),startedEpoch+1)}:undefined);}catch{remembered=false;throw new Error('无法更新本机存储，源表尚未切换。请检查浏览器存储权限。');}
    if(startedEpoch!==clearEpoch()){await localCatalog('remove');throw new Error('另一页面已清除私有数据，请重新选择文件');}
    activateCatalog(parsed,fingerprint,remembered);
    $('catalog-message').textContent='已启用二期源表。全年窗口正在重新计算；公开与私有计划分别保存。'+(parsed.meta.warnings?.length?' '+parsed.meta.warnings.join(' '):'');
  }catch(error){$('catalog-message').textContent=error.message||'本地源表无法读取';}
  finally{catalogBusy=false;$('catalog-choose').disabled=false;$('catalog-file').value='';}
}
function sourceDetails(id){
  const s=source(id)||fermi.getById(id);if(!s)return;
  $('source-title').textContent=s.name;
  $('source-details').innerHTML=renderSourceInfo(s);
  $('source-dialog').showModal();
}
function renderConditions(){
  $('conditions-summary').textContent=conditions(S.config);
  $('night-conditions').textContent=conditions(nightConfig())+' · 18:00 — 次日08:00';
  $('site-label').textContent=(Math.abs(S.config.latitude-PRESET.latitude)<1e-6&&Math.abs(S.config.longitude-PRESET.longitude)<1e-6?'稻城':'自定义站址')+' · '+timezoneLabel(S.config);
  $('mode').value=S.config.mode;
  $('year').value=S.year;
}
function setRoute(route){
  if(route==='night'&&fermiRecoveryPending){route='overview';toast('Fermi 源库暂未载入。为保留原有草稿，请先打开“Fermi 扩展源库”重试，再进行排班。');}
  if(atlas.expanded&&route==='night')expandAtlas(false);
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
    const monthly=S.annual?.monthly[s.id],p=priority(s.id),recordStatus=['candidate','disputed','private'].includes(s.status)?' · '+statusNames[s.status]:'';
    return `<tr><td><div class="source-name-cell"><button class="priority-button ${p?'marked':''}" data-priority="${esc(s.id)}" aria-label="${esc(s.name)} 优先级 ${p}，点击切换">${p?'★':'☆'}${p>1?'<small style="font-size:9px">'+p+'</small>':''}</button><button class="source-name" data-open-month="${esc(s.id)}"><strong>${esc(s.name)}</strong><span>${esc(s.catalog)} · ${esc(s.type||'未分类')}${recordStatus}</span></button><button class="source-info-shortcut" data-atlas-info="${esc(s.id)}" aria-label="查看 ${esc(s.name)} 的源表信息" title="源表信息">ⓘ</button></div></td>`+Array.from({length:12},(_,m)=>`<td>${monthly?`<button class="heat-cell ${monthly[m]<.05?'zero':''} ${s.id===S.focus&&m===S.month?'selected':''}" data-cell-source="${esc(s.id)}" data-cell-month="${m}" style="--v:${Math.min(240,monthly[m]/maximum*240).toFixed(1)}" aria-label="${esc(s.name)} ${m+1}月，可观测 ${monthly[m].toFixed(1)} 小时">${monthly[m]<.05?'·':Math.round(monthly[m])}</button>`:'<span class="skeleton-number" aria-label="计算中"></span>'}</td>`).join('')+`<td class="year-total">${monthly?Math.round(sum(monthly)):'—'}</td></tr>`;
  }).join('')||'<tr><td colspan="14"><div class="empty-state">没有匹配的源。试试缩短关键词或调整筛选。</div></td></tr>';
  $('table-summary').textContent=items.length?`${S.page*S.perPage+1}–${Math.min(items.length,(S.page+1)*S.perPage)} / ${items.length} 条 · 点击月份查看逐夜窗口`:'0 条匹配记录';
  $('page-number').textContent=`${S.page+1} / ${pages}`;$('prev-page').disabled=S.page===0;$('next-page').disabled=S.page===pages-1;
  $('flux-note').hidden=S.sort!=='flux';$('table-view').hidden=S.view!=='table';$('sky-view').hidden=S.view!=='sky';
  $('table-title').textContent=S.view==='sky'?'目录源的天空位置':'月度可观测时间';
  document.querySelector('.heat-legend').hidden=S.view==='sky';document.querySelector('.pagination').hidden=S.view==='sky';
  if(S.view==='sky')$('table-summary').textContent=`${items.length} 条筛选记录 · 目录条目保留独立身份，近邻不合并`;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
  if(S.view==='sky')renderAtlasView(items);
}
function drawAtlasMap(items=filteredSources()){
  const focusedSource=$('atlas-sky').contains(document.activeElement)?document.activeElement.dataset.source:null;
  if($('atlas-sky').contains(document.activeElement)&&document.activeElement!==$('atlas-sky'))$('atlas-sky').focus({preventScroll:true});
  const classic=atlas.mode==='classic';
  $('all-sky').toggleAttribute('hidden',!classic);$('atlas-sky').toggleAttribute('hidden',classic);
  document.querySelectorAll('.atlas-enhanced-control').forEach(el=>el.hidden=classic);
  if(classic)renderAllSky($('all-sky'),items,atlas.inspected);
  else atlas.result=renderAtlas($('atlas-sky'),items,atlas.inspected,{...atlas,month:S.month,monthly:S.annual?.monthly,config:S.config});
  if(focusedSource===atlas.inspected&&!classic)$('atlas-sky').querySelector(`[data-source="${CSS.escape(focusedSource)}"]`)?.focus({preventScroll:true});
  $('atlas-zoom-value').textContent=atlas.view.zoom.toFixed(1)+'×';
  $('atlas-zoom-in').disabled=atlas.view.zoom>=12;$('atlas-zoom-out').disabled=atlas.view.zoom<=1;
  $('atlas-empty').hidden=items.length>0;
  $('atlas-hint').textContent=classic?'经典 1.0 · 目录赤道坐标，赤经向左增加；等距经纬图，不表示等立体角。点击源进入单夜工作台。':'Mollweide 等面积投影 · 滚轮 / 双指缩放，放大后拖动 · + / − 与方向键可操作，Home 复位。';
  $('atlas-science-note').hidden=classic;
  const range=reachDeclinationRange(S.config),signed=n=>(n>=0?'+':'')+n.toFixed(2)+'°';
  $('atlas-reach-range').textContent=range?`可达赤纬 ${signed(range.min)} 至 ${signed(range.max)}`:'';
  $('atlas-reach-explanation').textContent=`浅绿色区域表示天体在上中天（一天中位置最高）时能满足天顶角限制的天区；虚线是它的边界。最低天顶角 z = |赤纬 − 台站纬度|。当前台站纬度 ${signed(S.config.latitude)}，天顶角上限 ${S.config.zmax}°；区域覆盖上述赤纬范围内的全部赤经，并非此刻同时可见的天空。`;
  $('atlas-fov-radius').value=S.config.fov;
  $('atlas-fov-size').textContent=`直径 ${+(S.config.fov*2).toFixed(3)}° · 与单夜视场共用设置`;
  $('atlas-center-fov').disabled=!source(atlas.inspected);
  $('atlas-legend').innerHTML=atlas.colorBy==='month'&&!classic?'<span>月度可观测 / h</span><span>0</span><i class="atlas-hours-scale"></i><span>≥ 240</span><span class="atlas-missing-key">灰色：待计算</span>':'<span><i class="atlas-key tev"></i>TeVCat</span><span><i class="atlas-key lhaaso"></i>LHAASO</span><span><i class="atlas-key fermi"></i>Fermi（已选）</span><span class="atlas-missing-key">圆点表示目录位置</span>';
}
function renderAtlasDetail(){
  const s=source(atlas.inspected);
  if(!s){$('atlas-detail').innerHTML='<span class="eyebrow">SOURCE INSPECTOR</span><h3>选择一个天区目标</h3><p>源列表与上方搜索、目录筛选和排序同步。</p>';return;}
  const monthly=S.annual?.monthly[s.id],g=equatorialToGalactic(s.ra,s.dec),max=Math.max(1,...(monthly||[]));
  $('atlas-detail').innerHTML=`<div class="atlas-detail-top"><span class="eyebrow">SOURCE INSPECTOR</span><span class="atlas-catalog-tag">${esc(s.catalog)}${s.private?' · 本地':''}</span></div><h3>${esc(s.name)}</h3><p>${esc(s.type||'未分类')}${priority(s.id)?' · '+'★'.repeat(priority(s.id)):''}</p><dl class="atlas-coordinates"><div><dt>RA / Dec</dt><dd>${s.ra.toFixed(3)}° / ${s.dec.toFixed(3)}°</dd></div><div><dt>l / b</dt><dd>${g.l.toFixed(3)}° / ${g.b.toFixed(3)}°</dd></div></dl><div class="atlas-window-values"><div><span>${S.year} 年 ${S.month+1} 月</span><strong>${monthly?monthly[S.month].toFixed(1):'—'}<small> h</small></strong></div><div><span>全年可用</span><strong>${monthly?Math.round(sum(monthly)):'—'}<small> h</small></strong></div></div><div class="atlas-month-bars" aria-label="该源十二个月可观测时长">${Array.from({length:12},(_,m)=>`<button type="button" data-cell-source="${esc(s.id)}" data-cell-month="${m}" aria-label="${esc(s.name)} ${m+1}月 ${monthly?monthly[m].toFixed(1)+'小时':'待计算'}，查看逐夜窗口" title="${m+1}月 · ${monthly?monthly[m].toFixed(1)+' h':'待计算'}"><span style="height:${monthly?Math.max(2,monthly[m]/max*40):2}px" class="${m===S.month?'selected':''}"></span><small>${m+1}</small></button>`).join('')}</div><div class="atlas-detail-actions"><button type="button" class="primary-button" data-atlas-open="${esc(s.id)}">单夜规划 →</button><button type="button" class="text-button" data-atlas-info="${esc(s.id)}">源表信息</button></div><p class="atlas-note">${sourceFrame(s)} · 目录坐标；时长使用当前观测条件。</p>`;
  $('atlas-detail').querySelector('.atlas-coordinates').insertAdjacentHTML('beforebegin',`<p class="atlas-source-context">${esc(sourceSummary(s))}</p>`);
  if(atlas.mode==='atlas'&&atlas.showFov){
    const inside=S.sources.map(item=>({item,distance:separation(s,item)})).filter(entry=>entry.distance<=S.config.fov+1e-9).sort((a,b)=>a.distance-b.distance);
    $('atlas-detail').insertAdjacentHTML('beforeend',`<div class="atlas-field-summary"><strong><i class="atlas-region-key fov"></i> 当前预览源的视场</strong><span>半径 ${S.config.fov}° · 直径 ${+(2*S.config.fov).toFixed(3)}°</span><details><summary>包含 ${inside.length} 条目录记录 · 查看</summary><div class="atlas-field-sources">${inside.map(({item,distance})=>`<button type="button" data-atlas-info="${esc(item.id)}" title="查看 ${esc(item.name)} · ${esc(item.catalog)}；距视场中心 ${distance.toFixed(2)}°"><span>${esc(item.name)}</span><small>${distance.toFixed(2)}°</small></button>`).join('')}</div></details><p>按全部已载入目录的源中心判断，含当前源；跨目录可能重复。延展源不一定完全落在视场内。</p></div>`);
  }
}
function renderAtlasView(items=filteredSources()){
  $('atlas-search').value=S.filter;
  if(!items.some(s=>s.id===atlas.inspected)){
    atlas.inspected=items.find(s=>s.id===S.focus)?.id||items[0]?.id||'';
    atlas.view=items.length===1?{zoom:4,...projectAtlas(items[0].ra,items[0].dec,atlas.frame)}:{zoom:1,x:0,y:0};
  }
  $('atlas-month').value=S.month;$('atlas-picks').hidden=true;
  drawAtlasMap(items);renderAtlasDetail();
  const sortLabel=$('sort').selectedOptions[0].textContent;
  $('atlas-list-caption').textContent=sortLabel;
  $('atlas-source-list').innerHTML=items.slice(0,atlas.limit).map((s,i)=>{
    const monthly=S.annual?.monthly[s.id],value=S.sort==='year'?monthly?Math.round(sum(monthly))+' h':'—':S.sort==='priority'?priority(s.id)?'★'.repeat(priority(s.id)):'未标记':S.sort==='flux'?s.catalog==='TeVCat'&&s.flux?.unit==='Crab'&&s.flux.value>0?s.flux.value+' Crab':'—':monthly?monthly[S.month].toFixed(1)+' h':'—';
    return `<button type="button" class="atlas-list-row ${s.id===atlas.inspected?'selected':''}" data-atlas-locate="${esc(s.id)}" title="在天图定位 ${esc(s.name)}"><span class="atlas-rank">${String(i+1).padStart(2,'0')}</span><span class="atlas-list-name"><strong>${esc(s.name)}</strong><small>${esc(s.catalog)} · ${esc(s.type||'未分类')}</small></span><span class="atlas-list-value">${esc(value)}</span></button>`;
  }).join('')||'<p class="atlas-note">没有符合筛选条件的源。</p>';
  $('atlas-more').hidden=items.length<=atlas.limit;
  $('atlas-more').textContent=`显示更多 · ${Math.min(items.length,atlas.limit)} / ${items.length}`;
}
function inspectAtlas(id){
  if(!source(id)||atlas.inspected===id)return;
  atlas.inspected=id;renderAtlasDetail();drawAtlasMap();
  document.querySelectorAll('[data-atlas-locate]').forEach(el=>el.classList.toggle('selected',el.dataset.atlasLocate===id));
}
function expandAtlas(value){
  atlas.expanded=value;$('sky-view').classList.toggle('atlas-expanded',value);$('atlas-expand').textContent=value?'收起天图 ↙':'展开天图 ↗';$('atlas-expand').setAttribute('aria-pressed',String(value));
  document.body.classList.toggle('atlas-is-expanded',value);
  requestAnimationFrame(()=>{if(S.view==='sky'&&S.route==='overview')drawAtlasMap();});
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
  worker.onerror=()=>{if(id===S.computeId)annualFailed('计算未能完成，请重试或刷新页面。');};
  worker.postMessage({id,type:'year',year:S.year,sources:S.sources.map(({id,name,ra,dec})=>({id,name,ra,dec})),config:S.config});
}
function annualFailed(message){$('annual-progress').hidden=true;$('compute-status').innerHTML=esc(message)+' <button class="text-button" data-action="retry">重试</button>';toast(message);}
function chooseFocus(id,{overlay=false,open=false}={}){
  if(!source(id))return;
  $('sky-picks').hidden=true;
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
    const extra=['candidate','disputed','private'].includes(s.status)?' · '+statusNames[s.status]:'';
    return `<div class="night-picker-row ${selected?'is-selected':''}" role="listitem" data-picker-row="${esc(s.id)}"><div class="picker-source"><strong>${esc(s.name)}</strong><small>${esc(s.catalog)} · ${esc(s.type||'未分类')}${extra}</small></div><div class="picker-window"><div class="picker-window-track" aria-hidden="true">${row.windows.map(([a,b])=>`<i style="left:${a/840*100}%;width:${(b-a)/840*100}%"></i>`).join('')}</div><small>${windows||'当前条件下无可用时段'}</small></div><div class="picker-hours">${hours(row.minutes)}<small>${row.minutes} min</small></div><button class="${selected?'quiet-button':'secondary-button'}" data-picker-source="${esc(s.id)}" aria-pressed="${selected}" aria-label="${selected?'移除':'叠加'} ${esc(s.name)}" ${disabled?'disabled':''}>${selected?'已叠加 −':'＋ 叠加'}</button></div>`;
  }).join('')||'<div class="empty-state">没有符合筛选的源。<br>可取消“仅可观测”，或调整目录、关键词与观测条件。</div>';
  if(activeId)[...$('night-picker-list').querySelectorAll('[data-picker-source]')].find(b=>b.dataset.pickerSource===activeId)?.focus({preventScroll:true});
}
function loadDate(date){
  if(!M.validDate(date)||Number(date.slice(0,4))<2000||Number(date.slice(0,4))>2100){toast('请选择 2000–2100 年之间的有效日期。');$('night-date').value=S.date;return;}
  if(date===S.date)return;
  savePlan();S.date=date;S.history=[];S.blocks=[];S.selected=null;S.revision=1;
  const oldConfig=JSON.stringify(S.config),oldSourceCount=S.sources.length;
  if(plans[date]){try{const p=restoreCatalogPlan(plans[date]);restoreSnapshot(p);S.revision=Number(plans[date].revision)||1;}catch{toast('这晚的本地草稿无法读取，已打开空计划。');}}
  if(JSON.stringify(S.config)!==oldConfig||S.sources.length!==oldSourceCount){savePreferences();renderCatalogState();renderConditions();calculateAnnual();toast('已恢复这晚草稿保存的源与观测参数。');}
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
function drawSiteSky({viewOnly=false}={}){
  const c=nightConfig(),stars=(sky.showStars||sky.showNeighborStars)?sky.stars.filter(s=>s.mag<=c.starLimit):[];
  const key=S.night.startMs+'|'+S.cursor+'|'+[c.latitude,c.longitude,c.elevation,c.starLimit,sky.showStars||sky.showNeighborStars,sky.stars.length].join('|');
  if(key!==sky.key){sky.positions=skyAt(S.night.startMs+S.cursor*60000,[...S.sources,...S.sources.flatMap(s=>(s.components||[]).filter(p=>p.extension?.kind==='gaussian-sigma').map(p=>({id:s.id+'::'+p.id,ra:p.ra,dec:p.dec}))),...stars],c);sky.key=key;}
  const result=renderSiteSky($('site-sky'),{night:S.night,positions:sky.positions,sources:S.sources,visible:S.visible,focus:S.focus,cursor:S.cursor,config:c,stars,showTracks:sky.showTracks,showStars:sky.showStars,showExtensions:sky.showExtensions,view:sky.view});
  sky.hits=result.hits;sky.viewport=result.viewport;
  $('sky-zoom-value').textContent=sky.view.zoom.toFixed(1)+'×';
  $('sky-zoom-out').disabled=sky.view.zoom<=1;$('sky-zoom-in').disabled=sky.view.zoom>=12;
  $('sky-center-source').disabled=!(sky.positions.sources.find(s=>s.id===S.focus)?.alt>=0);
  if(viewOnly)return;
  $('sky-time').textContent=M.clock(S.cursor,c)+' · '+timezoneLabel(c);
  $('sky-bodies').textContent=`太阳高 ${sky.positions.sun.alt.toFixed(1)}° · ${sky.positions.sun.alt<c.sun?'满足暗夜阈值':'未满足暗夜阈值'}　月亮高 ${sky.positions.moon.alt.toFixed(1)}°${sky.positions.moon.alt<0?'（地平线下）':''}`;
  $('star-limit').value=c.starLimit;$('neighbor-star-limit').value=c.starLimit;$('sky-padding').value=c.skyPadding;
  $('show-stars').checked=sky.showStars;$('show-neighbor-stars').checked=sky.showNeighborStars;$('show-tracks').checked=sky.showTracks;$('show-extensions').checked=sky.showExtensions;
  $('star-status').innerHTML=!sky.showStars?'亮星显示已关闭':sky.meta?`V ≤ ${c.starLimit} · 地平线上 ${result.starCount} 条恒星记录 · 数值越小越亮` : sky.error?esc(sky.error)+' <button class="text-button" data-action="retry-stars">重试</button>':'正在载入亮星目录…';
  $('star-coverage').textContent=sky.meta?.coverage||'';
  const neighbors=neighborEntries(source(S.focus),S.sources,neighborhoodRadius(c));
  const positions=new Map(sky.positions.sources.map(s=>[s.id,s]));
  const nearStars=renderNeighborField($('neighbor-sky'),{...source(S.focus),plotColor:color(S.focus)},neighbors.map(s=>({...s,plotColor:color(s.id)})),stars,c,{showStars:sky.showNeighborStars,showExtensions:sky.showExtensions,positions});
  $('neighbor-radius').textContent=`半径 ${neighborhoodRadius(c)}° · 含外围 ${c.skyPadding}°`;
  $('neighbors').innerHTML=neighbors.map((s,i)=>`<div class="neighbor-row"><div><button data-focus="${esc(s.id)}"><span style="color:${color(s.id)}">${i+1}.</span> ${esc(s.name)}</button><small>${esc(s.catalog)} · ${esc(extensionText(s))}${s.separation<.1?' · 可能为关联条目':''}${s.separation>neighborhoodRadius(c)?' · 中心在图外，目录尺度圈或上限圈与天区相交':''}</small></div><div>${s.separation.toFixed(2)}°<button class="text-button" data-overlay="${esc(s.id)}">${S.visible.includes(s.id)?'已叠加':'叠加轨迹'}</button></div></div>`).join('')||'<div class="empty-state">该天区没有其他目录条目</div>';
  const starUnavailable=!sky.showNeighborStars?'本图亮星已关闭':!sky.meta?'亮星目录尚未载入':'';
  $('neighbor-stars-count').closest('details').hidden=!sky.showNeighborStars;
  $('neighbor-stars-count').textContent=sky.meta?`恒星明细 · ${nearStars.length} 条 · V ≤ ${c.starLimit}`:sky.error?'恒星明细 · 目录暂不可用':'恒星明细 · 目录载入中';
  $('neighbor-stars').innerHTML=!sky.showNeighborStars?'':starUnavailable?`<p class="footnote">${starUnavailable}</p>`:nearStars.map(s=>`<div class="neighbor-star-row"><span>✦ ${esc(s.name)}</span><span>V ${s.mag.toFixed(2)} · ${separation(source(S.focus),s).toFixed(2)}°${s.alt<0?' · 地平线下':''}</span></div>`).join('')||'<p class="footnote">所选星等阈值下，此天区没有收录的恒星。</p>';
}
function drawNightCharts(){
  if(S.route!=='night'||!S.night)return;
  $('sky-picks').hidden=true;
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
  $('focus-name').textContent=f.name;$('focus-coordinates').textContent=`${f.catalog} · ${f.type}　 RA ${f.ra.toFixed(4)}° / Dec ${f.dec.toFixed(4)}° · ${sourceFrame(f)}`;
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
function fluxDescription(s){if(!s.flux)return s.private?'见能谱模型（原始字段）':'流强未提供';if(s.flux.qualityFlag)return '目录流强异常值，未作为有效流强使用';return `流强 ${Number(s.flux.value).toPrecision(3)} ${s.flux.unit}${s.flux.energy?' · '+s.flux.energy:''}`;}
function renderMonth(){
  const s=source(S.monthSource),year=S.monthYear,month=S.monthIndex;
  $('month-title').textContent=s.name;
  $('month-coordinates').textContent=`${s.catalog} · ${statusNames[s.status]||'已发布'} · RA ${s.ra.toFixed(4)}° / Dec ${s.dec.toFixed(4)}°`;
  $('month-label').textContent=`${year} 年 ${month+1} 月 · ${S.monthConfig.mode}`;
  S.monthData=computeMonth(year,month+1,[s],S.monthConfig);
  $('month-days').innerHTML=S.monthData.days.map((date,i)=>`<button class="month-day ${date===S.monthSelected?'selected':''}" data-month-day="${date}" aria-label="${date} 可观测 ${S.monthData.daily[s.id][i].toFixed(1)} 小时"><strong>${Number(date.slice(8))} 日</strong><span>${S.monthData.daily[s.id][i].toFixed(1)} h</span><i style="--hours:${S.monthData.daily[s.id][i]}"></i></button>`).join('');
  const caption=S.monthConfig.mode==='LACT'?'按当日正午至次日正午统计；单夜工作台显示18:00–次日08:00。':'LHAASO按当地00:00–24:00统计；单夜工作台使用LACT日月条件。';
  $('month-caption').innerHTML=`本月 ${sum(S.monthData.daily[s.id]).toFixed(1)} h · ${caption}<br>${esc(fluxDescription(s))}${s.private?' · 本地私有目录':/^https?:\/\//.test(s.reference||'')?' · <a href="'+esc(s.reference)+'" target="_blank" rel="noopener noreferrer">目录原始记录 ↗</a>':''}`;
  $('month-prev').disabled=year===2000&&month===0;$('month-next').disabled=year===2100&&month===11;
}
function openSettings(){
  for(const el of $('settings-form').elements)if(el.name)el.value=S.config[el.name];
  $('settings-dialog').showModal();
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([type.startsWith('text/csv')?'\ufeff':'',text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function fullPlan(){return {...snapshot(),confidentiality:privateCatalog?'PRIVATE_CATALOG':'PUBLIC_CATALOG',kind:'geometric_planning_not_controller_commands',revision:S.revision,createdAt:new Date().toISOString(),catalogRetrievedAt:S.meta.retrievedAt,fermiCatalog:S.blocks.some(b=>isFermiId(b.source))?{id:'4FGL-DR4',version:fermi.meta?.version,sha256:fermi.meta?.sha256,sourceUrl:fermi.meta?.sourceUrl,retrievedAt:fermi.meta?.retrievedAt}:undefined,resource:'LACT synchronized array / one pointing',tracking:{mode:S.blocks.some(b=>sourceFrame(source(b.source))!=='ICRS')?'CATALOG_SOURCE_CENTER':'ICRS_SOURCE_CENTER',azimuth:'north=0 east=90 degrees',refraction:false,samplingMinutes:10},deviceValidation:'NOT_IMPLEMENTED',sources:[...new Set(S.blocks.map(b=>b.source))].map(id=>{const s=source(id);return {id,name:s.name,ra:s.ra,dec:s.dec,catalog:s.catalog,reference:s.reference,coordinateFrame:s.coordinateFrame||'ICRS',coordinateNote:s.coordinateNote,coordinateComponent:s.coordinateComponent};})};}
function taskRows(){return assessment.sorted.map(b=>({task:b.id,source_id:b.source,source:source(b.source).name,start_utc:M.utc(S.date,b.start,nightConfig()),end_utc_exclusive:M.utc(S.date,b.start+b.duration,nightConfig()),start_local:M.local(S.date,b.start,nightConfig()),end_local_exclusive:M.local(S.date,b.start+b.duration,nightConfig()),duration_min:b.duration,...M.coordinateColumns(source(b.source)),mode:sourceFrame(source(b.source))!=='ICRS'?'CATALOG_SOURCE_CENTER':'ICRS_SOURCE_CENTER'}));}
function openReview(){
  ensureNight();assessment=M.validate(S.night,S.blocks,nightConfig());if(!S.blocks.length||assessment.issues.length){toast('请先安排任务并解决所有冲突。');return;}
  $('review-confirm').checked=false;document.querySelectorAll('[data-export]').forEach(b=>b.disabled=true);
  $('review-content').innerHTML=`<p class="muted">${S.date} · ${timezoneLabel(S.config)} · LACT 同步阵列 · 草稿 v${S.revision}</p><div class="review-summary-grid"><div><span>观测任务</span><strong>${S.blocks.length}</strong></div><div><span>有效计划</span><strong>${hours(assessment.validMinutes)}</strong></div><div><span>指向采样</span><strong>10 min</strong></div></div><div class="table-scroll"><table class="task-table"><thead><tr><th>任务</th><th>观测源</th><th>开始</th><th>结束</th></tr></thead><tbody>${assessment.sorted.map(b=>`<tr><td>#${b.id}</td><td>${esc(source(b.source).name)}</td><td>${M.clock(b.start,nightConfig())}</td><td>${M.clock(b.start+b.duration,nightConfig())}</td></tr>`).join('')}</tbody></table></div>`;
  $('review-dialog').showModal();
}
function showAbout(){
  const quality=S.meta.quality||{};
  $('about-content').innerHTML=`<div class="provenance-block"><h3>目录快照</h3><p>更新日期：${esc(S.meta.retrievedAt?.slice(0,10))}。${S.sources.length} 条目录记录，默认显示 ${S.sources.filter(s=>s.defaultIncluded!==false).length} 条默认记录${privateCatalog?'（含本地非公开目录）':''}。目录记录不等同于独立物理天体。</p><ul>${(S.meta.catalogs||[]).map(c=>`<li>${/^https?:\/\//.test(c.url||'')?'<a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">'+esc(c.label)+'</a>':esc(c.label)}：${c.recordCount} 条${c.componentCount?'，保留 '+c.componentCount+' 个探测器分量':''}。</li>`).join('')}</ul><p>TeVCat 包含已确认、新发布、候选和有争议条目。1LHAASO 主坐标采用已探测分量中 TS 较高者；WCDA 与 KM2A 的分量位置和流强保留在数据文件。</p><h3>计算与时间口径</h3><p>Astronomy Engine 2.1.19；目录 J2000 方向包含岁差与章动变换，日月使用台站位置。高度角不含大气折射，方位角北0°、东90°。全年/逐日以10分钟中点积分，单夜以1分钟计算，边界附近结果受采样分辨率限制。</p><p>LACT 月度统计：当日正午到次日正午；LHAASO：当地00:00到24:00，仅使用天顶角条件。单夜工作台固定为 LACT，展示18:00到次日08:00。跨午夜按观测夜归属统计。使用固定UTC时差，无夏令时自动换算。</p><h3>流强与近邻</h3><p>流强必须结合单位、能段与测量口径使用。${quality.TeVCatMissingFlux||0} 条 TeVCat 流强缺失，不补零。Crab 单位的积分阈值也可能不同，排序仅供目录检索。邻近位置不自动认定为独立源，也不代替扩展源和背景区分析。</p><h3>此刻天空与亮星</h3><p>天顶为中心、地平线为外圈，北上东左。亮星使用全天 V≤8 的 Gaia DR3 / SIMBAD 目录，默认显示 V≤3；Gaia 合成 V 与测量 V 的来源在数据中逐条保留。计数为目录记录数，跨目录或恒星系统分量仍可能重叠。亮星仅用于环境检查，不自动改变观测窗口或估算触发噪声。</p><p>日出日落使用太阳中心 −0.833° 的标准地平线近似，不包括本站山体遮挡；实际暗夜窗采用设置中的太阳阈值。邻近天区默认半径 8°，含原 5° 参考圈及外围 3°；视场圈采用可修改的视场半径。一期 LHAASO r39 实测值画实线、95% 上限画虚线；本地二期高斯源绘制 σ 轮廓，采用 FK5/J2000 坐标，定位误差与展宽分开。TeVCat 未统一定义的角尺度仅列数值，不假定为半径。</p><h3>计划保存与导出</h3><p>参数、优先级与草稿保存在当前浏览器本地。可下载JSON备份并重新导入。导入后始终按当前目录坐标重新检查；导出指向在每个任务中每10分钟采样，并保留结束半开边界。计划不包含天气、机械限位、转速、wobble或控制系统指令。</p><p><a href="https://github.com/Yun532/LACT-observation-plan" target="_blank" rel="noopener">查看源码、完整数据来源及可复现检查 ↗</a></p></div>`;
  $('about-dialog').showModal();
}
function bindEvents(){
  $('catalog-manage').onclick=()=>{$('catalog-message').textContent='';$('catalog-clear-area').hidden=true;$('catalog-clear-confirm').checked=false;$('catalog-clear-do').disabled=true;renderCatalogState();$('catalog-dialog').showModal();};
  $('catalog-choose').onclick=()=>$('catalog-file').click();
  $('catalog-file').onchange=event=>importLocalCatalog(event.target.files[0]);
  $('catalog-revert').onclick=async()=>{
    if(catalogBusy||!privateCatalog)return;catalogBusy=true;
    try{await localCatalog('remove');activateCatalog(null);$('catalog-message').textContent='已恢复公开源表。私有草稿保留在独立空间，可通过重新导入同一文件恢复。';}
    catch(error){$('catalog-message').textContent=error.message;}finally{catalogBusy=false;}
  };
  $('catalog-clear').onclick=()=>{$('catalog-clear-area').hidden=false;};
  $('catalog-clear-confirm').onchange=event=>{$('catalog-clear-do').disabled=!event.target.checked;};
  $('catalog-clear-do').onclick=async()=>{
    if(catalogBusy||!$('catalog-clear-confirm').checked)return;catalogBusy=true;
    const failures=[];
    try{
      try{localStorage.setItem(CLEAR_PRIVATE_KEY,String(Math.max(Date.now(),clearEpoch()+1)));}catch{failures.push('跨页面清理通知');}
      try{await localCatalog('remove');}catch{failures.push('目录文件存储');}
      if(privateCatalog)activateCatalog(null,'',false,{discard:true});
      const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k?.startsWith(PRIVATE_PLAN_PREFIX)||k?.startsWith(PRIVATE_PRIORITY_PREFIX));
      for(const key of keys)localStorage.removeItem(key);
      $('catalog-clear-area').hidden=true;$('catalog-message').textContent=failures.length?'已切回公开目录；未完成：'+failures.join('、')+'。请在浏览器设置中清除此站点数据。':'已清除此浏览器保存的私有目录、草稿与重点标记。';
    }catch(error){$('catalog-message').textContent=error.message;}finally{catalogBusy=false;}
  };
  $('source-info-button').onclick=()=>sourceDetails(S.focus);$('month-source-info').onclick=()=>sourceDetails(S.monthSource);
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.openFermi!==undefined){if(atlas.expanded)expandAtlas(false);openFermiLibrary();return;}
    if(b.dataset.close!==undefined){b.closest('dialog').close();return;}
    if(b.dataset.route){setRoute(b.dataset.route);return;}
    if(b.dataset.action==='settings'){openSettings();return;}
    if(b.dataset.action==='retry'){calculateAnnual();return;}
    if(b.dataset.action==='retry-stars'){loadStars();return;}
    if(b.dataset.view){S.view=b.dataset.view;if(S.view!=='sky'&&atlas.expanded)expandAtlas(false);renderOverview();return;}
    if(b.dataset.atlasOpen){chooseFocus(b.dataset.atlasOpen,{open:true});return;}
    if(b.dataset.atlasInfo){sourceDetails(b.dataset.atlasInfo);return;}
    if(b.dataset.atlasLocate){const s=source(b.dataset.atlasLocate);if(s){atlas.inspected=s.id;atlas.view={zoom:4,...projectAtlas(s.ra,s.dec,atlas.frame)};renderAtlasView();}return;}
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
      try { const type=b.dataset.export,name=`LACT-${S.date}${privateCatalog?'-PRIVATE':''}-v${S.revision}`;
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
  for(const [id,key] of [['show-stars','showStars'],['show-neighbor-stars','showNeighborStars'],['show-tracks','showTracks'],['show-extensions','showExtensions']])$(id).onchange=event=>{sky[key]=event.target.checked;savePreferences();drawNightCharts();};
  for(const [id,key] of [['star-limit','starLimit'],['neighbor-star-limit','starLimit'],['sky-padding','skyPadding']])$(id).onchange=event=>{
    const value=Number(event.target.value);
    if(!event.target.value||!event.target.reportValidity()){event.target.value=S.config[key];return;}
    try{M.validateConfig({...S.config,[key]:value});S.config[key]=value;savePreferences();savePlan();drawNightCharts();}catch(error){toast(error.message);event.target.value=S.config[key];}
  };
  let skyFrame;
  const changeSkyView=view=>{
    sky.view=limitSkyView(view);$('sky-picks').hidden=true;
    cancelAnimationFrame(skyFrame);skyFrame=requestAnimationFrame(()=>{if(S.route==='night'&&S.night)drawSiteSky({viewOnly:true});});
  };
  const describeSkyHit=h=>{$('sky-hover').textContent=h?`${h.name}${h.kind==='star'?' · V '+h.mag.toFixed(2):''} · 高度 ${h.alt.toFixed(1)}° / 方位 ${h.az.toFixed(1)}°${h.kind==='source'?' · '+extensionText(h):''}`:'悬停查看源名、V 星等和位置；点击源切换关注。';};
  bindSkyNavigation($('site-sky'),{
    getView:()=>sky.view,getViewport:()=>sky.viewport,change:changeSkyView,
    hover:p=>{const hits=skyHitsAt(sky.hits,p);$('site-sky').style.cursor=hits.some(h=>h.kind==='source')?'pointer':'grab';describeSkyHit(hits[0]);},
    pick:p=>{
      const hits=skyHitsAt(sky.hits,p),seen=new Set(),candidates=hits.filter(h=>h.kind==='source'&&!seen.has(h.id)&&seen.add(h.id));
      describeSkyHit(hits[0]);$('sky-picks').hidden=true;
      if(candidates.length===1)chooseFocus(candidates[0].id);
      else if(candidates.length>1){$('sky-picks').innerHTML='<span>此处有多个源，请选择：</span>'+candidates.map(h=>`<button type="button" data-sky-focus="${esc(h.id)}">${esc(source(h.id).name)} <small>${esc(source(h.id).catalog)}</small></button>`).join('');$('sky-picks').hidden=false;}
    },
  });
  $('sky-picks').onclick=event=>{const id=event.target.closest('[data-sky-focus]')?.dataset.skyFocus;if(id)chooseFocus(id);};
  $('sky-zoom-in').onclick=()=>{if(sky.viewport)changeSkyView(zoomSkyView(sky.view,sky.viewport,1.5));};
  $('sky-zoom-out').onclick=()=>{if(sky.viewport)changeSkyView(zoomSkyView(sky.view,sky.viewport,1/1.5));};
  $('sky-reset').onclick=()=>changeSkyView({zoom:1,x:0,y:0});
  $('sky-center-source').onclick=()=>{const p=sky.positions?.sources.find(s=>s.id===S.focus);if(p?.alt>=0)changeSkyView({zoom:Math.max(4,sky.view.zoom),...projectHorizontal(p.alt,p.az)});};
  $('neighbor-sky').onclick=event=>{const id=event.target.closest('[data-neighbor-source]')?.dataset.neighborSource;if(id)chooseFocus(id);};
  $('trajectory').onpointerdown=event=>{const rect=event.currentTarget.getBoundingClientRect(),left=Number(event.currentTarget.dataset.plotLeft)||65,right=Number(event.currentTarget.dataset.plotRight)||20;S.cursor=Math.max(0,Math.min(840,Math.round((event.clientX-rect.left-left)/(rect.width-left-right)*840)));drawNightCharts();};
  $('all-sky').onclick=event=>{const node=event.target.closest('[data-source]');if(node)chooseFocus(node.dataset.source,{open:true});};
  $('all-sky').onkeydown=event=>{const node=event.target.closest('[data-source]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();chooseFocus(node.dataset.source,{open:true});}};
  $('atlas-month').innerHTML=Array.from({length:12},(_,m)=>`<option value="${m}">${m+1}月</option>`).join('');
  $('atlas-month').onchange=event=>{S.month=+event.target.value;S.sort='month';$('sort').value='month';S.page=0;renderOverview();};
  $('atlas-search').oninput=event=>{S.filter=event.target.value;$('source-search').value=S.filter;S.page=0;renderOverview();};
  $('atlas-mode').onchange=event=>{atlas.mode=event.target.value;if(atlas.mode==='classic'&&atlas.expanded)expandAtlas(false);renderAtlasView();};
  $('atlas-frame').onchange=event=>{atlas.frame=event.target.value;atlas.view={zoom:1,x:0,y:0};drawAtlasMap();};
  $('atlas-color').onchange=event=>{atlas.colorBy=event.target.value;drawAtlasMap();};
  for(const [id,key] of [['atlas-grid','showGrid'],['atlas-plane','showPlane'],['atlas-reach','showReach'],['atlas-fov','showFov'],['atlas-labels','showLabels']])$(id).onchange=event=>{atlas[key]=event.target.checked;drawAtlasMap();if(key==='showFov')renderAtlasDetail();};
  $('atlas-fov-radius').onchange=event=>{
    if(!event.target.reportValidity()||!event.target.value){event.target.value=S.config.fov;return;}
    S.config={...S.config,...M.validateConfig({...S.config,fov:Number(event.target.value)})};
    invalidateNight();S.revision++;savePreferences();savePlan();drawAtlasMap();renderAtlasDetail();
  };
  $('atlas-more').onclick=()=>{atlas.limit+=12;renderAtlasView();};
  $('atlas-expand').onclick=()=>expandAtlas(!atlas.expanded);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&atlas.expanded&&!document.querySelector('dialog[open]'))expandAtlas(false);});
  let atlasFrame;
  const changeAtlasView=view=>{atlas.view=limitAtlasView(view);$('atlas-picks').hidden=true;cancelAnimationFrame(atlasFrame);atlasFrame=requestAnimationFrame(()=>{if(S.view==='sky'&&S.route==='overview')drawAtlasMap();});};
  $('atlas-zoom-in').onclick=()=>{if(atlas.result)changeAtlasView(zoomSkyView(atlas.view,atlas.result.viewport,1.5));};
  $('atlas-zoom-out').onclick=()=>{if(atlas.result)changeAtlasView(zoomSkyView(atlas.view,atlas.result.viewport,1/1.5));};
  $('atlas-reset').onclick=()=>changeAtlasView({zoom:1,x:0,y:0});
  $('atlas-center-fov').onclick=()=>{const s=source(atlas.inspected);if(s){atlas.showFov=true;$('atlas-fov').checked=true;changeAtlasView({zoom:Math.min(12,Math.max(2,45/S.config.fov)),...projectAtlas(s.ra,s.dec,atlas.frame)});renderAtlasDetail();}};
  bindSkyNavigation($('atlas-sky'),{
    getView:()=>atlas.view,getViewport:()=>atlas.result?.viewport,change:changeAtlasView,
    hover:p=>{
      if(!atlas.result)return;
      const h=skyHitsAt(atlas.result.hits,p)[0],v=atlas.result.viewport,r=v.baseRadius*atlas.view.zoom;
      const coords=h?{ra:h.ra,dec:h.dec,...equatorialToGalactic(h.ra,h.dec)}:unprojectAtlas((p.x-v.centerX)/r+atlas.view.x,(p.y-v.centerY)/r+atlas.view.y,atlas.frame);
      $('atlas-sky').style.cursor=h?'pointer':'grab';
      $('atlas-readout').textContent=coords?`${h?h.name+' · ':'光标 · '}RA ${coords.ra.toFixed(2)}°  Dec ${coords.dec.toFixed(2)}°　|　l ${coords.l.toFixed(2)}°  b ${coords.b.toFixed(2)}°`:'图外 · 悬停图内查看坐标';
      if(h)inspectAtlas(h.id);
    },
    pick:p=>{
      const seen=new Set(),hits=skyHitsAt(atlas.result?.hits||[],p).filter(h=>!seen.has(h.id)&&seen.add(h.id));
      $('atlas-picks').hidden=true;
      if(hits.length===1)chooseFocus(hits[0].id,{open:true});
      else if(hits.length>1){$('atlas-picks').innerHTML='<span>此处有多个目录条目，选择源进入单夜：</span>'+hits.map(h=>`<button type="button" data-atlas-open="${esc(h.id)}">${esc(h.name)} <small>${esc(source(h.id).catalog)}</small></button>`).join('');$('atlas-picks').hidden=false;}
    },
  });
  $('atlas-sky').addEventListener('focusin',event=>{const id=event.target.closest('[data-source]')?.dataset.source;if(id){if(atlas.inspected!==id){atlas.inspected=id;renderAtlasDetail();drawAtlasMap();}$('atlas-readout').textContent=source(id).name+' · Enter 进入单夜规划';}});
  $('atlas-sky').addEventListener('keydown',event=>{const id=event.target.closest('[data-source]')?.dataset.source;if(id&&['Enter',' '].includes(event.key)){event.preventDefault();chooseFocus(id,{open:true});}});
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
  $('save-draft').onclick=()=>download(`LACT-${S.date}${privateCatalog?'-PRIVATE':''}-draft.json`,JSON.stringify(fullPlan(),null,2),'application/json');
  $('import-plan').onclick=()=>$('plan-file').click();
  $('plan-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    try {if(file.size>2000000)throw new Error('计划文件不能超过 2 MB');const payload=JSON.parse(await file.text());checkPlanCatalogIdentity(payload,privateCatalog?privateFingerprint:'');if(planFermiIds(payload).length)await fermi.load();const plan=restoreCatalogPlan(payload);savePlan();fermiRecoveryPending=false;Object.assign(S,{date:plan.date,blocks:plan.blocks,focus:plan.focus,visible:plan.visible.slice(0,6),config:{...plan.config,mode:S.config.mode,defaultDuration:S.config.defaultDuration},history:[],revision:1,selected:plan.blocks[0]?.id??null,nextId:Math.max(0,...plan.blocks.map(b=>b.id))+1});if(!S.visible.includes(S.focus))S.visible=[S.focus,...S.visible].slice(0,6);invalidateNight();savePreferences();savePlan();renderCatalogState();renderConditions();calculateAnnual();setRoute('night');toast('计划已导入并按当前目录重新检查。');}catch(error){toast('导入失败：'+error.message);}event.target.value='';
  };
  const track=$('schedule-track');
  $('candidates').ondragstart=event=>{const el=event.target.closest('[data-drag-source]');if(!el)return;event.dataTransfer.setData('text/plain',el.dataset.dragSource);event.dataTransfer.effectAllowed='copy';};
  track.ondragover=event=>{event.preventDefault();track.classList.add('drop-over');};track.ondragleave=()=>track.classList.remove('drop-over');
  track.ondrop=event=>{event.preventDefault();track.classList.remove('drop-over');const id=event.dataTransfer.getData('text/plain');if(!source(id))return;const rect=track.getBoundingClientRect();addTask(id,Math.round((event.clientX-rect.left)/rect.width*840/5)*5);};
  track.onpointerdown=event=>{const element=event.target.closest('[data-block]');if(!element)return;const b=S.blocks.find(b=>b.id===+element.dataset.block);drag={id:b.id,x:event.clientX,start:b.start,duration:b.duration,mode:event.target.dataset.resize||'move',moved:false,element};track.setPointerCapture(event.pointerId);event.preventDefault();};
  track.onpointermove=event=>{if(!drag)return;const delta=Math.round((event.clientX-drag.x)/track.getBoundingClientRect().width*840/5)*5;if(!delta&&!drag.moved)return;drag.moved=true;let start=drag.start,duration=drag.duration;if(drag.mode==='move')start=Math.max(0,Math.min(840-duration,start+delta));if(drag.mode==='left'){start=Math.max(0,Math.min(start+duration-5,start+delta));duration=drag.start+drag.duration-start;}if(drag.mode==='right')duration=Math.max(5,Math.min(840-start,duration+delta));drag.next={start,duration};drag.element.style.left=start/840*100+'%';drag.element.style.width=duration/840*100+'%';$('schedule-message').textContent=`#${drag.id} → ${M.clock(start,nightConfig())} — ${M.clock(start+duration,nightConfig())}`;};
  track.onpointerup=()=>{if(!drag)return;const d=drag;drag=null;const b=S.blocks.find(b=>b.id===d.id);if(d.moved&&d.next){remember();Object.assign(b,d.next);S.selected=b.id;S.focus=b.source;if(!S.visible.includes(b.source))S.visible=[...S.visible.slice(0,5),b.source];edited('任务时段已调整，所有冲突已重新检查。');}else{S.selected=b.id;chooseFocus(b.source);}};
  track.onpointercancel=()=>{drag=null;renderNight();};
  window.addEventListener('resize',()=>{cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(()=>{if(S.route==='night')drawNightCharts();else if(S.view==='sky')drawAtlasMap();});});
  window.addEventListener('hashchange',()=>setRoute(location.hash==='#night'?'night':'overview'));
  window.addEventListener('storage',event=>{if(event.key===CLEAR_PRIVATE_KEY&&privateCatalog){activateCatalog(null,'',false,{discard:true});toast('另一页面已清除私有数据，本页已切回公开目录。');}});
}
async function boot(){
  try {
    const response=await fetch(new URL('data/sources.json',document.baseURI));if(!response.ok)throw new Error('源表载入失败（'+response.status+'）');
    const catalog=await response.json();if(!Array.isArray(catalog.sources)||!catalog.sources.length)throw new Error('源表为空');
    publicCatalog=catalog;let local=null,fingerprint='';
    try{const stored=await localCatalog('read');if(stored&&(!clearEpoch()||stored.savedAt>clearEpoch())){local=parsePrivateCatalog(stored.text,stored.filename);fingerprint=await catalogFingerprint(stored.text);if(clearEpoch()&&!(stored.savedAt>clearEpoch())){local=null;fingerprint='';}}}
    catch{local=null;toast('本机私有目录未能载入，现使用公开目录；可在“管理源表”重新导入。');}
    if(fermiIds.size||savedPlanSets().some(set=>Object.values(set).some(p=>planFermiIds(p).length))){
      try{await fermi.load();for(const id of fermiIds)if(!fermi.getById(id))fermiIds.delete(id);}catch{fermiRecoveryPending=true;}
    }
    bindEvents();activateCatalog(local,fingerprint,!!local,{initial:true});$('boot').hidden=true;$('catalog-bar').hidden=false;setRoute(location.hash==='#night'?'night':'overview');calculateAnnual();
    if(fermiRecoveryPending)toast('Fermi 扩展源库暂未载入，基础源表可继续查询。原草稿已保护，请打开 Fermi 源库重试后继续排班。');
  }catch(error){$('boot').innerHTML='<h1>暂时无法打开观测源表</h1><p>'+esc(error.message)+'</p><button class="primary-button" id="reload-app">重新载入</button>';$('reload-app').onclick=()=>location.reload();}
}
boot();
