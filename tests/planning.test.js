import assert from 'node:assert/strict';
import M from '../src/planning.mjs';

const constant = x => Array(841).fill(x);
const n = {date: '2026-09-22', startMs: Date.parse('2026-09-22T10:00:00Z'), minutes: 840, step: 1,
  sun: constant(-20), moon_alt: constant(20), moon_az: constant(100),
  sources: {a: {z: constant(20), az: constant(359), sep: constant(70)}, b: {z: constant(40), az: constant(100), sep: constant(80)}}};
const sources = [{id: 'a', name: '=malicious()', ra: 100, dec: 20}, {id: 'b', name: 'B', ra: 110, dec: 30}];
const blocks = [{id: 1, source: 'a', start: 60, duration: 60}, {id: 2, source: 'b', start: 125, duration: 60}];
assert.deepEqual(M.windows(M.mask(n, 'a')), [[0, 840]]);
assert.equal(M.validate(n, blocks).validMinutes, 120);
assert.equal(M.validate(n, [{...blocks[0]}, {...blocks[1], start: 119}]).issues.filter(i => i.message.includes('重叠')).length, 2);
assert.equal(M.validate(n, [{...blocks[0]}, {...blocks[1], start: 121}]).issues.filter(i => i.message.includes('转场')).length, 2);
assert.equal(M.validate(n, [{...blocks[0]}, {...blocks[1], start: 120, source: 'a'}]).issues.length, 0);
assert.equal(M.reason(n, 'a', 840), '超出时间轴');
assert.equal(M.validate(n, [{id: 1, source: 'a', start: 820, duration: 20}]).issues.length, 0);
assert.equal(M.validate(n, [{id: 1, source: 'a', start: 821, duration: 20}]).issues.length, 1);
assert.equal(M.reason({...n, sun: constant(30)}, 'a', 60, {...M.defaults, mode: 'LHAASO'}), '');
assert.ok(M.reason({...n, sun: constant(30)}, 'a', 60));
assert.ok(M.validate(n, [null, {id: 2, source: 'missing', start: NaN, duration: '20'}]).issues.length >= 2);
for (const id of [1e100, Number.MAX_SAFE_INTEGER - 1000, Number.MAX_SAFE_INTEGER]) {
  assert.ok(M.validate(n, [{...blocks[0], id}]).issues.some(issue => issue.message === '任务编号无效'));
}
assert.equal(M.validate(n, [{...blocks[0], id: Number.MAX_SAFE_INTEGER - 1001}]).issues.length, 0);
assert.deepEqual(M.histogram(n, 'a', M.defaults, blocks).planned, [60, 0, 0]);
assert.equal(M.utc('2026-09-22', 360), '2026-09-22T16:00:00.000Z');
assert.equal(M.local('2026-09-22', 360), '2026-09-23T00:00:00.000+08:00');
assert.equal(M.utc('2026-09-22', 0, {...M.defaults, timezone: 5.5}), '2026-09-22T12:30:00.000Z');
assert.equal(M.local('2026-09-22', 0, {...M.defaults, timezone: -3.5}), '2026-09-22T18:00:00.000-03:30');
assert.equal(M.clock(360), '次日 00:00');
assert.equal(M.compact(60, {...M.defaults, startHour: 23}), '+00:00');
assert.equal(M.azimuth([359, 1], .5), 0);
assert.equal(M.azimuth([1, 359], .5), 0);
assert.ok(Number.isNaN(M.sample([], 3)));
const plan = {version: 1, date: n.date, config: M.defaults, blocks, focus: 'a', visible: ['a', 'b', 'a']};
assert.deepEqual(M.restorePlan(JSON.stringify(plan), sources).visible, ['a', 'b']);
assert.equal(M.restorePlan({...plan, blocks: [], focus: undefined, visible: undefined}, sources).focus, 'a');
for (const corrupt of [
  {...plan, version: undefined}, {...plan, version: '1'}, {...plan, version: 2},
  {...plan, blocks: [], focus: '', visible: []},
  {...plan, date: '2026-02-30'}, {...plan, date: 'September 22'},
  {...plan, config: {...M.defaults, timezone: '8'}}, {...plan, config: {...M.defaults, timezone: 14.1}},
  {...plan, blocks: [{...blocks[0], start: '60'}]}, {...plan, blocks: [{...blocks[0], source: '__proto__'}]},
  {...plan, blocks: [blocks[0], blocks[0]]}, {...plan, visible: ['missing']},
  ...[1e100, Number.MAX_SAFE_INTEGER - 1000, Number.MAX_SAFE_INTEGER].map(id => ({...plan, blocks: [{...blocks[0], id}]})),
]) assert.throws(() => M.restorePlan(corrupt, sources));
const rows = M.pointingRows(n, sources, blocks);
assert.equal(rows.length, 14);
assert.equal(rows[0].event, 'START');
assert.equal(rows[6].event, 'END_EXCLUSIVE');
assert.equal(rows[6].utc, '2026-09-22T12:00:00.000Z');
assert.ok(M.csv(rows).includes('"\'=malicious()"'));
assert.throws(() => M.pointingRows(n, sources, blocks, {...M.defaults, timezone: 0}));
console.log('Planning checks passed: constraints, overlap, transfer, boundaries, timezone, imports, azimuth, pointing and CSV.');
