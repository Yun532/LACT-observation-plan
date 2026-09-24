import assert from 'node:assert/strict';
import { parsePrivateCatalog, PRIVATE_CATALOG_LIMITS } from '../src/private-catalog.js';

// Entirely synthetic fixtures; never read a local/private catalog in CI.
const catalog = `source_dict:
  Synthetic-A:
    sed_model:
      sed_type: PL
      norm: [2.1, 0.3, -0.2, '1e-12']
      index: [-2.4, 0.1, -0.2]
      E_0: 7
    spatial_model:
      spatial_type: two_gaussian
      ra: [12.3, 0.2, -0.3]
      dec: [-4.5, 0.1, -0.2]
      ext: [0.4, 0.1, -0.2]
      ra1: [13.1, 0.2, -0.1]
      dec1: [-3.8, 0.1, -0.1]
      ext1: [0.9, 0.2, -0.1]
    each_bin: {real_E: [1.2, 4.3], real_E_error: [0.1, 0.2], R_68: [0.2, 0.1]}
    statistics: {TS: 64, ts_curve: 3}
  Synthetic-B:
    spatial_model:
      spatial_type: file_cube
      ra_dec_ext: [123.4, 56.7, 1.5]
      template_root_path: /synthetic/local/template.root
    statistics: {TS: 36}
`;
const parsed = parsePrivateCatalog(catalog, '/local/example.yaml');
assert.equal(parsed.meta.filename, 'example.yaml');
assert.equal(parsed.sources.length, 2);
const [first, second] = parsed.sources;
assert.equal(first.id, 'private:2lhaaso:synthetic-a');
assert.deepEqual(first.components.map(component => [component.ra, component.dec]), [[12.3, -4.5], [13.1, -3.8]]);
assert.equal(first.statistics.TS, 64);
assert.ok(first.components.every(component => component.ts === null && component.detected === null));
assert.equal(first.flux, null, 'Unspecified physical units must not be invented');
assert.equal(first.coordinateFrame, 'FK5/J2000');
assert.equal(parsed.meta.coordinateFrame, 'FK5/J2000');
assert.equal(first.extension.kind, 'gaussian-sigma');
assert.equal(first.extension.sigmaDeg, 0.4);
assert.equal(first.extension.radiusDeg, undefined, 'Gaussian sigma is not relabeled as r39');
assert.deepEqual(first.components.map(component => component.extension.sigmaDeg), [0.4, 0.9]);
assert.deepEqual(first.extension.uncertainty.values, [0.1, -0.2]);
assert.equal(first.extension.upperLimit, null, 'Error-array signs do not establish an upper limit');
assert.deepEqual(first.catalogData.sed_model.norm, [2.1, 0.3, -0.2, '1e-12']);
assert.deepEqual(first.components[0].positionUncertainty.ra, [0.2, -0.3]);
assert.deepEqual([second.ra, second.dec], [123.4, 56.7]);
assert.equal(second.spectrum, null);
assert.equal(second.extension.kind, 'catalog-undefined', 'File-template radii do not inherit Gaussian sigma interpretation');
assert.ok(parsed.sources.every(source => source.private && source.status === 'private' && source.defaultIncluded));
assert.deepEqual(parsePrivateCatalog(catalog, '/local/example.yaml'), parsed, 'Parsing must be deterministic');

