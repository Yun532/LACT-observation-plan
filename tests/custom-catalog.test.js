import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCustomSource, parseCustomCatalog, mergeCustomSources, serializeCustomCatalog,
  isCustomId, CUSTOM_CATALOG_KEY, CUSTOM_CATALOG_LIMITS,
  customSourcesForPlan, mergePlanCustomSources, removeCustomPlanReferences,
} from '../src/custom-catalog.js';

// Synthetic coordinates only: local scientific tables never belong in fixtures.
test('custom targets preserve coordinate conventions and survive saved-plan normalization', () => {
  const source = normalizeCustomSource({ name: 'Synthetic target', ra: 12.5, dec: -0.25, frame: 'FK5 (J2000)', notes: 'Local only' });
  assert.equal(source.coordinateFrame, 'FK5/J2000');
  assert.equal(source.catalog, '自定义');
  assert.equal(source.private, undefined);
  assert.equal(source.custom, true);
  assert.equal(source.flux, null);
  assert.equal(source.extension, null);
  assert.deepEqual(normalizeCustomSource(JSON.parse(JSON.stringify(source))), source);
  assert.ok(isCustomId(source.id));
  assert.equal(isCustomId('private:2lhaaso:synthetic'), false);
  assert.equal(isCustomId(null), false);
  assert.ok(CUSTOM_CATALOG_KEY);
  const icrs = normalizeCustomSource({ name: source.name, ra: source.ra, dec: source.dec, coordinate_frame: 'icrs' });
  assert.equal(icrs.coordinateFrame, 'ICRS');
  assert.notEqual(icrs.id, source.id);
  assert.match(normalizeCustomSource({ ra: 0, dec: 90 }).name, /目标/u);
});

test('decimal units, sexagesimal RA and signed-zero Dec are interpreted explicitly', () => {
  const a = normalizeCustomSource({ ra: '12:30:00', dec: '-00:30:00' });
  assert.equal(a.ra, 187.5);
  assert.equal(a.dec, -0.5);
  assert.equal(normalizeCustomSource({ ra: '12 30 00', dec: '+90 00 00' }).dec, 90);
  assert.equal(normalizeCustomSource({ ra: '12.5', dec: -90, ra_unit: 'hour' }).ra, 187.5);
  assert.equal(normalizeCustomSource({ ra: 12.5, dec: 0, raUnit: 'hour' }).ra, 187.5);
  assert.equal(normalizeCustomSource({ ra: '12.5', dec: 0 }).ra, 12.5);
  assert.equal(normalizeCustomSource({ ra: '1.2e2', dec: 0 }).ra, 120);
  assert.equal(Object.is(normalizeCustomSource({ ra: -0, dec: '-0' }).dec, -0), false);
  for (const value of ['', ' ', null, true, NaN, Infinity, -1, 360, '0x10', '24:00:00', '23:60:00', '23:59:60', '-00:00:01', '12:30']) {
    assert.throws(() => normalizeCustomSource({ ra: value, dec: 0 }));
  }
  for (const value of ['', null, -90.1, 90.1, '90:00:01', '-90:00:01', '00:60:00']) {
    assert.throws(() => normalizeCustomSource({ ra: 0, dec: value }));
  }
  assert.throws(() => normalizeCustomSource({ ra: 24, dec: 0, ra_unit: 'hour' }));
  assert.throws(() => normalizeCustomSource({ ra: 0, dec: 0, frame: 'galactic' }), /坐标系/u);
  assert.throws(() => normalizeCustomSource({ ra: 0, dec: 0, frame: 'ICRS', coordinateFrame: 'FK5/J2000' }), /冲突/u);
  assert.throws(() => normalizeCustomSource({ ra: 0, dec: 0, ra_unit: 'radian' }), /单位/u);
});

