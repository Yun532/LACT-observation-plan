import assert from 'node:assert/strict';
import test from 'node:test';
import { neighborEntries, knownRadius, neighborhoodRadius, extensionText, gaussianComponents, renderNeighborField } from '../src/neighbor-chart.js';
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

test('declared Gaussian sigma contours use each component centre and avoid duplicating the primary',()=>{
  // Deliberately synthetic values: no private catalog rows are test fixtures.
  const sigma=value=>({kind:'gaussian-sigma',sigmaDeg:value});
  const two={...source('synthetic',15,0,sigma(.6)),components:[
    {id:'primary',ra:15,dec:0,extension:sigma(.6)},
    {id:'secondary',ra:8.4,dec:0,extension:sigma(.7)},
    {id:'duplicate',ra:8.4,dec:0,extension:sigma(.7)},
    {id:'undefined',ra:1,dec:0,extension:{kind:'catalog-undefined',value:5}},
  ]};
  assert.equal(knownRadius(two),.6);
  assert.match(extensionText(two),/二维高斯 σ 0.6°.*参考圈/);
  assert.doesNotMatch(extensionText(two),/r39|位置误差/);
  assert.deepEqual(gaussianComponents(two).map(s=>s.id),['synthetic::secondary']);
  assert.equal(neighborEntries(source('focus',0),[two],8).length,1,'The secondary sigma circle crosses the field even though the main centre does not');
  assert.equal(neighborEntries(source('focus',0),[{...two,components:[]}],8).length,0);
  assert.deepEqual(gaussianComponents({...two,components:[{id:'WCDA',ra:8.4,dec:0,extension:{kind:'gaussian-r39',radiusDeg:.7}}]}),[]);
  assert.equal(knownRadius(source('unknown',0,0,{kind:'catalog-undefined',value:4})),0);
  assert.match(extensionText(source('unknown',0,0,{kind:'catalog-undefined'})),/定义见源表/);
  const svg={getBoundingClientRect:()=>({width:500}),setAttribute:()=>{}};
  renderNeighborField(svg,two,[],[],{fov:3,skyPadding:3,starLimit:3});
  assert.equal((svg.innerHTML.match(/data-morphology="sigma"/g)||[]).length,2);
  assert.equal((svg.innerHTML.match(/>σ<\/text>/g)||[]).length,2);
  assert.ok(svg.innerHTML.includes('data-component="synthetic::secondary"'));
  assert.ok(!svg.innerHTML.includes('data-component="synthetic::primary"'));
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
