import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinateColumns } from '../src/planning.mjs';

test('FK5 coordinates retain their frame and are not mislabeled ICRS in exports',()=>{
  const row=coordinateColumns({ra:17.25,dec:-4.5,coordinateFrame:'FK5/J2000',coordinateComponent:'primary'});
  assert.equal(row.coordinate_frame,'FK5/J2000');assert.equal(row.ra_catalog_deg,17.25);assert.equal(row.ra_icrs_deg,null);
  assert.equal(coordinateColumns({ra:1,dec:2}).ra_icrs_deg,1);
});
import { catalogFingerprint, combineCatalogs, checkPlanCatalogIdentity } from '../src/local-catalog-store.js';

test('private plans require the matching catalog even when a fingerprint field was removed',()=>{
  const plan={focus:'private:synthetic',blocks:[],visible:[]};
  assert.throws(()=>checkPlanCatalogIdentity(plan,'test-version'));
  plan.catalogIdentity={private:true,fingerprint:'old-version'};
  assert.throws(()=>checkPlanCatalogIdentity(plan,'test-version'));
  plan.catalogIdentity.fingerprint='test-version';
  assert.doesNotThrow(()=>checkPlanCatalogIdentity(plan,'test-version'));
  assert.throws(()=>checkPlanCatalogIdentity(plan));
  assert.doesNotThrow(()=>checkPlanCatalogIdentity({focus:'public-test'}));
});

// Entirely synthetic fixtures: no non-public catalog records or statistics.
test('a local catalog replaces first-edition LHAASO while retaining TeVCat and both inputs', () => {
  const publicCatalog = {
    sources: [
      {id: 'public-a', name: 'Synthetic public A', catalog: 'TeVCat', ra: 12, dec: 34},
      {id: 'first-a', name: 'Synthetic first edition A', catalog: '1LHAASO', ra: 56, dec: 7},
      {id: 'public-b', name: 'Synthetic public B', catalog: 'TeVCat', ra: 89, dec: -12},
    ],
    meta: {retrievedAt: '2000-01-01T00:00:00Z', catalogs: [
      {label: 'TeVCat', recordCount: 2},
      {label: '1LHAASO', recordCount: 1},
    ]},
  };
  const privateCatalog = {
    sources: [{id: 'second-a', name: 'Synthetic second edition A', catalog: '2LHAASO', ra: 57, dec: 8}],
  };
  const publicBefore = structuredClone(publicCatalog), privateBefore = structuredClone(privateCatalog);
  const combined = combineCatalogs(publicCatalog, privateCatalog);

  assert.deepEqual(combined.sources.map(s => s.id), ['public-a', 'public-b', 'second-a']);
  assert.equal(combined.meta.private, true);
  assert.equal(combined.meta.retrievedAt, publicCatalog.meta.retrievedAt);
  assert.deepEqual(combined.meta.catalogs, [
    {label: 'TeVCat', recordCount: 2},
    {label: '2LHAASO · 本地私有目录', recordCount: 1},
  ]);
  assert.deepEqual(publicCatalog, publicBefore);
  assert.deepEqual(privateCatalog, privateBefore);
  assert.notStrictEqual(combined.sources, publicCatalog.sources);
  assert.notStrictEqual(combined.meta, publicCatalog.meta);
  assert.strictEqual(combineCatalogs(publicCatalog, null), publicCatalog);
});

test('catalog fingerprints are stable and distinguish changed coordinates under the same source ID', async () => {
  const first = JSON.stringify({sources: [{id: 'synthetic', ra: 12, dec: 34}]});
  const revised = JSON.stringify({sources: [{id: 'synthetic', ra: 12.1, dec: 34}]});
  const [fingerprint, repeated, changed] = await Promise.all([
    catalogFingerprint(first), catalogFingerprint(first), catalogFingerprint(revised),
  ]);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(repeated, fingerprint);
  assert.notEqual(changed, fingerprint, 'Updated coordinates must not reuse the old private plan namespace');
});