test('CSV and YAML accept the same minimal table and preserve quoted multiline notes', () => {
  const csv = '\uFEFFname,RA,Dec,frame,ra_unit,notes\r\n"Synthetic, A",12:30:00,-00:30:00,ICRS,deg,"Line one\n""Line two"""\r\n';
  const [source] = parseCustomCatalog(csv, 'targets.csv');
  assert.equal(source.name, 'Synthetic, A');
  assert.equal(source.ra, 187.5);
  assert.equal(source.dec, -0.5);
  assert.equal(source.notes, 'Line one\n"Line two"');
  assert.equal(source.coordinateFrame, 'ICRS');
  const yaml = 'sources:\n  - name: "Synthetic, A"\n    ra: "12:30:00"\n    dec: "-00:30:00"\n    frame: ICRS\n    notes: |\n      Line one\n      "Line two"\n';
  assert.deepEqual(parseCustomCatalog(yaml, 'targets.yml'), [source]);
  assert.equal(parseCustomCatalog('- {ra: 12, dec: 13}')[0].ra, 12);
  assert.equal(parseCustomCatalog('ra,dec\n12,13')[0].dec, 13);
  assert.deepEqual(parseCustomCatalog(JSON.stringify({ sources: [source] }), 'snapshot.yaml'), [source]);
});

test('reversible CSV export guards spreadsheet formulas, apostrophes, quotes and Unicode', () => {
  const targets = ['=1+2', '+1', '-Synthetic', '@import', "'literal", '中文, "target"'].map((name, i) => normalizeCustomSource({ name, ra: i, dec: -1, type: '=bad()', notes: '@bad()\nSecond line' }));
  const csv = serializeCustomCatalog(targets);
  assert.ok(csv.includes('text_encoding'));
  assert.ok(csv.includes('"\'=1+2"'));
  assert.ok(csv.includes('"\'@bad()'));
  assert.deepEqual(parseCustomCatalog(csv, 'backup.csv'), targets);
  // An unmarked third-party input is literal, not silently apostrophe-decoded.
  assert.equal(parseCustomCatalog("name,ra,dec\n'=name,1,2", 'literal.csv')[0].name, "'=name");
  assert.equal(parseCustomCatalog('name,ra,dec\n=1+2,1,2', 'literal.csv')[0].name, '=1+2');
});

test('merge skips repeated identities without replacing metadata or merging distinct positions', () => {
  const a = normalizeCustomSource({ name: 'Synthetic', ra: 1, dec: 2, notes: 'Existing' });
  const duplicate = { ...a, notes: 'Incoming' };
  const moved = normalizeCustomSource({ name: 'Synthetic', ra: 2, dec: 2 });
  const reframed = normalizeCustomSource({ name: 'Synthetic', ra: 1, dec: 2, frame: 'ICRS' });
  const result = mergeCustomSources([a], [duplicate, moved, moved, reframed]);
  assert.deepEqual([result.added, result.duplicates, result.sources.length], [2, 2, 3]);
  assert.equal(result.sources[0].notes, 'Existing');
  assert.equal(new Set(result.sources.map(source => source.id)).size, 3);
  assert.deepEqual(mergeCustomSources([], [moved, a]).sources.map(source => source.id).sort(), [a.id, moved.id].sort());
});

test('cumulative UTF-8 export limit rejects oversized additions without changing current sources', () => {
  const make = offset => Array.from({ length: 200 }, (_, i) => normalizeCustomSource({ name: `Synthetic ${offset + i}`, ra: (offset + i) / 10, dec: 0, notes: '观'.repeat(2000) }));
  const current = mergeCustomSources([], make(0)).sources;
  const incoming = mergeCustomSources([], make(200)).sources;
  const before = structuredClone(current);
  assert.deepEqual(parseCustomCatalog(serializeCustomCatalog(current), 'backup.csv'), current);
  assert.throws(() => serializeCustomCatalog([...current, ...incoming]), /导出内容不能超过 2 MiB/u);
  assert.throws(() => mergeCustomSources(current, incoming), /减少备注或分批管理/u);
  assert.deepEqual(current, before);
});

