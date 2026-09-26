import { extensionText } from './neighbor-chart.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const finite = Number.isFinite;
const present = value => value !== null && value !== undefined && value !== '';
const text = value => Array.isArray(value) ? value.filter(present).join(' · ') : String(value ?? '');
const number = value => finite(value) ? (value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e5) ? value.toExponential(4).replace(/0+e/, 'e').replace(/\.e/, 'e') : String(Number(value.toPrecision(7)))) : '未提供';
const classes = {
  pwn: '脉冲星风云', snr: '超新星遗迹', psr: '脉冲星', msp: '毫秒脉冲星',
  agn: '活动星系核', bll: 'BL Lac 型耀变体', 'bl lac': 'BL Lac 型耀变体',
  fsrq: '平谱射电类星体', bcu: '类型未定的耀变体候选', hbl: '高同步辐射峰 BL Lac 天体',
  ibl: '中同步辐射峰 BL Lac 天体', lbl: '低同步辐射峰 BL Lac 天体',
  rdg: '射电星系', nlsy1: '窄线 Seyfert 1 星系', css: '致密陡谱射电源',
  ssrq: '陡谱射电类星体', sey: 'Seyfert 星系', bin: '双星系统', hmb: '大质量双星',
  lmb: '低质量双星', spp: '超新星遗迹 / 脉冲星风云候选', sfr: '恒星形成区',
  sbg: '星暴星系', sfg: '恒星形成星系', glc: '球状星团', nov: '新星',
  unid: '未分类', unclassified: '未分类', unknown: '未分类', '未分类': '未分类',
};
function classification(s) {
  const code = text(s.fermi?.classCode || s.type || '未分类').trim();
  const description = classes[code.toLowerCase()];
  return description && description !== code ? `${description} · ${code}` : code;
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function row(label, value, { html = false } = {}) {
  if (!present(value)) return '';
  return `<div class="si-row"><dt>${esc(label)}</dt><dd>${html ? value : esc(value)}</dd></div>`;
}
function card(title, rows, note = '') {
  const content = rows.filter(Boolean).join('');
  return content ? `<section class="si-card"><h3>${esc(title)}</h3><dl>${content}</dl>${note ? `<p class="si-note">${esc(note)}</p>` : ''}</section>` : '';
}
function confidence(value) {
  return finite(value) ? `${number(value <= 1 ? value * 100 : value)}% ` : '';
}
function fluxValue(flux) {
  if (flux?.qualityFlag) return `目录异常值，未作为有效流强使用（${text(flux.qualityFlag)}）；原值见下方字段`;
  if (!flux || !finite(flux.value)) return '';
  const upper = flux.upperLimit === true;
  return `${upper ? '≤ ' : ''}${number(flux.value)}${!upper && finite(flux.error) ? ` ± ${number(flux.error)}` : ''}${flux.unit ? ` ${flux.unit}` : ''}${flux.energy ? ` · ${flux.energy}` : ''}${upper ? `（${confidence(flux.confidence)}上限）` : ''}`;
}
function indexValue(value, error) {
  return finite(value) ? `${number(value)}${finite(error) ? ` ± ${number(error)}` : ''}` : '';
}
function coordinateValue(ra, dec) {
  return finite(ra) && finite(dec) ? `${ra.toFixed(5)}° / ${dec.toFixed(5)}°` : '';
}
function extensionValue(s) {
  if (!s.extension) return '';
  if (s.extension.kind === 'gaussian-r39' && finite(s.extension.radiusDeg)) {
    const e = s.extension;
    return `r39 ${e.upperLimit ? '≤ ' : ''}${number(e.radiusDeg)}°${e.upperLimit ? `（${confidence(e.confidence)}上限）` : ''}`;
  }
  return extensionText(s);
}
function ellipseAxes(ellipse) {
  return finite(ellipse?.semiMajorDeg) && finite(ellipse?.semiMinorDeg) ? `${number(ellipse.semiMajorDeg)}° × ${number(ellipse.semiMinorDeg)}°` : '';
}
function discovery(value) {
  const raw = text(value);
  if (/^\d{6}$/.test(raw) && +raw.slice(4) >= 1 && +raw.slice(4) <= 12) return `${raw.slice(0, 4)} 年 ${+raw.slice(4)} 月`;
  return raw;
}

/** Short, factual text for the atlas inspector. Does not infer astrophysical associations. */
export function sourceSummary(s) {
  return [classification(s), present(s.fermi?.association) ? '关联：'+text(s.fermi.association) : '', present(s.observatory) ? text(s.observatory) : '', present(s.discovery) ? discovery(s.discovery) : ''].filter(Boolean).join(' · ');
}

// No links or interpretation in the raw tree: private template paths and unknown
// model parameters remain inert text, with array ordering and nulls preserved.
function rawTree(value) {
  if (value === null) return '<span class="si-raw-empty">null</span>';
  if (value === undefined) return '<span class="si-raw-empty">未提供</span>';
  if (typeof value !== 'object') return `<span>${esc(value)}</span>`;
  const entries = Object.entries(value);
  if (!entries.length) return `<span class="si-raw-empty">${Array.isArray(value) ? '[]' : '{}'}</span>`;
  return `<dl class="si-raw-tree">${entries.map(([key, v]) => `<div><dt>${esc(key)}</dt><dd>${v && typeof v === 'object' ? `<details><summary>${Array.isArray(v) ? `数组 · ${v.length} 项` : `参数 · ${Object.keys(v).length} 项`}</summary>${rawTree(v)}</details>` : rawTree(v)}</dd></div>`).join('')}</dl>`;
}
function componentInfo(c, i) {
  const name = c.detector || c.label || c.name || `分量 ${i + 1}`;
  return card(name, [
    row('检出状态', c.detected === true ? '目录检出' : c.detected === false ? '目录未检出；上限依各测量标注' : ''),
    row('RA / Dec', coordinateValue(c.ra, c.dec)),
    row('95% 定位误差', finite(c.positionError95Deg) ? `${number(c.positionError95Deg)}°` : ''),
    row('空间尺度', extensionValue(c)), row('流强', fluxValue(c.flux)),
    row('光子指数', indexValue(c.spectralIndex, c.spectralIndexError)),
    row('TS', finite(c.ts) ? number(c.ts) : ''), row('TS > 100 TeV', finite(c.ts100) ? number(c.ts100) : ''),
    row('银河弥散发射影响标记', c.gdeImpact === true ? '原目录标记' : ''),
  ]);
}

/** Escaped, local-only source detail. This function performs no I/O. */
export function renderSourceInfo(s, { related = [] } = {}) {
  if (!s) return '<p class="si-note">未选择源。</p>';
  const f = s.fermi || {}, frame = s.coordinateFrame || (s.private ? 'FK5/J2000' : 'ICRS');
  const aliases = [...new Set((Array.isArray(s.aliases) ? s.aliases : []).map(text).filter(v => v && v !== s.name))];
  const associations = [...new Set([...(Array.isArray(s.associations) ? s.associations : []), s.association].filter(present).map(text))];
  const reference = s.private ? null : safeUrl(s.reference);
  const status = s.private ? '本地私有目录' : s.fermi ? 'LAT 目录记录' : ({ established: '已确认', candidate: '候选', disputed: '有争议', newly_announced: '新发布' }[s.status] || '公开目录');
  const spectrumType = f.spectrumType || s.spectrum?.sed_type || s.spectrum?.type;
  const localIndex = spectrumType === 'LogParabola' || /^PLSuperExpCutoff/.test(spectrumType || '');
  const indexLabel = localIndex ? '枢轴处局部指数' : 'Fermi 光子指数';
  const classCode = text(f.classCode).trim();
  const classBasis = classCode && /^[A-Za-z0-9]+$/.test(classCode) && !['unk', 'unid'].includes(classCode.toLowerCase()) ? (classCode === classCode.toUpperCase() ? '原目录已鉴认类别（大写 CLASS1）' : '原目录关联类别（小写 CLASS1）') : '';
  const spectrumRows = [
    row('能谱模型', spectrumType), row(s.flux?.kind === 'differential' ? '微分流强' : s.flux?.kind === 'integral' ? '积分流强' : '目录流强', fluxValue(s.flux)),
    row('流强分量', s.fluxComponent), row('光子指数', !s.fermi ? indexValue(s.spectralIndex, s.spectralIndexError) : ''),
    row(f.photonIndexField ? `${indexLabel} · ${f.photonIndexField}` : indexLabel, indexValue(f.photonIndex, f.photonIndexError)),
    row('枢轴能量', finite(f.pivotEnergyMeV) ? `${number(f.pivotEnergyMeV)} MeV` : ''),
    row('Fermi 能量流强', f.energyFlux && typeof f.energyFlux === 'object' ? fluxValue(f.energyFlux) : ''),
  ];
  const raw = s.catalogData || Object.fromEntries(Object.entries(s).filter(([key]) => !['name', 'id', 'aliases', 'reference', 'private', 'defaultIncluded', 'plotColor'].includes(key)));
  const relatedRows = related.map(item => {
    const record = item.source || item;
    const distance = finite(item.separation) ? item.separation : item.distance;
    return row(record.name || record.sourceName || record.id || '目录条目', [record.catalog, item.relationship || '目录关联参考', finite(distance) ? `角距 ${number(distance)}°` : ''].filter(present).join(' · '));
  });
  return `<div class="source-info"><div class="si-banner ${s.private ? 'si-private' : ''}"><span class="si-badge">${esc(s.catalog || '源目录')}</span><span>${esc(status)}</span>${reference ? `<a href="${esc(reference)}" target="_blank" rel="noopener noreferrer">原始目录 ↗</a>` : ''}</div><p class="si-description">${esc(sourceSummary(s))}</p><div class="si-grid">${card('身份与关联', [
    row('目录分类', classification(s)), row('分类依据', classBasis), row('标准源名', f.sourceName || s.sourceName),
    row('别名', aliases.length ? `<div class="si-aliases">${aliases.map(v => `<span>${esc(v)}</span>`).join('')}</div>` : '', { html: true }),
    row('目录关联名称', associations.join(' · ')), row('目录关联 · ASSOC1', f.association),
    row('低置信关联 · ASSOC2', f.associationAlt), row('FHL 目录关联', text(f.highEnergyAssociations)),
    row('TeV 关联名称', f.tevAssociation), row('TeVCat 标志', f.tevFlag),
    row('发现仪器', text(s.observatory)), row('发现时间', present(s.discovery) ? discovery(s.discovery) : ''),
  ])}${card('坐标与形态', [
    row('坐标系', frame), row('RA / Dec', coordinateValue(s.ra, s.dec)), row('规划位置分量', s.coordinateComponent),
    row('空间尺度', extensionValue(s)), row('空间模型', s.spatialType),
    row('95% 定位误差', finite(s.positionError95Deg) ? `${number(s.positionError95Deg)}°` : ''),
    row('95% 定位椭圆半轴', ellipseAxes(f.positionError95)),
    row('定位椭圆方位角', finite(f.positionError95?.positionAngleDeg) ? `${number(f.positionError95.positionAngleDeg)}°` : ''),
    row('Fermi 延展模板', f.spatialModel?.name), row('模板空间模型', f.spatialModel?.form || f.spatialModel?.function),
    row('原模型角尺度', ellipseAxes(f.spatialModel)),
    row('模板方位角', finite(f.spatialModel?.positionAngleDeg) ? `${number(f.spatialModel.positionAngleDeg)}°` : ''),
  ], s.coordinateNote || (s.extension || f.positionError95 || f.spatialModel ? '空间展宽与定位误差含义不同；参考圈不是源的硬边界，模型角尺度依原目录定义。' : ''))}${card('能谱与流强', spectrumRows, '数值对应原目录模型与能段。不同能段、模型和单位的流强不能直接比较。')}${card('目录统计', [row('目录版本', f.release), row('平均显著性', finite(f.significance) ? number(f.significance) : ''), row('变异指数', finite(f.variabilityIndex) ? number(f.variabilityIndex) : ''), row('质量标志 Flags', present(f.flags) ? text(f.flags) : ''), row('源级 TS', finite(s.statistics?.TS) ? number(s.statistics.TS) : '')], '这些是目录给出的统计量，不代表今晚亮度、实时活动状态或本网站的观测预测。')}</div>${Array.isArray(s.components) && s.components.length ? `<section class="si-components"><div class="si-section-heading"><h3>分量测量</h3><span>保留各仪器 / 空间分量的原始定义</span></div><div class="si-grid">${s.components.map(componentInfo).join('')}</div></section>` : ''}${relatedRows.length ? card('相关目录条目', relatedRows, '关联名称与角距离分别保留；空间相邻本身不构成同源证据。') : ''}<details class="si-raw"><summary>原始目录字段 <span>保留模型、单位与未解释参数</span></summary>${rawTree(raw)}</details>${s.private ? '<p class="si-privacy-note">非公开源表仅在本机显示；模板路径保持为文字，不请求外部资源。</p>' : ''}</div>`;
}
