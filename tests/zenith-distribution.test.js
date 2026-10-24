import assert from 'node:assert/strict';
import test from 'node:test';
import { computeZenithDistribution, computeYear, computeMonth, computeNight } from '../src/astronomy.js';
import M from '../src/planning.mjs';

const target={id:'synthetic-target',name:'Synthetic target',ra:307,dec:41};
const total=values=>values.reduce((a,b)=>a+b,0);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);
const checkBins=result=>{
  assert.deepEqual(result.edges,[0,10,20,30,40,50,60,70,80,90]);
  assert.equal(result.bins.length,9);
  assert.ok(result.bins.every(h=>Number.isFinite(h)&&h>=0));
  close(total(result.bins),result.totalHours);
};

test('annual and monthly distributions use exactly the existing catalog integration and total order',()=>{
  const config={zmax:65,sun:-16,moon:45,moonMode:'up',trim:20};
  const annual=computeYear(2024,[target],config),progress=[];
  const distribution=computeZenithDistribution({scope:'year',year:2024},target,config,p=>progress.push(p));
  checkBins(distribution);
  assert.equal(distribution.totalHours,total(annual.monthly[target.id]));
  assert.deepEqual(progress.at(-1),{done:366,total:366,percent:100});
  assert.equal(distribution.mode,'LACT');assert.equal(distribution.step,10);
  assert.equal(distribution.startHour,12);assert.equal(distribution.minutes,1440);
  assert.equal(distribution.year,2024);
  assert.equal(distribution.bins[7],0);assert.equal(distribution.bins[8],0);
  const month=computeMonth(2024,2,[target],config);
  const monthly=computeZenithDistribution({scope:'month',year:2024,month:2},target,config);
  checkBins(monthly);
  assert.equal(monthly.totalHours,total(month.daily[target.id]));
  assert.equal(monthly.totalHours,annual.monthly[target.id][1]);
  assert.equal(monthly.month,2);
});

test('night distribution exactly follows the LACT one-minute mask even from LHAASO mode',()=>{
  const config={mode:'LHAASO',zmax:65,sun:-13,moon:40,moonMode:'up',trim:17},date='2026-09-24';
  const nightConfig={...config,mode:'LACT'},night=computeNight(date,[target],nightConfig),mask=M.mask(night,target.id,nightConfig);
  const expected=Array(9).fill(0);
  mask.forEach((valid,i)=>{if(valid)expected[Math.min(8,Math.floor(M.sample(night.sources[target.id].z,i+.5)/10))]++;});
  const distribution=computeZenithDistribution({scope:'night',date},target,config);
  checkBins(distribution);
  assert.deepEqual(distribution.bins,expected.map(minutes=>minutes/60));
  assert.equal(distribution.totalHours,total(mask.map(Number))/60);
  assert.equal(distribution.mode,'LACT');assert.equal(distribution.step,1);
  assert.equal(distribution.startHour,18);assert.equal(distribution.minutes,840);
  assert.equal(distribution.date,date);
});

test('empty windows, zero zenith limit, and a horizon-near source have finite bounded bins',()=>{
  const polar={id:'north-pole',ra:0,dec:90};
  for(const query of [{scope:'month',year:2026,month:6},{scope:'night',date:'2026-06-21'}]) {
    const empty=computeZenithDistribution(query,polar,{latitude:89,mode:'LACT'});
    checkBins(empty);assert.equal(empty.totalHours,0);assert.deepEqual(empty.bins,Array(9).fill(0));
  }
  const zero=computeZenithDistribution({scope:'month',year:2026,month:9},target,{zmax:0,mode:'LHAASO'});
  assert.deepEqual(zero.bins,Array(9).fill(0));
  const horizon=computeZenithDistribution({scope:'month',year:2026,month:1},{id:'horizon',ra:0,dec:0},{latitude:90,zmax:90,mode:'LHAASO'});
  checkBins(horizon);assert.ok(horizon.totalHours>0);
  assert.deepEqual(horizon.bins.slice(0,8),Array(8).fill(0));
  close(horizon.bins[8],horizon.totalHours);
});

test('LHAASO retains full-day exposure while ignoring Sun, Moon and dark-edge trimming',()=>{
  const polar={id:'pole',ra:0,dec:90};
  const config={mode:'LHAASO',latitude:89,zmax:10,sun:-30,moon:180,moonMode:'strict',trim:180};
  const distribution=computeZenithDistribution({scope:'month',year:2024,month:2},polar,config);
  checkBins(distribution);
  assert.equal(distribution.totalHours,total(computeMonth(2024,2,[polar],config).daily.pole));
  close(distribution.totalHours,29*24);
  assert.equal(distribution.bins[0],29*24);
  assert.deepEqual(distribution.bins.slice(1),Array(8).fill(0));
  assert.equal(distribution.startHour,0);
  const blocked=computeZenithDistribution({scope:'month',year:2024,month:2},polar,{...config,mode:'LACT'});
  assert.equal(blocked.totalHours,0);
});

test('distribution queries and the Worker single-source protocol validate inputs',async()=>{
  assert.throws(()=>computeZenithDistribution({scope:'day'},target),/范围/);
  assert.throws(()=>computeZenithDistribution({scope:'year',year:NaN},target),/年份/);
  assert.throws(()=>computeZenithDistribution({scope:'month',year:2026,month:0},target),/月份/);
  assert.throws(()=>computeZenithDistribution({scope:'night',date:'2026-02-29'},target),/日期不存在/);
  assert.throws(()=>computeZenithDistribution({scope:'year',year:2026},null),/有效的源/);
  assert.throws(()=>computeZenithDistribution({scope:'year',year:2026},{...target,dec:91}),/坐标/);
  assert.throws(()=>computeZenithDistribution({scope:'year',year:2026},target,{zmax:91}),/zmax/);
  const messages=[],oldSelf=globalThis.self;
  globalThis.self={postMessage:message=>messages.push(message)};
  try {
    await import('../src/visibility-worker.js');
    self.onmessage({data:{id:'bad',type:'zenith-distribution',scope:'year',year:2026,sources:[]}});
    assert.equal(messages.at(-1).id,'bad');assert.equal(messages.at(-1).type,'error');
    self.onmessage({data:{id:'night',type:'zenith-distribution',scope:'night',date:'2026-09-24',sources:[target],config:{mode:'LHAASO'}}});
    assert.ok(messages.some(m=>m.id==='night'&&m.type==='progress'&&m.percent===100));
    const reply=messages.at(-1);
    assert.equal(reply.id,'night');assert.equal(reply.type,'result');
    assert.equal(reply.result.scope,'night');assert.equal(reply.result.mode,'LACT');
    checkBins(reply.result);
  } finally {
    if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
  }
});
