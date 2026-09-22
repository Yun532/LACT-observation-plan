import { MakeTime, Observer, Equator, Horizon, Rotation_EQJ_HOR } from 'astronomy-engine';

// Geometric planning coordinates. No atmospheric refraction or telescope model.
export const DEFAULT_SITE = Object.freeze({ latitude: 29.3586111, longitude: 100.1374972, elevation: 4410, timezone: 8 });
export const DEFAULT_CONSTRAINTS = Object.freeze({ zmax: 70, sun: -13, moon: 40, moonMode: 'strict', trim: 0, mode: 'LACT' });
export const DEFAULTS = Object.freeze({ ...DEFAULT_SITE, ...DEFAULT_CONSTRAINTS });
const DEG = Math.PI / 180, MINUTE = 60000, DAY = 86400000;
const clamp = x => Math.max(-1, Math.min(1, x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function normalizeConfig(input = {}) {
  const c = { ...DEFAULTS, ...input.site, ...input };
  for (const [key, lo, hi] of [['latitude',-90,90],['longitude',-180,180],['elevation',-500,10000],['timezone',-12,14],['zmax',0,90],['sun',-30,0],['moon',0,180],['trim',0,240]]) {
    c[key] = Number(c[key]);
    if (!Number.isFinite(c[key]) || c[key] < lo || c[key] > hi) throw new Error(`参数 ${key} 必须在 ${lo} 至 ${hi} 之间`);
  }
  if (!['LACT', 'LHAASO'].includes(c.mode)) throw new Error('未知观测模式');
  if (!['strict', 'up', 'warn'].includes(c.moonMode)) throw new Error('未知月亮规则');
  return c;
}

export function localDateMs(date, timezone = 8, hour = 18) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式必须为 YYYY-MM-DD');
  const utc = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0,10) !== date) throw new Error('日期不存在');
  return utc + (hour - timezone) * 60 * MINUTE;
}

function vectors(sources) {
  const ids = new Set();
  return sources.map(s => {
    if (!s.id || ids.has(s.id)) throw new Error('源标识为空或重复');
    ids.add(s.id);
    if (!Number.isFinite(s.ra) || !Number.isFinite(s.dec) || s.ra < 0 || s.ra >= 360 || Math.abs(s.dec) > 90) throw new Error(`源 ${s.name || s.id} 坐标无效`);
    const ra = s.ra * DEG, dec = s.dec * DEG;
    return { id: s.id, v: [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] };
  });
}

function frameAt(ms, observer, bodies = true) {
  const time = MakeTime(new Date(ms));
  // This rotation includes precession and nutation; catalog ICRS directions are
  // treated as J2000 mean-equator directions (frame bias < 0.1 arcsec).
  const r = Rotation_EQJ_HOR(time, observer).rot;
  const north = [r[0][0], r[1][0], r[2][0]];
  const west = [r[0][1], r[1][1], r[2][1]];
  const zenith = [r[0][2], r[1][2], r[2][2]];
  if (!bodies) return { north, west, zenith };
  const sunEq = Equator('Sun', time, observer, true, true);
  const moonEq = Equator('Moon', time, observer, true, true);
  const sun = Horizon(time, observer, sunEq.ra, sunEq.dec, '').altitude;
  const moon = Horizon(time, observer, moonEq.ra, moonEq.dec, '');
  const ca = Math.cos(moon.altitude * DEG);
  const mh = [ca * Math.cos(moon.azimuth * DEG), -ca * Math.sin(moon.azimuth * DEG), Math.sin(moon.altitude * DEG)];
  const moonEqj = [0,1,2].map(i => north[i]*mh[0] + west[i]*mh[1] + zenith[i]*mh[2]);
  return { north, west, zenith, sun, moonalt: moon.altitude, moonaz: moon.azimuth, moonEqj };
}

export function nightBounds(night, input = {}) {
  const c = normalizeConfig(input);
  if (c.mode === 'LHAASO') return [0, night.minutes];
  const dark = Array.from({length: night.minutes}, (_, i) => (night.sun[i] + night.sun[i+1])/2 < c.sun);
  const first = dark.indexOf(true), last = dark.lastIndexOf(true);
  if (first < 0) return [0, 0];
  const start = Math.min(last + 1, first + c.trim), end = Math.max(start, last + 1 - c.trim);
  return [start, end];
}

