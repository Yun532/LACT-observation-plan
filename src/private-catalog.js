import { isMap, isScalar, parseDocument, visit } from 'yaml';

export const PRIVATE_CATALOG_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, sources: 2000, string: 2048, nodes: 200000, depth: 20 });
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };

// Keep error messages independent of catalog contents: an error must not echo a
// private name, measurement, source line or local template path into diagnostics.
function validateJSON(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > PRIVATE_CATALOG_LIMITS.nodes || depth > PRIVATE_CATALOG_LIMITS.depth) fail('源表结构过大或嵌套过深');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('源表含非有限数值');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > PRIVATE_CATALOG_LIMITS.string || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('源表文字字段过长或含控制字符');
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validateJSON(child, depth + 1, budget);
    return;
  }
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('源表含不支持的数据类型');
  for (const [key, child] of Object.entries(value)) {
    if (blockedKeys.has(key) || key.length > 256 || /[\u0000-\u001f\u007f]/u.test(key)) fail('源表含不安全或过长的字段名');
    validateJSON(child, depth + 1, budget);
  }
}

function coordinate(value) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || !value.every(Number.isFinite)) fail('位置参数须为数值或三个有限数值组成的数组');
    return value[0];
  }
  if (!Number.isFinite(value)) fail('源表缺少有效的位置参数');
  return value;
}

function position(ra, dec) {
  const result = { ra: coordinate(ra), dec: coordinate(dec) };
  if (result.ra < 0 || result.ra >= 360 || Math.abs(result.dec) > 90) fail('源表赤经或赤纬超出角度范围');
  return result;
}

function shape(spatial, suffix = '', template = false) {
  const parameters = {};
  for (const key of [`ext${suffix}`, suffix ? `ext${suffix}_err` : 'ext_err', 'a_deg', 'alpha', 'b2a']) {
    if (Object.hasOwn(spatial, key)) parameters[key] = spatial[key];
  }
  if (template) parameters.ra_dec_ext = spatial.ra_dec_ext;
  if (!Object.keys(parameters).length) return null;
  const extent = spatial[`ext${suffix}`];
  // The catalog owner confirmed ext as the 2-D Gaussian template sigma, in
  // degrees. Apply that convention only to explicitly Gaussian components.
  // Error-array order and upper limits remain unspecified and are not inferred.
  if (!template && ['gaussian', 'two_gaussian'].includes(spatial.spatial_type) && extent !== undefined && extent !== null) {
    const sigmaDeg = Array.isArray(extent) ? extent[0] : extent;
    if (!Number.isFinite(sigmaDeg) || sigmaDeg < 0 || sigmaDeg > 180) fail('高斯展宽 σ 必须为 0 至 180 度的有限数值');
    return {
      kind: 'gaussian-sigma', sigmaDeg, unit: 'deg', model: spatial.spatial_type,
      uncertainty: {
        values: Array.isArray(extent) ? extent.slice(1) : null,
        errorField: spatial[suffix ? `ext${suffix}_err` : 'ext_err'] ?? null,
        unit: 'deg', convention: 'catalog-order-uninterpreted',
      },
      upperLimit: null, confidence: null, parameters, definition: 'catalog-owner-confirmed',
    };
  }
  // Elliptical and file-template shapes require their own definitions. A
  // position error never becomes a source extension or a sky mask.
  return { kind: 'catalog-undefined', model: spatial.spatial_type ?? null, parameters, definition: 'not-specified-in-file' };
}

function uncertainty(ra, dec) {
  return {
    ra: Array.isArray(ra) ? ra.slice(1) : null,
    dec: Array.isArray(dec) ? dec.slice(1) : null,
    unit: 'deg', convention: 'catalog-order-uninterpreted',
  };
}