test('malformed, dangerous and excessive tables fail without exposing row contents', () => {
  for (const csv of ['name,ra\nA,1', 'ra,ra,dec\n1,2,3', 'ra,dec\n1', 'ra,dec\n"1,2', 'ra,dec\n"1"x,2', 'ra,dec\n1,', 'ra,dec\n,2', 'constructor,ra,dec\nx,1,2']) {
    assert.throws(() => parseCustomCatalog(csv, 'invalid.csv'));
  }
  for (const yaml of [
    'sources: []', 'sources: {}', '- {ra: 1, ra: 2, dec: 3}',
    '- &target {ra: 1, dec: 2}\n- *target', '- {ra: .nan, dec: 2}',
    '- {ra: 1, dec: 2, __proto__: {polluted: true}}',
    '- {ra: 1, dec: 2, constructor: {prototype: {polluted: true}}}',
    '- {ra: !unknown 1, dec: 2}', '- {ra: 1, dec: 2, notes: [nested]}',
  ]) assert.throws(() => parseCustomCatalog(yaml, 'invalid.yaml'));
  assert.equal({}.polluted, undefined);
  assert.throws(() => normalizeCustomSource(Object.assign(Object.create({ inherited: true }), { ra: 1, dec: 2 })));
  assert.throws(() => normalizeCustomSource({ ra: 1, dec: 2, name: '\u0000' }));
  assert.throws(() => normalizeCustomSource({ ra: 1, dec: 2, name: 'x'.repeat(257) }));
  assert.throws(() => normalizeCustomSource({ ra: 1, dec: 2, notes: 'x'.repeat(2049) }));
  assert.throws(() => parseCustomCatalog('x'.repeat(CUSTOM_CATALOG_LIMITS.bytes + 1)), /2 MiB/u);
  assert.throws(() => parseCustomCatalog('ra,dec\n' + '1,2\n'.repeat(1001), 'huge.csv'), /1000/u);
  assert.throws(() => parseCustomCatalog(JSON.stringify(Array.from({ length: 1001 }, () => ({ ra: 1, dec: 2 }))), 'huge.yaml'), /1000/u);
  assert.throws(() => parseCustomCatalog('- {name: PRIVATE-NAME, ra: BAD-COORDINATE, dec: 0}', 'invalid.yaml'), error => !/PRIVATE-NAME|BAD-COORDINATE/u.test(error.message));
  assert.throws(() => parseCustomCatalog('- {ra: 1, dec: 2, notes: ' + '['.repeat(30) + '0' + ']'.repeat(30) + '}', 'deep.yaml'), /嵌套/u);
});

test('plan snapshots include focus, overlays and tasks, then restore without the original source table', () => {
  const [focus, overlay, task, unused] = [0, 1, 2, 3].map(ra => normalizeCustomSource({ name: 'Synthetic ' + ra, ra, dec: 0 }));
  const plan = { focus: focus.id, visible: [overlay.id, 'tevcat-87'], blocks: [{ id: 1, source: task.id, start: 0, duration: 30 }] };
  const definitions = customSourcesForPlan(plan, [unused, task, overlay, focus, { id: 'tevcat-87' }]);
  assert.deepEqual(definitions, [focus, overlay, task]);
  assert.deepEqual(mergePlanCustomSources(JSON.parse(JSON.stringify({ ...plan, customSources: definitions })), []), definitions);
  assert.deepEqual(customSourcesForPlan({ focus: focus.id, visible: [], blocks: [] }, [focus]), [focus]);
  assert.deepEqual(mergePlanCustomSources({ focus: focus.id, customSources: [focus] }, []), [focus]);
  assert.deepEqual(mergePlanCustomSources(plan, definitions), definitions);
  assert.deepEqual(customSourcesForPlan({ focus: 'tevcat-87', blocks: [] }, [focus]), []);
  assert.deepEqual(mergePlanCustomSources({ focus: 'tevcat-87', blocks: [] }, [focus]), [focus]);
  const long = normalizeCustomSource({ name: '天'.repeat(200), ra: 10, dec: 20 });
  assert.ok(long.id.length > 1000);
  assert.deepEqual(mergePlanCustomSources({ focus: long.id, customSources: customSourcesForPlan({ focus: long.id }, [long]) }, []), [long]);
});

