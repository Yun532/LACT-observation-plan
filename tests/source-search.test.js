import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesSource } from '../src/source-search.js';

const {sources} = JSON.parse(await readFile(new URL('../public/data/sources.json', import.meta.url), 'utf8'));
const find = query => sources.filter(s => matchesSource(s, query)).map(s => s.name).sort();
assert.deepEqual(find('mrk'), ['Markarian 180', 'Markarian 421', 'Markarian 501']);
for (const query of ['Mrk501', 'MRK 501', 'ｍｒｋ５０１', 'Ｍｒｋ　５０１', 'Mkn 501', 'Markarian 501']) {
  assert.deepEqual(find(query), ['Markarian 501']);
}
assert.deepEqual(find('Mrk 421'), ['Markarian 421']);
assert.equal(matchesSource({name:'4FGL synthetic',aliases:['Mkn 421']},'Mrk421'),true);
assert.deepEqual(find('mrk180'), ['Markarian 180']);
assert.deepEqual(find('mrk541'), [], 'Source numbers must not be silently corrected');
assert.ok(find('Sgr A*').includes('Galactic Centre'), 'Existing aliases remain searchable');
assert.ok(find('TeV J1104+382').includes('Markarian 421'));
assert.ok(find('HBL').includes('Markarian 421'), 'Type search remains available');
assert.equal(find('　 ').length, sources.length);
console.log('Catalog search checks passed: common abbreviations, full-width input, spacing and aliases.');
