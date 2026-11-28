const DB_NAME='mambo_kasir_db', DB_VERSION=6;
const stores=['users','products','categories','customers','suppliers','movements','opnames','settings','transactions','shifts','heldCarts','receivables','promos','returns','purchases','payables','supplierPayments','auditLogs','operationalExpenses','syncQueue'];
const CLOUD_SKIP=new Set(['users','heldCarts','syncQueue']);
export function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;for(const s of stores){if(!db.objectStoreNames.contains(s))db.createObjectStore(s,{keyPath:'id'});}const p=req.transaction.objectStore('products');if(!p.indexNames.contains('sku'))p.createIndex('sku','sku',{unique:true});if(!p.indexNames.contains('barcode'))p.createIndex('barcode','barcode',{unique:false});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function all(store){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function get(store,id){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function queueRow(store,recordId,payload,operation='upsert'){if(CLOUD_SKIP.has(store))return null;return{id:uid(),entity:store,recordId:String(recordId),payload:payload?JSON.parse(JSON.stringify(payload)):null,operation,createdAt:Date.now()};}
export async function put(store,obj){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite');tx.objectStore(store).put(obj);const q=queueRow(store,obj.id,obj);if(q)tx.objectStore('syncQueue').put(q);tx.oncomplete=()=>res(obj);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});}
export async function remove(store,id){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite');tx.objectStore(store).delete(id);const q=queueRow(store,id,null,'delete');if(q)tx.objectStore('syncQueue').put(q);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
export async function bulkPut(store,items){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite'),s=tx.objectStore(store),q=names.includes('syncQueue')?tx.objectStore('syncQueue'):null;items.forEach(x=>{s.put(x);const row=queueRow(store,x.id,x);if(row)q.put(row);});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
export async function atomic(tableNames,work){const db=await openDB(),names=[...new Set([...tableNames,'syncQueue'])];return new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite'),queue=tx.objectStore('syncQueue');const wrapped=Object.fromEntries(tableNames.map(name=>{const target=tx.objectStore(name);if(CLOUD_SKIP.has(name)||name==='syncQueue')return[name,target];const proxy=new Proxy(target,{get(obj,prop){if(prop==='put')return(value,...args)=>{const req=obj.put(value,...args);queue.put(queueRow(name,value.id,value));return req;};if(prop==='delete')return(key)=>{const req=obj.delete(key);queue.put(queueRow(name,key,null,'delete'));return req;};if(prop==='clear')return(...args)=>obj.clear(...args);const value=Reflect.get(obj,prop,obj);return typeof value==='function'?value.bind(obj):value;}});return[name,proxy];}));let result;try{result=work(wrapped);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaksi database dibatalkan'));});}
export async function clearAndSeed(){const db=await openDB();const tx=db.transaction(stores.slice(0,8),'readwrite');stores.slice(0,8).forEach(s=>tx.objectStore(s).clear());await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});}
export const uid=()=>crypto.randomUUID();


// Terapkan snapshot cloud ke IndexedDB tanpa membuat antrean sinkronisasi baru.
// Perubahan lokal yang masih antre selalu menang.
export async function applyCloudRows(rows){
 const db=await openDB();
 const valid=new Set(['products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments','operationalExpenses']);
 const names=[...valid,'syncQueue'];
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite'),q=tx.objectStore('syncQueue');
  const pending=new Set();
  const qr=q.getAll();
  let applied=0,skipped=0;
  qr.onsuccess=()=>{
   for(const item of qr.result||[])pending.add(item.entity+'|'+String(item.recordId));
   for(const row of rows||[]){
    if(!valid.has(row.entity)||!row.record_id)continue;
    const key=row.entity+'|'+String(row.record_id);
    if(pending.has(key)){skipped++;continue;}
    const target=tx.objectStore(row.entity);
    if(row.deleted){target.delete(row.record_id);applied++;continue;}
    const incoming=row.payload&&typeof row.payload==='object'?{...row.payload}:null;
    if(!incoming||String(incoming.id??'')!==String(row.record_id))continue;
    if(row.entity==='products'&&(!incoming.photo||(typeof incoming.photo==='object'&&Object.keys(incoming.photo).length===0))){
     const getReq=target.get(row.record_id);
     getReq.onsuccess=()=>{if(getReq.result?.photo){incoming.photo=getReq.result.photo;incoming.photoType=getReq.result.photoType||incoming.photoType||'image/jpeg';}target.put(incoming);};
    }else target.put(incoming);
    applied++;
   }
  };
  tx.oncomplete=()=>resolve({applied,skipped});
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||new Error('Penerapan data cloud dibatalkan'));
 });
}

