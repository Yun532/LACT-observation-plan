import assert from 'node:assert/strict';
import test from 'node:test';
import { equatorialToGalactic, galacticToEquatorial, projectAtlas, unprojectAtlas, atlasHourColor, renderAtlas, limitAtlasView, reachDeclinationRange, inAtlasFov, LHAASO_COMPARISON } from '../src/atlas-chart.js';

const close = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} differs from ${b}`);
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const mockSvg = (width = 900) => ({ getBoundingClientRect: () => ({ width }), attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, innerHTML: '' });
const source = (id, ra, dec = 0) => ({ id, name: id, ra, dec, catalog: 'TeVCat' });

test('panning keeps the center inside the projected ellipse and reset restores the full sky',()=>{
  for(const x of [-3,0,3])for(const y of [-3,0,3]){
    const view=limitAtlasView({zoom:12,x,y});
    assert.ok(view.x*view.x+4*view.y*view.y<=1+1e-12);
  }
  assert.deepEqual(limitAtlasView({zoom:1,x:1,y:1}),{zoom:1,x:0,y:0});
});

test('J2000 Galactic landmarks and bidirectional conversion agree', () => {
  // Published IAU Galactic axes, not private catalog data.
  const pole = equatorialToGalactic(192.85948, 27.12825);
  close(pole.b, 90, 2e-6);
  const center = galacticToEquatorial(0, 0);
  close(center.ra, 266.404995, 2e-5);
  close(center.dec, -28.936174, 2e-5);
  for (const ra of [0, .001, 90, 180, 270, 359.999]) for (const dec of [-89.99, -60, 0, 30, 89.99]) {
    const gal = equatorialToGalactic(ra, dec), eq = galacticToEquatorial(gal.l, gal.b);
    assert.ok(angle(eq.ra, ra) < 1e-7);
    close(eq.dec, dec);
  }
});

test('Mollweide centers, seams, poles and inverse preserve sky directions', () => {
  close(projectAtlas(180, 0).x, 0);
  close(projectAtlas(180, 0).y, 0);
  close(projectAtlas(0, 0).x, 1);
  assert.ok(projectAtlas(359.999, 0).x < -.999);
  assert.ok(projectAtlas(181, 0).x < 0, 'RA must increase to the left');
  for (const frame of ['equatorial', 'galactic']) {
    for (const ra of [0, .001, 90, 180, 266.4, 359.999]) for (const dec of [-89.9, -60, 0, 30, 89.9]) {
      const p = projectAtlas(ra, dec, frame), q = unprojectAtlas(p.x, p.y, frame);
      assert.ok(p.x * p.x + 4 * p.y * p.y <= 1 + 1e-10);
      assert.ok(angle(q.ra, ra) < 1e-6);
      close(q.dec, dec, 1e-6);
    }
    for (const dec of [-90, 90]) {
      const p = projectAtlas(75, dec, frame), q = unprojectAtlas(p.x, p.y, frame);
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      close(q.dec, dec, 1e-5);
    }
  }
  const gc = galacticToEquatorial(0, 0), p = projectAtlas(gc.ra, gc.dec, 'galactic');
  close(p.x, 0); close(p.y, 0);
  assert.equal(unprojectAtlas(0, .51), null);
  assert.equal(unprojectAtlas(1.01, 0), null);
  assert.equal(unprojectAtlas(NaN, 0), null);
  assert.equal(projectAtlas(0, 91), null);
});

test('Mollweide local area scales with spherical area rather than latitude', () => {
  const eps = .001, D = Math.PI / 180;
  for (const dec of [-65, -30, 0, 30, 65]) {
    const p = projectAtlas(155, dec), a = projectAtlas(155 + eps, dec), b = projectAtlas(155, dec + eps);
    const area = Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x)) / eps ** 2;
    close(area / Math.cos(dec * D), D * D / 8, 2e-9);
  }
});

test('month colors distinguish missing values from known zero and keep a fixed ceiling', () => {
  assert.equal(atlasHourColor(null), '#bdc5ce');
  assert.equal(atlasHourColor(undefined), '#bdc5ce');
  assert.equal(atlasHourColor(NaN), '#bdc5ce');
  assert.notEqual(atlasHourColor(0), atlasHourColor(null));
  assert.notEqual(atlasHourColor(120), atlasHourColor(240));
  assert.equal(atlasHourColor(240), atlasHourColor(400));
  assert.equal(atlasHourColor(-1), atlasHourColor(0));
});

test('renderer preserves fixed marker sizes and moves hits with the navigation viewport', () => {
  const svg = mockSvg(), src = source('synthetic', 200, 10);
  const initial = renderAtlas(svg, [src], null, { showReach: false });
  const p = projectAtlas(src.ra, src.dec), view = { zoom: 4, x: p.x, y: p.y };
  const zoomed = renderAtlas(svg, [src], null, { view, frame: 'equatorial', config: { latitude: 29.3, zmax: 70 } });
  assert.equal(zoomed.hits.length, 1);
  close(zoomed.hits[0].x, zoomed.viewport.centerX);
  close(zoomed.hits[0].y, zoomed.viewport.centerY);
  assert.equal(initial.hits[0].r, zoomed.hits[0].r);
  assert.equal(zoomed.maxHours, 240);
  assert.ok(!svg.innerHTML.includes('NaN') && !svg.innerHTML.includes('Infinity'));
  assert.match(svg.innerHTML, /可观测天区边界/);
  assert.match(svg.innerHTML, /坐标参考标记，非恒星/);
});

test('rendering escapes local catalog text and reports unknown monthly data without inventing zero', () => {
  const svg = mockSvg(320), src = source('id" onload="bad', 180);
  src.name = '<script>alert("private")</script>';
  renderAtlas(svg, [src], src.id, { monthly: {}, colorBy: 'month', showLabels: true, frame: 'galactic' });
  assert.ok(!svg.innerHTML.includes('<script>') && !svg.innerHTML.includes('onload="bad'));
  assert.match(svg.innerHTML, /&lt;script&gt;/);
  assert.match(svg.innerHTML, /可观测时长尚未计算/);
  assert.match(svg.innerHTML, /#bdc5ce/);
  assert.equal(svg.attributes.role, 'group');
  assert.match(svg.attributes['aria-label'], /银道/);
  const map = renderAtlas(svg, [source('bad', NaN), source('pole', 50, 90)], null);
  assert.ok(map.hits.every(h => Number.isFinite(h.x) && Number.isFinite(h.y)));
  assert.equal(map.viewport.height, 320);
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('plane and reach curves split the Mollweide longitude seam', () => {
  const svg = mockSvg();
  renderAtlas(svg, [], null, { frame: 'equatorial', config: { latitude: 29.3, zmax: 70 } });
  const reach = svg.innerHTML.match(/data-atlas-layer="reach" d="([^"]+)"/)[1];
  assert.ok((reach.match(/M/g) || []).length >= 2, 'A closed declination ring must break at RA 0/360');
  renderAtlas(svg, [], null, { frame: 'galactic' });
  const plane = svg.innerHTML.match(/data-atlas-layer="plane" d="([^"]+)"/)[1];
  assert.ok((plane.match(/M/g) || []).length >= 2, 'The Galactic plane must break at l=180');
});

test('geometric reach uses latitude and zenith limit, and FOV uses a true angular radius', () => {
  const reach = reachDeclinationRange({ latitude: 29.3586, zmax: 70 });
  close(reach.min, -40.6414); assert.equal(reach.max, 90);
  assert.deepEqual(reachDeclinationRange({ latitude: -70, zmax: 30 }), { min: -90, max: -40 });
  assert.equal(reachDeclinationRange({ latitude: 29 }), null);
  assert.equal(reachDeclinationRange({ latitude: 91, zmax: 70 }), null);
  assert.equal(inAtlasFov(1, 0, { ra: 359, dec: 0 }, 3), true);
  assert.equal(inAtlasFov(2, 0, { ra: 359, dec: 0 }, 3), true);
  assert.equal(inAtlasFov(2.001, 0, { ra: 359, dec: 0 }, 3), false);
  for (const ra of [0, 90, 180, 270]) {
    assert.equal(inAtlasFov(ra, 82, { ra: 200, dec: 90 }, 8), true);
    assert.equal(inAtlasFov(ra, 81.99, { ra: 200, dec: 90 }, 8), false);
  }
  assert.equal(inAtlasFov(NaN, 0, { ra: 0, dec: 0 }, 3), false);
});

const layerPath = (svg, name) => svg.innerHTML.match(new RegExp(`data-atlas-layer="${name}" d="([^"]*)"`))?.[1];
const rectangles = path => [...(path || '').matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+Z/g)].map(m => m.slice(1).map(Number));
const covered = (rects, x, y) => rects.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
const angularDistance = (a, b) => {
  const d = Math.PI / 180, hav = Math.sin((a.dec - b.dec) * d / 2) ** 2 + Math.cos(a.dec * d) * Math.cos(b.dec * d) * Math.sin((a.ra - b.ra) * d / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, hav))) / d;
};

