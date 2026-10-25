import { normalizeCustomSource, parseCustomCatalog, mergeCustomSources, serializeCustomCatalog, CUSTOM_CATALOG_LIMITS } from './custom-catalog.js';

const pageSize = 20;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const coordinates = source => `RA ${source.ra.toFixed(5)}° · Dec ${source.dec.toFixed(5)}°`;
const frame = source => source.coordinateFrame || 'FK5/J2000';

function download(name, value) {
  const url = URL.createObjectURL(new Blob(['\ufeff',value.replace(/^\ufeff+/u,'')], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link);link.click();link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

export function createCustomSources({getSources, onChange, onUse, canRemove = () => ''}) {
  let dialog = null, mode = 'manual', busy = false, reading = false, fileRequest = 0;
  let page = 0, previewPage = 0, preview = [], filename = '';
  const find = key => dialog.querySelector(`[data-custom="${key}"]`);
  const message = (text = '', error = false) => {
    find('message').textContent = text;
    find('message').classList.toggle('is-error', error);
    find('message').setAttribute('role', error ? 'alert' : 'status');
  };

  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'custom-dialog';
    dialog.setAttribute('aria-labelledby','custom-heading');
    dialog.innerHTML = `<div class="custom-heading"><div><span class="custom-eyebrow">YOUR SOURCE CATALOG</span><h2 id="custom-heading">自定义源 <span>仅本机</span></h2><p>从坐标开始，把自己的目标加入观测规划。</p></div><button type="button" class="icon-button" data-custom="close" aria-label="关闭自定义源">×</button></div>
      <div class="custom-local-note">数据保存在当前浏览器，可导出备份；不会上传至网站或 GitHub，也不会替换已有源表。</div>
      <div class="custom-mode" aria-label="添加自定义源的方式"><button type="button" data-custom="mode-manual" aria-pressed="true">单个添加</button><button type="button" data-custom="mode-import" aria-pressed="false">导入源表</button></div>
      <form data-custom="manual" class="custom-form"><fieldset data-custom="fields"><div class="custom-form-grid">
        <label class="custom-wide">源名称 <span class="custom-optional">选填 · 留空按坐标命名</span><input data-custom="name" maxlength="200" autocomplete="off" placeholder="给这个目标一个名称"></label>
        <label>赤经 RA<input data-custom="ra" required maxlength="80" autocomplete="off" spellcheck="false" placeholder="120.0 或 08:00:00" aria-describedby="custom-coordinate-help"></label>
        <label>赤纬 Dec<input data-custom="dec" required maxlength="80" autocomplete="off" spellcheck="false" placeholder="+30.0 或 +30:00:00" aria-describedby="custom-coordinate-help"></label>
        <label>坐标系 / 历元<select data-custom="frame"><option value="FK5/J2000">FK5 / J2000</option><option value="ICRS">ICRS</option></select></label>
        <label>数字赤经的单位<select data-custom="unit"><option value="deg">度（0–360°）</option><option value="hour">小时（0–24 h）</option></select></label>
        <label class="custom-wide">备注 <span class="custom-optional">选填</span><input data-custom="notes" maxlength="2000" placeholder="例如观测目的或目标来源" autocomplete="off"></label>
      </div><p id="custom-coordinate-help" class="custom-help">RA 使用冒号时按时:分:秒解析；Dec 使用度或度:分:秒，范围 −90° 至 +90°。请按坐标来源选择坐标系。</p><div class="custom-form-actions"><span>无需流强或能谱，也可以计算观测窗口。</span><button type="submit" class="primary-button">添加到源表</button></div></fieldset></form>
      <section data-custom="import" hidden aria-label="导入本地自定义源表"><div class="custom-import-card"><div><strong>选择本地 CSV / YAML</strong><p>先检查坐标，再确认追加。单个文件最多 ${Math.round(CUSTOM_CATALOG_LIMITS.bytes/1024/1024)} MB，自定义源总数最多 ${CUSTOM_CATALOG_LIMITS.sources} 个。</p></div><label class="custom-file-label">选择文件<input data-custom="file" type="file" accept=".csv,.yaml,.yml,text/csv,application/yaml,text/yaml" aria-label="选择本地自定义源表"></label></div>
        <div class="custom-format-row"><button type="button" class="text-button" data-custom="template">下载 CSV 模板 ↓</button><details><summary>查看格式说明</summary><p>必填列为 <code>ra</code>、<code>dec</code>；<code>name</code>、<code>frame</code>、<code>ra_unit</code>、<code>notes</code> 可选。缺省坐标系为 FK5/J2000、数字赤经单位为度。YAML 使用相同字段组成的列表。</p><pre>name,ra,dec,frame,ra_unit,notes\n示例目标,120,30,FK5/J2000,deg,</pre></details></div>
        <div data-custom="preview" class="custom-preview" hidden><div class="custom-preview-heading"><strong data-custom="preview-filename"></strong><span data-custom="preview-count"></span></div><p class="custom-help">预览坐标已统一显示为度；同名、同坐标、同坐标系的重复记录会跳过。</p><div data-custom="preview-rows" class="custom-preview-rows"></div><div class="custom-pagination"><span data-custom="preview-page"></span><button type="button" class="quiet-button" data-custom="preview-previous">上一页</button><button type="button" class="quiet-button" data-custom="preview-next">下一页</button></div><div class="custom-import-actions"><button type="button" class="text-button" data-custom="cancel-import">取消导入</button><button type="button" class="primary-button" data-custom="append">确认追加</button></div></div>
      </section>
      <p data-custom="message" class="custom-message" role="status" aria-live="polite"></p>
      <section class="custom-library" aria-label="已添加的自定义源"><div class="custom-library-heading"><div><h3>我的源表 <span data-custom="total"></span></h3><p>加入后可在源表、天空分布和单夜规划中使用。</p></div><button type="button" class="text-button" data-custom="export">导出 CSV ↓</button></div><label class="custom-search"><span>搜索自定义源</span><input type="search" data-custom="search" placeholder="按源名称或备注查找" autocomplete="off"></label><div data-custom="list" class="custom-list"></div><div class="custom-pagination" data-custom="pagination"><span data-custom="page"></span><button type="button" class="quiet-button" data-custom="previous">上一页</button><button type="button" class="quiet-button" data-custom="next">下一页</button></div></section>`;
    document.body.append(dialog);
    find('close').onclick = close;
    dialog.addEventListener('cancel', event => {event.preventDefault();close();});
    for (const nextMode of ['manual','import']) find(`mode-${nextMode}`).onclick = () => {mode=nextMode;message();refresh();};
    find('manual').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      try {
        const source = normalizeCustomSource({name:find('name').value,ra:find('ra').value,dec:find('dec').value,frame:find('frame').value,ra_unit:find('unit').value,notes:find('notes').value});
        const merged = mergeCustomSources(getSources(),[source]);
        if (!merged.added) {message('这个名称和坐标的源已在自定义源表中，无需重复添加。');return;}
        await save(merged.sources,() => {
          find('manual').reset();page=0;find('search').value='';
          message(`已添加「${source.name}」。可在下方打开单夜规划。`);
        });
      } catch (error) {message(error.message || '坐标未能识别，请检查输入。',true);}
    };
    find('file').onchange = async event => {
      const file = event.target.files[0], request = ++fileRequest;
      preview=[];filename='';previewPage=0;message();
      if (!file) {refresh();return;}
      reading=true;refresh();message('正在本地读取并检查源表…');
      try {
        if (file.size>CUSTOM_CATALOG_LIMITS.bytes) throw new Error('文件超过大小限制，请拆分后导入。');
        const value = await file.text();
        if (request!==fileRequest) return;
        const sources = parseCustomCatalog(value,file.name);
        mergeCustomSources(getSources(),sources);
        preview=sources;filename=file.name;message('文件已检查，请核对下方预览后确认追加。');
      } catch (error) {if(request===fileRequest)message(error.message || '源表未能读取，请检查文件格式。',true);}
      finally {if(request===fileRequest){reading=false;find('file').value='';refresh();}}
    };
    find('append').onclick = async () => {
      if (busy||reading||!preview.length) return;
      try {
        const merged=mergeCustomSources(getSources(),preview);
        if (!merged.added) {message('所有记录都已存在，无需重复追加。');return;}
        await save(merged.sources,() => {
          clearPreview();page=0;find('search').value='';
          message(`已追加 ${merged.added} 个自定义源${merged.duplicates?`，跳过 ${merged.duplicates} 条重复记录`:''}。`);
        });
      } catch (error) {message(error.message || '源表未能追加，请重试。',true);}
    };
    find('cancel-import').onclick = () => {clearPreview();message();refresh();};
    find('search').oninput = () => {page=0;renderList();};
    find('previous').onclick = () => {page--;renderList();};
    find('next').onclick = () => {page++;renderList();};
    find('preview-previous').onclick = () => {previewPage--;renderPreview();};
    find('preview-next').onclick = () => {previewPage++;renderPreview();};
    find('template').onclick = () => download('LACT-custom-sources-template.csv','name,ra,dec,frame,ra_unit,notes\r\n示例目标,120,30,FK5/J2000,deg,\r\n');
    find('export').onclick = () => download('LACT-custom-sources.csv',serializeCustomCatalog(getSources()));
    find('list').onclick = async event => {
      const button=event.target.closest('button[data-custom-action]');
      if(!button||busy)return;
      const source=getSources().find(item=>item.id===button.dataset.sourceId);
      if(!source)return;
      if(button.dataset.customAction==='use'){close();onUse(source.id);return;}
      const reason=canRemove(source);
      if(reason){message(reason,true);refresh();return;}
      await save(getSources().filter(item=>item.id!==source.id),()=>message(`已移除「${source.name}」。`));
    };
  }

  async function save(sources, afterSave) {
    busy=true;message('正在保存到当前浏览器…');refresh();
    try {
      if(await onChange(sources)===false){message('保存未完成，原有自定义源仍保留。',true);return;}
      afterSave();
    } catch(error){message(error.message||'保存未完成，请重试。',true);}
    finally{busy=false;refresh();}
  }
  function clearPreview(){fileRequest++;reading=false;preview=[];filename='';previewPage=0;find('file').value='';}
  function paginate(rows,currentPage){const pages=Math.max(1,Math.ceil(rows.length/pageSize));return{pages,page:Math.max(0,Math.min(currentPage,pages-1))};}
  function renderPreview(){
    find('preview').hidden=!preview.length;
    if(!preview.length)return;
    const pagination=paginate(preview,previewPage);previewPage=pagination.page;
    find('preview-filename').textContent=filename;
    try {
      const merged=mergeCustomSources(getSources(),preview);
      find('preview-count').textContent=`${preview.length} 条记录 · 新增 ${merged.added} · 重复 ${merged.duplicates}`;
      find('append').disabled=busy||reading||!merged.added;
      find('append').textContent=`确认追加 ${merged.added} 个源`;
    } catch(error){find('preview-count').textContent=error.message;find('append').disabled=true;}
    find('preview-rows').innerHTML=preview.slice(previewPage*pageSize,(previewPage+1)*pageSize).map(source=>`<div class="custom-preview-row"><strong>${esc(source.name)}</strong><span>${esc(coordinates(source))}</span><small>${esc(frame(source))}</small></div>`).join('');
    find('preview-page').textContent=`第 ${previewPage+1} / ${pagination.pages} 页`;
    find('preview-previous').disabled=busy||previewPage===0;
    find('preview-next').disabled=busy||previewPage>=pagination.pages-1;
  }
  function renderList(){
    const sources=getSources(),query=find('search').value.trim().toLocaleLowerCase();
    const rows=sources.filter(source=>`${source.name} ${source.notes||''}`.toLocaleLowerCase().includes(query));
    const pagination=paginate(rows,page);page=pagination.page;
    find('total').textContent=`${sources.length}`;
    find('export').disabled=busy||!sources.length;
    find('list').innerHTML=rows.length?rows.slice(page*pageSize,(page+1)*pageSize).map(source=>{
      const reason=canRemove(source);
      return `<article class="custom-source"><div class="custom-source-info"><strong>${esc(source.name)}</strong><span>${esc(coordinates(source))}</span><small>${esc(frame(source))}</small>${source.notes?`<p>${esc(source.notes)}</p>`:''}${reason?`<p class="custom-in-use">${esc(reason)}</p>`:''}</div><div class="custom-source-actions"><button type="button" class="quiet-button" data-custom-action="use" data-source-id="${esc(source.id)}" ${busy?'disabled':''}>单夜规划 ↗</button><button type="button" class="text-button custom-remove" data-custom-action="remove" data-source-id="${esc(source.id)}" aria-label="移除 ${esc(source.name)}" ${busy||reason?'disabled':''}>移除</button></div></article>`;
    }).join(''):`<div class="custom-empty"><span>${query?'没有匹配的自定义源':'还没有自定义源'}</span><p>${query?'换个名称或备注关键词试试。':'输入一个坐标，或导入自己的目标列表。'}</p></div>`;
    find('pagination').hidden=!rows.length;
    find('page').textContent=`${rows.length} 个源 · 第 ${page+1} / ${pagination.pages} 页`;
    find('previous').disabled=busy||page===0;
    find('next').disabled=busy||page>=pagination.pages-1;
  }
  function refresh(){
    if(!dialog)return;
    for(const key of ['manual','import']){find(key).hidden=mode!==key;find(`mode-${key}`).setAttribute('aria-pressed',String(mode===key));find(`mode-${key}`).disabled=busy;}
    find('fields').disabled=busy;
    find('file').disabled=busy||reading;
    find('cancel-import').disabled=busy;
    find('search').disabled=busy;
    dialog.setAttribute('aria-busy',String(busy||reading));
    renderPreview();renderList();
  }
  function open(){ensureDialog();refresh();if(!dialog.open)dialog.showModal();}
  function close(){if(dialog?.open)dialog.close();}
  return{open,close,refresh};
}
