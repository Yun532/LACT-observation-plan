import M from './planning.mjs';
import { COLORS } from './charts.js';
import { knownRadius, gaussianComponents } from './neighbor-chart.js';

const DEG = Math.PI / 180;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const finite = Number.isFinite;
const grids = new WeakMap();

/** Zenith-centred equidistant projection; north up, east left. Units are horizon radii. */
export function projectHorizontal(alt, az) {
  const radius = (90 - alt) / 90, angle = az * DEG;
  return { x: -radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

export function unprojectHorizontal(x, y) {
  const radius = Math.hypot(x, y);
  return { alt: 90 - radius * 90, az: radius < 1e-12 ? 0 : (Math.atan2(-x, -y) / DEG + 360) % 360 };
}

export function horizontalSeparation(a, b) {
  const dot = Math.sin(a.alt * DEG) * Math.sin(b.alt * DEG)
    + Math.cos(a.alt * DEG) * Math.cos(b.alt * DEG) * Math.cos((a.az - b.az) * DEG);
  return Math.acos(clamp(dot, -1, 1)) / DEG;
}

/** A true small circle on the celestial sphere, not a circle in the projected image. */
export function horizontalCircle(alt, az, radius, steps = 180) {
  const a = alt * DEG, z = az * DEG, r = radius * DEG;
  // Unit centre, increasing-altitude tangent, increasing-azimuth tangent.
  const centre = [Math.cos(a) * Math.cos(z), Math.cos(a) * Math.sin(z), Math.sin(a)];
  const north = [-Math.sin(a) * Math.cos(z), -Math.sin(a) * Math.sin(z), Math.cos(a)];
  const east = [-Math.sin(z), Math.cos(z), 0];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const theta = i / steps * 2 * Math.PI;
    const v = centre.map((value, k) => Math.cos(r) * value + Math.sin(r) * (Math.cos(theta) * north[k] + Math.sin(theta) * east[k]));
    return { alt: Math.asin(clamp(v[2], -1, 1)) / DEG, az: (Math.atan2(v[1], v[0]) / DEG + 360) % 360 };
  });
}

function skyGrid(canvas, cx, cy, radius) {
  let grid = grids.get(canvas);
  if (grid?.radius === radius && grid.cx === cx && grid.cy === cy) return grid;
  const step = 3, rows = [];
  for (let y = cy - radius; y < cy + radius; y += step) {
    const cells = [];
    for (let x = cx - radius; x < cx + radius; x += step) {
      const p = unprojectHorizontal((x + step / 2 - cx) / radius, (y + step / 2 - cy) / radius);
      if (p.alt < 0) continue;
      const a = p.alt * DEG, z = p.az * DEG;
      cells.push({ x, sin: Math.sin(a), cosN: Math.cos(a) * Math.cos(z), cosE: Math.cos(a) * Math.sin(z) });
    }
    rows.push({ y, cells });
  }
  grid = { cx, cy, radius, rows, step };
  grids.set(canvas, grid);
  return grid;
}

function validPosition(p) { return p && finite(p.alt) && finite(p.az); }

export function extensionLabel(source) {
  const ext = source?.extension;
  if (ext?.kind === 'gaussian-r39' && finite(ext.radiusDeg)) {
    const confidence = finite(ext.confidence) ? `${Math.round(ext.confidence * 100)}% ` : '';
    return `高斯 r39 ${ext.upperLimit ? '< ' : ''}${ext.radiusDeg}°${ext.upperLimit ? `（${confidence}上限）` : ''}`;
  }
  if (ext?.kind === 'gaussian-sigma' && finite(ext.sigmaDeg)) return `二维高斯 σ ${ext.upperLimit ? '≤ ' : ''}${ext.sigmaDeg}°${ext.upperLimit ? '（上限）' : ''} · σ参考圈`;
  if (ext?.kind === 'catalog-angular-size') {
    const sizes = [ext.xDeg, ext.yDeg].filter(finite);
    if (sizes.length) return `目录角尺度 ${sizes.join('° × ')}°（定义依原文，不作半径）`;
  }
  if (ext?.kind === 'catalog-undefined') return '原模型尺度（定义见源表）';
  return '未提供明确展宽';
}