// Terapkan katalog perangkat kasir secara lokal tanpa antrean cloud.
export async function replaceDeviceCatalog(products,categories){
 const database=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(['products','categories'],'readwrite');
  const p=tx.objectStore('products'),c=tx.objectStore('categories');
  const oldReq=p.getAll();
  oldReq.onsuccess=()=>{
   const old=new Map((oldReq.result||[]).map(x=>[String(x.id),x]));
   p.clear();c.clear();
   (products||[]).forEach(row=>{
    const prior=old.get(String(row.id));
    p.put({...row,...(prior?{stock:prior.stock,photo:prior.photo||null,photoType:prior.photoType||row.photoType,photoUrl:row.photoUrl||prior.photoUrl||null}: {})});
   });
   (categories||[]).forEach(row=>c.put(row));
  };
  tx.oncomplete=()=>resolve({products:(products||[]).length,categories:(categories||[]).length});
  tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Pembaruan katalog dibatalkan'));
 });
}



export async function cleanupDemoCatalog(expectedProducts,expectedCategories){
 const db=await openDB();
 const skuPattern=/^BRG-(00[1-9]|01[0-5])$/;
 const names=['products','categories','syncQueue'];
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite');
  const products=tx.objectStore('products'),categories=tx.objectStore('categories'),queue=tx.objectStore('syncQueue');
  let failure=null,result=null;
  const [pReq,cReq,qReq]=[products.getAll(),categories.getAll(),queue.getAll()];
  let completed=0;
  const ready=()=>{
   if(++completed!==3)return;
   try{
    const pRows=pReq.result||[],cRows=cReq.result||[],qRows=qReq.result||[];
    const expected=expectedProducts||[],expectedCats=expectedCategories||[];
    const actual=pRows.filter(p=>skuPattern.test(String(p.sku||'')));
    if(actual.length!==expected.length||actual.some(p=>!expected.some(x=>String(x.id)===String(p.id)&&String(x.sku)===String(p.sku))))
     throw Error('Daftar produk BRG-001 s.d. BRG-015 berubah atau tidak lengkap. Tidak ada data yang dihapus.');
    const removeIds=new Set(actual.map(p=>String(p.id)));
    const queueProducts=qRows.filter(q=>q.entity==='products'&&removeIds.has(String(q.recordId)));
    for(const product of actual){
     const matches=queueProducts.filter(q=>String(q.recordId)===String(product.id));
     if(matches.length!==1||matches[0].operation!=='upsert'||String(matches[0].payload?.sku||'')!==String(product.sku))
      throw Error('Antrean produk '+product.sku+' tidak sesuai. Pembersihan dibatalkan.');
    }
    const expectedCatIds=new Set(expectedCats.map(x=>String(x.id)));
    const actualCats=cRows.filter(c=>expectedCatIds.has(String(c.id)));
    if(actualCats.length!==expectedCats.length||actualCats.some(c=>!expectedCats.some(x=>String(x.id)===String(c.id)&&String(x.name)===String(c.name))))
     throw Error('Daftar kategori demo berubah. Tidak ada data yang dihapus.');
    for(const cat of actualCats){
     if(pRows.some(p=>!removeIds.has(String(p.id))&&String(p.categoryId||'')===String(cat.id)))
      throw Error('Kategori '+cat.name+' masih dipakai produk lain. Pembersihan kategori dibatalkan.');
     const matches=qRows.filter(q=>q.entity==='categories'&&String(q.recordId)===String(cat.id));
     if(matches.length!==1||matches[0].operation!=='upsert'||String(matches[0].payload?.name||'')!==String(cat.name))
      throw Error('Antrean kategori '+cat.name+' tidak sesuai. Pembersihan dibatalkan.');
    }
    for(const product of actual)products.delete(product.id);
    for(const cat of actualCats)categories.delete(cat.id);
    for(const q of [...queueProducts,...qRows.filter(q=>q.entity==='categories'&&expectedCatIds.has(String(q.recordId)))])queue.delete(q.id);
    result={productsRemoved:actual.length,categoriesRemoved:actualCats.length,queueRemoved:queueProducts.length+qRows.filter(q=>q.entity==='categories'&&expectedCatIds.has(String(q.recordId))).length};
   }catch(e){failure=e;try{tx.abort();}catch{}}
  };
  for(const req of [pReq,cReq,qReq]){req.onsuccess=ready;req.onerror=()=>{failure=req.error||new Error('Gagal membaca database lokal.');try{tx.abort();}catch{}};}
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(failure||tx.error||new Error('Pembersihan gagal.'));
  tx.onabort=()=>reject(failure||tx.error||new Error('Pembersihan dibatalkan.'));
 });
}

