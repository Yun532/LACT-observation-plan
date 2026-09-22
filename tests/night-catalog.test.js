import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeNight } from '../src/astronomy.js';
import M from '../src/planning.mjs';
import { summarizeNight } from '../src/night-catalog.js';

const constant = value => Array(13).fill(value);
const source = (z = 20, sep = 70) => ({z: constant(z), sep: constant(sep)});
const sources = [
  {id: 'zero', name: 'Unobservable'}, {id: 'zeta', name: 'Zeta'},
  {id: 'split', name: 'Split'}, {id: 'alpha', name: 'Alpha'},
];
const night = {
  minutes: 12, sun: constant(-20), moon_alt: constant(-10),
  sources: {zero: source(90), zeta: source(), split: source(), alpha: source()},
};
night.sun[0] = night.sun[1] = night.sun[12] = 0;
night.sources.split.z[4] = 120;
night.sources.split.sep[9] = 0;
const config = {...M.defaults, zmax: 50};

test('night catalog totals disjoint windows, sorts ties by name, and includes zero availability', () => {
  const result = summarizeNight(night, sources, config);
  assert.deepEqual(result, [
    {id: 'alpha', minutes: 9, windows: [[2, 11]]},
    {id: 'zeta', minutes: 9, windows: [[2, 11]]},
    {id: 'split', minutes: 5, windows: [[2, 3], [5, 8], [10, 11]]},
    {id: 'zero', minutes: 0, windows: []},
  ]);
  assert.equal(sources[0].id, 'zero', 'Sorting must not mutate the catalog order');
  assert.deepEqual(summarizeNight(night, [], config), []);
});

test('night catalog follows darkness, zenith, Moon mode, and trimming settings', () => {
  const split = overrides => summarizeNight(night, sources, {...config, ...overrides}).find(row => row.id === 'split');
  assert.equal(split({moonMode: 'up'}).minutes, 7, 'A Moon below the horizon does not restrict up mode');
  assert.equal(split({moonMode: 'warn'}).minutes, 7, 'Warning-only mode retains close Moon approaches');
  assert.equal(split({moon: 0}).minutes, 7, 'Changing the separation threshold changes available time');
  assert.equal(split({zmax: 90}).minutes, 7, 'Changing the zenith threshold changes available time');
  assert.equal(split({sun: 0}).minutes, 7, 'Changing the darkness threshold changes available time');
  assert.deepEqual(split({trim: 1}).windows, [[5, 8]], 'Twilight trimming applies to both ends');
  assert.equal(split({mode: 'LHAASO'}).minutes, 10, 'LHAASO ignores darkness and Moon conditions');
  const risen = {...night, moon_alt: constant(10)};
  assert.equal(summarizeNight(risen, sources, {...config, moonMode: 'up'}).find(row => row.id === 'split').minutes, 5);
});

test('real nightly catalog agrees with the exact mask used by trajectories and scheduling', () => {
  const catalog = [
    {id: 'crab', name: 'Crab', ra: 83.62875, dec: 22.01236111},
    {id: 'cygnus', name: 'TeV J2032+4130', ra: 308.05, dec: 41.51},
    {id: 'south', name: 'South Pole', ra: 0, dec: -90},
  ];
  const computed = computeNight('2026-09-22', catalog, M.defaults);
  for (const moonMode of ['strict', 'up', 'warn']) {
    const cfg = {...M.defaults, moonMode};
    for (const row of summarizeNight(computed, catalog, cfg)) {
      const mask = M.mask(computed, row.id, cfg);
      assert.equal(row.minutes, mask.filter(Boolean).length);
      assert.deepEqual(row.windows, M.windows(mask));
    }
  }
  const result = summarizeNight(computed, catalog);
  assert.ok(result.some(row => row.minutes > 0));
  assert.equal(result.find(row => row.id === 'south').minutes, 0);
});