function normalizeSource(rawName, data) {
  const name = rawName.normalize('NFKC').trim();
  if (!name || name.length > 256 || !isRecord(data) || !isRecord(data.spatial_model)) fail('源记录缺少名称或空间模型');
  const spatial = data.spatial_model;
  const hasMain = Object.hasOwn(spatial, 'ra') || Object.hasOwn(spatial, 'dec');
  const template = !hasMain;
  let primary;
  if (hasMain) primary = position(spatial.ra, spatial.dec);
  else {
    if (!Array.isArray(spatial.ra_dec_ext) || spatial.ra_dec_ext.length !== 3 || !spatial.ra_dec_ext.every(Number.isFinite)) fail('源记录缺少主位置或模板位置');
    primary = position(spatial.ra_dec_ext[0], spatial.ra_dec_ext[1]);
  }
  const extension = shape(spatial, '', template);
  const components = [{
    id: 'primary', label: template ? '模板参考位置' : '主空间分量', detector: null, detected: null,
    ...primary, positionUncertainty: template ? null : uncertainty(spatial.ra, spatial.dec), extension, ts: null,
  }];
  if (Object.hasOwn(spatial, 'ra1') || Object.hasOwn(spatial, 'dec1')) {
    components.push({
      id: 'secondary', label: '附加空间分量', detector: null, detected: null,
      ...position(spatial.ra1, spatial.dec1), positionUncertainty: uncertainty(spatial.ra1, spatial.dec1),
      extension: shape(spatial, '1'), ts: null,
    });
  }
  if (data.statistics?.TS !== undefined && !Number.isFinite(data.statistics.TS)) fail('源级 TS 必须为有限数值');
  for (const key of ['sed_model', 'each_bin', 'statistics']) {
    if (data[key] !== undefined && !isRecord(data[key])) fail('源记录的科学字段结构无效');
  }
  const baseName = name.replace(/^2LHAASO\s+/iu, '');
  return {
    id: 'private:2lhaaso:' + encodeURIComponent(baseName.toLowerCase()),
    name: /^2LHAASO\s+/iu.test(name) ? name : `2LHAASO ${name}`,
    catalog: '2LHAASO', private: true, status: 'private', defaultIncluded: true,
    ...primary, coordinateComponent: components[0].label, coordinateFrame: 'FK5/J2000',
    coordinateNote: template ? '采用空间模板 ra_dec_ext 的前两项作为参考位置；已确认赤经、赤纬为 FK5/J2000，单位度。' : '采用主空间分量 ra/dec 的首项；已确认赤经、赤纬为 FK5/J2000，单位度；误差数组按原顺序保留。',
    type: '未分类', aliases: [rawName], reference: null,
    flux: null, extension, components,
    spatialType: spatial.spatial_type ?? null,
    spectrum: data.sed_model ?? null, statistics: data.statistics ?? null,
    // This object stays in browser memory. Retain units, model parameters,
    // uncertainties and template references exactly; never fetch template paths.
    catalogData: data,
  };
}

function canonicalRecord(input) {
  return Array.isArray(input) ? input.map(canonicalRecord) : isRecord(input)
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonicalRecord(input[key])])) : input;
}

