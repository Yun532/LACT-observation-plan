const pad = value => String(value).padStart(2,'0');
const hourText = value => value.toFixed(2);
const percentText = (value,total) => total > 0 ? `${(100*value/total).toFixed(1)}%` : '—';
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;

export function createZenithExplorer() {
  let dialog = null, worker = null, currentSource = null, context = null, requestId = 0;
  const find = name => dialog.querySelector(`[data-zenith="${name}"]`);
  function stopWorker() {
    requestId++;
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();worker=null;}
  }
  function close() {
    stopWorker();
    const previous=dialog;
    dialog=null;currentSource=null;context=null;
    if(previous){if(previous.open)previous.close();previous.replaceChildren();previous.remove();}
  }
  function syncControls() {
    find('scope').value=context.scope;
    find('year').value=context.year;
    find('month').value=`${context.year}-${pad(context.month)}`;
    find('date').value=context.date;
    for(const scope of ['year','month','night'])find(`${scope}-field`).hidden=context.scope!==scope;
    const c=context.config, mode=context.scope==='night'?'LACT':c.mode;
    const timezone=`UTC${c.timezone>=0?'+':''}${c.timezone}`;
    const moon=c.moonMode==='warn'?'月距仅提示，不剔除':`月距 > ${c.moon}°${c.moonMode==='up'?'（月在地平线上时）':'（始终限制）'}`;
    find('conditions').textContent=mode==='LHAASO'
      ? `LHAASO · z ≤ ${c.zmax}° · 全天过境，不应用太阳、月亮和暗夜裁剪 · ${timezone}`
      : `LACT · z ≤ ${c.zmax}° · 太阳 < ${c.sun}° · ${moon} · 暗夜两端裁剪 ${c.trim} min · ${timezone}`;
  }
  function fail(message) {
    find('loading').hidden=true;find('result').hidden=true;find('error').hidden=false;
    find('error-text').textContent=message;
    find('body').setAttribute('aria-busy','false');
  }
  function renderResult(result) {
    const {bins,edges,totalHours}=result;
    if(!Array.isArray(bins)||bins.length!==9||!bins.every(value=>Number.isFinite(value)&&value>=0)||!Array.isArray(edges)||edges.length!==10||!edges.every((value,index)=>value===index*10)||!Number.isFinite(totalHours)||totalHours<0||Math.abs(bins.reduce((a,b)=>a+b,0)-totalHours)>1e-7*Math.max(1,totalHours))throw new Error('计算结果不完整，请重试。');
    const low30=bins.slice(0,3).reduce((a,b)=>a+b,0),low50=bins.slice(0,5).reduce((a,b)=>a+b,0);
    find('total').textContent=hourText(totalHours);
    find('low30').textContent=`${hourText(low30)} h`;
    find('low30-share').textContent=percentText(low30,totalHours);
    find('low50').textContent=`${hourText(low50)} h`;
    find('low50-share').textContent=percentText(low50,totalHours);
    find('zero').hidden=totalHours>0;
    const rows=document.createDocumentFragment();
    bins.forEach((hours,index)=>{
      const row=document.createElement('tr'),angle=document.createElement('th'),barCell=document.createElement('td'),duration=document.createElement('td'),share=document.createElement('td');
      angle.scope='row';angle.textContent=`${edges[index]}–${edges[index+1]}°`;
      const track=document.createElement('span'),bar=document.createElement('i');
      track.className='zenith-bar';track.setAttribute('aria-hidden','true');
      bar.style.width=`${totalHours>0?Math.min(100,100*hours/totalHours):0}%`;
      if(index>=5)bar.className='zenith-bar-high';
      track.append(bar);barCell.append(track);duration.textContent=hourText(hours);share.textContent=percentText(hours,totalHours);
      row.append(angle,barCell,duration,share);rows.append(row);
    });
    find('rows').replaceChildren(rows);
    const period=result.scope==='year'?`${result.year} 全年`:result.scope==='month'?`${result.year} 年 ${result.month} 月`:`${result.date} 观测夜`;
    find('period').textContent=period;
    const interval=result.scope==='night'?'当日 18:00 至次日 08:00':result.mode==='LHAASO'?'每天 00:00–24:00':'每天正午至次日正午';
    find('sampling').textContent=`${period} · ${result.mode} · ${result.step} min 采样 · ${interval}。`;
    find('loading').hidden=true;find('error').hidden=true;find('result').hidden=false;
    find('body').setAttribute('aria-busy','false');
  }
  function calculate() {
    stopWorker();syncControls();
    find('result').hidden=true;find('rows').replaceChildren();find('error').hidden=true;
    find('loading').hidden=false;find('progress').value=0;
    find('loading-text').textContent='正在计算符合观测条件的天顶角分布…';
    find('body').setAttribute('aria-busy','true');
    const invalidYear=!Number.isInteger(context.year)||context.year<2000||context.year>2100;
    const invalidMonth=!Number.isInteger(context.month)||context.month<1||context.month>12;
    const invalidNight=!validDate(context.date)||context.date<'2000-01-01'||context.date>'2100-12-31';
    if((context.scope==='year'&&invalidYear)||(context.scope==='month'&&(invalidYear||invalidMonth))||(context.scope==='night'&&invalidNight)){
      fail('请选择 2000 至 2100 年范围内的有效日期。');return;
    }
    const id=requestId, activeDialog=dialog;
    try{
      const activeWorker=new Worker(new URL('./visibility-worker.js',import.meta.url),{type:'module'});
      worker=activeWorker;
      activeWorker.onmessage=({data})=>{
        if(id!==requestId||worker!==activeWorker||dialog!==activeDialog||!dialog.open||data.id!==id)return;
        if(data.type==='progress'){
          const percent=Number.isFinite(data.percent)?Math.max(0,Math.min(100,data.percent)):0;
          find('progress').value=percent;
          find('loading-text').textContent=`正在计算天顶角分布… ${percent}%`;
        } else if(data.type==='error'){
          stopWorker();fail(data.error||'计算未完成，请重试。');
        } else if(data.type==='result'){
          stopWorker();
          try{renderResult(data.result);}catch(error){fail(error.message);}
        }
      };
      activeWorker.onerror=event=>{
        if(id!==requestId||worker!==activeWorker||dialog!==activeDialog)return;
        event.preventDefault();stopWorker();fail('计算进程未能完成，请重试。');
      };
      activeWorker.postMessage({id,type:'zenith-distribution',scope:context.scope,year:context.year,month:context.month,date:context.date,sources:[{id:currentSource.id,ra:currentSource.ra,dec:currentSource.dec}],config:{...context.config}});
    }catch(error){stopWorker();fail(error.message||'无法启动计算，请重试。');}
  }
  function open(source, input) {
    close();
    const c={...input.config};
    const now=new Date(Date.now()+(Number(c.timezone)||0)*3600000).toISOString().slice(0,10);
    currentSource={id:source.id,name:String(source.name||source.id),catalog:String(source.catalog||''),ra:source.ra,dec:source.dec};
    context={scope:['year','month','night'].includes(input.scope)?input.scope:'year',year:Number(input.year)||Number(now.slice(0,4)),month:Number(input.month)||Number(now.slice(5,7)),date:input.date||now,config:c};
    dialog=document.createElement('dialog');dialog.className='zenith-dialog';
    dialog.setAttribute('aria-labelledby','zenith-heading');
    dialog.innerHTML=`<div class="zenith-heading"><div><div class="zenith-eyebrow">AVAILABLE OBSERVING TIME</div><h2 id="zenith-heading">天顶角分布</h2></div><button type="button" class="icon-button" data-zenith="close" aria-label="关闭天顶角分布">×</button></div>
      <div class="zenith-source"><strong data-zenith="source-name"></strong><span data-zenith="source-meta"></span></div>
      <div class="zenith-controls"><label>统计范围<select data-zenith="scope"><option value="year">全年</option><option value="month">整月</option><option value="night">单夜</option></select></label><label data-zenith="year-field">年份<input type="number" data-zenith="year" min="2000" max="2100" step="1" required></label><label data-zenith="month-field">月份<input type="month" data-zenith="month" min="2000-01" max="2100-12" required></label><label data-zenith="night-field">观测夜<input type="date" data-zenith="date" min="2000-01-01" max="2100-12-31" required></label></div>
      <p class="zenith-conditions" data-zenith="conditions"></p>
      <div data-zenith="body" aria-busy="true"><div class="zenith-loading" data-zenith="loading" role="status"><p data-zenith="loading-text"></p><progress data-zenith="progress" max="100" value="0" aria-label="天顶角分布计算进度"></progress></div>
      <div class="zenith-error" data-zenith="error" hidden><p data-zenith="error-text" role="alert"></p><button type="button" class="quiet-button" data-zenith="retry">重新计算</button></div>
      <section data-zenith="result" hidden aria-label="天顶角分布结果"><div class="zenith-summary"><div><span>可用总时长</span><strong><b data-zenith="total"></b><small> h</small></strong><em data-zenith="period"></em></div><div><span>z &lt; 30°</span><strong data-zenith="low30"></strong><em data-zenith="low30-share"></em></div><div><span>z &lt; 50°</span><strong data-zenith="low50"></strong><em data-zenith="low50-share"></em></div></div>
      <p class="zenith-zero" data-zenith="zero" hidden>本范围内没有满足当前条件的可用时间。可更换日期，或在观测参数中调整条件后重新查看。</p>
      <table class="zenith-table"><caption>横条长度与百分比均表示占全部可用时间的比例</caption><thead><tr><th scope="col">天顶角</th><th scope="col">时长分布</th><th scope="col">时长 / h</th><th scope="col">占比</th></tr></thead><tbody data-zenith="rows"></tbody></table>
      <p class="zenith-sampling" data-zenith="sampling"></p></section></div>
      <div class="zenith-note">这里统计满足天顶角、暗夜和月距等当前条件的可用时间；不代表已安排的观测时长、实际曝光或探测灵敏度。每档宽 10°，边界值计入后一档（90° 除外）。</div>`;
    find('source-name').textContent=currentSource.name;
    find('source-meta').textContent=`${currentSource.catalog}${currentSource.catalog?' · ':''}RA ${Number(currentSource.ra).toFixed(3)}° · Dec ${Number(currentSource.dec).toFixed(3)}°`;
    const activeDialog=dialog;
    find('close').onclick=close;find('retry').onclick=calculate;
    activeDialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog===activeDialog)close();});
    activeDialog.addEventListener('close',()=>{if(dialog===activeDialog)close();});
    find('scope').onchange=event=>{context.scope=event.target.value;calculate();};
    find('year').onchange=event=>{context.year=Number(event.target.value);calculate();};
    find('month').onchange=event=>{const [year,month]=event.target.value.split('-').map(Number);context.year=year;context.month=month;calculate();};
    find('date').onchange=event=>{context.date=event.target.value;calculate();};
    document.body.append(activeDialog);activeDialog.showModal();calculate();
  }
  return {open,close};
}
