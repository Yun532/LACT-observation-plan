/* Geometric observing-plan preview; not telescope control commands. */
export const minutes = 840;
export const defaults = Object.freeze({
  mode: 'LACT', zmax: 70, sun: -13, moon: 40, moonMode: 'strict', trim: 0,
  overhead: 5, minBlock: 20, fov: 3, timezone: 8, startHour: 18,
  latitude: 29.3586111, longitude: 100.1374972, elevation: 4410,
});

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = Number.isFinite;
const validTaskId = id => Number.isSafeInteger(id) && id > 0 && id < Number.MAX_SAFE_INTEGER - 1000;
const length = n => Number.isInteger(n?.minutes) && n.minutes > 0 ? n.minutes : minutes;
const merge = c => ({...defaults, ...c});
const source = (n, id) => typeof id === 'string' && Object.hasOwn(n?.sources ?? {}, id) ? n.sources[id] : undefined;

/** Strict validation at JSON and settings boundaries; unknown keys are discarded. */
export function validateConfig(value = {}) {
  if (!record(value)) throw new Error('观测参数必须是对象');
  const c = {};
  const ranges = {
    zmax: [0, 90], sun: [-30, 0], moon: [0, 180], trim: [0, 180],
    overhead: [0, 180], minBlock: [1, minutes], fov: [0.05, 30],
    timezone: [-12, 14], startHour: [0, 23], latitude: [-90, 90],
    longitude: [-180, 180], elevation: [-500, 10000],
  };
  for (const [key, [low, high]] of Object.entries(ranges)) {
    const v = Object.hasOwn(value, key) ? value[key] : defaults[key];
    if (!finite(v) || v < low || v > high) throw new Error('参数 ' + key + ' 超出有效范围');
    c[key] = v;
  }
  for (const key of ['trim', 'overhead', 'minBlock', 'startHour']) {
    if (!Number.isInteger(c[key])) throw new Error('参数 ' + key + ' 必须为整数');
  }
  if (!Number.isInteger(c.timezone * 60)) throw new Error('时区偏移必须为整分钟');
  c.mode = Object.hasOwn(value, 'mode') ? value.mode : defaults.mode;
  c.moonMode = Object.hasOwn(value, 'moonMode') ? value.moonMode : defaults.moonMode;
  if (!['LACT', 'LHAASO'].includes(c.mode)) throw new Error('未知观测模式');
  if (!['strict', 'up', 'warn'].includes(c.moonMode)) throw new Error('未知月亮约束模式');
  return c;
}

export function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(date + 'T00:00:00.000Z');
  return finite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

/** All engine arrays are sampled at one-minute boundaries. */
export function sample(a, t) {
  if (!a || !Number.isInteger(a.length) || !a.length || !finite(t)) return NaN;
  const x = Math.max(0, Math.min(a.length - 1, t)), i = Math.floor(x);
  if (!finite(a[i])) return NaN;
  if (i === a.length - 1 || x === i) return a[i];
  return finite(a[i + 1]) ? a[i] + (a[i + 1] - a[i]) * (x - i) : NaN;
}

export function nightBounds(n, config = defaults) {
  const c = merge(config), total = length(n);
  if (c.mode === 'LHAASO') return [0, total];
  let a = 0, b = total;
  while (a < total && !(sample(n?.sun, a + .5) < c.sun)) a++;
  while (b > a && !(sample(n?.sun, b - .5) < c.sun)) b--;
  a = Math.min(total, a + c.trim);
  b = Math.max(a, b - c.trim);
  return [a, b];
}

export function reason(n, id, t, config = defaults, bounds) {
  const c = merge(config), s = source(n, id);
  if (!finite(t) || t < 0 || t >= length(n)) return '超出时间轴';
  if (!s) return '源不在当前源表中';
  const z = sample(s.z, t);
  if (!finite(z)) return '缺少天顶角计算数据';
  if (c.mode !== 'LHAASO') {
    bounds ??= nightBounds(n, c);
    const sun = sample(n?.sun, t);
    if (!finite(sun)) return '缺少太阳计算数据';
    if (t < bounds[0] || t >= bounds[1] || sun >= c.sun) return '不满足暗夜条件';
  }
  if (z > c.zmax) return '天顶角超限';
  if (c.mode !== 'LHAASO') {
    const altitude = sample(n?.moon_alt, t);
    if (c.moonMode === 'up' && !finite(altitude)) return '缺少月亮计算数据';
    const enforce = c.moonMode === 'strict' || (c.moonMode === 'up' && altitude > 0);
    if (enforce) {
      const separation = sample(s.sep, t);
      if (!finite(separation)) return '缺少月距计算数据';
      if (separation <= c.moon) return '月距不足';
    }
  }
  return '';
}

export function mask(n, id, c = defaults) {
  const bounds = nightBounds(n, c);
  return Array.from({length: length(n)}, (_, i) => !reason(n, id, i + .5, c, bounds));
}