test('region shading matches the visible sky in either coordinate frame, including seams, poles and zoom', () => {
  const galSeam = galacticToEquatorial(179, 25);
  for (const frame of ['equatorial', 'galactic']) for (const target of [source('seam', 359, 0), source('pole', 30, 88), source('gal-seam', galSeam.ra, galSeam.dec)]) {
    const svg = mockSvg();
    for (const zoom of [1, 12]) {
      const view = zoom === 1 ? { zoom, x: 0, y: 0 } : { zoom, ...projectAtlas(target.ra, target.dec, frame) };
      const config = { latitude: 29.3586, zmax: 70, fov: 12 };
      const result = renderAtlas(svg, [target], target.id, { frame, view, config });
      const reachRects = rectangles(layerPath(svg, 'reach-fill')), fovRects = rectangles(layerPath(svg, 'fov-fill'));
      assert.ok(reachRects.length > 0 && fovRects.length > 0);
      const v = result.viewport, scale = v.baseRadius * zoom;
      let inside = 0;
      // Sample the actual rendered cell centers, independently invert them, and
      // compare with angular geometry rather than projected Euclidean distance.
      for (let y = 27; y < v.height - 24; y += 14) for (let x = 2; x < v.width - 1; x += 16) {
        const sky = unprojectAtlas((x - v.centerX) / scale + view.x, (y - v.centerY) / scale + view.y, frame);
        if (!sky) continue;
        assert.equal(covered(reachRects, x, y), sky.dec >= -40.6414 && sky.dec <= 90);
        const inFov = angularDistance(sky, target) <= config.fov;
        assert.equal(covered(fovRects, x, y), inFov, `${frame}, ${target.id}, zoom ${zoom}, x ${x}, y ${y}`);
        inside += Number(inFov);
      }
      assert.ok(inside > 0);
      // Path size depends on visible rows, not the magnified all-sky area.
      assert.ok(reachRects.length <= v.height * 2 && fovRects.length <= v.height * 2);
      assert.ok(!svg.innerHTML.includes('NaN') && !svg.innerHTML.includes('Infinity'));
    }
  }
});

