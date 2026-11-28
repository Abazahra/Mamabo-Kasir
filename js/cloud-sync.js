import {all,put,remove,uid,applyCloudRows} from './db.js?v=photo-propagation-1';
import {validatePendingDrawerRecord} from './shared-drawer-validation.mjs?v=shared-drawer-6';
let client=null,storeId=null,session=null,busy=false,syncPromise=null,clientConfigKey=null,authSubscription=null,syncStarted=false,suppressAuthSync=false;
function notifyQueue(){all('syncQueue').then(rows=>window.dispatchEvent(new CustomEvent('mambo-sync-update',{detail:{pending:rows.length}}))).catch(()=>{});}
const $=s=>document.querySelector(s);
const ENTITIES=new Set(['products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments','operationalExpenses']);
function status(s){const el=document.querySelector('#syncStatus');if(el){el.dataset.state=s;el.textContent=s==='syncing'?'Menyinkronkan':s==='online'?'Online':'Offline';}}
export function getCloudConfig(){return JSON.parse(localStorage.getItem('mambo_cloud_config')||'{}');}
export async function configureCloud(url,key,store=''){if(!url||!key)throw Error('URL dan publishable/anon key wajib diisi.');const configKey=url.trim()+'|'+key.trim();storeId=String(store||'').trim()||null;if(!client||clientConfigKey!==configKey){if(client&&authSubscription)authSubscription.unsubscribe();const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.49.4?target=es2020');client=createClient(url.trim(),key.trim(),{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});clientConfigKey=configKey;const {data:{subscription}}=client.auth.onAuthStateChange((_event,nextSession)=>{session=nextSession;if(session&&!suppressAuthSync)Promise.resolve().then(()=>syncNow());});authSubscription=subscription;}localStorage.setItem('mambo_cloud_config',JSON.stringify({url:url.trim(),key:key.trim(),storeId:storeId||''}));const {data,error}=await client.auth.getSession();if(error)throw error;session=data.session;status(navigator.onLine?'online':'offline');return !!session;}
async function ensureClient(){if(client&&storeId)return;const c=getCloudConfig();if(!c.url||!c.key||!c.storeId)return;await configureCloud(c.url,c.key,c.storeId);}
export async function cloudSignIn(email,password,storeName='MAMBO KASIR'){await ensureClient();if(!client)throw Error('Konfigurasi Supabase belum diisi.');const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;session=data.session;if(!storeId){const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:storeName});if(boot.error)throw boot.error;storeId=boot.data?.store_id||null;if(!storeId)throw Error('Supabase tidak mengembalikan Store ID.');const cfg=getCloudConfig();cfg.storeId=storeId;localStorage.setItem('mambo_cloud_config',JSON.stringify(cfg));}const sync=await syncNow();if(!sync?.ok)throw Error('Login Cloud berhasil, tetapi sinkronisasi gagal: '+(sync?.error||'proses belum berjalan.'));return data.user;}
export async function cloudRegisterOwnerWithConfig(url,key,email,password,storeName){await configureCloud(url,key,'');if(!client)throw Error('Konfigurasi Supabase belum diisi.');const {data,error}=await client.auth.signUp({email,password});if(error)throw error;session=data.session||null;if(!session){localStorage.setItem('mambo_cloud_config',JSON.stringify({url:url.trim(),key:key.trim(),storeId:''}));return {needsConfirmation:true};}const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:storeName});if(boot.error)throw boot.error;storeId=boot.data?.store_id||null;if(!storeId)throw Error('Supabase tidak mengembalikan Store ID.');const cfg=getCloudConfig();cfg.storeId=storeId;localStorage.setItem('mambo_cloud_config',JSON.stringify(cfg));await syncNow();return {needsConfirmation:false,storeId};}
// Login Owner lintas-browser: hanya menerima akun yang SUDAH terdaftar sebagai Owner toko.
// Pull-only pada login pertama; tidak pernah mengirim antrean lokal dari browser baru.
export async function cloudSignInOwner(email,password){
 const cfg=getCloudConfig();
 const url=cfg.url||'https://wtsheaowviaedwhyiwkk.supabase.co';
 const key=cfg.key||'sb_publishable_P6RPUvaz7-ivBQWiU925zQ_M2ZkDaz0';
 await configureCloud(url,key,'');
 if(!client)throw Error('Koneksi aplikasi belum siap.');
 const pending=await all('syncQueue');
 if(pending.length)throw Error('Ada perubahan lokal yang belum tersinkron. Login dihentikan agar data tidak tertimpa.');
 suppressAuthSync=true;
 const {data,error}=await client.auth.signInWithPassword({email,password});
 if(error){suppressAuthSync=false;throw error;}
 session=data.session;
 try{
  const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:'MAMBO KASIR'});
  if(boot.error)throw boot.error;
  storeId=boot.data?.store_id||null;
  if(!storeId)throw Error('Toko Owner tidak ditemukan.');
  const rows=await cloudPull(), applied=await applyCloudRows(rows);
  localStorage.setItem('mambo_cloud_config',JSON.stringify({url,key,storeId}));
  status('online');suppressAuthSync=false;
  window.dispatchEvent(new CustomEvent('mambo-cloud-pulled',{detail:applied}));
  return {user:data.user,storeId,pulled:rows.length,applied:applied.applied||0};
 }catch(err){suppressAuthSync=false;await client.auth.signOut();session=null;throw err;}
}
export async function cloudRegisterOwner(email,password,storeName){
 const cfg=getCloudConfig();
 const url=cfg.url||'https://wtsheaowviaedwhyiwkk.supabase.co';
 const key=cfg.key||'sb_publishable_P6RPUvaz7-ivBQWiU925zQ_M2ZkDaz0';
 await configureCloud(url,key,'');
 const {data,error}=await client.auth.signUp({email,password});
 if(error)throw error;
 if(!data.session)return {needsConfirmation:true};
 session=data.session;
 const boot=await client.rpc('mambo_owner_bootstrap',{p_store_name:storeName});
 if(boot.error)throw boot.error;
 storeId=boot.data?.store_id||null;
 if(!storeId)throw Error('Toko tidak berhasil dibuat.');
 const rows=await cloudPull();await applyCloudRows(rows);
 localStorage.setItem('mambo_cloud_config',JSON.stringify({url,key,storeId}));
 return {needsConfirmation:false,storeId};
}
export async function cloudUpdateOwnerProfile({email,password}){
 await ensureClient();
 if(!client||!session)throw Error('Sesi Owner tidak aktif.');
 const updates={};
 if(email)updates.email=email;
 if(password)updates.password=password;
 if(!Object.keys(updates).length)return {updated:false};
 const {data,error}=await client.auth.updateUser(updates);
 if(error)throw error;
 session=data.user?{...session,user:data.user}:session;
 return {updated:true,email:data.user?.email||session.user?.email};
}
export async function cloudSignInExistingOwner(url,key,existingStoreId,email,password){
 const sid=String(existingStoreId||'').trim();
 if(!sid)throw Error('Store ID toko yang sudah ada wajib diisi.');
 await configureCloud(url,key,sid);
 if(!client)throw Error('Konfigurasi Supabase tidak valid.');
 const pending=await all('syncQueue');
 if(pending.length)throw Error('Ada '+pending.length+' perubahan lokal yang belum tersinkron. Demi keamanan, login lintas-browser dihentikan agar data lokal tidak tertimpa/terkirim.');
 suppressAuthSync=true;
 const {data,error}=await client.auth.signInWithPassword({email,password});
 if(error){suppressAuthSync=false;throw error;}
 session=data.session;
 try{
  const check=await client.rpc('mambo_owner_bootstrap',{p_store_name:'MAMBO KASIR'});
  if(check.error)throw check.error;
  if(check.data?.existing!==true||String(check.data?.store_id||'')!==sid)throw Error('Akun ini bukan Owner terdaftar untuk toko tersebut.');
  const rows=await cloudPull();
  const applied=await applyCloudRows(rows);
  localStorage.setItem('mambo_cloud_config',JSON.stringify({url:url.trim(),key:key.trim(),storeId:sid}));
  status('online');
  suppressAuthSync=false;
  window.dispatchEvent(new CustomEvent('mambo-cloud-pulled',{detail:applied}));
  return {user:data.user,storeId:sid,pulled:rows.length,applied:applied.applied||0};
 }catch(err){suppressAuthSync=false;await client.auth.signOut();session=null;throw err;}
}
export async function cloudSignOut(){if(client)await client.auth.signOut();session=null;status(navigator.onLine?'online':'offline');}
async function findProductSkuConflicts(){
 const localProducts=await all('products');
 let page=0,remoteProducts=[];
 while(true){
  const {data,error}=await client.from('mambo_sync_records').select('record_id,payload,deleted').eq('store_id',storeId).eq('entity','products').range(page*500,page*500+499);
  if(error)throw error;
  remoteProducts=remoteProducts.concat(data||[]);
  if(!data||data.length<500)break;
  page++;
 }
 const remoteBySku=new Map();
 for(const row of remoteProducts){if(row.deleted)continue;const sku=String(row.payload?.sku||'').trim().toLowerCase();if(sku)remoteBySku.set(sku,row);}
 const conflicts=[];
 for(const product of localProducts){const sku=String(product.sku||'').trim().toLowerCase();if(!sku)continue;const remote=remoteBySku.get(sku);if(remote&&String(remote.record_id)!==String(product.id))conflicts.push({sku:product.sku,localName:product.name||'(tanpa nama)',remoteName:remote.payload?.name||'(tanpa nama)',localId:product.id,remoteId:remote.record_id});}
 return conflicts;
}
async function productPhotoFingerprint(product){
 const photo=product?.photo;
 const bytes=photo instanceof ArrayBuffer?new Uint8Array(photo):ArrayBuffer.isView(photo)?new Uint8Array(photo.buffer,photo.byteOffset,photo.byteLength):null;
 if(!bytes?.byteLength)return '';
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 return hash+':'+String(product.photoType||'image/jpeg');
}
async function uploadProductPhoto(recordId,product){
 const photo=product?.photo;
 if(typeof photo==='string'&&/^https?:\/\//i.test(photo))return photo;
 if(!(photo instanceof ArrayBuffer)&&!ArrayBuffer.isView(photo))return product?.photoUrl||null;
 if(!photo.byteLength)return product?.photoUrl||null;
 const mime=String(product.photoType||'image/jpeg');
 const ext=mime.split('/')[1]?.replace(/[^a-z0-9]/gi,'')||'jpg';
 const cacheKey='mambo_uploaded_product_images_'+storeId;
 let cache={};try{cache=JSON.parse(localStorage.getItem(cacheKey)||'{}')||{};}catch{}
 const fingerprint=await productPhotoFingerprint(product);
 if(cache[String(recordId)]?.fingerprint===fingerprint&&cache[String(recordId)]?.url)return cache[String(recordId)].url;
 // Versi foto menjadi bagian nama file agar URL berubah setiap foto diedit.
 // Ini mencegah browser Kasir memakai gambar lama dari cache URL yang sama.
 const version=fingerprint.split(':')[0].slice(0,24)||String(Date.now());
 const path=storeId+'/'+String(recordId)+'_'+version+'.'+ext;
 const body=photo instanceof ArrayBuffer?new Blob([photo],{type:mime}):new Blob([photo.buffer.slice(photo.byteOffset,photo.byteOffset+photo.byteLength)],{type:mime});
 const {error}=await client.storage.from('mambo-product-images').upload(path,body,{upsert:true,contentType:mime,cacheControl:'3600'});
 if(error)throw new Error('Gagal mengunggah foto produk '+(product.sku||recordId)+': '+error.message);
 const url=client.storage.from('mambo-product-images').getPublicUrl(path).data.publicUrl;
 cache[String(recordId)]={fingerprint,url};localStorage.setItem(cacheKey,JSON.stringify(cache));
 return url;
}
async function prepareProductSyncPayload(recordId,payload,localProducts){
 const local=localProducts.get(String(recordId));
 const source=local?{...payload,photo:local.photo??payload?.photo,photoType:local.photoType||payload?.photoType,updatedAt:local.updatedAt||payload?.updatedAt,sku:local.sku||payload?.sku,photoUrl:local.photoUrl||payload?.photoUrl}:({...payload});
 const photoUrl=await uploadProductPhoto(recordId,source);
 const clean={...source,photoUrl};
 delete clean.photo;
 delete clean.photoType;
 return clean;
}
async function syncLocalProductPhotos(){
 const products=await all('products'),cacheKey='mambo_uploaded_product_images_'+storeId;
 let cache={};try{cache=JSON.parse(localStorage.getItem(cacheKey)||'{}')||{};}catch{}
 for(const product of products){
  const photo=product.photo;
  if(!(photo instanceof ArrayBuffer)&&!ArrayBuffer.isView(photo))continue;
  const fingerprint=await productPhotoFingerprint(product);
  if(cache[String(product.id)]?.fingerprint===fingerprint&&cache[String(product.id)]?.synced===true)continue;
  const photoUrl=await uploadProductPhoto(product.id,product);
  if(!photoUrl)continue;
  const {data,error}=await client.from('mambo_sync_records').select('payload').eq('store_id',storeId).eq('entity','products').eq('record_id',String(product.id)).maybeSingle();
  if(error)throw error;
  const payload={...(data?.payload||product),photoUrl};
  delete payload.photo;delete payload.photoType;
  const {error:saveError}=await client.from('mambo_sync_records').upsert({store_id:storeId,entity:'products',record_id:String(product.id),payload,deleted:false,updated_at:new Date().toISOString()},{onConflict:'store_id,entity,record_id'});
  if(saveError)throw saveError;
  cache[String(product.id)]={fingerprint,url:photoUrl,synced:true};localStorage.setItem(cacheKey,JSON.stringify(cache));
 }
}
export async function syncNow(){if(busy)return syncPromise||{ok:false,error:'Sinkronisasi sedang berjalan.'};if(!navigator.onLine)return {ok:false,error:'Perangkat sedang offline.'};if(!client||!session||!storeId){const el=document.querySelector('#syncStatus');if(el&&session)el.title='Sesi Owner Cloud belum memiliki Store ID aktif.';return {ok:false,error:'Sesi Supabase atau Store ID belum aktif.'};}busy=true;status('syncing');syncPromise=(async()=>{try{const queue=(await all('syncQueue')).sort((a,b)=>a.createdAt-b.createdAt);const conflicts=await findProductSkuConflicts();if(conflicts.length){const detail=conflicts.slice(0,8).map(x=>'SKU '+x.sku+': laptop "'+x.localName+'" ↔ pusat "'+x.remoteName+'"').join('; ');const more=conflicts.length>8?' (dan '+(conflicts.length-8)+' benturan lainnya)':'';status('offline');return {ok:false,error:'Sinkronisasi dihentikan demi keamanan. Ditemukan '+conflicts.length+' SKU produk yang bertabrakan: '+detail+more+'. Antrean lokal tidak dikirim atau dihapus.'};}let pushed=0;const productRows=queue.some(x=>x.entity==='products'&&x.operation!=='delete')?await all('products'):[];const productMap=new Map(productRows.map(p=>[String(p.id),p]));for(const item of queue){if(!ENTITIES.has(item.entity)){await remove('syncQueue',item.id);continue;}let payload=item.payload||{};if(item.entity==='products'&&item.operation!=='delete')payload=await prepareProductSyncPayload(item.recordId,payload,productMap);const row={store_id:storeId,entity:item.entity,record_id:String(item.recordId),payload,deleted:item.operation==='delete',updated_at:new Date().toISOString()};const {error}=await client.from('mambo_sync_records').upsert(row,{onConflict:'store_id,entity,record_id'});if(error)throw error;await remove('syncQueue',item.id);pushed++;notifyQueue();}await syncLocalProductPhotos();let page=0,allRows=[];while(true){const {data,error}=await client.from('mambo_sync_records').select('entity,record_id,payload,deleted').eq('store_id',storeId).range(page*500,page*500+499);if(error)throw error;allRows=allRows.concat(data||[]);if(!data||data.length<500)break;page++;}const result=await applyCloudRows(allRows);status('online');notifyQueue();window.dispatchEvent(new CustomEvent('mambo-cloud-pulled',{detail:result}));return {ok:true,pushed,pulled:allRows.length,applied:result.applied,skipped:result.skipped,pending:await pendingSyncCount()};}catch(e){console.warn('Supabase sync:',e.message);status('offline');return {ok:false,error:e.message||String(e)};}finally{busy=false;syncPromise=null;}})();return await syncPromise;}
export async function startCloudSync(){
 if(syncStarted)return;
 syncStarted=true;
 try{await ensureClient();}catch(e){console.warn(e);}
 // Kanal cloud Owner tidak boleh menimpa indikator sinkronisasi perangkat Kasir.
 const ownerSessionActive=()=>!!(session&&storeId);
 const tick=()=>{
  if(!ownerSessionActive())return;
  if(navigator.onLine)syncNow();else status('offline');
 };
 window.addEventListener('online',tick);
 window.addEventListener('offline',()=>{if(ownerSessionActive())status('offline');});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
 tick();
 setInterval(tick,20000);
}
export async function cloudStatus(){await ensureClient();return {configured:!!client,authenticated:!!session,storeId};}
export async function pendingSyncCount(){return (await all('syncQueue')).length;}
export async function cloudPull(){await ensureClient();if(!client||!session)throw Error('Login cloud diperlukan.');const {data,error}=await client.from('mambo_sync_records').select('entity,record_id,payload,deleted').eq('store_id',storeId);if(error)throw error;return data||[];}


// Publikasi katalog hanya mengirim kolom aman; data HPP, stok, transaksi, dan payload internal tidak pernah dikirim.
export async function publishPublicCatalog(products,categories,settings,mode='selected'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Supabase sebagai pemilik toko diperlukan untuk menerbitkan katalog.');
 const visible=products.filter(p=>mode==='all'||(mode==='selected'&&p.publicVisible===true));
 const categoryName=id=>categories.find(c=>c.id===id)?.name||'Lainnya';
 const rows=[];
 for(const p of visible){
  let image_url=null;
  if(p.photo){
   const ext=String(p.photoType||'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi,'')||'jpg';
   const path=storeId+'/'+p.id+'.'+ext;
   const {error:uploadError}=await client.storage.from('mambo-product-images').upload(path,new Blob([p.photo],{type:p.photoType||'image/jpeg'}),{upsert:true,contentType:p.photoType||'image/jpeg',cacheControl:'3600'});
   if(uploadError)throw uploadError;
   image_url=client.storage.from('mambo-product-images').getPublicUrl(path).data.publicUrl;
  }
  rows.push({store_id:storeId,product_id:String(p.id),sku:String(p.sku||''),name:String(p.name||''),category_name:categoryName(p.categoryId),price:Number(p.price||0),image_url,updated_at:new Date().toISOString()});
 }
 const {error:settingsError}=await client.from('mambo_public_catalog_settings').upsert({store_id:storeId,store_name:String(settings.storeName||'MAMBO KASIR'),whatsapp:String(settings.catalogWhatsapp||settings.phone||''),tagline:String(settings.catalogTagline||'Pesan produk favorit Anda')},{onConflict:'store_id'});
 if(settingsError)throw settingsError;
 if(rows.length){const {error}=await client.from('mambo_public_catalog_products').upsert(rows,{onConflict:'store_id,product_id'});if(error)throw error;const keep=rows.map(x=>x.product_id);const {error:deleteError}=await client.from('mambo_public_catalog_products').delete().eq('store_id',storeId).not('product_id','in','('+keep.join(',')+')');if(deleteError)throw deleteError;}else{const {error:deleteError}=await client.from('mambo_public_catalog_products').delete().eq('store_id',storeId);if(deleteError)throw deleteError;}
 return {published:rows.length};
}

export async function createCashierPairCode(label='Perangkat Kasir'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan terlebih dahulu.');
 const {data,error}=await client.rpc('mambo_owner_create_pair_code',{p_store_id:storeId,p_label:label});
 if(error)throw error;
 return String(data||'');
}


export async function sharedDrawerSnapshot(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_snapshot',{p_store_id:storeId});
 if(error)throw error;return data;
}
export async function openSharedDrawer(openingCash,actorName='Owner'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_open',{p_store_id:storeId,p_opening_cash:Number(openingCash),p_actor_name:actorName});
 if(error)throw error;return data;
}
export async function reviewSharedDrawerPendingEvents(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_snapshot',{p_store_id:storeId});
 if(error)throw error;
 const pending=(data?.events||[]).filter(e=>e.resolution_status==='pending');
 const reviewed=[];
 for(const event of pending){
  const entity=event.event_type==='cash_sale'?'transactions':event.event_type==='cash_expense'?'operationalExpenses':null;
  let row=null,synced=false,valid=false,validationReason='Jenis pergerakan belum didukung untuk pemeriksaan otomatis.';
  if(entity&&event.source_record_id){
   const result=await client.from('mambo_sync_records').select('record_id,payload,deleted').eq('store_id',storeId).eq('entity',entity).eq('record_id',String(event.source_record_id)).maybeSingle();
   if(result.error)throw result.error;
   row=result.data;
   synced=!!row&&!row.deleted;
   const validation=validatePendingDrawerRecord(event,row);
   valid=validation.valid;validationReason=validation.reason;
  }
  reviewed.push({...event,source_entity:entity,synced_record_found:synced,synced_record_valid:valid,validation_reason:validationReason});
 }
 return {snapshot:data,pending:reviewed};
}
export async function syncOwnerSharedDrawerSourceRecord(entity,record){
 await ensureClient();
 if(!['transactions','operationalExpenses'].includes(entity)||!record?.id)throw Error('Record sumber pergerakan kas tidak valid.');
 if(!client||!session||!storeId)throw Error('Login Cloud Owner diperlukan untuk menyinkronkan bukti transaksi.');
 const {error}=await client.from('mambo_sync_records').upsert({
  store_id:storeId,entity,record_id:String(record.id),payload:record,deleted:false,updated_at:new Date().toISOString()
 },{onConflict:'store_id,entity,record_id'});
 if(error)throw error;
 return true;
}
export async function resolveOwnerDrawerEvent(eventId,resolution){await ensureClient();if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');const {data,error}=await client.rpc('mambo_shared_drawer_event_resolve',{p_store_id:storeId,p_event_id:eventId,p_resolution:resolution});if(error)throw error;return data;}
export async function flushPendingOwnerDrawerEvents(){
 const pending=JSON.parse(localStorage.getItem('mambo_pending_owner_drawer_events')||'[]'),remain=[];
 for(const event of pending){
  try{
   const snapshot=await appendOwnerDrawerEvent(event,'Owner');
   if(event.type==='cash_sale'||event.type==='cash_expense'){
    const existing=(snapshot?.events||[]).find(row=>String(row.event_id)===String(event.eventId));
    // Event confirmed sudah final; event reversed tidak muncul pada snapshot.
    // Hindari mencoba menyelesaikan ulang dengan status yang berlawanan.
    if(existing?.resolution_status==='pending'){
     const entity=event.type==='cash_sale'?'transactions':'operationalExpenses';
     const rows=await all(entity);
     const source=rows.find(row=>String(row.id)===String(event.sourceRecordId||event.eventId));
     if(source){
      // Simpan bukti transaksi ke pusat sebelum mengonfirmasi saldo laci.
      const {error:syncError}=await client.from('mambo_sync_records').upsert({
       store_id:storeId,entity,record_id:String(source.id),payload:source,deleted:false,updated_at:new Date().toISOString()
      },{onConflict:'store_id,entity,record_id'});
      if(syncError)throw syncError;
      await resolveOwnerDrawerEvent(event.eventId,'confirmed');
     }else await resolveOwnerDrawerEvent(event.eventId,'reversed');
    }
   }
  }catch(err){remain.push(event);}
 }
 localStorage.setItem('mambo_pending_owner_drawer_events',JSON.stringify(remain));
 return {pending:remain.length};
}
export async function appendOwnerDrawerEvent(event,actorName='Owner'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_owner_event',{
  p_store_id:storeId,p_event_id:event.eventId,p_event_type:event.type,p_amount:Number(event.amount),
  p_source_record_id:event.sourceRecordId||null,p_note:event.note||null,p_actor_name:actorName
 });
 if(error)throw error;return data;
}
export async function setSupervisorDrawerControl(enabled){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_setting',{p_store_id:storeId,p_enabled:!!enabled});
 if(error)throw error;return data;
}
export async function supervisorExpenseCategoryStatus(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_expense_setting_status',{p_store_id:storeId});
 if(error)throw error;return !!data;
}
export async function setSupervisorExpenseCategoryAccess(enabled){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_expense_setting',{p_store_id:storeId,p_enabled:!!enabled});
 if(error)throw error;return !!data;
}
export async function supervisorDrawerControlStatus(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_supervisor_status',{p_store_id:storeId});
 if(error)throw error;return !!data;
}
export async function closeSharedDrawer(countedCash,actorName='Owner'){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan.');
 const {data,error}=await client.rpc('mambo_shared_drawer_close',{p_store_id:storeId,p_counted_cash:Number(countedCash),p_actor_name:actorName});
 if(error)throw error;return data;
}


// Pengelolaan akun karyawan: seluruh operasi divalidasi RPC di sisi database.
async function requireOwnerCloud(){
 await ensureClient();
 if(!client||!session||!storeId)throw Error('Login Cloud sebagai Owner diperlukan. Buka Pengaturan > Integrasi Supabase Cloud.');
 return {client,storeId};
}
export async function staffAccountList(){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_list',{p_store_id:storeId});if(error)throw error;return Array.isArray(data)?data:[];}
export async function staffAccountCreate(username,name,role,pin){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_create',{p_store_id:storeId,p_username:username,p_display_name:name,p_app_role:role,p_pin:pin});if(error)throw error;return data;}
export async function staffAccountUpdate(id,username,name,roleId,active){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_update',{p_store_id:storeId,p_staff_id:id,p_username:username,p_display_name:name,p_role_id:roleId,p_active:active});if(error)throw error;return data;}
export async function staffAccountResetPin(id,pin){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_reset_pin',{p_store_id:storeId,p_staff_id:id,p_pin:pin});if(error)throw error;return data;}

export async function staffRoleList(){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_roles',{p_store_id:storeId});if(error)throw error;return Array.isArray(data)?data:[];}
export async function staffRoleSave(id,title,permissionRole,active=true){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_role_save',{p_store_id:storeId,p_role_id:id||null,p_title:title,p_permission_role:permissionRole,p_active:active});if(error)throw error;return data;}
export async function staffInviteCreate(username,name,roleId){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_invite',{p_store_id:storeId,p_username:username,p_display_name:name,p_role_id:roleId});if(error)throw error;return data;}
export async function staffInviteReset(id){const {client,storeId}=await requireOwnerCloud();const {data,error}=await client.rpc('mambo_owner_staff_invite_reset',{p_store_id:storeId,p_staff_id:id});if(error)throw error;return data;}