/** Paint the instantaneous visible hemisphere; all returned hit coordinates are CSS pixels. */
export function renderSiteSky(canvas, {
  night, positions, sources = [], visible = [], focus, cursor = 0, config = {}, stars = [],
  showTracks = true, showStars = true, showExtensions = true,
}) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(240, Math.round(rect.width || 560));
  const height = Math.max(260, Math.round(rect.height || Math.min(440, width + 20)));
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  const empty = { hits: [], sourceCount: 0, starCount: 0, selectedAbove: 0, moonRestricted: false, sunBlocked: false, width, height };
  if (!ctx) return empty;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const c = { ...M.defaults, ...config }, cx = width / 2, cy = height / 2 + 1;
  const radius = Math.min(width / 2 - 37, height / 2 - 31);
  const point = p => { const q = projectHorizontal(p.alt, p.az); return { x: cx + q.x * radius, y: cy + q.y * radius }; };
  const color = id => COLORS[visible.indexOf(id) % COLORS.length] || '#8793a7';
  const byPosition = new Map((positions?.sources || []).map(p => [p.id, p]));
  const sun = positions?.sun, moon = positions?.moon;
  const sunBlocked = c.mode !== 'LHAASO' && validPosition(sun) && sun.alt >= c.sun;
  const moonRestricted = c.mode !== 'LHAASO' && validPosition(moon) && (c.moonMode === 'strict' || (c.moonMode === 'up' && moon.alt > 0));
  const out = { ...empty, sunBlocked, moonRestricted };
  const disk = (x, y, r, fill, stroke, lineWidth = 1) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, 2 * Math.PI);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
  };
  const label = (text, x, y, ink = '#778399', align = 'left') => {
    ctx.fillStyle = ink; ctx.textAlign = align; ctx.fillText(text, x, y);
  };
  const smallCircle = (p, angle, stroke, dash = [], opacity = 1) => {
    if (angle <= 0 || angle >= 180) return;
    ctx.beginPath(); let open = false;
    for (const q of horizontalCircle(p.alt, p.az, angle)) {
      // Do not join hidden pieces across the visible hemisphere.
      if (q.alt < -.6) { open = false; continue; }
      const xy = point(q);
      if (open) ctx.lineTo(xy.x, xy.y); else ctx.moveTo(xy.x, xy.y);
      open = true;
    }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.globalAlpha = opacity;
    ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  };

  disk(cx, cy, radius, sunBlocked ? '#fff6e9' : '#f8fafd', '#dfe6ef');
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.clip();

  // A small angular cap can cross the horizon even when the Moon itself is below it.
  // Compute each grid cell on the sphere, including radii greater than 90 degrees.
  if (moonRestricted && c.moon > 0) {
    const grid = skyGrid(canvas, cx, cy, radius), a = moon.alt * DEG, z = moon.az * DEG;
    const north = Math.cos(a) * Math.cos(z), east = Math.cos(a) * Math.sin(z), up = Math.sin(a), threshold = Math.cos(c.moon * DEG);
    ctx.beginPath();
    for (const row of grid.rows) {
      let first = null, last = null;
      for (const cell of row.cells) {
        const inside = cell.sin * up + cell.cosN * north + cell.cosE * east >= threshold - 1e-12;
        if (inside) { first ??= cell.x; last = cell.x; }
        else if (first !== null) { ctx.rect(first, row.y, last - first + grid.step, grid.step); first = null; }
      }
      if (first !== null) ctx.rect(first, row.y, last - first + grid.step, grid.step);
    }
    ctx.fillStyle = '#dfc49135'; ctx.fill();
  }
  for (const altitude of [30, 60]) disk(cx, cy, radius * (90 - altitude) / 90, null, '#e7ecf3');
  ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.strokeStyle = '#e7ecf3'; ctx.lineWidth = 1; ctx.stroke();
  ctx.setLineDash([5, 4]); disk(cx, cy, radius * c.zmax / 90, null, '#8499c8'); ctx.setLineDash([]);
  if (validPosition(moon)) smallCircle(moon, c.moon, '#b18c50', moonRestricted ? [3, 3] : [2, 5], moonRestricted ? .8 : .45);

  if (showTracks && night) {
    const bounds = M.nightBounds(night, c), end = night.minutes || 840;
    for (const id of visible) {
      const values = night.sources?.[id]; if (!values) continue;
      for (const good of [false, true]) {
        ctx.beginPath(); let open = false;
        for (let t = 0; t < end; t += 3) {
          const next = Math.min(t + 3, end), p = { alt: 90 - M.sample(values.z, t), az: M.azimuth(values.az, t) };
          const q = { alt: 90 - M.sample(values.z, next), az: M.azimuth(values.az, next) };
          if (!validPosition(p) || !validPosition(q) || p.alt < 0 || q.alt < 0 || (!M.reason(night, id, (t + next) / 2, c, bounds)) !== good) { open = false; continue; }
          const a = point(p), b = point(q); if (!open) ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); open = true;
        }
        ctx.strokeStyle = color(id); ctx.lineWidth = id === focus ? 1.8 : 1.2;
        ctx.globalAlpha = good ? .58 : .23; ctx.setLineDash(good ? [] : [2, 3]); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  const brightLabels = [];
  if (showStars) {
    // Batch the many faint crosses by magnitude; no label or DOM element per star.
    const bins = new Map();
    for (const star of stars) {
      const p = byPosition.get(star.id); if (!validPosition(p) || p.alt < 0 || !finite(star.mag)) continue;
      const xy = point(p), size = clamp(.5 + (8 - star.mag) * .25, .5, 3.5), bin = Math.round(star.mag * 4) / 4;
      if (!bins.has(bin)) bins.set(bin, []);
      bins.get(bin).push(xy);
      out.hits.push({ ...xy, r: Math.max(size + 2, 3), kind: 'star', id: star.id, name: star.name || star.id, mag: star.mag, alt: p.alt, az: p.az, ra: p.ra ?? star.ra, dec: p.dec ?? star.dec });
      out.starCount++;
      if (star.name && star.mag <= 1.6) brightLabels.push({ ...star, ...xy });
    }
    for (const [mag, points] of [...bins].sort((a, b) => b[0] - a[0])) {
      const size = clamp(.5 + (8 - mag) * .25, .5, 3.5);
      ctx.beginPath();
      for (const p of points) { ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x + size, p.y); ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x, p.y + size); }
      // Preserve every catalog star while keeping the numerous faint stars below the planning overlays.
      const alpha = clamp(.10 * 1.4 ** (8 - mag), .08, .85);
      ctx.strokeStyle = `rgba(134, 125, 103, ${alpha.toFixed(3)})`;
      ctx.lineWidth = clamp(.5 + (8 - mag) * .05, .5, 1); ctx.stroke();
    }
  }

  const drawExtension=(p,extension,ink,active)=>{
    const r=knownRadius({extension});
    if(!validPosition(p)||!(r>0)||p.alt+r<0)return;
    smallCircle(p,r,ink,extension.upperLimit?[2,2]:[],active ? .9 : .62);
    if(extension.kind==='gaussian-sigma'){
      const anchor=horizontalCircle(p.alt,p.az,r,16).find(q=>q.alt>=0);
      if(anchor){const xy=point(anchor);label('σ',xy.x+3,xy.y-4,ink);}
    }
  };
  const selected = [];
  for (const source of sources) {
    const p = byPosition.get(source.id); if (!validPosition(p)) continue;
    const active = visible.includes(source.id), xy = point(p), ext = source.extension;
    if (showExtensions) {
      const ink=active?color(source.id):'#9ca8bd';
      drawExtension(p,ext,ink,active);
      for(const component of gaussianComponents(source)){
        const cp=byPosition.get(component.id);if(!validPosition(cp))continue;
        drawExtension(cp,component.extension,ink,active);
        if(cp.alt<0)continue;
        const cxy=point(cp);disk(cxy.x,cxy.y,3,'#fff',ink,1.3);
        out.hits.push({...cxy,r:5,kind:'source',id:source.id,componentId:component.id,name:component.name,alt:cp.alt,az:cp.az,ra:cp.ra??component.ra,dec:cp.dec??component.dec,extension:component.extension,selected:active});
      }
    }
    if (p.alt < 0) continue;
    out.sourceCount++;
    const hit = { ...xy, r: active ? 8 : 4, kind: 'source', id: source.id, name: source.name, alt: p.alt, az: p.az, ra: p.ra ?? source.ra, dec: p.dec ?? source.dec, extension: ext, selected: active };
    out.hits.push(hit);
    if (active) { selected.push({ source, p, xy }); out.selectedAbove++; }
    else disk(xy.x, xy.y, 1.7, '#9ca8bd99');
  }
  ctx.restore();

  // Cardinal labels and radial annotation stay outside the shaded/clip region.
  label('北 N', cx, cy - radius - 16, '#586983', 'center');
  label('南 S', cx, cy + radius + 17, '#586983', 'center');
  label('东 E', cx - radius - 9, cy, '#586983', 'right');
  label('西 W', cx + radius + 9, cy, '#586983', 'left');
  label('天顶', cx + 6, cy - 9, '#8793a7');
  label('高 60°', cx + 6, cy - radius / 3 + 9, '#8793a7');
  label('高 30°', cx + 6, cy - radius * 2 / 3 + 9, '#8793a7');
  const labels = [];
  function collisionLabel(text, p, ink, priority = false) {
    const measure = ctx.measureText(text).width;
    const x = p.x > cx + radius * .48 ? p.x - measure - 9 : p.x + 9;
    const y = p.y - 10, box = { x: clamp(x, 4, width - measure - 4), y, w: measure + 5, h: 15 };
    if (y < 12 || y > height - 12 || (!priority && labels.some(q => box.x < q.x + q.w && box.x + box.w > q.x && box.y < q.y + q.h && box.y + box.h > q.y))) return;
    labels.push(box); ctx.save(); ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffffdd'; ctx.strokeText(text, box.x, y); label(text, box.x, y, ink); ctx.restore();
  }
  for (const { source, p, xy } of selected.sort((a, b) => Number(b.source.id === focus) - Number(a.source.id === focus))) {
    const index = visible.indexOf(source.id), ink = color(source.id);
    const reason = night ? M.reason(night, source.id, Math.min(cursor, (night.minutes || 840) - .001), c) : '';
    disk(xy.x, xy.y, source.id === focus ? 8 : 7, '#fff', ink, source.id === focus ? 2 : 1.4);
    ctx.font = 'bold 9px system-ui, sans-serif'; label(String(index + 1), xy.x, xy.y + .5, ink, 'center'); ctx.font = '11px system-ui, sans-serif';
    if (reason) { ctx.setLineDash([2, 2]); disk(xy.x, xy.y, 10, null, ink); ctx.setLineDash([]); }
    collisionLabel(source.name, xy, ink, source.id === focus);
  }
  for (const star of brightLabels.sort((a, b) => a.mag - b.mag).slice(0, 10)) collisionLabel(star.name, star, '#748098');

  const body = (name, kind, p, ink, fill) => {
    if (!validPosition(p) || p.alt < 0) return;
    const xy = point(p); disk(xy.x, xy.y, 6, fill, ink, 1.4);
    if (kind === 'sun') {
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(xy.x + Math.cos(a) * 8, xy.y + Math.sin(a) * 8); ctx.lineTo(xy.x + Math.cos(a) * 10, xy.y + Math.sin(a) * 10); }
      ctx.strokeStyle = ink; ctx.stroke();
    }
    collisionLabel(name, xy, ink, true);
    out.hits.push({ ...xy, r: 9, kind, id: kind, name, alt: p.alt, az: p.az });
  };
  body('太阳', 'sun', sun, '#b17a30', '#edd39c');
  body('月亮', 'moon', moon, '#9c7a42', '#d7bd80');
  const status = sunBlocked ? `太阳高 ${sun.alt.toFixed(1)}° · 尚未满足暗夜条件` : '当前时刻 · 地平线以上的天空';
  label(status, 7, 12, sunBlocked ? '#9c773e' : '#8390a3');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `站址瞬时天空图，天顶居中、北上东左。${out.sourceCount} 个源、${out.starCount} 颗恒星在地平线上。${sunBlocked ? '当前太阳高度不满足暗夜条件。' : ''}图中源编号与轨迹图一致。`);
  return out;
}
