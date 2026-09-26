import { matchesSource } from './source-search.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, limit = 300) => typeof value === 'string' && value.length <= limit;
const nullableNumber = value => value == null || finite(value);
const classLabels = {bll:'BL Lac',fsrq:'平谱射电类星体',bcu:'耀变体候选',psr:'脉冲星',msp:'毫秒脉冲星',pwn:'脉冲星风云',snr:'超新星遗迹',spp:'SNR / PWN 候选',sfr:'恒星形成区',glc:'球状星团',rdg:'射电星系',agn:'活动星系核',sbg:'星暴星系',hmb:'高质量双星',lmb:'低质量双星',bin:'双星',nov:'新星',gal:'普通星系',sey:'赛弗特星系',ssrq:'陡谱射电类星体',css:'致密陡谱源',nlsy1:'窄线 Seyfert 1'};
const classLabel = code => !code ? '未分类' : `${code} · ${classLabels[code.toLowerCase()] || '目录分类'}`;
const energyFlux = source => source.fermi.energyFlux?.value;

// Validate the downloaded public snapshot before it can join the planning catalog.
export function validateFermiCatalog(payload) {
  if (!payload || payload.meta?.catalog !== '4FGL-DR4' || !Array.isArray(payload.sources) || !payload.sources.length || payload.sources.length > 20_000) throw new Error('Fermi 目录格式不正确。');
  const ids = new Set();
  for (const source of payload.sources) {
    const f = source?.fermi;
    if (!source || !text(source.id,100) || !/^fermi:4fgl:[a-z0-9.+_-]+$/.test(source.id) || ids.has(source.id) || source.catalog !== '4FGL-DR4' || !text(source.name,200) || !source.name.trim() || !finite(source.ra) || source.ra < 0 || source.ra >= 360 || !finite(source.dec) || Math.abs(source.dec) > 90 || !Array.isArray(source.aliases) || source.aliases.length > 100 || !source.aliases.every(value => text(value)) || !f || typeof f !== 'object' || Array.isArray(f) || !text(f.classCode,30) || !text(f.association) || !nullableNumber(f.significance) || !nullableNumber(f.variabilityIndex) || !Array.isArray(f.highEnergyAssociations) || f.highEnergyAssociations.length > 100 || !f.highEnergyAssociations.every(value => text(value))) throw new Error('Fermi 目录含无效记录、重复编号或坐标。');
    if (f.energyFlux != null && (typeof f.energyFlux !== 'object' || Array.isArray(f.energyFlux) || !nullableNumber(f.energyFlux.value) || !nullableNumber(f.energyFlux.error))) throw new Error('Fermi 能流字段格式不正确。');
    if (source.flux != null && (typeof source.flux !== 'object' || Array.isArray(source.flux) || !nullableNumber(source.flux.value) || !nullableNumber(source.flux.error))) throw new Error('Fermi 流量字段格式不正确。');
    ids.add(source.id);
  }
  if (payload.meta.count !== payload.sources.length) throw new Error('Fermi 目录记录数校验未通过。');
  return payload;
}

export function fermiReachable(source, config) {
  return finite(config?.latitude) && finite(config?.zmax) && Math.abs(source.dec - config.latitude) <= config.zmax + 1e-10;
}

export function filterFermiSources(sources, filters = {}, context = {}) {
  const selected = new Set(context.selectedIds || []);
  const minimum = Number(filters.minSignificance);
  const requireMinimum = filters.minSignificance !== '' && filters.minSignificance != null && Number.isFinite(minimum);
  const rows = sources.filter(source => matchesSource(source, filters.query || '')
    && (!filters.type || source.fermi.classCode === filters.type || (filters.type === '__unknown' && !source.fermi.classCode))
    && (!filters.onlyReachable || fermiReachable(source, context.config))
    && (!filters.highEnergyOnly || source.fermi.highEnergyAssociations.length > 0)
    && (!filters.selectedOnly || selected.has(source.id))
    && (!requireMinimum || (finite(source.fermi.significance) && source.fermi.significance >= minimum)));
  const byName = (a,b) => a.name.localeCompare(b.name,'en',{numeric:true});
  const value = source => filters.sort === 'energyFlux' ? energyFlux(source) : source.fermi.significance;
  rows.sort((a,b) => {
    if (filters.sort === 'name') return byName(a,b);
    const av=value(a),bv=value(b);
    if (finite(av) !== finite(bv)) return finite(av) ? -1 : 1;
    return (finite(av) ? bv-av : 0) || byName(a,b);
  });
  return rows;
}

