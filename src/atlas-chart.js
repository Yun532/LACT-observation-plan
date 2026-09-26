const D = Math.PI / 180;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = n => ((n % 360) + 360) % 360;
const signed = n => wrap(n + 180) - 180;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => n.toFixed(2);

// Standard J2000 equatorial -> Galactic rotation (IAU Galactic axes).
// This overview treats ICRS and FK5/J2000 as coincident at chart resolution;
// original source coordinates and their declared reference frames are unchanged.
// Reference: astropy/coordinates/builtin_frames/galactic.py (J2000 pole).
const GAL = [
  [-.0548755604162154, -.873437090234885, -.4838350155487132],
  [.4941094278755837, -.4448296299600112, .7469822444972189],
  [-.8676661490190047, -.1980763734312015, .4559837761750669],
];
function rotate(lon, lat, inverse = false) {
  const v = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
  const q = [0, 1, 2].map(i => v.reduce((sum, value, j) => sum + value * (inverse ? GAL[j][i] : GAL[i][j]), 0));
  return { lon: wrap(Math.atan2(q[1], q[0]) / D), lat: Math.atan2(q[2], Math.hypot(q[0], q[1])) / D };
}
export function equatorialToGalactic(ra, dec) {
  const p = rotate(ra, dec);
  return { l: p.lon, b: p.lat };
}
export function galacticToEquatorial(l, b) {
  const p = rotate(l, b, true);
  return { ra: p.lon, dec: p.lat };
}
function thetaFor(lat) {
  if (Math.abs(lat) >= 90) return Math.sign(lat) * Math.PI / 2;
  const target = Math.PI * Math.sin(lat * D);
  let low = -Math.PI / 2, high = Math.PI / 2;
  for (let i = 0; i < 42; i++) {
    const mid = (low + high) / 2;
    if (2 * mid + Math.sin(2 * mid) < target) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
function projectFrame(deltaLon, lat) {
  const theta = thetaFor(lat);
  return { x: -deltaLon / 180 * Math.cos(theta), y: -.5 * Math.sin(theta) };
}
function frameCoords(ra, dec, frame) {
  if (frame === 'galactic') { const p = equatorialToGalactic(ra, dec); return { lon: p.l, lat: p.b }; }
  return { lon: ra, lat: dec };
}
export function projectAtlas(ra, dec, frame = 'equatorial') {
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Math.abs(dec) > 90) return null;
  const p = frameCoords(ra, dec, frame);
  return projectFrame(signed(p.lon - (frame === 'galactic' ? 0 : 180)), p.lat);
}
export function unprojectAtlas(x, y, frame = 'equatorial') {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x * x + 4 * y * y > 1 + 1e-10) return null;
  const theta = Math.asin(clamp(-2 * y, -1, 1)), c = Math.cos(theta);
  const lon = wrap((frame === 'galactic' ? 0 : 180) + (c < 1e-10 ? 0 : -180 * x / c));
  const lat = Math.asin(clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1)) / D;
  if (frame === 'galactic') return { ...galacticToEquatorial(lon, lat), l: lon, b: lat };
  return { ra: lon, dec: lat, ...equatorialToGalactic(lon, lat) };
}

