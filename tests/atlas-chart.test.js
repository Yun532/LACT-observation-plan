import assert from 'node:assert/strict';
import test from 'node:test';
import { equatorialToGalactic, galacticToEquatorial, projectAtlas, unprojectAtlas, atlasHourColor, renderAtlas, limitAtlasView } from '../src/atlas-chart.js';

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
  assert.match(svg.innerHTML, /几何可达边界/);
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
