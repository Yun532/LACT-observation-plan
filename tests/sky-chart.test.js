import assert from 'node:assert/strict';
import { projectHorizontal, unprojectHorizontal, horizontalSeparation, horizontalCircle, renderSiteSky, extensionLabel } from '../src/sky-chart.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
close(projectHorizontal(90, 0).x, 0);
close(projectHorizontal(0, 0).y, -1);
close(projectHorizontal(0, 90).x, -1);
close(projectHorizontal(0, 180).y, 1);
close(projectHorizontal(0, 270).x, 1);
for (const alt of [0, 15, 30, 60, 89.9]) for (const az of [0, 1, 90, 180, 270, 359.9]) {
  const p = projectHorizontal(alt, az), q = unprojectHorizontal(p.x, p.y);
  close(q.alt, alt); close(q.az, az);
}
// Lunar exclusion boundaries must stay spherical through horizon crossings and >90° caps.
for (const alt of [-60, -1, 0, 45, 89.99, 90]) for (const radius of [.05, 1, 40, 90, 130, 179.9]) {
  const centre = { alt, az: 359 };
  for (const p of horizontalCircle(centre.alt, centre.az, radius, 32)) close(horizontalSeparation(centre, p), radius, 1e-8);
}
assert.ok(horizontalCircle(-10, 0, 40).some(p => p.alt > 0), 'A Moon below the horizon can still exclude part of the visible sky');
assert.ok(horizontalCircle(-50, 0, 40).every(p => p.alt < 0), 'A lunar cap entirely below the horizon should have no visible boundary');

// Large-catalog smoke check: count visible objects and verify hit metadata without a browser dependency.
let strokes = 0;
const noop = () => {};
const context = new Proxy({ measureText: text => ({ width: text.length * 6 }), stroke: () => { strokes++; } }, { get: (target, key) => key in target ? target[key] : noop });
const canvas = { getBoundingClientRect: () => ({ width: 550, height: 420 }), getContext: () => context, setAttribute: noop };
const stars = Array.from({ length: 47000 }, (_, i) => ({ id: `star-${i}`, name: `HIP ${i}`, ra: i % 360, dec: 0, mag: i % 80 / 10 }));
const starPositions = stars.map((s, i) => ({ id: s.id, alt: i % 2 === 0 ? 45 : -45, az: i % 360 }));
const target = { id: 'target', name: 'Selected source', ra: 200, dec: 30, extension: { kind: 'gaussian-r39', radiusDeg: .3, upperLimit: true, confidence: .95 } };
const positions = { sources: [...starPositions, { id: target.id, alt: 55, az: 123 }, { id: 'hidden', alt: -1, az: 10 }], sun: { alt: -20, az: 250 }, moon: { alt: 20, az: 60 } };
const started = performance.now();
const result = renderSiteSky(canvas, { positions, sources: [target, { id: 'hidden', name: 'Hidden' }], stars, visible: [target.id], focus: target.id, config: { moon: 130 } });
assert.equal(result.starCount, 23500);
assert.equal(result.sourceCount, 1);
assert.equal(result.selectedAbove, 1);
assert.equal(result.hits.length, 23502, 'Visible stars, one source and the Moon must have hits');
const hit = result.hits.find(h => h.id === target.id);
assert.equal(hit.name, target.name);
assert.equal(hit.alt, 55); assert.equal(hit.az, 123); assert.equal(hit.selected, true);
assert.equal(hit.extension, target.extension);
assert.match(extensionLabel(hit), /r39 < 0.3°.*95%/);
assert.equal(result.hits.some(h => h.id === 'hidden'), false);
assert.ok(strokes < 500, 'Faint star crosses must be batched, not stroked one object at a time');
console.log(`47,000-star mock rendering and hit metadata passed (${(performance.now() - started).toFixed(0)} ms)`);
console.log('Instantaneous sky projection checks passed');