// A fixed range lets users compare months without the colors rescaling.
export function atlasHourColor(hours, maxHours = 240) {
  if (!Number.isFinite(hours)) return '#bdc5ce';
  const t = clamp(hours / maxHours, 0, 1), low = [230, 238, 247], high = [36, 82, 159];
  return '#' + low.map((v, i) => Math.round(v + (high[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function limitAtlasView(view) {
  const zoom=clamp(view.zoom,1,12),distance=Math.hypot(view.x,2*view.y),factor=distance>1?1/distance:1;
  return zoom===1?{zoom:1,x:0,y:0}:{zoom,x:view.x*factor,y:view.y*factor};
}

export function renderAtlas(svg, sources, selectedId, options = {}) {
  const { frame = 'equatorial', showGrid = true, showPlane = true, showReach = true, showLabels = false, colorBy = 'catalog', month = 0, monthly = null, config = {}, view = {} } = options;
  const width = Math.max(240, Math.round(svg.getBoundingClientRect().width || 900));
  const height = clamp(width * .52, 320, 520), baseRadius = Math.min((width - 62) / 2, height - 76);
  const centerX = width / 2, centerY = height / 2 + 2, zoom = clamp(view.zoom || 1, 1, 12);
  const vx = Number.isFinite(view.x) ? view.x : 0, vy = Number.isFinite(view.y) ? view.y : 0;
  const screen = p => ({ x: centerX + (p.x - vx) * baseRadius * zoom, y: centerY + (p.y - vy) * baseRadius * zoom });
  const inView = p => p.x >= 5 && p.x <= width - 5 && p.y >= 28 && p.y <= height - 25;
  const center = screen({ x: 0, y: 0 }), radius = baseRadius * zoom;
  const hits = [], maxHours = 240, labels = [], labelBoxes = [];
  const clip = 'source-atlas-clip', bounds = 'source-atlas-bounds';
  let html = `<defs><clipPath id="${bounds}"><rect x="1" y="26" width="${width - 2}" height="${height - 50}" rx="8"/></clipPath><clipPath id="${clip}"><ellipse cx="${center.x}" cy="${center.y}" rx="${radius}" ry="${radius / 2}"/></clipPath></defs>`;
  html += `<g clip-path="url(#${bounds})"><ellipse cx="${center.x}" cy="${center.y}" rx="${radius}" ry="${radius / 2}" fill="#f7f9fb" stroke="#cbd5df" stroke-width="1.1"/><g clip-path="url(#${clip})">`;
  const polyline = points => points.map((p, i) => { const q = screen(p); return `${i ? 'L' : 'M'}${num(q.x)} ${num(q.y)}`; }).join('');
  // Break at the longitude seam. Joining its two sides draws a false sky track.
  const skyPath = points => {
    let last = null, d = '';
    for (const p of points) {
      const coord = frameCoords(p.ra, p.dec, frame), delta = signed(coord.lon - (frame === 'galactic' ? 0 : 180));
      const q = screen(projectFrame(delta, coord.lat));
      d += `${last === null || Math.abs(delta - last) > 180 ? 'M' : 'L'}${num(q.x)} ${num(q.y)}`;
      last = delta;
    }
    return d;
  };
  if (showGrid) {
    for (const delta of [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150]) {
      const points = Array.from({ length: 91 }, (_, i) => projectFrame(delta, -90 + 2 * i));
      html += `<path d="${polyline(points)}" fill="none" stroke="${delta === 0 ? '#c5d0dc' : '#dde4eb'}" stroke-width="${delta === 0 ? 1 : .7}"/>`;
    }
    for (const lat of [-60, -30, 0, 30, 60]) {
      const points = Array.from({ length: 121 }, (_, i) => projectFrame(-180 + 3 * i, lat));
      html += `<path d="${polyline(points)}" fill="none" stroke="${lat === 0 ? '#c5d0dc' : '#dde4eb'}" stroke-width="${lat === 0 ? 1 : .7}"/>`;
    }
  }
  if (showReach && Number.isFinite(config.latitude) && Number.isFinite(config.zmax)) {
    for (const dec of [config.latitude - config.zmax, config.latitude + config.zmax].filter(d => d > -90 && d < 90)) {
      const points = Array.from({ length: 721 }, (_, i) => ({ ra: i / 2, dec }));
      html += `<path data-atlas-layer="reach" d="${skyPath(points)}" fill="none" stroke="#268b83" stroke-width="1.2" stroke-opacity=".65" stroke-dasharray="3 5"><title>几何可达边界 δ=${dec.toFixed(1)}°；仅天顶角条件，不含太阳、月亮与日期</title></path>`;
    }
  }
  if (showPlane) {
    const points = Array.from({ length: 721 }, (_, i) => galacticToEquatorial(i / 2, 0));
    html += `<path data-atlas-layer="plane" d="${skyPath(points)}" fill="none" stroke="#b99653" stroke-width="1.25" stroke-opacity=".8" stroke-dasharray="6 4"><title>银道面 b=0°</title></path>`;
    const gc = galacticToEquatorial(0, 0), p = screen(projectAtlas(gc.ra, gc.dec, frame));
    html += `<path d="M${p.x - 5} ${p.y}H${p.x + 5}M${p.x} ${p.y - 5}V${p.y + 5}" stroke="#987337" stroke-width="1.2"><title>银心方向 l=0°，b=0°；坐标参考标记，非恒星</title></path>`;
    if (inView(p)) labels.push({ text: '银心', x: p.x + 9, y: p.y - 9, color: '#947137', priority: 1 });
  }
  const ordered = [...sources.filter(s => s.id !== selectedId), ...sources.filter(s => s.id === selectedId)];
  for (const s of ordered) {
    const projected = projectAtlas(s.ra, s.dec, frame);
    if (!projected) continue;
    const p = screen(projected);
    if (!inView(p)) continue;
    const selected = s.id === selectedId, hours = monthly?.[s.id]?.[month];
    const catalog = Array.isArray(s.catalogs) ? s.catalogs.join(' ') : String(s.catalog || '');
    const color = colorBy === 'month' ? atlasHourColor(hours) : /lhaaso/i.test(catalog) ? '#268b83' : '#426bc2';
    const r = selected ? 5 : 3.2, name = String(s.name ?? s.id);
    const title = `${name} · RA ${s.ra.toFixed(3)}° · Dec ${s.dec.toFixed(3)}°${colorBy === 'month' ? ` · ${Number.isFinite(hours) ? `${month + 1}月 ${hours.toFixed(1)} h` : '可观测时长尚未计算'}` : ` · ${catalog}`}`;
    if (selected) html += `<circle cx="${p.x}" cy="${p.y}" r="10" fill="#ffffff" fill-opacity=".8" stroke="#263e60" stroke-width="1.2" pointer-events="none"/>`;
    html += `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}" fill-opacity="${selected ? 1 : .85}" stroke="${selected ? '#fff' : '#ffffffb3'}" stroke-width="${selected ? 1.5 : .65}" data-source="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`查看 ${title}`)}"><title>${esc(title)}</title></circle>`;
    hits.push({ x: p.x, y: p.y, r, kind: 'source', id: s.id, name, ra: s.ra, dec: s.dec });
    if (selected || showLabels) labels.push({ text: name, x: p.x + 8, y: p.y - 8, color: selected ? '#263e60' : '#536578', priority: selected ? 2 : 0 });
  }
  html += '</g>';
  // Selected labels win; other names are suppressed when their boxes collide.
  for (const label of labels.sort((a, b) => b.priority - a.priority)) {
    const text = label.text.length > 29 ? label.text.slice(0, 28) + '…' : label.text;
    const labelWidth = [...text].reduce((sum, c) => sum + (c.charCodeAt(0) > 255 ? 10 : 5.8), 0);
    const x = clamp(label.x, 8, Math.max(8, width - labelWidth - 8)), y = clamp(label.y, 41, height - 31);
    const box = { x, y: y - 11, w: labelWidth + 4, h: 15 };
    if (!label.priority && labelBoxes.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) continue;
    labelBoxes.push(box);
    html += `<text x="${x}" y="${y}" pointer-events="none" style="font-size:10px;fill:${label.color};paint-order:stroke;stroke:#f7f9fb;stroke-width:3px;stroke-linejoin:round">${esc(text)}</text>`;
  }
  if (showGrid) {
    for (const delta of [-120, -60, 0, 60, 120]) {
      const p = screen(projectFrame(delta, 0));
      if (!inView(p)) continue;
      const lon = wrap(delta + (frame === 'galactic' ? 0 : 180));
      html += `<text x="${p.x}" y="${p.y + 16}" text-anchor="middle" pointer-events="none" style="font-size:10px;fill:#8493a4;paint-order:stroke;stroke:#f7f9fb;stroke-width:3px">${lon}°</text>`;
    }
    for (const lat of [-60, -30, 30, 60]) {
      const p = screen(projectFrame(0, lat));
      if (inView(p)) html += `<text x="${p.x + 5}" y="${p.y - 5}" pointer-events="none" style="font-size:10px;fill:#8493a4;paint-order:stroke;stroke:#f7f9fb;stroke-width:3px">${lat > 0 ? '+' : ''}${lat}°</text>`;
    }
  }
  html += `</g><text x="8" y="16" style="font-size:10px;fill:#738499">${frame === 'galactic' ? '银道坐标 l / b' : '赤道坐标 RA / Dec'} · MOLLWEIDE</text><text x="${width - 8}" y="16" text-anchor="end" style="font-size:10px;fill:#738499">${frame === 'galactic' ? '银经' : '赤经'}向左增大</text><text x="8" y="${height - 7}" style="font-size:10px;fill:#8996a5">等面积全天投影</text><text x="${width - 8}" y="${height - 7}" text-anchor="end" style="font-size:10px;fill:#8996a5">${zoom.toFixed(1)}×</text>`;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-label', `${frame === 'galactic' ? '银道' : '赤道'}坐标 Mollweide 等面积源分布；经度向左增大，点选圆形目录源可查看详情。`);
  svg.setAttribute('role', 'group');
  svg.innerHTML = html;
  return { hits, viewport: { width, height, baseRadius, centerX, centerY }, maxHours };
}
