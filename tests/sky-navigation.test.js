import assert from 'node:assert/strict';
import { limitSkyView, zoomSkyView, skyHitsAt, bindSkyNavigation } from '../src/sky-navigation.js';

const viewport = { centerX: 250, centerY: 180, baseRadius: 150 };
const anchor = { x: 320, y: 240 }, initial = { zoom: 2, x: .1, y: -.2 };
const zoomed = zoomSkyView(initial, viewport, 3, anchor);
for (const [axis, centre] of [['x', 'centerX'], ['y', 'centerY']]) {
  const before = initial[axis] + (anchor[axis] - viewport[centre]) / (viewport.baseRadius * initial.zoom);
  const after = zoomed[axis] + (anchor[axis] - viewport[centre]) / (viewport.baseRadius * zoomed.zoom);
  assert.ok(Math.abs(before - after) < 1e-12, 'Zoom keeps the pointed sky coordinate fixed');
}
assert.deepEqual(zoomSkyView(zoomed, viewport, .001, anchor), { zoom: 1, x: 0, y: 0 });
assert.equal(limitSkyView({ zoom: 100, x: 0, y: 0 }).zoom, 12);
assert.ok(Math.hypot(...Object.values(limitSkyView({ zoom: 5, x: 5, y: -5 })).slice(1)) <= 1.0000001);
const overlapping = skyHitsAt([
  { id: 'selected', kind: 'source', selected: true, x: 18, y: 10, r: 8 },
  { id: 'target', kind: 'source', x: 10, y: 10, r: 4 },
  { id: 'far', kind: 'source', x: 40, y: 40, r: 4 },
], { x: 10, y: 10 });
assert.deepEqual(overlapping.map(h => h.id), ['target', 'selected'], 'Keep every overlapping candidate; selected source cannot steal the nearest hit');

// Exercise actual event handlers: dragging or pinching must never select a source.
let view = { zoom: 4, x: 0, y: 0 }, picks = 0;
const handlers = {}, captures = new Set();
const canvas = { style: {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }),
  addEventListener: (name, fn) => { handlers[name] = fn; },
  setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
bindSkyNavigation(canvas, { getView: () => view, getViewport: () => viewport, change: next => { view = next; }, hover() {}, pick: () => { picks++; } });
const event = (x, y, id = 1) => ({ clientX: x, clientY: y, pointerId: id, button: 0 });
canvas.onpointerdown(event(250, 180));canvas.onpointerup(event(250, 180));
assert.equal(picks, 1);
canvas.onpointerdown(event(250, 180));canvas.onpointermove(event(310, 180));canvas.onpointerup(event(310, 180));
assert.equal(view.x, -.1);assert.equal(picks, 1);
canvas.onpointerdown(event(100, 100));canvas.onpointercancel(event(100, 100));assert.equal(picks, 1);
view = { zoom: 2, x: 0, y: 0 };
canvas.onpointerdown(event(200, 180));canvas.onpointerdown(event(300, 180, 2));
canvas.onpointermove(event(400, 180, 2));canvas.onpointerup(event(400, 180, 2));canvas.onpointerup(event(200, 180));
assert.equal(view.zoom, 4);assert.equal(picks, 1);
canvas.onkeydown({ key: 'Home', preventDefault() {} });
assert.deepEqual(view, { zoom: 1, x: 0, y: 0 });
handlers.wheel({ ...event(250, 180), deltaY: -200, deltaMode: 0, preventDefault() {} });
assert.ok(view.zoom > 1);
canvas.onpointerdown(event(250, 180));
handlers.wheel({ ...event(250, 180), deltaY: -100, deltaMode: 0, preventDefault() {} });
const wheelZoom = view.zoom;
canvas.onpointermove(event(270, 180));canvas.onpointerup(event(270, 180));
assert.equal(view.zoom, wheelZoom, 'Wheel zoom during a drag must not snap back on the next move');
assert.equal(picks, 1);
console.log('Sky navigation anchor, crowded selection, drag, pinch and reset checks passed');
