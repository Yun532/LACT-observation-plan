import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeNight, computeMonth, computeYear, localDateMs, DEFAULTS } from '../src/astronomy.js';

const data=JSON.parse(await readFile(new URL('./astropy-reference.json',import.meta.url),'utf8'));
const indices=data.indices;
const cfg={...DEFAULTS};
let maxZ=0,maxAz=0,maxSep=0,maxSun=0,maxMoon=0;
const ad=(a,b)=>Math.abs(((a-b+540)%360)-180);
for(const date of Object.keys(data.nights)) {
  const computed=computeNight(date,data.sources,cfg),ref=data.nights[date];
  assert.equal(computed.startMs,Date.parse(`${date}T18:00:00+08:00`));
  assert.equal(computed.sun.length,841);
  for(let j=0;j<indices.length;j++) {
    const i=indices[j];
    maxSun=Math.max(maxSun,Math.abs(computed.sun[i]-ref.sun[j]));
    maxMoon=Math.max(maxMoon,Math.abs(computed.moonalt[i]-ref.moon_alt[j]));
    for(const s of data.sources) {
      const a=computed.sources[s.id],b=ref.sources[s.id];
      maxZ=Math.max(maxZ,Math.abs(a.z[i]-b.z[j]));
      maxAz=Math.max(maxAz,ad(a.az[i],b.az[j]));
      maxSep=Math.max(maxSep,Math.abs(a.sep[i]-b.sep[j]));
    }
  }
}
assert.ok(maxZ<0.02 && maxAz<0.08 && maxSep<0.04 && maxSun<0.03 && maxMoon<0.03,JSON.stringify({maxZ,maxAz,maxSep,maxSun,maxMoon}));
assert.throws(()=>localDateMs('2026-02-29'),/不存在/);
assert.equal(localDateMs('2024-02-29',8),Date.parse('2024-02-29T18:00:00+08:00'));
assert.equal(new Date(localDateMs('2026-12-31',8)+840*60000).toISOString(),'2027-01-01T00:00:00.000Z');
const polarSource=[{id:'pole',name:'North celestial pole',ra:0,dec:90}];
assert.deepEqual(computeNight('2026-06-21',polarSource,{latitude:89}).bounds,[0,0]);
const day=computeMonth(2026,6,polarSource,{latitude:89,mode:'LACT'});
assert.ok(day.daily.pole.every(h=>h===0),'Polar daylight must not pass the dark cut');
const continuous=computeMonth(2026,6,polarSource,{latitude:89,mode:'LHAASO',moon:180,sun:-30});
assert.ok(continuous.daily.pole.every(h=>Math.abs(h-24)<1e-9),'LHAASO must ignore Sun and Moon cuts');
const year=computeYear(2024,[data.sources[0]],cfg);
assert.equal(year.days.length,366);
assert.equal(year.days[59],'2024-02-29');
const month=computeMonth(2024,2,[data.sources[0]],cfg);
assert.equal(month.days.length,29);
assert.deepEqual(month.daily[data.sources[0].id],year.daily[data.sources[0].id].slice(31,60));
assert.ok(Math.abs(month.daily[data.sources[0].id].reduce((a,b)=>a+b,0)-year.monthly[data.sources[0].id][1])<1e-9);
const september=computeMonth(2026,9,data.sources,cfg);
const septemberNight=computeNight('2026-09-22',data.sources,cfg);
for(const s of data.sources) {
  let minuteHours=0;
  for(let t=0;t<840;t++) if((septemberNight.sun[t]+septemberNight.sun[t+1])/2<cfg.sun&&(septemberNight.sources[s.id].z[t]+septemberNight.sources[s.id].z[t+1])/2<=cfg.zmax&&(septemberNight.sources[s.id].sep[t]+septemberNight.sources[s.id].sep[t+1])/2>cfg.moon) minuteHours+=1/60;
  assert.ok(Math.abs(minuteHours-september.daily[s.id][21])<=20/60,'10-minute integration should agree within two bins');
}
console.log('Astronomy checks passed',JSON.stringify({maxZ,maxAz,maxSep,maxSun,maxMoon}));