export function windows(values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (!values[i]) continue;
    let j = i + 1;
    while (j < values.length && values[j]) j++;
    out.push([i, j]);
    i = j - 1;
  }
  return out;
}

export function validate(n, blocks, config = defaults) {
  const c = merge(config), total = length(n), issues = [], byId = new Map();
  const sorted = (Array.isArray(blocks) ? blocks : []).map((b, i) => record(b) ? b : {id: 'invalid-' + i});
  sorted.sort((a, b) => (finite(a.start) ? a.start : Infinity) - (finite(b.start) ? b.start : Infinity));
  const ids = new Set(), duplicate = new Set();
  sorted.forEach(b => { if (ids.has(b.id)) duplicate.add(b.id); ids.add(b.id); byId.set(b.id, []); });
  const add = (b, message) => {
    if (byId.get(b.id).includes(message)) return;
    byId.get(b.id).push(message);
    issues.push({id: b.id, message});
  };
  const bounds = nightBounds(n, c), timed = [];
  for (const b of sorted) {
    if (!validTaskId(b.id)) add(b, '任务编号无效');
    if (duplicate.has(b.id)) add(b, '任务编号重复');
    if (!source(n, b.source)) add(b, '源不在当前源表中');
    if (!Number.isInteger(b.start) || !Number.isInteger(b.duration) || b.start < 0 || b.duration <= 0 || b.start + b.duration > total) {
      add(b, '任务超出时间轴或时长无效');
      continue;
    }
    timed.push(b);
    if (b.duration < c.minBlock) add(b, '短于最小任务 ' + c.minBlock + ' min');
    for (let t = b.start + .5; t < b.start + b.duration; t++) {
      const r = reason(n, b.source, t, c, bounds);
      if (r) add(b, r);
    }
  }
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const a = timed[i], b = timed[j], gap = b.start - a.start - a.duration;
    if (gap < 0) {
      add(a, '与任务 ' + b.id + ' 时间重叠');
      add(b, '与任务 ' + a.id + ' 时间重叠');
    } else if (j === i + 1 && a.source !== b.source && gap < c.overhead) {
      // Same-source adjacent tasks continue tracking and have no source-change buffer.
      add(a, '后续转场不足 ' + c.overhead + ' min');
      add(b, '前序转场不足 ' + c.overhead + ' min');
    }
  }
  const validBlocks = sorted.filter(b => byId.get(b.id).length === 0);
  return {issues, byId, sorted, validBlocks,
    validMinutes: validBlocks.reduce((sum, b) => sum + b.duration, 0),
    scheduledMinutes: timed.reduce((sum, b) => sum + b.duration, 0)};
}

export function histogram(n, id, c = defaults, blocks = [], assessment = validate(n, blocks, c)) {
  const available = [0, 0, 0], planned = [0, 0, 0], m = mask(n, id, c);
  const tasks = blocks.filter(b => b?.source === id && assessment.byId.get(b.id)?.length === 0);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const z = sample(source(n, id).z, i + .5), bin = z <= 30 ? 0 : z <= 50 ? 1 : 2;
    available[bin]++;
    if (tasks.some(b => i >= b.start && i < b.start + b.duration)) planned[bin]++;
  }
  return {available, planned};
}

const pad = x => String(x).padStart(2, '0');
export function clock(t, config = defaults) {
  if (!finite(t)) return '—';
  const c = merge(config), elapsed = Math.round(t) + c.startHour * 60;
  const day = Math.floor(elapsed / 1440), m = ((elapsed % 1440) + 1440) % 1440;
  const prefix = day === 0 ? '' : day === 1 ? '次日 ' : day === -1 ? '前日 ' : (day > 0 ? '+' : '') + day + '日 ';
  return prefix + pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}
export const compact = (t, c = defaults) => clock(t, c).replace('次日 ', '+');

function startMs(date, config) {
  if (!validDate(date)) throw new Error('日期无效，需使用 YYYY-MM-DD');
  const c = validateConfig(config);
  return Date.parse(date + 'T00:00:00.000Z') + (c.startHour - c.timezone) * 3600000;
}
export function utc(date, t, c = defaults) {
  if (!finite(t)) throw new Error('时间偏移无效');
  return new Date(startMs(date, c) + t * 60000).toISOString();
}
export function local(date, t, config = defaults) {
  const c = validateConfig(config), offset = Math.abs(c.timezone * 60);
  const zone = (c.timezone >= 0 ? '+' : '-') + pad(Math.floor(offset / 60)) + ':' + pad(offset % 60);
  return new Date(Date.parse(utc(date, t, c)) + c.timezone * 3600000).toISOString().replace('Z', zone);
}

