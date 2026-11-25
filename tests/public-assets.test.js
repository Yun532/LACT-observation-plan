import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import test from 'node:test';

const root=resolve('public');
const files=readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile())
  .map(entry=>relative(root,resolve(entry.parentPath,entry.name)).split(sep).join('/')).sort();
// window.X["key"]={...}; → 对象；gzip-base64 打包的先解开
const payload=name=>{
  const text=readFileSync(resolve(root,name),'utf8'), doc=JSON.parse(text.slice(text.indexOf('={')+1).replace(/;\s*$/,''));
  return doc.encoding==='gzip-base64' ? JSON.parse(gunzipSync(Buffer.from(doc.data,'base64'))) : doc;
};
const example=files.filter(name=>name.startsWith('example/'));

test('only reviewed public catalog snapshots are copied into the site',()=>{
  assert.deepEqual(files.filter(name=>!name.startsWith('example/')),[
    // 新版公开页（LACT 工作台 build.py --public 生成）和它读的数据
    'catalogs/fermi-sources.js','catalogs/sources.js','catalogs/stars.js',
    // 旧版（plan.html）读的数据
    'data/fermi-sources.json','data/sources.json','data/stars.json',
    'index.html','sky_months.js','windows_2026.js','windows_2027.js',
  ]);
  // 模拟示例：一支逐夜回放的索引、各夜结果和曝光
  assert.ok(example.includes('example/results_latest.js'));
  for (const name of example)
    assert.match(name,/^example\/(?:results_latest|results_latest_night-\d{4}-\d{2}-\d{2}-[a-z]+-[0-9a-f]{16}|exposure_replay_[0-9a-f]{16})\.js$/,name);
});

test('the new public page carries no private catalog or scheduling data',()=>{
  const page=readFileSync(resolve(root,'index.html'),'utf8');
  assert.match(page,/globalThis\.LACT_PUBLIC=true/);
  for (const marker of ['globalThis.LACT_2LHAASO=','2LHAASO J','<script src="results_','"too_programs"','"alert_screen"','"priority_weight"'])
    assert.ok(!page.includes(marker),`public/index.html contains ${marker}`);
  const catalogs=rows=>[...new Set(rows.map(row=>row.catalog))].sort();
  assert.deepEqual(catalogs(payload('catalogs/sources.js').sources),['1LHAASO','TeVCat']);
  for (const name of ['windows_2026.js','windows_2027.js'])
    assert.deepEqual(catalogs(payload(name).sources),['1LHAASO','TeVCat'],name);
});

test('the simulated example has no 2LHAASO positions, local paths or registry overrides',()=>{
  for (const name of example) {
    const text=JSON.stringify(payload(name));
    for (const marker of ['2LHAASO','exclusions_icrs','registry_overrides','/home/',':\\\\'])
      assert.ok(!text.includes(marker),`${name} contains ${marker}`);
  }
});