export async function discardVerifiedDemoRecords(expected){
 const db=await openDB();
 const entities=[...new Set((expected||[]).map(x=>x.entity))];
 if(!entities.length||entities.some(x=>!['products','customers','suppliers','auditLogs'].includes(x)))throw Error('Daftar data uji tidak valid.');
 const names=[...entities,'syncQueue'];
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,'readwrite'),q=tx.objectStore('syncQueue');
  let failure=null,result=null;
  const req=q.getAll();
  req.onsuccess=()=>{
   try{
    const queue=req.result||[];
    const targets=[];
    for(const item of expected){
     const matches=queue.filter(x=>x.entity===item.entity&&String(x.recordId)===String(item.recordId));
     if(matches.length!==1||matches[0].operation!=='upsert')throw Error('Antrean '+item.entity+' '+item.recordId+' berubah sejak laporan dibuat. Tidak ada data yang dibersihkan.');
     const queued=matches[0];
     if(item.entity==='products'&&String(queued.payload?.sku||'')!==String(item.sku))throw Error('SKU produk tidak cocok dengan laporan. Pembersihan dibatalkan.');
     targets.push({item,queued});
    }
    const productChecks=targets.filter(x=>x.item.entity==='products');
    let checked=0;
    const apply=()=>{
     for(const {item,queued} of targets){
      tx.objectStore(item.entity).delete(item.recordId);
      q.delete(queued.id);
     }
     result={removed:targets.length,counts:targets.reduce((o,x)=>(o[x.item.entity]=(o[x.item.entity]||0)+1,o),{})};
    };
    if(!productChecks.length){apply();return;}
    for(const {item} of productChecks){
     const getReq=tx.objectStore('products').get(item.recordId);
     getReq.onsuccess=()=>{
      if(!getReq.result||String(getReq.result.sku||'')!==String(item.sku)){failure=new Error('Data produk lokal tidak cocok dengan laporan untuk SKU '+item.sku+'. Pembersihan dibatalkan.');try{tx.abort();}catch{}return;}
      checked++;if(checked===productChecks.length)apply();
     };
     getReq.onerror=()=>{failure=getReq.error||new Error('Gagal memeriksa produk lokal.');try{tx.abort();}catch{}};
    }
   }catch(e){failure=e;try{tx.abort();}catch{}}
  };
  req.onerror=()=>{failure=req.error||new Error('Gagal membaca antrean.');try{tx.abort();}catch{}};
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(failure||tx.error||new Error('Pembersihan gagal.'));
  tx.onabort=()=>reject(failure||tx.error||new Error('Pembersihan dibatalkan.'));
 });
}
