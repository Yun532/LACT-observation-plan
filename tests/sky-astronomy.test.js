import assert from 'node:assert/strict';
import test from 'node:test';
import { Observer, MakeTime, Vector, RotateVector, Rotation_HOR_EQJ, EquatorFromVector } from 'astronomy-engine';
import { computeNight, computeSolarEvents, skyAt, angularSeparation, localDateMs, DEFAULT_SITE } from '../src/astronomy.js';

const DEG=Math.PI/180, MINUTE=60000, YEAR=365.25*86400000, J2000=Date.UTC(2000,0,1,12);
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} differs from ${b}`);
const angleClose=(a,b,tol=1e-8)=>close(((a-b+540)%360)-180,0,tol);

test('instant sky and minute trajectories use identical geometric coordinates',()=>{
  const sources=[{id:'cygnus',ra:307.8875,dec:41.5772},{id:'crab',ra:83.6331,dec:22.0145}];
  const n=computeNight('2026-09-24',sources);
  assert.equal(n.sunaz.length,841);
  assert.deepEqual(n.events,computeSolarEvents('2026-09-24'));
  for(const t of [0,180,360,601,840]) {
    const sky=skyAt(n.startMs+t*MINUTE,sources);
    close(sky.sun.alt,n.sun[t]); angleClose(sky.sun.az,n.sunaz[t]);
    close(sky.moon.alt,n.moon_alt[t]); angleClose(sky.moon.az,n.moon_az[t]);
    for(const s of sky.sources) {
      close(s.alt,90-n.sources[s.id].z[t]); angleClose(s.az,n.sources[s.id].az[t]);
      assert.equal(s.ra,sources.find(a=>a.id===s.id).ra);
      assert.equal(s.dec,sources.find(a=>a.id===s.id).dec);
    }
  }
});

test('horizontal azimuth is north zero, east 90, with correctly oriented altitude',()=>{
  const ms=localDateMs('2026-09-24'),time=MakeTime(new Date(ms));
  const observer=new Observer(DEFAULT_SITE.latitude,DEFAULT_SITE.longitude,DEFAULT_SITE.elevation);
  const positions=[{az:0,alt:15},{az:90,alt:30},{az:180,alt:70},{az:270,alt:-20}];
  const sources=positions.map((p,i)=>{
    const a=p.alt*DEG,z=p.az*DEG;
    const hor=new Vector(Math.cos(a)*Math.cos(z),-Math.cos(a)*Math.sin(z),Math.sin(a),time);
    const eq=EquatorFromVector(RotateVector(Rotation_HOR_EQJ(time,observer),hor));
    return {id:String(i),ra:eq.ra*15,dec:eq.dec};
  });
  const sky=skyAt(ms,sources);
  sky.sources.forEach((s,i)=>{angleClose(s.az,positions[i].az);close(s.alt,positions[i].alt);});
});

test('solar horizon events and configurable darkness crossings remain distinct',()=>{
  const date='2026-09-24',events=computeSolarEvents(date),start=localDateMs(date);
  assert.ok(events.sunset<events.darkStart && events.darkStart<events.darkEnd && events.darkEnd<events.sunrise);
  for(const [key,threshold,direction] of [['sunset',-.833,-1],['sunrise',-.833,1],['darkStart',-13,-1],['darkEnd',-13,1]]) {
    assert.ok(events[key]>=-360 && events[key]<1080);
    const ms=start+events[key]*MINUTE;
    close(skyAt(ms,[]).sun.alt,threshold,.0005);
    assert.ok(direction*(skyAt(ms-MINUTE,[]).sun.alt-threshold)<0);
    assert.ok(direction*(skyAt(ms+MINUTE,[]).sun.alt-threshold)>0);
  }
  assert.deepEqual(computeSolarEvents(date,{trim:90,mode:'LHAASO'}),events);
  const deeper=computeSolarEvents(date,{sun:-18});
  assert.ok(deeper.darkStart>events.darkStart && deeper.darkEnd<events.darkEnd);
  assert.equal(deeper.sunset,events.sunset);
  assert.equal(deeper.sunrise,events.sunrise);
});

test('no-crossing events are null for both polar daylight and polar darkness',()=>{
  const config={latitude:89};
  const empty={sunset:null,sunrise:null,darkStart:null,darkEnd:null};
  assert.deepEqual(computeSolarEvents('2026-06-21',config),empty);
  assert.deepEqual(computeSolarEvents('2026-12-21',config),empty);
  assert.ok(skyAt(localDateMs('2026-06-21'),[],config).sun.alt>0);
  assert.ok(skyAt(localDateMs('2026-12-21'),[],config).sun.alt<-13);
  // A shifted civil timezone can put a valid event beyond the 14h detail plot.
  const shifted=computeSolarEvents('2026-09-24',{timezone:10});
  assert.ok(Object.values(shifted).some(t=>t!==null&&t>840));
});

test('proper motion uses mas/year, the cos-declination RA convention, and each source epoch',()=>{
  const ms=J2000+26*YEAR,epoch=2016,dt=10,mu=1000;
  const star={id:'moving',ra:10,dec:60,pmRA:mu,pmDec:0,epochJYear:epoch};
  const moved=skyAt(ms,[star]).sources[0];
  close(angularSeparation(star,moved),Math.atan(mu*dt/3600000*DEG)/DEG,1e-7);
  close(((moved.ra-star.ra+540)%360)-180,mu*dt/(3600000*Math.cos(60*DEG)),1e-7);
  const north=skyAt(ms,[{id:'north',ra:42,dec:0,pmRA:0,pmDec:1000,epochJYear:2016}]).sources[0];
  close(north.ra,42); close(north.dec,Math.atan(10000/3600000*DEG)/DEG);
  const twice=skyAt(ms,[{...star,epochJYear:2006}]).sources[0];
  close(angularSeparation(star,twice),2*angularSeparation(star,moved),1e-7);
  const missingEpoch=skyAt(J2000+YEAR,[{...star,epochJYear:undefined}]).sources[0];
  close(angularSeparation(star,missingEpoch),mu/3600000,1e-7);
  const pole=skyAt(ms,[{id:'pole',ra:359.99,dec:90,pmRA:1000,pmDec:-1000,epochJYear:2016}]).sources[0];
  assert.ok(Object.values(pole).filter(v=>typeof v==='number').every(Number.isFinite));
  assert.ok(pole.ra>=0 && pole.ra<360 && pole.az>=0 && pole.az<360);
  assert.throws(()=>skyAt(NaN,[]),/时刻/);
  assert.throws(()=>skyAt(ms,[{...star,pmRA:Infinity}]),/自行/);
});
