import assert from 'node:assert/strict';
import test from 'node:test';
import { neighborEntries, knownRadius, neighborhoodRadius, extensionText } from '../src/neighbor-chart.js';
import M from '../src/planning.mjs';

const source=(id,ra,dec=0,extension)=>({id,name:id,ra,dec,...(extension?{extension}:{})});

test('neighbor search includes overlapping published r39 circles beyond the displayed center radius',()=>{
  const focus=source('focus',0),inside=source('inside',7.9),overlap=source('overlap',8.5,0,{kind:'gaussian-r39',radiusDeg:1});
  const upper=source('upper',8.7,0,{kind:'gaussian-r39',radiusDeg:1,upperLimit:true,confidence:.95});
  const outside=source('outside',9.1,0,{kind:'gaussian-r39',radiusDeg:1});
  const undefinedSize=source('undefined-size',8.5,0,{kind:'catalog-angular-size',xDeg:3,yDeg:2});
  assert.deepEqual(neighborEntries(focus,[focus,outside,upper,undefinedSize,inside,overlap],8).map(s=>s.id),['inside','overlap','upper']);
  assert.equal(knownRadius(undefinedSize),0,'An undefined angular-size convention must not silently become a radius');
  assert.equal(knownRadius(overlap),1);
  assert.match(extensionText(upper),/上限/);
  assert.match(extensionText(undefinedSize),/定义未统一/);
  assert.equal(neighborhoodRadius({fov:3,skyPadding:3}),8);
  assert.equal(neighborhoodRadius({fov:12,skyPadding:3}),15);
});

test('neighbor distances respect RA wrap and polar convergence',()=>{
  const wrap=neighborEntries(source('focus',359.9),[source('across-zero',.1),source('far',180)],1);
  assert.equal(wrap.length,1);
  assert.ok(Math.abs(wrap[0].separation-.2)<1e-8);
  const polar=neighborEntries(source('focus',0,89),[source('across-pole',180,89),source('far',0,80)],5);
  assert.equal(polar.length,1);
  assert.ok(Math.abs(polar[0].separation-2)<1e-8);
});

test('new display preferences default safely for legacy plans and do not alter task validation',()=>{
  const {starLimit,skyPadding,...oldConfig}=M.defaults;
  const catalog=[source('target',0)],plan=M.restorePlan({version:1,date:'2026-09-24',config:oldConfig,blocks:[{id:1,source:'target',start:60,duration:30}]},catalog);
  assert.equal(plan.config.starLimit,3);
  assert.equal(plan.config.skyPadding,3);
  assert.throws(()=>M.validateConfig({...oldConfig,starLimit:9}),/starLimit/);
  assert.throws(()=>M.validateConfig({...oldConfig,skyPadding:-1}),/skyPadding/);
  const n={minutes:840,sun:Array(841).fill(-30),moon_alt:Array(841).fill(-30),sources:{target:{z:Array(841).fill(30),sep:Array(841).fill(90)}}};
  assert.deepEqual(M.validate(n,plan.blocks,oldConfig).issues,M.validate(n,plan.blocks,{...oldConfig,starLimit:8,skyPadding:10}).issues);
  assert.deepEqual(M.mask(n,'target',oldConfig),M.mask(n,'target',{...oldConfig,starLimit:8,skyPadding:10}));
});