test('FOV outlines follow a spherical circle and split seams without a closing chord', () => {
  for (const [frame, target] of [['equatorial', source('seam', 359, 0)], ['galactic', { ...source('seam', 0), ...galacticToEquatorial(179, 0) }], ['equatorial', source('pole', 25, 90)]]) {
    const svg = mockSvg(), result = renderAtlas(svg, [target], target.id, { frame, config: { fov: 8 } });
    const path = layerPath(svg, 'fov'), v = result.viewport;
    assert.ok((path.match(/M/g) || []).length >= 2);
    assert.ok(!path.includes('Z'), 'Never join separate seam segments with a straight closing chord');
    for (const point of path.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
      const sky = unprojectAtlas((Number(point[1]) - v.centerX) / v.baseRadius, (Number(point[2]) - v.centerY) / v.baseRadius, frame);
      if (sky) close(angularDistance(sky, target), 8, .01); // SVG coordinates round to .01 px.
    }
  }
});

test('region toggles and cached view updates do not leave stale shading', () => {
  const svg = mockSvg(), a = source('a', 170), b = source('b', 220), config = { latitude: 29, zmax: 70, fov: 8 };
  renderAtlas(svg, [a, b], a.id, { config });
  const first = layerPath(svg, 'fov-fill'), firstReach = layerPath(svg, 'reach-fill');
  renderAtlas(svg, [a, b], b.id, { config });
  assert.notEqual(layerPath(svg, 'fov-fill'), first);
  assert.equal(layerPath(svg, 'reach-fill'), firstReach);
  renderAtlas(svg, [a, b], b.id, { config: { ...config, zmax: 40, fov: 3 } });
  assert.notEqual(layerPath(svg, 'reach-fill'), firstReach);
  renderAtlas(svg, [a, b], a.id, { config, showFov: false, showReach: false });
  assert.equal(layerPath(svg, 'fov-fill'), undefined);
  assert.equal(layerPath(svg, 'fov'), undefined);
  assert.equal(layerPath(svg, 'reach-fill'), undefined);
  assert.equal(layerPath(svg, 'reach'), undefined);
  renderAtlas(svg, [a], 'missing', { config });
  assert.equal(layerPath(svg, 'fov-fill'), undefined);
});