function recordKey(serialized) {
  // A stable identity suffix, not encryption or a privacy boundary. Collisions
  // are checked below; the full-file security fingerprint is computed by WebCrypto.
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(serialized)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

/** Parse the source_dict YAML entirely in memory. No storage, network or logs. */
export function parsePrivateCatalog(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) fail('请选择非空的 YAML 源表');
  if (text.length > PRIVATE_CATALOG_LIMITS.bytes || new TextEncoder().encode(text).length > PRIVATE_CATALOG_LIMITS.bytes) fail('源表文件不能超过 2 MiB');
  let doc;
  try {
    doc = parseDocument(text, { version: '1.2', schema: 'core', strict: true, uniqueKeys: false, merge: false, prettyErrors: false });
    if (doc.errors.length || doc.warnings.length) fail('invalid');
  } catch {
    fail('YAML 无法解析：请检查语法、重复字段及不受支持的标签或别名');
  }
  const records = isMap(doc.contents) ? doc.get('source_dict', true) : null;
  if (!isMap(records)) fail('源表需要顶层 source_dict 名称映射');
  // YAML maps can repeat source names. Read their AST pairs directly so no
  // earlier scientific record is silently overwritten by object conversion.
  visit(doc, {
    Alias() { fail('源表不支持 YAML 别名'); },
    Seq(_key, _node, path) { if (path.length > PRIVATE_CATALOG_LIMITS.depth * 2) fail('源表嵌套过深'); },
    Map(_key, node, path) {
      if (path.length > PRIVATE_CATALOG_LIMITS.depth * 2) fail('源表嵌套过深');
      const seen = new Set();
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') fail('源表字段名必须为文字');
        const key = pair.key.value;
        if (blockedKeys.has(key)) fail('源表含不安全的字段名');
        if (seen.has(key) && node !== records) fail('源表含重复字段；仅允许保留同名源的独立记录');
        seen.add(key);
      }
    },
  });
  const entries = records.items.map(pair => [pair.key.value, pair.value?.toJS(doc, { maxAliasCount: 0 }) ?? null]);
  const metadata = Object.fromEntries(doc.contents.items.filter(pair => pair.value !== records).map(pair => [pair.key.value, pair.value?.toJS(doc, { maxAliasCount: 0 }) ?? null]));
  validateJSON({ entries, metadata });
  if (!entries.length || entries.length > PRIVATE_CATALOG_LIMITS.sources) fail('源表记录数须在 1 至 2000 之间');
  const sources = entries.map(([name, record]) => normalizeSource(name, record));
  const byName = new Map();
  for (const source of sources) {
    if (!byName.has(source.id)) byName.set(source.id, []);
    byName.get(source.id).push(source);
  }
  let repeatedNames = false;
  for (const group of byName.values()) if (group.length > 1) {
    repeatedNames = true;
    const hashes = new Map();
    for (const [index, source] of group.entries()) {
      const serialized = JSON.stringify(canonicalRecord(source.catalogData)), key = recordKey(serialized);
      const previous = hashes.get(key);
      if (previous && previous.serialized !== serialized) fail('同名源标识冲突，请先整理源表');
      const occurrence = (previous?.occurrence ?? 0) + 1;
      hashes.set(key, { serialized, occurrence });
      source.id += `:variant:${key}${occurrence > 1 ? ':' + occurrence : ''}`;
      source.name += `〔同名记录 ${index + 1}〕`;
      source.duplicateName = true;
    }
  }
  return {
    meta: {
      schemaVersion: 1, private: true, catalog: '2LHAASO',
      filename: String(filename).split(/[\\/]/u).pop().slice(0, 255),
      coordinateFrame: 'FK5/J2000',
      fieldDefinitions: {
        'ra/dec': { unit: 'deg', frame: 'FK5/J2000' },
        'l/b': { unit: 'deg', frame: 'Galactic' },
        'ext/ext_err': { unit: 'deg', interpretation: '二维高斯空间模板 σ 及其误差；误差数组顺序保持原样' },
        'p_err(95%)': { unit: 'deg', interpretation: '95% 定位误差，与源展宽分开' },
        provenance: 'catalog-owner-confirmed',
      },
      catalogs: [{ id: '2LHAASO', label: '2LHAASO · 本地非公开源表', recordCount: sources.length, private: true }],
      warnings: repeatedNames ? ['源表含同名源记录，已分别保留并标记；未自动覆盖、合并或判断哪条有效。'] : [],
      notes: [
        '已确认 ra/dec 为 FK5/J2000 赤经、赤纬，单位度；l/b 为银经、银纬，单位度。主位置采用 ra/dec，模板采用 ra_dec_ext 的前两项。',
        'TS 为源级统计量；文件没有分量级 TS，不据此比较空间分量。',
        '保留误差数组的原顺序，不推定其上下误差约定、置信度、能量和流强单位。',
        '已确认 ext/ext_err 的单位为度，ext 是二维高斯空间模板 σ；双高斯分量分别保留各自的 σ，不由误差数组推断上限。',
        'p_err(95%) 为 95% 定位误差，不作为源展宽。椭圆与文件模板的其他尺度仍按原字段保留，模板路径不自动加载。',
      ],
    },
    sources,
  };
}
