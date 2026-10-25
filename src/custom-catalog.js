import { isScalar, parseDocument, visit } from 'yaml';

export const CUSTOM_CATALOG_KEY = 'lact.custom-catalog.v1';
export const CUSTOM_CATALOG_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, sources: 1000 });
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const fail = message => { throw new Error(message); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keyName = key => key.toLowerCase().replaceAll('_', '');
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function validate(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 50000 || depth > 8) fail('自定义源表过大或嵌套过深');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('源表包含非有限数值'); return; }
  if (typeof value === 'string') { if (value.length > 4096 || control.test(value)) fail('源表文字过长或含控制字符'); return; }
  if (Array.isArray(value)) { for (const child of value) validate(child, depth + 1, budget); return; }
  if (!isRecord(value) || Object.keys(value).length > 32) fail('每条源记录须为不超过 32 个字段的对象');
  for (const [key, child] of Object.entries(value)) {
    if (blockedKeys.has(key.toLowerCase()) || key.length > 64 || /[\u0000-\u001f\u007f]/u.test(key)) fail('源表包含不安全的字段名');
    validate(child, depth + 1, budget);
  }
}

function textField(value, limit, fallback = '') {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') fail('名称、类型和备注须为文字');
  const text = value.normalize('NFC').trim();
  if (text.length > limit || control.test(text)) fail('名称、类型或备注过长，或含控制字符');
  return text || fallback;
}

function frameName(value) {
  if (value == null || value === '') return 'FK5/J2000';
  if (typeof value !== 'string') fail('坐标系须为 FK5/J2000 或 ICRS');
  const frame = value.toUpperCase().replace(/[\s_()]/gu, '');
  if (!frame) return 'FK5/J2000';
  if (['FK5/J2000', 'FK5', 'J2000', 'FK5J2000', 'FK5/J2000.0', 'J2000.0'].includes(frame)) return 'FK5/J2000';
  if (frame === 'ICRS') return 'ICRS';
  fail('仅支持 FK5/J2000 或 ICRS 坐标系');
}

function raUnit(value) {
  if (value == null || value === '') return 'deg';
  if (typeof value !== 'string') fail('赤经单位须为 deg 或 hour');
  const unit = value.toLowerCase().trim();
  if (!unit) return 'deg';
  if (['deg', 'degree', 'degrees', '度'].includes(unit)) return 'deg';
  if (['hour', 'hours', 'h', '时'].includes(unit)) return 'hour';
  fail('赤经单位须为 deg 或 hour');
}

function coordinate(value, isRA, unit = 'deg') {
  const label = isRA ? '赤经' : '赤纬';
  let result;
  if (typeof value === 'number') result = value * (isRA && unit === 'hour' ? 15 : 1);
  else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) fail(`${label}不能为空`);
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)) result = Number(text) * (isRA && unit === 'hour' ? 15 : 1);
    else {
      const match = /^([+-]?)(\d{1,3})(?::|\s+)(\d{1,2})(?::|\s+)(\d{1,2}(?:\.\d*)?)$/u.exec(text);
      if (!match) fail(`${label}须为十进制度数或三个分量的时分秒／度分秒`);
      const [, sign, major, minute, second] = match;
      if (+minute >= 60 || +second >= 60 || (isRA && (sign === '-' || +major >= 24))) fail(`${label}的时分秒／度分秒超出范围`);
      result = (+major + +minute / 60 + +second / 3600) * (sign === '-' ? -1 : 1) * (isRA ? 15 : 1);
    }
  } else fail(`${label}须为有效坐标`);
  if (!Number.isFinite(result) || (isRA ? result < 0 || result >= 360 : Math.abs(result) > 90)) fail(`${label}超出范围：RA 为 [0,360) 度，Dec 为 [-90,90] 度`);
  return result === 0 ? 0 : result;
}

/** Normalize either an import record or a previously saved custom source. */
export function normalizeCustomSource(record) {
  validate(record);
  if (!isRecord(record)) fail('每条自定义源须包含 ra 和 dec 字段');
  const fields = new Map();
  for (const [key, value] of Object.entries(record)) {
    const normalized = keyName(key);
    if (fields.has(normalized)) fail('源记录包含重复字段');
    fields.set(normalized, value);
  }
  const frame = frameName(fields.get('frame') ?? fields.get('coordinateframe'));
  if (fields.has('frame') && fields.has('coordinateframe') && frame !== frameName(fields.get('coordinateframe'))) fail('源记录的坐标系字段相互冲突');
  const ra = coordinate(fields.get('ra'), true, raUnit(fields.get('raunit')));
  const dec = coordinate(fields.get('dec'), false);
  const encoding = fields.get('textencoding');
  if (encoding != null && encoding !== '' && encoding !== 'apostrophe-v1') fail('不支持该源表的文字编码标记');
  const decode = value => encoding === 'apostrophe-v1' && typeof value === 'string' && /^'[=+\-@']/u.test(value) ? value.slice(1) : value;
  const name = textField(decode(fields.get('name')), 256, `目标 ${ra}° ${dec >= 0 ? '+' : ''}${dec}°`);
  return {
    id: `custom:${encodeURIComponent(JSON.stringify([frame, ra, dec, name]))}`,
    name, catalog: '自定义', custom: true, status: 'custom', defaultIncluded: true,
    ra, dec, coordinateFrame: frame,
    type: textField(decode(fields.get('type')), 128, '未分类'), aliases: [],
    flux: null, extension: null, notes: textField(decode(fields.get('notes')), 2048),
  };
}