test('changing selection preserves source tab order while drawing a noninteractive highlight above crowded markers', () => {
  const svg = mockSvg(), sources = [source('first', 180), source('second', 180), source('last', 180)];
  for (const selected of sources) {
    renderAtlas(svg, sources, selected.id);
    const interactive = [...svg.innerHTML.matchAll(/<circle[^>]*data-source="([^"]+)"[^>]*tabindex="0"[^>]*>/g)];
    assert.deepEqual(interactive.map(match => match[1]), ['first', 'second', 'last']);
    const decoration = svg.innerHTML.match(/<g aria-hidden="true" pointer-events="none">.*?<\/g>/);
    assert.ok(decoration && decoration.index > interactive.at(-1).index);
    assert.ok(!/tabindex|data-source|role="button"/.test(decoration[0]));
  }
});

test('LHAASO comparison shading uses its fixed site in both frames, independently of LACT settings and layer toggles', () => {
  assert.equal(LHAASO_COMPARISON.latitude, 29.3586111);
  assert.equal(LHAASO_COMPARISON.longitude, 100.1374972);
  assert.equal(LHAASO_COMPARISON.zmax, 50);
  const range = reachDeclinationRange(LHAASO_COMPARISON);
  close(range.min, -20.6413889); close(range.max, 79.3586111);
  const svg = mockSvg(), target = source('target', 180, 30);
  for (const frame of ['equatorial', 'galactic']) {
    const config = { latitude: 29.3586111, longitude: 100.1374972, zmax: 70, fov: 8 };
    const initial = renderAtlas(svg, [target], target.id, { frame, config, showLhaaso: true });
    const firstPath = layerPath(svg, 'lhaaso-reach-fill'), rects = rectangles(firstPath), firstReach = layerPath(svg, 'reach-fill');
    const v = initial.viewport;
    let included = 0, excluded = 0;
    for (let y = 27; y < v.height - 24; y += 14) for (let x = 2; x < v.width - 1; x += 16) {
      const sky = unprojectAtlas((x - v.centerX) / v.baseRadius, (y - v.centerY) / v.baseRadius, frame);
      if (!sky) continue;
      const expected = sky.dec >= -20.6413889 && sky.dec <= 79.3586111;
      assert.equal(covered(rects, x, y), expected);
      if (expected) included++; else excluded++;
    }
    assert.ok(included > 0 && excluded > 0);
    const borders = [...svg.innerHTML.matchAll(/<path data-atlas-layer="lhaaso-reach"[^>]*>/g)];
    assert.equal(borders.length, 2);
    assert.ok(borders.every(([markup]) => markup.includes('pointer-events="none"') && !markup.includes('stroke-dasharray')));
    assert.ok(initial.hits.some(hit => hit.id === target.id));
    renderAtlas(svg, [target], target.id, { frame, showLhaaso: true, config: { ...config, latitude: -45, longitude: -90, zmax: 15 } });
    assert.equal(layerPath(svg, 'lhaaso-reach-fill'), firstPath);
    assert.notEqual(layerPath(svg, 'reach-fill'), firstReach);
    renderAtlas(svg, [target], target.id, { frame, config, showLhaaso: true, showReach: false, showFov: false });
    assert.equal(layerPath(svg, 'lhaaso-reach-fill'), firstPath);
    assert.equal(layerPath(svg, 'reach-fill'), undefined);
    assert.equal(layerPath(svg, 'fov-fill'), undefined);
    renderAtlas(svg, [target], target.id, { frame, config });
    assert.equal(layerPath(svg, 'lhaaso-reach-fill'), undefined);
    assert.equal(layerPath(svg, 'lhaaso-reach'), undefined);
    assert.ok(layerPath(svg, 'reach-fill') && layerPath(svg, 'fov-fill'));
  }
});