export function createFermiExplorer({getContext, onAdd, onRemove, onInspect}) {
  let catalog = null, pending = null, byId = new Map(), dialog = null, page = 0, busy = false;
  const filters = {query:'',type:'',minSignificance:'',onlyReachable:true,highEnergyOnly:false,selectedOnly:false,sort:'significance'};
  const pageSize = 25;
  const find = name => dialog.querySelector(`[data-fermi="${name}"]`);
  async function load() {
    if (catalog) return catalog;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetch(new URL('./data/fermi-sources.json',document.baseURI));
      if (!response.ok) throw new Error(`Fermi 目录暂时无法加载（HTTP ${response.status}）。`);
      const body = await response.text();
      if (body.length > 25_000_000) throw new Error('Fermi 目录文件超过允许大小。');
      const value = validateFermiCatalog(JSON.parse(body));
      byId = new Map(value.sources.map(source => [source.id,source]));
      catalog = value;
      return catalog;
    })().finally(() => { pending = null; });
    return pending;
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'fermi-dialog';
    dialog.setAttribute('aria-labelledby','fermi-heading');
    dialog.innerHTML = `<div class="fermi-heading"><div><span class="fermi-eyebrow">OPTIONAL SOURCE LIBRARY</span><h2 id="fermi-heading">Fermi 扩展源库 <span>4FGL-DR4</span></h2><p>先筛选感兴趣的 GeV 源，再加入源表计算年度窗口和单夜轨迹。</p></div><button class="icon-button" type="button" data-fermi="close" aria-label="关闭 Fermi 扩展源库">×</button></div>
      <div class="fermi-loading" data-fermi="loading" role="status">正在加载公开 Fermi 目录…</div>
      <div class="fermi-error" data-fermi="error" hidden><p data-fermi="error-text" role="alert"></p><button type="button" class="quiet-button" data-fermi="retry">重新加载</button></div>
      <div data-fermi="content" hidden>
        <div class="fermi-filters"><label class="fermi-search"><span>搜索名称或关联对象</span><input data-fermi="query" type="search" placeholder="如 Mrk 421、Crab、4FGL J…" autocomplete="off"></label><label><span>源类型 / CLASS1</span><select data-fermi="type"><option value="">全部类型</option></select></label><label><span>显著性下限 / σ</span><input data-fermi="minimum" type="number" min="0" step="any" placeholder="不限"></label><label><span>排序</span><select data-fermi="sort"><option value="significance">探测显著性 ↓</option><option value="energyFlux">0.1–100 GeV 能流 ↓</option><option value="name">源名称 A–Z</option></select></label></div>
        <div class="fermi-switches"><label><input type="checkbox" data-fermi="reachable" checked>仅几何可达</label><label title="4FGL 中存在 1FHL、2FHL 或 3FHL 目录关联"><input type="checkbox" data-fermi="high-energy">有 FHL 高能关联</label><label><input type="checkbox" data-fermi="selected">仅已加入</label></div>
        <p class="fermi-geometry" data-fermi="geometry"></p>
        <div class="fermi-results-heading"><strong data-fermi="count"></strong><span data-fermi="selected-count"></span></div>
        <p class="fermi-units">坐标：FK5 / J2000 · 能流：0.1–100 GeV，单位 erg cm⁻² s⁻¹</p>
        <p class="fermi-action-message" data-fermi="message" role="status"></p>
        <div class="fermi-results" data-fermi="results" aria-label="Fermi 筛选结果"></div>
        <div class="fermi-pagination"><span data-fermi="page"></span><button class="quiet-button" type="button" data-fermi="previous">上一页</button><button class="quiet-button" type="button" data-fermi="next">下一页</button></div>
        <details class="fermi-notes"><summary>目录范围与解读</summary><p data-fermi="provenance"></p><p>Fermi 的 GeV 探测不代表已在 TeV 能段探测到。FHL 关联只是高能目录中的关联记录，不等于 LACT 的探测能力；目录关联也不会自动合并跨目录源。</p><p>能流为 0.1–100 GeV 的目录值，只在本库内排序，不与 TeVCat 或 LHAASO 的流强混排。缺失值显示“—”；CLASS1 大小写保留原目录含义。</p></details>
      </div>`;
    document.body.append(dialog);
    find('close').onclick = () => dialog.close();
    find('retry').onclick = populate;
    for (const [name,key] of [['query','query'],['type','type'],['minimum','minSignificance'],['sort','sort'],['reachable','onlyReachable'],['high-energy','highEnergyOnly'],['selected','selectedOnly']]) {
      const input=find(name);
      input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
        filters[key] = input.type === 'checkbox' ? input.checked : input.value;
        page=0;render();
      });
    }
    find('previous').onclick = () => {page--;render();};
    find('next').onclick = () => {page++;render();};
    find('results').addEventListener('click', async event => {
      const button = event.target.closest('button[data-fermi-action]');
      if (!button || busy) return;
      const id = button.dataset.fermiId, action = button.dataset.fermiAction;
      if (!byId.has(id)) return;
      if (action === 'inspect') {onInspect(id);return;}
      busy=true;find('message').textContent='';render();
      try {
        if (action === 'remove') {
          const removed = await onRemove(id);
          find('message').textContent = removed === false ? '此源仍被当前工作台或观测计划使用，暂不能移除。' : '已从观测源表移除，仍可在 Fermi 库中查找。';
        } else {
          const added = await onAdd(id,{openNight:action === 'night'});
          if (added === false) find('message').textContent='此源暂未加入，请检查当前观测计划。';
          else if (action === 'night') dialog.close();
          else find('message').textContent='已加入观测源表，可查看年度窗口和单夜轨迹。';
        }
      } catch(error) {find('message').textContent=error?.message || '操作未完成，请重试。';}
      finally {busy=false;render();}
    });
  }
  function render() {
    if (!catalog || !dialog) return;
    const context = getContext(), selected = new Set(context.selectedIds || []);
    const rows = filterFermiSources(catalog.sources,filters,context);
    const pages = Math.max(1,Math.ceil(rows.length/pageSize));
    page = Math.max(0,Math.min(page,pages-1));
    const c=context.config, min=Math.max(-90,c.latitude-c.zmax),max=Math.min(90,c.latitude+c.zmax);
    find('geometry').textContent=`几何可达：赤纬 ${min.toFixed(2)}° 至 ${max.toFixed(2)}°（天顶角 ≤ ${c.zmax}°）。仅判断最高过境位置，不代表所选夜晚可观测。`;
    find('count').textContent=`${rows.length.toLocaleString()} 条筛选结果`;
    find('selected-count').textContent=`全库 ${catalog.sources.length.toLocaleString()} 条 · 已加入 ${catalog.sources.filter(source => selected.has(source.id)).length} 条`;
    find('results').innerHTML=rows.slice(page*pageSize,(page+1)*pageSize).map(source => {
      const f=source.fermi, added=selected.has(source.id),value=energyFlux(source);
      return `<article class="fermi-source${added?' is-selected':''}"><div class="fermi-source-name"><button type="button" data-fermi-action="inspect" data-fermi-id="${esc(source.id)}">${esc(source.name)}</button><p>${esc(f.association || '暂无关联对象')}</p><span class="fermi-class">${esc(classLabel(f.classCode))}</span>${f.highEnergyAssociations.length?'<span class="fermi-fhl" title="FHL 高能目录关联">FHL</span>':''}<small>RA ${source.ra.toFixed(3)}° · Dec ${source.dec.toFixed(3)}°</small></div><dl class="fermi-metrics"><div><dt>显著性</dt><dd>${finite(f.significance)?f.significance.toFixed(1)+' σ':'—'}</dd></div><div><dt>能流 <span>erg cm⁻² s⁻¹</span></dt><dd>${finite(value)?value.toExponential(2):'—'}</dd></div></dl><div class="fermi-source-actions"><button class="fermi-add${added?' is-added':''}" type="button" data-fermi-action="${added?'remove':'add'}" data-fermi-id="${esc(source.id)}"${busy?' disabled':''}>${added?'已加入 · 移除':'＋ 加入源表'}</button><button class="text-button" type="button" data-fermi-action="night" data-fermi-id="${esc(source.id)}"${busy?' disabled':''}>单夜观测 →</button></div></article>`;
    }).join('') || '<div class="fermi-empty">没有匹配的源。可取消“仅几何可达”或放宽筛选条件。</div>';
    find('page').textContent=`第 ${page+1} / ${pages} 页 · 每页 ${pageSize} 条`;
    find('previous').disabled=page===0||busy;find('next').disabled=page===pages-1||busy;
  }
  async function populate() {
    find('loading').hidden=false;find('error').hidden=true;find('content').hidden=true;
    try {
      await load();
      const codes=[...new Set(catalog.sources.map(source => source.fermi.classCode))].sort((a,b)=>a.localeCompare(b));
      find('type').innerHTML='<option value="">全部类型</option>'+codes.map(code=>`<option value="${esc(code||'__unknown')}">${esc(classLabel(code))}</option>`).join('');
      find('type').value=filters.type;
      const physical=Number.isInteger(catalog.meta.physicalSourceCount)?catalog.meta.physicalSourceCount.toLocaleString():'';
      find('provenance').textContent=`NASA / Fermi LAT 4FGL-DR4，${catalog.sources.length.toLocaleString()} 条记录${physical?`，对应 ${physical} 个目录源` : ''}。Crab 的脉冲星与星云辐射分量为独立记录。数据按需加载，只有手动加入的源参与本网站观测计算。`;
      find('content').hidden=false;render();
    } catch(error) {find('error').hidden=false;find('error-text').textContent=error instanceof SyntaxError?'Fermi 目录文件暂时无法解析，请重新加载。':error?.message||'Fermi 目录加载失败，请检查连接后重试。';}
    finally {find('loading').hidden=true;}
  }
  return {
    async open() {ensureDialog();find('message').textContent='';if(!dialog.open)dialog.showModal();await populate();},
    load,
    getById(id) {return byId.get(id);},
    get sources() {return catalog?.sources || [];},
    get meta() {return catalog?.meta || null;},
    refresh() {if(dialog?.open)render();}
  };
}