export function computeNight(date, sources, input = {}) {
  const c = normalizeConfig(input), src = vectors(sources);
  const startMs = localDateMs(date, c.timezone, 18), observer = new Observer(c.latitude,c.longitude,c.elevation);
  const moonalt = [], moonaz = [];
  const night = { date, startMs, step: 1, minutes: 840, startHour:18, sun: [], moonalt, moonaz, moon_alt: moonalt, moon_az: moonaz, sources: {} };
  for (const s of src) night.sources[s.id] = { z: [], az: [], sep: [] };
  for (let i = 0; i <= night.minutes; i++) {
    const f = frameAt(startMs + i*MINUTE, observer);
    night.sun.push(f.sun); moonalt.push(f.moonalt); moonaz.push(f.moonaz);
    for (const s of src) {
      const a = night.sources[s.id], n = dot(f.north,s.v), w = dot(f.west,s.v), z = dot(f.zenith,s.v);
      a.z.push(Math.acos(clamp(z))/DEG);
      a.az.push((Math.atan2(-w,n)/DEG + 360)%360);
      a.sep.push(Math.acos(clamp(dot(f.moonEqj,s.v)))/DEG);
    }
  }
  night.bounds = nightBounds(night,c);
  return night;
}

export function angularSeparation(a, b) {
  const [av,bv] = vectors([{...a,id:'a'},{...b,id:'b'}]);
  return Math.acos(clamp(dot(av.v,bv.v)))/DEG;
}

// Midpoint integration over a complete observing day. LACT: local noon to noon;
// LHAASO: local midnight to midnight, with no solar or lunar cut.
function dailyHours(date, src, c, observer, step = 10) {
  const startHour = c.mode === 'LHAASO' ? 0 : 12;
  const startMs = localDateMs(date,c.timezone,startHour), frames = [];
  for (let t = step/2; t < 1440; t += step) frames.push(frameAt(startMs+t*MINUTE,observer,c.mode !== 'LHAASO'));
  const usable = frames.map(f => c.mode === 'LHAASO' || f.sun < c.sun);
  if (c.mode === 'LACT' && c.trim > 0) {
    // Trim each dark interval, not the whole day. Intervals touching noon are
    // not treated as sunrise/sunset edges (important during polar night).
    for (let i=0; i<usable.length; i++) {
      if (!usable[i]) continue;
      let j=i+1; while(j<usable.length && usable[j]) j++;
      for (let k=i;k<j;k++) if ((i>0 && (k-i+.5)*step<c.trim) || (j<usable.length && (j-k-.5)*step<c.trim)) usable[k]=false;
      i=j-1;
    }
  }
  const minimumUp = Math.cos(c.zmax*DEG), maximumMoonDot = Math.cos(c.moon*DEG);
  const hours = new Float64Array(src.length);
  for (let i=0;i<frames.length;i++) {
    if (!usable[i]) continue;
    const f=frames[i], cutMoon=c.mode==='LACT' && (c.moonMode==='strict' || (c.moonMode==='up' && f.moonalt>0));
    for (let j=0;j<src.length;j++) {
      const v=src[j].v;
      if (dot(f.zenith,v) < minimumUp) continue;
      if (cutMoon && dot(f.moonEqj,v) >= maximumMoonDot) continue;
      hours[j] += step/60;
    }
  }
  return hours;
}

export function computeYear(year, sources, input = {}, progress = () => {}) {
  year = Number(year);
  if (!Number.isInteger(year) || year < 1600 || year > 2400) throw new Error('支持年份为 1600 至 2400');
  const onProgress = typeof progress === 'function' ? progress : (progress.onProgress || (() => {}));
  const c=normalizeConfig(input), src=vectors(sources), observer=new Observer(c.latitude,c.longitude,c.elevation);
  const first=Date.UTC(year,0,1), end=Date.UTC(year+1,0,1), count=(end-first)/DAY;
  const days=[], monthly={}, daily={};
  for(const s of src) { monthly[s.id]=Array(12).fill(0); daily[s.id]=Array(count).fill(0); }
  for(let d=0;d<count;d++) {
    const utc=new Date(first+d*DAY), date=utc.toISOString().slice(0,10), month=utc.getUTCMonth();
    days.push(date);
    const hours=dailyHours(date,src,c,observer);
    src.forEach((s,i)=>{daily[s.id][d]=hours[i];monthly[s.id][month]+=hours[i];});
    if(d%7===0 || d===count-1) onProgress({done:d+1,total:count,percent:Math.round((d+1)/count*100)});
  }
  return {year,days,monthly,daily,step:10,startHour:c.mode==='LHAASO'?0:12,minutes:1440,mode:c.mode};
}

export function computeMonth(year, month, sources, input = {}) {
  year=Number(year); month=Number(month);
  if(!Number.isInteger(year)||year<1600||year>2400||!Number.isInteger(month)||month<1||month>12) throw new Error('年月无效');
  const c=normalizeConfig(input),src=vectors(sources),observer=new Observer(c.latitude,c.longitude,c.elevation);
  const days=[],daily={},count=new Date(Date.UTC(year,month,0)).getUTCDate();
  for(const s of src) daily[s.id]=[];
  for(let d=1;d<=count;d++) {
    const date=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    days.push(date); const hours=dailyHours(date,src,c,observer);
    src.forEach((s,i)=>daily[s.id].push(hours[i]));
  }
  return {year,month,days,daily,step:10,startHour:c.mode==='LHAASO'?0:12,minutes:1440,mode:c.mode};
}
