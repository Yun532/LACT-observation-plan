import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSourceInfo, sourceSummary } from '../src/source-info.js';

const base = { id: 'synthetic', name: 'Synthetic source', catalog: 'TeVCat', ra: 20, dec: -1, type: 'PWN', aliases: [], coordinateFrame: 'ICRS' };

test('source information escapes source text, raw keys and unsafe references', () => {
  const html = renderSourceInfo({ ...base, type: '<img src=x onerror=bad>', aliases: ['<script>bad()</script>'], reference: 'javascript:alert(1)', catalogData: { '<svg onload=bad>': '</dd><script>bad()</script>' } });
  assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('<svg'));
  assert.ok(!html.includes('href='));
  assert.match(html, /&lt;script&gt;/);
  assert.match(renderSourceInfo({ ...base, reference: 'https://example.org/?a=1&b=2' }), /href="https:\/\/example.org\/\?a=1&amp;b=2"/);
});

test('private source retains nested model data and prevents every external link', () => {
  const html = renderSourceInfo({ ...base, private: true, coordinateFrame: 'FK5/J2000', reference: 'https://example.org/private?source=secret', catalogData: { sed_model: { unexpected: [0, null, '<script>'] }, template: 'https://example.org/private.fits' } }, { related: [{ name: '<unsafe>', reference: 'https://example.org/related' }] });
  assert.ok(!html.includes('href=') && !html.includes('<iframe') && !html.includes('<img'));
  assert.match(html, /FK5\/J2000/); assert.match(html, /unexpected/); assert.match(html, />0<\/span>/); assert.match(html, />null<\/span>/);
  assert.match(html, /private\.fits/); assert.match(html, /&lt;unsafe&gt;/);
});

test('unknown measurements stay missing while numeric zero and limits remain explicit', () => {
  const html = renderSourceInfo({ ...base, flux: { value: 0, unit: 'Crab', energy: '> 1 TeV' }, fermi: { significance: 0, variabilityIndex: 0, flags: 0 }, spectralIndex: null, components: [{ detector: 'WCDA', detected: false, flux: { value: 2e-14, unit: 'cm-2 s-1 TeV-1', energy: '3 TeV', upperLimit: true, confidence: .95 }, spectralIndex: null }] });
  assert.match(html, /0 Crab · &gt; 1 TeV/);
  assert.match(html, /≤ 2e-14 cm-2 s-1 TeV-1 · 3 TeV（95% 上限）/);
  assert.match(html, /变异指数<\/dt><dd>0/); assert.match(html, /质量标志 Flags<\/dt><dd>0/);
  assert.ok(!html.includes('<dt>光子指数</dt>'));
  assert.match(html, /不代表今晚亮度/);
});

test('public components keep position errors separate from morphology and use measured metadata', () => {
  const html = renderSourceInfo({ ...base, observatory: 'HEGRA', discovery: '200210', components: [{ detector: 'KM2A', detected: true, ra: 20, dec: -1, positionError95Deg: .12, extension: { kind: 'gaussian-r39', radiusDeg: .18, upperLimit: true, confidence: .95 }, ts: 0, ts100: 4, spectralIndex: 3, spectralIndexError: .2 }] });
  assert.match(html, /95% 定位误差<\/dt><dd>0.12°/); assert.match(html, /r39 ≤ 0.18°/);
  assert.match(html, /<dt>TS<\/dt><dd>0/); assert.match(html, /3 ± 0.2/);
  assert.equal(sourceSummary({ ...base, observatory: 'HEGRA', discovery: '200210' }), '脉冲星风云 · PWN · HEGRA · 2002 年 10 月');
});

test('Fermi energy bands, model index and localization stay distinct', () => {
  const html = renderSourceInfo({ ...base, catalog: '4FGL-DR4', type: 'bll', coordinateFrame: 'FK5/J2000', flux: { value: 1e-9, unit: 'ph cm-2 s-1', energy: '1–100 GeV', kind: 'integral' }, fermi: {
    classCode: 'bll', association: 'Object A', associationAlt: 'Alias B', highEnergyAssociations: ['1FHL Example'], tevAssociation: 'TeV Example',
    energyFlux: { value: 1e-12, error: 2e-13, unit: 'erg cm-2 s-1', energy: '0.1–100 GeV' }, spectrumType: 'LogParabola', photonIndex: 2, photonIndexError: .1, photonIndexField: 'LP_Index', pivotEnergyMeV: 1500,
    positionError95: { semiMajorDeg: .1, semiMinorDeg: .05, positionAngleDeg: 0 }, spatialModel: { name: 'Template', form: 'Disk', semiMajorDeg: .6, semiMinorDeg: .5, positionAngleDeg: 0 }, flags: 0,
  } });
  assert.match(html, /1–100 GeV/); assert.match(html, /0.1–100 GeV/); assert.match(html, /枢轴处局部指数 · LP_Index/);
  assert.match(html, /Alias B/); assert.match(html, /1FHL Example/); assert.match(html, /1500 MeV/);
  assert.match(html, /低置信关联 · ASSOC2/); assert.match(html, /原目录关联类别（小写 CLASS1）/); assert.match(html, /LAT 目录记录/);
  assert.match(html, /95% 定位椭圆半轴<\/dt><dd>0.1° × 0.05°/);
  assert.match(html, /原模型角尺度<\/dt><dd>0.6° × 0.5°/);
  assert.ok(!html.includes('高斯 σ'));
});

test('flagged catalog flux is not presented as a valid measurement', () => {
  const html = renderSourceInfo({ ...base, flux: { value: -1, unit: 'Crab', qualityFlag: 'nonpositive-value-in-catalog' } });
  assert.match(html, /目录异常值，未作为有效流强使用/);
  assert.ok(!html.includes('-1 Crab'));
  assert.match(html, />-1<\/span>/);
});