test('plan import rejects stale coordinates, unused definitions and missing targets atomically', () => {
  const current = normalizeCustomSource({ name: 'Current', ra: 1, dec: 2, notes: 'Keep local metadata' });
  const imported = normalizeCustomSource({ name: 'Imported', ra: 3, dec: 4 });
  const before = structuredClone(current);
  assert.throws(() => mergePlanCustomSources({ focus: imported.id }, [current]), /缺少坐标定义/u);
  assert.throws(() => customSourcesForPlan({ focus: imported.id }, [current]), /缺少坐标定义/u);
  assert.throws(() => mergePlanCustomSources({ focus: imported.id, customSources: [{ ...imported, ra: 5 }] }, [current]), /不一致/u);
  assert.throws(() => customSourcesForPlan({ focus: imported.id }, [{ ...imported, coordinateFrame: 'ICRS' }]), /不一致/u);
  assert.throws(() => mergePlanCustomSources({ focus: current.id, customSources: [imported] }, [current]), /未被引用/u);
  assert.throws(() => mergePlanCustomSources({ customSources: null }, [current]), /源数组/u);
  assert.throws(() => mergePlanCustomSources({ customSources: Array(1001).fill(imported) }, [current]), /1000/u);
  assert.deepEqual(current, before);
  assert.deepEqual(mergePlanCustomSources({ focus: current.id, customSources: [{ ...current, notes: 'Imported metadata' }] }, [current]), [current]);
  assert.deepEqual(mergePlanCustomSources({ focus: imported.id, customSources: [imported] }, [current]), [current, imported]);
});

test('removing custom references keeps tasks and public/private catalog identities intact', () => {
  assert.equal(removeCustomPlanReferences(null, []), null);
  const unrelated = { version: 1, blocks: [], catalogIdentity: { private: false } };
  assert.equal(removeCustomPlanReferences(unrelated, ['custom:unused']), unrelated);
  const a = normalizeCustomSource({ name: 'A', ra: 1, dec: 2 });
  const b = normalizeCustomSource({ name: 'B', ra: 3, dec: 4 });
  const plan = { focus: a.id, visible: [a.id, b.id], blocks: [{ id: 1, source: 'tevcat-87', start: 0, duration: 30 }], customSources: [a, b], catalogIdentity: { private: true, fingerprint: 'synthetic' } };
  const before = structuredClone(plan);
  const cleaned = removeCustomPlanReferences(plan, [a.id]);
  assert.equal(cleaned.focus, b.id);
  assert.deepEqual(cleaned.visible, [b.id]);
  assert.deepEqual(cleaned.customSources, [b]);
  assert.deepEqual(cleaned.blocks, plan.blocks);
  assert.deepEqual(cleaned.catalogIdentity, plan.catalogIdentity);
  assert.deepEqual(plan, before);
  const taskFallback = removeCustomPlanReferences({ ...plan, visible: [a.id] }, new Set([a.id]));
  assert.equal(taskFallback.focus, 'tevcat-87');
  assert.deepEqual(taskFallback.visible, ['tevcat-87']);
  const fallback = removeCustomPlanReferences({ focus: a.id, blocks: [], catalogIdentity: { private: false } }, [a.id], 'tevcat-74');
  assert.equal(fallback.focus, 'tevcat-74');
  assert.deepEqual(fallback.visible, ['tevcat-74']);
  assert.equal(Object.hasOwn(fallback, 'customSources'), false);
  assert.deepEqual(fallback.catalogIdentity, { private: false });
});
