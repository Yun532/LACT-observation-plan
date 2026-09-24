// Native browser storage only. No catalog data is sent over the network.
const DATABASE='lact.private-catalog.v1';
export const PRIVATE_PLAN_PREFIX='lact.private.plans.';
export const PRIVATE_PRIORITY_PREFIX='lact.private.priorities.';

export async function catalogFingerprint(text){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

async function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('catalog');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('浏览器无法打开本地目录存储'));
  });
}

export async function localCatalog(action,value){
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('catalog',action==='read'?'readonly':'readwrite');
    const store=tx.objectStore('catalog');
    const request=action==='read'?store.get('active'):action==='write'?store.put(value,'active'):store.delete('active');
    tx.oncomplete=()=>resolve(request.result);
    tx.onerror=tx.onabort=()=>reject(new Error('浏览器无法保存或清除本地目录'));
  });}finally{db.close();}
}

export function combineCatalogs(publicCatalog,privateCatalog){
  if(!privateCatalog)return publicCatalog;
  const sources=[...publicCatalog.sources.filter(s=>s.catalog!=='1LHAASO'),...privateCatalog.sources];
  return {sources,meta:{...publicCatalog.meta,private:true,catalogs:[
    ...(publicCatalog.meta.catalogs||[]).filter(c=>c.id!=='1LHAASO'&&!String(c.label).includes('1LHAASO')),
    {label:'2LHAASO · 本地私有目录',recordCount:privateCatalog.sources.length},
  ]}};
}