const synthetic = spatial => `source_dict:\n  Artificial: ${JSON.stringify({spatial_model: spatial})}`;
assert.equal(parsePrivateCatalog(synthetic({ra: 0, dec: -90, spatial_type: 'ps'})).sources[0].extension, null);
const gaussian = parsePrivateCatalog(synthetic({ra: 11, dec: 22, spatial_type: 'gaussian', ext: 0.6, ext_err: 0.07, 'p_err(95%)': 0.2})).sources[0];
assert.equal(gaussian.extension.sigmaDeg, 0.6);
assert.equal(gaussian.extension.uncertainty.errorField, 0.07);
assert.equal(gaussian.catalogData.spatial_model['p_err(95%)'], 0.2);
assert.equal(parsePrivateCatalog(synthetic({ra: 11, dec: 22, spatial_type: 'gaussian', 'p_err(95%)': 0.2})).sources[0].extension, null, 'Position uncertainty must not create an extension');
assert.equal(parsePrivateCatalog(synthetic({ra: 11, dec: 22, spatial_type: 'ellipse_gauss', ext: 0.6, a_deg: [1, 0.2, -0.1]})).sources[0].extension.kind, 'catalog-undefined');
assert.equal(parsePrivateCatalog(synthetic({ra: 11, dec: 22, spatial_type: 'gaussian', ext: [0, 0.1, 0.1]})).sources[0].extension.upperLimit, null, 'Zero sigma must not turn an uncertainty into an upper limit');
assert.throws(() => parsePrivateCatalog(synthetic({ra: 11, dec: 22, spatial_type: 'gaussian', ext: -0.1})), /高斯展宽/u);
assert.throws(() => parsePrivateCatalog(synthetic({ra: 360, dec: 0})), /角度范围/u);
assert.throws(() => parsePrivateCatalog(synthetic({ra: 1, dec: 91})), /角度范围/u);
assert.throws(() => parsePrivateCatalog(synthetic({ra: 1})), /位置参数/u);
assert.throws(() => parsePrivateCatalog(synthetic({ra_dec_ext: [1, 2]})), /模板位置/u);
assert.throws(() => parsePrivateCatalog('source_dict: {}'), /记录数/u);
assert.throws(() => parsePrivateCatalog('source_dict: []'), /名称映射/u);
assert.throws(() => parsePrivateCatalog('source_dict: {Artificial: {spatial_model: {ra: .nan, dec: 0}}}'), /非有限/u);
assert.throws(() => parsePrivateCatalog('source_dict: {Artificial: {spatial_model: {ra: .inf, dec: 0}}}'), /非有限/u);
assert.throws(() => parsePrivateCatalog('source_dict: {}\nsource_dict: {}'), /重复字段/u);
assert.throws(() => parsePrivateCatalog('source_dict: &x {}\ncopy: *x'), /别名/u);
assert.throws(() => parsePrivateCatalog('source_dict: !!python/object {}'), /标签/u);
assert.throws(() => parsePrivateCatalog('source_dict: {}\n__proto__: {polluted: true}'), /不安全/u);
assert.throws(() => parsePrivateCatalog('source_dict: {}\nconstructor: {}'), /不安全/u);
assert.equal({}.polluted, undefined);
assert.throws(() => parsePrivateCatalog('x'.repeat(PRIVATE_CATALOG_LIMITS.bytes + 1)), /2 MiB/u);
assert.throws(() => parsePrivateCatalog(`source_dict: {}\nnote: ${'x'.repeat(PRIVATE_CATALOG_LIMITS.string + 1)}`), /过长/u);
assert.throws(() => parsePrivateCatalog('source_dict: {}\nnested: ' + '['.repeat(22) + '0' + ']'.repeat(22)), /嵌套/u);
assert.throws(() => parsePrivateCatalog(JSON.stringify({source_dict: Object.fromEntries(Array.from({length: 2001}, (_, i) => [`Synthetic-${i}`, {}]))})), /记录数/u);
const repeated = parsePrivateCatalog('source_dict: {A: {spatial_model: {ra: 1, dec: 2}}, A: {spatial_model: {ra: 3, dec: 4}}}');
assert.equal(repeated.sources.length, 2, 'Repeated source keys must not silently overwrite measurements');
assert.equal(new Set(repeated.sources.map(source => source.id)).size, 2);
assert.ok(repeated.meta.warnings.length && repeated.sources.every(source => source.duplicateName));
const reordered = parsePrivateCatalog('source_dict: {A: {spatial_model: {ra: 3, dec: 4}}, A: {spatial_model: {ra: 1, dec: 2}}}');
assert.deepEqual(repeated.sources.map(source => source.id).sort(), reordered.sources.map(source => source.id).sort());
assert.throws(() => parsePrivateCatalog('source_dict: {A: {spatial_model: {ra: 1, ra: 2, dec: 2}}}'), /重复字段/u);
assert.throws(() => parsePrivateCatalog('source_dict: {PRIVATE-CONTENT: !unknown redacted}'), error => !error.message.includes('PRIVATE-CONTENT'));
console.log('Synthetic private-catalog parsing checks passed.');
