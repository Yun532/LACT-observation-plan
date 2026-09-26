import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import M from '../src/planning.mjs';

const {meta,sources}=JSON.parse(readFileSync(new URL('../public/data/fermi-sources.json',import.meta.url),'utf8'));

test('optional Fermi library preserves all public v35 records and unambiguous units',()=>{
  assert.equal(meta.catalog,'4FGL-DR4');assert.equal(meta.version,'v35');
  assert.equal(meta.count,7195);assert.equal(meta.physicalSourceCount,7194);
  assert.equal(sources.length,meta.count);assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
  assert.equal(meta.sha256,'e3b3ea278412b7bda4c259ab558f00b76605be59eb84e44086a862a179ffc3e6');
  for(const s of sources){
    assert.match(s.id,/^fermi:4fgl:j/);assert.equal(s.catalog,'4FGL-DR4');
    assert.ok(Number.isFinite(s.ra)&&s.ra>=0&&s.ra<360);assert.ok(Number.isFinite(s.dec)&&Math.abs(s.dec)<=90);
    assert.equal(s.coordinateFrame,'FK5/J2000');assert.equal(s.flux.unit,'ph cm-2 s-1');
    assert.equal(s.flux.energyMinGeV,1);assert.equal(s.flux.energyMaxGeV,100);
    assert.equal(s.flux.comparisonGroup,'4FGL-DR4-1-100GeV');
    assert.equal(s.fermi.energyFlux.unit,'erg cm-2 s-1');assert.equal(s.fermi.energyFlux.energy,'0.1–100 GeV');
    assert.equal(s.extension,null); // localization ellipses and unlike spatial models are not silently drawn as a Gaussian sigma.
    assert.equal(s.spectralIndex,s.fermi.photonIndex);
    assert.equal(s.fermi.photonIndexField,({PowerLaw:'PL_Index',LogParabola:'LP_Index',PLSuperExpCutoff:'PLEC_IndexS'})[s.fermi.spectrumType]);
  }
  const crab=sources.filter(s=>s.fermi.association==='Crab Nebula');
  assert.equal(crab.length,2);assert.ok(crab.some(s=>s.name.endsWith('i')));assert.ok(crab.some(s=>s.name.endsWith('s')));
});

test('high-energy filter reflects published FHL associations rather than a claim of TeV detection',()=>{
  const high=sources.filter(s=>s.fermi.highEnergyAssociations.length);
  const three=high.filter(s=>s.fermi.highEnergyAssociations.some(a=>a.startsWith('3FHL ')));
  assert.equal(high.length,1555);assert.equal(meta.highEnergyAssociationCount,high.length);
  assert.equal(three.length,1536);assert.equal(meta.threeFhlAssociationCount,three.length);
  assert.ok(high.some(s=>s.fermi.highEnergyAssociations.some(a=>a.startsWith('1FHL '))));
  assert.ok(high.some(s=>s.fermi.highEnergyAssociations.some(a=>a.startsWith('2FHL '))));
  assert.ok(sources.some(s=>s.fermi.flags>0));
  assert.ok(sources.some(s=>s.fermi.positionError95));
  assert.equal(sources.filter(s=>s.fermi.spatialModel).length,82);
});

test('Fermi export retains the declared FK5/J2000 frame rather than relabeling catalog coordinates ICRS',()=>{
  const s=sources[0],columns=M.coordinateColumns(s);
  assert.equal(columns.coordinate_frame,'FK5/J2000');
  assert.equal(columns.ra_catalog_deg,Number(s.ra.toFixed(6)));
  assert.equal(columns.dec_catalog_deg,Number(s.dec.toFixed(6)));
  assert.equal(columns.ra_icrs_deg,null);assert.equal(columns.dec_icrs_deg,null);
});
