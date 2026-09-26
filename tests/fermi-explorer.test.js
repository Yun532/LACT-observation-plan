import assert from 'node:assert/strict';
import test from 'node:test';
import {validateFermiCatalog,filterFermiSources,fermiReachable,createFermiExplorer} from '../src/fermi-explorer.js';

const row=(suffix,overrides={})=>({id:`fermi:4fgl:${suffix}`,catalog:'4FGL-DR4',name:`4FGL ${suffix}`,ra:30,dec:30,type:'bll',aliases:['Markarian 421'],fermi:{classCode:'bll',association:'Synthetic counterpart',significance:10,variabilityIndex:null,energyFlux:{value:2e-12,error:null},highEnergyAssociations:[]},...overrides});
const context={config:{latitude:29.3586111,zmax:70},selectedIds:['fermi:4fgl:b']};

test('Fermi snapshot validation rejects malformed coordinates, duplicate IDs and nonfinite metadata',()=>{
  const payload={meta:{catalog:'4FGL-DR4',count:1},sources:[row('a')]};
  assert.equal(validateFermiCatalog(payload),payload);
  for(const changes of [{ra:null},{ra:360},{ra:-1},{dec:91},{dec:NaN},{id:'other:catalog:a'},{aliases:'wrong'},{fermi:{...row('a').fermi,significance:Infinity}}]) {
    assert.throws(()=>validateFermiCatalog({...payload,sources:[row('a',changes)]}));
  }
  assert.throws(()=>validateFermiCatalog({meta:{catalog:'4FGL-DR4',count:2},sources:[row('a'),row('a')]}));
  assert.throws(()=>validateFermiCatalog({...payload,meta:{...payload.meta,count:2}}));
});

test('Fermi filtering handles aliases, exact CLASS1, selected records and geometric reach independently',()=>{
  const north=row('a'),south=row('b',{dec:-80}),high=row('c',{fermi:{...row('a').fermi,classCode:'BLL',highEnergyAssociations:['3FHL synthetic']}});
  assert.equal(fermiReachable(north,context.config),true);
  assert.equal(fermiReachable(south,context.config),false);
  assert.equal(fermiReachable(row('edge',{dec:context.config.latitude-context.config.zmax}),context.config),true);
  assert.equal(filterFermiSources([north,south],{query:'ｍｒｋ４２１',onlyReachable:true},context)[0].id,north.id);
  assert.deepEqual(filterFermiSources([north,south,high],{type:'BLL'},context).map(s=>s.id),[high.id]);
  assert.deepEqual(filterFermiSources([north,south,high],{highEnergyOnly:true},context).map(s=>s.id),[high.id]);
  assert.deepEqual(filterFermiSources([north,south],{selectedOnly:true},context).map(s=>s.id),[south.id]);
  assert.deepEqual(filterFermiSources([north,south],{selectedOnly:true,onlyReachable:true},context),[]);
});

test('Fermi sorting and numeric thresholds keep zero distinct from missing values',()=>{
  const missing=row('a',{fermi:{...row('a').fermi,significance:null,energyFlux:null}});
  const zero=row('b',{fermi:{...row('a').fermi,significance:0,energyFlux:{value:0,error:null}}});
  const bright=row('c');
  for(const sort of ['energyFlux','significance'])assert.deepEqual(filterFermiSources([missing,zero,bright],{sort},context).map(s=>s.id),[bright.id,zero.id,missing.id]);
  assert.deepEqual(filterFermiSources([missing,zero,bright],{minSignificance:'0'},context).map(s=>s.id),[bright.id,zero.id]);
  assert.equal(filterFermiSources([missing,zero],{minSignificance:''},context).length,2);
  assert.equal(filterFermiSources([zero],{minSignificance:'1'},context).length,0);
});

test('Fermi lazy loader shares in-flight requests, retries failures and caches only validated snapshots',async()=>{
  const oldFetch=globalThis.fetch, oldDocument=globalThis.document;
  let requests=0;
  const payload={meta:{catalog:'4FGL-DR4',count:1},sources:[row('a')]};
  globalThis.document={baseURI:'https://example.test/planner/#overview'};
  globalThis.fetch=async url=>{
    assert.equal(String(url),'https://example.test/planner/data/fermi-sources.json');
    requests++;
    return requests===1?{ok:false,status:503}:{ok:true,text:async()=>JSON.stringify(payload)};
  };
  try {
    const explorer=createFermiExplorer({getContext:()=>context,onAdd:()=>{},onRemove:()=>{},onInspect:()=>{}});
    await assert.rejects(Promise.all([explorer.load(),explorer.load()]),/503/);
    assert.equal(requests,1);
    assert.equal(explorer.getById('fermi:4fgl:a'),undefined);
    const [a,b]=await Promise.all([explorer.load(),explorer.load()]);
    assert.equal(a,b);
    assert.equal(requests,2);
    assert.equal(explorer.getById('fermi:4fgl:a').name,payload.sources[0].name);
    assert.equal((await explorer.load()).sources.length,1);
    assert.equal(requests,2);
  } finally {
    globalThis.fetch=oldFetch;
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  }
});
