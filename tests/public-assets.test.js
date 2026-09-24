import { readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('only the two reviewed public catalog snapshots are copied into the site',()=>{
  const root=resolve('public');
  const files=readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile())
    .map(entry=>relative(root,resolve(entry.parentPath,entry.name)).split(sep).join('/')).sort();
  assert.deepEqual(files,['data/sources.json','data/stars.json']);
});