export function azimuth(a, t) {
  if (!a || a.length < 1 || !finite(t)) return NaN;
  const x = Math.max(0, Math.min(a.length - 1, t)), i = Math.floor(x);
  if (!finite(a[i])) return NaN;
  if (i === a.length - 1) return ((a[i] % 360) + 360) % 360;
  if (!finite(a[i + 1])) return NaN;
  const d = ((a[i + 1] - a[i] + 540) % 360 + 360) % 360 - 180;
  return ((a[i] + d * (x - i)) % 360 + 360) % 360;
}

/** Export only a valid complete plan. END_EXCLUSIVE denotes the unobserved boundary. */
export function pointingRows(n, sources, blocks, config = defaults, stepMinutes = 10) {
  const c = validateConfig(config);
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > minutes) throw new Error('导出采样间隔无效');
  const assessment = validate(n, blocks, c);
  if (assessment.issues.length) throw new Error('请先解决计划中的所有冲突');
  const srcById = new Map(sources.map(s => [s.id, s]));
  const expectedStart = startMs(n.date, c);
  if (finite(n.startMs) && Math.abs(n.startMs - expectedStart) > 1) throw new Error('计算日期或时区与计划不一致，请重新计算');
  const rows = [];
  for (const b of assessment.sorted) {
    const src = srcById.get(b.source), v = source(n, b.source);
    if (!src || !finite(src.ra) || !finite(src.dec)) throw new Error('源缺少有效的 ICRS 坐标');
    const samples = [];
    for (let t = b.start; t < b.start + b.duration; t += stepMinutes) samples.push(t);
    samples.push(b.start + b.duration);
    samples.forEach((t, i) => {
      const az = azimuth(v.az, t), altitude = 90 - sample(v.z, t);
      if (!finite(az) || !finite(altitude)) throw new Error('指向计算数据不完整');
      rows.push({block: b.id, source_id: src.id, source: src.name,
        event: i === samples.length - 1 ? 'END_EXCLUSIVE' : i === 0 ? 'START' : 'TRACK',
        utc: utc(n.date, t, c), local: local(n.date, t, c),
        ra_icrs_deg: Number(src.ra.toFixed(6)), dec_icrs_deg: Number(src.dec.toFixed(6)),
        az_north_east_deg: Number(az.toFixed(3)), alt_geometric_deg: Number(altitude.toFixed(3)),
      });
    });
  }
  return rows;
}

export function csv(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const keys = Object.keys(rows[0]);
  // Spreadsheet programs evaluate formula-looking strings even inside quoted cells.
  const quote = v => {
    let value = v == null ? '' : String(v);
    if (typeof v === 'string' && /^[\s\u0000-\u001f]*[=+@-]/u.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return keys.map(quote).join(',') + '\r\n' + rows.map(r => keys.map(k => quote(r[k])).join(',')).join('\r\n');
}

/** Read untrusted JSON into a new, explicitly shaped object without executable content. */
export function restorePlan(payload, knownSources) {
  if (typeof payload === 'string') {
    if (payload.length > 2_000_000) throw new Error('计划文件过大');
    try { payload = JSON.parse(payload); } catch { throw new Error('计划文件不是有效的 JSON'); }
  }
  if (!record(payload) || payload.version !== 1) throw new Error('不支持的计划格式，version 必须为 1');
  if (!validDate(payload.date)) throw new Error('计划日期无效');
  const config = validateConfig(payload.config);
  const catalog = knownSources instanceof Set ? [...knownSources] : Array.isArray(knownSources) ? knownSources : [];
  const ids = new Set(catalog.map(s => typeof s === 'string' ? s : s?.id).filter(id => typeof id === 'string'));
  if (!Array.isArray(payload.blocks) || payload.blocks.length > 1000) throw new Error('计划任务列表无效');
  const seen = new Set();
  const blocks = payload.blocks.map(b => {
    if (!record(b) || !validTaskId(b.id) || seen.has(b.id)) throw new Error('任务编号无效或重复');
    if (typeof b.source !== 'string' || !ids.has(b.source)) throw new Error('计划包含当前源表中不存在的源');
    if (!Number.isInteger(b.start) || !Number.isInteger(b.duration) || b.start < 0 || b.duration <= 0 || b.start + b.duration > minutes) throw new Error('任务时间或时长无效');
    seen.add(b.id);
    return {id: b.id, source: b.source, start: b.start, duration: b.duration};
  });
  const focus = payload.focus ?? blocks[0]?.source ?? [...ids][0] ?? '';
  if (typeof focus !== 'string' || (ids.size > 0 && !ids.has(focus)) || (focus && !ids.has(focus))) throw new Error('选中源无效');
  const visible = payload.visible ?? (focus ? [focus] : []);
  if (!Array.isArray(visible) || visible.length > 1000 || visible.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('轨迹显示源列表无效');
  return {version: 1, date: payload.date, config, blocks, focus, visible: [...new Set(visible)]};
}

export default {minutes, defaults, validateConfig, validDate, sample, nightBounds, reason, mask,
  windows, validate, histogram, clock, compact, utc, local, azimuth, pointingRows, csv, restorePlan};