export const isCustomId = id => typeof id === 'string' && id.startsWith('custom:');

function csvRecords(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { if (field.length > 4096) fail('CSV 字段过长'); row.push(field); if (row.length > 32) fail('CSV 字段数不能超过 32'); field = ''; closed = false; };
  const pushRow = () => { pushField(); if (row.some(cell => cell.trim())) rows.push(row); row = []; if (rows.length > CUSTOM_CATALOG_LIMITS.sources + 1) fail('自定义源不能超过 1000 条'); };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += character;
    } else if (character === ',') pushField();
    else if (character === '\n' || character === '\r') { if (character === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (closed) { if (!/[ \t]/u.test(character)) fail('CSV 引号后只能是分隔符或换行'); }
    else if (character === '"') { if (field.trim()) fail('CSV 引号格式不正确'); field = ''; quoted = true; }
    else field += character;
    if (field.length > 4096) fail('CSV 字段过长');
  }
  if (quoted) fail('CSV 存在未闭合的引号');
  if (field || row.length || closed) pushRow();
  const header = rows.shift()?.map(cell => cell.trim());
  if (!header || !header.length || header.some(key => !key || key.length > 64 || blockedKeys.has(key.toLowerCase())) || new Set(header.map(keyName)).size !== header.length) fail('CSV 表头为空、重复或包含不安全字段');
  if (!header.some(key => keyName(key) === 'ra') || !header.some(key => keyName(key) === 'dec')) fail('CSV 表头必须包含 ra 和 dec');
  return rows.map((values, index) => {
    if (values.length !== header.length) fail(`CSV 第 ${index + 2} 行的字段数与表头不一致`);
    return Object.fromEntries(header.map((key, column) => [key, values[column]]));
  });
}

function yamlRecords(text) {
  let doc;
  try {
    doc = parseDocument(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: true, merge: false, prettyErrors: false });
    if (doc.errors.length || doc.warnings.length) fail('invalid');
  } catch { fail('YAML 无法解析：请检查语法、重复字段和不受支持的标签'); }
  let nodes = 0;
  visit(doc, {
    Node(_key, _node, path) { if (++nodes > 50000 || path.length > 20) fail('源表过大或嵌套过深'); },
    Alias() { fail('自定义源表不支持 YAML 别名'); },
    Map(_key, node, path) {
      if (path.length > 20 || node.items.length > 32) fail('源表字段过多或嵌套过深');
      for (const pair of node.items) if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || blockedKeys.has(pair.key.value.toLowerCase())) fail('YAML 字段名须为安全的文字');
    },
  });
  const value = doc.toJS({ maxAliasCount: 0 });
  validate(value);
  const records = Array.isArray(value) ? value : value?.sources;
  if (!Array.isArray(records)) fail('YAML 须为源记录数组，或包含 sources 数组');
  return records;
}

/** Local-only parsing; never uploads or logs input contents. */
export function parseCustomCatalog(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) fail('请选择非空的 CSV 或 YAML 源表');
  if (text.length > CUSTOM_CATALOG_LIMITS.bytes || new TextEncoder().encode(text).length > CUSTOM_CATALOG_LIMITS.bytes) fail('自定义源表不能超过 2 MiB');
  const clean = text.replace(/^\uFEFF/u, '');
  const extension = String(filename).toLowerCase().split('.').pop();
  const records = extension === 'csv' || (!['yaml', 'yml', 'json'].includes(extension) && !/^\s*(?:sources\s*:|\[|\{|-(?:\s|$))/u.test(clean)) ? csvRecords(clean) : yamlRecords(clean);
  if (!records.length || records.length > CUSTOM_CATALOG_LIMITS.sources) fail('自定义源表须包含 1 至 1000 条记录');
  return records.map((record, index) => {
    try { return normalizeCustomSource(record); }
    catch (error) { fail(`第 ${index + 1} 条源记录：${error.message}`); }
  });
}

/** Keep identities stable; an import never overwrites an existing target. */
export function mergeCustomSources(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) || existing.length > CUSTOM_CATALOG_LIMITS.sources || incoming.length > CUSTOM_CATALOG_LIMITS.sources) fail('自定义源不能超过 1000 条');
  const sources = [], seen = new Set();
  let added = 0, duplicates = 0;
  for (const [group, values] of [existing, incoming].entries()) for (const record of values) {
    const source = normalizeCustomSource(record);
    if (seen.has(source.id)) { if (group === 1) duplicates++; continue; }
    seen.add(source.id); sources.push(source); if (group === 1) added++;
  }
  if (sources.length > CUSTOM_CATALOG_LIMITS.sources) fail('合并后自定义源不能超过 1000 条');
  serializeCustomCatalog(sources);
  return { sources, added, duplicates };
}

