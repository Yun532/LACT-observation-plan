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

// Synthetic two-component Gaussian: the primary must not be drawn twice and
// the second centre uses its own precomputed horizon coordinates.
const sigma=value=>({kind:'gaussian-sigma',sigmaDeg:value});
const two={id:'synthetic',name:'Synthetic Gaussian',ra:100,dec:20,extension:sigma(.5),components:[
  {id:'first',ra:100,dec:20,extension:sigma(.5)},
  {id:'second',ra:103,dec:22,extension:sigma(1)},
]};
let sigmaLabels=0;
context.fillText=text=>{if(text==='σ')sigmaLabels++;};
const twoPositions={sources:[{id:'synthetic',alt:50,az:90},{id:'synthetic::first',alt:50,az:90},{id:'synthetic::second',alt:54,az:97}]};
const twoResult=renderSiteSky(canvas,{positions:twoPositions,sources:[two],visible:['synthetic'],focus:'synthetic',showStars:false});
assert.equal(sigmaLabels,2,'The primary and secondary each have one labeled sigma contour');
assert.equal(twoResult.hits.length,2,'One parent centre and one distinct component centre');
const secondHit=twoResult.hits.find(h=>h.componentId==='synthetic::second');
assert.equal(secondHit.id,'synthetic','Clicking a component keeps the catalog source as the selected task target');
assert.equal(secondHit.alt,54);assert.equal(secondHit.az,97);
assert.equal(secondHit.extension.sigmaDeg,1);
assert.match(extensionLabel(secondHit),/σ 1°.*参考圈/);
assert.doesNotMatch(extensionLabel(secondHit),/r39|位置误差/);
const hiddenExtensions=renderSiteSky(canvas,{positions:twoPositions,sources:[two],showExtensions:false,showStars:false});
assert.equal(hiddenExtensions.hits.length,1);
assert.match(extensionLabel({extension:{kind:'catalog-undefined'}}),/定义见源表/);
console.log('Instantaneous sky projection checks passed');

// A pan brings the chosen sky position to the viewport centre without enlarging
// its hit marker, while offscreen objects cannot steal clicks or leave labels.
const zoomLabels = [], attributes = {};
context.fillText = text => zoomLabels.push(text);
const zoomCanvas = { ...canvas, setAttribute: (key, value) => { attributes[key] = value; } };
const zoomOptions = {
  positions: { sources: [
    { id: 'chosen', alt: 36, az: 270 }, { id: 'offscreen', alt: 90, az: 0 },
    { id: 'bright', alt: 36, az: 270 }, { id: 'offscreen-star', alt: 90, az: 0 },
  ] },
  sources: [{ id: 'chosen', name: 'Chosen' }, { id: 'offscreen', name: 'Offscreen source' }],
  stars: [{ id: 'bright', name: 'Bright', mag: 1 }, { id: 'offscreen-star', name: 'Offscreen star', mag: 1 }],
  visible: ['chosen', 'offscreen'], focus: 'offscreen',
};
const originalView = renderSiteSky(zoomCanvas, zoomOptions);
zoomLabels.length = 0;
const zoomedView = renderSiteSky(zoomCanvas, { ...zoomOptions, view: { zoom: 4, x: .6, y: 0 } });
const chosenHit = zoomedView.hits.find(h => h.id === 'chosen');
close(chosenHit.x, zoomedView.viewport.centerX); close(chosenHit.y, zoomedView.viewport.centerY);
assert.equal(chosenHit.r, originalView.hits.find(h => h.id === 'chosen').r, 'Zoom preserves CSS-pixel marker sizes');
assert.equal(zoomedView.hits.length, 2, 'Only the on-screen source and star remain clickable');
assert.ok(zoomedView.hits.every(h => h.x >= 0 && h.x <= zoomedView.width && h.y >= 0 && h.y <= zoomedView.height));
assert.ok(zoomLabels.every(text => !text.includes('Offscreen')), 'Offscreen labels must not be clamped onto the canvas edge');
assert.equal(zoomedView.sourceCount, 2); assert.equal(zoomedView.starCount, 2); assert.equal(zoomedView.selectedAbove, 2);
assert.match(attributes['aria-label'], /4.0 倍局部视图/);
assert.doesNotMatch(attributes['aria-label'], /天顶居中/);

// The lunar mask samples one fixed-resolution viewport, not a 12x hemisphere.
// Counting spherical evaluations catches expensive offscreen sampling directly.
const originalSin = Math.sin;
let sineCalls = 0;
try {
  Math.sin = (...args) => { sineCalls++; return originalSin(...args); };
  const maxZoom = renderSiteSky({ ...canvas }, { positions: { moon: { alt: 90, az: 0 } }, config: { moon: 179 }, view: { zoom: 100 } });
  assert.equal(maxZoom.viewport.zoom, 12);
  assert.ok(sineCalls <= 2 * Math.ceil(maxZoom.width / 3) * Math.ceil(maxZoom.height / 3) + 3000, 'Lunar mask work must remain bounded by canvas area at maximum zoom');
} finally {
  Math.sin = originalSin;
}
console.log('Sky viewport zoom, pan, hit culling and bounded lunar mask checks passed');
