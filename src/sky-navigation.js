const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function limitSkyView(view) {
  const zoom = clamp(view.zoom, 1, 12);
  if (zoom === 1) return { zoom, x: 0, y: 0 };
  const distance = Math.hypot(view.x, view.y), factor = distance > 1 ? 1 / distance : 1;
  return { zoom, x: view.x * factor, y: view.y * factor };
}

// Keep the sky coordinate underneath the pointer fixed while zooming.
export function zoomSkyView(view, viewport, factor, anchor = { x: viewport.centerX, y: viewport.centerY }) {
  const zoom = clamp(view.zoom * factor, 1, 12);
  const shift = (1 / view.zoom - 1 / zoom) / viewport.baseRadius;
  return limitSkyView({ zoom, x: view.x + (anchor.x - viewport.centerX) * shift, y: view.y + (anchor.y - viewport.centerY) * shift });
}

export function skyHitsAt(hits, point) {
  return hits.map(h => ({ ...h, distance: Math.hypot(h.x - point.x, h.y - point.y) }))
    .filter(h => h.distance <= Math.max(7, h.r + 3)).sort((a, b) => a.distance - b.distance);
}

export function bindSkyNavigation(canvas, { getView, getViewport, change, hover, pick }) {
  const pointers = new Map();
  let gesture = null, moved = false;
  const point = event => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
  const startGesture = () => {
    const points = [...pointers.values()];
    gesture = { view: { ...getView() }, points };
  };
  canvas.addEventListener('wheel', event => {
    if (!getViewport()) return;
    event.preventDefault();
    change(zoomSkyView(getView(), getViewport(), Math.exp(-clamp(event.deltaY * (event.deltaMode ? 16 : 1), -300, 300) * .003), point(event)));
    if (pointers.size) { moved = true; startGesture(); }
  }, { passive: false });
  canvas.onpointerdown = event => {
    if (event.button !== 0 || !getViewport()) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point(event));
    if (pointers.size === 1) moved = false; else moved = true;
    startGesture();
  };
  canvas.onpointermove = event => {
    const p = point(event);
    if (!pointers.has(event.pointerId)) { hover(p); return; }
    pointers.set(event.pointerId, p);
    const points = [...pointers.values()], first = gesture.points[0], current = points[0], viewport = getViewport();
    if (points.length > 1 && gesture.points.length > 1) {
      const second = gesture.points[1], next = points[1];
      const anchor = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
      const factor = Math.hypot(next.x - current.x, next.y - current.y) / Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const view = zoomSkyView(gesture.view, viewport, factor, anchor), radius = viewport.baseRadius * view.zoom;
      change(limitSkyView({ ...view, x: view.x - (mid.x - anchor.x) / radius, y: view.y - (mid.y - anchor.y) / radius }));
    } else {
      const dx = current.x - first.x, dy = current.y - first.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved) {
        const radius = viewport.baseRadius * gesture.view.zoom;
        change(limitSkyView({ ...gesture.view, x: gesture.view.x - dx / radius, y: gesture.view.y - dy / radius }));
      }
    }
    canvas.style.cursor = 'grabbing';
  };
  const end = (event, cancelled = false) => {
    if (!pointers.has(event.pointerId)) return;
    const select = !cancelled && !moved && pointers.size === 1;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size) startGesture(); else { gesture = null; canvas.style.cursor = 'grab'; }
    if (select) pick(point(event));
  };
  canvas.onpointerup = event => end(event);
  canvas.onpointercancel = event => end(event, true);
  canvas.onlostpointercapture = event => end(event, true);
  canvas.onkeydown = event => {
    const viewport = getViewport(); if (!viewport) return;
    const view = getView(), step = 40 / (viewport.baseRadius * view.zoom);
    let next;
    if (event.key === '+' || event.key === '=') next = zoomSkyView(view, viewport, 1.5);
    if (event.key === '-') next = zoomSkyView(view, viewport, 1 / 1.5);
    if (event.key === 'Home' || event.key === '0') next = { zoom: 1, x: 0, y: 0 };
    if (event.key === 'ArrowLeft') next = { ...view, x: view.x - step };
    if (event.key === 'ArrowRight') next = { ...view, x: view.x + step };
    if (event.key === 'ArrowUp') next = { ...view, y: view.y - step };
    if (event.key === 'ArrowDown') next = { ...view, y: view.y + step };
    if (next) { event.preventDefault(); change(limitSkyView(next)); if (pointers.size) { moved = true; startGesture(); } }
  };
}