/** Apostrophe protection plus an explicit marker makes spreadsheet-safe CSV reversible. */
export function serializeCustomCatalog(sources) {
  if (!Array.isArray(sources) || sources.length > CUSTOM_CATALOG_LIMITS.sources) fail('自定义源不能超过 1000 条');
  const quote = value => `"${String(value).replaceAll('"', '""')}"`;
  const safeText = value => /^[=+\-@']/u.test(value) ? `'${value}` : value;
  const rows = sources.map(record => {
    const source = normalizeCustomSource(record);
    return [safeText(source.name), source.ra, source.dec, source.coordinateFrame, safeText(source.type), safeText(source.notes), 'apostrophe-v1'].map(quote).join(',');
  });
  const csv = '\uFEFFname,ra,dec,frame,type,notes,text_encoding\r\n' + rows.join('\r\n') + '\r\n';
  if (new TextEncoder().encode(csv).length > CUSTOM_CATALOG_LIMITS.bytes) fail('自定义源表导出内容不能超过 2 MiB，请减少备注或分批管理');
  return csv;
}

const planCustomIds = plan => new Set([
  plan?.focus,
  ...(Array.isArray(plan?.visible) ? plan.visible : []),
  ...(Array.isArray(plan?.blocks) ? plan.blocks.map(block => block?.source) : []),
].filter(isCustomId));

function planSource(record) {
  const normalized = normalizeCustomSource(record);
  if (record.id !== normalized.id) fail('计划中的自定义源标识与名称、坐标或坐标系不一致');
  return normalized;
}

/** Include every referenced custom target so a plan is portable to another browser. */
export function customSourcesForPlan(plan, sources) {
  if (!isRecord(plan) || !Array.isArray(sources)) fail('无法读取计划及自定义源');
  const byId = new Map(sources.map(source => [source.id, source]));
  const result = [];
  for (const id of planCustomIds(plan)) {
    const source = byId.get(id);
    if (!source) fail('计划引用的自定义源缺少坐标定义');
    result.push(planSource(source));
  }
  if (result.length > CUSTOM_CATALOG_LIMITS.sources) fail('计划中的自定义源不能超过 1000 条');
  return result;
}

/** Validate definitions before merging; existing target metadata is never overwritten. */
export function mergePlanCustomSources(payload, current) {
  if (!isRecord(payload)) fail('计划格式不正确');
  const definitions = payload.customSources === undefined ? [] : payload.customSources;
  if (!Array.isArray(definitions) || definitions.length > CUSTOM_CATALOG_LIMITS.sources) fail('计划的 customSources 须为不超过 1000 条的源数组');
  const referenced = planCustomIds(payload);
  const incoming = definitions.map(record => {
    const source = planSource(record);
    if (!referenced.has(source.id)) fail('计划包含未被引用的自定义源定义');
    return source;
  });
  const merged = mergeCustomSources(current, incoming).sources;
  const available = new Set(merged.map(source => source.id));
  if ([...referenced].some(id => !available.has(id))) fail('计划引用的自定义源缺少坐标定义，请先导入对应的自定义源表');
  return merged;
}

/** Callers must guard task references first; task definitions and catalog identity stay unchanged. */
export function removeCustomPlanReferences(plan, removedIds, fallbackId = 'tevcat-87') {
  if (!(Array.isArray(removedIds) || removedIds instanceof Set)) fail('无法整理计划的自定义源引用');
  if (!isRecord(plan)) return plan;
  const removed = new Set(removedIds);
  const references = [plan.focus, ...(Array.isArray(plan.visible) ? plan.visible : []), ...(Array.isArray(plan.customSources) ? plan.customSources.map(source => source?.id) : [])];
  if (!references.some(id => removed.has(id))) return plan;
  const visible = (Array.isArray(plan.visible) ? plan.visible : []).filter(id => !removed.has(id));
  let focus = plan.focus;
  if (removed.has(focus)) focus = visible[0] || (Array.isArray(plan.blocks) ? plan.blocks.find(block => block?.source && !removed.has(block.source))?.source : '') || fallbackId;
  if (focus && !visible.includes(focus)) visible.unshift(focus);
  const copy = { ...plan, focus, visible };
  if (Array.isArray(plan.customSources)) copy.customSources = plan.customSources.filter(source => !removed.has(source?.id));
  return copy;
}
