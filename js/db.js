const DB_NAME='mambo_kasir_db', DB_VERSION=5;
const stores=['users','products','categories','customers','suppliers','movements','opnames','settings','transactions','shifts','heldCarts','receivables','promos','returns','purchases','payables','supplierPayments','auditLogs','syncQueue'];
const CLOUD_SKIP=new Set(['users','heldCarts','syncQueue']);
export function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;for(const s of stores){if(!db.objectStoreNames.contains(s))db.createObjectStore(s,{keyPath:'id'});}const p=req.transaction.objectStore('products');if(!p.indexNames.contains('sku'))p.createIndex('sku','sku',{unique:true});if(!p.indexNames.contains('barcode'))p.createIndex('barcode','barcode',{unique:false});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export async function all(store){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function get(store,id){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function queueRow(store,recordId,payload,operation='upsert'){if(CLOUD_SKIP.has(store))return null;return{id:uid(),entity:store,recordId:String(recordId),payload:payload?JSON.parse(JSON.stringify(payload)):null,operation,createdAt:Date.now()};}
export async function put(store,obj){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite');tx.objectStore(store).put(obj);const q=queueRow(store,obj.id,obj);if(q)tx.objectStore('syncQueue').put(q);tx.oncomplete=()=>res(obj);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});}
export async function remove(store,id){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite');tx.objectStore(store).delete(id);const q=queueRow(store,id,null,'delete');if(q)tx.objectStore('syncQueue').put(q);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
export async function bulkPut(store,items){const db=await openDB(),names=CLOUD_SKIP.has(store)?[store]:[store,'syncQueue'];return new Promise((res,rej)=>{const tx=db.transaction(names,'readwrite'),s=tx.objectStore(store),q=names.includes('syncQueue')?tx.objectStore('syncQueue'):null;items.forEach(x=>{s.put(x);const row=queueRow(store,x.id,x);if(row)q.put(row);});tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
export async function atomic(tableNames,work){const db=await openDB(),names=[...new Set([...tableNames,'syncQueue'])];return new Promise((resolve,reject)=>{const tx=db.transaction(names,'readwrite'),queue=tx.objectStore('syncQueue');const wrapped=Object.fromEntries(tableNames.map(name=>{const target=tx.objectStore(name);if(CLOUD_SKIP.has(name)||name==='syncQueue')return[name,target];const proxy=new Proxy(target,{get(obj,prop){if(prop==='put')return(value,...args)=>{const req=obj.put(value,...args);queue.put(queueRow(name,value.id,value));return req;};if(prop==='delete')return(key)=>{const req=obj.delete(key);queue.put(queueRow(name,key,null,'delete'));return req;};if(prop==='clear')return(...args)=>obj.clear(...args);return Reflect.get(obj,prop,obj);}});return[name,proxy];}));let result;try{result=work(wrapped);}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaksi database dibatalkan'));});}
export async function clearAndSeed(){const db=await openDB();const tx=db.transaction(stores.slice(0,8),'readwrite');stores.slice(0,8).forEach(s=>tx.objectStore(s).clear());await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});}
export const uid=()=>crypto.randomUUID();


// Terapkan snapshot cloud ke IndexedDB tanpa membuat antrean sinkronisasi baru.
// Perubahan lokal yang masih antre selalu menang.
export async function applyCloudRows(rows){
 const db=await openDB();
 const valid=new Set(['products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments']);
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
